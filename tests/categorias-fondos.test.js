// Tests de las listas de categorías separadas: Gastos → Personal y Fondos personales ya no comparten la lista. Cada una tiene
// la suya (`de_fondos`), una migración reparte las que ya existían sin perder nada, y un mismo nombre puede estar en las dos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, limpiarDatos, asegurarMetodo } = require('./harness');
const { separarCategoriasDeFondos } = require('../src/db/categorias-fondos');

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

const hoy = () => db.prepare("SELECT date('now', 'localtime') AS d").get().d;
const nombres = (lista) => lista.map((c) => c.nombre).sort();

test('cada pantalla ofrece solo su lista: Gastos no ve las de Fondos personales y al revés', async () => {
  await invocar('ingresos:crearCategoria', 'Casa Norte');
  await invocar('gastos:crearCategoria', { nombre: 'Supermercado', ambito: 'personal' });
  assert.ok((await invocar('ingresos:categorias')).some((c) => c.nombre === 'Casa Norte'));
  assert.ok(!(await invocar('ingresos:categorias')).some((c) => c.nombre === 'Supermercado'));
  assert.ok((await invocar('gastos:categorias')).some((c) => c.nombre === 'Supermercado'));
  assert.ok(!(await invocar('gastos:categorias')).some((c) => c.nombre === 'Casa Norte'));
});

test('un mismo nombre puede estar en las dos listas sin pisarse, y quitar una no toca la otra', async () => {
  await invocar('ingresos:crearCategoria', 'Alquiler Santi');
  await invocar('gastos:crearCategoria', { nombre: 'Alquiler Santi', ambito: 'personal' });
  const filas = db.prepare("SELECT id, de_fondos FROM categorias_gasto WHERE nombre = 'Alquiler Santi' ORDER BY de_fondos").all();
  assert.equal(filas.length, 2);
  await invocar('ingresos:quitarCategoria', filas[1].id);
  assert.ok(!(await invocar('ingresos:categorias')).some((c) => c.nombre === 'Alquiler Santi'));
  assert.ok((await invocar('gastos:categorias')).some((c) => c.nombre === 'Alquiler Santi'));
  // Crearla de nuevo en Fondos la reactiva en vez de repetirla.
  await invocar('ingresos:crearCategoria', 'Alquiler Santi');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM categorias_gasto WHERE nombre = 'Alquiler Santi'").get().n, 2);
});

test('un ingreso o un gasto de propiedades solo acepta categorías de Fondos personales, y un gasto del negocio no', async () => {
  await invocar('ingresos:crearCategoria', 'Casa Norte');
  await invocar('gastos:crearCategoria', { nombre: 'Nafta', ambito: 'personal' });
  const fondos = db.prepare("SELECT id FROM categorias_gasto WHERE nombre = 'Casa Norte'").get().id;
  const gastos = db.prepare("SELECT id FROM categorias_gasto WHERE nombre = 'Nafta'").get().id;
  const ing = (categoria_id) => invocar('ingresos:crear', { fecha: hoy(), categoria_id, descripcion: 'Alquiler', monto: 100, cuenta: 'Efectivo personal' });
  const ret = (categoria_id) => invocar('ingresos:crearRetiro', { fecha: hoy(), categoria_id, descripcion: 'Plomero', monto: 10, cuenta: 'Efectivo personal' });
  assert.equal((await ing(fondos)).ok, true);
  assert.equal((await ret(fondos)).ok, true);
  assert.equal((await ing(gastos)).ok, false);
  assert.equal((await ret(gastos)).ok, false);
});

test('cambiar el grupo de una categoría de Gastos mira solo la lista de Gastos', async () => {
  await invocar('ingresos:crearCategoria', 'Obra social');
  await invocar('gastos:crearCategoria', { nombre: 'Obra social', ambito: 'negocio' });
  const deGastos = db.prepare("SELECT id FROM categorias_gasto WHERE nombre = 'Obra social' AND ambito = 'negocio' AND de_fondos = 0").get().id;
  // Pasarla a Personal no choca con la "Obra social" de Fondos personales.
  assert.equal((await invocar('gastos:cambiarAmbitoCategoria', { id: deGastos, ambito: 'personal' })).ok, true);
});

