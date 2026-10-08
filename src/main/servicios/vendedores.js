// Vendedores: quiénes cobran comisión por lo que venden, y el informe mensual de ventas y comisión de cada uno.
// Cada archivo exporta `registrar(ctx)`, que main.js llama al arrancar: `ctx` trae la base (db), Electron y las
// funciones compartidas de compartido.js. Todo esto es solo del administrador (prefijo `vendedores` en main.js).

function registrar(ctx) {
  const { FECHA_VALIDA, crearGasto, db, ipcMain, redondear2 } = ctx;

  const nombreCompleto = `(c.nombre || CASE WHEN c.apellido IS NOT NULL AND c.apellido != '' THEN ' ' || c.apellido ELSE '' END)`;
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  // Categoría fija para las comisiones cargadas como gasto (ver `vendedores:pagarComision` más abajo); se crea
  // sola la primera vez que hace falta, como la de Retenciones en compartido.js.
  const categoriaComisionesId = () => {
    db.prepare(
      "INSERT INTO categorias_gasto (nombre, ambito) VALUES ('Comisiones de vendedores', 'negocio') ON CONFLICT(nombre, ambito, de_fondos) DO NOTHING"
    ).run();
    return db.prepare("SELECT id FROM categorias_gasto WHERE nombre = 'Comisiones de vendedores' AND ambito = 'negocio'").get().id;
  };

  // Devuelve { datos } con lo ya limpio, o { error }.
  function datosDeVendedor(d) {
    const nombre = String((d && d.nombre) || '').trim().slice(0, 60);
    if (!nombre) return { error: 'Poné el nombre del vendedor.' };
    const numero = Number(d && d.numero);
    if (!Number.isInteger(numero) || numero <= 0) return { error: 'El número del vendedor tiene que ser un entero mayor a cero.' };
    const porcentaje = Number(d && d.porcentaje);
    if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100) return { error: 'El porcentaje tiene que estar entre 0 y 100.' };
    const telefono = String((d && d.telefono) || '').trim().slice(0, 40) || null;
    return { datos: { nombre, numero, porcentaje: redondear2(porcentaje), telefono } };
  }

  ipcMain.handle('vendedores:listar', () => {
    return db.prepare('SELECT id, numero, nombre, porcentaje, telefono, activo FROM vendedores ORDER BY numero, nombre COLLATE NOCASE').all();
  });

  ipcMain.handle('vendedores:crear', (_event, d) => {
    const { datos, error } = datosDeVendedor(d);
    if (error) return { ok: false, error };
    try {
      const id = db.transaction(() => {
        const info = db.prepare('INSERT INTO vendedores (numero, nombre, porcentaje, telefono) VALUES (?, ?, ?, ?)').run(datos.numero, datos.nombre, datos.porcentaje, datos.telefono);
        const nuevo = Number(info.lastInsertRowid);
        // El primer porcentaje vale "desde siempre".
        db.prepare("INSERT INTO vendedor_porcentajes (vendedor_id, desde, porcentaje) VALUES (?, '0000-00-00', ?)").run(nuevo, datos.porcentaje);
        return nuevo;
      })();
      return { ok: true, id };
    } catch (e) {
      return { ok: false, error: 'Ya hay un vendedor con ese nombre.' };
    }
  });

  ipcMain.handle('vendedores:actualizar', (_event, d) => {
    const { datos, error } = datosDeVendedor(d);
    if (error) return { ok: false, error };
    const actual = db.prepare('SELECT id, activo, porcentaje FROM vendedores WHERE id = ?').get(Number(d.id));
    if (!actual) return { ok: false, error: 'Ese vendedor ya no existe.' };
    const activo = d.activo === undefined ? actual.activo : d.activo ? 1 : 0;
    try {
      db.transaction(() => {
        db.prepare('UPDATE vendedores SET numero = ?, nombre = ?, porcentaje = ?, telefono = ?, activo = ? WHERE id = ?').run(datos.numero, datos.nombre, datos.porcentaje, datos.telefono, activo, actual.id);
        // Si cambió el porcentaje, el nuevo vale desde hoy: lo vendido antes se sigue calculando con el anterior.
        if (Math.abs(datos.porcentaje - actual.porcentaje) > 0.0001) {
          db.prepare("INSERT OR REPLACE INTO vendedor_porcentajes (vendedor_id, desde, porcentaje) VALUES (?, date('now', 'localtime'), ?)").run(actual.id, datos.porcentaje);
        }
      })();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Ya hay un vendedor con ese nombre.' };
    }
  });

  // Informe de un mes ('AAAA-MM'): por vendedor, lo cobrado (no lo facturado) de sus clientes, su comisión y el
  // detalle por cliente; aparte, las facturas anuladas de cada uno con su motivo, sin comisión aunque se hayan
  // cobrado (2026-09-28: "lo de las comisiones va sobre lo cobrado, no sobre lo facturado"). Un pago cuenta
  // el día que se cobró (no el día de la factura), como el resto de la app ("en base caja"); los pagos con saldo a
  // favor no cuentan (no es plata nueva). Usa el porcentaje que tenía el vendedor el día del cobro (no el de hoy).
  // Lo del dueño (clientes sin vendedor) va en `sinVendedor`, sin comisión. Separada del handler para que
  // `vendedores:pagarComision` recalcule la comisión del lado del servidor (no confía en el monto que mande la pantalla).
  // Se puede pedir un mes ('AAAA-MM') o un período ({ desde, hasta }, fechas 'AAAA-MM-DD'). Devuelve `mes` solo si el
  // período es un mes entero.
  function periodoDelInforme(arg) {
    if (arg && typeof arg === 'object') {
      if (!FECHA_VALIDA.test(String(arg.desde || '')) || !FECHA_VALIDA.test(String(arg.hasta || '')) || arg.desde > arg.hasta) return null;
      const mes = arg.desde.slice(0, 7);
      const ultimo = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
      return { desde: arg.desde, hasta: arg.hasta, mes: arg.desde === `${mes}-01` && arg.hasta === `${mes}-${String(ultimo).padStart(2, '0')}` ? mes : undefined };
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(arg || ''))) return null;
    const ultimo = new Date(Number(String(arg).slice(0, 4)), Number(String(arg).slice(5, 7)), 0).getDate();
    return { desde: `${arg}-01`, hasta: `${arg}-${String(ultimo).padStart(2, '0')}`, mes: String(arg) };
  }

  function calcularInforme(arg) {
    const periodo = periodoDelInforme(arg);
    if (!periodo) return { ok: false, error: 'Elegí un período válido.' };
    const { desde, hasta, mes } = periodo;
    const cobros = db
      .prepare(
        `SELECT p.fecha, p.monto, p.factura_id, f.vendedor_id, c.id AS cliente_id, ${nombreCompleto} AS cliente
         FROM pagos p JOIN facturas f ON f.id = p.factura_id JOIN clientes c ON c.id = f.cliente_id
         WHERE substr(p.fecha, 1, 10) BETWEEN ? AND ? AND f.estado != 'anulada' AND lower(trim(p.metodo_pago)) != 'saldo a favor'
         ORDER BY p.fecha, p.id`
      )
      .all(desde, hasta);
    // Las anuladas se listan aparte (informativo, con el motivo): no suman comisión aunque tengan cobros, y se
    // muestran por el mes en que se facturaron (no el del cobro).
    const anuladasDelMes = db
      .prepare(
        `SELECT f.id, f.fecha, f.total, f.motivo_anulacion, f.vendedor_id, c.id AS cliente_id, ${nombreCompleto} AS cliente
         FROM facturas f JOIN clientes c ON c.id = f.cliente_id
         WHERE f.estado = 'anulada' AND substr(f.fecha, 1, 10) BETWEEN ? AND ? ORDER BY f.fecha, f.id`
      )
      .all(desde, hasta);
    const armar = (vendedor, cobrosPropios, anuladasPropias) => {
      const porCliente = new Map();
      cobrosPropios.forEach((p) => {
        const previo = porCliente.get(p.cliente_id) || { cliente_id: p.cliente_id, cliente: p.cliente, facturas: new Set(), total: 0 };
        previo.facturas.add(p.factura_id);
        previo.total = redondear2(previo.total + p.monto);
        porCliente.set(p.cliente_id, previo);
      });
      const total = redondear2(cobrosPropios.reduce((acc, p) => acc + p.monto, 0));
      // La comisión de cada cobro usa el porcentaje que tenía el vendedor el día que se cobró (no el de hoy).
      const aplicados = new Set();
      const comision = vendedor
        ? redondear2(
            cobrosPropios.reduce((acc, p) => {
              const pct = porcentajeEn(vendedor.id, String(p.fecha).slice(0, 10));
              aplicados.add(pct);
              return acc + (p.monto * pct) / 100;
            }, 0)
          )
        : undefined;
      return {
        total,
        cantidad: new Set(cobrosPropios.map((p) => p.factura_id)).size,
        clientes: [...porCliente.values()]
          .map((c) => ({ cliente_id: c.cliente_id, cliente: c.cliente, facturas: c.facturas.size, total: c.total }))
          .sort((a, b) => b.total - a.total),
        anuladas: anuladasPropias.map((f) => ({ id: f.id, fecha: String(f.fecha).slice(0, 10), cliente: f.cliente, total: f.total, motivo: f.motivo_anulacion || '' })),
        ...(vendedor ? { comision, porcentajesAplicados: [...aplicados].sort((a, b) => a - b) } : {}),
      };
    };
    const historial = db.prepare('SELECT vendedor_id, desde, porcentaje FROM vendedor_porcentajes ORDER BY desde').all();
    const porcentajeEn = (vendedorId, dia) => {
      let pct = 0;
      historial.forEach((h) => {
        if (h.vendedor_id === vendedorId && h.desde <= dia) pct = h.porcentaje;
      });
      return pct;
    };
    const vendedores = db.prepare('SELECT id, numero, nombre, porcentaje, telefono, activo FROM vendedores ORDER BY numero, nombre COLLATE NOCASE').all();
    const filas = vendedores
      .map((v) => ({ ...v, ...armar(v, cobros.filter((p) => p.vendedor_id === v.id), anuladasDelMes.filter((f) => f.vendedor_id === v.id)) }))
      // Un vendedor dado de baja solo aparece si ese mes tuvo movimientos.
      .filter((v) => v.activo || v.cantidad > 0 || v.anuladas.length > 0);
    const conocidos = new Set(vendedores.map((v) => v.id));
    const sinVendedor = armar(
      null,
      cobros.filter((p) => !p.vendedor_id || !conocidos.has(p.vendedor_id)),
      anuladasDelMes.filter((f) => !f.vendedor_id || !conocidos.has(f.vendedor_id))
    );
    return { ok: true, desde, hasta, mes, vendedores: filas, sinVendedor };
  }

  ipcMain.handle('vendedores:informe', (_event, arg) => {
    const informe = calcularInforme(arg);
    if (informe.ok === false) return informe;
    // Qué se le fue pagando de la comisión de ese mes (puede ser de a partes): la lista de pagos, cuánto
    // suman y cuánto falta. `pendiente` puede dar negativo si se le pagó de más (por ejemplo, un adelanto).
    const pagosDelMes = db
      .prepare('SELECT id, vendedor_id, fecha, monto, gasto_id FROM comisiones_vendedor_pagos WHERE fecha BETWEEN ? AND ? ORDER BY fecha, id')
      .all(informe.desde, informe.hasta);
    return {
      ...informe,
      vendedores: informe.vendedores.map((v) => {
        const pagos = pagosDelMes.filter((p) => p.vendedor_id === v.id);
        const pagado = redondear2(pagos.reduce((acc, p) => acc + p.monto, 0));
        return { ...v, pagos, pagado, pendiente: redondear2(v.comision - pagado) };
      }),
    };
  });

  // Carga un pago de comisión como gasto (categoría "Comisiones de vendedores"), para no tener que anotarlo a
  // mano. El monto lo elige quien carga (se puede pagar de a partes) y el mes al que se imputa sale de la fecha
  // que se le ponga, no de qué informe se estaba mirando (2026-09-28: "si pone que pagó en septiembre,
  // que aparezca en el informe de septiembre"). Se puede cargar más de uno por vendedor y mes.
  ipcMain.handle('vendedores:pagarComision', (_event, d) => {
    const vendedorId = Number(d && d.vendedor_id);
    const vendedor = db.prepare('SELECT id, nombre FROM vendedores WHERE id = ?').get(vendedorId);
    if (!vendedor) return { ok: false, error: 'Ese vendedor ya no existe.' };
    const fecha = d && d.fecha;
    if (!FECHA_VALIDA.test(fecha)) return { ok: false, error: 'La fecha no es válida.' };
    const monto = redondear2(Number(d && d.monto));
    if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
    const mes = fecha.slice(0, 7);
    const [anio, m] = mes.split('-');
    const nombreMes = `${MESES[Number(m) - 1]} de ${anio}`;
    const resultado = crearGasto({
      fecha,
      categoria_id: categoriaComisionesId(),
      descripcion: `Comisión ${vendedor.nombre} - ${nombreMes}`,
      monto,
      medio_pago: d.medio_pago,
      cuenta: d.cuenta,
    });
    if (resultado.ok === false) return resultado;
    const id = Number(
      db.prepare('INSERT INTO comisiones_vendedor_pagos (vendedor_id, mes, gasto_id, fecha, monto) VALUES (?, ?, ?, ?, ?)').run(
        vendedorId,
        mes,
        resultado.id,
        fecha,
        monto
      ).lastInsertRowid
    );
    return { ok: true, id, mes };
  });

  // Deshace un pago de comisión cargado: borra el gasto y la fila.
  ipcMain.handle('vendedores:deshacerPagoComision', (_event, { id }) => {
    const pago = db.prepare('SELECT gasto_id FROM comisiones_vendedor_pagos WHERE id = ?').get(Number(id));
    if (!pago) return { ok: false, error: 'Ese pago ya no existe.' };
    ctx.eliminarGasto(pago.gasto_id);
    db.prepare('DELETE FROM comisiones_vendedor_pagos WHERE id = ?').run(Number(id));
    return { ok: true };
  });
}

module.exports = { registrar };
