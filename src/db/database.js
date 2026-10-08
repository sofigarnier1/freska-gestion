const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { app } = require('electron');

const copias = require('./copias');

const dbPath = path.join(app.getPath('userData'), 'freska.db');
const schemaPath = path.join(__dirname, 'schema.sql');

// La copia automática del día se hace antes de abrir y migrar la base: si una versión
// nueva migra mal, la copia sigue siendo la de antes de actualizar.
copias.copiaDelDia({ dbPath, dirCopias: path.join(app.getPath('userData'), 'copias') });

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(schemaPath, 'utf8');
const teniaMotivosRetiro = Boolean(
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'motivos_retiro'").get()
);
const teniaCategoriasGasto = Boolean(
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'categorias_gasto'").get()
);
const eraBaseNueva = !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'productos'").get();
db.exec(schema);

// Productos y métodos de pago iniciales: solo en una base nueva y una sola vez. Antes se insertaban en cada arranque, así
// que renombrar "Hamburguesas" o "Personal Pay" hacía reaparecer uno nuevo (a $0) la próxima vez que se abría la app.
if (!db.prepare("SELECT 1 FROM configuracion WHERE clave = 'semillas_iniciales_v1'").get()) {
  db.transaction(() => {
    if (eraBaseNueva) {
      const producto = db.prepare('INSERT OR IGNORE INTO productos (nombre, precio_cliente, precio_cf, unidad) VALUES (?, 0, 0, ?)');
      [['Milanesas de pollo', 'kg'], ['Milanesas de carne', 'kg'], ['Chorizos frescos', 'kg'], ['Chorizos secos', 'kg'], ['Hamburguesas', 'unidad'], ['Picada', 'unidad']].forEach((p) => producto.run(...p));
      const metodo = db.prepare('INSERT OR IGNORE INTO metodos_pago (nombre) VALUES (?)');
      ['Efectivo', 'MercadoPago', 'Personal Pay'].forEach((n) => metodo.run(n));
    } else {
      // Los que ya se habían vuelto a crear solos: un producto de esa lista, a $0, sin código (la pantalla lo exige), sin
      // facturas ni pedidos ni stock se da de baja (queda en la base, solo deja de verse).
      db.prepare(
        `UPDATE productos SET activo = 0
         WHERE activo = 1 AND (codigo IS NULL OR trim(codigo) = '') AND precio_cliente = 0 AND precio_cf = 0
           AND nombre IN ('Milanesas de pollo', 'Milanesas de carne', 'Chorizos frescos', 'Chorizos secos', 'Hamburguesas', 'Picada')
           AND articulo_stock_id IS NULL AND stock_de_producto_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM factura_items WHERE producto_id = productos.id)
           AND NOT EXISTS (SELECT 1 FROM pedido_items WHERE producto_id = productos.id)`
      ).run();
    }
    db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('semillas_iniciales_v1', '1')").run();
  })();
}

// Descripciones sugeridas de gasto: antes el nombre era único en toda la app, así que cargar "Obra social" en
// otra categoría movía la sugerencia. Ahora es única por nombre + categoría: se recrea la tabla conservando todo.
{
  const tabla = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'descripciones_gasto'").get();
  if (tabla && !/UNIQUE\s*\(\s*nombre\s*,\s*categoria_id\s*\)/i.test(tabla.sql)) {
    db.transaction(() => {
      db.exec(`CREATE TABLE descripciones_gasto_nueva (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL COLLATE NOCASE,
        categoria_id INTEGER REFERENCES categorias_gasto(id),
        orden INTEGER NOT NULL DEFAULT 0,
        UNIQUE (nombre, categoria_id)
      )`);
      db.exec(`INSERT INTO descripciones_gasto_nueva (id, nombre, categoria_id, orden)
               SELECT id, nombre, categoria_id, orden FROM descripciones_gasto`);
      db.exec('DROP TABLE descripciones_gasto');
      db.exec('ALTER TABLE descripciones_gasto_nueva RENAME TO descripciones_gasto');
    })();
  }
}

