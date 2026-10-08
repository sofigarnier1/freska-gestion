// Gastos, categorías, descripciones y cuotas de tarjeta.
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

function registrar(ctx) {
  const { FECHA_VALIDA, claveCuenta, db, ipcMain, leerConfig, listaDeCuentas, redondear2 } = ctx;

  // ---------- Gastos (indirectos) ----------
  // "Débito / Tarjeta" es el de antes de separar débito y crédito: se conserva para los gastos ya cargados.
  const MEDIOS_GASTO = ['Efectivo', 'Transferencia', 'Cheque', 'Débito', 'Crédito', 'Débito / Tarjeta'];

  // Las de Fondos personales (`de_fondos = 1`) tienen su propia lista y no se ofrecen en Gastos.
  ipcMain.handle('gastos:categorias', () => {
    return db.prepare('SELECT id, nombre, ambito FROM categorias_gasto WHERE activo = 1 AND de_fondos = 0 ORDER BY nombre COLLATE NOCASE').all();
  });

  // Acepta el nombre solo o { nombre, ambito } (negocio | personal).
  ipcMain.handle('gastos:crearCategoria', (_event, datos) => {
    const nombre = datos && typeof datos === 'object' ? datos.nombre : datos;
    const ambito = datos && typeof datos === 'object' && datos.ambito === 'personal' ? 'personal' : 'negocio';
    const texto = String(nombre || '').trim().slice(0, 80);
    if (!texto) return { ok: false, error: 'Poné un nombre para la categoría.' };
    db.prepare(
      `INSERT INTO categorias_gasto (nombre, ambito, de_fondos) VALUES (?, ?, 0)
       ON CONFLICT(nombre, ambito, de_fondos) DO UPDATE SET activo = 1, nombre = excluded.nombre`
    ).run(texto, ambito);
    return { ok: true };
  });
  ipcMain.handle('gastos:cambiarAmbitoCategoria', (_event, { id, ambito }) => {
    if (ambito !== 'negocio' && ambito !== 'personal') return { ok: false, error: 'Elegí Negocio o Personal.' };
    const actual = db.prepare('SELECT nombre FROM categorias_gasto WHERE id = ? AND de_fondos = 0').get(Number(id));
    if (!actual) return { ok: false, error: 'Esa categoría ya no existe.' };
    if (db.prepare('SELECT 1 FROM categorias_gasto WHERE nombre = ? AND ambito = ? AND de_fondos = 0 AND id != ?').get(actual.nombre, ambito, Number(id))) {
      return { ok: false, error: `Ya hay una categoría "${actual.nombre}" en ${ambito === 'personal' ? 'Personal' : 'Negocio'}.` };
    }
    db.prepare('UPDATE categorias_gasto SET ambito = ? WHERE id = ?').run(ambito, Number(id));
    return { ok: true };
  });

  // Los gastos ya cargados con esa categoría la siguen mostrando; solo deja de ofrecerse.
  ipcMain.handle('gastos:quitarCategoria', (_event, id) => {
    db.prepare('UPDATE categorias_gasto SET activo = 0 WHERE id = ?').run(id);
    return { ok: true };
  });

  ipcMain.handle('gastos:descripciones', () => {
    return db
      .prepare(
        `SELECT d.id, d.nombre, d.categoria_id, d.orden, c.nombre AS categoria_nombre,
                (SELECT g.monto FROM gastos g WHERE lower(g.descripcion) = lower(d.nombre) AND g.categoria_id IS d.categoria_id ORDER BY g.fecha DESC, g.id DESC LIMIT 1) AS ultimo_monto,
                (SELECT g.medio_pago FROM gastos g WHERE lower(g.descripcion) = lower(d.nombre) AND g.categoria_id IS d.categoria_id ORDER BY g.fecha DESC, g.id DESC LIMIT 1) AS ultimo_medio,
                (SELECT g.cuenta FROM gastos g WHERE lower(g.descripcion) = lower(d.nombre) AND g.categoria_id IS d.categoria_id ORDER BY g.fecha DESC, g.id DESC LIMIT 1) AS ultima_cuenta
         FROM descripciones_gasto d LEFT JOIN categorias_gasto c ON c.id = d.categoria_id
         ORDER BY d.orden DESC, d.nombre LIMIT 1000`
      )
      .all();
  });

  // Agrega una descripción sugerida a una categoría sin cargar un gasto (queda sin uso: orden 0). Si ya
  // existía con ese nombre, pasa a esa categoría.
  ipcMain.handle('gastos:crearDescripcion', (_event, { nombre, categoria_id }) => {
    const texto = String(nombre || '').trim().slice(0, 200);
    if (!texto) return { ok: false, error: 'Escribí la descripción.' };
    const categoria = db
      .prepare('SELECT id FROM categorias_gasto WHERE id = ? AND activo = 1')
      .get(Number(categoria_id));
    if (!categoria) return { ok: false, error: 'Elegí una categoría.' };
    db.prepare(
      `INSERT INTO descripciones_gasto (nombre, categoria_id, orden) VALUES (?, ?, 0)
       ON CONFLICT(nombre, categoria_id) DO UPDATE SET nombre = excluded.nombre`
    ).run(texto, categoria.id);
    return { ok: true };
  });

  ipcMain.handle('gastos:quitarDescripcion', (_event, id) => {
    db.prepare('DELETE FROM descripciones_gasto WHERE id = ?').run(id);
    return { ok: true };
  });

  // De qué cuenta sale un gasto pagado por transferencia o débito. Con la caja general ya configurada es obligatorio
  // elegirla; el efectivo sale siempre de la cuenta Efectivo y el cheque no toca ninguna cuenta.
  function cuentaDeGasto(g) {
    const medio = String((g && g.medio_pago) || '').trim().toLowerCase();
    if (medio === 'efectivo' || medio === 'cheque') return { cuenta: null };
    const elegida = String((g && g.cuenta) || '').trim();
    const cuentas = listaDeCuentas().filter((c) => claveCuenta(c) !== 'efectivo');
    const valida = cuentas.find((c) => claveCuenta(c) === claveCuenta(elegida));
    if (elegida && !valida) return { error: 'Esa cuenta no existe.' };
    // El crédito no sale de ninguna cuenta hasta pagar sus cuotas: la cuenta (el banco de la tarjeta) es opcional.
    if (medio === 'crédito') return { cuenta: valida || null };
    if (!valida && leerConfig('caja_desde')) return { error: 'Elegí de qué cuenta salió la plata.' };
    return { cuenta: valida || null };
  }

  // Tarjeta (débito y crédito, opcional) y cuotas (solo crédito: hay que decir cuántas, 1 si es en un pago).
  function datosTarjetaGasto(g) {
    const medio = String((g && g.medio_pago) || '').trim().toLowerCase();
    const conTarjeta = medio === 'débito' || medio === 'crédito' || medio === 'débito / tarjeta';
    const tarjeta = conTarjeta ? String((g && g.tarjeta) || '').trim().slice(0, 60) || null : null;
    if (medio !== 'crédito') return { tarjeta, cuotas: null };
    const cuotas = Number(g && g.cuotas);
    if (!Number.isInteger(cuotas) || cuotas < 1 || cuotas > 60) return { error: 'Poné en cuántas cuotas es (1 si es en un solo pago).' };
    return { tarjeta, cuotas };
  }

  // Las cuotas de un gasto en crédito: `cuotas` filas que suman el monto (la última absorbe los centavos).
  function crearCuotasDeGasto(gastoId, monto, cuotas) {
    const cada = Math.floor((monto / cuotas) * 100) / 100;
    const insertar = db.prepare('INSERT INTO cuotas_gasto (gasto_id, numero, monto) VALUES (?, ?, ?)');
    for (let n = 1; n <= cuotas; n += 1) {
      insertar.run(gastoId, n, n === cuotas ? redondear2(monto - cada * (cuotas - 1)) : cada);
    }
  }

  ipcMain.handle('gastos:cuotas', (_event, gastoId) => {
    return db.prepare('SELECT id, numero, monto, fecha_pago, cuenta FROM cuotas_gasto WHERE gasto_id = ? ORDER BY numero').all(Number(gastoId));
  });

  // Pagar una cuota: sale de una cuenta (banco o app) ese día, y cuenta como gasto en las estadísticas.
  ipcMain.handle('gastos:pagarCuota', (_event, { id, fecha, cuenta }) => {
    const cuota = db.prepare('SELECT id, fecha_pago FROM cuotas_gasto WHERE id = ?').get(Number(id));
    if (!cuota) return { ok: false, error: 'Esa cuota ya no existe.' };
    if (cuota.fecha_pago) return { ok: false, error: 'Esa cuota ya está pagada.' };
    if (!FECHA_VALIDA.test(fecha)) return { ok: false, error: 'La fecha no es válida.' };
    const cuentas = listaDeCuentas().filter((c) => claveCuenta(c) !== 'efectivo');
    const valida = cuentas.find((c) => claveCuenta(c) === claveCuenta(cuenta));
    if (!valida) return { ok: false, error: 'Elegí de qué cuenta se pagó la cuota.' };
    db.prepare('UPDATE cuotas_gasto SET fecha_pago = ?, cuenta = ? WHERE id = ?').run(fecha, valida, cuota.id);
    return { ok: true };
  });

  ipcMain.handle('gastos:deshacerCuota', (_event, id) => {
    db.prepare('UPDATE cuotas_gasto SET fecha_pago = NULL, cuenta = NULL WHERE id = ?').run(Number(id));
    return { ok: true };
  });

  // Lógica de "cargar un gasto", aparte del handler para que otros temas la reutilicen (ver `Object.assign(ctx, ...)`
  // más abajo): por ahora la usa Vendedores, para cargar una comisión pagada como gasto.
  function crearGasto(g) {
    const fecha = g && g.fecha;
    if (!FECHA_VALIDA.test(fecha)) return { ok: false, error: 'La fecha no es válida.' };
    const monto = Number(g.monto);
    // Con cheque el monto es el del cheque elegido, así que no se pide.
    if (g.medio_pago !== 'Cheque' && (!Number.isFinite(monto) || monto <= 0)) {
      return { ok: false, error: 'Poné un monto mayor a cero.' };
    }
    const descripcion = String(g.descripcion || '').trim().slice(0, 200);
    if (!descripcion) return { ok: false, error: 'Poné una descripción.' };
    const observacion = String(g.observacion || '').trim().slice(0, 300) || null;
    const cuentaGasto = cuentaDeGasto(g);
    if (cuentaGasto.error) return { ok: false, error: cuentaGasto.error };
    const tarjetaGasto = datosTarjetaGasto(g);
    if (tarjetaGasto.error) return { ok: false, error: tarjetaGasto.error };
    const categoria = db
      .prepare('SELECT id FROM categorias_gasto WHERE id = ? AND activo = 1')
      .get(Number(g.categoria_id));
    if (!categoria) return { ok: false, error: 'Elegí una categoría.' };
    if (!MEDIOS_GASTO.includes(g.medio_pago)) return { ok: false, error: 'Elegí cómo se pagó.' };
    // Pagar con cheque es entregar uno de la cartera: el gasto toma su importe y el cheque queda
    // entregado a quien corresponda la descripción.
    const cheque =
      g.medio_pago === 'Cheque'
        ? db.prepare("SELECT * FROM cheques WHERE id = ? AND estado = 'en_cartera'").get(Number(g.cheque_id))
        : null;
    if (g.medio_pago === 'Cheque' && !cheque) return { ok: false, error: 'Elegí un cheque de la cartera.' };
    const id = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO gastos (fecha, categoria_id, descripcion, monto, medio_pago, cheque_banco, cheque_numero, cheque_fecha, cheque_id, observacion, cuenta, tarjeta, cuotas)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          fecha,
          categoria.id,
          descripcion,
          cheque ? cheque.importe : redondear2(monto),
          g.medio_pago,
          cheque ? cheque.banco : null,
          cheque ? cheque.numero : null,
          cheque ? cheque.fecha_cobro : null,
          cheque ? cheque.id : null,
          observacion,
          cuentaGasto.cuenta,
          tarjetaGasto.tarjeta,
          tarjetaGasto.cuotas
        );
      const nuevo = Number(info.lastInsertRowid);
      if (g.medio_pago === 'Crédito') {
        crearCuotasDeGasto(nuevo, redondear2(monto), tarjetaGasto.cuotas);
      }
      if (cheque) {
        db.prepare("UPDATE cheques SET estado = 'entregado', entregado_a = ?, fecha_entrega = ? WHERE id = ?").run(
          descripcion,
          fecha,
          cheque.id
        );
      }
      // La descripción queda en las sugeridas (sube al principio si ya estaba) con su categoría.
      db.prepare(
        `INSERT INTO descripciones_gasto (nombre, categoria_id, orden)
         VALUES (?, ?, (SELECT COALESCE(MAX(orden), 0) + 1 FROM descripciones_gasto))
         ON CONFLICT(nombre, categoria_id) DO UPDATE SET nombre = excluded.nombre, orden = excluded.orden`
      ).run(descripcion, categoria.id);
      return nuevo;
    })();
    return { ok: true, id };
  }

  ipcMain.handle('gastos:crear', (_event, g) => crearGasto(g));

  // Corrige un gasto ya cargado. Un gasto pagado con cheque conserva su forma de pago y su monto (son los
  // del cheque); para cambiarlos hay que quitarlo y cargarlo de nuevo. A los demás no se les puede poner
  // "Cheque" acá, porque eso exige elegir uno de la cartera.
  ipcMain.handle('gastos:actualizar', (_event, g) => {
    const actual = db.prepare('SELECT * FROM gastos WHERE id = ?').get(Number(g && g.id));
    if (!actual) return { ok: false, error: 'Ese gasto ya no existe.' };
    if (!FECHA_VALIDA.test(g.fecha)) return { ok: false, error: 'La fecha no es válida.' };
    const descripcion = String(g.descripcion || '').trim().slice(0, 200);
    if (!descripcion) return { ok: false, error: 'Poné una descripción.' };
    const observacion = String(g.observacion || '').trim().slice(0, 300) || null;
    const categoria = db
      .prepare('SELECT id FROM categorias_gasto WHERE id = ? AND (activo = 1 OR id = ?)')
      .get(Number(g.categoria_id), actual.categoria_id);
    if (!categoria) return { ok: false, error: 'Elegí una categoría.' };
    const conCheque = actual.medio_pago === 'Cheque';
    const medio = conCheque ? 'Cheque' : g.medio_pago;
    if (!MEDIOS_GASTO.includes(medio)) return { ok: false, error: 'Elegí cómo se pagó.' };
    if (medio === 'Cheque' && !conCheque) {
      return { ok: false, error: 'Para pagar con cheque, quitá el gasto y cargalo de nuevo eligiendo el cheque.' };
    }
    const tarjetaActualizada = datosTarjetaGasto({ ...g, medio_pago: medio });
    if (tarjetaActualizada.error) return { ok: false, error: tarjetaActualizada.error };
    let monto = actual.monto;
    if (!actual.cheque_id) {
      monto = redondear2(Number(g.monto));
      if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
    }
    // Un gasto en crédito con cuotas ya pagadas no cambia de monto, de cuotas ni de forma de pago (habría que
    // rehacer lo pagado): hay que quitarlo y cargarlo de nuevo.
    const cuotasPagadas = db.prepare('SELECT COUNT(*) AS n FROM cuotas_gasto WHERE gasto_id = ? AND fecha_pago IS NOT NULL').get(actual.id).n;
    const cambiaElPlan = medio !== actual.medio_pago || tarjetaActualizada.cuotas !== actual.cuotas || Math.abs(monto - actual.monto) > 0.005;
    if (cuotasPagadas > 0 && cambiaElPlan) {
      return { ok: false, error: 'Este gasto ya tiene cuotas pagadas: no se puede cambiar el monto, las cuotas ni la forma de pago. Deshacé las cuotas pagadas o quitalo y cargalo de nuevo.' };
    }
    db.transaction(() => {
      db.prepare(
        'UPDATE gastos SET fecha = ?, categoria_id = ?, descripcion = ?, monto = ?, medio_pago = ?, observacion = ?, cuenta = ?, tarjeta = ?, cuotas = ? WHERE id = ?'
      ).run(g.fecha, categoria.id, descripcion, monto, medio, observacion, cuentaDeGasto({ ...g, medio_pago: medio }).cuenta, tarjetaActualizada.tarjeta, tarjetaActualizada.cuotas, actual.id);
      if (cambiaElPlan) {
        db.prepare('DELETE FROM cuotas_gasto WHERE gasto_id = ?').run(actual.id);
        if (medio === 'Crédito') crearCuotasDeGasto(actual.id, monto, tarjetaActualizada.cuotas);
      }
      if (actual.cheque_id) {
        db.prepare('UPDATE cheques SET entregado_a = ?, fecha_entrega = ? WHERE id = ?').run(descripcion, g.fecha, actual.cheque_id);
      }
      // Si es el pago de una comisión, Vendedores sigue mostrando lo mismo que el gasto (monto y mes).
      db.prepare('UPDATE comisiones_vendedor_pagos SET monto = ?, fecha = ?, mes = substr(?, 1, 7) WHERE gasto_id = ?').run(monto, g.fecha, g.fecha, actual.id);
      // La descripción queda en las sugeridas de su categoría (si ya estaba ahí, no cambia de lugar).
      db.prepare(
        `INSERT INTO descripciones_gasto (nombre, categoria_id, orden)
         VALUES (?, ?, (SELECT COALESCE(MAX(orden), 0) + 1 FROM descripciones_gasto))
         ON CONFLICT(nombre, categoria_id) DO NOTHING`
      ).run(descripcion, categoria.id);
    })();
    return { ok: true };
  });
  // Las cuotas de tarjeta que faltan pagar (para pagar el resumen de una vez).
  ipcMain.handle('gastos:cuotasPendientes', () =>
    db
      .prepare(
        `SELECT cg.id, cg.numero, cg.monto, g.cuotas, g.descripcion, g.tarjeta, g.cuenta, g.fecha
         FROM cuotas_gasto cg JOIN gastos g ON g.id = cg.gasto_id
         WHERE cg.fecha_pago IS NULL ORDER BY g.tarjeta, g.fecha, cg.numero`
      )
      .all()
  );

  // Si el gasto se pagó con un cheque de la cartera, el cheque vuelve a la cartera.
  function eliminarGasto(id) {
    db.transaction(() => {
      const gasto = db.prepare('SELECT cheque_id FROM gastos WHERE id = ?').get(id);
      db.prepare('DELETE FROM gastos WHERE id = ?').run(id);
      // Si era el pago de una comisión, deja de figurar como pagado en Vendedores.
      db.prepare('DELETE FROM comisiones_vendedor_pagos WHERE gasto_id = ?').run(id);
      if (gasto && gasto.cheque_id) {
        db.prepare("UPDATE cheques SET estado = 'en_cartera', entregado_a = NULL, fecha_entrega = NULL WHERE id = ?").run(gasto.cheque_id);
      }
    })();
    return { ok: true };
  }
  ipcMain.handle('gastos:eliminar', (_event, id) => eliminarGasto(id));

  ipcMain.handle('gastos:listar', (_event, { desde, hasta, medio } = {}) => {
    const cond = [];
    const params = [];
    if (medio) {
      cond.push('lower(trim(g.medio_pago)) = lower(?)');
      params.push(medio);
    }
    if (desde) {
      if (!FECHA_VALIDA.test(desde)) return [];
      cond.push('g.fecha >= ?');
      params.push(desde);
    }
    if (hasta) {
      if (!FECHA_VALIDA.test(hasta)) return [];
      cond.push('g.fecha <= ?');
      params.push(hasta);
    }
    return db
      .prepare(
        `SELECT g.id, g.fecha, g.categoria_id, c.nombre AS categoria, c.ambito AS categoria_ambito, g.descripcion, g.monto, g.medio_pago,
                g.cheque_banco, g.cheque_numero, g.cheque_fecha, g.cheque_id, g.observacion, g.cuenta, g.tarjeta, g.cuotas,
                (SELECT COUNT(*) FROM cuotas_gasto WHERE gasto_id = g.id AND fecha_pago IS NOT NULL) AS cuotas_pagadas
         FROM gastos g JOIN categorias_gasto c ON c.id = g.categoria_id
         ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
         ORDER BY g.fecha DESC, g.id DESC LIMIT 5000`
      )
      .all(...params);
  });

  Object.assign(ctx, { crearGasto, eliminarGasto });
}

module.exports = { registrar };
