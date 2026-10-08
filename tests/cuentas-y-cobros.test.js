// Renombrar o quitar una cuenta (método de pago), lo que se carga solo en una base nueva y corregir con qué se pagó un cobro.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { iniciar, limpiarDatos, crearCliente, crearProducto, asegurarMetodo } = require('./harness');

let db;
let invocar;
test.before(async () => {
  ({ db, invocar } = await iniciar());
});
test.beforeEach(() => {
  limpiarDatos(db);
  db.prepare('DELETE FROM cobros_metodo_cambiado').run();
  db.prepare("DELETE FROM gastos").run();
  ['Efectivo', 'Mercado Pago', 'Cheque'].forEach((m) => asegurarMetodo(db, m));
});

const hoy = () => db.prepare("SELECT date('now', 'localtime') AS d").get().d;

async function facturaPagada(cliente, producto, monto, metodo) {
  const f = await invocar('facturas:crear', { cliente_id: cliente, tipo_precio: 'cliente', items: [{ producto_id: producto, cantidad: 1 }] });
  await invocar('facturas:registrarPago', { factura_id: f.id, monto, metodo_pago: metodo });
  return f;
}

test('renombrar una cuenta mueve sus cobros, saldos y fondos personales al nombre nuevo (nada pasa a "Sin asignar")', async () => {
  asegurarMetodo(db, 'Cuenta Vieja');
  await invocar('cuentas:guardarSaldos', { desde: hoy(), saldos: { Efectivo: 0, 'Mercado Pago': 0, 'Cuenta Vieja': 1000 } });
  const c = crearCliente(db, 'Cami');
  const p = crearProducto(db, { nombre: 'Prod', precio: 5000 });
  await facturaPagada(c, p, 5000, 'Cuenta Vieja');
  await invocar('ingresos:crearPase', { fecha: hoy(), sentido: 'a_personal', monto: 100, cuenta_negocio: 'Cuenta Vieja', cuenta_personal: 'Cuenta Vieja' });
  const id = db.prepare("SELECT id FROM metodos_pago WHERE nombre = 'Cuenta Vieja'").get().id;

  const r = await invocar('metodosPago:actualizar', { id, nombre: 'Cuenta Nueva' });
  assert.equal(r.nombre, 'Cuenta Nueva');

  const resumen = await invocar('cuentas:resumen');
  assert.equal(resumen.sinAsignar, null);
  assert.equal(resumen.cuentas.find((x) => x.nombre === 'Cuenta Nueva').saldo, 1000 + 5000 - 100);
  const personal = (await invocar('ingresos:saldos')).cuentas.find((x) => x.nombre === 'Cuenta Nueva');
  assert.equal(personal.saldo, 100);
});

test('renombrar una cuenta con el nombre de otra devuelve un error claro', async () => {
  asegurarMetodo(db, 'Cuenta A');
  const id = db.prepare("SELECT id FROM metodos_pago WHERE nombre = 'Cuenta A'").get().id;
  const r = await invocar('metodosPago:actualizar', { id, nombre: 'Efectivo' });
  assert.equal(r.ok, false);
});

test('no se puede quitar una cuenta con plata; en cero sí', async () => {
  asegurarMetodo(db, 'Banco Chico');
  await invocar('cuentas:guardarSaldos', { desde: hoy(), saldos: { Efectivo: 0, 'Mercado Pago': 0, 'Banco Chico': 50000 } });
  const id = db.prepare("SELECT id FROM metodos_pago WHERE nombre = 'Banco Chico'").get().id;
  const r = await invocar('metodosPago:baja', id);
  assert.equal(r.ok, false);
  assert.match(r.error, /50\.000/);
  assert.equal(db.prepare('SELECT activo FROM metodos_pago WHERE id = ?').get(id).activo, 1);

  await invocar('cuentas:ajustar', { cuenta: 'Banco Chico', saldo_real: 0 });
  assert.equal((await invocar('metodosPago:baja', id)).ok, true);
  assert.equal(db.prepare('SELECT activo FROM metodos_pago WHERE id = ?').get(id).activo, 0);
});