// Categorías de gasto y descripciones sugeridas iniciales (src/db/gastos-iniciales.js). Se cargan una
// sola vez; después son una lista propia (lo que se saque no vuelve solo). La versión de la semilla
// queda en `configuracion`: si cambia la lista inicial, las descripciones que nunca se usaron
// (`orden = 0`, o sea, las sembradas) se reemplazan por las nuevas, y las usadas no se tocan.
const VERSION_SEMILLA_GASTOS = '3';
const versionGuardada = db.prepare("SELECT valor FROM configuracion WHERE clave = 'gastos_semilla'").get();
if (!teniaCategoriasGasto || !versionGuardada || versionGuardada.valor !== VERSION_SEMILLA_GASTOS) {
  const inicial = require('./gastos-iniciales');
  const insertarCategoria = db.prepare(
    'INSERT INTO categorias_gasto (nombre) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM categorias_gasto WHERE nombre = ?)'
  );
  // (Sin mirar el grupo: esto puede correr en una base vieja que todavía no tiene la columna `ambito`.)
  const idCategoria = db.prepare('SELECT id FROM categorias_gasto WHERE nombre = ? ORDER BY id LIMIT 1');
  const insertarDescripcion = db.prepare(
    'INSERT OR IGNORE INTO descripciones_gasto (nombre, categoria_id, orden) VALUES (?, ?, 0)'
  );
  db.transaction(() => {
    if (teniaCategoriasGasto) db.prepare('DELETE FROM descripciones_gasto WHERE orden = 0').run();
    inicial.forEach(({ categoria, descripciones }) => {
      insertarCategoria.run(categoria, categoria);
      const { id } = idCategoria.get(categoria);
      descripciones.forEach((d) => insertarDescripcion.run(d, id));
    });
    db.prepare(
      `INSERT INTO configuracion (clave, valor) VALUES ('gastos_semilla', ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
    ).run(VERSION_SEMILLA_GASTOS);
  })();
}

// La primera vez que existe la lista de motivos de retiro, se arma con los que ya se habían usado
// (del más viejo al más nuevo). Después es una lista propia: lo que se saque no vuelve solo.
if (!teniaMotivosRetiro) {
  const usados = db
    .prepare(
      `SELECT r.concepto FROM retiros_caja r
       WHERE r.id = (SELECT MAX(r2.id) FROM retiros_caja r2 WHERE lower(r2.concepto) = lower(r.concepto))
       ORDER BY r.id`
    )
    .all();
  const insertar = db.prepare('INSERT OR IGNORE INTO motivos_retiro (nombre, orden) VALUES (?, ?)');
  usados.forEach((u, i) => insertar.run(u.concepto, i + 1));
}

// Los retiros de efectivo y los gastos pagados en efectivo son lo mismo: una sola tabla (`gastos`).
// Una sola vez, los retiros ya cargados pasan a ser gastos en efectivo de la categoría "Otros" y los
// motivos de retiro pasan a ser descripciones sugeridas de esa categoría. Las tablas viejas
// (`retiros_caja`, `motivos_retiro`) se dejan como respaldo, sin uso.
const migrado = db.prepare("SELECT valor FROM configuracion WHERE clave = 'retiros_unificados'").get();
if (!migrado) {
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO categorias_gasto (nombre) VALUES ('Otros')").run();
    const otros = db.prepare("SELECT id FROM categorias_gasto WHERE nombre = 'Otros' ORDER BY id LIMIT 1").get().id;
    db.prepare(
      `INSERT INTO gastos (fecha, categoria_id, descripcion, monto, medio_pago)
       SELECT fecha, ?, concepto, monto, 'Efectivo' FROM retiros_caja ORDER BY id`
    ).run(otros);
    const base = db.prepare('SELECT COALESCE(MAX(orden), 0) AS m FROM descripciones_gasto').get().m;
    db.prepare(
      `INSERT OR IGNORE INTO descripciones_gasto (nombre, categoria_id, orden)
       SELECT nombre, ?, ? + orden FROM motivos_retiro ORDER BY orden`
    ).run(otros, base);
    db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('retiros_unificados', '1')").run();
  })();
}


// El método de pago "Cheque" (con banco, número y fecha de cobro) se agrega una sola vez a la lista de
// métodos; después es una lista propia (si se saca, no vuelve solo).
if (!db.prepare("SELECT 1 FROM configuracion WHERE clave = 'metodo_cheque'").get()) {
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO metodos_pago (nombre) VALUES ('Cheque')").run();
    db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('metodo_cheque', '1')").run();
  })();
}

try {
  db.exec('ALTER TABLE cheques ADD COLUMN pago_proveedor_id INTEGER');
} catch (e) {
  // La columna ya existe.
}

try {
  db.exec('ALTER TABLE gastos ADD COLUMN cheque_id INTEGER');
} catch (e) {
  // La columna ya existe.
}

try {
  db.exec('ALTER TABLE gastos ADD COLUMN observacion TEXT');
} catch (e) {
  // La columna ya existe.
}

try {
  db.exec('ALTER TABLE clientes ADD COLUMN ultima_consulta TEXT');
} catch (e) {
  // La columna ya existe (base creada con una versión anterior del esquema).
}

try {
  db.exec('ALTER TABLE clientes ADD COLUMN telefono_fijo TEXT');
} catch (e) {
  // La columna ya existe.
}

try {
  db.exec('ALTER TABLE productos ADD COLUMN codigo TEXT');
} catch (e) {
  // La columna ya existe.
}

const columnasClientes = db.prepare('PRAGMA table_info(clientes)').all();
const tieneApellido = columnasClientes.some((c) => c.name === 'apellido');
if (!tieneApellido) {
  // Recreamos la tabla para agregar "apellido" y cambiar la restricción única
  // de "nombre" solo a la combinación (nombre, apellido).
  //
  // Importante: no renombramos "clientes" mientras siga existiendo, porque
  // SQLite reescribe las cláusulas REFERENCES de otras tablas (como
  // facturas.cliente_id) para apuntar al nuevo nombre, y esa referencia queda
  // rota para siempre cuando la tabla vieja se borra. En cambio, creamos la
  // tabla nueva con otro nombre, movemos los datos, borramos la tabla vieja
  // y recién ahí renombramos la nueva a "clientes" — así la referencia
  // "REFERENCES clientes(id)" en facturas, que nunca se tocó, vuelve a
  // resolver correctamente apenas existe una tabla con ese nombre de nuevo.
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE clientes_nueva (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      apellido TEXT,
      telefono TEXT,
      telefono_fijo TEXT,
      domicilio TEXT,
      nota TEXT,
      saldo REAL NOT NULL DEFAULT 0,
      ultima_consulta TEXT,
      UNIQUE(nombre, apellido)
    );
    INSERT INTO clientes_nueva (id, nombre, apellido, telefono, telefono_fijo, domicilio, nota, saldo, ultima_consulta)
      SELECT id, nombre, '', telefono, telefono_fijo, domicilio, nota, saldo, ultima_consulta FROM clientes;
    DROP TABLE clientes;
    ALTER TABLE clientes_nueva RENAME TO clientes;
  `);
  db.pragma('foreign_keys = ON');
}

// Va después de la recreación de "clientes" de arriba (que no copia esta columna).
try {
  db.exec('ALTER TABLE clientes ADD COLUMN activo INTEGER NOT NULL DEFAULT 1');
} catch (e) {
  // La columna ya existe.
}

// Stock: cada producto apunta a un artículo de stock y sabe cuántos kilos pesa por unidad de venta.
for (const columna of ['articulo_stock_id INTEGER', 'kg_por_unidad REAL', 'stock_de_producto_id INTEGER', 'presentacion TEXT']) {
  try {
    db.exec(`ALTER TABLE productos ADD COLUMN ${columna}`);
  } catch (e) {
    // La columna ya existe.
  }
}
if (!db.prepare("SELECT 1 FROM configuracion WHERE clave = 'stock_semilla'").get()) {
  // Una sola vez: los productos que se venden por kilo pasan a ser su propio artículo (1 kg por kg). El stock cuenta las
  // facturas desde hoy: lo anterior no se descuenta.
  const crear = db.prepare('INSERT OR IGNORE INTO articulos_stock (nombre) VALUES (?)');
  const buscar = db.prepare('SELECT id FROM articulos_stock WHERE nombre = ?');
  db.prepare("SELECT id, nombre FROM productos WHERE activo = 1 AND unidad = 'kg'")
    .all()
    .forEach((p) => {
      crear.run(p.nombre);
      db.prepare('UPDATE productos SET articulo_stock_id = ?, kg_por_unidad = 1 WHERE id = ? AND articulo_stock_id IS NULL').run(buscar.get(p.nombre).id, p.id);
    });
  db.prepare("INSERT OR IGNORE INTO configuracion (clave, valor) VALUES ('stock_desde', date('now', 'localtime'))").run();
  db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('stock_semilla', '1')").run();
}

// Una sola vez: los pesos que confirmó el dueño. Caja de hamburguesas (32 unidades) = 2,46 kg, hamburguesa suelta = 78 g
// (comparte el stock de la caja) y caja de picada = 2,5 kg. Solo se toca lo que todavía no tiene stock configurado.
if (!db.prepare("SELECT 1 FROM configuracion WHERE clave = 'stock_pesos_iniciales'").get()) {
  const pila = (nombre) => {
    db.prepare('INSERT INTO articulos_stock (nombre) VALUES (?) ON CONFLICT(nombre) DO UPDATE SET activo = 1').run(nombre);
    return db.prepare('SELECT id FROM articulos_stock WHERE nombre = ?').get(nombre).id;
  };
  const buscar = (nombre) => db.prepare("SELECT id, articulo_stock_id, kg_por_unidad, presentacion FROM productos WHERE activo = 1 AND unidad = 'unidad' AND lower(trim(nombre)) = ?").get(nombre);
  const caja = buscar('hamburguesas (x32)');
  if (caja) {
    const p = caja.articulo_stock_id || pila('Hamburguesas');
    if (!caja.kg_por_unidad) db.prepare('UPDATE productos SET articulo_stock_id = ?, kg_por_unidad = 2.46 WHERE id = ?').run(p, caja.id);
    if (!caja.presentacion) db.prepare("UPDATE productos SET presentacion = 'caja' WHERE id = ?").run(caja.id);
    const suelta = buscar('hamburguesas (unidad)');
    if (suelta && !suelta.kg_por_unidad) {
      db.prepare('UPDATE productos SET articulo_stock_id = ?, kg_por_unidad = 0.078, stock_de_producto_id = ? WHERE id = ?').run(p, caja.id, suelta.id);
    }
    if (suelta && !suelta.presentacion) db.prepare("UPDATE productos SET presentacion = 'unidad' WHERE id = ?").run(suelta.id);
  }
  const picada = buscar('picada');
  if (picada) {
    if (!picada.kg_por_unidad) db.prepare('UPDATE productos SET articulo_stock_id = ?, kg_por_unidad = 2.5 WHERE id = ?').run(picada.articulo_stock_id || pila('Picada'), picada.id);
    if (!picada.presentacion) db.prepare("UPDATE productos SET presentacion = 'caja' WHERE id = ?").run(picada.id);
  }
  db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('stock_pesos_iniciales', '1')").run();
}

// Cuántos kilos pesa una caja de cada cosa que se produce (para cargar la producción por cajas).
try {
  db.exec('ALTER TABLE articulos_stock ADD COLUMN kg_por_caja REAL');
} catch (e) {
  // La columna ya existe.
}

// Cada categoría de gasto es del negocio o personal. La que ya existía como "Particulares" pasa a personal (una sola vez).
try {
  db.exec("ALTER TABLE categorias_gasto ADD COLUMN ambito TEXT NOT NULL DEFAULT 'negocio' CHECK (ambito IN ('negocio', 'personal'))");
} catch (e) {
  // La columna ya existe.
}
if (!db.prepare("SELECT 1 FROM configuracion WHERE clave = 'categorias_ambito'").get()) {
  db.prepare("UPDATE categorias_gasto SET ambito = 'personal' WHERE lower(nombre) = 'particulares'").run();
  db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('categorias_ambito', '1')").run();
}

// Categorías de gasto: antes el nombre era único en toda la app, así que crear "Obra social" en Personal pasaba
// a Personal la del Negocio (con sus gastos). Ahora es único por nombre + grupo: se recrea la tabla conservando
// ids y datos (los gastos y las descripciones siguen apuntando a la misma categoría).
{
  const tabla = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'categorias_gasto'").get();
  if (tabla && !/UNIQUE\s*\(\s*nombre\s*,\s*ambito\b/i.test(tabla.sql)) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`CREATE TABLE categorias_gasto_nueva (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL COLLATE NOCASE,
        activo INTEGER NOT NULL DEFAULT 1,
        ambito TEXT NOT NULL DEFAULT 'negocio' CHECK (ambito IN ('negocio', 'personal')),
        UNIQUE (nombre, ambito)
      )`);
      db.exec(`INSERT INTO categorias_gasto_nueva (id, nombre, activo, ambito)
               SELECT id, nombre, activo, ambito FROM categorias_gasto`);
      db.exec('DROP TABLE categorias_gasto');
      db.exec('ALTER TABLE categorias_gasto_nueva RENAME TO categorias_gasto');
    })();
    db.pragma('foreign_keys = ON');
  }
}

