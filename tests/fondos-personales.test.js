// Tests de Fondos personales: la plata personal comparte las cuentas del negocio pero se lleva aparte (ingresos, retiros,
// pases con el negocio, efectivo personal) y nunca ensucia la caja ni el cierre del día.
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
  require('../src/db/descripciones-ingreso').unicasPorCategoria(db); // el test de la migración deja el esquema viejo
  if (!db.prepare('PRAGMA table_info(ingresos)').all().some((c) => c.name === 'retiro_id')) db.exec('ALTER TABLE ingresos ADD COLUMN retiro_id INTEGER');
  db.prepare('DELETE FROM operaciones_caja').run();
  db.prepare('DELETE FROM cierres_caja').run();
  // La semilla trae "MercadoPago": sería la misma cuenta que "Mercado Pago" y la Caja se quedaría con la primera.
  db.prepare("DELETE FROM metodos_pago WHERE nombre IN ('MercadoPago', 'Personal Pay')").run();
  ['Efectivo', 'Mercado Pago', 'Cheque'].forEach((m) => asegurarMetodo(db, m));
});

const hoy = () => db.prepare("SELECT date('now', 'localtime') AS d").get().d;
const categoriaIngreso = () => db.prepare("SELECT id FROM categorias_gasto WHERE ambito = 'personal' AND de_fondos = 1 AND activo = 1 ORDER BY id LIMIT 1").get().id;
// Una categoría de la lista de Gastos → Personal.
const categoriaPersonal = async (nombre = 'Moto') => {
  await invocar('gastos:crearCategoria', { nombre, ambito: 'personal' });
  return db.prepare("SELECT id FROM categorias_gasto WHERE nombre = ? AND ambito = 'personal' AND de_fondos = 0").get(nombre).id;
};
// Una categoría de la lista de Fondos personales (ingresos y gastos de propiedades).
const categoriaFondos = async (nombre = 'Moto') => {
  await invocar('ingresos:crearCategoria', nombre);
  return db.prepare("SELECT id FROM categorias_gasto WHERE nombre = ? AND ambito = 'personal' AND de_fondos = 1").get(nombre).id;
};
const cajaConfigurada = async (efectivo = 0, mp = 0) => {
  const r = await invocar('cuentas:guardarSaldos', { desde: hoy(), saldos: { Efectivo: efectivo, 'Mercado Pago': mp } });
  assert.equal(r.ok, true);
};
const negocio = async (nombre) => (await invocar('cuentas:resumen')).cuentas.find((c) => c.nombre === nombre).saldo;
const personal = async (nombre) => (await invocar('ingresos:saldos')).cuentas.find((c) => c.nombre === nombre).saldo;
const ingreso = (cuenta, monto) =>
  invocar('ingresos:crear', { fecha: hoy(), categoria_id: categoriaIngreso(), descripcion: 'Gabriela', monto, cuenta });

test('un ingreso nuevo suma a la parte personal de la cuenta y no a la caja del negocio', async () => {
  await cajaConfigurada(0, 100000);
  assert.equal((await ingreso('Mercado Pago', 40000)).ok, true);
  assert.equal(await negocio('Mercado Pago'), 100000);
  assert.equal(await personal('Mercado Pago'), 40000);
});

