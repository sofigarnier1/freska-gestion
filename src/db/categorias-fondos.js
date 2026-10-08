// Listas de categorías separadas (2026-10-03): hasta ahora Gastos → Personal y Fondos personales (ingresos y gastos de
// propiedades) compartían UNA lista (las `categorias_gasto` de ámbito personal), y por eso Gastos ofrecía "Alquiler" y
// "Otros", y Fondos personales "Supermercado". Ahora cada categoría personal tiene `de_fondos`: 0 = la lista de Gastos →
// Personal, 1 = la de Fondos personales. El ámbito sigue siendo 'personal' en las dos (Estadísticas no cambia).
//
// La tabla se recrea porque el nombre ya no alcanza para ser único: puede haber un "Alquiler" en cada lista, así que la
// restricción pasa a ser (nombre, ámbito, de_fondos). Los ids no cambian. Una sola vez (`categorias_fondos_separadas`):
//  - usada solo por ingresos, gastos de propiedades o sus descripciones sugeridas → pasa a Fondos personales;
//  - usada solo por Gastos (gastos o descripciones) → se queda en Gastos;
//  - usada por los dos → queda una en cada lista (con el mismo nombre) y los ingresos y gastos de propiedades pasan a la copia;
//  - sin uso → a Fondos personales si es de las de ingreso de siempre (`categorias_ingreso`: Alquiler, Otros), si no, a Gastos.
function separarCategoriasDeFondos(db) {
  if (db.prepare("SELECT 1 FROM configuracion WHERE clave = 'categorias_fondos_separadas'").get()) return;
  const existe = (tabla) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabla));
  const cuenta = (sql, ...args) => (existe(sql.tabla) ? db.prepare(sql.consulta).get(...args).n : 0);
  const usos = (tabla, columna, id) => cuenta({ tabla, consulta: `SELECT COUNT(*) AS n FROM ${tabla} WHERE ${columna} = ?` }, id);
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      const columnas = db.prepare('PRAGMA table_info(categorias_gasto)').all().map((c) => c.name);
      if (!columnas.includes('de_fondos')) {
        db.exec(`CREATE TABLE categorias_gasto_nueva (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nombre TEXT NOT NULL COLLATE NOCASE,
          activo INTEGER NOT NULL DEFAULT 1,
          ambito TEXT NOT NULL DEFAULT 'negocio' CHECK (ambito IN ('negocio', 'personal')),
          de_fondos INTEGER NOT NULL DEFAULT 0,
          UNIQUE (nombre, ambito, de_fondos)
        )`);
        db.exec(`INSERT INTO categorias_gasto_nueva (id, nombre, activo, ambito, de_fondos)
                 SELECT id, nombre, activo, ambito, 0 FROM categorias_gasto`);
        db.exec('DROP TABLE categorias_gasto');
        db.exec('ALTER TABLE categorias_gasto_nueva RENAME TO categorias_gasto');
      }
      const deIngreso = new Set(existe('categorias_ingreso') ? db.prepare('SELECT lower(nombre) AS n FROM categorias_ingreso').all().map((c) => c.n) : []);
      db.prepare("SELECT id, nombre, activo FROM categorias_gasto WHERE ambito = 'personal' AND de_fondos = 0").all().forEach((c) => {
        const deFondos = usos('ingresos', 'categoria_id', c.id) + usos('retiros_personales', 'categoria_id', c.id) + usos('descripciones_ingreso', 'categoria_id', c.id);
        const deGastos = usos('gastos', 'categoria_id', c.id) + usos('descripciones_gasto', 'categoria_id', c.id);
        if (deFondos > 0 && deGastos > 0) {
          const copia = Number(db.prepare("INSERT INTO categorias_gasto (nombre, activo, ambito, de_fondos) VALUES (?, 1, 'personal', 1)").run(c.nombre).lastInsertRowid);
          ['ingresos', 'retiros_personales', 'descripciones_ingreso'].forEach((tabla) => {
            if (existe(tabla)) db.prepare(`UPDATE ${tabla} SET categoria_id = ? WHERE categoria_id = ?`).run(copia, c.id);
          });
        } else if (deFondos > 0 || (deGastos === 0 && deIngreso.has(c.nombre.toLowerCase()))) {
          db.prepare('UPDATE categorias_gasto SET de_fondos = 1 WHERE id = ?').run(c.id);
        }
      });
      db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('categorias_fondos_separadas', '1')").run();
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

module.exports = { separarCategoriasDeFondos };