// Descripción (opcional) de un ingreso personal.
try {
  db.exec('ALTER TABLE ingresos ADD COLUMN observacion TEXT');
} catch (e) {
  // La columna ya existe.
}

// De qué cuenta (método de pago) salió un gasto pagado por transferencia o débito.
try {
  db.exec('ALTER TABLE gastos ADD COLUMN cuenta TEXT');
} catch (e) {
  // La columna ya existe.
}

// (Se probó anotar lo real de cada cuenta al cerrar el día; se descartó: los bancos se corrigen con "Ajustar saldo".)
db.exec('DROP TABLE IF EXISTS cierres_caja_cuentas');

// Gastos con tarjeta: cuál tarjeta y, en crédito, en cuántas cuotas.
['tarjeta TEXT', 'cuotas INTEGER'].forEach((columna) => {
  try {
    db.exec(`ALTER TABLE gastos ADD COLUMN ${columna}`);
  } catch (e) {
    // La columna ya existe.
  }
});

// Momento en que se cargó cada compra y cada pago a proveedor (para ordenar el historial por orden de carga
// dentro del mismo día). Los anteriores quedan sin hora y siguen ordenándose como antes.
['compras', 'pagos_proveedor'].forEach((tabla) => {
  try {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN creado TEXT`);
  } catch (e) {
    // La columna ya existe.
  }
});

// Código propio de cada cliente (para que no se confundan) y sus datos fiscales. Los clientes que ya
// existían reciben como código su número de siempre.
['codigo TEXT', 'condicion_iva TEXT', 'cuit TEXT'].forEach((columna) => {
  try {
    db.exec(`ALTER TABLE clientes ADD COLUMN ${columna}`);
  } catch (e) {
    // La columna ya existe.
  }
});
db.exec("UPDATE clientes SET codigo = CAST(id AS TEXT) WHERE codigo IS NULL OR trim(codigo) = ''");

// Nombre del negocio (opcional, para los clientes que son un comercio): se busca por él además de por el nombre de
// la persona (2026-09-27: la mayoría de los clientes de la carnicería son kiosco/comercios).
try {
  db.exec('ALTER TABLE clientes ADD COLUMN negocio TEXT');
} catch (e) {
  // La columna ya existe.
}

// Número de comprobante de una compra a un proveedor (factura o remito del proveedor), opcional: sirve para
// después encontrar el papel si hace falta (2026-09-27).
try {
  db.exec('ALTER TABLE compras ADD COLUMN comprobante TEXT');
} catch (e) {
  // La columna ya existe.
}

// Sección Proveedores. Una sola vez: se cargan los proveedores de la planilla y lo que estaba anotado en
// Gastos con la categoría "Proveedores" pasa a ser pagos a proveedor (el nombre sale de la descripción):
// efectivo → efectivo, transferencia / débito → transferencia, cheque de la cartera → ese cheque. Los
// gastos con un cheque tipeado a mano (sin cheque de la cartera) se dejan donde están. Si no queda nada
// en esa categoría, deja de ofrecerse en Gastos.
if (!db.prepare("SELECT 1 FROM configuracion WHERE clave = 'proveedores_v1'").get()) {
  try {
    db.exec('ALTER TABLE cheques ADD COLUMN pago_proveedor_id INTEGER');
  } catch (e) {
    // La columna ya existe.
  }
  db.transaction(() => {
    const insertarProveedor = db.prepare('INSERT OR IGNORE INTO proveedores (nombre) VALUES (?)');
    require('./proveedores-iniciales').forEach((nombre) => insertarProveedor.run(nombre));
    const categoria = db.prepare("SELECT id FROM categorias_gasto WHERE nombre = 'Proveedores' AND ambito = 'negocio'").get();
    if (categoria) {
      const gastos = db
        .prepare(
          `SELECT * FROM gastos WHERE categoria_id = ?
             AND (medio_pago != 'Cheque' OR cheque_id IS NOT NULL) ORDER BY id`
        )
        .all(categoria.id);
      const idProveedor = db.prepare('SELECT id FROM proveedores WHERE nombre = ?');
      const insertarPago = db.prepare(
        'INSERT INTO pagos_proveedor (proveedor_id, fecha, efectivo, transferencia) VALUES (?, ?, ?, ?)'
      );
      gastos.forEach((g) => {
        insertarProveedor.run(g.descripcion);
        const proveedor = idProveedor.get(g.descripcion);
        const esEfectivo = String(g.medio_pago).trim().toLowerCase() === 'efectivo';
        const esCheque = g.medio_pago === 'Cheque';
        const pago = insertarPago.run(
          proveedor.id,
          g.fecha,
          esEfectivo ? g.monto : 0,
          esEfectivo || esCheque ? 0 : g.monto
        );
        if (esCheque) {
          db.prepare('UPDATE cheques SET pago_proveedor_id = ? WHERE id = ?').run(pago.lastInsertRowid, g.cheque_id);
        }
        db.prepare('DELETE FROM gastos WHERE id = ?').run(g.id);
      });
      const quedan = db.prepare('SELECT COUNT(*) AS n FROM gastos WHERE categoria_id = ?').get(categoria.id).n;
      if (quedan === 0) {
        db.prepare('UPDATE categorias_gasto SET activo = 0 WHERE id = ?').run(categoria.id);
      }
      db.prepare('DELETE FROM descripciones_gasto WHERE categoria_id = ?').run(categoria.id);
    }
    db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('proveedores_v1', '1')").run();
  })();
}


// Lo que vende cada proveedor: la primera vez se arma con lo que ya se le compró (con la última descripción usada).
if (!db.prepare("SELECT 1 FROM configuracion WHERE clave = 'proveedor_productos_v1'").get()) {
  db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO proveedor_productos (proveedor_id, producto, descripcion)
       SELECT c.proveedor_id, ci.producto, ci.descripcion
       FROM compra_items ci JOIN compras c ON c.id = ci.compra_id
       WHERE ci.id = (SELECT MAX(x.id) FROM compra_items x JOIN compras c2 ON c2.id = x.compra_id
                      WHERE c2.proveedor_id = c.proveedor_id AND lower(x.producto) = lower(ci.producto))`
    ).run();
    db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('proveedor_productos_v1', '1')").run();
  })();
}