// Deja la base como estaba antes de separar las listas y corre la migración.
const separar = () => {
  db.prepare("DELETE FROM configuracion WHERE clave = 'categorias_fondos_separadas'").run();
  db.prepare('UPDATE categorias_gasto SET de_fondos = 0').run();
  separarCategoriasDeFondos(db);
};
const cat = (nombre, de_fondos) => db.prepare('SELECT id, de_fondos FROM categorias_gasto WHERE nombre = ? AND ambito = ? AND de_fondos = ?').get(nombre, 'personal', de_fondos);

test('la migración reparte las categorías según para qué se usaron, sin perder ningún movimiento', async () => {
  db.pragma('foreign_keys = OFF');
  db.prepare("DELETE FROM descripciones_gasto WHERE categoria_id IN (SELECT id FROM categorias_gasto WHERE ambito = 'personal')").run();
  db.prepare("DELETE FROM descripciones_ingreso").run();
  db.prepare("DELETE FROM categorias_gasto WHERE ambito = 'personal'").run();
  db.pragma('foreign_keys = ON');
  const nueva = (nombre) => Number(db.prepare("INSERT INTO categorias_gasto (nombre, ambito) VALUES (?, 'personal')").run(nombre).lastInsertRowid);
  const soloFondos = nueva('Casa Norte');
  const soloGastos = nueva('Supermercado');
  const ambas = nueva('Alquiler Santi');
  const sinUso = nueva('Moto');
  const deIngreso = nueva('Otros'); // está en `categorias_ingreso` (de las de ingreso de siempre)
  db.prepare("INSERT OR IGNORE INTO categorias_ingreso (nombre) VALUES ('Otros')").run();
  const negocioId = db.prepare("SELECT id FROM categorias_gasto WHERE ambito = 'negocio' LIMIT 1").get().id;
  db.prepare("INSERT INTO ingresos (fecha, categoria_id, descripcion, monto, cuenta, fondo_personal) VALUES (?, ?, 'Gabriela', 100, 'Efectivo personal', 1)").run(hoy(), soloFondos);
  db.prepare("INSERT INTO ingresos (fecha, categoria_id, descripcion, monto, cuenta, fondo_personal) VALUES (?, ?, 'Santi', 50, 'Efectivo personal', 1)").run(hoy(), ambas);
  db.prepare("INSERT INTO retiros_personales (fecha, categoria_id, descripcion, monto, cuenta) VALUES (?, ?, 'Plomero', 10, 'Efectivo personal')").run(hoy(), ambas);
  db.prepare("INSERT INTO descripciones_ingreso (nombre, categoria_id) VALUES ('Santi', ?)").run(ambas);
  db.prepare("INSERT INTO gastos (fecha, categoria_id, descripcion, monto, medio_pago) VALUES (?, ?, 'Compras', 20, 'Efectivo')").run(hoy(), soloGastos);
  db.prepare("INSERT INTO gastos (fecha, categoria_id, descripcion, monto, medio_pago) VALUES (?, ?, 'Alquiler', 30, 'Efectivo')").run(hoy(), ambas);
  db.prepare("INSERT INTO descripciones_gasto (nombre, categoria_id) VALUES ('Alquiler', ?)").run(ambas);
  const cantidades = () => ({ ing: db.prepare('SELECT COUNT(*) n FROM ingresos').get().n, ret: db.prepare('SELECT COUNT(*) n FROM retiros_personales').get().n, gas: db.prepare('SELECT COUNT(*) n FROM gastos').get().n });
  const antes = cantidades();

  separar();

  assert.equal(cat('Casa Norte', 1).id, soloFondos, 'solo ingresos → Fondos personales, con el mismo id');
  assert.equal(cat('Supermercado', 0).id, soloGastos, 'solo gastos → se queda en Gastos');
  assert.equal(cat('Supermercado', 1), undefined);
  assert.equal(cat('Moto', 0).id, sinUso, 'sin uso y no de ingreso → Gastos');
  assert.equal(cat('Otros', 1).id, deIngreso, 'sin uso pero de las de ingreso de siempre → Fondos personales');
  // Usada por los dos: queda una en cada lista y los ingresos y gastos de propiedades pasan a la de Fondos.
  const enGastos = cat('Alquiler Santi', 0);
  const enFondos = cat('Alquiler Santi', 1);
  assert.equal(enGastos.id, ambas);
  assert.notEqual(enFondos.id, ambas);
  assert.equal(db.prepare('SELECT categoria_id FROM ingresos WHERE descripcion = ?').get('Santi').categoria_id, enFondos.id);
  assert.equal(db.prepare('SELECT categoria_id FROM retiros_personales WHERE descripcion = ?').get('Plomero').categoria_id, enFondos.id);
  assert.equal(db.prepare('SELECT categoria_id FROM descripciones_ingreso WHERE nombre = ?').get('Santi').categoria_id, enFondos.id);
  assert.equal(db.prepare('SELECT categoria_id FROM gastos WHERE descripcion = ?').get('Alquiler').categoria_id, ambas, 'el gasto sigue en la de Gastos');
  assert.equal(db.prepare('SELECT categoria_id FROM descripciones_gasto WHERE nombre = ?').get('Alquiler').categoria_id, ambas);
  // Las de negocio no se tocan, nada se perdió y la base sigue sana.
  assert.equal(db.prepare('SELECT de_fondos FROM categorias_gasto WHERE id = ?').get(negocioId).de_fondos, 0);
  assert.deepEqual(cantidades(), antes);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  // Y corre una sola vez.
  const deFondos = () => db.prepare('SELECT COUNT(*) n FROM categorias_gasto WHERE de_fondos = 1').get().n;
  const antesDeVolver = deFondos();
  separarCategoriasDeFondos(db);
  assert.equal(deFondos(), antesDeVolver, 'no vuelve a correr');
  // Estadísticas sigue viendo las dos listas como personales.
  const r = await invocar('estadisticas:resumen', { desde: hoy(), hasta: hoy() });
  assert.equal(r.salidas.gastos.porCategoria.filter((c) => c.ambito === 'personal').reduce((a, c) => a + c.total, 0), 20 + 30 + 10);
});