test('un ingreso nuevo sin cuenta, o con una cuenta que no existe, se rechaza', async () => {
  assert.equal((await ingreso('', 1000)).ok, false);
  assert.equal((await ingreso('Banco inventado', 1000)).ok, false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ingresos').get().n, 0);
});

test('el efectivo personal es aparte: no toca el cajón ni el cierre del día', async () => {
  await cajaConfigurada(50000, 0);
  await invocar('caja:guardarCierre', { fecha: hoy(), fondo_inicial: 50000, efectivo_contado: null });
  assert.equal((await ingreso('Efectivo personal', 30000)).ok, true);
  assert.equal(await personal('Efectivo personal'), 30000);
  assert.equal(await negocio('Efectivo'), 50000);
  const dia = await invocar('caja:obtenerDia', hoy());
  assert.equal(dia.ingresosDelDia, 0);
  assert.equal(dia.otrosEfectivo, 0);
});

test('un retiro resta de la cuenta personal y no mueve la caja del negocio', async () => {
  await cajaConfigurada(0, 100000);
  await ingreso('Mercado Pago', 40000);
  const cat = await categoriaFondos();
  const r = await invocar('ingresos:crearRetiro', { fecha: hoy(), categoria_id: cat, descripcion: 'Service de la moto', monto: 15000, cuenta: 'Mercado Pago' });
  assert.equal(r.ok, true);
  assert.equal(await personal('Mercado Pago'), 25000);
  assert.equal(await negocio('Mercado Pago'), 100000);
});

test('un retiro pide categoría personal, descripción, monto y cuenta válidos', async () => {
  const cat = await categoriaFondos();
  const base = { fecha: hoy(), categoria_id: cat, descripcion: 'Arreglo', monto: 1000, cuenta: 'Efectivo personal' };
  assert.equal((await invocar('ingresos:crearRetiro', { ...base, categoria_id: null })).ok, false);
  assert.equal((await invocar('ingresos:crearRetiro', { ...base, descripcion: ' ' })).ok, false);
  assert.equal((await invocar('ingresos:crearRetiro', { ...base, monto: 0 })).ok, false);
  assert.equal((await invocar('ingresos:crearRetiro', { ...base, cuenta: 'Efectivo' })).ok, false, 'el cajón del negocio no es una cuenta personal');
  // una categoría del negocio no vale
  await invocar('gastos:crearCategoria', { nombre: 'Sueldos', ambito: 'negocio' });
  const negocioId = db.prepare("SELECT id FROM categorias_gasto WHERE nombre = 'Sueldos' AND ambito = 'negocio'").get().id;
  assert.equal((await invocar('ingresos:crearRetiro', { ...base, categoria_id: negocioId })).ok, false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM retiros_personales').get().n, 0);
});

test('pasar plata a personal resta de la parte del negocio y suma a la personal; pasarla de vuelta lo deshace', async () => {
  await cajaConfigurada(0, 100000);
  const pase = { fecha: hoy(), monto: 30000, sentido: 'a_personal', cuenta_negocio: 'Mercado Pago', cuenta_personal: 'Mercado Pago' };
  assert.equal((await invocar('ingresos:crearPase', pase)).ok, true);
  assert.equal(await negocio('Mercado Pago'), 70000);
  assert.equal(await personal('Mercado Pago'), 30000);
  const total = (await negocio('Mercado Pago')) + (await personal('Mercado Pago'));
  assert.equal(total, 100000, 'la plata real en la cuenta no cambia');
  assert.equal((await invocar('ingresos:crearPase', { ...pase, sentido: 'al_negocio', monto: 10000 })).ok, true);
  assert.equal(await negocio('Mercado Pago'), 80000);
  assert.equal(await personal('Mercado Pago'), 20000);
});

test('un pase desde el efectivo del negocio al efectivo personal saca la plata del cajón del día', async () => {
  await cajaConfigurada(50000, 0);
  await invocar('caja:guardarCierre', { fecha: hoy(), fondo_inicial: 50000, efectivo_contado: null });
  const r = await invocar('ingresos:crearPase', { fecha: hoy(), monto: 20000, sentido: 'a_personal', cuenta_negocio: 'Efectivo', cuenta_personal: 'Efectivo personal' });
  assert.equal(r.ok, true);
  assert.equal(await negocio('Efectivo'), 30000);
  assert.equal(await personal('Efectivo personal'), 20000);
  assert.equal((await invocar('caja:obtenerDia', hoy())).otrosEfectivo, -20000);
});

test('un pase rechaza sentido, monto o cuentas inválidos', async () => {
  const base = { fecha: hoy(), monto: 100, sentido: 'a_personal', cuenta_negocio: 'Mercado Pago', cuenta_personal: 'Efectivo personal' };
  assert.equal((await invocar('ingresos:crearPase', { ...base, sentido: 'otro' })).ok, false);
  assert.equal((await invocar('ingresos:crearPase', { ...base, monto: -5 })).ok, false);
  assert.equal((await invocar('ingresos:crearPase', { ...base, cuenta_negocio: 'Nada' })).ok, false);
  assert.equal((await invocar('ingresos:crearPase', { ...base, cuenta_personal: 'Efectivo' })).ok, false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM pases_personales').get().n, 0);
});

test('ajustar el saldo personal lo deja en el valor pedido', async () => {
  await ingreso('Efectivo personal', 10000);
  assert.equal((await invocar('ingresos:ajustarSaldo', { cuenta: 'Efectivo personal', saldo: 85000 })).ok, true);
  assert.equal(await personal('Efectivo personal'), 85000);
  await invocar('ingresos:ajustarSaldo', { cuenta: 'Efectivo personal', saldo: 5000 });
  assert.equal(await personal('Efectivo personal'), 5000);
  assert.equal((await invocar('ingresos:ajustarSaldo', { cuenta: 'Efectivo', saldo: 1 })).ok, false);
});

test('quitar un retiro o un pase devuelve los saldos a como estaban', async () => {
  await cajaConfigurada(0, 100000);
  await ingreso('Mercado Pago', 40000);
  const cat = await categoriaFondos();
  await invocar('ingresos:crearRetiro', { fecha: hoy(), categoria_id: cat, descripcion: 'Moto', monto: 5000, cuenta: 'Mercado Pago' });
  await invocar('ingresos:crearPase', { fecha: hoy(), monto: 10000, sentido: 'a_personal', cuenta_negocio: 'Mercado Pago', cuenta_personal: 'Mercado Pago' });
  await invocar('ingresos:eliminarRetiro', (await invocar('ingresos:retiros'))[0].id);
  await invocar('ingresos:eliminarPase', (await invocar('ingresos:pases'))[0].id);
  assert.equal(await personal('Mercado Pago'), 40000);
  assert.equal(await negocio('Mercado Pago'), 100000);
});

test('un ingreso viejo que ya sumaba a la caja sigue sumando, y no entra al saldo personal', async () => {
  await cajaConfigurada(0, 100000);
  db.prepare("INSERT INTO ingresos (fecha, descripcion, monto, cuenta) VALUES (?, 'Viejo', 7000, 'Mercado Pago')").run(hoy());
  assert.equal(await negocio('Mercado Pago'), 107000);
  assert.equal(await personal('Mercado Pago'), 0);
});

test('en Estadísticas, un retiro cuenta como salida personal y no del negocio', async () => {
  const cat = await categoriaFondos();
  await invocar('ingresos:crearRetiro', { fecha: hoy(), categoria_id: cat, descripcion: 'Moto', monto: 12000, cuenta: 'Efectivo personal' });
  const r = await invocar('estadisticas:resumen', { desde: hoy(), hasta: hoy() });
  const personales = r.salidas.gastos.porCategoria.filter((c) => c.ambito === 'personal').reduce((a, c) => a + c.total, 0);
  assert.equal(personales, 12000);
  assert.equal(r.salidas.gastos.porCategoria.filter((c) => c.ambito === 'negocio').length, 0);
});

const tasa = (n) => db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('retencion_transferencia', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor").run(String(n));
const ingresoConRetencion = (cuenta, monto, con_retencion) =>
  invocar('ingresos:crear', { fecha: hoy(), categoria_id: categoriaIngreso(), descripcion: 'Gabriela', monto, cuenta, con_retencion });

test('un ingreso por transferencia a un banco descuenta la retención del saldo personal, sin crear un gasto del negocio', async () => {
  tasa(1.2);
  assert.equal((await ingresoConRetencion('Mercado Pago', 100000, true)).ok, true);
  assert.equal(db.prepare('SELECT retencion FROM ingresos').get().retencion, 1200);
  assert.equal(await personal('Mercado Pago'), 98800);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM gastos').get().n, 0, 'la retención no es un gasto del negocio');
});

test('sin retención, o en efectivo personal, el ingreso entra completo', async () => {
  tasa(1.2);
  await ingresoConRetencion('Mercado Pago', 100000, false);
  assert.equal(await personal('Mercado Pago'), 100000);
  await ingresoConRetencion('Efectivo personal', 50000, true);
  assert.equal(await personal('Efectivo personal'), 50000);
  const filas = db.prepare('SELECT retencion FROM ingresos').all();
  assert.deepEqual(filas.map((f) => f.retencion), [0, 0]);
});

test('con la retención en cero no se descuenta nada', async () => {
  assert.equal((await ingresoConRetencion('Mercado Pago', 100000, true)).ok, true);
  assert.equal(await personal('Mercado Pago'), 100000);
});

test('en Estadísticas, el ingreso personal cuenta neto de retención', async () => {
  tasa(2);
  await ingresoConRetencion('Mercado Pago', 100000, true);
  const r = await invocar('estadisticas:resumen', { desde: hoy(), hasta: hoy() });
  assert.equal(r.personal.ingresos.total, 98000);
});

test('ingresos:saldos informa la tasa de retención vigente', async () => {
  tasa(1.5);
  assert.equal((await invocar('ingresos:saldos')).retencion, 1.5);
});

test('los gastos personales que la 0.9.0 había pasado a Retiros vuelven a Gastos sin cambiar la caja ni lo personal', async () => {
  const { devolverGastosPersonalesAGastos, NOTA_PASE_GASTO_PERSONAL } = require('../src/db/gastos-personales');
  await cajaConfigurada(50000, 100000);
  const cat = await categoriaPersonal('Alquiler Santi');
  const catF = await categoriaFondos('Alquiler Santi');
  // Así los dejaba la 0.9.0: un pase del negocio a lo personal más el retiro (el gasto se había borrado).
  const dejarComoLaVersionVieja = (descripcion, monto, cuentaNegocio, cuentaPersonal) => {
    db.prepare("INSERT INTO pases_personales (fecha, monto, sentido, cuenta_negocio, cuenta_personal, nota) VALUES (?, ?, 'a_personal', ?, ?, ?)").run(hoy(), monto, cuentaNegocio, cuentaPersonal, NOTA_PASE_GASTO_PERSONAL);
    db.prepare('INSERT INTO retiros_personales (fecha, categoria_id, descripcion, monto, cuenta, observacion) VALUES (?, ?, ?, ?, ?, ?)').run(hoy(), cat, descripcion, monto, cuentaPersonal, 'nota');
  };
  dejarComoLaVersionVieja('Expensas', 20000, 'Mercado Pago', 'Mercado Pago');
  dejarComoLaVersionVieja('Super', 5000, 'Efectivo', 'Efectivo personal');
  // Un retiro que se cargó después, de verdad en Fondos personales, no se toca.
  assert.equal((await invocar('ingresos:crearRetiro', { fecha: hoy(), categoria_id: catF, descripcion: 'Termotanque', monto: 3000, cuenta: 'Efectivo personal' })).ok, true);
  const antes = { mp: await negocio('Mercado Pago'), ef: await negocio('Efectivo'), pmp: await personal('Mercado Pago'), pef: await personal('Efectivo personal') };

  db.prepare("DELETE FROM configuracion WHERE clave = 'gastos_personales_devueltos'").run();
  devolverGastosPersonalesAGastos(db);
  assert.equal(await negocio('Mercado Pago'), antes.mp, 'la caja no cambia');
  assert.equal(await negocio('Efectivo'), antes.ef, 'el efectivo no cambia');
  assert.equal(await personal('Mercado Pago'), antes.pmp, 'lo personal no cambia');
  assert.equal(await personal('Efectivo personal'), antes.pef, 'lo personal no cambia (el pase y el retiro del Super se anulaban entre sí; el Termotanque sigue)');
  const gastos = db.prepare('SELECT descripcion, monto, medio_pago, cuenta, observacion FROM gastos ORDER BY id').all();
  assert.deepEqual(gastos, [
    { descripcion: 'Expensas', monto: 20000, medio_pago: 'Transferencia', cuenta: 'Mercado Pago', observacion: 'nota' },
    { descripcion: 'Super', monto: 5000, medio_pago: 'Efectivo', cuenta: null, observacion: 'nota' },
  ]);
  assert.deepEqual((await invocar('ingresos:retiros')).map((r) => r.descripcion), ['Termotanque']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM pases_personales').get().n, 0);
  const lista = await invocar('gastos:listar', {});
  assert.ok(lista.every((g) => g.categoria_ambito === 'personal'), 'siguen marcados como personales');
  devolverGastosPersonalesAGastos(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM gastos').get().n, 2, 'no se repite');
});

test('un gasto personal cargado en Gastos descuenta de la caja del negocio, sale marcado como personal y no cuenta en el resultado del negocio', async () => {
  await cajaConfigurada(50000, 100000);
  const cat = await categoriaPersonal('Nafta');
  const r = await invocar('gastos:crear', { fecha: hoy(), categoria_id: cat, descripcion: 'Nafta', monto: 4000, medio_pago: 'Efectivo', observacion: '', tarjeta: '' });
  assert.equal(r.ok, true);
  assert.equal(await negocio('Efectivo'), 46000, 'sale del cajón');
  const est = await invocar('estadisticas:resumen', { desde: hoy(), hasta: hoy() });
  const nafta = est.salidas.gastos.porCategoria.find((c) => c.categoria === 'Nafta');
  assert.equal(nafta.ambito, 'personal');
});

test('con pases de Fondos personales, la lista de Operaciones de la Caja y la lupa siguen andando y no los incluyen', async () => {
  await cajaConfigurada(50000, 100000);
  await invocar('operaciones:pase', { fecha: hoy(), origen: 'Efectivo', destino: 'Mercado Pago', monto: 1000 });
  await invocar('ingresos:crearPase', { fecha: hoy(), monto: 20000, sentido: 'a_personal', cuenta_negocio: 'Mercado Pago', cuenta_personal: 'Mercado Pago' });
  const ops = await invocar('operaciones:listar');
  assert.equal(ops.length, 1, 'solo la operación de la Caja');
  const busqueda = await invocar('buscar:todo', 'pase');
  assert.equal(busqueda.ok, true);
  assert.equal((busqueda.grupos.operaciones || { items: [] }).items.every((o) => !/fondos personales/i.test(o.detalle)), true);
});

test('una sola lista de categorías: sirve para ingresos y retiros, y se administra desde Fondos personales', async () => {
  const nombres = (await invocar('ingresos:categorias')).map((c) => c.nombre);
  assert.ok(nombres.includes('Alquiler') && nombres.includes('Otros'), 'las de ingreso de siempre están');
  assert.equal((await invocar('ingresos:crearCategoria', 'Moto')).ok, true);
  const moto = (await invocar('ingresos:categorias')).find((c) => c.nombre === 'Moto').id;
  assert.equal((await invocar('ingresos:crearRetiro', { fecha: hoy(), categoria_id: moto, descripcion: 'Service', monto: 100, cuenta: 'Efectivo personal' })).ok, true);
  assert.equal((await invocar('ingresos:crear', { fecha: hoy(), categoria_id: moto, descripcion: 'Venta casco', monto: 50, cuenta: 'Efectivo personal' })).ok, true);
  // Gastos las ve como categorías personales (no se ofrecen en su desplegable, pero existen para las estadísticas).
  assert.equal(db.prepare("SELECT ambito FROM categorias_gasto WHERE id = ?").get(moto).ambito, 'personal');
  await invocar('ingresos:quitarCategoria', moto);
  assert.equal((await invocar('ingresos:categorias')).some((c) => c.nombre === 'Moto'), false);
  assert.equal((await invocar('ingresos:retiros')).length, 1, 'lo ya cargado se conserva');
});

test('la migración de categorías une las de ingreso con las personales de Gastos y conserva los ingresos', async () => {
  const { unificarCategoriasPersonales } = require('../src/db/gastos-personales');
  // Estado viejo: ingresos con categorías de `categorias_ingreso` y una categoría personal de Gastos con el mismo nombre que una de ingreso.
  db.pragma('foreign_keys = OFF');
  db.exec('DROP TABLE ingresos; DROP TABLE descripciones_ingreso; DELETE FROM retiros_personales;');
  db.exec(`CREATE TABLE ingresos (id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL, categoria_id INTEGER REFERENCES categorias_ingreso(id), descripcion TEXT NOT NULL, monto REAL NOT NULL, cuenta TEXT, observacion TEXT, creado TEXT NOT NULL DEFAULT (datetime('now', 'localtime')), fondo_personal INTEGER NOT NULL DEFAULT 0, retencion REAL NOT NULL DEFAULT 0);
           CREATE TABLE descripciones_ingreso (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL UNIQUE COLLATE NOCASE, categoria_id INTEGER REFERENCES categorias_ingreso(id), orden INTEGER NOT NULL DEFAULT 0);`);
  db.prepare('DELETE FROM descripciones_gasto WHERE categoria_id IN (SELECT id FROM categorias_gasto WHERE ambito = \'personal\')').run();
  db.prepare("DELETE FROM categorias_ingreso").run();
  db.prepare("DELETE FROM categorias_gasto WHERE ambito = 'personal'").run();
  db.pragma('foreign_keys = ON');
  const alq = Number(db.prepare("INSERT INTO categorias_ingreso (nombre) VALUES ('Alquiler')").run().lastInsertRowid);
  const otr = Number(db.prepare("INSERT INTO categorias_ingreso (nombre) VALUES ('Otros')").run().lastInsertRowid);
  db.prepare("INSERT INTO categorias_gasto (nombre, ambito) VALUES ('Alquiler', 'personal'), ('Obra social', 'personal')").run();
  db.prepare("INSERT INTO ingresos (fecha, categoria_id, descripcion, monto, cuenta) VALUES ('2026-09-01', ?, 'Gabriela', 100, 'Mercado Pago'), ('2026-09-02', ?, 'Varios', 5, NULL)").run(alq, otr);
  db.prepare("INSERT INTO descripciones_ingreso (nombre, categoria_id) VALUES ('Gabriela', ?)").run(alq);
  db.prepare("DELETE FROM configuracion WHERE clave = 'categorias_personales_unificadas'").run();

  unificarCategoriasPersonales(db);

  const personales = db.prepare("SELECT nombre FROM categorias_gasto WHERE ambito = 'personal' AND activo = 1 ORDER BY nombre").all().map((c) => c.nombre);
  assert.deepEqual(personales, ['Alquiler', 'Obra social', 'Otros']);
  const filas = db.prepare("SELECT i.descripcion, c.nombre AS cat, i.monto FROM ingresos i JOIN categorias_gasto c ON c.id = i.categoria_id ORDER BY i.id").all();
  assert.deepEqual(filas, [{ descripcion: 'Gabriela', cat: 'Alquiler', monto: 100 }, { descripcion: 'Varios', cat: 'Otros', monto: 5 }]);
  assert.equal(db.prepare("SELECT c.nombre FROM descripciones_ingreso d JOIN categorias_gasto c ON c.id = d.categoria_id").get().nombre, 'Alquiler');
  assert.equal(db.prepare('PRAGMA foreign_key_list(ingresos)').all().length, 0, 'ya no depende de categorias_ingreso');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  unificarCategoriasPersonales(db);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM categorias_gasto WHERE ambito = 'personal'").get().n, 3, 'no se repite');
  // Después se separan las listas (ver tests/categorias-fondos.test.js): las de los ingresos pasan a Fondos personales, la de Gastos se queda.
  const { separarCategoriasDeFondos } = require('../src/db/categorias-fondos');
  db.prepare("DELETE FROM configuracion WHERE clave = 'categorias_fondos_separadas'").run();
  separarCategoriasDeFondos(db);
  require('../src/db/descripciones-ingreso').unicasPorCategoria(db);
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'descripciones_ingreso'").get().sql, /UNIQUE\s*\(\s*nombre\s*,\s*categoria_id\s*\)/i);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM descripciones_ingreso').get().n, 1, 'conserva las descripciones');
  assert.deepEqual((await invocar('ingresos:categorias')).map((c) => c.nombre).sort(), ['Alquiler', 'Otros']);
  const alquiler = (await invocar('ingresos:categorias')).find((c) => c.nombre === 'Alquiler').id;
  assert.equal((await invocar('ingresos:crear', { fecha: hoy(), categoria_id: alquiler, descripcion: 'Reintegro', monto: 10, cuenta: 'Efectivo personal' })).ok, true);
  const obraSocial = db.prepare("SELECT id FROM categorias_gasto WHERE nombre = 'Obra social' AND ambito = 'personal'").get().id;
  assert.equal((await invocar('ingresos:crear', { fecha: hoy(), categoria_id: obraSocial, descripcion: 'Reintegro', monto: 10, cuenta: 'Efectivo personal' })).ok, false, 'una categoría de Gastos no sirve para un ingreso');
});

test('la Caja informa cuánta plata personal hay en cada banco o app, sin sumarla al dinero disponible', async () => {
  await cajaConfigurada(50000, 100000);
  await ingreso('Mercado Pago', 40000);
  await ingreso('Efectivo personal', 9000);
  const antesTotal = (await invocar('cuentas:resumen')).total;
  const r = await invocar('cuentas:resumen');
  const mp = r.cuentas.find((c) => c.nombre === 'Mercado Pago');
  assert.equal(mp.saldo, 100000, 'el negocio sigue con lo suyo');
  assert.equal(mp.personal, 40000, 'y la Caja avisa lo personal para la línea chica');
  assert.equal(r.cuentas.find((c) => c.nombre === 'Efectivo').personal, 0, 'el efectivo personal es un sobre aparte, no figura en el cajón');
  assert.equal(r.total, antesTotal);
  assert.equal(r.total, 150000, 'el dinero disponible es solo del negocio');
});

test('el historial de una cuenta personal junta ingresos, retención, retiros, pases y ajustes, con el saldo que fue quedando', async () => {
  tasa(1);
  await cajaConfigurada(0, 100000);
  const cat = await categoriaFondos('Moto');
  await invocar('ingresos:crear', { fecha: '2026-09-01', categoria_id: categoriaIngreso(), descripcion: 'Gabriela', monto: 100000, cuenta: 'Mercado Pago', con_retencion: true });
  await invocar('ingresos:crearRetiro', { fecha: '2026-09-05', categoria_id: cat, descripcion: 'Service', monto: 12000, cuenta: 'Mercado Pago' });
  await invocar('ingresos:crearPase', { fecha: '2026-09-10', monto: 5000, sentido: 'a_personal', cuenta_negocio: 'Mercado Pago', cuenta_personal: 'Mercado Pago', nota: 'prueba' });
  await invocar('ingresos:crearPase', { fecha: '2026-09-12', monto: 2000, sentido: 'al_negocio', cuenta_negocio: 'Mercado Pago', cuenta_personal: 'Mercado Pago' });
  await invocar('ingresos:ajustarSaldo', { cuenta: 'Mercado Pago', saldo: 91000 });
  const movs = await invocar('ingresos:movimientos', 'Mercado Pago');
  // del más nuevo al más viejo
  assert.deepEqual(movs.map((m) => m.detalle), [
    'Ajuste de saldo',
    'Pase a Mercado Pago (negocio)',
    'Pase desde Mercado Pago (negocio) · prueba',
    'Gasto: Service',
    'Retención por transferencia',
    'Ingreso: Gabriela',
  ]);
  assert.deepEqual(movs.map((m) => m.saldo).reverse(), [100000, 99000, 87000, 92000, 90000, 91000]);
  assert.equal(movs[0].saldo, await personal('Mercado Pago'), 'el último saldo del historial es el saldo de la cuenta');
  assert.deepEqual(await invocar('ingresos:movimientos', 'Cuenta que no existe'), []);
  assert.deepEqual(await invocar('ingresos:movimientos', 'Efectivo'), [], 'el cajón del negocio no es una cuenta personal');
});

const basico = ({ neto, cantidad }) => ({ neto, cantidad });
test('el saldo de los pases dice quién le debe a quién: el negocio le debe a lo personal si se pasó más al negocio', async () => {
  await cajaConfigurada(50000, 100000);
  assert.deepEqual((await invocar('ingresos:saldos')).saldoPases, { neto: 0, cantidad: 0 });
  const pase = (sentido, monto) => invocar('ingresos:crearPase', { fecha: hoy(), monto, sentido, cuenta_negocio: 'Mercado Pago', cuenta_personal: 'Mercado Pago' });
  await pase('a_personal', 30000); // lo personal le debe 30.000 al negocio
  assert.equal((await invocar('ingresos:saldos')).saldoPases.neto, -30000);
  await pase('al_negocio', 50000); // ahora el negocio le debe 20.000 a lo personal
  assert.deepEqual(basico((await invocar('ingresos:saldos')).saldoPases), { neto: 20000, cantidad: 2 });
  assert.deepEqual(basico((await invocar('cuentas:resumen')).saldoPases), { neto: 20000, cantidad: 2 }, 'la Caja también lo informa');
  await pase('a_personal', 20000); // a mano
  assert.deepEqual((await invocar('ingresos:saldos')).saldoPases, { neto: 0, cantidad: 3 });
  assert.deepEqual((await invocar('cuentas:resumen')).saldoPases, { neto: 0, cantidad: 3 });
  // Quitar un pase lo saca de la cuenta.
  await invocar('ingresos:eliminarPase', (await invocar('ingresos:pases'))[0].id);
  assert.deepEqual(basico((await invocar('ingresos:saldos')).saldoPases), { neto: 20000, cantidad: 2 });
});

test('devolver una deuda: el saldo dice cómo (sentido contrario, todo el monto, cuentas del último pase) y el pase la deja en cero', async () => {
  await cajaConfigurada(50000, 100000);
  const pase = (sentido, monto, cuenta_negocio, cuenta_personal, nota) => invocar('ingresos:crearPase', { fecha: hoy(), monto, sentido, cuenta_negocio, cuenta_personal, nota });
  assert.equal((await invocar('ingresos:saldos')).saldoPases.devolver, undefined, 'sin deuda no hay nada que devolver');
  // Lo personal le prestó al negocio 30.000 (Mercado Pago) y 20.000 (Efectivo): el negocio debe 50.000.
  await pase('al_negocio', 30000, 'Mercado Pago', 'Mercado Pago');
  await pase('al_negocio', 20000, 'Efectivo', 'Efectivo personal');
  const s = (await invocar('ingresos:saldos')).saldoPases;
  assert.deepEqual(s.devolver, { sentido: 'a_personal', monto: 50000, cuenta_negocio: 'Efectivo', cuenta_personal: 'Efectivo personal' }, 'vuelve por las cuentas del último pase');
  assert.deepEqual((await invocar('cuentas:resumen')).saldoPases.devolver, s.devolver, 'la Caja trae lo mismo');
  // Devolución parcial y después el resto.
  await pase('a_personal', 20000, 'Efectivo', 'Efectivo personal', 'Devolución');
  assert.equal((await invocar('ingresos:saldos')).saldoPases.devolver.monto, 30000);
  const d = (await invocar('ingresos:saldos')).saldoPases.devolver;
  assert.equal((await pase(d.sentido, d.monto, d.cuenta_negocio, d.cuenta_personal, 'Devolución')).ok, true);
  const final = (await invocar('ingresos:saldos')).saldoPases;
  assert.equal(final.neto, 0);
  assert.equal(final.devolver, undefined, 'a mano: ya no hay nada que devolver');
  // Si la deuda es al revés (lo personal debe), devolver es pasar de personal al negocio.
  await pase('a_personal', 7000, 'Mercado Pago', 'Mercado Pago');
  assert.deepEqual((await invocar('ingresos:saldos')).saldoPases.devolver, { sentido: 'al_negocio', monto: 7000, cuenta_negocio: 'Mercado Pago', cuenta_personal: 'Mercado Pago' });
});

test('la misma descripción sugerida puede estar en varias categorías y los gastos de propiedades también la suman', async () => {
  const casa = await categoriaFondos('Casa Norte');
  const dpto = await categoriaFondos('Dpto Moreno');
  await invocar('ingresos:crearDescripcion', { nombre: 'Mano de obra', categoria_id: casa });
  await invocar('ingresos:crearDescripcion', { nombre: 'Mano de obra', categoria_id: dpto });
  const filas = (await invocar('ingresos:descripciones')).filter((d) => d.nombre === 'Mano de obra');
  assert.deepEqual(filas.map((d) => d.categoria_id).sort(), [casa, dpto].sort());
  await cajaConfigurada(0, 0);
  const r = await invocar('ingresos:crearRetiro', { fecha: hoy(), categoria_id: casa, descripcion: 'Plomero', monto: 100, cuenta: 'Efectivo personal' });
  assert.equal(r.ok, true);
  assert.ok((await invocar('ingresos:descripciones')).some((d) => d.nombre === 'Plomero' && d.categoria_id === casa));
  const nombres = (await invocar('ingresos:categorias')).map((c) => c.nombre);
  assert.deepEqual(nombres, [...nombres].sort((a, b) => a.localeCompare(b)));
});

test('interés y reintegro entran a una cuenta personal; el reintegro ligado a una compra cuenta en su categoría y no puede pasarse', async () => {
  await cajaConfigurada(0, 0);
  const casa = await categoriaFondos('Casa Norte');
  // Interés: suma al saldo personal, sin retención, en la categoría Intereses (que se crea sola).
  assert.equal((await invocar('ingresos:rendimiento', { fecha: hoy(), cuenta: 'Mercado Pago', monto: 1000, observacion: 'septiembre' })).ok, true);
  assert.equal(await personal('Mercado Pago'), 1000);
  const rend = db.prepare("SELECT i.retencion, i.descripcion, c.nombre FROM ingresos i JOIN categorias_gasto c ON c.id = i.categoria_id WHERE i.descripcion = 'Interés'").get();
  assert.deepEqual({ ...rend }, { retencion: 0, descripcion: 'Interés', nombre: 'Intereses' });
  assert.equal((await invocar('ingresos:rendimiento', { fecha: hoy(), cuenta: 'Mercado Pago', monto: 0 })).ok, false);
  // Reintegro suelto: va a Reintegros.
  assert.equal((await invocar('ingresos:reintegro', { fecha: hoy(), cuenta: 'Mercado Pago', monto: 200 })).ok, true);
  assert.equal(db.prepare("SELECT c.nombre FROM ingresos i JOIN categorias_gasto c ON c.id = i.categoria_id WHERE i.descripcion = 'Reintegro'").get().nombre, 'Reintegros');
  // Ligado a una compra: entra en la categoría de la compra, se ve en la lista y el Resultado de la categoría lo cuenta.
  await invocar('ingresos:crearRetiro', { fecha: hoy(), categoria_id: casa, descripcion: 'Termotanque', monto: 1000, cuenta: 'Mercado Pago' });
  const retiro = (await invocar('ingresos:retiros'))[0];
  assert.equal((await invocar('ingresos:reintegro', { fecha: hoy(), cuenta: 'Mercado Pago', monto: 300, retiro_id: retiro.id })).ok, true);
  assert.equal((await invocar('ingresos:retiros'))[0].reintegrado, 300);
  const fila = (await invocar('ingresos:resultado', { desde: hoy(), hasta: hoy() })).filas.find((f) => f.id === casa);
  assert.equal(fila.deja, -700);
  // No se puede reintegrar más de lo que costó (300 + 800 > 1000), pero sí hasta completarlo.
  assert.equal((await invocar('ingresos:reintegro', { fecha: hoy(), cuenta: 'Mercado Pago', monto: 800, retiro_id: retiro.id })).ok, false);
  assert.equal((await invocar('ingresos:reintegro', { fecha: hoy(), cuenta: 'Mercado Pago', monto: 700, retiro_id: retiro.id })).ok, true);
  assert.equal((await invocar('ingresos:reintegro', { fecha: hoy(), cuenta: 'Mercado Pago', monto: 1, retiro_id: 99999 })).ok, false);
  // Si se quita la compra, sus reintegros se van con ella (el saldo queda como antes de la compra).
  await invocar('ingresos:eliminarRetiro', retiro.id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ingresos WHERE descripcion LIKE 'Reintegro: %'").get().n, 0);
  assert.equal(await personal('Mercado Pago'), 1200, 'queda el interés y el reintegro suelto');
});

test('los gastos personales de Fondos personales tienen su propia lista de categorías y no se mezclan con las de propiedades ni con las de Gastos', async () => {
  const propiedad = categoriaIngreso();
  const categoriaPersonalDeGastos = await categoriaPersonal('Particulares');
  assert.deepEqual(await invocar('ingresos:categoriasGastosPersonales'), [], 'arranca vacía');
  assert.equal((await invocar('ingresos:crearCategoriaGastoPersonal', '')).ok, false);
  assert.equal((await invocar('ingresos:crearCategoriaGastoPersonal', 'Comida')).ok, true);
  const comida = (await invocar('ingresos:categoriasGastosPersonales'))[0].id;
  assert.equal((await invocar('ingresos:categorias')).some((c) => c.id === comida), false, 'no aparece en ingresos y propiedades');
  assert.equal((await invocar('gastos:categorias')).some((c) => c.id === comida), false, 'ni en Gastos del negocio');

  const cuenta = 'Efectivo personal';
  const antes = (await invocar('ingresos:saldos')).cuentas.find((c) => c.nombre === cuenta).saldo;
  assert.equal((await invocar('ingresos:crearRetiro', { fecha: hoy(), categoria_id: categoriaPersonalDeGastos, descripcion: 'Super', monto: 100, cuenta })).ok, false, 'no acepta categorías de Gastos del negocio');
  assert.equal((await invocar('ingresos:crearRetiro', { fecha: hoy(), categoria_id: comida, descripcion: 'Super', monto: 1500, cuenta })).ok, true);
  assert.equal((await invocar('ingresos:crearRetiro', { fecha: hoy(), categoria_id: propiedad, descripcion: 'Plomero', monto: 500, cuenta })).ok, true);

  const retiros = await invocar('ingresos:retiros');
  assert.equal(retiros.find((r) => r.descripcion === 'Super').clase, 'personal');
  assert.equal(retiros.find((r) => r.descripcion === 'Plomero').clase, 'propiedad');
  assert.equal((await invocar('ingresos:saldos')).cuentas.find((c) => c.nombre === cuenta).saldo, antes - 2000, 'los dos restan de la cuenta personal');
  const resultado = await invocar('ingresos:resultado', {});
  assert.equal(resultado.filas.some((f) => f.nombre === 'Comida'), false, 'el Resultado es solo de propiedades');
  assert.equal(resultado.total.gasto, 500);
  assert.deepEqual(resultado.personales, { filas: [{ id: comida, nombre: 'Comida', gasto: 1500 }], total: 1500 }, 'los gastos personales van en su propia tabla');

  // Las categorías privadas también tienen descripciones sugeridas, y cargar un gasto suma la suya.
  assert.equal((await invocar('ingresos:crearDescripcion', { nombre: 'Supermercado', categoria_id: comida })).ok, true);
  assert.equal((await invocar('ingresos:crearDescripcion', { nombre: 'Verdulería', categoria_id: categoriaPersonalDeGastos })).ok, false, 'una categoría de Gastos del negocio no vale');
  const descripciones = await invocar('ingresos:descripciones');
  assert.deepEqual(descripciones.filter((d) => d.categoria_id === comida).map((d) => d.nombre).sort(), ['Super', 'Supermercado']);

  await invocar('ingresos:quitarCategoriaGastoPersonal', comida);
  assert.deepEqual(await invocar('ingresos:categoriasGastosPersonales'), []);
  assert.equal((await invocar('ingresos:retiros')).some((r) => r.descripcion === 'Super'), true, 'lo ya cargado se queda');
});