// Tipos de producto iniciales (una sola vez; después es una lista propia: lo que se saque no vuelve).
if (!db.prepare("SELECT 1 FROM configuracion WHERE clave = 'tipos_producto_v1'").get()) {
  db.transaction(() => {
    const insertar = db.prepare('INSERT OR IGNORE INTO tipos_producto (nombre, orden) VALUES (?, ?)');
    ['Vaca', 'Cerdo', 'Pollo', 'Otro'].forEach((nombre, i) => insertar.run(nombre, i + 1));
    db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('tipos_producto_v1', '1')").run();
  })();
}

// Categoría "Comisiones bancarias" (lo que el banco cobra: mantenimiento, intereses por descubierto…): se agrega una sola
// vez a las bases que ya existían; si después se renombra o se saca, no vuelve.
if (!db.prepare("SELECT 1 FROM configuracion WHERE clave = 'categoria_comisiones_v1'").get()) {
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO categorias_gasto (nombre, ambito) VALUES ('Comisiones bancarias', 'negocio')").run();
    db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('categoria_comisiones_v1', '1')").run();
  })();
}

// De qué tipo de carne es cada pila de stock (Vaca/Cerdo/Pollo/Otro, la misma lista que ya se usa en las
// compras): para más adelante poder comparar cuánto se compró de cada tipo contra cuánto se produjo.
try {
  db.exec('ALTER TABLE articulos_stock ADD COLUMN tipo TEXT');
} catch (e) {
  // La columna ya existe.
}

