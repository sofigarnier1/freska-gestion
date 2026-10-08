// Clientes: alta, baja, historial, cobros generales y cobros anulados.
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

function registrar(ctx) {
  const { SQL_NO_CREDITO_P, db, esMetodoCheque, insertarChequeDeCobro, ipcMain, redondear2, registrarRetencionTransferencia, validarChequeDeCobro } = ctx;

  // Igual que el saldo inicial de un proveedor: si viene vacío o inválido, no rompe (queda en 0).
  function saldoInicialValido(valor) {
    if (valor === undefined || valor === '' || valor === null) return { saldoInicial: 0 };
    const n = Number(valor);
    if (!Number.isFinite(n)) return { error: 'El saldo inicial no es válido.' };
    return { saldoInicial: redondear2(n) };
  }

  ipcMain.handle('clientes:listar', () => {
    return db.prepare('SELECT * FROM clientes ORDER BY nombre').all();
  });

  // CUIT: 11 dígitos con dígito verificador. Devuelve el CUIT con guiones (20-12345678-9), '' si está vacío o
  // null si no es válido.
  function normalizarCuit(texto) {
    const digitos = String(texto || '').replace(/\D/g, '');
    if (!digitos) return '';
    if (digitos.length !== 11) return null;
    const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const suma = pesos.reduce((acc, p, i) => acc + p * Number(digitos[i]), 0);
    const resto = suma % 11;
    const verificador = resto === 0 ? 0 : 11 - resto;
    if (verificador === 10 || verificador !== Number(digitos[10])) return null;
    return `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos[10]}`;
  }

  const CONDICIONES_IVA = ['Consumidor final', 'Monotributista', 'Responsable inscripto'];

  // Código y datos fiscales de un cliente. El código no se repite (entre todos los clientes, aunque estén
  // dados de baja); si no viene, al crear se asigna el siguiente número.
  function datosDeCliente(d, idPropio) {
    let codigo = String((d && d.codigo) || '').trim().slice(0, 20);
    if (!codigo) {
      if (idPropio) return { error: 'Poné un código: es obligatorio.' };
      const fila = db
        .prepare("SELECT MAX(CAST(codigo AS INTEGER)) AS maximo FROM clientes WHERE codigo GLOB '[0-9]*'")
        .get();
      codigo = String((fila.maximo || 0) + 1);
    }
    const otro = db
      .prepare('SELECT nombre, apellido FROM clientes WHERE id != ? AND lower(trim(codigo)) = lower(?)')
      .get(idPropio || 0, codigo);
    if (otro) return { error: `El código ${codigo} ya lo tiene ${otro.nombre}${otro.apellido ? ` ${otro.apellido}` : ''}.` };
    const condicion = String((d && d.condicion_iva) || '').trim();
    if (condicion && !CONDICIONES_IVA.includes(condicion)) return { error: 'Elegí una condición frente al IVA de la lista.' };
    const cuit = normalizarCuit(d && d.cuit);
    if (cuit === null) return { error: 'El CUIT no es válido: revisá los 11 números.' };
    return { codigo, condicion_iva: condicion || null, cuit: cuit || null };
  }

  // Vendedor del cliente (solo lo asigna un administrador). Vacío = sin vendedor (los clientes del dueño).
  // Devuelve { vendedorId } o { error }.
  function vendedorValido(valor) {
    if (valor === undefined || valor === null || valor === '') return { vendedorId: null };
    const fila = db.prepare('SELECT id FROM vendedores WHERE id = ?').get(Number(valor));
    return fila ? { vendedorId: fila.id } : { error: 'Ese vendedor ya no existe.' };
  }
  const esEmpleado = () => Boolean(ctx.usuarioActual && ctx.usuarioActual.rol === 'empleado');

  ipcMain.handle(
    'clientes:crear',
    (_event, { nombre, apellido, telefono, telefono_fijo, telefono2, telefono2_nombre, domicilio, nota, codigo, condicion_iva, cuit, negocio, saldo_inicial, vendedor_id }) => {
      const extra = datosDeCliente({ codigo, condicion_iva, cuit }, 0);
      if (extra.error) return { ok: false, error: extra.error };
      const { saldoInicial, error: errorSaldo } = saldoInicialValido(saldo_inicial);
      if (errorSaldo) return { ok: false, error: errorSaldo };
      const { vendedorId, error: errorVendedor } = esEmpleado() ? { vendedorId: null } : vendedorValido(vendedor_id);
      if (errorVendedor) return { ok: false, error: errorVendedor };
      try {
        const stmt = db.prepare(
          'INSERT INTO clientes (nombre, apellido, telefono, telefono_fijo, telefono2, telefono2_nombre, domicilio, nota, codigo, condicion_iva, cuit, negocio, saldo_inicial, saldo, vendedor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        const info = stmt.run(
          nombre,
          apellido || '',
          telefono || null,
          telefono_fijo || null,
          telefono2 || null,
          String(telefono2_nombre || '').trim().slice(0, 40) || null,
          domicilio || null,
          nota || null,
          extra.codigo,
          extra.condicion_iva,
          extra.cuit,
          String(negocio || '').trim().slice(0, 80) || null,
          saldoInicial,
          saldoInicial,
          vendedorId
        );
        return {
          ok: true,
          cliente: db.prepare('SELECT * FROM clientes WHERE id = ?').get(info.lastInsertRowid),
        };
      } catch (err) {
        return { ok: false, error: 'Ya existe un cliente con ese nombre y apellido.' };
      }
    }
  );

  ipcMain.handle(
    'clientes:actualizar',
    (_event, { id, nombre, apellido, telefono, telefono_fijo, telefono2, telefono2_nombre, domicilio, nota, codigo, condicion_iva, cuit, negocio, saldo_inicial, vendedor_id }) => {
      const extra = datosDeCliente({ codigo, condicion_iva, cuit }, id);
      if (extra.error) return { ok: false, error: extra.error };
      const { saldoInicial, error: errorSaldo } = saldoInicialValido(saldo_inicial);
      if (errorSaldo) return { ok: false, error: errorSaldo };
      const actual = db.prepare('SELECT saldo_inicial, vendedor_id FROM clientes WHERE id = ?').get(id);
      if (!actual) return { ok: false, error: 'Ese cliente ya no existe.' };
      // Un empleado (o una pantalla que no manda el campo) no toca el vendedor: queda el que tenía.
      const { vendedorId, error: errorVendedor } =
        esEmpleado() || vendedor_id === undefined ? { vendedorId: actual.vendedor_id } : vendedorValido(vendedor_id);
      if (errorVendedor) return { ok: false, error: errorVendedor };
      // El saldo de un cliente se guarda (no se calcula al vuelo, a diferencia de proveedores): si el saldo
      // inicial cambia, hay que sumarle la diferencia al saldo ya guardado, no pisarlo.
      const diferencia = redondear2(saldoInicial - (actual.saldo_inicial || 0));
      try {
        db.prepare(
          'UPDATE clientes SET nombre = ?, apellido = ?, telefono = ?, telefono_fijo = ?, telefono2 = ?, telefono2_nombre = ?, domicilio = ?, nota = ?, codigo = ?, condicion_iva = ?, cuit = ?, negocio = ?, saldo_inicial = ?, saldo = saldo + ?, vendedor_id = ? WHERE id = ?'
        ).run(
          nombre,
          apellido || '',
          telefono || null,
          telefono_fijo || null,
          telefono2 || null,
          String(telefono2_nombre || '').trim().slice(0, 40) || null,
          domicilio || null,
          nota || null,
          extra.codigo,
          extra.condicion_iva,
          extra.cuit,
          String(negocio || '').trim().slice(0, 80) || null,
          saldoInicial,
          diferencia,
          vendedorId,
          id
        );
        return { ok: true, cliente: db.prepare('SELECT * FROM clientes WHERE id = ?').get(id) };
      } catch (err) {
        return { ok: false, error: 'Ya existe un cliente con ese nombre y apellido.' };
      }
    }
  );

  ipcMain.handle('clientes:darDeBaja', (_event, id) => {
    const cliente = db.prepare('SELECT saldo FROM clientes WHERE id = ?').get(id);
    if (!cliente) return { ok: false, error: 'No se encontró el cliente.' };
    if (cliente.saldo > 0.005) {
      return {
        ok: false,
        error: `No se puede dar de baja: todavía debe $${cliente.saldo.toLocaleString('es-AR')}. Primero hay que saldar la cuenta.`,
      };
    }
    db.prepare('UPDATE clientes SET activo = 0 WHERE id = ?').run(id);
    return { ok: true };
  });

  ipcMain.handle('clientes:darDeAlta', (_event, id) => {
    db.prepare('UPDATE clientes SET activo = 1 WHERE id = ?').run(id);
    return { ok: true };
  });

  ipcMain.handle('clientes:registrarConsulta', (_event, id) => {
    db.prepare("UPDATE clientes SET ultima_consulta = datetime('now', 'localtime') WHERE id = ?").run(
      id
    );
    return db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  });

  ipcMain.handle('clientes:eliminar', (_event, id) => {
    try {
      db.prepare('DELETE FROM clientes WHERE id = ?').run(id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'No se puede eliminar: tiene facturas o cobros asociados.' };
    }
  });

  ipcMain.handle('clientes:historial', (_event, clienteId) => {
    return db
      .prepare(
        `SELECT f.*, COALESCE((SELECT SUM(monto) FROM pagos WHERE factura_id = f.id), 0) as pagado
         FROM facturas f
         WHERE f.cliente_id = ?
         ORDER BY f.fecha DESC`
      )
      .all(clienteId);
  });

  ipcMain.handle('clientes:registrarPagoGeneral', (_event, { cliente_id, monto, metodo_pago, cheque }) => {
    if (!(monto > 0)) {
      return { ok: false, error: 'El monto tiene que ser mayor a cero.' };
    }
    const datosCheque = esMetodoCheque(metodo_pago) ? validarChequeDeCobro(cheque) : null;
    if (datosCheque && datosCheque.error) return { ok: false, error: datosCheque.error };

    // El tope es el saldo del cliente (`clientes.saldo`), no la suma de facturas pendientes: el saldo
    // también incluye lo que no tiene factura propia (ej. el saldo inicial cargado a mano), así que puede
    // ser mayor que lo facturado. Lo que sobre después de cubrir las facturas simplemente baja el saldo
    // general como un cobro sin factura (ver más abajo).
    const cliente = db.prepare('SELECT saldo FROM clientes WHERE id = ?').get(cliente_id);
    if (!cliente) return { ok: false, error: 'Ese cliente ya no existe.' };
    if (monto > cliente.saldo + 0.01) {
      return {
        ok: false,
        error: `Ese monto es mayor a lo que debe (le queda pendiente $${cliente.saldo.toLocaleString('es-AR')}).`,
      };
    }

    const facturasPendientes = db
      .prepare(
        `SELECT f.*, COALESCE((SELECT SUM(monto) FROM pagos WHERE factura_id = f.id), 0) as pagado
         FROM facturas f
         WHERE f.cliente_id = ? AND f.estado IN ('pendiente', 'parcial')
         ORDER BY f.fecha ASC, f.id ASC`
      )
      .all(cliente_id);

    // Un cobro baja primero lo más antiguo: el saldo anterior (la deuda de antes de usar FRESKA, que no tiene factura) y
    // después las facturas, de la más vieja a la más nueva. Lo que queda del saldo anterior es el saldo inicial menos lo ya
    // cobrado sin factura.
    const cobradoDelAnterior = db
      .prepare("SELECT COALESCE(SUM(monto), 0) AS t FROM pagos WHERE factura_id IS NULL AND cliente_id = ? AND monto > 0 AND lower(trim(metodo_pago)) != 'saldo a favor'")
      .get(cliente_id).t;
    const inicial = db.prepare('SELECT saldo_inicial FROM clientes WHERE id = ?').get(cliente_id).saldo_inicial || 0;
    const saldoAnterior = Math.max(0, redondear2(inicial - cobradoDelAnterior));

    const registrar = db.transaction(() => {
      let restante = monto;
      const idsPagos = [];
      const aSaldoAnterior = redondear2(Math.min(restante, saldoAnterior));
      if (aSaldoAnterior > 0.005) {
        idsPagos.push(
          db.prepare('INSERT INTO pagos (factura_id, cliente_id, monto, metodo_pago, creado_por) VALUES (NULL, ?, ?, ?, ?)').run(cliente_id, aSaldoAnterior, metodo_pago || 'Efectivo', ctx.usuarioActual ? ctx.usuarioActual.id : null).lastInsertRowid
        );
        restante = redondear2(restante - aSaldoAnterior);
      }
      for (const f of facturasPendientes) {
        if (restante <= 0) break;
        const debeFactura = f.total - f.pagado;
        const aplicado = Math.min(restante, debeFactura);
        if (aplicado <= 0) continue;
        idsPagos.push(
          db.prepare('INSERT INTO pagos (factura_id, monto, metodo_pago, creado_por) VALUES (?, ?, ?, ?)').run(f.id, aplicado, metodo_pago || 'Efectivo', ctx.usuarioActual ? ctx.usuarioActual.id : null).lastInsertRowid
        );
        const nuevoPagado = f.pagado + aplicado;
        const nuevoEstado = nuevoPagado >= f.total - 0.005 ? 'pagada' : 'parcial';
        if (nuevoEstado === 'pagada') {
          db.prepare(
            "UPDATE facturas SET estado = ?, fecha_pago = datetime('now', 'localtime') WHERE id = ?"
          ).run(nuevoEstado, f.id);
        } else {
          db.prepare('UPDATE facturas SET estado = ? WHERE id = ?').run(nuevoEstado, f.id);
        }
        restante -= aplicado;
      }
      // Por si algo sobrara después de cubrir todo (no debería pasar: el monto no supera el saldo): queda anotado como
      // un cobro sin factura, para que figure en el historial, la caja y las estadísticas como cualquier otro cobro.
      if (restante > 0.005) {
        idsPagos.push(
          db.prepare('INSERT INTO pagos (factura_id, cliente_id, monto, metodo_pago, creado_por) VALUES (NULL, ?, ?, ?, ?)').run(cliente_id, redondear2(restante), metodo_pago || 'Efectivo', ctx.usuarioActual ? ctx.usuarioActual.id : null).lastInsertRowid
        );
      }
      db.prepare('UPDATE clientes SET saldo = ROUND(saldo - ?, 2) WHERE id = ?').run(
        monto,
        cliente_id
      );
      // Un cobro con cheque deja el cheque en cartera (con el monto completo, aunque el pago se reparta
      // entre varias facturas).
      if (datosCheque) insertarChequeDeCobro({ datos: datosCheque, importe: monto, clienteId: cliente_id });
      registrarRetencionTransferencia(metodo_pago, monto, null, null, idsPagos);
    });

    registrar();
    return { ok: true };
  });

  ipcMain.handle('clientes:historialPagos', (_event, clienteId) => {
    return db
      .prepare(
        `SELECT p.id, p.monto, p.fecha, p.metodo_pago, p.factura_id, f.total as factura_total, u.nombre as creado_por_nombre, u.rol as creado_por_rol
         FROM pagos p
         LEFT JOIN facturas f ON f.id = p.factura_id
         LEFT JOIN usuarios u ON u.id = p.creado_por
         WHERE COALESCE(f.cliente_id, p.cliente_id) = ? AND (f.id IS NULL OR f.estado != 'anulada') AND ${SQL_NO_CREDITO_P}
         ORDER BY p.fecha DESC`
      )
      .all(clienteId);
  });

  ipcMain.handle('clientes:cobrosAnulados', (_event, clienteId) => {
    return db
      .prepare(
        `SELECT ca.id, ca.fecha, ca.fecha_cobro, ca.monto, ca.metodo, ca.facturas, ca.motivo, ca.reactivado_en,
                (ca.snapshot IS NOT NULL) AS reactivable, u.nombre AS anulado_por_nombre, u.rol AS anulado_por_rol
         FROM cobros_anulados ca LEFT JOIN usuarios u ON u.id = ca.anulado_por
         WHERE ca.cliente_id = ? ORDER BY ca.id DESC`
      )
      .all(clienteId);
  });

  ipcMain.handle('clientes:notasCredito', (_event, clienteId) => {
    return db
      .prepare('SELECT id, factura_id, fecha, credito, devuelto, metodo_devolucion FROM notas_credito WHERE cliente_id = ? ORDER BY fecha DESC, id DESC')
      .all(clienteId);
  });
}

module.exports = { registrar };
