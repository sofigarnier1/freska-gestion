// Pedidos.
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

function registrar(ctx) {
  const { FECHA_VALIDA, db, ipcMain } = ctx;

  // Un pedido se puede programar para un día futuro (anotado hoy para el viernes): hasta ese día queda aparte, como
  // "programado". Para hoy o un día pasado no se programa nada (null: es del día en que se anotó).
  const hoyISO = () => db.prepare("SELECT date('now', 'localtime') AS d").get().d;
  const paraFechaValida = (v) => (typeof v === 'string' && FECHA_VALIDA.test(v) && v > hoyISO() ? v : null);

  // Una línea puede pedirse "por unidad" (6 chorizos) solo si el producto se vende por kilo y lo permite; si no, vale la
  // unidad del producto. Devuelve 'unidad' o null.
  const unidadPedidoValida = db.prepare("SELECT 1 FROM productos WHERE id = ? AND unidad = 'kg' AND pedible_por_unidad = 1");
  const unidadDeLinea = (item) => (item.unidad_pedido === 'unidad' && unidadPedidoValida.get(item.producto_id) ? 'unidad' : null);
  const insertarItem = () => db.prepare('INSERT INTO pedido_items (pedido_id, producto_id, cantidad, unidad_pedido) VALUES (?, ?, ?, ?)');

  ipcMain.handle('pedidos:listar', () => {
    const pedidos = db
      .prepare(
        `SELECT p.*,
                (c.nombre || CASE WHEN c.apellido IS NOT NULL AND c.apellido != '' THEN ' ' || c.apellido ELSE '' END) as cliente_nombre,
                u.nombre as creado_por_nombre,
                u.rol as creado_por_rol
         FROM pedidos p
         JOIN clientes c ON c.id = p.cliente_id
         LEFT JOIN usuarios u ON u.id = p.creado_por
         ORDER BY p.fecha DESC`
      )
      .all();
    const getItems = db.prepare(
      `SELECT pi.cantidad, pr.nombre as producto_nombre, COALESCE(pi.unidad_pedido, pr.unidad) as producto_unidad
       FROM pedido_items pi
       JOIN productos pr ON pr.id = pi.producto_id
       WHERE pi.pedido_id = ?`
    );
    return pedidos.map((p) => ({
      ...p,
      resumen: getItems
        .all(p.id)
        .map((i) => `${i.cantidad}${i.producto_unidad === 'kg' ? 'kg' : 'u.'} ${i.producto_nombre}`)
        .join(', '),
    }));
  });

  ipcMain.handle('pedidos:items', (_event, pedidoId) => {
    return db
      .prepare(
        `SELECT pi.*, pr.nombre as producto_nombre, pr.unidad as producto_unidad, pr.peso_unidad_pedido,
                pr.precio_cliente, pr.precio_cf
         FROM pedido_items pi
         JOIN productos pr ON pr.id = pi.producto_id
         WHERE pi.pedido_id = ?`
      )
      .all(pedidoId);
  });

  ipcMain.handle('pedidos:crear', (_event, { cliente_id, items, para_fecha }) => {
    const insertPedido = db.prepare('INSERT INTO pedidos (cliente_id, creado_por, para_fecha) VALUES (?, ?, ?)');
    const insertItem = insertarItem();
    const crear = db.transaction(() => {
      const info = insertPedido.run(cliente_id, ctx.usuarioActual ? ctx.usuarioActual.id : null, paraFechaValida(para_fecha));
      const pedidoId = info.lastInsertRowid;
      for (const item of items) {
        insertItem.run(pedidoId, item.producto_id, item.cantidad, unidadDeLinea(item));
      }
      return pedidoId;
    });
    return { ok: true, id: crear() };
  });

  ipcMain.handle('pedidos:marcarFacturado', (_event, { id, factura_id, items }) => {
    const marcar = db.transaction(() => {
      db.prepare("UPDATE pedidos SET estado = 'facturado', factura_id = ? WHERE id = ?").run(
        factura_id,
        id
      );
      if (items) {
        // Lo pedido por unidad ("6 chorizos") se conserva tal cual, junto con lo que se pidió en kilos de ese mismo producto
        // (la factura puede tener dos líneas del mismo producto y no se sabe cuál es cuál): lo facturado en kilos queda en
        // la factura y el pedido sigue diciendo qué pidieron.
        const productosPorUnidad = new Set(db.prepare("SELECT producto_id FROM pedido_items WHERE pedido_id = ? AND unidad_pedido = 'unidad'").all(id).map((r) => r.producto_id));
        const conservadas = db.prepare('SELECT producto_id, cantidad, unidad_pedido FROM pedido_items WHERE pedido_id = ?').all(id).filter((r) => productosPorUnidad.has(r.producto_id));
        db.prepare('DELETE FROM pedido_items WHERE pedido_id = ?').run(id);
        const insertItem = insertarItem();
        for (const item of items) {
          if (!productosPorUnidad.has(item.producto_id)) insertItem.run(id, item.producto_id, item.cantidad, null);
        }
        conservadas.forEach((r) => insertItem.run(id, r.producto_id, r.cantidad, r.unidad_pedido));
      }
    });
    marcar();
    return { ok: true };
  });

  ipcMain.handle('pedidos:actualizar', (_event, { id, items, para_fecha }) => {
    const actualizar = db.transaction(() => {
      // Con `para_fecha` en el pedido que llega se cambia el día programado (vacío o de hoy: deja de estar programado).
      if (para_fecha !== undefined) db.prepare('UPDATE pedidos SET para_fecha = ? WHERE id = ?').run(paraFechaValida(para_fecha), id);
      db.prepare('DELETE FROM pedido_items WHERE pedido_id = ?').run(id);
      const insertItem = insertarItem();
      for (const item of items) {
        insertItem.run(id, item.producto_id, item.cantidad, unidadDeLinea(item));
      }
    });
    actualizar();
    return { ok: true };
  });

  ipcMain.handle('pedidos:eliminar', (_event, id) => {
    db.prepare('DELETE FROM pedidos WHERE id = ?').run(id);
    return { ok: true };
  });
}

module.exports = { registrar };