// Tipos de carne iniciales (Productos → Editar): lista propia y chica, separada de `tipos_producto` (que es
// para anotar cualquier compra en Proveedores). Una sola vez; después es una lista propia que se edita.
if (!db.prepare("SELECT 1 FROM configuracion WHERE clave = 'tipos_carne_v1'").get()) {
  db.transaction(() => {
    const insertar = db.prepare('INSERT OR IGNORE INTO tipos_carne (nombre, orden) VALUES (?, ?)');
    ['Vaca', 'Cerdo', 'Pollo', 'Otro'].forEach((nombre, i) => insertar.run(nombre, i + 1));
    db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('tipos_carne_v1', '1')").run();
  })();
}

// Varias carnes por producto (2026-10-07): lo que ya tenía un solo tipo pasa a ser una mezcla con un solo tipo al 100 %.
if (!db.prepare("SELECT 1 FROM configuracion WHERE clave = 'articulo_carnes_v1'").get()) {
  db.transaction(() => {
    db.exec("INSERT OR IGNORE INTO articulo_carnes (articulo_id, tipo, porcentaje) SELECT id, tipo, 100 FROM articulos_stock WHERE tipo IS NOT NULL AND trim(tipo) != ''");
    db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('articulo_carnes_v1', '1')").run();
  })();
}

// Cobros anulados: queda el rastro (qué se cobró, a quién, de qué facturas y por qué se anuló).
db.exec(`CREATE TABLE IF NOT EXISTS cobros_anulados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  fecha_cobro TEXT,
  monto REAL NOT NULL,
  metodo TEXT,
  facturas TEXT,
  motivo TEXT,
  snapshot TEXT,
  retencion_snapshot TEXT,
  reactivado_en TEXT
)`);

// Deshacer una anulación (2026-09-27: "si la anulación está mal hecha, lo tiene que poder dejar sin efecto"):
// `snapshot` guarda los cobros originales (factura, monto, método, fecha) y `retencion_snapshot` la retención
// automática que se borró, para poder recrearlos tal cual si se reactiva. Bases que ya tenían la tabla:
['snapshot TEXT', 'retencion_snapshot TEXT', 'reactivado_en TEXT'].forEach((columna) => {
  try {
    db.exec(`ALTER TABLE cobros_anulados ADD COLUMN ${columna}`);
  } catch (e) {
    // La columna ya existe.
  }
});

// Para poder reactivar una factura anulada: el estado que tenía antes de anularla y el pago de la devolución (si
// hubo) que hay que sacar si se reactiva.
['anulado_estado_previo TEXT', 'anulado_devolucion_pago_id INTEGER'].forEach((columna) => {
  try {
    db.exec(`ALTER TABLE facturas ADD COLUMN ${columna}`);
  } catch (e) {
    // La columna ya existe.
  }
});

// Quién corrigió con qué se pagó un cobro, cuándo y por qué (antes se cambiaba sin dejar rastro). `pago_ids` son los
// cobros (ids de `pagos`, separados por coma) que se corrigieron.
db.exec(`CREATE TABLE IF NOT EXISTS cobros_metodo_cambiado (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  cliente_id INTEGER,
  pago_ids TEXT NOT NULL,
  monto REAL NOT NULL,
  metodo_anterior TEXT NOT NULL,
  metodo_nuevo TEXT NOT NULL,
  motivo TEXT,
  usuario_id INTEGER
)`);

// Cuándo se anuló cada factura (para que el aviso de anulaciones de empleados venza a los 14 días). Las anuladas de antes
// quedan con la fecha en que se hicieron: es lo más cercano que hay.
try {
  db.exec('ALTER TABLE facturas ADD COLUMN anulado_en TEXT');
} catch (e) {
  // La columna ya existe.
}
db.exec("UPDATE facturas SET anulado_en = fecha WHERE estado = 'anulada' AND anulado_en IS NULL");
// Para poder deshacer el crédito al reactivar: hasta qué pago había al anular y cuáles pagos de "Saldo a favor" salieron de esa anulación.
['anulado_pago_tope INTEGER', 'anulado_credito_pagos TEXT'].forEach((columna) => {
  try {
    db.exec(`ALTER TABLE facturas ADD COLUMN ${columna}`);
  } catch (e) {
    // La columna ya existe.
  }
});