test('la migración también convierte una base vieja: recrea la tabla sin perder ids', async () => {
  // Una `categorias_gasto` como la de antes (nombre + ámbito únicos, sin `de_fondos`) con un gasto y un ingreso apuntándole.
  db.pragma('foreign_keys = OFF');
  db.exec('DELETE FROM descripciones_gasto; DELETE FROM descripciones_ingreso;');
  const viejas = db.prepare("SELECT id, nombre, activo, ambito FROM categorias_gasto WHERE de_fondos = 0").all();
  db.exec(`CREATE TABLE categorias_gasto_vieja (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL COLLATE NOCASE, activo INTEGER NOT NULL DEFAULT 1, ambito TEXT NOT NULL DEFAULT 'negocio' CHECK (ambito IN ('negocio', 'personal')), UNIQUE (nombre, ambito));`);
  const ins = db.prepare('INSERT INTO categorias_gasto_vieja (id, nombre, activo, ambito) VALUES (?, ?, ?, ?)');
  viejas.forEach((c) => ins.run(c.id, c.nombre, c.activo, c.ambito));
  db.exec('DROP TABLE categorias_gasto; ALTER TABLE categorias_gasto_vieja RENAME TO categorias_gasto;');
  db.pragma('foreign_keys = ON');
  const alquiler = Number(db.prepare("INSERT INTO categorias_gasto (nombre, ambito) VALUES ('Alquiler Casa', 'personal')").run().lastInsertRowid);
  db.prepare("INSERT INTO ingresos (fecha, categoria_id, descripcion, monto, cuenta, fondo_personal) VALUES (?, ?, 'Inquilino', 100, 'Efectivo personal', 1)").run(hoy(), alquiler);
  db.prepare("DELETE FROM configuracion WHERE clave = 'categorias_fondos_separadas'").run();

  separarCategoriasDeFondos(db);

  assert.ok(db.prepare('PRAGMA table_info(categorias_gasto)').all().some((c) => c.name === 'de_fondos'));
  assert.equal(cat('Alquiler Casa', 1).id, alquiler);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM categorias_gasto').get().n, viejas.length + 1, 'no se perdió ni se repitió ninguna');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  // Después de convertida, las dos listas andan.
  assert.equal((await invocar('ingresos:crearCategoria', 'Casa Norte')).ok, true);
  assert.equal((await invocar('gastos:crearCategoria', { nombre: 'Casa Norte', ambito: 'personal' })).ok, true);
});
