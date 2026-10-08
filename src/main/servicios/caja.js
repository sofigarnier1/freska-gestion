// Caja general: cuentas, saldos, operaciones (pases, dólares, canje de cheques, intereses) y cierre de caja.
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

function registrar(ctx) {
  const { FECHA_VALIDA, SIN_ASIGNAR, SQL_NO_CREDITO, SQL_NO_CREDITO_P, claveCuenta, db, guardarConfig, ipcMain, leerConfig, listaDeCuentas, movimientosDeOperaciones, redondear2, saldoDePases, saldosPersonales } = ctx;

  // Todos los movimientos de plata desde `desde`, con la cuenta a la que van (o SIN_ASIGNAR): cobros de clientes,
  // gastos, pagos a proveedores y ajustes. Lo pagado con cheque no mueve ninguna cuenta (son los cheques en cartera).
  function movimientosDeCuentas(desde) {
    const cuentas = listaDeCuentas();
    const canonica = (nombre) => cuentas.find((c) => claveCuenta(c) === claveCuenta(nombre)) || SIN_ASIGNAR;
    const movs = [];
    db.prepare(
      `SELECT p.id, substr(p.fecha, 1, 10) AS fecha, p.monto, p.metodo_pago, p.factura_id,
              (c.nombre || CASE WHEN c.apellido IS NOT NULL AND c.apellido != '' THEN ' ' || c.apellido ELSE '' END) AS cliente
       FROM pagos p LEFT JOIN facturas f ON f.id = p.factura_id JOIN clientes c ON c.id = COALESCE(f.cliente_id, p.cliente_id)
       WHERE substr(p.fecha, 1, 10) >= ? AND ${SQL_NO_CREDITO_P} AND lower(trim(p.metodo_pago)) != 'cheque'`
    )
      .all(desde)
      .forEach((p) =>
        movs.push({
          cuenta: canonica(p.metodo_pago),
          fecha: p.fecha,
          monto: p.monto,
          detalle: `${p.monto >= 0 ? 'Cobro de' : 'Devolución a'} ${p.cliente} (${p.factura_id == null ? 'saldo anterior' : `factura N° ${p.factura_id}`})`,
          tipo: 'cobro',
        })
      );
    // El crédito no sale de ninguna cuenta hasta que se paga el resumen de la tarjeta, y el cheque no mueve cuentas.
    db.prepare("SELECT g.fecha, g.monto, g.descripcion, g.medio_pago, g.cuenta FROM gastos g WHERE g.fecha >= ? AND lower(trim(g.medio_pago)) NOT IN ('cheque', 'crédito')")
      .all(desde)
      .forEach((g) =>
        movs.push({
          cuenta: claveCuenta(g.medio_pago) === 'efectivo' ? canonica('Efectivo') : canonica(g.cuenta),
          fecha: g.fecha,
          monto: -g.monto,
          detalle: `Gasto: ${g.descripcion}`,
          tipo: 'gasto',
        })
      );
    // Las cuotas de tarjeta pagadas: la plata sale de la cuenta con que se pagó la cuota.
    db.prepare(
      `SELECT cg.fecha_pago AS fecha, cg.monto, cg.cuenta, cg.numero, g.cuotas, g.descripcion, g.tarjeta
       FROM cuotas_gasto cg JOIN gastos g ON g.id = cg.gasto_id WHERE cg.fecha_pago IS NOT NULL AND cg.fecha_pago >= ?`
    )
      .all(desde)
      .forEach((c) =>
        movs.push({
          cuenta: canonica(c.cuenta),
          fecha: c.fecha,
          monto: -c.monto,
          detalle: `Cuota ${c.numero} de ${c.cuotas}: ${c.descripcion}${c.tarjeta ? ` (${c.tarjeta})` : ''}`,
          tipo: 'cuota',
        })
      );
    const cuentasDelPago = db.prepare('SELECT cuenta, monto FROM pagos_proveedor_cuentas WHERE pago_proveedor_id = ?');
    db.prepare(
      `SELECT pp.id, pp.fecha, pp.efectivo, pp.transferencia, pr.nombre FROM pagos_proveedor pp
       JOIN proveedores pr ON pr.id = pp.proveedor_id WHERE pp.fecha >= ?`
    )
      .all(desde)
      .forEach((pp) => {
        if (pp.efectivo > 0) movs.push({ cuenta: canonica('Efectivo'), fecha: pp.fecha, monto: -pp.efectivo, detalle: `Pago a ${pp.nombre}`, tipo: 'proveedor' });
        if (pp.transferencia > 0) {
          const partes = cuentasDelPago.all(pp.id);
          const asignado = partes.reduce((acc, x) => acc + x.monto, 0);
          partes.forEach((x) => movs.push({ cuenta: canonica(x.cuenta), fecha: pp.fecha, monto: -x.monto, detalle: `Pago a ${pp.nombre}`, tipo: 'proveedor' }));
          if (pp.transferencia - asignado > 0.005) {
            movs.push({ cuenta: SIN_ASIGNAR, fecha: pp.fecha, monto: -(pp.transferencia - asignado), detalle: `Pago a ${pp.nombre}`, tipo: 'proveedor' });
          }
        }
      });
    db.prepare("SELECT descripcion, cuenta, fecha, monto FROM ingresos WHERE cuenta IS NOT NULL AND cuenta != '' AND fondo_personal = 0 AND fecha >= ?")
      .all(desde)
      .forEach((i) => movs.push({ cuenta: canonica(i.cuenta), fecha: i.fecha, monto: i.monto, detalle: `Ingreso: ${i.descripcion}`, tipo: 'ingreso' }));
    movimientosDeOperaciones(desde).forEach((o) => movs.push(o));
    db.prepare('SELECT cuenta, fecha, monto, nota FROM cuentas_ajustes WHERE fecha >= ?')
      .all(desde)
      .forEach((a) => movs.push({ cuenta: canonica(a.cuenta), fecha: a.fecha, monto: a.monto, detalle: a.nota ? `Ajuste: ${a.nota}` : 'Ajuste de saldo', tipo: 'ajuste' }));
    return movs;
  }

  function resumenDeCuentas() {
    const desde = leerConfig('caja_desde');
    const cuentas = listaDeCuentas();
    const cheques = db.prepare("SELECT COUNT(*) AS cantidad, COALESCE(SUM(importe), 0) AS total FROM cheques WHERE estado = 'en_cartera'").get();
    const usd = Number(leerConfig('caja_dolares_usd')) || 0;
    const cotizacion = Number(leerConfig('caja_cotizacion')) || 0;
    if (!desde) {
      return { configurado: false, cuentas: cuentas.map((nombre) => ({ nombre, saldo_inicial: 0 })), cheques: { cantidad: cheques.cantidad, total: redondear2(cheques.total) } };
    }
    const iniciales = new Map(db.prepare('SELECT cuenta, saldo FROM cuentas_saldos').all().map((r) => [claveCuenta(r.cuenta), r.saldo]));
    const movs = movimientosDeCuentas(desde);
    const saldoDe = (nombre) => redondear2((iniciales.get(claveCuenta(nombre)) || 0) + movs.filter((m) => m.cuenta === nombre).reduce((acc, m) => acc + m.monto, 0));
    // Lo personal que hay en cada banco o app (Fondos personales): no es del negocio y no suma al dinero disponible, pero la
    // Caja lo avisa en una línea chica para poder cruzar el total con el banco. El efectivo personal es un sobre aparte.
    const personales = new Map(saldosPersonales().map((c) => [claveCuenta(c.nombre), c.saldo]));
    const lista = cuentas.map((nombre) => ({
      nombre,
      tipo: claveCuenta(nombre) === 'efectivo' ? 'efectivo' : 'banco',
      saldo_inicial: iniciales.get(claveCuenta(nombre)) || 0,
      saldo: saldoDe(nombre),
      personal: claveCuenta(nombre) === 'efectivo' ? 0 : personales.get(claveCuenta(nombre)) || 0,
      movimientos: movs.filter((m) => m.cuenta === nombre).length,
    }));
    const sinAsignar = movs.filter((m) => m.cuenta === SIN_ASIGNAR);
    const saldoSinAsignar = redondear2(sinAsignar.reduce((acc, m) => acc + m.monto, 0));
    const valorDolares = redondear2(usd * cotizacion);
    const total = redondear2(lista.reduce((acc, c) => acc + c.saldo, 0) + saldoSinAsignar + valorDolares + cheques.total);
    return {
      configurado: true,
      desde,
      cuentas: lista,
      sinAsignar: sinAsignar.length ? { saldo: saldoSinAsignar, movimientos: sinAsignar.length } : null,
      dolares: { usd, cotizacion, valor: valorDolares },
      saldoPases: saldoDePases(),
      cheques: { cantidad: cheques.cantidad, total: redondear2(cheques.total) },
      total,
    };
  }

  ctx.resumenDeCuentas = resumenDeCuentas; // lo usa metodosPago:baja (no se quita una cuenta con plata)
  ipcMain.handle('cuentas:resumen', () => resumenDeCuentas());

  ipcMain.handle('cuentas:movimientos', (_event, nombre) => {
    const desde = leerConfig('caja_desde');
    if (!desde) return [];
    // La clave de una cuenta no tiene espacios ("mercadopago"): se compara así, igual que en el resto de la Caja.
    const inicial = (db.prepare('SELECT cuenta, saldo FROM cuentas_saldos').all().find((r) => claveCuenta(r.cuenta) === claveCuenta(nombre)) || {}).saldo || 0;
    const movs = movimientosDeCuentas(desde)
      .filter((m) => m.cuenta === nombre)
      .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
    let acumulado = inicial;
    const filas = movs.map((m) => {
      acumulado = redondear2(acumulado + m.monto);
      return { ...m, saldo: acumulado };
    });
    return { inicial, desde, movimientos: filas.reverse() };
  });

  // Carga (o corrige) lo que hay en cada cuenta al comenzar el día `desde`, y los dólares con su cotización.
  ipcMain.handle('cuentas:guardarSaldos', (_event, { desde, saldos, dolares_usd, cotizacion }) => {
    if (!FECHA_VALIDA.test(desde)) return { ok: false, error: 'La fecha no es válida.' };
    const cuentas = listaDeCuentas();
    const filas = [];
    for (const nombre of cuentas) {
      const valor = saldos && saldos[nombre] !== undefined && saldos[nombre] !== '' ? Number(saldos[nombre]) : 0;
      if (!Number.isFinite(valor)) return { ok: false, error: `El saldo de ${nombre} no es válido.` };
      filas.push([nombre, redondear2(valor)]);
    }
    const usd = dolares_usd === undefined || dolares_usd === '' ? 0 : Number(dolares_usd);
    const cot = cotizacion === undefined || cotizacion === '' ? 0 : Number(cotizacion);
    if (!Number.isFinite(usd) || usd < 0 || !Number.isFinite(cot) || cot < 0) return { ok: false, error: 'Los dólares o la cotización no son válidos.' };
    db.transaction(() => {
      db.prepare('DELETE FROM cuentas_saldos').run();
      const insertar = db.prepare('INSERT INTO cuentas_saldos (cuenta, saldo) VALUES (?, ?)');
      filas.forEach(([n, v]) => insertar.run(n, v));
      guardarConfig('caja_desde', desde);
      guardarConfig('caja_dolares_usd', usd);
      guardarConfig('caja_cotizacion', cot);
    })();
    return { ok: true };
  });

  // Los dólares (ahorro) y su cotización de hoy, cargada a mano.
  ipcMain.handle('cuentas:guardarDolares', (_event, { dolares_usd, cotizacion }) => {
    const usd = Number(dolares_usd);
    const cot = Number(cotizacion);
    if (!Number.isFinite(usd) || usd < 0 || !Number.isFinite(cot) || cot < 0) return { ok: false, error: 'Los dólares o la cotización no son válidos.' };
    guardarConfig('caja_dolares_usd', usd);
    guardarConfig('caja_cotizacion', cot);
    return { ok: true };
  });

  // "Ajustar saldo": el saldo de la cuenta pasa a ser el que realmente hay (por ejemplo, el del banco); la
  // diferencia queda como un movimiento de ajuste.
  ipcMain.handle('cuentas:ajustar', (_event, { cuenta, saldo_real, nota }) => {
    const resumen = resumenDeCuentas();
    if (!resumen.configurado) return { ok: false, error: 'Primero cargá los saldos de las cuentas.' };
    const c = resumen.cuentas.find((x) => claveCuenta(x.nombre) === claveCuenta(cuenta));
    if (!c) return { ok: false, error: 'Esa cuenta no existe.' };
    const real = Number(saldo_real);
    if (!Number.isFinite(real)) return { ok: false, error: 'Poné el saldo que hay realmente.' };
    const diferencia = redondear2(real - c.saldo);
    if (Math.abs(diferencia) < 0.005) return { ok: true, diferencia: 0 };
    const hoy = db.prepare("SELECT date('now', 'localtime') AS hoy").get().hoy;
    db.prepare('INSERT INTO cuentas_ajustes (cuenta, fecha, monto, nota) VALUES (?, ?, ?, ?)').run(c.nombre, hoy, diferencia, String(nota || '').trim().slice(0, 120) || null);
    return { ok: true, diferencia };
  });

  const sumarDias = (iso, n) => {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // La cuenta del efectivo de cada día, desde el primer cierre guardado hasta `hasta`, con el fondo inicial
  // automático: el fondo de un día sin cierre es lo que quedó en la caja el día anterior (el efectivo contado
  // si se contó y, si no, el esperado). Un cierre guardado conserva el fondo que se escribió. Antes del primer
  // cierre no hay de dónde sacar el fondo (0). Devuelve un Map fecha → datos del día.
  function cuentaDeCajaPorDia(hasta) {
    const cierres = new Map(db.prepare('SELECT fecha, fondo_inicial, efectivo_contado FROM cierres_caja').all().map((c) => [c.fecha, c]));
    const primero = [...cierres.keys()].sort()[0];
    const desde = primero && primero < hasta ? primero : hasta;
    const efectivoPorDia = new Map(
      db
        .prepare(
          `SELECT strftime('%Y-%m-%d', fecha) AS dia, SUM(monto) AS t FROM pagos
           WHERE lower(trim(metodo_pago)) = 'efectivo' AND strftime('%Y-%m-%d', fecha) BETWEEN ? AND ? GROUP BY dia`
        )
        .all(desde, hasta)
        .map((r) => [r.dia, r.t])
    );
    const cobradoPorDia = new Map(
      db
        .prepare(
          `SELECT strftime('%Y-%m-%d', fecha) AS dia, SUM(monto) AS t FROM pagos
           WHERE ${SQL_NO_CREDITO} AND strftime('%Y-%m-%d', fecha) BETWEEN ? AND ? GROUP BY dia`
        )
        .all(desde, hasta)
        .map((r) => [r.dia, r.t])
    );
    const retirosPorDia = new Map();
    const sumarRetiros = (filas) => filas.forEach((r) => retirosPorDia.set(r.dia, (retirosPorDia.get(r.dia) || 0) + r.t));
    sumarRetiros(
      db
        .prepare(`SELECT fecha AS dia, SUM(monto) AS t FROM gastos WHERE lower(trim(medio_pago)) = 'efectivo' AND fecha BETWEEN ? AND ? GROUP BY fecha`)
        .all(desde, hasta)
    );
    // El efectivo pagado a proveedores también sale del cajón del día (2026-09-29: "sale de la plata del
    // negocio, y con el fondo inicial se descuenta de ahí").
    sumarRetiros(
      db
        .prepare('SELECT fecha AS dia, SUM(efectivo) AS t FROM pagos_proveedor WHERE efectivo > 0 AND fecha BETWEEN ? AND ? GROUP BY fecha')
        .all(desde, hasta)
    );
    // Todo lo pagado en el día, de cualquier forma de pago (sin el crédito ni los cheques): gastos, cuotas de tarjeta
    // pagadas y pagos a proveedores en efectivo o transferencia.
    const pagadoPorDia = new Map();
    const sumarPagado = (filas) => filas.forEach((r) => pagadoPorDia.set(r.dia, (pagadoPorDia.get(r.dia) || 0) + r.t));
    sumarPagado(
      db
        .prepare(`SELECT fecha AS dia, SUM(monto) AS t FROM gastos WHERE lower(trim(medio_pago)) NOT IN ('cheque', 'crédito') AND fecha BETWEEN ? AND ? GROUP BY fecha`)
        .all(desde, hasta)
    );
    sumarPagado(db.prepare('SELECT fecha_pago AS dia, SUM(monto) AS t FROM cuotas_gasto WHERE fecha_pago BETWEEN ? AND ? GROUP BY fecha_pago').all(desde, hasta));
    sumarPagado(db.prepare('SELECT fecha AS dia, SUM(efectivo + transferencia) AS t FROM pagos_proveedor WHERE fecha BETWEEN ? AND ? GROUP BY fecha').all(desde, hasta));

    // Depósitos, retiros, canjes y demás operaciones que mueven el efectivo del cajón (aunque la Caja general
    // todavía no tenga saldos cargados: el cajón se cuenta igual).
    const otrosPorDia = new Map();
    movimientosDeOperaciones(desde)
      .filter((o) => claveCuenta(o.cuenta) === 'efectivo' && o.fecha <= hasta)
      .forEach((o) => otrosPorDia.set(o.fecha, (otrosPorDia.get(o.fecha) || 0) + o.monto));
    const dias = new Map();
    let quedo = 0; // lo que quedó en la caja al terminar el día anterior
    for (let d = desde; d <= hasta; d = sumarDias(d, 1)) {
      const cierre = cierres.get(d) || null;
      const fondo = cierre ? cierre.fondo_inicial : quedo;
      const efectivo = redondear2(efectivoPorDia.get(d) || 0);
      const retiros = redondear2(retirosPorDia.get(d) || 0);
      const cobrado = redondear2(cobradoPorDia.get(d) || 0);
      const otros = redondear2(otrosPorDia.get(d) || 0);
      const esperado = redondear2(fondo + efectivo - retiros + otros);
      const contado = cierre ? cierre.efectivo_contado : null;
      quedo = contado !== null && contado !== undefined ? contado : esperado;
      dias.set(d, { fecha: d, cierre: Boolean(cierre), fondo, efectivo, retiros, otros, cobrado, pagado: redondear2(pagadoPorDia.get(d) || 0), esperado, contado: contado === undefined ? null : contado, quedo });
    }
    return dias;
  }

  // El cierre del día de las cuentas que no son efectivo (bancos y apps): lo que había al empezar, lo que entró y lo que
  // salió ese día y el saldo al cerrar. Sale de los movimientos de la Caja general (el efectivo se cuenta aparte, en el
  // cajón); si un banco no coincide, se corrige con "Ajustar saldo" en la Caja general.
  function cierreDeCuentasDelDia(fecha) {
    const desde = leerConfig('caja_desde');
    if (!desde || fecha < desde) return [];
    const cuentas = listaDeCuentas().filter((c) => claveCuenta(c) !== 'efectivo');
    const iniciales = new Map(db.prepare('SELECT cuenta, saldo FROM cuentas_saldos').all().map((r) => [claveCuenta(r.cuenta), r.saldo]));
    const movs = movimientosDeCuentas(desde).filter((m) => m.fecha <= fecha);
    return cuentas.map((nombre) => {
      const propios = movs.filter((m) => m.cuenta === nombre);
      const antes = propios.filter((m) => m.fecha < fecha).reduce((acc, m) => acc + m.monto, 0);
      const delDia = propios.filter((m) => m.fecha === fecha);
      const entro = redondear2(delDia.filter((m) => m.monto > 0).reduce((acc, m) => acc + m.monto, 0));
      const salio = redondear2(-delDia.filter((m) => m.monto < 0).reduce((acc, m) => acc + m.monto, 0));
      const alEmpezar = redondear2((iniciales.get(claveCuenta(nombre)) || 0) + antes);
      return { nombre, alEmpezar, entro, salio, deberia: redondear2(alEmpezar + entro - salio) };
    });
  }

  ipcMain.handle('caja:obtenerDia', (_event, fecha) => {
    if (!FECHA_VALIDA.test(fecha)) return { ok: false, error: 'Fecha inválida.' };
    const cierre = db.prepare('SELECT * FROM cierres_caja WHERE fecha = ?').get(fecha) || null;
    // Fondo inicial automático: lo que quedó en la caja el día anterior (0 si todavía no hay ningún cierre antes).
    const primerCierre = db.prepare('SELECT MIN(fecha) AS f FROM cierres_caja').get().f;
    const ayer = sumarDias(fecha, -1);
    const anterior = primerCierre && primerCierre <= ayer ? { fondo_inicial: cuentaDeCajaPorDia(ayer).get(ayer).quedo, fecha: ayer } : null;
    const cobros = db
      .prepare(
        `SELECT p.id, p.monto, p.metodo_pago, p.fecha, p.factura_id,
                (c.nombre || CASE WHEN c.apellido IS NOT NULL AND c.apellido != '' THEN ' ' || c.apellido ELSE '' END) as cliente_nombre
         FROM pagos p
         LEFT JOIN facturas f ON f.id = p.factura_id
         LEFT JOIN clientes c ON c.id = COALESCE(f.cliente_id, p.cliente_id)
         WHERE strftime('%Y-%m-%d', p.fecha) = ? AND ${SQL_NO_CREDITO_P}
         ORDER BY p.fecha, p.id`
      )
      .all(fecha);
    // Lo que salió del cajón ese día: los gastos pagados en efectivo (los "retiros" son gastos en efectivo) y el
    // efectivo pagado a proveedores.
    const gastosEfectivo = db
      .prepare(
        `SELECT g.id, g.monto, g.descripcion, g.categoria_id, c.nombre AS categoria
         FROM gastos g JOIN categorias_gasto c ON c.id = g.categoria_id
         WHERE g.fecha = ? AND lower(trim(g.medio_pago)) = 'efectivo'
         ORDER BY g.id`
      )
      .all(fecha)
      .map((g) => ({ ...g, origen: 'gasto' }));
    const pagosProveedorDelDia = db
      .prepare(
        `SELECT pp.id, pp.efectivo, pp.transferencia, pr.nombre FROM pagos_proveedor pp
         JOIN proveedores pr ON pr.id = pp.proveedor_id WHERE pp.fecha = ? ORDER BY pp.id`
      )
      .all(fecha);
    pagosProveedorDelDia
      .filter((pp) => pp.efectivo > 0)
      .forEach((pp) => gastosEfectivo.push({ id: pp.id, monto: pp.efectivo, descripcion: `Pago a ${pp.nombre}`, categoria: 'Proveedores', origen: 'proveedor' }));
    // Todo lo que se pagó ese día, de cualquier forma (sin el crédito, que sale al pagar cada cuota, ni los cheques):
    // gastos, cuotas de tarjeta y pagos a proveedores, con "Pagó con".
    const salidasDelDia = [];
    db.prepare(
      `SELECT g.descripcion, g.monto, g.medio_pago, g.cuenta, c.nombre AS categoria, c.ambito
       FROM gastos g JOIN categorias_gasto c ON c.id = g.categoria_id
       WHERE g.fecha = ? AND lower(trim(g.medio_pago)) NOT IN ('cheque', 'crédito') ORDER BY g.id`
    )
      .all(fecha)
      .forEach((g) =>
        salidasDelDia.push({
          detalle: g.descripcion,
          categoria: g.categoria,
          ambito: g.ambito,
          pagoCon: claveCuenta(g.medio_pago) === 'efectivo' ? 'Efectivo' : g.cuenta ? `${g.medio_pago} · ${g.cuenta}` : g.medio_pago,
          efectivo: claveCuenta(g.medio_pago) === 'efectivo',
          monto: g.monto,
        })
      );
    db.prepare(
      `SELECT cg.monto, cg.cuenta, cg.numero, g.cuotas, g.descripcion, c.nombre AS categoria, c.ambito
       FROM cuotas_gasto cg JOIN gastos g ON g.id = cg.gasto_id JOIN categorias_gasto c ON c.id = g.categoria_id
       WHERE cg.fecha_pago = ? ORDER BY cg.id`
    )
      .all(fecha)
      .forEach((q) =>
        salidasDelDia.push({ detalle: `Cuota ${q.numero} de ${q.cuotas}: ${q.descripcion}`, categoria: q.categoria, ambito: q.ambito, pagoCon: q.cuenta || '', efectivo: false, monto: q.monto })
      );
    const cuentasDelPago = db.prepare('SELECT cuenta, monto FROM pagos_proveedor_cuentas WHERE pago_proveedor_id = ?');
    const nombreDeCuenta = (n) => listaDeCuentas().find((c) => claveCuenta(c) === claveCuenta(n)) || n;
    pagosProveedorDelDia.forEach((pp) => {
      if (pp.efectivo > 0) salidasDelDia.push({ detalle: `Pago a ${pp.nombre}`, categoria: 'Proveedores', ambito: 'negocio', pagoCon: 'Efectivo', efectivo: true, monto: pp.efectivo });
      if (pp.transferencia > 0) {
        const partes = cuentasDelPago.all(pp.id);
        const asignado = partes.reduce((acc, x) => acc + x.monto, 0);
        partes.forEach((x) => salidasDelDia.push({ detalle: `Pago a ${pp.nombre}`, categoria: 'Proveedores', ambito: 'negocio', pagoCon: `Transferencia · ${nombreDeCuenta(x.cuenta)}`, efectivo: false, monto: x.monto }));
        if (pp.transferencia - asignado > 0.005) {
          salidasDelDia.push({ detalle: `Pago a ${pp.nombre}`, categoria: 'Proveedores', ambito: 'negocio', pagoCon: 'Transferencia', efectivo: false, monto: redondear2(pp.transferencia - asignado) });
        }
      }
    });
    return {
      ok: true,
      cierre,
      fondoSugerido: anterior ? Math.max(0, redondear2(anterior.fondo_inicial)) : 0,
      gastosEfectivo,
      salidasDelDia,
      // Otros ingresos (alquileres…) que entraron ese día a una cuenta (los de Fondos personales no entran a la caja del negocio).
      ingresosDelDia: redondear2(
        db.prepare("SELECT COALESCE(SUM(monto), 0) AS t FROM ingresos WHERE fecha = ? AND cuenta IS NOT NULL AND cuenta != '' AND fondo_personal = 0").get(fecha).t
      ),
      ...(() => {
        // Depósitos, retiros y cambios de cheques del día en el efectivo: el neto (para la cuenta del cajón) y, por
        // separado, lo que entró y lo que salió (para "Toda la plata del día").
        const ops = movimientosDeOperaciones(fecha).filter((o) => claveCuenta(o.cuenta) === 'efectivo' && o.fecha === fecha);
        const entro = redondear2(ops.filter((o) => o.monto > 0).reduce((acc, o) => acc + o.monto, 0));
        const salio = redondear2(-ops.filter((o) => o.monto < 0).reduce((acc, o) => acc + o.monto, 0));
        return { otrosEfectivo: redondear2(entro - salio), otrosEfectivoEntro: entro, otrosEfectivoSalio: salio };
      })(),
      cajaConfigurada: Boolean(leerConfig('caja_desde')),
      cuentas: cierreDeCuentasDelDia(fecha),
      cobros,
    };
  });

  // Un renglón por cierre guardado, con la diferencia calculada con los cobros y retiros de hoy
  // de ese día (si se cargó algo después de guardar, el estado lo refleja).
  // Todos los días de un mes (hasta hoy) con su cuenta de caja: para ver de un vistazo cómo dio cada cierre.
  ipcMain.handle('caja:resumenMes', (_event, { anio, mes }) => {
    const a = Number(anio);
    const m = Number(mes);
    if (!Number.isInteger(a) || !Number.isInteger(m) || m < 0 || m > 11) return { ok: false, error: 'Mes inválido.' };
    const primero = `${a}-${String(m + 1).padStart(2, '0')}-01`;
    const ultimoDia = new Date(a, m + 1, 0).getDate();
    const hoy = db.prepare("SELECT date('now', 'localtime') AS hoy").get().hoy;
    const ultimo = `${a}-${String(m + 1).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
    const hasta = ultimo < hoy ? ultimo : hoy;
    if (hasta < primero) return { ok: true, dias: [] };
    const porDia = cuentaDeCajaPorDia(hasta);
    const dias = [];
    for (let d = primero; d <= hasta; d = sumarDias(d, 1)) {
      const c = porDia.get(d) || { fecha: d, cierre: false, fondo: 0, efectivo: 0, retiros: 0, otros: 0, cobrado: 0, pagado: 0, esperado: 0, contado: null };
      const diferencia = c.contado === null ? null : redondear2(c.contado - c.esperado);
      let estado;
      if (c.cierre) estado = diferencia === null ? 'sin_contar' : Math.abs(diferencia) < 0.005 ? 'justo' : diferencia > 0 ? 'sobra' : 'falta';
      else estado = c.efectivo !== 0 || c.retiros !== 0 || c.otros !== 0 || c.cobrado !== 0 || c.pagado !== 0 ? 'sin_cerrar' : 'sin_movimiento';
      dias.push({ fecha: d, estado, fondo: c.fondo, efectivo: c.efectivo, retiros: c.retiros, otros: c.otros || 0, cobrado: c.cobrado, pagado: c.pagado, esperado: c.esperado, contado: c.contado, diferencia });
    }
    return { ok: true, dias };
  });

  // La diferencia de cada cierre guardado, con la misma cuenta que el Día a día (cobros y gastos en efectivo,
  // pagos a proveedores en efectivo y depósitos/retiros/canjes).
  ipcMain.handle('caja:resumenCierres', () => {
    const cierres = db.prepare('SELECT fecha FROM cierres_caja ORDER BY fecha').all();
    if (!cierres.length) return [];
    const ultimo = cierres[cierres.length - 1].fecha;
    const hoy = db.prepare("SELECT date('now', 'localtime') AS hoy").get().hoy;
    const porDia = cuentaDeCajaPorDia(ultimo > hoy ? ultimo : hoy);
    return cierres.map(({ fecha }) => {
      const d = porDia.get(fecha);
      return { fecha, diferencia: !d || d.contado === null ? null : redondear2(d.contado - d.esperado) };
    });
  });

  ipcMain.handle('caja:guardarCierre', (_event, { fecha, fondo_inicial, efectivo_contado }) => {
    if (!FECHA_VALIDA.test(fecha)) return { ok: false, error: 'Fecha inválida.' };
    const fondo = Number(fondo_inicial);
    if (!Number.isFinite(fondo) || fondo < 0) return { ok: false, error: 'El fondo inicial no es válido.' };
    const contado =
      efectivo_contado === null || efectivo_contado === undefined ? null : Number(efectivo_contado);
    if (contado !== null && (!Number.isFinite(contado) || contado < 0)) {
      return { ok: false, error: 'El efectivo contado no es válido.' };
    }
    db.prepare(
      `INSERT INTO cierres_caja (fecha, fondo_inicial, efectivo_contado, guardado_en)
       VALUES (?, ?, ?, datetime('now', 'localtime'))
       ON CONFLICT(fecha) DO UPDATE SET
         fondo_inicial = excluded.fondo_inicial,
         efectivo_contado = excluded.efectivo_contado,
         guardado_en = excluded.guardado_en`
    ).run(fecha, redondear2(fondo), contado === null ? null : redondear2(contado));
    return { ok: true };
  });


  // ---------- Operaciones de la Caja general ----------
  // Depósitos, retiros y pases entre cuentas, compra de dólares, canje de cheques e intereses. Son movimientos de plata
  // que ya existía: no cuentan como venta ni como gasto.
  const cuentaValida = (nombre) => listaDeCuentas().find((c) => claveCuenta(c) === claveCuenta(nombre));
  function validarFechaOperacion(fecha) {
    return FECHA_VALIDA.test(String(fecha || ''));
  }
  ipcMain.handle('operaciones:listar', () => {
    const desde = leerConfig('caja_desde');
    if (!desde) return [];
    // Cada operación una sola vez, con un texto para la lista.
    const vistas = new Set();
    const movs = movimientosDeOperaciones(desde).filter((o) => !o.personal);
    // Banco, app o efectivo de cada operación; un pase tiene dos ("Origen → Destino").
    const cuentasDe = new Map();
    movs.forEach((o) => {
      const l = cuentasDe.get(o.id) || [];
      if (!l.includes(o.cuenta)) l.push(o.cuenta);
      cuentasDe.set(o.id, l);
    });
    return movs
      .filter((o) => (vistas.has(o.id) ? false : vistas.add(o.id)))
      .map((o) => {
        const op = db.prepare('SELECT monto, tipo FROM operaciones_caja WHERE id = ?').get(o.id);
        return { id: o.id, fecha: o.fecha, tipo: o.tipo, detalle: o.detalle, cuenta: cuentasDe.get(o.id).join(' → '), monto: Math.abs(op.monto), entra: o.monto >= 0 };
      })
      .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id));
  });
  ipcMain.handle('operaciones:pase', (_event, { fecha, origen, destino, monto, nota }) => {
    if (!validarFechaOperacion(fecha)) return { ok: false, error: 'La fecha no es válida.' };
    const de = cuentaValida(origen);
    const a = cuentaValida(destino);
    if (!de || !a) return { ok: false, error: 'Elegí las dos cuentas.' };
    if (de === a) return { ok: false, error: 'Elegí dos cuentas distintas.' };
    const importe = Number(monto);
    if (!Number.isFinite(importe) || importe <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
    db.prepare("INSERT INTO operaciones_caja (fecha, tipo, cuenta, cuenta_destino, monto, nota) VALUES (?, 'pase', ?, ?, ?, ?)").run(fecha, de, a, redondear2(importe), String(nota || '').trim().slice(0, 200) || null);
    return { ok: true };
  });
  ipcMain.handle('operaciones:comprarDolares', (_event, { fecha, cuenta, usd, cotizacion }) => {
    if (!validarFechaOperacion(fecha)) return { ok: false, error: 'La fecha no es válida.' };
    const de = cuentaValida(cuenta);
    if (!de) return { ok: false, error: 'Elegí con qué cuenta se pagó.' };
    const dolares = Number(usd);
    const cot = Number(cotizacion);
    if (!Number.isFinite(dolares) || dolares <= 0) return { ok: false, error: 'Poné cuántos dólares compró.' };
    if (!Number.isFinite(cot) || cot <= 0) return { ok: false, error: 'Poné a cuánto compró cada dólar.' };
    db.transaction(() => {
      db.prepare("INSERT INTO operaciones_caja (fecha, tipo, cuenta, monto, usd, cotizacion) VALUES (?, 'dolares', ?, ?, ?, ?)").run(fecha, de, redondear2(dolares * cot), dolares, cot);
      guardarConfig('caja_dolares_usd', redondear2((Number(leerConfig('caja_dolares_usd')) || 0) + dolares));
    })();
    return { ok: true };
  });
  // Un cheque de la cartera se canjea por plata de la caja, a su valor completo (un favor: sin descuento). El cheque
  // sale de la cartera y esa plata entra a la cuenta elegida.
  ipcMain.handle('operaciones:canjearCheque', (_event, { fecha, cheque_id, cuenta }) => {
    if (!validarFechaOperacion(fecha)) return { ok: false, error: 'La fecha no es válida.' };
    const a = cuentaValida(cuenta);
    if (!a) return { ok: false, error: 'Elegí de dónde sale la plata.' };
    const cheque = db.prepare("SELECT id, importe FROM cheques WHERE id = ? AND estado = 'en_cartera'").get(Number(cheque_id));
    if (!cheque) return { ok: false, error: 'Elegí un cheque de la cartera.' };
    db.transaction(() => {
      db.prepare("INSERT INTO operaciones_caja (fecha, tipo, cuenta, monto, cheque_id) VALUES (?, 'canje', ?, ?, ?)").run(fecha, a, cheque.importe, cheque.id);
      db.prepare("UPDATE cheques SET estado = 'entregado', entregado_a = 'Canje por efectivo', fecha_entrega = ? WHERE id = ?").run(fecha, cheque.id);
    })();
    return { ok: true };
  });
  ipcMain.handle('operaciones:interes', (_event, { fecha, cuenta, monto, tipo, nota }) => {
    if (!validarFechaOperacion(fecha)) return { ok: false, error: 'La fecha no es válida.' };
    const c = cuentaValida(cuenta);
    if (!c) return { ok: false, error: 'Elegí la cuenta.' };
    const importe = Number(monto);
    if (!Number.isFinite(importe) || importe <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
    db.prepare("INSERT INTO operaciones_caja (fecha, tipo, cuenta, monto, nota) VALUES (?, 'interes', ?, ?, ?)").run(fecha, c, tipo === 'pagado' ? -redondear2(importe) : redondear2(importe), String(nota || '').trim().slice(0, 200) || null);
    return { ok: true };
  });
  // Reintegro del negocio: plata que un banco o app devuelve (de una comisión, una promoción…). Entra a la cuenta y en
  // Estadísticas → Negocio cuenta como entrada aparte ("Reintegros"). El de Fondos personales es otro (`ingresos:reintegro`).
  ipcMain.handle('operaciones:reintegro', (_event, { fecha, cuenta, monto, nota }) => {
    if (!validarFechaOperacion(fecha)) return { ok: false, error: 'La fecha no es válida.' };
    const c = cuentaValida(cuenta);
    if (!c) return { ok: false, error: 'Elegí la cuenta.' };
    const importe = Number(monto);
    if (!Number.isFinite(importe) || importe <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
    db.prepare("INSERT INTO operaciones_caja (fecha, tipo, cuenta, monto, nota) VALUES (?, 'reintegro', ?, ?, ?)").run(fecha, c, redondear2(importe), String(nota || '').trim().slice(0, 200) || null);
    return { ok: true };
  });
  ipcMain.handle('operaciones:eliminar', (_event, id) => {
    const op = db.prepare('SELECT * FROM operaciones_caja WHERE id = ?').get(Number(id));
    if (!op) return { ok: true };
    // Un cheque recibido a cambio de efectivo (canje con monto negativo): deshacerlo borra el cheque y devuelve el
    // efectivo. Si el cheque ya se entregó, no se puede.
    if (op.tipo === 'canje' && op.monto < 0 && op.cheque_id) {
      const ch = db.prepare('SELECT estado FROM cheques WHERE id = ?').get(op.cheque_id);
      if (ch && ch.estado !== 'en_cartera') return { ok: false, error: 'Ese cheque ya se entregó: no se puede deshacer el cambio.' };
      db.transaction(() => {
        db.prepare('UPDATE gastos SET cheque_id = NULL WHERE cheque_id = ?').run(op.cheque_id);
        db.prepare('DELETE FROM cheques WHERE id = ?').run(op.cheque_id);
        db.prepare('DELETE FROM operaciones_caja WHERE id = ?').run(op.id);
      })();
      return { ok: true };
    }
    db.transaction(() => {
      if (op.tipo === 'dolares') guardarConfig('caja_dolares_usd', Math.max(0, redondear2((Number(leerConfig('caja_dolares_usd')) || 0) - (op.usd || 0))));
      if (op.tipo === 'canje' && op.cheque_id) {
        db.prepare("UPDATE cheques SET estado = 'en_cartera', entregado_a = NULL, fecha_entrega = NULL WHERE id = ? AND estado = 'entregado' AND pago_proveedor_id IS NULL").run(op.cheque_id);
      }
      db.prepare('DELETE FROM operaciones_caja WHERE id = ?').run(op.id);
    })();
    return { ok: true };
  });
}

module.exports = { registrar };