test('los productos y métodos iniciales no se vuelven a crear en cada arranque', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  db.prepare("UPDATE productos SET nombre = 'Picada renombrada' WHERE nombre = 'Picada'").run();
  const antes = db.prepare('SELECT COUNT(*) AS n FROM productos').get().n;
  const metodosAntes = db.prepare('SELECT COUNT(*) AS n FROM metodos_pago').get().n;
  db.exec(schema); // lo que corre en cada arranque
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM productos').get().n, antes);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM metodos_pago').get().n, metodosAntes);
  assert.equal(db.prepare("SELECT valor FROM configuracion WHERE clave = 'semillas_iniciales_v1'").get().valor, '1');
});

test('corregir con qué se pagó rehace la retención y deja registrado quién, cuándo y por qué', async () => {
  await invocar('config:guardarRetencionTransferencia', 3);
  const c = crearCliente(db, 'Beto');
  const p = crearProducto(db, { nombre: 'Prod2', precio: 1000 });
  await facturaPagada(c, p, 1000, 'Mercado Pago');
  const retenciones = () => db.prepare('SELECT monto FROM gastos WHERE pago_ids IS NOT NULL').all().map((g) => g.monto);
  assert.deepEqual(retenciones(), [30]);
  const pago = db.prepare('SELECT id FROM pagos').get();

  // De transferencia a efectivo: ya no hay retención.
  assert.equal((await invocar('pagos:cambiarMetodo', { ids: [pago.id], metodo_pago: 'Efectivo', motivo: 'Lo pagó en mano' })).ok, true);
  assert.deepEqual(retenciones(), []);
  // Y de vuelta a transferencia: vuelve a haber.
  assert.equal((await invocar('pagos:cambiarMetodo', { ids: [pago.id], metodo_pago: 'Mercado Pago' })).ok, true);
  assert.deepEqual(retenciones(), [30]);

  const cambios = db.prepare('SELECT metodo_anterior, metodo_nuevo, motivo FROM cobros_metodo_cambiado ORDER BY id').all();
  assert.deepEqual(cambios.map((x) => [x.metodo_anterior, x.metodo_nuevo, x.motivo]), [['Mercado Pago', 'Efectivo', 'Lo pagó en mano'], ['Efectivo', 'Mercado Pago', null]]);
});

test('un empleado tiene que poner el motivo al corregir con qué se pagó, y el administrador recibe el aviso', async () => {
  await invocar('usuarios:crearPrimero', { nombre: 'Jefa', pin: '1234' });
  await invocar('usuarios:crear', { nombre: 'Empleado', pin: '5678', rol: 'empleado' });
  const empleado = db.prepare("SELECT id FROM usuarios WHERE nombre = 'Empleado'").get().id;
  const c = crearCliente(db, 'Dani');
  const p = crearProducto(db, { nombre: 'Prod3', precio: 1000 });
  await facturaPagada(c, p, 1000, 'Efectivo');
  const pago = db.prepare('SELECT id FROM pagos').get();

  await invocar('usuarios:ingresar', { usuario_id: empleado, pin: '5678' });
  const sinMotivo = await invocar('pagos:cambiarMetodo', { ids: [pago.id], metodo_pago: 'Mercado Pago' });
  assert.equal(sinMotivo.ok, false);
  assert.equal((await invocar('pagos:cambiarMetodo', { ids: [pago.id], metodo_pago: 'Mercado Pago', motivo: 'Se equivocó' })).ok, true);
  await invocar('usuarios:cerrarSesion');

  const jefa = db.prepare("SELECT id FROM usuarios WHERE nombre = 'Jefa'").get().id;
  await invocar('usuarios:ingresar', { usuario_id: jefa, pin: '1234' });
  const aviso = (await invocar('avisos:obtener')).avisos.find((a) => a.tipo === 'cambios_metodo_empleado');
  assert.ok(aviso, 'tiene que haber un aviso');
  assert.match(aviso.detalle, /Efectivo a Mercado Pago/);
  await invocar('usuarios:cerrarSesion');
});
