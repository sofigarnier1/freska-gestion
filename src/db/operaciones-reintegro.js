// Reintegros del negocio (Caja general): un tipo nuevo de operación. La tabla tenía una restricción con los tipos
// permitidos, así que se la recrea con 'reintegro' incluido (una vez; en una base nueva ya viene así de schema.sql).
function permitirReintegro(db) {
  const tabla = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'operaciones_caja'").get();
  if (!tabla || /'reintegro'/.test(tabla.sql)) return;
  db.transaction(() => {
    db.exec(`CREATE TABLE operaciones_caja_nueva (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('pase', 'dolares', 'canje', 'interes', 'reintegro')),
      cuenta TEXT NOT NULL,
      cuenta_destino TEXT,
      monto REAL NOT NULL,
      usd REAL,
      cotizacion REAL,
      cheque_id INTEGER,
      nota TEXT,
      creado TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )`);
    db.exec(`INSERT INTO operaciones_caja_nueva (id, fecha, tipo, cuenta, cuenta_destino, monto, usd, cotizacion, cheque_id, nota, creado)
             SELECT id, fecha, tipo, cuenta, cuenta_destino, monto, usd, cotizacion, cheque_id, nota, creado FROM operaciones_caja`);
    db.exec('DROP TABLE operaciones_caja');
    db.exec('ALTER TABLE operaciones_caja_nueva RENAME TO operaciones_caja');
    db.exec('CREATE INDEX IF NOT EXISTS idx_operaciones_caja_fecha ON operaciones_caja(fecha)');
  })();
}

module.exports = { permitirReintegro };
