// Tests del Resultado de Fondos personales: por categoría (cada propiedad es una), lo que entró (neto de la retención del
// banco) menos lo que se gastó, en un período. Solo salen las categorías con movimientos.
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
  db.prepare("DELETE FROM metodos_pago WHERE nombre IN ('MercadoPago', 'Personal Pay')").run();
  ['Efectivo', 'Mercado Pago', 'Cheque'].forEach((m) => asegurarMetodo(db, m));
});

const categoria = async (nombre) => {
  await invocar('ingresos:crearCategoria', nombre);
  return db.prepare("SELECT id FROM categorias_gasto WHERE nombre = ? AND ambito = 'personal' AND de_fondos = 1").get(nombre).id;
};
const ingreso = (fecha, monto, categoria_id, extra = {}) =>
  invocar('ingresos:crear', { fecha, categoria_id, descripcion: 'Alquiler', monto, cuenta: 'Efectivo personal', ...extra });
const gasto = (fecha, monto, categoria_id) =>
  invocar('ingresos:crearRetiro', { fecha, categoria_id, descripcion: 'Plomero', monto, cuenta: 'Efectivo personal' });
const resultado = (desde = '2026-01-01', hasta = '2026-12-31') => invocar('ingresos:resultado', { desde, hasta });

test('cuánto le deja cada categoría: entró (neto de retención) menos gastó, con el total', async () => {
  db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('retencion_transferencia', '1')").run();
  const casa = await categoria('Casa Norte');
  const dpto = await categoria('Dpto Moreno');
  const pension = await categoria('Pensión');
  assert.equal((await ingreso('2026-03-05', 100000, casa)).ok, true);
  assert.equal((await ingreso('2026-03-06', 50000, casa, { cuenta: 'Mercado Pago', con_retencion: true })).ok, true); // retiene 1 % = 500
  assert.equal((await gasto('2026-03-10', 30000, casa)).ok, true);
  assert.equal((await ingreso('2026-03-07', 80000, dpto)).ok, true);
  assert.equal((await ingreso('2026-03-08', 20000, pension)).ok, true);
  assert.equal((await gasto('2026-03-12', 5000, pension)).ok, true);
  const r = await resultado();
  const fila = (n) => r.filas.find((f) => f.nombre === n);
  assert.deepEqual([fila('Casa Norte').entro, fila('Casa Norte').gasto, fila('Casa Norte').deja], [149500, 30000, 119500]);
  assert.deepEqual([fila('Dpto Moreno').entro, fila('Dpto Moreno').gasto, fila('Dpto Moreno').deja], [80000, 0, 80000]);
  assert.deepEqual([fila('Pensión').entro, fila('Pensión').gasto, fila('Pensión').deja], [20000, 5000, 15000]);
  assert.equal(r.filas.length, 3);
  assert.deepEqual(r.total, { entro: 249500, gasto: 35000, deja: 214500 });
});

test('respeta el rango de fechas y no muestra las categorías sin movimientos en el período', async () => {
  const casa = await categoria('Casa Norte');
  await categoria('Campo');
  await ingreso('2026-02-01', 1000, casa);
  await ingreso('2026-05-01', 7000, casa);
  const r = await resultado('2026-05-01', '2026-05-31');
  assert.deepEqual(r.filas.map((f) => [f.nombre, f.entro]), [['Casa Norte', 7000]]);
  assert.deepEqual((await resultado('2026-06-01', '2026-06-30')).filas, []);
});

test('una categoría quitada sigue contando en lo que ya tenía cargado', async () => {
  const casa = await categoria('Casa Norte');
  await ingreso('2026-04-01', 3000, casa);
  await gasto('2026-04-02', 500, casa);
  await invocar('ingresos:quitarCategoria', casa);
  assert.deepEqual((await resultado()).filas.map((f) => [f.nombre, f.entro, f.gasto, f.deja]), [['Casa Norte', 3000, 500, 2500]]);
});

