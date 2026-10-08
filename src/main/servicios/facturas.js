// Facturas, cobros, anulaciones, notas de crédito y lista de carga.
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

function registrar(ctx) {
  const { db, esMetodoCheque, insertarChequeDeCobro, ipcMain, redondear2, registrarRetencionTransferencia, validarChequeDeCobro } = ctx;
  const idUsuarioActual = () => (ctx.usuarioActual ? ctx.usuarioActual.id : null);

  // Un pago con este método es un crédito (saldo a favor) aplicado a una factura, no plata que entra.
  const METODO_CREDITO = 'Saldo a favor';

  // Corregir con qué se pagó un cobro (se cargó efectivo y era Mercado Pago, por ejemplo). Los cobros con cheque, con
  // saldo a favor y las devoluciones no se cambian. Todo lo demás (caja del día, Caja general, estadísticas) sale de
  // este dato, así que se corrige solo.
  // Queda registrado quién lo cambió, cuándo y por qué (un empleado tiene que decir el motivo); si el cobro tenía una
  // retención por transferencia, se rehace con el método nuevo (si pasó a efectivo no hay retención, y al revés).
  ipcMain.handle('pagos:cambiarMetodo', (_event, { ids, metodo_pago, motivo }) => {
    const lista = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
    if (!lista.length) return { ok: false, error: 'No hay nada para corregir.' };
    const metodo = db.prepare('SELECT nombre FROM metodos_pago WHERE activo = 1 AND lower(nombre) = lower(?)').get(String(metodo_pago || '').trim());
    if (!metodo || /^(cheque|saldo a favor)$/i.test(metodo.nombre.trim())) return { ok: false, error: 'Elegí con qué se pagó.' };
    const pagos = lista.map((id) => db.prepare('SELECT p.id, p.monto, p.metodo_pago, p.fecha, COALESCE(f.cliente_id, p.cliente_id) AS cliente_id FROM pagos p LEFT JOIN facturas f ON f.id = p.factura_id WHERE p.id = ?').get(id));
    if (pagos.some((p) => !p)) return { ok: false, error: 'Ese cobro ya no existe.' };
    if (pagos.some((p) => p.monto <= 0 || /^(cheque|saldo a favor)$/i.test(String(p.metodo_pago).trim()))) {
      return { ok: false, error: 'Un cobro con cheque, con saldo a favor o una devolución no se puede cambiar.' };
    }
    const motivoLimpio = String(motivo || '').trim().slice(0, 200);
    if (ctx.usuarioActual && ctx.usuarioActual.rol === 'empleado' && !motivoLimpio) return { ok: false, error: 'Poné el motivo del cambio.' };
    const idsSet = new Set(lista);
    // La retención sale del cobro completo: si el cambio toca solo una parte, no se sabría cuánto corresponde de cada una.
    const retenciones = db.prepare('SELECT id, fecha, pago_ids FROM gastos WHERE pago_ids IS NOT NULL').all().filter((g) => String(g.pago_ids).split(',').some((x) => idsSet.has(Number(x))));
    if (retenciones.some((g) => !String(g.pago_ids).split(',').every((x) => idsSet.has(Number(x))))) {
      return { ok: false, error: 'Ese cobro está repartido en varias partes: corregí todas juntas.' };
    }
    db.transaction(() => {
      lista.forEach((id) => db.prepare('UPDATE pagos SET metodo_pago = ? WHERE id = ?').run(metodo.nombre, id));
      const fechaRetencion = retenciones.length ? retenciones[0].fecha : String(pagos[0].fecha).slice(0, 10);
      retenciones.forEach((g) => db.prepare('DELETE FROM gastos WHERE id = ?').run(g.id));
      registrarRetencionTransferencia(metodo.nombre, redondear2(pagos.reduce((a, p) => a + p.monto, 0)), fechaRetencion, null, lista);
      db.prepare('INSERT INTO cobros_metodo_cambiado (cliente_id, pago_ids, monto, metodo_anterior, metodo_nuevo, motivo, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        pagos[0].cliente_id,
        lista.join(','),
        redondear2(pagos.reduce((a, p) => a + p.monto, 0)),
        [...new Set(pagos.map((p) => String(p.metodo_pago).trim()))].join(' y '),
        metodo.nombre,
        motivoLimpio || null,
        idUsuarioActual()
      );
    })();
    return { ok: true };
  });

  // Anular un cobro que se cargó por error (todas las partes de un mismo cobro, si se repartió entre varias facturas).
  // Las facturas vuelven a quedar con deuda, el saldo del cliente sube lo mismo y se anula la retención automática que
  // generó. No se anulan los cobros con cheque (el cheque ya está en la cartera), con saldo a favor ni las devoluciones.
  ipcMain.handle('pagos:anular', (_event, { ids, motivo }) => {
    const lista = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
    if (!lista.length) return { ok: false, error: 'No hay nada para anular.' };
    const pagos = lista.map((id) =>
      db.prepare('SELECT p.id, p.monto, p.metodo_pago, p.fecha, p.factura_id, COALESCE(f.cliente_id, p.cliente_id) AS cliente_id, f.estado FROM pagos p LEFT JOIN facturas f ON f.id = p.factura_id WHERE p.id = ?').get(id)
    );
    if (pagos.some((p) => !p)) return { ok: false, error: 'Ese cobro ya no existe.' };
    if (pagos.some((p) => p.estado === 'anulada')) return { ok: false, error: 'Esa factura ya está anulada.' };
    if (pagos.some((p) => p.monto <= 0 || /^(cheque|saldo a favor)$/i.test(String(p.metodo_pago).trim()))) {
      return { ok: false, error: 'Un cobro con cheque, con saldo a favor o una devolución no se puede anular desde acá.' };
    }
    // Un empleado siempre tiene que decir por qué (para que el administrador pueda revisarlo); a un administrador
    // se lo sigue dejando opcional, como siempre.
    if (ctx.usuarioActual && ctx.usuarioActual.rol === 'empleado' && !String(motivo || '').trim()) {
      return { ok: false, error: 'Poné el motivo de la anulación.' };
    }
    db.transaction(() => {
      // Se guarda tal cual (snapshot) antes de borrarlo, para poder "Reactivar" (deshacer la anulación) más adelante.
      const snapshot = pagos.map((p) => ({ factura_id: p.factura_id, monto: p.monto, metodo_pago: p.metodo_pago, fecha: p.fecha }));
      const idsSet = new Set(lista);
      const retencionGasto = db
        .prepare('SELECT id, pago_ids, categoria_id, descripcion, monto, medio_pago, cuenta, ingreso_id FROM gastos WHERE pago_ids IS NOT NULL')
        .all()
        // Solo si se anula todo el cobro del que salió la retención.
        .find((g) => String(g.pago_ids).split(',').every((x) => idsSet.has(Number(x))));
      const retencionSnapshot = retencionGasto
        ? { categoria_id: retencionGasto.categoria_id, descripcion: retencionGasto.descripcion, monto: retencionGasto.monto, medio_pago: retencionGasto.medio_pago, cuenta: retencionGasto.cuenta, ingreso_id: retencionGasto.ingreso_id }
        : null;
      db.prepare(
        'INSERT INTO cobros_anulados (cliente_id, fecha_cobro, monto, metodo, facturas, motivo, snapshot, retencion_snapshot, anulado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        pagos[0].cliente_id,
        snapshot.map((s) => s.fecha).filter(Boolean).sort()[0] || null,
        redondear2(pagos.reduce((a, p) => a + p.monto, 0)),
        [...new Set(pagos.map((p) => String(p.metodo_pago).trim()))].join(' y '),
        [...new Set(pagos.map((p) => p.factura_id).filter((n) => n != null))].sort((a, b) => a - b).join(','),
        String(motivo || '').trim().slice(0, 200) || null,
        JSON.stringify(snapshot),
        retencionSnapshot ? JSON.stringify(retencionSnapshot) : null,
        idUsuarioActual()
      );
      pagos.forEach((p) => db.prepare('DELETE FROM pagos WHERE id = ?').run(p.id));
      // Un cobro sin factura (del saldo anterior) no toca ninguna factura: solo devuelve la deuda al saldo.
      new Set(pagos.map((p) => p.factura_id).filter((n) => n != null)).forEach((facturaId) => {
        const f = db.prepare('SELECT total FROM facturas WHERE id = ?').get(facturaId);
        const pagado = db.prepare('SELECT COALESCE(SUM(monto), 0) AS t FROM pagos WHERE factura_id = ?').get(facturaId).t;
        const estado = pagado <= 0.005 ? 'pendiente' : pagado >= f.total - 0.005 ? 'pagada' : 'parcial';
        db.prepare('UPDATE facturas SET estado = ?, fecha_pago = CASE WHEN ? = \'pagada\' THEN fecha_pago ELSE NULL END WHERE id = ?').run(estado, estado, facturaId);
      });
      const porCliente = {};
      pagos.forEach((p) => (porCliente[p.cliente_id] = redondear2((porCliente[p.cliente_id] || 0) + p.monto)));
      Object.entries(porCliente).forEach(([clienteId, monto]) => {
        db.prepare('UPDATE clientes SET saldo = ROUND(saldo + ?, 2) WHERE id = ?').run(monto, Number(clienteId));
      });
      if (retencionGasto) db.prepare('DELETE FROM gastos WHERE id = ?').run(retencionGasto.id);
    })();
    return { ok: true };
  });

  // Deshace una anulación de cobro (la "Reactivar" que aparece en la ficha del cliente): recrea los cobros tal cual
  // estaban, con la misma fecha, y la retención automática si la hubo. No se puede si alguna de las facturas
  // involucradas se anuló después (quedaría un cobro sobre una factura anulada).
  ipcMain.handle('pagos:reactivarCobro', (_event, id) => {
    const anulado = db.prepare('SELECT * FROM cobros_anulados WHERE id = ?').get(Number(id));
    if (!anulado) return { ok: false, error: 'Ese cobro anulado ya no existe.' };
    if (anulado.reactivado_en) return { ok: false, error: 'Ese cobro ya se había reactivado antes.' };
    let snapshot = [];
    try {
      snapshot = JSON.parse(anulado.snapshot || '[]');
    } catch (e) {
      snapshot = [];
    }
    if (!snapshot.length) return { ok: false, error: 'Esta anulación es de antes de que se pudiera reactivar: no se puede deshacer.' };
    const facturaIds = [...new Set(snapshot.map((s) => s.factura_id).filter((n) => n != null))];
    const facturas = facturaIds.map((fid) => db.prepare('SELECT * FROM facturas WHERE id = ?').get(fid));
    if (facturas.some((f) => !f)) return { ok: false, error: 'Una de las facturas de ese cobro ya no existe.' };
    if (facturas.some((f) => f.estado === 'anulada')) {
      return { ok: false, error: 'Una de las facturas de ese cobro se anuló después: no se puede reactivar.' };
    }
    db.transaction(() => {
      const nuevosIds = snapshot.map(
        (s) => Number(db.prepare('INSERT INTO pagos (factura_id, cliente_id, monto, metodo_pago, fecha) VALUES (?, ?, ?, ?, ?)').run(s.factura_id == null ? null : s.factura_id, s.factura_id == null ? anulado.cliente_id : null, s.monto, s.metodo_pago, s.fecha).lastInsertRowid)
      );
      facturaIds.forEach((facturaId) => {
        const f = db.prepare('SELECT total FROM facturas WHERE id = ?').get(facturaId);
        const pagado = db.prepare('SELECT COALESCE(SUM(monto), 0) AS t FROM pagos WHERE factura_id = ?').get(facturaId).t;
        const estado = pagado <= 0.005 ? 'pendiente' : pagado >= f.total - 0.005 ? 'pagada' : 'parcial';
        db.prepare(
          `UPDATE facturas SET estado = ?, fecha_pago = CASE WHEN ? = 'pagada' THEN COALESCE(fecha_pago, datetime('now', 'localtime')) ELSE NULL END WHERE id = ?`
        ).run(estado, estado, facturaId);
      });
      db.prepare('UPDATE clientes SET saldo = ROUND(saldo - ?, 2) WHERE id = ?').run(anulado.monto, anulado.cliente_id);
      if (anulado.retencion_snapshot) {
        const rs = JSON.parse(anulado.retencion_snapshot);
        db.prepare(
          `INSERT INTO gastos (fecha, categoria_id, descripcion, monto, medio_pago, cuenta, ingreso_id, pago_ids) VALUES (date('now', 'localtime'), ?, ?, ?, ?, ?, ?, ?)`
        ).run(rs.categoria_id, rs.descripcion, rs.monto, rs.medio_pago, rs.cuenta, rs.ingreso_id, nuevosIds.join(','));
      }
      db.prepare(`UPDATE cobros_anulados SET reactivado_en = datetime('now', 'localtime') WHERE id = ?`).run(anulado.id);
    })();
    return { ok: true };
  });

  ipcMain.handle('facturas:listar', () => {
    return db
      .prepare(
        `SELECT f.*,
                (c.nombre || CASE WHEN c.apellido IS NOT NULL AND c.apellido != '' THEN ' ' || c.apellido ELSE '' END) as cliente_nombre,
                c.telefono as cliente_telefono,
                c.telefono2 as cliente_telefono2,
                c.telefono2_nombre as cliente_telefono2_nombre,
                COALESCE((SELECT SUM(monto) FROM pagos WHERE factura_id = f.id), 0) as pagado,
                uc.nombre as creado_por_nombre,
                uc.rol as creado_por_rol,
                ua.nombre as anulado_por_nombre,
                ua.rol as anulado_por_rol
         FROM facturas f
         JOIN clientes c ON c.id = f.cliente_id
         LEFT JOIN usuarios uc ON uc.id = f.creado_por
         LEFT JOIN usuarios ua ON ua.id = f.anulado_por
         ORDER BY f.fecha DESC`
      )
      .all();
  });

  ipcMain.handle('facturas:pagos', (_event, facturaId) => {
    return db
      .prepare('SELECT * FROM pagos WHERE factura_id = ? ORDER BY fecha DESC')
      .all(facturaId);
  });

  ipcMain.handle('facturas:items', (_event, facturaId) => {
    const items = db
      .prepare(
        `SELECT fi.*, p.nombre as producto_nombre, p.unidad as producto_unidad
         FROM factura_items fi
         JOIN productos p ON p.id = fi.producto_id
         WHERE fi.factura_id = ?`
      )
      .all(facturaId);
    const bultos = db.prepare('SELECT id, peso, cargado FROM factura_bultos WHERE factura_item_id = ? ORDER BY orden, id');
    items.forEach((i) => {
      i.bultos = bultos.all(i.id);
    });
    return items;
  });

  // Lo que llega de la pantalla ya viene validado; esto es la defensa del servidor (una factura sin renglones, con
  // cantidad cero o negativa o con un producto que no existe movería el saldo del cliente con importes sin sentido).
  function errorDeItems(items) {
    if (!Array.isArray(items) || items.length === 0) return 'Agregá al menos un producto.';
    for (const item of items) {
      if (!item || !db.prepare('SELECT 1 FROM productos WHERE id = ?').get(Number(item.producto_id))) return 'Uno de los productos ya no existe.';
      if (!Number.isFinite(Number(item.cantidad)) || !(Number(item.cantidad) > 0)) return 'La cantidad de cada producto tiene que ser mayor a cero.';
      if (item.precio_unitario !== undefined && item.precio_unitario !== null && (!Number.isFinite(Number(item.precio_unitario)) || Number(item.precio_unitario) < 0)) {
        return 'El precio de cada producto tiene que ser un número válido.';
      }
    }
    return null;
  }

  // Guarda una línea de factura y su bulto; devuelve el subtotal. Cada línea es un bulto: en un producto por kilo,
  // con el peso de la línea (lo que se facturó es lo que pesa la bolsa); en uno por unidad, sin peso (la línea
  // entera). Arranca sin tildar: el tilde es "verificado" (2026-09-21: facturar ya implica que está preparado; se verifica que estén las bolsas y cajas).
  function guardarItemDeFactura(facturaId, item, tipoPrecio) {
    const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(item.producto_id);
    const precioCatalogo = tipoPrecio === 'cf' ? producto.precio_cf : producto.precio_cliente;
    const precioUnitario =
      item.precio_unitario !== undefined && item.precio_unitario !== null ? item.precio_unitario : precioCatalogo;
    const cantidad = item.cantidad;
    // El subtotal de cada línea es en centavos (como se ve y se imprime): así el total de la factura siempre es un monto
    // exacto y "cobrar lo que dice la pantalla" la deja saldada, sin restos de fracciones de centavo.
    const subtotal = redondear2(precioUnitario * cantidad);
    // Lo que pidieron por unidad ("6 chorizos") queda anotado en la línea, que se pesó en kilos: solo en productos por kilo.
    const pedidoUnidades = producto.unidad === 'kg' && Number(item.pedido_unidades) > 0 ? Number(item.pedido_unidades) : null;
    const itemId = Number(
      db
        .prepare('INSERT INTO factura_items (factura_id, producto_id, cantidad, precio_unitario, subtotal, pedido_unidades) VALUES (?, ?, ?, ?, ?, ?)')
        .run(facturaId, item.producto_id, cantidad, precioUnitario, subtotal, pedidoUnidades).lastInsertRowid
    );
    db.prepare('INSERT INTO factura_bultos (factura_item_id, orden, peso, cargado) VALUES (?, 0, ?, 0)').run(
      itemId,
      producto.unidad === 'kg' ? cantidad : null
    );
    return subtotal;
  }

  // Lista de carga del día: por producto, los bultos (bolsas / cajas con su peso) de las facturas de hoy y, aparte,
  // lo que se pidió hoy y todavía no se facturó (o sea, no se pesó). Las líneas facturadas antes de que existieran
  // los bultos reciben los suyos la primera vez que se pide la lista.
  ipcMain.handle('carga:hoy', () => {
    const hoy = db.prepare("SELECT date('now', 'localtime') AS hoy").get().hoy;
    const nombreCliente = `(c.nombre || CASE WHEN c.apellido IS NOT NULL AND c.apellido != '' THEN ' ' || c.apellido ELSE '' END)`;
    const lineas = db
      .prepare(
        `SELECT fi.id, fi.producto_id, fi.cantidad, p.nombre, p.unidad, f.id AS factura_id, ${nombreCliente} AS cliente
         FROM factura_items fi
         JOIN facturas f ON f.id = fi.factura_id
         JOIN productos p ON p.id = fi.producto_id
         JOIN clientes c ON c.id = f.cliente_id
         WHERE substr(f.fecha, 1, 10) = ? AND f.estado != 'anulada'
         ORDER BY f.id, fi.id`
      )
      .all(hoy);
    const bultosDe = db.prepare('SELECT id, peso, cargado FROM factura_bultos WHERE factura_item_id = ? ORDER BY orden, id');
    const insertarBulto = db.prepare('INSERT INTO factura_bultos (factura_item_id, orden, peso, cargado) VALUES (?, 0, ?, 0)');
    const porProducto = new Map();
    const producto = (id, nombre, unidad) => {
      if (!porProducto.has(id)) porProducto.set(id, { producto_id: id, nombre, unidad, bultos: [], pendiente: null });
      return porProducto.get(id);
    };
    db.transaction(() => {
      lineas.forEach((l) => {
        let bultos = bultosDe.all(l.id);
        if (!bultos.length) {
          insertarBulto.run(l.id, l.unidad === 'kg' ? l.cantidad : null);
          bultos = bultosDe.all(l.id);
        }
        const p = producto(l.producto_id, l.nombre, l.unidad);
        bultos.forEach((b) =>
          p.bultos.push({ id: b.id, peso: b.peso, cargado: b.cargado === 1, cantidad: l.unidad === 'kg' ? null : l.cantidad, cliente: l.cliente, factura_id: l.factura_id })
        );
      });
    })();
    db.prepare(
      `SELECT pi.producto_id, pi.cantidad, pi.unidad_pedido, pr.nombre, pr.unidad, pr.peso_unidad_pedido, ${nombreCliente} AS cliente
       FROM pedido_items pi
       JOIN pedidos pe ON pe.id = pi.pedido_id
       JOIN productos pr ON pr.id = pi.producto_id
       JOIN clientes c ON c.id = pe.cliente_id
       WHERE pe.estado = 'pendiente' AND substr(pe.fecha, 1, 10) = ?
       ORDER BY pe.id, pi.id`
    )
      .all(hoy)
      .forEach((r) => {
        const p = producto(r.producto_id, r.nombre, r.unidad);
        p.pendiente = p.pendiente || { cantidad: 0, unidades: 0, clientes: [] };
        // Lo pedido por unidad ("6 chorizos") se suma aparte de lo pedido en kilos.
        if (r.unidad_pedido === 'unidad') {
          p.pendiente.unidades = Math.round((p.pendiente.unidades + r.cantidad) * 1000) / 1000;
          p.pendiente.peso_unidad = r.peso_unidad_pedido || null;
        } else {
          p.pendiente.cantidad = Math.round((p.pendiente.cantidad + r.cantidad) * 1000) / 1000;
        }
        if (!p.pendiente.clientes.includes(r.cliente)) p.pendiente.clientes.push(r.cliente);
      });
    return { fecha: hoy, productos: [...porProducto.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) };
  });

  ipcMain.handle('carga:marcar', (_event, { id, cargado }) => {
    db.prepare('UPDATE factura_bultos SET cargado = ? WHERE id = ?').run(cargado ? 1 : 0, Number(id));
    return { ok: true };
  });

  // Tilda o destilda todos los bultos de las facturas de hoy.
  ipcMain.handle('carga:marcarTodos', (_event, { cargado }) => {
    const hoy = db.prepare("SELECT date('now', 'localtime') AS hoy").get().hoy;
    db.prepare(
      `UPDATE factura_bultos SET cargado = ?
       WHERE factura_item_id IN (
         SELECT fi.id FROM factura_items fi JOIN facturas f ON f.id = fi.factura_id
         WHERE substr(f.fecha, 1, 10) = ? AND f.estado != 'anulada')`
    ).run(cargado ? 1 : 0, hoy);
    return { ok: true };
  });

  ipcMain.handle('facturas:crear', (_event, { cliente_id, tipo_precio, items }) => {
    if (!db.prepare('SELECT 1 FROM clientes WHERE id = ?').get(Number(cliente_id))) throw new Error('Ese cliente ya no existe.');
    const errorItems = errorDeItems(items);
    if (errorItems) throw new Error(errorItems);
    const insertFactura = db.prepare(
      'INSERT INTO facturas (cliente_id, tipo_precio, total, creado_por, vendedor_id) VALUES (?, ?, 0, ?, (SELECT vendedor_id FROM clientes WHERE id = ?))'
    );
    const updateTotal = db.prepare('UPDATE facturas SET total = ? WHERE id = ?');
    const updateSaldo = db.prepare('UPDATE clientes SET saldo = ROUND(saldo + ?, 2) WHERE id = ?');

    const crear = db.transaction(() => {
      const facturaInfo = insertFactura.run(cliente_id, tipo_precio, idUsuarioActual(), cliente_id);
      const facturaId = facturaInfo.lastInsertRowid;
      let total = 0;
      for (const item of items) {
        total += guardarItemDeFactura(facturaId, item, tipo_precio);
      }
      total = redondear2(total);
      updateTotal.run(total, facturaId);
      updateSaldo.run(total, cliente_id);
      // Si el cliente tenía saldo a favor, se usa enseguida para esta factura.
      aplicarCreditoDelCliente(cliente_id);
      return db.prepare('SELECT * FROM facturas WHERE id = ?').get(facturaId);
    });

    return crear();
  });

  ipcMain.handle('facturas:actualizar', (_event, { id, tipo_precio, items }) => {
    const factura = db.prepare('SELECT * FROM facturas WHERE id = ?').get(id);
    const pagado = db
      .prepare('SELECT COALESCE(SUM(monto), 0) as total FROM pagos WHERE factura_id = ?')
      .get(id).total;
    const hoy = db.prepare("SELECT date('now', 'localtime') as hoy").get().hoy;
    const fechaFactura = factura.fecha.slice(0, 10);

    if (factura.estado === 'anulada') {
      return { ok: false, error: 'No se puede editar una factura anulada.' };
    }
    if (fechaFactura !== hoy) {
      return { ok: false, error: 'Solo se puede editar una factura el mismo día que se creó.' };
    }
    const errorItems = errorDeItems(items);
    if (errorItems) return { ok: false, error: errorItems };

    const deleteItems = db.prepare('DELETE FROM factura_items WHERE factura_id = ?');

    const actualizar = db.transaction(() => {
      deleteItems.run(id);
      let total = 0;
      for (const item of items) {
        total += guardarItemDeFactura(id, item, tipo_precio);
      }
      total = redondear2(total);

      const nuevoEstado = pagado >= total - 0.005 ? 'pagada' : pagado > 0 ? 'parcial' : 'pendiente';
      if (nuevoEstado === 'pagada') {
        db.prepare(
          "UPDATE facturas SET tipo_precio = ?, total = ?, estado = ?, fecha_pago = COALESCE(fecha_pago, datetime('now', 'localtime')) WHERE id = ?"
        ).run(tipo_precio, total, nuevoEstado, id);
      } else {
        db.prepare(
          'UPDATE facturas SET tipo_precio = ?, total = ?, estado = ?, fecha_pago = NULL WHERE id = ?'
        ).run(tipo_precio, total, nuevoEstado, id);
      }

      const delta = total - factura.total;
      db.prepare('UPDATE clientes SET saldo = ROUND(saldo + ?, 2) WHERE id = ?').run(
        delta,
        factura.cliente_id
      );
      return db.prepare('SELECT * FROM facturas WHERE id = ?').get(id);
    });

    return { ok: true, factura: actualizar() };
  });

  ipcMain.handle('facturas:registrarPago', (_event, { factura_id, monto, metodo_pago, cheque }) => {
    const factura = db.prepare('SELECT * FROM facturas WHERE id = ?').get(factura_id);
    if (!factura) throw new Error('Esa factura ya no existe.');
    if (factura.estado === 'anulada') throw new Error('Esa factura está anulada: no se le pueden cargar cobros.');
    if (!Number.isFinite(Number(monto)) || !(Number(monto) > 0)) throw new Error('El monto tiene que ser mayor a cero.');
    const datosCheque = esMetodoCheque(metodo_pago) ? validarChequeDeCobro(cheque) : null;
    if (datosCheque && datosCheque.error) throw new Error(datosCheque.error);
    const pagadoPrevio = db
      .prepare('SELECT COALESCE(SUM(monto), 0) as total FROM pagos WHERE factura_id = ?')
      .get(factura_id).total;
    const restante = factura.total - pagadoPrevio;
    const montoAplicado = Math.max(0, Math.min(monto, restante));

    const registrar = db.transaction(() => {
      const idPago = db
        .prepare('INSERT INTO pagos (factura_id, monto, metodo_pago, creado_por) VALUES (?, ?, ?, ?)')
        .run(factura_id, montoAplicado, metodo_pago || 'Efectivo', idUsuarioActual()).lastInsertRowid;
      const nuevoPagado = pagadoPrevio + montoAplicado;
      const nuevoEstado =
        nuevoPagado >= factura.total - 0.005 ? 'pagada' : nuevoPagado > 0 ? 'parcial' : 'pendiente';
      if (nuevoEstado === 'pagada') {
        db.prepare(
          "UPDATE facturas SET estado = ?, fecha_pago = datetime('now', 'localtime') WHERE id = ?"
        ).run(nuevoEstado, factura_id);
      } else {
        db.prepare('UPDATE facturas SET estado = ? WHERE id = ?').run(nuevoEstado, factura_id);
      }
      db.prepare('UPDATE clientes SET saldo = ROUND(saldo - ?, 2) WHERE id = ?').run(
        montoAplicado,
        factura.cliente_id
      );
      if (datosCheque && montoAplicado > 0) {
        insertarChequeDeCobro({ datos: datosCheque, importe: montoAplicado, clienteId: factura.cliente_id });
      }
      registrarRetencionTransferencia(metodo_pago, montoAplicado, null, null, [idPago]);
    });

    registrar();
    return db.prepare('SELECT * FROM facturas WHERE id = ?').get(factura_id);
  });

  // El saldo a favor de un cliente es su saldo negativo. Mientras haya facturas pendientes, se usa enseguida
  // para pagarlas (la más vieja primero) con pagos de método "Saldo a favor": el saldo no cambia (el crédito
  // se gasta y la deuda baja lo mismo), y esos pagos no cuentan como plata que entra.
  function aplicarCreditoDelCliente(clienteId) {
    const creados = []; // ids de los pagos "Saldo a favor" que se crearon (para poder deshacerlos al reactivar una factura anulada)
    const saldo = db.prepare('SELECT saldo FROM clientes WHERE id = ?').get(clienteId).saldo;
    const pendientes = db
      .prepare(
        `SELECT f.id, f.total, COALESCE((SELECT SUM(monto) FROM pagos WHERE factura_id = f.id), 0) AS pagado
         FROM facturas f WHERE f.cliente_id = ? AND f.estado IN ('pendiente', 'parcial') ORDER BY f.fecha, f.id`
      )
      .all(clienteId);
    // El saldo ya resta lo que el cliente debe en esas facturas: con $10.000 a favor y una factura nueva de $6.000 el saldo dice
    // -$4.000, pero el crédito que hay para gastar son los $10.000 (se usaban solo los $4.000 y la factura quedaba debiendo $2.000
    // teniendo plata a favor). Lo que se puede aplicar a las facturas es lo que supera el saldo, hasta lo que deben.
    const deuda = redondear2(pendientes.reduce((acc, f) => acc + (f.total - f.pagado), 0));
    let credito = Math.min(deuda, redondear2(Math.max(0, deuda - saldo)));
    if (credito <= 0.005) return creados;
    for (const f of pendientes) {
      if (credito <= 0.005) break;
      const debe = redondear2(f.total - f.pagado);
      const aplicado = redondear2(Math.min(credito, debe));
      if (aplicado <= 0) continue;
      creados.push(Number(db.prepare('INSERT INTO pagos (factura_id, monto, metodo_pago) VALUES (?, ?, ?)').run(f.id, aplicado, METODO_CREDITO).lastInsertRowid));
      const pagada = f.pagado + aplicado >= f.total - 0.005;
      if (pagada) db.prepare("UPDATE facturas SET estado = 'pagada', fecha_pago = datetime('now', 'localtime') WHERE id = ?").run(f.id);
      else db.prepare("UPDATE facturas SET estado = 'parcial' WHERE id = ?").run(f.id);
      credito = redondear2(credito - aplicado);
    }
    return creados;
  }

  // Anular una factura. Si ya tenía pagos, lo pagado queda como saldo a favor del cliente (`destino: 'credito'`,
  // lo normal) o se devuelve en plata (`destino: 'devolver'`, con `metodo` y, si no es todo, `monto`): la
  // devolución es un pago negativo, así la caja y las estadísticas descuentan esa plata. Lo que no se devuelve
  // (y lo pagado con cheque o con saldo a favor) queda como crédito.
  ipcMain.handle('facturas:anular', (_event, { id, motivo, destino, metodo, monto }) => {
    const factura = db.prepare('SELECT * FROM facturas WHERE id = ?').get(id);
    if (!factura) return { ok: false, error: 'Factura no encontrada.' };
    if (factura.estado === 'anulada') {
      return { ok: false, error: 'Esta factura ya está anulada.' };
    }
    if (ctx.usuarioActual && ctx.usuarioActual.rol === 'empleado' && !String(motivo || '').trim()) {
      return { ok: false, error: 'Poné el motivo de la anulación.' };
    }
    const pagos = db.prepare('SELECT monto, metodo_pago FROM pagos WHERE factura_id = ?').all(id);
    const pagado = redondear2(pagos.reduce((acc, p) => acc + p.monto, 0));
    const esCredito = (p) => String(p.metodo_pago).trim().toLowerCase() === 'saldo a favor';
    // Devolvible en plata: lo que entró como cobro, sin los cheques (siguen en la cartera) ni el crédito aplicado.
    const devolvible = redondear2(pagos.filter((p) => !esCredito(p) && !esMetodoCheque(p.metodo_pago)).reduce((acc, p) => acc + p.monto, 0));

    let devuelto = 0;
    let metodoDevolucion = null;
    if (pagado > 0.005 && destino === 'devolver') {
      metodoDevolucion = String(metodo || '').trim();
      const metodoValido = db.prepare('SELECT nombre FROM metodos_pago WHERE activo = 1 AND lower(nombre) = lower(?)').get(metodoDevolucion);
      if (!metodoValido || esMetodoCheque(metodoValido.nombre) || metodoValido.nombre.toLowerCase() === 'saldo a favor') {
        return { ok: false, error: 'Elegí con qué se devuelve la plata.' };
      }
      metodoDevolucion = metodoValido.nombre;
      devuelto = monto === undefined || monto === null || monto === '' ? devolvible : redondear2(Number(monto));
      if (!Number.isFinite(devuelto) || devuelto <= 0) return { ok: false, error: 'Poné cuánto se devuelve.' };
      if (devuelto > devolvible + 0.005) return { ok: false, error: `Se puede devolver hasta $${devolvible} (lo demás fue con cheque o con saldo a favor).` };
    }
    const credito = redondear2(Math.max(0, pagado - devuelto));

    const anular = db.transaction(() => {
      db.prepare("UPDATE facturas SET estado = 'anulada', motivo_anulacion = ?, anulado_estado_previo = ?, anulado_por = ?, anulado_en = datetime('now', 'localtime') WHERE id = ?").run(motivo || null, factura.estado, idUsuarioActual(), id);
      // La factura sale de la deuda (total - pagado) y lo pagado que se queda pasa a ser saldo a favor.
      db.prepare('UPDATE clientes SET saldo = ROUND(saldo - ?, 2) WHERE id = ?').run(redondear2(factura.total - devuelto), factura.cliente_id);
      if (devuelto > 0) {
        const idDevolucion = db.prepare('INSERT INTO pagos (factura_id, monto, metodo_pago) VALUES (?, ?, ?)').run(id, -devuelto, metodoDevolucion).lastInsertRowid;
        db.prepare('UPDATE facturas SET anulado_devolucion_pago_id = ? WHERE id = ?').run(idDevolucion, id);
      }
      if (pagado > 0.005) {
        db.prepare('INSERT INTO notas_credito (factura_id, cliente_id, credito, devuelto, metodo_devolucion) VALUES (?, ?, ?, ?, ?)').run(
          id, factura.cliente_id, credito, devuelto, metodoDevolucion
        );
      }
      if (credito > 0.005) {
        // Se anota hasta qué pago había y cuáles pagos de crédito salieron de esta anulación: así, al reactivar, se
        // deshacen (siempre que ese crédito no se haya usado después en otra cosa).
        const tope = db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM pagos').get().m;
        const creados = aplicarCreditoDelCliente(factura.cliente_id);
        db.prepare('UPDATE facturas SET anulado_pago_tope = ?, anulado_credito_pagos = ? WHERE id = ?').run(tope, creados.join(','), id);
      }
    });

    anular();
    return { ok: true, credito, devuelto };
  });

  // Deshace la anulación de una factura ("Reactivar" en su detalle): vuelve al estado que tenía antes, saca la
  // devolución si hubo y borra la nota de crédito. Se niega (con un error claro, no un cálculo a ciegas) si el saldo
  // a favor que había generado ya se usó, aunque sea en parte, en otra factura — no hay forma segura de saber cuál
  // pago de "Saldo a favor" viene de acá una vez que se mezcló con el resto del saldo del cliente.
  ipcMain.handle('facturas:reactivar', (_event, id) => {
    const factura = db.prepare('SELECT * FROM facturas WHERE id = ?').get(Number(id));
    if (!factura) return { ok: false, error: 'Factura no encontrada.' };
    if (factura.estado !== 'anulada') return { ok: false, error: 'Esa factura no está anulada.' };
    if (!factura.anulado_estado_previo) {
      return { ok: false, error: 'Esta anulación es de antes de que se pudiera reactivar: no se puede deshacer.' };
    }
    const nota = db.prepare('SELECT * FROM notas_credito WHERE factura_id = ? ORDER BY id DESC LIMIT 1').get(id);
    const MENSAJE_CREDITO_USADO = 'El saldo a favor que generó esta anulación ya se usó en otra cosa: no se puede reactivar automáticamente.';
    // Los pagos de "Saldo a favor" que salieron de esta anulación (si se anotaron) se deshacen al reactivar. Se niega si ese
    // crédito se usó después en otra factura (ya no se sabría de dónde salió la plata) o si una de esas facturas se anuló.
    let creditoADeshacer = [];
    if (nota && nota.credito > 0.005 && factura.anulado_pago_tope !== null && factura.anulado_pago_tope !== undefined) {
      const ids = String(factura.anulado_credito_pagos || '').split(',').filter(Boolean).map(Number);
      const existentes = ids.map((pid) => db.prepare('SELECT p.id, p.factura_id, f.estado FROM pagos p JOIN facturas f ON f.id = p.factura_id WHERE p.id = ?').get(pid));
      const usadoDespues = db
        .prepare(
          `SELECT p.id FROM pagos p JOIN facturas f ON f.id = p.factura_id
           WHERE f.cliente_id = ? AND lower(trim(p.metodo_pago)) = 'saldo a favor' AND p.id > ?`
        )
        .all(factura.cliente_id, factura.anulado_pago_tope)
        .filter((r) => !ids.includes(r.id));
      if (existentes.some((e) => !e || e.estado === 'anulada') || usadoDespues.length) return { ok: false, error: MENSAJE_CREDITO_USADO };
      creditoADeshacer = existentes;
    } else if (nota && nota.credito > 0.005) {
      // Anulación de antes de que se anotara esto: solo se puede si todo el crédito sigue disponible.
      const cliente = db.prepare('SELECT saldo FROM clientes WHERE id = ?').get(factura.cliente_id);
      const disponible = redondear2(Math.max(0, -cliente.saldo));
      if (disponible + 0.01 < nota.credito) return { ok: false, error: MENSAJE_CREDITO_USADO };
    }
    db.transaction(() => {
      // Las facturas que se habían pagado con ese crédito vuelven a deber lo que tenían (el saldo del cliente no cambia).
      const afectadas = [...new Set(creditoADeshacer.map((e) => e.factura_id))];
      creditoADeshacer.forEach((e) => db.prepare('DELETE FROM pagos WHERE id = ?').run(e.id));
      afectadas.forEach((facturaId) => {
        const f = db.prepare('SELECT total FROM facturas WHERE id = ?').get(facturaId);
        const pagado = db.prepare('SELECT COALESCE(SUM(monto), 0) AS t FROM pagos WHERE factura_id = ?').get(facturaId).t;
        const estado = pagado <= 0.005 ? 'pendiente' : pagado >= f.total - 0.005 ? 'pagada' : 'parcial';
        db.prepare("UPDATE facturas SET estado = ?, fecha_pago = CASE WHEN ? = 'pagada' THEN fecha_pago ELSE NULL END WHERE id = ?").run(estado, estado, facturaId);
      });
      db.prepare(
        "UPDATE facturas SET estado = ?, motivo_anulacion = NULL, anulado_estado_previo = NULL, anulado_devolucion_pago_id = NULL, anulado_en = NULL, anulado_pago_tope = NULL, anulado_credito_pagos = NULL WHERE id = ?"
      ).run(factura.anulado_estado_previo, id);
      db.prepare('UPDATE clientes SET saldo = ROUND(saldo + ?, 2) WHERE id = ?').run(
        redondear2(factura.total - (nota ? nota.devuelto : 0)),
        factura.cliente_id
      );
      if (factura.anulado_devolucion_pago_id) db.prepare('DELETE FROM pagos WHERE id = ?').run(factura.anulado_devolucion_pago_id);
      if (nota) db.prepare('DELETE FROM notas_credito WHERE id = ?').run(nota.id);
    })();
    return { ok: true };
  });
}

module.exports = { registrar };
