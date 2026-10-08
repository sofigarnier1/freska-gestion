// Tests de las copias de seguridad: la del día, la externa (Drive/pendrive) y la restauración.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const copias = require('../src/db/copias');

const carpetaTemporal = () => fs.mkdtempSync(path.join(os.tmpdir(), 'freska-copias-'));
function baseDeEjemplo(dir, nombres = ['Alma', 'Bruno']) {
  const ruta = path.join(dir, 'freska.db');
  const db = new Database(ruta);
  db.exec('CREATE TABLE clientes (id INTEGER PRIMARY KEY, n TEXT); CREATE TABLE facturas (id INTEGER PRIMARY KEY); CREATE TABLE productos (id INTEGER PRIMARY KEY);');
  nombres.forEach((n) => db.prepare('INSERT INTO clientes (n) VALUES (?)').run(n));
  return { db, ruta };
}
const contar = (ruta) => {
  const d = new Database(ruta, { readonly: true });
  const n = d.prepare('SELECT COUNT(*) n FROM clientes').get().n;
  d.close();
  return n;
};

test('la copia externa no se hace si la carpeta no está (Drive cerrado, pendrive sacado)', async () => {
  const dir = carpetaTemporal();
  const { db } = baseDeEjemplo(dir);
  const r = await copias.copiaExterna({ db, carpeta: path.join(dir, 'no-existe') });
  assert.equal(r.ok, false);
  assert.ok(!fs.existsSync(path.join(dir, 'no-existe')), 'no crea la carpeta');
  db.close();
});

test('la copia externa es legible, no deja temporales, no toca archivos ajenos y se queda con las últimas 14', async () => {
  const dir = carpetaTemporal();
  const { db } = baseDeEjemplo(dir);
  const carpeta = path.join(dir, 'drive');
  fs.mkdirSync(carpeta);
  fs.writeFileSync(path.join(carpeta, 'fotos-de-vacaciones.txt'), 'no tocar');
  for (let i = 20; i >= 1; i--) await copias.copiaExterna({ db, carpeta, hoy: new Date(2026, 8, 24 - i) });
  const r = await copias.copiaExterna({ db, carpeta, hoy: new Date(2026, 8, 24) });
  assert.equal(r.ok, true);
  const archivos = fs.readdirSync(carpeta);
  assert.equal(archivos.filter((n) => n.startsWith('freska-ext-')).length, copias.MAX_EXTERNAS);
  assert.ok(archivos.includes('fotos-de-vacaciones.txt'), 'el archivo ajeno sigue ahí');
  assert.ok(!archivos.some((n) => n.endsWith('.tmp')), 'no quedan temporales');
  assert.equal(contar(path.join(carpeta, 'freska-ext-2026-09-24.db')), 2);
  assert.ok(!archivos.includes('freska-ext-2026-09-03.db'), 'las más viejas se borran');
  db.close();
});

test('dos copias externas el mismo día: la última pisa a la anterior', async () => {
  const dir = carpetaTemporal();
  const { db } = baseDeEjemplo(dir);
  const carpeta = path.join(dir, 'drive');
  fs.mkdirSync(carpeta);
  const hoy = new Date(2026, 8, 24);
  await copias.copiaExterna({ db, carpeta, hoy });
  db.prepare("INSERT INTO clientes (n) VALUES ('Camila')").run();
  await copias.copiaExterna({ db, carpeta, hoy });
  assert.equal(fs.readdirSync(carpeta).length, 1);
  assert.equal(contar(path.join(carpeta, 'freska-ext-2026-09-24.db')), 3);
  db.close();
});

test('la copia del día se hace una sola vez por día y se queda con las últimas 30', () => {
  const dir = carpetaTemporal();
  const { db, ruta } = baseDeEjemplo(dir);
  db.close();
  const dirCopias = path.join(dir, 'copias');
  for (let i = 40; i >= 1; i--) copias.copiaDelDia({ dbPath: ruta, dirCopias, hoy: new Date(2026, 6, 1 + (40 - i)) });
  const hoy = new Date(2026, 8, 24);
  const a = copias.copiaDelDia({ dbPath: ruta, dirCopias, hoy });
  fs.writeFileSync(ruta, 'cambiado'); // si volviera a copiar, se pisaría
  const b = copias.copiaDelDia({ dbPath: ruta, dirCopias, hoy });
  assert.equal(a, b);
  assert.equal(contar(a), 2, 'la copia del día no se rehace');
  assert.equal(fs.readdirSync(dirCopias).length, copias.MAX_AUTOMATICAS, '41 días de copias se recortan a las últimas 30');
  assert.ok(!fs.existsSync(path.join(dirCopias, 'freska-auto-2026-07-01.db')), 'la más vieja se borró');
});

test('restaurar rechaza archivos que no son una base de FRESKA y guarda una copia previa al restaurar', () => {
  const dir = carpetaTemporal();
  const dirCopias = path.join(dir, 'copias');
  const { db, ruta } = baseDeEjemplo(dir, ['Actual1', 'Actual2', 'Actual3']);
  db.close();
  const ajeno = path.join(dir, 'otra.db');
  const o = new Database(ajeno);
  o.exec('CREATE TABLE cosas (id INTEGER)');
  o.close();
  fs.writeFileSync(path.join(dir, 'texto.db'), 'esto no es una base');
  assert.equal(copias.validarBase(ajeno).ok, false);
  assert.equal(copias.validarBase(path.join(dir, 'texto.db')).ok, false);

  const otroDir = carpetaTemporal();
  const { db: viejo, ruta: rutaVieja } = baseDeEjemplo(otroDir, ['Vieja1']);
  viejo.close();
  let cerrada = false;
  const r = copias.restaurar({ origen: rutaVieja, dbPath: ruta, dirCopias, cerrarBase: () => (cerrada = true) });
  assert.equal(r.ok, true);
  assert.ok(cerrada);
  assert.equal(contar(ruta), 1, 'la base ahora es la restaurada');
  const previa = fs.readdirSync(dirCopias).find((n) => n.startsWith('freska-antes-de-restaurar-'));
  assert.ok(previa, 'quedó una copia de lo que había antes');
  assert.equal(contar(path.join(dirCopias, previa)), 3);

  const malo = copias.restaurar({ origen: ajeno, dbPath: ruta, dirCopias, cerrarBase: () => assert.fail('no debe cerrar la base si el archivo no sirve') });
  assert.equal(malo.ok, false);
  assert.equal(contar(ruta), 1, 'una restauración fallida no toca la base');
});
