// Proveedores, compras y pagos.
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

function registrar(ctx) {
  const { FECHA_VALIDA, SQL_PROVEEDORES, claveCuenta, db, ipcMain, listaDeCuentas, redondear2 } = ctx;

  // ---------- Proveedores y compras ----------
  // "Producto" (tabla `tipos_producto`) es una lista fija y propia que se edita (Vaca, Cerdo, Pollo, o lo
  // que agreguen); alcanza sola para identificar una compra. Una compra vieja no pierde su producto aunque
  // después se saque de la lista.
  const limpiarProducto = (t) => String(t || '').trim().slice(0, 40);
  const limpiarDescripcion = (t) => String(t || '').trim().slice(0, 120);

  ipcMain.handle('proveedores:tipos', () => {
    return db.prepare('SELECT id, nombre FROM tipos_producto ORDER BY nombre COLLATE NOCASE').all();
  });

  ipcMain.handle('proveedores:agregarTipo', (_event, nombre) => {
    const texto = limpiarProducto(nombre);
    if (!texto) return { ok: false, error: 'Escribí el nombre del producto.' };
    db.prepare(
      'INSERT OR IGNORE INTO tipos_producto (nombre, orden) VALUES (?, (SELECT COALESCE(MAX(orden), 0) + 1 FROM tipos_producto))'
    ).run(texto);
    return { ok: true };
  });

  ipcMain.handle('proveedores:quitarTipo', (_event, id) => {
    db.prepare('DELETE FROM tipos_producto WHERE id = ?').run(Number(id));
    return { ok: true };
  });

  ipcMain.handle('proveedores:listar', () => {
    return db.prepare(`${SQL_PROVEEDORES} ORDER BY p.nombre COLLATE NOCASE`).all();
  });

  function datosProveedor(p) {
    const nombre = String((p && p.nombre) || '').trim().slice(0, 120);
    if (!nombre) return { error: 'Poné el nombre del proveedor.' };
    const saldoInicial = p.saldo_inicial === undefined || p.saldo_inicial === '' || p.saldo_inicial === null ? 0 : Number(p.saldo_inicial);
    if (!Number.isFinite(saldoInicial)) return { error: 'El saldo inicial no es válido.' };
    return {
      nombre,
      telefono: String(p.telefono || '').trim().slice(0, 40) || null,
      nota: String(p.nota || '').trim().slice(0, 200) || null,
      saldoInicial: redondear2(saldoInicial),
    };
  }

  ipcMain.handle('proveedores:crear', (_event, p) => {
    const d = datosProveedor(p || {});
    if (d.error) return { ok: false, error: d.error };
    if (db.prepare('SELECT 1 FROM proveedores WHERE nombre = ?').get(d.nombre)) {
      return { ok: false, error: 'Ya hay un proveedor con ese nombre (si lo diste de baja, buscalo en "Dados de baja").' };
    }
    const info = db
      .prepare('INSERT INTO proveedores (nombre, telefono, nota, saldo_inicial) VALUES (?, ?, ?, ?)')
      .run(d.nombre, d.telefono, d.nota, d.saldoInicial);
    return { ok: true, id: Number(info.lastInsertRowid) };
  });

  ipcMain.handle('proveedores:actualizar', (_event, p) => {
    const d = datosProveedor(p || {});
    if (d.error) return { ok: false, error: d.error };
    const otro = db.prepare('SELECT id FROM proveedores WHERE nombre = ? AND id != ?').get(d.nombre, Number(p.id));
    if (otro) return { ok: false, error: 'Ya hay otro proveedor con ese nombre.' };
    const info = db
      .prepare('UPDATE proveedores SET nombre = ?, telefono = ?, nota = ?, saldo_inicial = ? WHERE id = ?')
      .run(d.nombre, d.telefono, d.nota, d.saldoInicial, Number(p.id));
    return info.changes ? { ok: true } : { ok: false, error: 'Ese proveedor ya no existe.' };
  });

  ipcMain.handle('proveedores:darDeBaja', (_event, id) => {
    db.prepare('UPDATE proveedores SET activo = 0 WHERE id = ?').run(id);
    return { ok: true };
  });

  // Borra el proveedor con todo lo suyo: compras, pagos y lista de productos. Los cheques que se usaron en
  // sus pagos vuelven a la cartera.
  ipcMain.handle('proveedores:eliminar', (_event, id) => {
    db.transaction(() => {
      db.prepare(
        `UPDATE cheques SET estado = 'en_cartera', entregado_a = NULL, fecha_entrega = NULL, pago_proveedor_id = NULL
         WHERE pago_proveedor_id IN (SELECT id FROM pagos_proveedor WHERE proveedor_id = ?)`
      ).run(id);
      db.prepare('DELETE FROM pagos_proveedor WHERE proveedor_id = ?').run(id);
      db.prepare('DELETE FROM devoluciones_proveedor WHERE proveedor_id = ?').run(id);
      db.prepare('DELETE FROM compras WHERE proveedor_id = ?').run(id);
      db.prepare('DELETE FROM proveedor_productos WHERE proveedor_id = ?').run(id);
      db.prepare('DELETE FROM proveedores WHERE id = ?').run(id);
    })();
    return { ok: true };
  });

  ipcMain.handle('proveedores:darDeAlta', (_event, id) => {
    db.prepare('UPDATE proveedores SET activo = 1 WHERE id = ?').run(id);
    return { ok: true };
  });

  // Compras y pagos de un proveedor (para la ficha). Cada compra trae sus líneas; cada pago, sus cheques.
  ipcMain.handle('proveedores:historial', (_event, id) => {
    const compras = db.prepare('SELECT * FROM compras WHERE proveedor_id = ? ORDER BY fecha, id').all(id);
    const items = db.prepare('SELECT * FROM compra_items WHERE compra_id = ? ORDER BY id');
    compras.forEach((c) => {
      c.items = items.all(c.id);
    });
    const pagos = db.prepare('SELECT * FROM pagos_proveedor WHERE proveedor_id = ? ORDER BY fecha, id').all(id);
    const cheques = db.prepare('SELECT id, banco, numero, importe, fecha_cobro FROM cheques WHERE pago_proveedor_id = ? ORDER BY id');
    const cuentasDelPago = db.prepare('SELECT cuenta, monto FROM pagos_proveedor_cuentas WHERE pago_proveedor_id = ? ORDER BY id');
    pagos.forEach((p) => {
      p.cheques = cheques.all(p.id);
      p.transferencias = cuentasDelPago.all(p.id);
      p.total = redondear2(p.efectivo + p.transferencia + p.cheques.reduce((acc, c) => acc + c.importe, 0));
    });
    const devoluciones = db.prepare('SELECT * FROM devoluciones_proveedor WHERE proveedor_id = ? ORDER BY fecha, id').all(id);
    return { compras, pagos, devoluciones };
  });

  // Nombres de productos ya comprados, con la última descripción, unidad y precio usados (para sugerir).
  ipcMain.handle('proveedores:productosComprados', () => {
    return db
      .prepare(
        `SELECT ci.producto, ci.descripcion, ci.unidad, ci.precio_kg
         FROM compra_items ci
         WHERE ci.id = (SELECT MAX(x.id) FROM compra_items x
                        WHERE lower(x.producto) = lower(ci.producto) AND lower(x.descripcion) = lower(ci.descripcion))
         ORDER BY ci.producto COLLATE NOCASE, ci.descripcion COLLATE NOCASE`
      )
      .all();
  });

  const limpiarUnidad = (u) => (u === 'unidad' ? 'unidad' : 'kg');

  // Valida y normaliza las líneas de una compra. El importe de cada línea es lo que vale; la cantidad y el
  // precio (por kilo o por unidad, según `unidad`) se guardan si vienen (para el rinde y el historial de precios).
  function lineasDeCompra(items) {
    if (!Array.isArray(items) || items.length === 0) return { error: 'Agregá al menos un producto.' };
    const lineas = [];
    for (const it of items) {
      const producto = limpiarProducto(it && it.producto);
      const importe = Number(it && it.importe);
      if (!producto) return { error: 'Elegí el producto de cada línea.' };
      if (!Number.isFinite(importe) || importe <= 0) return { error: `Poné el importe de "${producto}".` };
      const descripcion = limpiarDescripcion(it && it.descripcion);
      const unidad = limpiarUnidad(it.unidad);
      const kilos = it.kilos === null || it.kilos === undefined || it.kilos === '' ? null : Number(it.kilos);
      if (kilos !== null && (!Number.isFinite(kilos) || kilos <= 0)) {
        return { error: unidad === 'unidad' ? `La cantidad de "${producto}" no es válida.` : `Los kilos de "${producto}" no son válidos.` };
      }
      const precio = it.precio_kg === null || it.precio_kg === undefined || it.precio_kg === '' ? null : Number(it.precio_kg);
      if (precio !== null && (!Number.isFinite(precio) || precio <= 0)) {
        return { error: unidad === 'unidad' ? `El precio por unidad de "${producto}" no es válido.` : `El precio por kilo de "${producto}" no es válido.` };
      }
      lineas.push({
        producto,
        descripcion,
        unidad,
        kilos,
        precio_kg: precio,
        importe: redondear2(importe),
      });
    }
    return { lineas, total: redondear2(lineas.reduce((acc, l) => acc + l.importe, 0)) };
  }

  function guardarProductoDeProveedor(proveedorId, producto, descripcion, unidad) {
    db.prepare(
      `INSERT INTO proveedor_productos (proveedor_id, producto, descripcion, unidad) VALUES (?, ?, ?, ?)
       ON CONFLICT(proveedor_id, producto, descripcion) DO UPDATE SET unidad = excluded.unidad`
    ).run(proveedorId, producto, descripcion || '', limpiarUnidad(unidad));
  }

  // Lo que vende un proveedor.
  ipcMain.handle('proveedores:productos', (_event, proveedorId) => {
    return db
      .prepare(
        // `ultimo_precio`: el precio (por kilo o por unidad, según `unidad`) de la última compra de ese producto a ese proveedor (si tuvo).
        `SELECT pp.id, pp.producto, pp.descripcion, pp.unidad,
                (SELECT ci.precio_kg FROM compra_items ci JOIN compras c ON c.id = ci.compra_id
                 WHERE c.proveedor_id = pp.proveedor_id AND lower(ci.producto) = lower(pp.producto)
                       AND lower(ci.descripcion) = lower(pp.descripcion) AND ci.precio_kg IS NOT NULL
                 ORDER BY c.fecha DESC, c.id DESC LIMIT 1) AS ultimo_precio
         FROM proveedor_productos pp WHERE pp.proveedor_id = ? ORDER BY pp.producto COLLATE NOCASE, pp.descripcion COLLATE NOCASE`
      )
      .all(Number(proveedorId));
  });

  ipcMain.handle('proveedores:agregarProducto', (_event, { proveedor_id, producto, descripcion, unidad }) => {
    const nombre = limpiarProducto(producto);
    if (!nombre) return { ok: false, error: 'Elegí el producto.' };
    if (!db.prepare('SELECT 1 FROM proveedores WHERE id = ?').get(Number(proveedor_id))) {
      return { ok: false, error: 'Ese proveedor ya no existe.' };
    }
    guardarProductoDeProveedor(Number(proveedor_id), nombre, limpiarDescripcion(descripcion), unidad);
    return { ok: true };
  });

  ipcMain.handle('proveedores:quitarProducto', (_event, id) => {
    db.prepare('DELETE FROM proveedor_productos WHERE id = ?').run(Number(id));
    return { ok: true };
  });

  function guardarCompra(c, idExistente) {
    if (!FECHA_VALIDA.test(c && c.fecha)) return { ok: false, error: 'La fecha no es válida.' };
    const proveedor = db.prepare('SELECT id FROM proveedores WHERE id = ?').get(Number(c.proveedor_id));
    if (!proveedor) return { ok: false, error: 'Elegí un proveedor.' };
    const l = lineasDeCompra(c.items);
    if (l.error) return { ok: false, error: l.error };
    const nota = String(c.nota || '').trim().slice(0, 200) || null;
    const comprobante = String(c.comprobante || '').trim().slice(0, 40) || null;
    db.transaction(() => {
      let compraId = idExistente;
      if (idExistente) {
        db.prepare('UPDATE compras SET fecha = ?, total = ?, nota = ?, comprobante = ? WHERE id = ?').run(c.fecha, l.total, nota, comprobante, idExistente);
        db.prepare('DELETE FROM compra_items WHERE compra_id = ?').run(idExistente);
      } else {
        compraId = Number(
          db.prepare('INSERT INTO compras (proveedor_id, fecha, total, nota, comprobante, creado) VALUES (?, ?, ?, ?, ?, ?)').run(proveedor.id, c.fecha, l.total, nota, comprobante, new Date().toISOString()).lastInsertRowid
        );
      }
      const insertar = db.prepare(
        'INSERT INTO compra_items (compra_id, producto, descripcion, unidad, kilos, precio_kg, importe) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      l.lineas.forEach((x) => {
        insertar.run(compraId, x.producto, x.descripcion, x.unidad, x.kilos, x.precio_kg, x.importe);
        // Lo comprado queda como algo que ese proveedor vende (y recuerda la descripción y la unidad).
        guardarProductoDeProveedor(proveedor.id, x.producto, x.descripcion, x.unidad);
      });
    })();
    return { ok: true };
  }

  ipcMain.handle('proveedores:crearCompra', (_event, c) => guardarCompra(c || {}, null));

  ipcMain.handle('proveedores:actualizarCompra', (_event, c) => {
    const existe = db.prepare('SELECT id FROM compras WHERE id = ?').get(Number(c && c.id));
    if (!existe) return { ok: false, error: 'Esa compra ya no existe.' };
    return guardarCompra({ ...c, proveedor_id: db.prepare('SELECT proveedor_id FROM compras WHERE id = ?').get(existe.id).proveedor_id }, existe.id);
  });

  ipcMain.handle('proveedores:quitarCompra', (_event, id) => {
    db.prepare('DELETE FROM compras WHERE id = ?').run(id);
    return { ok: true };
  });

  // Un pago: efectivo + transferencia + cheques de la cartera. Los cheques pasan a "entregado" al proveedor.
  // Con `editandoId` se reemplaza un pago existente: sus cheques vuelven a la cartera y se aplican los nuevos
  // (pueden ser los mismos), todo en una transacción.
  function guardarPago(p, editandoId) {
    if (!FECHA_VALIDA.test(p && p.fecha)) return { ok: false, error: 'La fecha no es válida.' };
    const proveedor = db.prepare('SELECT id, nombre FROM proveedores WHERE id = ?').get(Number(p.proveedor_id));
    if (!proveedor) return { ok: false, error: 'Elegí un proveedor.' };
    const numero = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
    const efectivo = numero(p.efectivo);
    // Lo transferido puede venir por cuenta (`transferencias: [{ cuenta, monto }]`, de donde sale cada parte)
    // o como un solo monto sin cuenta.
    const partesTransferencia = Array.isArray(p.transferencias)
      ? p.transferencias.map((x) => ({ cuenta: String((x && x.cuenta) || '').trim() || null, monto: numero(x && x.monto) })).filter((x) => x.monto > 0)
      : null;
    const transferencia = partesTransferencia ? redondear2(partesTransferencia.reduce((acc, x) => acc + x.monto, 0)) : numero(p.transferencia);
    if (![efectivo, transferencia, ...(partesTransferencia || []).map((x) => x.monto)].every((n) => Number.isFinite(n) && n >= 0)) {
      return { ok: false, error: 'Los montos no son válidos.' };
    }
    const ids = [...new Set((Array.isArray(p.cheque_ids) ? p.cheque_ids : []).map(Number))];
    if (efectivo + transferencia + ids.length === 0) return { ok: false, error: 'Poné cuánto le pagaste.' };
    const nota = String(p.nota || '').trim().slice(0, 200) || null;
    let error = null;
    db.transaction(() => {
      let pagoId = editandoId;
      if (editandoId) {
        db.prepare(
          "UPDATE cheques SET estado = 'en_cartera', entregado_a = NULL, fecha_entrega = NULL, pago_proveedor_id = NULL WHERE pago_proveedor_id = ?"
        ).run(editandoId);
      }
      const cheques = ids.map((id) => db.prepare("SELECT * FROM cheques WHERE id = ? AND estado = 'en_cartera'").get(id));
      if (cheques.some((c) => !c)) {
        error = 'Alguno de los cheques ya no está en la cartera.';
        throw new Error('cheque no disponible');
      }
      if (editandoId) {
        db.prepare('UPDATE pagos_proveedor SET fecha = ?, efectivo = ?, transferencia = ?, nota = ? WHERE id = ?').run(
          p.fecha, redondear2(efectivo), redondear2(transferencia), nota, editandoId
        );
      } else {
        pagoId = Number(
          db
            .prepare('INSERT INTO pagos_proveedor (proveedor_id, fecha, efectivo, transferencia, nota, creado) VALUES (?, ?, ?, ?, ?, ?)')
            .run(proveedor.id, p.fecha, redondear2(efectivo), redondear2(transferencia), nota, new Date().toISOString()).lastInsertRowid
        );
      }
      cheques.forEach((c) => {
        db.prepare(
          "UPDATE cheques SET estado = 'entregado', entregado_a = ?, fecha_entrega = ?, pago_proveedor_id = ? WHERE id = ?"
        ).run(proveedor.nombre, p.fecha, pagoId, c.id);
      });
      if (partesTransferencia) {
        db.prepare('DELETE FROM pagos_proveedor_cuentas WHERE pago_proveedor_id = ?').run(pagoId);
        partesTransferencia.forEach((x) =>
          db.prepare('INSERT INTO pagos_proveedor_cuentas (pago_proveedor_id, cuenta, monto) VALUES (?, ?, ?)').run(pagoId, x.cuenta, redondear2(x.monto))
        );
      }
    })();
    return { ok: true };
  }

  const conError = (fn) => {
    try {
      return fn();
    } catch (e) {
      if (e && e.message === 'cheque no disponible') return { ok: false, error: 'Alguno de los cheques ya no está en la cartera.' };
      throw e;
    }
  };

  ipcMain.handle('proveedores:pagar', (_event, p) => conError(() => guardarPago(p || {}, null)));

  ipcMain.handle('proveedores:actualizarPago', (_event, p) => {
    const existe = db.prepare('SELECT id, proveedor_id FROM pagos_proveedor WHERE id = ?').get(Number(p && p.id));
    if (!existe) return { ok: false, error: 'Ese pago ya no existe.' };
    return conError(() => guardarPago({ ...p, proveedor_id: existe.proveedor_id }, existe.id));
  });

  // Quitar un pago: los cheques vuelven a la cartera y el efectivo deja de salir del Cierre de caja.
  ipcMain.handle('proveedores:quitarPago', (_event, id) => {
    db.transaction(() => {
      db.prepare(
        "UPDATE cheques SET estado = 'en_cartera', entregado_a = NULL, fecha_entrega = NULL, pago_proveedor_id = NULL WHERE pago_proveedor_id = ?"
      ).run(id);
      db.prepare('DELETE FROM pagos_proveedor WHERE id = ?').run(id);
    })();
    return { ok: true };
  });

  // Devolución de mercadería a un proveedor: resta lo que se le debe por el monto devuelto (no toca el efectivo). Con
  // `reembolso_cuenta` (Efectivo o una cuenta) el proveedor devolvió la plata: entra a esa cuenta y la deuda no cambia.
  ipcMain.handle('proveedores:devolver', (_event, d) => {
    d = d || {};
    if (!FECHA_VALIDA.test(d.fecha)) return { ok: false, error: 'La fecha no es válida.' };
    const proveedor = db.prepare('SELECT id FROM proveedores WHERE id = ?').get(Number(d.proveedor_id));
    if (!proveedor) return { ok: false, error: 'Elegí un proveedor.' };
    const monto = redondear2(Number(d.monto));
    if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Poné el monto de lo devuelto.' };
    const kilos = d.kilos === undefined || d.kilos === null || d.kilos === '' ? null : Number(d.kilos);
    if (kilos !== null && (!Number.isFinite(kilos) || kilos <= 0)) return { ok: false, error: 'Los kilos no son válidos.' };
    const compraId = d.compra_id ? Number(d.compra_id) : null;
    if (compraId && !db.prepare('SELECT id FROM compras WHERE id = ? AND proveedor_id = ?').get(compraId, proveedor.id)) {
      return { ok: false, error: 'Esa compra no es de este proveedor.' };
    }
    // Con la compra elegida, no se puede devolver más de lo que se compró de ese producto (descontando lo ya devuelto).
    if (compraId && kilos !== null && d.producto) {
      const unidad = d.unidad === 'unidad' ? 'unidad' : 'kg';
      const comprado = db
        .prepare('SELECT COALESCE(SUM(kilos), 0) AS t FROM compra_items WHERE compra_id = ? AND producto = ? AND descripcion = ? AND unidad = ?')
        .get(compraId, String(d.producto), String(d.descripcion || ''), unidad).t;
      const yaDevuelto = db
        .prepare('SELECT COALESCE(SUM(kilos), 0) AS t FROM devoluciones_proveedor WHERE compra_id = ? AND producto = ? AND descripcion = ? AND unidad = ?')
        .get(compraId, String(d.producto), String(d.descripcion || ''), unidad).t;
      if (comprado > 0 && redondear2(yaDevuelto + kilos) > redondear2(comprado) + 0.005) {
        const queda = Math.max(0, redondear2(comprado - yaDevuelto));
        return { ok: false, error: `De esa compra solo podés devolver hasta ${queda} ${unidad === 'unidad' ? 'unidades' : 'kg'}${yaDevuelto ? ` (ya devolviste ${redondear2(yaDevuelto)})` : ''}.` };
      }
    }
    let reembolso = null;
    if (d.reembolso_cuenta) {
      reembolso = listaDeCuentas().find((c) => claveCuenta(c) === claveCuenta(d.reembolso_cuenta)) || null;
      if (!reembolso) return { ok: false, error: 'Elegí dónde entró la plata.' };
    }
    db.prepare(
      `INSERT INTO devoluciones_proveedor (proveedor_id, fecha, compra_id, producto, descripcion, unidad, kilos, monto, reembolso_cuenta, nota, creado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      proveedor.id,
      d.fecha,
      compraId,
      String(d.producto || '').trim().slice(0, 120),
      String(d.descripcion || '').trim().slice(0, 120),
      d.unidad === 'unidad' ? 'unidad' : 'kg',
      kilos,
      monto,
      reembolso,
      String(d.nota || '').trim().slice(0, 200) || null,
      new Date().toISOString()
    );
    return { ok: true };
  });

  ipcMain.handle('proveedores:quitarDevolucion', (_event, id) => {
    db.prepare('DELETE FROM devoluciones_proveedor WHERE id = ?').run(Number(id));
    return { ok: true };
  });

  // Todo lo pagado a proveedores en un período (efectivo + transferencia + cheques), para la pantalla de Gastos.
  ipcMain.handle('proveedores:totalPagos', (_event, { desde, hasta } = {}) => {
    const cond = [];
    const params = [];
    if (desde) {
      if (!FECHA_VALIDA.test(desde)) return { total: 0, cantidad: 0 };
      cond.push('pp.fecha >= ?');
      params.push(desde);
    }
    if (hasta) {
      if (!FECHA_VALIDA.test(hasta)) return { total: 0, cantidad: 0 };
      cond.push('pp.fecha <= ?');
      params.push(hasta);
    }
    const fila = db
      .prepare(
        `SELECT COUNT(*) AS cantidad,
                COALESCE(SUM(pp.efectivo + pp.transferencia
                             + COALESCE((SELECT SUM(c.importe) FROM cheques c WHERE c.pago_proveedor_id = pp.id), 0)), 0) AS total
         FROM pagos_proveedor pp ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}`
      )
      .get(...params);
    // Lo que un proveedor devolvió en plata resta de lo pagado.
    const reembolsos = db
      .prepare(`SELECT COALESCE(SUM(pp.monto), 0) AS t FROM devoluciones_proveedor pp WHERE pp.reembolso_cuenta IS NOT NULL${cond.length ? ` AND ${cond.join(' AND ')}` : ''}`)
      .get(...params).t;
    return { total: redondear2(fila.total - reembolsos), cantidad: fila.cantidad };
  });
}

module.exports = { registrar };