test('el detalle de una fila trae los ingresos (netos de retención) y los retiros de esa categoría, del más nuevo al más viejo', async () => {
  db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('retencion_transferencia', '1')").run();
  const casa = await categoria('Casa Norte');
  const otra = await categoria('Campo');
  await ingreso('2026-03-05', 100000, casa);
  await ingreso('2026-03-06', 50000, casa, { cuenta: 'Mercado Pago', con_retencion: true });
  await gasto('2026-03-10', 30000, casa);
  await ingreso('2026-03-07', 999, otra);
  await ingreso('2027-01-01', 7, casa); // fuera del período
  const movs = await invocar('ingresos:resultadoDetalle', { categoria_id: casa, desde: '2026-01-01', hasta: '2026-12-31' });
  assert.deepEqual(movs.map((m) => [m.fecha, m.tipo, m.monto]), [['2026-03-10', 'retiro', -30000], ['2026-03-06', 'ingreso', 49500], ['2026-03-05', 'ingreso', 100000]]);
  assert.equal(movs[1].retencion, 500);
  // Lo que suman coincide con la fila del resultado.
  const fila = (await resultado()).filas.find((f) => f.nombre === 'Casa Norte');
  assert.equal(movs.reduce((a, m) => a + m.monto, 0), fila.deja);
});

test('en Estadísticas, los ingresos personales se agrupan por categoría, igual que las salidas', async () => {
  const casa = await categoria('Casa Norte');
  await ingreso('2026-03-05', 100000, casa); // descripción "Alquiler"
  await invocar('ingresos:crear', { fecha: '2026-03-06', categoria_id: casa, descripcion: 'Gabriela', monto: 20000, cuenta: 'Efectivo personal' });
  await gasto('2026-03-10', 30000, casa);
  // Un ingreso viejo, sin categoría, se agrupa por su descripción.
  db.prepare("INSERT INTO ingresos (fecha, descripcion, monto, cuenta) VALUES ('2026-03-07', 'Viejo', 500, NULL)").run();
  const r = await invocar('estadisticas:resumen', { desde: '2026-03-01', hasta: '2026-03-31' });
  const origenes = r.personal.ingresos.porOrigen.map((o) => [o.origen, o.total, o.cantidad]);
  assert.deepEqual(origenes, [['Casa Norte', 120000, 2], ['Viejo', 500, 1]]);
  assert.equal(r.salidas.gastos.porCategoria.find((c) => c.categoria === 'Casa Norte').total, 30000, 'la salida está bajo la misma categoría');
});

test('lo que se sacó para vivir son los gastos de Gastos con categoría personal, sin los gastos de propiedades ni los del negocio', async () => {
  await invocar('gastos:crearCategoria', { nombre: 'Supermercado', ambito: 'personal' });
  await invocar('gastos:crearCategoria', { nombre: 'Sueldos de prueba', ambito: 'negocio' });
  const cat = (nombre) => db.prepare('SELECT id FROM categorias_gasto WHERE nombre = ? AND de_fondos = 0').get(nombre).id;
  const gastoDe = (categoria_id, monto, fecha) => invocar('gastos:crear', { fecha, categoria_id, descripcion: 'x', monto, medio_pago: 'Efectivo', observacion: '', tarjeta: '' });
  assert.equal((await gastoDe(cat('Supermercado'), 4000, '2026-03-05')).ok, true);
  assert.equal((await gastoDe(cat('Sueldos de prueba'), 9000, '2026-03-06')).ok, true);
  assert.equal((await gastoDe(cat('Supermercado'), 700, '2026-02-10')).ok, true); // período anterior
  const casa = await categoria('Casa Norte');
  await gasto('2026-03-10', 30000, casa); // gasto de propiedades: sale de Fondos personales
  const r = await invocar('estadisticas:resumen', { desde: '2026-03-01', hasta: '2026-03-31' });
  assert.equal(r.salidas.gastos.paraVivir, 4000);
  assert.equal(r.anterior.paraVivir, 700);
  // Los gastos de propiedades siguen contando como gasto personal en Estadísticas, pero no son "para vivir".
  assert.equal(r.salidas.gastos.porCategoria.filter((c) => c.ambito === 'personal').reduce((a, c) => a + c.total, 0), 34000);
});