// ---------- Usuarios (2026-09-27): superadministrador y empleados ----------
// Cada uno con su propia contraseña (mismo esquema scrypt que la vieja contraseña única). `fallos`/`bloqueado_hasta`
// son el mismo bloqueo por intentos que antes, ahora por persona. Un empleado tiene acceso a Pedidos, Facturas,
// Cobros y Clientes; el resto (Dinero, Proveedores, Estadísticas, Productos y stock, Copia de seguridad, Usuarios)
// es solo del administrador — se controla centralizado en main.js, no acá.
db.exec(`CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pin_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'empleado' CHECK (rol IN ('admin', 'empleado')),
  activo INTEGER NOT NULL DEFAULT 1,
  fallos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta INTEGER NOT NULL DEFAULT 0,
  creado TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
)`);
// La contraseña única que ya existía pasa a ser la del primer usuario, "Administrador" (mismo hash, no hay que
// volver a escribirla). Si la app es nueva y todavía no hay contraseña, no se crea nadie: la pantalla de "Crear
// contraseña de acceso" arma el primer usuario la primera vez que se abre.
if (!db.prepare('SELECT 1 FROM usuarios LIMIT 1').get()) {
  const vieja = db.prepare("SELECT valor FROM configuracion WHERE clave = 'pin_hash'").get();
  if (vieja) {
    db.prepare("INSERT INTO usuarios (nombre, pin_hash, rol) VALUES ('Administrador', ?, 'admin')").run(vieja.valor);
  }
}

// Quién cargó o anuló cada cosa (para cuando hay más de un usuario). Antes de esto no había forma de saberlo:
// queda NULL en lo viejo.
[
  ['facturas', 'creado_por INTEGER'],
  ['facturas', 'anulado_por INTEGER'],
  ['pedidos', 'creado_por INTEGER'],
  ['pagos', 'creado_por INTEGER'],
  ['cobros_anulados', 'anulado_por INTEGER'],
].forEach(([tabla, columna]) => {
  try {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna}`);
  } catch (e) {
    // La columna ya existe.
  }
});

// Un cobro del saldo anterior de un cliente (el saldo inicial, que no tiene factura) se guarda en `pagos` sin
// factura: `factura_id` pasa a admitir NULL y se suma `cliente_id`. SQLite no puede sacar un NOT NULL, así que se
// recrea la tabla conservando los ids (otras tablas guardan ids de pagos como texto, no por referencia). Va después
// de agregar `creado_por`, que se copia.
{
  const columnasPagos = db.prepare('PRAGMA table_info(pagos)').all();
  const facturaIdPagos = columnasPagos.find((c) => c.name === 'factura_id');
  if (facturaIdPagos && facturaIdPagos.notnull === 1) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE pagos_nueva (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        factura_id INTEGER REFERENCES facturas(id) ON DELETE CASCADE,
        cliente_id INTEGER REFERENCES clientes(id),
        monto REAL NOT NULL,
        metodo_pago TEXT NOT NULL DEFAULT 'Efectivo',
        fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        creado_por INTEGER
      );
      INSERT INTO pagos_nueva (id, factura_id, monto, metodo_pago, fecha, creado_por)
        SELECT id, factura_id, monto, metodo_pago, fecha, creado_por FROM pagos;
      DROP TABLE pagos;
      ALTER TABLE pagos_nueva RENAME TO pagos;
      CREATE INDEX IF NOT EXISTS idx_pagos_factura ON pagos(factura_id);
      CREATE INDEX IF NOT EXISTS idx_pagos_dia ON pagos(substr(fecha, 1, 10));
    `);
    db.pragma('foreign_keys = ON');
  }
}

// Cuánta carne lleva cada kilo de un artículo (milanesas con huevo y pan rallado, por ejemplo): para el rendimiento solo
// cuenta esa parte. Sin dato = 100 % (carne pura).
try {
  db.exec('ALTER TABLE articulos_stock ADD COLUMN porcentaje_carne REAL');
} catch (e) {
  // La columna ya existe.
}

// Mínimo de kilos de un artículo del stock: por debajo, la campanita avisa ("stock bajo"). Sin dato = sin aviso.
try {
  db.exec('ALTER TABLE articulos_stock ADD COLUMN minimo REAL');
} catch (e) {
  // La columna ya existe.
}

// De qué cobro (ids de `pagos`, separados por coma) viene una retención automática: al anular el cobro se anula también su retención.
try {
  db.exec('ALTER TABLE gastos ADD COLUMN pago_ids TEXT');
} catch (e) {
  // La columna ya existe.
}

// De qué ingreso (Otros ingresos) viene una retención automática: al borrar el ingreso se borra también su retención.
try {
  db.exec('ALTER TABLE gastos ADD COLUMN ingreso_id INTEGER');
} catch (e) {
  // La columna ya existe.
}

// Saldo con el que arranca un cliente (para cuando ya venía debiendo o a favor de antes de usar FRESKA), igual
// que ya tenían los proveedores. A diferencia de proveedores, el saldo del cliente se guarda (no se calcula al
// vuelo), así que el inicial se suma directo a `saldo` cuando se crea o se edita (ver `clientes:crear`/`actualizar`).
try {
  db.exec('ALTER TABLE clientes ADD COLUMN saldo_inicial REAL NOT NULL DEFAULT 0');
} catch (e) {
  // La columna ya existe.
}

// Un segundo WhatsApp por cliente, con el nombre de quién es (2026-09-27: "en el caso de que en un
// negocio sean dos dueños y hable con los dos"). El de siempre (`telefono`) no lleva nombre porque para un
// cliente sin negocio ya alcanza con su propio nombre.
['telefono2 TEXT', 'telefono2_nombre TEXT'].forEach((columna) => {
  try {
    db.exec(`ALTER TABLE clientes ADD COLUMN ${columna}`);
  } catch (e) {
    // La columna ya existe.
  }
});

