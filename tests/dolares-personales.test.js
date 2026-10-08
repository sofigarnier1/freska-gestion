// Tests de los dólares personales (ahorro): un bolsillo aparte del de la Caja, con la misma cotización. Comprarlos resta
// pesos de una cuenta personal, y suman al dinero disponible personal. No tocan la caja del negocio ni son ingreso o gasto.
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
  db.prepare("DELETE FROM metodos_pago WHERE nombre IN ('MercadoPago', 'Personal Pay')").run();
  ['Efectivo', 'Mercado Pago', 'Cheque'].forEach((m) => asegurarMetodo(db, m));
});

const hoy = () => db.prepare("SELECT date('now', 'localtime') AS d").get().d;
const categoria = () => db.prepare("SELECT id FROM categorias_gasto WHERE ambito = 'personal' AND de_fondos = 1 AND activo = 1 ORDER BY id LIMIT 1").get().id;
const saldos = () => invocar('ingresos:saldos');
const personal = async (nombre) => (await saldos()).cuentas.find((c) => c.nombre === nombre).saldo;
const cajaConfigurada = async () => assert.equal((await invocar('cuentas:guardarSaldos', { desde: hoy(), saldos: { Efectivo: 0, 'Mercado Pago': 0 } })).ok, true);
const cargar = (cuenta, monto) => invocar('ingresos:crear', { fecha: hoy(), categoria_id: categoria(), descripcion: 'Alquiler', monto, cuenta });

test('ajustar los dólares personales guarda la cantidad y la cotización (la misma de la Caja) y suma al dinero disponible', async () => {
  await cajaConfigurada();
  await cargar('Efectivo personal', 50000);
  assert.deepEqual((await saldos()).dolares, { usd: 0, cotizacion: 0, valor: 0 });
  assert.equal((await invocar('ingresos:guardarDolares', { dolares_usd: 1000, cotizacion: 1200 })).ok, true);
  const s = await saldos();
  assert.deepEqual(s.dolares, { usd: 1000, cotizacion: 1200, valor: 1200000 });
  assert.equal(s.total, 50000 + 1200000);
  // La cotización es compartida: la Caja la ve, pero sus dólares son otros.
  const caja = await invocar('cuentas:resumen');
  assert.equal(caja.dolares.cotizacion, 1200);
  assert.equal(caja.dolares.usd, 0);
  assert.equal((await invocar('ingresos:guardarDolares', { dolares_usd: -1, cotizacion: 1 })).ok, false);
});

test('comprar dólares resta los pesos de la cuenta personal, suma los dólares y no toca la caja del negocio', async () => {
  await cajaConfigurada();
  await cargar('Mercado Pago', 300000);
  await invocar('ingresos:guardarDolares', { dolares_usd: 100, cotizacion: 1200 });
  const cajaAntes = (await invocar('cuentas:resumen')).total;
  const r = await invocar('ingresos:comprarDolares', { fecha: hoy(), cuenta: 'Mercado Pago', usd: 50, cotizacion: 1100 });
  assert.equal(r.ok, true);
  assert.equal(await personal('Mercado Pago'), 300000 - 55000);
  const s = await saldos();
  assert.equal(s.dolares.usd, 150);
  assert.equal(s.total, 245000 + 150 * 1200);
  assert.equal((await invocar('cuentas:resumen')).total, cajaAntes);
  assert.equal((await invocar('cuentas:resumen')).dolares.usd, 0);
  // Se ve en el historial de la cuenta con su saldo.
  const mov = (await invocar('ingresos:movimientos', 'Mercado Pago'))[0];
  assert.equal(mov.monto, -55000);
  assert.equal(mov.saldo, 245000);
  assert.match(mov.detalle, /Compra de U\$S 50/);
});

test('quitar una compra devuelve los pesos a la cuenta y saca esos dólares', async () => {
  await cargar('Efectivo personal', 100000);
  await invocar('ingresos:comprarDolares', { fecha: hoy(), cuenta: 'Efectivo personal', usd: 40, cotizacion: 1000 });
  assert.equal(await personal('Efectivo personal'), 60000);
  const compra = (await invocar('ingresos:comprasDolares'))[0];
  assert.equal(compra.monto, 40000);
  await invocar('ingresos:eliminarCompraDolares', compra.id);
  assert.equal(await personal('Efectivo personal'), 100000);
  assert.equal((await saldos()).dolares.usd, 0);
  assert.deepEqual(await invocar('ingresos:comprasDolares'), []);
});

test('comprar dólares valida la cuenta, la fecha, los dólares y la cotización', async () => {
  const comprar = (extra) => invocar('ingresos:comprarDolares', { fecha: hoy(), cuenta: 'Efectivo personal', usd: 10, cotizacion: 1000, ...extra });
  assert.equal((await comprar({ cuenta: 'Cuenta que no existe' })).ok, false);
  assert.equal((await comprar({ fecha: 'ayer' })).ok, false);
  assert.equal((await comprar({ usd: 0 })).ok, false);
  assert.equal((await comprar({ cotizacion: 0 })).ok, false);
  assert.deepEqual(await invocar('ingresos:comprasDolares'), []);
});
