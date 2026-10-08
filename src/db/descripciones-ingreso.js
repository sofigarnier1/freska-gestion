// Descripciones sugeridas de ingreso y de gastos de propiedades: antes el nombre era único en toda la tabla, así que poner
// "Mano de obra" en una segunda categoría se la sacaba a la primera. Ahora es única por nombre + categoría (como en gastos).
function unicasPorCategoria(db) {
  const tabla = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'descripciones_ingreso'").get();
  if (!tabla || /UNIQUE\s*\(\s*nombre\s*,\s*categoria_id\s*\)/i.test(tabla.sql)) return;
  db.transaction(() => {
    db.exec(`CREATE TABLE descripciones_ingreso_nueva (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL COLLATE NOCASE,
      categoria_id INTEGER,
      orden INTEGER NOT NULL DEFAULT 0,
      UNIQUE (nombre, categoria_id)
    )`);
    db.exec(`INSERT INTO descripciones_ingreso_nueva (id, nombre, categoria_id, orden)
             SELECT id, nombre, categoria_id, orden FROM descripciones_ingreso`);
    db.exec('DROP TABLE descripciones_ingreso');
    db.exec('ALTER TABLE descripciones_ingreso_nueva RENAME TO descripciones_ingreso');
  })();
}

module.exports = { unicasPorCategoria };