// Vendedores que cobran comisión por lo que venden (2026-09-28). El dueño no es un vendedor: sus clientes
// quedan sin vendedor y no genera comisión. Cada cliente tiene un vendedor y cada factura guarda el del momento en
// que se hizo, así cambiarle el vendedor a un cliente no mueve las ventas de meses anteriores.
db.exec(`CREATE TABLE IF NOT EXISTS vendedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero INTEGER NOT NULL,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  porcentaje REAL NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1
)`);
[
  ['clientes', 'vendedor_id INTEGER'],
  ['facturas', 'vendedor_id INTEGER'],
  ['vendedores', 'telefono TEXT'],
].forEach(([tabla, columna]) => {
  try {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna}`);
  } catch (e) {
    // La columna ya existe.
  }
});

// Historial del porcentaje de cada vendedor: cada fila vale desde su fecha (AAAA-MM-DD) hasta que empieza la
// siguiente. Así, si a un vendedor le cambian el porcentaje, lo vendido antes de ese día se sigue calculando con el
// viejo. `vendedores.porcentaje` guarda el actual (para mostrarlo); el informe usa este historial.
db.exec(`CREATE TABLE IF NOT EXISTS vendedor_porcentajes (
  vendedor_id INTEGER NOT NULL,
  desde TEXT NOT NULL,
  porcentaje REAL NOT NULL,
  PRIMARY KEY (vendedor_id, desde)
)`);
db.exec(`INSERT INTO vendedor_porcentajes (vendedor_id, desde, porcentaje)
  SELECT id, '0000-00-00', porcentaje FROM vendedores
  WHERE id NOT IN (SELECT vendedor_id FROM vendedor_porcentajes)`);

// Pagos de comisión ya cargados como gasto (2026-09-28): se puede pagar de a partes, así que un vendedor
// puede tener varios pagos en el mismo mes. `mes` es el mes al que se imputa el pago (sale de su `fecha`, no de
// qué informe se estaba mirando al cargarlo); `gasto_id` conecta con la fila real en `gastos`.
db.exec(`CREATE TABLE IF NOT EXISTS comisiones_vendedor_pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendedor_id INTEGER NOT NULL,
  mes TEXT NOT NULL,
  gasto_id INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  monto REAL NOT NULL
)`);
// La primera versión tenía UNIQUE(vendedor_id, mes) (un solo pago cargado por mes); ahora se puede pagar de a
// partes, así que hay que sacarle esa restricción a las bases que ya tenían la tabla vieja. Nadie más referencia
// esta tabla (sin FK entrante), así que alcanza con recrearla sin el UNIQUE y copiar lo que hubiera.
const comisionesPagosTieneUnique = db
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'comisiones_vendedor_pagos'")
  .get().sql.includes('UNIQUE');
if (comisionesPagosTieneUnique) {
  db.exec(`
    CREATE TABLE comisiones_vendedor_pagos_nueva (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendedor_id INTEGER NOT NULL,
      mes TEXT NOT NULL,
      gasto_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      monto REAL NOT NULL
    );
    INSERT INTO comisiones_vendedor_pagos_nueva (id, vendedor_id, mes, gasto_id, fecha, monto)
      SELECT id, vendedor_id, mes, gasto_id, fecha, monto FROM comisiones_vendedor_pagos;
    DROP TABLE comisiones_vendedor_pagos;
    ALTER TABLE comisiones_vendedor_pagos_nueva RENAME TO comisiones_vendedor_pagos;
  `);
}

// Fondos personales (2026-10-02): un ingreso nuevo es plata de la parte personal de una cuenta (`fondo_personal = 1`) y
// la Caja del negocio no lo cuenta. Los ya cargados quedan como estaban (`0`: los que entraron a una cuenta siguen
// sumando a la caja, para no mover lo que ya se ve).
try {
  db.exec('ALTER TABLE ingresos ADD COLUMN fondo_personal INTEGER NOT NULL DEFAULT 0');
} catch (e) {
  // La columna ya existe.
}
// `retencion`: lo que el banco retuvo de ese ingreso por transferencia (plata que no llegó a la cuenta). El ingreso
// neto es monto - retencion.
try {
  db.exec('ALTER TABLE ingresos ADD COLUMN retencion REAL NOT NULL DEFAULT 0');
} catch (e) {
  // La columna ya existe.
}

// Los gastos personales se anotan en Gastos, como siempre. La 0.9.0 los pasaba a Retiros de Fondos personales una sola vez (clave
// `gastos_personales_a_retiros`): esa pasada ya no existe (se marca como hecha para que nunca corra) y los que ya se habían
// pasado vuelven a Gastos (ver gastos-personales.js).
db.prepare("INSERT OR IGNORE INTO configuracion (clave, valor) VALUES ('gastos_personales_a_retiros', '1')").run();
require('./gastos-personales').devolverGastosPersonalesAGastos(db);

// Categorías de ingreso (2026-09-28): "De dónde viene" pasa de ser un solo texto libre a Categoría (Alquiler,
// Otros, ...) + Descripción (ej: el inquilino), igual que en Gastos. Se agrega una sola vez: los ingresos ya
// cargados quedan en "Otros" y sus descripciones pasan a ser sugeridas de esa categoría.
try {
  db.exec('ALTER TABLE ingresos ADD COLUMN categoria_id INTEGER REFERENCES categorias_ingreso(id)');
} catch (e) {
  // La columna ya existe.
}
if (!db.prepare("SELECT 1 FROM configuracion WHERE clave = 'categorias_ingreso_semilla'").get()) {
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO categorias_ingreso (nombre) VALUES ('Alquiler')").run();
    db.prepare("INSERT OR IGNORE INTO categorias_ingreso (nombre) VALUES ('Otros')").run();
    const otros = db.prepare("SELECT id FROM categorias_ingreso WHERE nombre = 'Otros'").get().id;
    db.prepare('UPDATE ingresos SET categoria_id = ? WHERE categoria_id IS NULL').run(otros);
    const insertarDescripcionIngreso = db.prepare(
      'INSERT OR IGNORE INTO descripciones_ingreso (nombre, categoria_id, orden) VALUES (?, ?, 0)'
    );
    db.prepare('SELECT DISTINCT descripcion FROM ingresos').all().forEach((u) => insertarDescripcionIngreso.run(u.descripcion, otros));
    db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('categorias_ingreso_semilla', '1')").run();
  })();
}

// Comprar por kg o por unidad (2026-09-29): la carne se compra por kg, pero cosas como los huevos se
// compran por unidad. `ADD COLUMN ... DEFAULT 'kg'` ya deja lo existente como estaba (todo era por kg).
['proveedor_productos', 'compra_items'].forEach((tabla) => {
  try {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN unidad TEXT NOT NULL DEFAULT 'kg' CHECK (unidad IN ('kg', 'unidad'))`);
  } catch (e) {
    // La columna ya existe.
  }
});

