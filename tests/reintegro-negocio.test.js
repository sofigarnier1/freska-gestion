// Reintegro del negocio (Caja general): entra a la cuenta, cuenta como entrada aparte en Estadísticas → Negocio y no se
// mezcla con el interés ni con el reintegro de Fondos personales. Y la migración que amplía los tipos de operación.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, limpiarDatos, asegurarMetodo } = require('./harness');
const { permitirReintegro } = require('../src/db/operaciones-reintegro');

let db;
let invocar;
test.before(async () => {
  ({ db, invocar } = await iniciar());
});
test.beforeEach(() => {
  limpiarDatos(db);
  db.prepare('DELETE FROM operaciones_caja').run();
});

const hoy = () => db.prepare("SELECT date('now', 'localtime') AS d").get().d;

test('un reintegro del negocio queda como operación (con su cuenta en una columna) y se puede deshacer', async () => {
  await invocar('cuentas:guardarSaldos', { desde: '2026-01-01', saldos: {}, cotizacion: 0 });
  const cuenta = (await invocar('cuentas:resumen')).cuentas.find((c) => c.nombre !== 'Efectivo');
  const r = await invocar('operaciones:reintegro', { fecha: hoy(), cuenta: cuenta.nombre, monto: 1500, nota: 'Promo' });
  assert.equal(r.ok, true);
  const lista = await invocar('operaciones:listar');
  assert.equal(lista.length, 1);
  assert.equal(lista[0].detalle, 'Reintegro: Promo');
  assert.equal(lista[0].cuenta, cuenta.nombre, 'la lista dice en qué banco o app fue');
  assert.equal(lista[0].entra, true);
  assert.equal((await invocar('operaciones:reintegro', { fecha: hoy(), cuenta: cuenta.nombre, monto: 0 })).ok, false);
  await invocar('operaciones:eliminar', lista[0].id);
  assert.equal((await invocar('operaciones:listar')).length, 0);
});

test('Estadísticas → Negocio cuenta el reintegro como entrada aparte, sin tocar los intereses', async () => {
  await invocar('cuentas:guardarSaldos', { desde: '2026-01-01', saldos: {}, cotizacion: 0 });
  const cuenta = (await invocar('cuentas:resumen')).cuentas.find((c) => c.nombre !== 'Efectivo').nombre;
  await invocar('operaciones:reintegro', { fecha: hoy(), cuenta, monto: 1500 });
  await invocar('operaciones:interes', { fecha: hoy(), cuenta, tipo: 'ganado', monto: 200 });
  const e = await invocar('estadisticas:resumen', { desde: '2000-01-01', hasta: '2999-12-31' });
  assert.equal(e.intereses.reintegros, 1500);
  assert.equal(e.intereses.ganados, 200);
});

test('la migración deja pasar los reintegros en una tabla vieja y no pierde operaciones', () => {
  db.exec('DROP TABLE operaciones_caja');
  db.exec(`CREATE TABLE operaciones_caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('pase', 'dolares', 'canje', 'interes')),
    cuenta TEXT NOT NULL, cuenta_destino TEXT, monto REAL NOT NULL, usd REAL, cotizacion REAL, cheque_id INTEGER, nota TEXT,
    creado TEXT NOT NULL DEFAULT (datetime('now', 'localtime')))`);
  db.prepare("INSERT INTO operaciones_caja (id, fecha, tipo, cuenta, monto, nota) VALUES (7, '2026-10-01', 'interes', 'Banco', 50, 'x')").run();
  assert.throws(() => db.prepare("INSERT INTO operaciones_caja (fecha, tipo, cuenta, monto) VALUES ('2026-10-01', 'reintegro', 'Banco', 1)").run());
  permitirReintegro(db);
  permitirReintegro(db); // una segunda vez no hace nada
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM operaciones_caja').get().n, 1);
  db.prepare("INSERT INTO operaciones_caja (fecha, tipo, cuenta, monto) VALUES ('2026-10-01', 'reintegro', 'Banco', 1)").run();
  assert.equal(db.prepare('SELECT id FROM operaciones_caja ORDER BY id DESC').get().id, 8, 'los ids siguen de donde estaban');
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_operaciones_caja_fecha'").get());
});

test('interés y reintegro del negocio y de Fondos personales no se mezclan: ni en la cuenta, ni en Operaciones, ni en Estadísticas', async () => {
  const MP = 'Mercado Pago';
  // La semilla trae "MercadoPago": sería la misma cuenta que "Mercado Pago" y la Caja se quedaría con la primera.
  db.prepare("DELETE FROM metodos_pago WHERE nombre IN ('MercadoPago', 'Personal Pay')").run();
  ['Efectivo', MP, 'Cheque'].forEach((m) => asegurarMetodo(db, m));
  assert.equal((await invocar('cuentas:guardarSaldos', { desde: hoy(), saldos: { Efectivo: 0, [MP]: 0 } })).ok, true);
  const saldoNegocio = async () => (await invocar('cuentas:resumen')).cuentas.find((c) => c.nombre === MP).saldo;
  const saldoPersonal = async () => (await invocar('ingresos:saldos')).cuentas.find((c) => c.nombre === MP).saldo;
  // Negocio: interés 200 y reintegro 1500. Personal: interés 1000 y reintegro 300.
  await invocar('operaciones:interes', { fecha: hoy(), cuenta: MP, tipo: 'ganado', monto: 200 });
  await invocar('operaciones:reintegro', { fecha: hoy(), cuenta: MP, monto: 1500 });
  assert.equal((await invocar('ingresos:rendimiento', { fecha: hoy(), cuenta: MP, monto: 1000 })).ok, true);
  assert.equal((await invocar('ingresos:reintegro', { fecha: hoy(), cuenta: MP, monto: 300 })).ok, true);

  // Cada cuenta separa lo suyo: la Caja del negocio no ve lo personal y al revés.
  assert.equal(await saldoNegocio(), 1700);
  assert.equal(await saldoPersonal(), 1300);
  // La lista de Operaciones de la Caja solo tiene lo del negocio.
  const ops = await invocar('operaciones:listar');
  assert.equal(ops.length, 2);
  assert.ok(ops.every((o) => o.cuenta === MP));
  // Estadísticas: lo del negocio no incluye lo personal, y lo personal no incluye lo del negocio.
  const e = await invocar('estadisticas:resumen', { desde: '2000-01-01', hasta: '2999-12-31' });
  assert.equal(e.intereses.ganados, 200);
  assert.equal(e.intereses.reintegros, 1500);
  assert.equal(e.personal.ingresos.total, 1300);
});
