// Gastos: las descripciones sugeridas son de cada categoría. La misma ("Obra social") puede estar en una del
// negocio y en una personal a la vez, sin que cargarla en una la saque de la otra.
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

const categoria = async (nombre, ambito = 'negocio') => {
  await invocar('gastos:crearCategoria', { nombre, ambito });
  return db.prepare('SELECT id FROM categorias_gasto WHERE nombre = ?').get(nombre).id;
};

const sugeridas = async (nombre) =>
  (await invocar('gastos:descripciones')).filter((d) => d.nombre.toLowerCase() === nombre.toLowerCase());

test('la misma descripción queda en dos categorías, cada una con su último monto', async () => {
  const sueldos = await categoria('Sueldos prueba');
  const salud = await categoria('Salud prueba', 'personal');
  await invocar('gastos:crear', { fecha: '2026-09-01', categoria_id: sueldos, descripcion: 'Obra social', monto: 30000, medio_pago: 'Efectivo' });
  await invocar('gastos:crear', { fecha: '2026-09-02', categoria_id: salud, descripcion: 'obra social', monto: 12000, medio_pago: 'Efectivo' });

  const lista = await sugeridas('Obra social');
  assert.equal(lista.length, 2, 'una sugerencia por categoría, ninguna se movió');
  const deSueldos = lista.find((d) => d.categoria_id === sueldos);
  const deSalud = lista.find((d) => d.categoria_id === salud);
  assert.equal(deSueldos.ultimo_monto, 30000, 'el monto sugerido es el de su categoría');
  assert.equal(deSalud.ultimo_monto, 12000);
  assert.equal(deSueldos.categoria_nombre, 'Sueldos prueba');

  // Los gastos siguen cada uno en su categoría.
  const gastos = db.prepare("SELECT categoria_id FROM gastos WHERE lower(descripcion) = 'obra social' ORDER BY id").all();
  assert.deepEqual(gastos.map((g) => g.categoria_id), [sueldos, salud]);
});

test('agregar una descripción desde Categorías no la saca de otra categoría, y sacarla de una deja la otra', async () => {
  const a = await categoria('Cat A prueba');
  const b = await categoria('Cat B prueba', 'personal');
  assert.equal((await invocar('gastos:crearDescripcion', { nombre: 'Seguro', categoria_id: a })).ok, true);
  assert.equal((await invocar('gastos:crearDescripcion', { nombre: 'Seguro', categoria_id: b })).ok, true);
  // Repetirla en la misma categoría no la duplica.
  await invocar('gastos:crearDescripcion', { nombre: 'seguro', categoria_id: a });
  let lista = await sugeridas('Seguro');
  assert.equal(lista.length, 2);

  await invocar('gastos:quitarDescripcion', lista.find((d) => d.categoria_id === a).id);
  lista = await sugeridas('Seguro');
  assert.equal(lista.length, 1);
  assert.equal(lista[0].categoria_id, b);
});

test('editar un gasto y pasarlo a otra categoría no mueve la sugerencia de la anterior', async () => {
  const a = await categoria('Cat C prueba');
  const b = await categoria('Cat D prueba');
  const r = await invocar('gastos:crear', { fecha: '2026-09-03', categoria_id: a, descripcion: 'Luz', monto: 5000, medio_pago: 'Efectivo' });
  await invocar('gastos:actualizar', { id: r.id, fecha: '2026-09-03', categoria_id: b, descripcion: 'Luz', monto: 5000, medio_pago: 'Efectivo' });
  const cats = (await sugeridas('Luz')).map((d) => d.categoria_id).sort();
  assert.deepEqual(cats, [a, b].sort());
});

test('una categoría con el mismo nombre puede estar en Negocio y en Personal, y crear la segunda no mueve la primera', async () => {
  await invocar('gastos:crearCategoria', { nombre: 'Obra social', ambito: 'negocio' });
  const negocio = db.prepare("SELECT id FROM categorias_gasto WHERE nombre = 'Obra social' AND ambito = 'negocio'").get().id;
  await invocar('gastos:crear', { fecha: '2026-09-05', categoria_id: negocio, descripcion: 'Claudio', monto: 20000, medio_pago: 'Efectivo' });

  await invocar('gastos:crearCategoria', { nombre: 'obra social', ambito: 'personal' });
  const filas = db.prepare("SELECT id, ambito FROM categorias_gasto WHERE lower(nombre) = 'obra social' ORDER BY ambito").all();
  assert.deepEqual(filas.map((f) => f.ambito), ['negocio', 'personal'], 'quedan las dos');
  assert.equal(filas.find((f) => f.ambito === 'negocio').id, negocio, 'la del negocio no cambió');

  // El gasto de Claudio sigue contando como del negocio.
  const r = await invocar('estadisticas:resumen', { desde: '2026-09-05', hasta: '2026-09-05' });
  const cat = r.salidas.gastos.porCategoria.find((c) => c.categoria.toLowerCase() === 'obra social');
  assert.equal(cat.ambito, 'negocio');

  // Repetirla en el mismo grupo no la duplica (la reactiva si estaba quitada).
  await invocar('gastos:quitarCategoria', negocio);
  await invocar('gastos:crearCategoria', { nombre: 'Obra social', ambito: 'negocio' });
  const deNegocio = db.prepare("SELECT id, activo FROM categorias_gasto WHERE lower(nombre) = 'obra social' AND ambito = 'negocio'").all();
  assert.equal(deNegocio.length, 1);
  assert.equal(deNegocio[0].activo, 1);
});