// Proveedores: "Producto" (antes "Tipo") pasa a ser la lista fija y obligatoria; "Descripción" (antes
// "Producto") pasa a ser el texto libre opcional (2026-09-29): así "Vaca"/"Cerdo"/"Pollo" (o lo que
// se agregue a la lista) alcanza solo para identificar la compra, y el texto libre solo aclara si hace falta
// distinguir dos cosas del mismo producto. Se recrean las tablas (como con clientes_nueva) para poder tener
// NOT NULL en "producto" y cambiar la restricción única. Va después de agregar "unidad" arriba, para que ya
// exista esa columna cuando se copian los datos. Los productos que ya tenían Tipo cargado lo heredan como
// "Producto" nuevo (con el texto libre de antes como Descripción); los que no tenían Tipo quedan con el
// texto libre de antes como "Producto" nuevo (no hay mejor dato) y sin Descripción.
if (db.prepare('PRAGMA table_info(proveedor_productos)').all().some((c) => c.name === 'tipo')) {
  db.exec(`
    CREATE TABLE proveedor_productos_nueva (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
      producto TEXT NOT NULL COLLATE NOCASE,
      descripcion TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
      unidad TEXT NOT NULL DEFAULT 'kg' CHECK (unidad IN ('kg', 'unidad')),
      UNIQUE(proveedor_id, producto, descripcion)
    );
    INSERT OR IGNORE INTO proveedor_productos_nueva (id, proveedor_id, producto, descripcion, unidad)
      SELECT id, proveedor_id,
        COALESCE(NULLIF(trim(tipo), ''), producto),
        CASE WHEN tipo IS NULL OR trim(tipo) = '' THEN '' ELSE producto END,
        unidad
      FROM proveedor_productos;
    DROP TABLE proveedor_productos;
    ALTER TABLE proveedor_productos_nueva RENAME TO proveedor_productos;
  `);
}
if (db.prepare('PRAGMA table_info(compra_items)').all().some((c) => c.name === 'tipo')) {
  db.exec(`
    CREATE TABLE compra_items_nueva (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compra_id INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
      producto TEXT NOT NULL,
      descripcion TEXT NOT NULL DEFAULT '',
      unidad TEXT NOT NULL DEFAULT 'kg' CHECK (unidad IN ('kg', 'unidad')),
      kilos REAL,
      precio_kg REAL,
      importe REAL NOT NULL
    );
    INSERT INTO compra_items_nueva (id, compra_id, producto, descripcion, unidad, kilos, precio_kg, importe)
      SELECT id, compra_id,
        COALESCE(NULLIF(trim(tipo), ''), producto),
        CASE WHEN tipo IS NULL OR trim(tipo) = '' THEN '' ELSE producto END,
        unidad, kilos, precio_kg, importe
      FROM compra_items;
    DROP TABLE compra_items;
    ALTER TABLE compra_items_nueva RENAME TO compra_items;
  `);
}

// Pedir por unidad un producto que se vende por kilo (el chorizo seco: "6 chorizos" y se pesan al facturar). El producto
// lleva `pedible_por_unidad` y su peso aproximado por unidad (`peso_unidad_pedido`, en kg); la línea del pedido lleva
// `unidad_pedido` ('unidad' o vacío = la unidad del producto).
[
  ['productos', 'pedible_por_unidad INTEGER NOT NULL DEFAULT 0'],
  ['productos', 'peso_unidad_pedido REAL'],
  ['pedido_items', 'unidad_pedido TEXT'],
  // En la factura, cuántas unidades pidieron de una línea que se pesó ("Chorizos secos (5 u.)").
  ['factura_items', 'pedido_unidades REAL'],
].forEach(([tabla, columna]) => {
  try {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna}`);
  } catch (e) {
    // La columna ya existe.
  }
});

// Una sola lista de categorías para Fondos personales (ver gastos-personales.js).
require('./gastos-personales').unificarCategoriasPersonales(db);
// Después de unificar: las listas de Gastos y de Fondos personales se separan (ver categorias-fondos.js).
require('./categorias-fondos').separarCategoriasDeFondos(db);

// `retiro_id`: un reintegro puede estar ligado al gasto de propiedades que lo originó (va después de unificarCategoriasPersonales,
// que recrea `ingresos` y solo copia las columnas que conoce).
try {
  db.exec('ALTER TABLE ingresos ADD COLUMN retiro_id INTEGER');
} catch (e) {
  // La columna ya existe.
}

// `para_fecha`: día para el que se programó un pedido (anotado hoy para el viernes). Vacío = el pedido es del día en que se anotó.
try {
  db.exec('ALTER TABLE pedidos ADD COLUMN para_fecha TEXT');
} catch (e) {
  // La columna ya existe.
}

// Descripciones sugeridas de ingreso: únicas por nombre + categoria, igual que en gastos (ver descripciones-ingreso.js).
require('./descripciones-ingreso').unicasPorCategoria(db);

// Reintegros del negocio en la Caja (ver operaciones-reintegro.js).
require('./operaciones-reintegro').permitirReintegro(db);


module.exports = db;
