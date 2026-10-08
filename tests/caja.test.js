// Caja del día: el efectivo pagado a proveedores sale del cajón, la lista de todo lo pagado en el día, y el cheque
// recibido a cambio de efectivo (entra el cheque, sale el efectivo, no es ingreso ni gasto).
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, limpiarDatos, asegurarMetodo } = require('./harness');

let db;
let invocar;
test.before(async () => {
  ({ db, invocar } = await iniciar());
});
test.beforeEach(() => {
  limpiarDatos(db);
  db.prepare('DELETE FROM operaciones_caja').run();
  db.prepare('DELETE FROM cheques').run();
  db.prepare('DELETE FROM pagos_proveedor').run();
  db.prepare('DELETE FROM proveedores').run();
  db.prepare('DELETE FROM cierres_caja').run();
  ['Efectivo', 'Mercado Pago', 'Cheque'].forEach((m) => asegurarMetodo(db, m));
});

const hoy = () => db.prepare("SELECT date('now', 'localtime') AS d").get().d;

const categoria = async (nombre) => {
  await invocar('gastos:crearCategoria', { nombre, ambito: 'negocio' });
  return db.prepare("SELECT id FROM categorias_gasto WHERE nombre = ? AND ambito = 'negocio'").get(nombre).id;
};

const proveedor = async (nombre) => {
  await invocar('proveedores:crear', { nombre });
  return db.prepare('SELECT id FROM proveedores WHERE nombre = ?').get(nombre).id;
};

test('el efectivo pagado a un proveedor sale del cajón del día', async () => {
  const dia = hoy();
  await invocar('caja:guardarCierre', { fecha: dia, fondo_inicial: 100000, efectivo_contado: null });
  const prov = await proveedor('Frigorífico prueba');
  assert.equal((await invocar('proveedores:pagar', { proveedor_id: prov, fecha: dia, efectivo: 30000 })).ok, true);

  const d = await invocar('caja:obtenerDia', dia);
  const pago = d.gastosEfectivo.find((g) => g.origen === 'proveedor');
  assert.equal(pago.monto, 30000);
  assert.equal(pago.descripcion, 'Pago a Frigorífico prueba');

  const mes = await invocar('caja:resumenMes', { anio: Number(dia.slice(0, 4)), mes: Number(dia.slice(5, 7)) - 1 });
  const fila = mes.dias.find((x) => x.fecha === dia);
  assert.equal(fila.esperado, 70000, 'fondo 100.000 − 30.000 pagados al proveedor');

  // La diferencia del cierre cuenta el pago al proveedor.
  await invocar('caja:guardarCierre', { fecha: dia, fondo_inicial: 100000, efectivo_contado: 70000 });
  const cierres = await invocar('caja:resumenCierres');
  assert.equal(cierres.find((c) => c.fecha === dia).diferencia, 0);
});

test('"todo lo pagado en el día" trae gastos en efectivo y por transferencia, y pagos a proveedores', async () => {
  const dia = hoy();
  const cat = await categoria('Servicios prueba');
  await invocar('gastos:crear', { fecha: dia, categoria_id: cat, descripcion: 'Luz', monto: 8000, medio_pago: 'Transferencia', cuenta: 'Mercado Pago' });
  await invocar('gastos:crear', { fecha: dia, categoria_id: cat, descripcion: 'Flete', monto: 2000, medio_pago: 'Efectivo' });
  const prov = await proveedor('Granja prueba');
  await invocar('proveedores:pagar', { proveedor_id: prov, fecha: dia, efectivo: 5000, transferencias: [{ cuenta: 'Mercado Pago', monto: 7000 }] });

  const d = await invocar('caja:obtenerDia', dia);
  // (La base de prueba puede tener la cuenta como "MercadoPago": se comparan sin espacios.)
  const texto = d.salidasDelDia.map((s) => `${s.detalle}|${s.pagoCon}|${s.monto}`.replace('MercadoPago', 'Mercado Pago')).sort();
  assert.deepEqual(texto, [
    'Flete|Efectivo|2000',
    'Luz|Transferencia · Mercado Pago|8000',
    'Pago a Granja prueba|Efectivo|5000',
    'Pago a Granja prueba|Transferencia · Mercado Pago|7000',
  ]);
});

test('un cheque recibido a cambio de efectivo entra a la cartera y descuenta el efectivo, sin ser ingreso ni gasto', async () => {
  const dia = hoy();
  const r = await invocar('cheques:crear', { banco: 'Nación', numero: '123', importe: 50000, librador: 'Hugo', efectivo_a_cambio: true });
  assert.equal(r.ok, true);
  const cheque = db.prepare("SELECT id, estado FROM cheques WHERE numero = '123'").get();
  assert.equal(cheque.estado, 'en_cartera');

  const d = await invocar('caja:obtenerDia', dia);
  assert.equal(d.otrosEfectivo, -50000, 'sale el efectivo del cajón');
  const est = await invocar('estadisticas:resumen', { desde: dia, hasta: dia });
  assert.equal(est.entradas.total, 0, 'no es un ingreso');
  assert.equal(est.salidas.total, 0, 'no es un gasto');

  // Deshacer desde la operación: se borra el cheque y vuelve el efectivo.
  const op = db.prepare('SELECT id FROM operaciones_caja WHERE cheque_id = ?').get(cheque.id);
  assert.equal((await invocar('operaciones:eliminar', op.id)).ok, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cheques WHERE id = ?').get(cheque.id).n, 0);
  assert.equal((await invocar('caja:obtenerDia', dia)).otrosEfectivo, 0);
});

test('borrar el cheque recibido a cambio de efectivo devuelve el efectivo; si ya se entregó, no se puede deshacer', async () => {
  const dia = hoy();
  await invocar('cheques:crear', { banco: 'Galicia', numero: '9', importe: 20000, librador: 'Hugo', efectivo_a_cambio: true });
  const uno = db.prepare("SELECT id FROM cheques WHERE numero = '9'").get().id;
  await invocar('cheques:eliminar', uno);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM operaciones_caja').get().n, 0);
  assert.equal((await invocar('caja:obtenerDia', dia)).otrosEfectivo, 0);

  await invocar('cheques:crear', { banco: 'Galicia', numero: '10', importe: 20000, librador: 'Hugo', efectivo_a_cambio: true });
  const dos = db.prepare("SELECT id FROM cheques WHERE numero = '10'").get().id;
  await invocar('cheques:entregar', { id: dos, entregado_a: 'Otro', fecha_entrega: dia });
  const op = db.prepare('SELECT id FROM operaciones_caja WHERE cheque_id = ?').get(dos);
  const r = await invocar('operaciones:eliminar', op.id);
  assert.equal(r.ok, false);
});

test('el historial de una cuenta con espacios en el nombre (Banco Norte) parte de su saldo inicial', async () => {
  asegurarMetodo(db, 'Banco Norte');
  const dia = hoy();
  const r = await invocar('cuentas:guardarSaldos', { desde: dia, saldos: { Efectivo: 1000, 'Banco Norte': 6100000 } });
  assert.equal(r.ok, true, r.error);
  const banco = await invocar('cuentas:movimientos', 'Banco Norte');
  assert.equal(banco.inicial, 6100000, 'el saldo inicial no se pierde por el espacio del nombre');
  assert.equal((await invocar('cuentas:movimientos', 'Efectivo')).inicial, 1000);
  const resumen = await invocar('cuentas:resumen');
  assert.equal(resumen.cuentas.find((c) => c.nombre === 'Banco Norte').saldo_inicial, banco.inicial, 'el historial y la tabla de cuentas coinciden');
});
