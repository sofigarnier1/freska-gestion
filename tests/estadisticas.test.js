// Estadísticas: gastos por forma de pago y los gastos más grandes del período (solo negocio, sin "Particulares").
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, limpiarDatos } = require('./harness');

let db;
let invocar;
test.before(async () => {
  ({ db, invocar } = await iniciar());
});
test.beforeEach(() => {
  limpiarDatos(db);
});

const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.0051, `${msg || 'valor'}: ${a} ≠ ${b}`);

const categoria = async (nombre, ambito = 'negocio') => {
  await invocar('gastos:crearCategoria', { nombre, ambito });
  return db.prepare('SELECT id FROM categorias_gasto WHERE nombre = ?').get(nombre).id;
};

test('el resumen suma los gastos por forma de pago y lista los más grandes, sin los "Particulares"', async () => {
  const catFletes = await categoria('Fletes');
  const catAlquiler = await categoria('Alquiler');
  const catParticulares = await categoria('Particulares', 'personal');
  const hoy = fechaHoyISO();
  await invocar('gastos:crear', { fecha: hoy, categoria_id: catFletes, descripcion: 'Flete a Córdoba', monto: 5000, medio_pago: 'Efectivo' });
  await invocar('gastos:crear', { fecha: hoy, categoria_id: catFletes, descripcion: 'Flete corto', monto: 1000, medio_pago: 'Efectivo' });
  await invocar('gastos:crear', { fecha: hoy, categoria_id: catAlquiler, descripcion: 'Alquiler del local', monto: 20000, medio_pago: 'Transferencia' });
  await invocar('gastos:crear', { fecha: hoy, categoria_id: catParticulares, descripcion: 'Compra personal', monto: 99999, medio_pago: 'Efectivo' });

  const r = await invocar('estadisticas:resumen', { desde: hoy, hasta: hoy });
  assert.equal(r.ok, true);
  const efectivo = r.salidas.gastos.porMetodo.find((m) => m.metodo === 'Efectivo');
  cerca(efectivo.total, 6000, 'los dos fletes en efectivo, sin la compra personal');
  assert.equal(efectivo.cantidad, 2);
  const transferencia = r.salidas.gastos.porMetodo.find((m) => m.metodo === 'Transferencia');
  cerca(transferencia.total, 20000);
  assert.ok(!r.salidas.gastos.porMetodo.some((m) => m.total === 99999), 'lo de Particulares no entra en la forma de pago');

  assert.equal(r.salidas.gastos.top[0].descripcion, 'Alquiler del local', 'el más grande primero');
  cerca(r.salidas.gastos.top[0].monto, 20000);
  assert.ok(!r.salidas.gastos.top.some((g) => g.descripcion === 'Compra personal'), 'lo de Particulares no aparece entre los gastos más grandes');
});

function fechaHoyISO() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
}
