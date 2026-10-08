// Cheques en cartera.
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

function registrar(ctx) {
  const { FECHA_ISO, claveCuenta, db, errorChequeRepetido, ipcMain, listaDeCuentas, redondear2 } = ctx;

  ipcMain.handle('cheques:listar', (_event, { estado } = {}) => {
    const donde = estado === 'en_cartera' || estado === 'entregado' ? 'WHERE estado = ?' : '';
    return db
      .prepare(
        `SELECT * FROM cheques ${donde}
         ORDER BY CASE estado WHEN 'en_cartera' THEN 0 ELSE 1 END,
                  CASE WHEN estado = 'en_cartera' THEN COALESCE(fecha_cobro, '9999-12-31') END ASC,
                  CASE WHEN estado = 'entregado' THEN fecha_entrega END DESC, id DESC LIMIT 5000`
      )
      .all(...(donde ? [estado] : []));
  });

  // Agrega a mano un cheque a la cartera (por ejemplo, los que ya se tenían antes de usar la app).
  ipcMain.handle('cheques:crear', (_event, c) => {
    const banco = String((c && c.banco) || '').trim().slice(0, 60);
    const numero = String((c && c.numero) || '').trim().slice(0, 30);
    const importe = Number(c && c.importe);
    if (!banco || !numero) return { ok: false, error: 'Poné el banco y el número del cheque.' };
    if (!Number.isFinite(importe) || importe <= 0) return { ok: false, error: 'Poné un importe mayor a cero.' };
    const fechaCobro = c.fecha_cobro ? String(c.fecha_cobro) : null;
    if (fechaCobro && !FECHA_ISO.test(fechaCobro)) return { ok: false, error: 'La fecha de cobro no es válida.' };
    const librador = String(c.librador || '').trim().slice(0, 120) || null;
    const repetido = errorChequeRepetido(banco, numero);
    if (repetido) return { ok: false, error: repetido };
    // "Le di efectivo a cambio": el cheque entra a la cartera y sale el mismo importe de efectivo (no es ingreso ni
    // gasto). Queda como operación de la Caja general (canje con monto negativo), que se puede deshacer.
    const efectivo = c.efectivo_a_cambio ? listaDeCuentas().find((n) => claveCuenta(n) === 'efectivo') : null;
    if (c.efectivo_a_cambio && !efectivo) return { ok: false, error: 'No hay una cuenta "Efectivo" en la Caja general.' };
    db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO cheques (banco, numero, importe, fecha_cobro, librador, fecha_ingreso)
           VALUES (?, ?, ?, ?, ?, date('now', 'localtime'))`
        )
        .run(banco, numero, redondear2(importe), fechaCobro, librador);
      if (efectivo) {
        db.prepare(
          "INSERT INTO operaciones_caja (fecha, tipo, cuenta, monto, cheque_id, nota) VALUES (date('now', 'localtime'), 'canje', ?, ?, ?, ?)"
        ).run(efectivo, -redondear2(importe), info.lastInsertRowid, librador);
      }
    })();
    return { ok: true };
  });

  // Marca un cheque como entregado (a un proveedor, por ejemplo).
  ipcMain.handle('cheques:entregar', (_event, { id, entregado_a, fecha_entrega }) => {
    const destino = String(entregado_a || '').trim().slice(0, 120);
    if (!destino) return { ok: false, error: 'Poné a quién se lo entregaste.' };
    if (!FECHA_ISO.test(String(fecha_entrega || ''))) return { ok: false, error: 'La fecha de entrega no es válida.' };
    const info = db
      .prepare("UPDATE cheques SET estado = 'entregado', entregado_a = ?, fecha_entrega = ? WHERE id = ? AND estado = 'en_cartera'")
      .run(destino, fecha_entrega, id);
    return info.changes ? { ok: true } : { ok: false, error: 'Ese cheque ya no está en cartera.' };
  });

  ipcMain.handle('cheques:volverACartera', (_event, id) => {
    db.transaction(() => {
      const cheque = db.prepare('SELECT pago_proveedor_id FROM cheques WHERE id = ?').get(id);
      db.prepare(
        "UPDATE cheques SET estado = 'en_cartera', entregado_a = NULL, fecha_entrega = NULL, pago_proveedor_id = NULL WHERE id = ?"
      ).run(id);
      // El gasto que se había cargado al pagar con este cheque deja de valer.
      db.prepare('DELETE FROM gastos WHERE cheque_id = ?').run(id);
      // Si el cheque era parte de un pago a un proveedor, el pago se achica; si no queda nada, se borra.
      if (cheque && cheque.pago_proveedor_id) borrarPagoProveedorVacio(cheque.pago_proveedor_id);
    })();
    return { ok: true };
  });

  ipcMain.handle('cheques:eliminar', (_event, id) => {
    const usado = db.prepare('SELECT pago_proveedor_id FROM cheques WHERE id = ?').get(id);
    if (usado && usado.pago_proveedor_id) {
      return { ok: false, error: 'Ese cheque se usó para pagarle a un proveedor. Primero quitá el pago desde la ficha del proveedor.' };
    }
    // Si se recibió a cambio de efectivo, se borra también esa operación (el efectivo vuelve).
    db.transaction(() => {
      db.prepare("DELETE FROM operaciones_caja WHERE tipo = 'canje' AND monto < 0 AND cheque_id = ?").run(id);
      db.prepare('UPDATE gastos SET cheque_id = NULL WHERE cheque_id = ?').run(id);
      db.prepare('DELETE FROM cheques WHERE id = ?').run(id);
    })();
    return { ok: true };
  });

  function borrarPagoProveedorVacio(pagoId) {
    db.prepare(
      `DELETE FROM pagos_proveedor WHERE id = ? AND efectivo = 0 AND transferencia = 0
         AND NOT EXISTS (SELECT 1 FROM cheques WHERE pago_proveedor_id = pagos_proveedor.id)`
    ).run(pagoId);
  }
}

module.exports = { registrar };
