// Productos, métodos de pago y tarjetas.
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

function registrar(ctx) {
  const { claveCuenta, db, ipcMain, listaDeCuentas } = ctx;

  ipcMain.handle('productos:listar', () => {
    // `ultima_unidad_pedido`: cómo se pidió la última vez ('unidad' o 'kg'; vacío si nunca se pidió): Pedidos la propone de entrada.
    return db
      .prepare(
        `SELECT p.*,
                (SELECT CASE WHEN pi.unidad_pedido = 'unidad' THEN 'unidad' ELSE 'kg' END FROM pedido_items pi WHERE pi.producto_id = p.id ORDER BY pi.id DESC LIMIT 1) AS ultima_unidad_pedido
         FROM productos p WHERE p.activo = 1 ORDER BY p.nombre COLLATE NOCASE`
      )
      .all();
  });

  // El código de un producto es obligatorio y no puede repetirse entre los productos que se usan (los dados
  // de baja liberan el suyo). Devuelve el texto de error, o null si está bien.
  function errorCodigoProducto(codigo, idPropio) {
    const limpio = String(codigo || '').trim();
    if (!limpio) return 'Poné un código: es obligatorio.';
    const otro = db
      .prepare('SELECT nombre FROM productos WHERE activo = 1 AND id != ? AND lower(trim(codigo)) = lower(?)')
      .get(idPropio || 0, limpio);
    return otro ? `El código ${limpio} ya lo tiene "${otro.nombre}".` : null;
  }

  // "Se puede pedir por unidad" solo existe en los productos que se venden por kilo. El peso aproximado de cada unidad
  // (en gramos en la pantalla, en kilos acá) es opcional: sirve para mostrar "6 u. ≈ 1,2 kg" en el pedido.
  function pedidoPorUnidad(unidad, pedible, pesoKg) {
    if (unidad !== 'kg' || !pedible) return { pedible: 0, peso: null };
    const peso = pesoKg === '' || pesoKg === null || pesoKg === undefined ? null : Number(pesoKg);
    if (peso !== null && (!Number.isFinite(peso) || peso <= 0 || peso > 50)) return { error: 'El peso de cada unidad no es válido.' };
    return { pedible: 1, peso: peso === null ? null : Math.round(peso * 10000) / 10000 };
  }

  ipcMain.handle(
    'productos:crear',
    (_event, { nombre, codigo, precio_cliente, precio_cf, unidad, presentacion, pedible_por_unidad, peso_unidad_pedido }) => {
      const errorCodigo = errorCodigoProducto(codigo, 0);
      if (errorCodigo) return { ok: false, error: errorCodigo };
      codigo = String(codigo).trim();
      const unidadFinal = unidad || 'unidad';
      const presentacionFinal = unidadFinal === 'kg' ? null : presentacion === 'caja' ? 'caja' : 'unidad';
      const pedido = pedidoPorUnidad(unidadFinal, pedible_por_unidad, peso_unidad_pedido);
      if (pedido.error) return { ok: false, error: pedido.error };
      // El código y el nombre no se liberan solos al dar de baja un producto (siguen ocupados para la base,
      // aunque ya no se vean en la lista). Si coinciden con uno dado de baja, se reactiva ese mismo producto
      // con los datos nuevos en vez de intentar crear uno repetido: así las facturas y pedidos viejos que ya
      // lo tenían cargado lo siguen viendo igual.
      const deBaja = db
        .prepare('SELECT id FROM productos WHERE activo = 0 AND (lower(trim(codigo)) = lower(?) OR lower(trim(nombre)) = lower(?))')
        .get(codigo, String(nombre || '').trim());
      try {
        if (deBaja) {
          db.prepare(
            'UPDATE productos SET nombre = ?, codigo = ?, precio_cliente = ?, precio_cf = ?, unidad = ?, presentacion = ?, pedible_por_unidad = ?, peso_unidad_pedido = ?, activo = 1 WHERE id = ?'
          ).run(nombre, codigo || null, precio_cliente, precio_cf, unidadFinal, presentacionFinal, pedido.pedible, pedido.peso, deBaja.id);
          return { ok: true, producto: db.prepare('SELECT * FROM productos WHERE id = ?').get(deBaja.id) };
        }
        const stmt = db.prepare(
          'INSERT INTO productos (nombre, codigo, precio_cliente, precio_cf, unidad, presentacion, pedible_por_unidad, peso_unidad_pedido) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        const info = stmt.run(nombre, codigo || null, precio_cliente, precio_cf, unidadFinal, presentacionFinal, pedido.pedible, pedido.peso);
        return {
          ok: true,
          producto: db.prepare('SELECT * FROM productos WHERE id = ?').get(info.lastInsertRowid),
        };
      } catch (err) {
        return { ok: false, error: 'Ya existe un producto con ese nombre o código.' };
      }
    }
  );

  ipcMain.handle(
    'productos:actualizar',
    (_event, { id, nombre, codigo, precio_cliente, precio_cf, unidad, presentacion, pedible_por_unidad, peso_unidad_pedido }) => {
      const errorCodigo = errorCodigoProducto(codigo, id);
      const pedido = pedidoPorUnidad(unidad, pedible_por_unidad, peso_unidad_pedido);
      if (pedido.error) return { ok: false, error: pedido.error };
      if (errorCodigo) return { ok: false, error: errorCodigo };
      codigo = String(codigo).trim();
      try {
        db.prepare(
          'UPDATE productos SET nombre = ?, codigo = ?, precio_cliente = ?, precio_cf = ?, unidad = ?, presentacion = ?, pedible_por_unidad = ?, peso_unidad_pedido = ? WHERE id = ?'
        ).run(nombre, codigo || null, precio_cliente, precio_cf, unidad, unidad === 'kg' ? null : presentacion === 'caja' ? 'caja' : 'unidad', pedido.pedible, pedido.peso, id);
        return { ok: true, producto: db.prepare('SELECT * FROM productos WHERE id = ?').get(id) };
      } catch (err) {
        return { ok: false, error: 'Ya existe un producto con ese nombre o código.' };
      }
    }
  );

  ipcMain.handle('productos:baja', (_event, id) => {
    db.prepare('UPDATE productos SET activo = 0 WHERE id = ?').run(id);
    return true;
  });

  ipcMain.handle('metodosPago:listar', () => {
    return db.prepare('SELECT * FROM metodos_pago WHERE activo = 1 ORDER BY id').all();
  });

  // Las tarjetas de cada banco o app (débito o crédito).
  ipcMain.handle('tarjetas:listar', () => {
    return db.prepare('SELECT id, cuenta, nombre, tipo FROM tarjetas WHERE activo = 1 ORDER BY cuenta COLLATE NOCASE, tipo, nombre COLLATE NOCASE').all();
  });

  ipcMain.handle('tarjetas:crear', (_event, { cuenta, nombre, tipo }) => {
    const banco = listaDeCuentas().find((c) => claveCuenta(c) === claveCuenta(cuenta) && claveCuenta(c) !== 'efectivo');
    const texto = String(nombre || '').trim().slice(0, 60);
    if (!banco) return { ok: false, error: 'Esa cuenta no existe.' };
    if (!texto) return { ok: false, error: 'Poné el nombre de la tarjeta (por ejemplo, Visa).' };
    if (!['Débito', 'Crédito'].includes(tipo)) return { ok: false, error: 'Elegí si es de débito o de crédito.' };
    const repetida = db.prepare('SELECT 1 FROM tarjetas WHERE activo = 1 AND cuenta = ? AND tipo = ? AND lower(nombre) = lower(?)').get(banco, tipo, texto);
    if (repetida) return { ok: false, error: 'Esa tarjeta ya está cargada.' };
    db.prepare('INSERT INTO tarjetas (cuenta, nombre, tipo) VALUES (?, ?, ?)').run(banco, texto, tipo);
    return { ok: true };
  });

  ipcMain.handle('tarjetas:quitar', (_event, id) => {
    db.prepare('UPDATE tarjetas SET activo = 0 WHERE id = ?').run(Number(id));
    return { ok: true };
  });

  ipcMain.handle('metodosPago:crear', (_event, nombre) => {
    if (String(nombre || '').trim().toLowerCase() === 'saldo a favor') return { ok: false, error: '"Saldo a favor" es un nombre reservado.' };
    const info = db.prepare('INSERT INTO metodos_pago (nombre) VALUES (?)').run(nombre);
    return db.prepare('SELECT * FROM metodos_pago WHERE id = ?').get(info.lastInsertRowid);
  });

  ipcMain.handle('metodosPago:actualizar', (_event, { id, nombre }) => {
    if (String(nombre || '').trim().toLowerCase() === 'saldo a favor') return { ok: false, error: '"Saldo a favor" es un nombre reservado.' };
    const anterior = db.prepare('SELECT nombre FROM metodos_pago WHERE id = ?').get(id);
    const nuevo = String(nombre || '').trim();
    if (!nuevo) return { ok: false, error: 'Poné un nombre.' };
    if (anterior && anterior.nombre !== nuevo) {
      try {
        db.transaction(() => {
          db.prepare('UPDATE metodos_pago SET nombre = ? WHERE id = ?').run(nuevo, id);
          // Una cuenta de la Caja es su método de pago: todo lo que la nombra (cobros, saldos, movimientos, fondos
          // personales...) pasa al nombre nuevo. Se compara sin espacios ni mayúsculas, como en el resto de la Caja
          // ("MercadoPago" y "Mercado Pago" son la misma cuenta).
          [
            ['pagos', 'metodo_pago'], ['cuentas_saldos', 'cuenta'], ['cuentas_ajustes', 'cuenta'], ['gastos', 'cuenta'],
            ['pagos_proveedor_cuentas', 'cuenta'], ['tarjetas', 'cuenta'], ['cuotas_gasto', 'cuenta'],
            ['operaciones_caja', 'cuenta'], ['operaciones_caja', 'cuenta_destino'],
            ['pases_personales', 'cuenta_negocio'], ['pases_personales', 'cuenta_personal'], ['fondos_ajustes', 'cuenta'],
            ['ingresos', 'cuenta'], ['retiros_personales', 'cuenta'],
          ].forEach(([tabla, columna]) =>
            db.prepare(`UPDATE ${tabla} SET ${columna} = ? WHERE lower(replace(${columna}, ' ', '')) = ?`).run(nuevo, claveCuenta(anterior.nombre))
          );
        })();
      } catch (err) {
        return { ok: false, error: 'Ya hay un método de pago con ese nombre.' };
      }
    }
    return db.prepare('SELECT * FROM metodos_pago WHERE id = ?').get(id);
  });

  // Quitar una cuenta con plata cargada la sacaría del total sin avisar: primero hay que dejarla en cero (con
  // "Ajustar saldo" o pasando la plata a otra cuenta).
  ipcMain.handle('metodosPago:baja', (_event, id) => {
    const metodo = db.prepare('SELECT nombre FROM metodos_pago WHERE id = ?').get(id);
    if (metodo && !/^(cheque|saldo a favor)$/i.test(metodo.nombre.trim()) && claveCuenta(metodo.nombre) !== 'efectivo') {
      const cuenta = ctx.resumenDeCuentas ? ctx.resumenDeCuentas().cuentas.find((c) => claveCuenta(c.nombre) === claveCuenta(metodo.nombre)) : null;
      if (cuenta && Math.abs(cuenta.saldo) >= 0.005) {
        return { ok: false, error: `${metodo.nombre} todavía tiene $${cuenta.saldo.toLocaleString('es-AR')} en la Caja. Dejala en cero antes de quitarla (Ajustar saldo o pasando la plata a otra cuenta).` };
      }
    }
    db.prepare('UPDATE metodos_pago SET activo = 0 WHERE id = ?').run(id);
    return { ok: true };
  });
}

module.exports = { registrar };
