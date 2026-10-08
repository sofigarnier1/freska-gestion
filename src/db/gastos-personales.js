// Los gastos personales vuelven a Gastos (2026-10-02, pedido del dueño: los gastos del día, personales o no, se anotan
// todos en la misma tabla del negocio, con su categoría y su descripción). La versión 0.9.0 los había pasado a Retiros de
// Fondos personales: cada uno se reemplazó por un pase del negocio a lo personal (con la nota de abajo) más el retiro. Acá se
// deshace: por cada pase con esa nota y su retiro (mismo día, monto y cuenta), se vuelve a crear el gasto y se borran los dos.
// La caja del negocio queda idéntica (el gasto resta de la misma cuenta que el pase) y el saldo personal no cambia (el pase y el
// retiro se anulaban entre sí). Lo que no se guardó es si el pago fue con débito o transferencia: vuelve como transferencia
// desde esa cuenta (en efectivo, si salió del cajón). Lo que se cargó después en Retiros (sin esa nota) no se toca. Se marca con
// `gastos_personales_devueltos` en `configuracion` para no repetirse. Va en su propio archivo para poder probarla.
const NOTA_PASE_GASTO_PERSONAL = 'Gasto personal anterior a Fondos personales';

function devolverGastosPersonalesAGastos(db) {
  if (db.prepare("SELECT 1 FROM configuracion WHERE clave = 'gastos_personales_devueltos'").get()) return;
  db.transaction(() => {
    const clave = (t) => String(t || '').replace(/\s+/g, '').toLowerCase();
    const pases = db.prepare("SELECT * FROM pases_personales WHERE nota = ? AND sentido = 'a_personal' ORDER BY id").all(NOTA_PASE_GASTO_PERSONAL);
    const usados = new Set();
    pases.forEach((p) => {
      const retiro = db
        .prepare('SELECT * FROM retiros_personales WHERE fecha = ? AND monto = ? AND cuenta = ? ORDER BY id')
        .all(p.fecha, p.monto, p.cuenta_personal)
        .find((r) => !usados.has(r.id));
      if (!retiro) return;
      usados.add(retiro.id);
      const esEfectivo = clave(p.cuenta_negocio) === 'efectivo';
      db.prepare(
        'INSERT INTO gastos (fecha, categoria_id, descripcion, monto, medio_pago, observacion, cuenta) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(retiro.fecha, retiro.categoria_id, retiro.descripcion, retiro.monto, esEfectivo ? 'Efectivo' : 'Transferencia', retiro.observacion || null, esEfectivo ? null : p.cuenta_negocio);
      db.prepare('DELETE FROM pases_personales WHERE id = ?').run(p.id);
      db.prepare('DELETE FROM retiros_personales WHERE id = ?').run(retiro.id);
    });
    db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('gastos_personales_devueltos', '1')").run();
  })();
}

// Una sola lista de categorías para Fondos personales (2026-10-02): las de ingreso (Alquiler, Otros…) pasan a
// `categorias_gasto` de ámbito personal, junto a las personales que ya tenía Gastos, y los ingresos y sus descripciones
// sugeridas apuntan a esa lista. `ingresos` y `descripciones_ingreso` apuntaban por clave foránea a `categorias_ingreso`,
// así que se recrean sin esa restricción (patrón de las otras migraciones que cambian una restricción). Los ids no
// cambian, salvo el de la categoría. `categorias_ingreso` queda sin uso. Se marca con `categorias_personales_unificadas`.
function unificarCategoriasPersonales(db) {
  if (db.prepare("SELECT 1 FROM configuracion WHERE clave = 'categorias_personales_unificadas'").get()) return;
  const columnasDe = (tabla) => db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec('CREATE TEMP TABLE IF NOT EXISTS mapa_categorias (viejo INTEGER PRIMARY KEY, nuevo INTEGER NOT NULL)');
      db.exec('DELETE FROM mapa_categorias');
      db.prepare('SELECT id, nombre, activo FROM categorias_ingreso').all().forEach((c) => {
        db.prepare("INSERT OR IGNORE INTO categorias_gasto (nombre, ambito, activo) VALUES (?, 'personal', ?)").run(c.nombre, c.activo);
        if (c.activo) db.prepare("UPDATE categorias_gasto SET activo = 1 WHERE nombre = ? AND ambito = 'personal'").run(c.nombre);
        const nueva = db.prepare("SELECT id FROM categorias_gasto WHERE nombre = ? AND ambito = 'personal'").get(c.nombre);
        db.prepare('INSERT INTO mapa_categorias (viejo, nuevo) VALUES (?, ?)').run(c.id, nueva.id);
      });
      const colIngresos = columnasDe('ingresos');
      db.exec(`
        CREATE TABLE ingresos_nueva (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fecha TEXT NOT NULL,
          categoria_id INTEGER,
          descripcion TEXT NOT NULL,
          monto REAL NOT NULL,
          cuenta TEXT,
          observacion TEXT,
          creado TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          fondo_personal INTEGER NOT NULL DEFAULT 0,
          retencion REAL NOT NULL DEFAULT 0
        );
      `);
      const copiables = ['id', 'fecha', 'descripcion', 'monto', 'cuenta', 'observacion', 'creado', 'fondo_personal', 'retencion'].filter((c) => colIngresos.includes(c));
      db.exec(`
        INSERT INTO ingresos_nueva (${copiables.join(', ')}, categoria_id)
        SELECT ${copiables.map((c) => `i.${c}`).join(', ')}, COALESCE((SELECT nuevo FROM mapa_categorias WHERE viejo = i.categoria_id), i.categoria_id)
        FROM ingresos i;
        DROP TABLE ingresos;
        ALTER TABLE ingresos_nueva RENAME TO ingresos;
        CREATE INDEX IF NOT EXISTS idx_ingresos_fecha ON ingresos(fecha);

        CREATE TABLE descripciones_ingreso_nueva (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
          categoria_id INTEGER,
          orden INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO descripciones_ingreso_nueva (id, nombre, categoria_id, orden)
        SELECT d.id, d.nombre, COALESCE((SELECT nuevo FROM mapa_categorias WHERE viejo = d.categoria_id), d.categoria_id), d.orden FROM descripciones_ingreso d;
        DROP TABLE descripciones_ingreso;
        ALTER TABLE descripciones_ingreso_nueva RENAME TO descripciones_ingreso;
      `);
      db.exec('DROP TABLE mapa_categorias');
      db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('categorias_personales_unificadas', '1')").run();
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

module.exports = { devolverGastosPersonalesAGastos, unificarCategoriasPersonales, NOTA_PASE_GASTO_PERSONAL };
