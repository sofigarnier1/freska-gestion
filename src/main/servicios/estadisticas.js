// Estadísticas, inflación y reportes.
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

function registrar(ctx) {
  const { FECHA_VALIDA, SQL_NO_CREDITO, SQL_NO_CREDITO_P, SQL_PROVEEDORES, db, ipcMain, redondear2 } = ctx;

  // Los gastos "en base caja" (para las estadísticas): lo que se pagó el día que se pagó. Un gasto en crédito cuenta
  // en cada cuota que se paga, y no el día de la compra. Los retiros de Fondos personales cuentan como gastos de
  // una categoría personal (solo se ven en Personal y Total).
  const SQL_GASTOS_CAJA = `
    SELECT g.id, g.fecha, g.categoria_id, g.monto, g.medio_pago, g.descripcion FROM gastos g WHERE lower(trim(g.medio_pago)) != 'crédito'
    UNION ALL
    SELECT g.id, cg.fecha_pago AS fecha, g.categoria_id, cg.monto, g.medio_pago, g.descripcion FROM cuotas_gasto cg JOIN gastos g ON g.id = cg.gasto_id WHERE cg.fecha_pago IS NOT NULL
    UNION ALL
    SELECT r.id, r.fecha, r.categoria_id, r.monto, 'Fondos personales' AS medio_pago, r.descripcion FROM retiros_personales r`;

  // ---------- Estadísticas (entradas y salidas) ----------
  // Todo "en base caja", como la planilla del dueño: lo cobrado cuenta el día que se cobró y lo pagado (gastos y
  // pagos a proveedores, con efectivo, transferencia o cheques) el día que se pagó. Las compras a crédito
  // no cuentan hasta que se pagan.
  ipcMain.handle('estadisticas:resumen', (_event, { desde, hasta } = {}) => {
    if ((desde && !FECHA_VALIDA.test(desde)) || (hasta && !FECHA_VALIDA.test(hasta))) {
      return { ok: false, error: 'Fecha inválida.' };
    }
    const acotar = (columna) => {
      const cond = [];
      const params = [];
      if (desde) {
        cond.push(`${columna} >= ?`);
        params.push(desde);
      }
      if (hasta) {
        cond.push(`${columna} <= ?`);
        params.push(hasta);
      }
      return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
    };

    // Entradas: cobros por método.
    const cobros = acotar("strftime('%Y-%m-%d', fecha)");
    const porMetodo = db
      .prepare(
        `SELECT metodo_pago AS metodo, ROUND(SUM(monto), 2) AS total, COUNT(*) AS cantidad
         FROM pagos ${cobros.where ? `${cobros.where} AND` : 'WHERE'} ${SQL_NO_CREDITO} GROUP BY metodo_pago ORDER BY total DESC`
      )
      .all(...cobros.params);
    const totalEntradas = redondear2(porMetodo.reduce((acc, m) => acc + m.total, 0));

    // Salidas: gastos por categoría.
    const gas = acotar('g.fecha');
    const porCategoria = db
      .prepare(
        `SELECT c.nombre AS categoria, c.ambito AS ambito, ROUND(SUM(g.monto), 2) AS total, COUNT(*) AS cantidad
         FROM (${SQL_GASTOS_CAJA}) g JOIN categorias_gasto c ON c.id = g.categoria_id ${gas.where}
         GROUP BY c.id ORDER BY total DESC`
      )
      .all(...gas.params);
    const totalGastos = redondear2(porCategoria.reduce((acc, c) => acc + c.total, 0));
    // Lo que se sacó del negocio para vivir: los gastos de Gastos con una categoría personal (no los gastos de propiedades
    // de Fondos personales, que salen de la plata personal). Para el "Resultado final" de la vista Negocio.
    const paraVivir = redondear2(
      db
        .prepare(
          `SELECT COALESCE(SUM(g.monto), 0) AS t FROM (${SQL_GASTOS_CAJA}) g JOIN categorias_gasto c ON c.id = g.categoria_id
           ${gas.where ? `${gas.where} AND` : 'WHERE'} c.ambito = 'personal' AND g.medio_pago != 'Fondos personales'`
        )
        .get(...gas.params).t
    );
    // Gastos por forma de pago (simétrico a "Entradas por forma de pago"), y los gastos individuales más
    // grandes del período (2026-09-28), como "Clientes que más compraron" en Ventas. Solo del negocio
    // (sin los "Particulares"), como el resto de esta sección cuando se mira la vista Negocio.
    const gasNegocio = `${gas.where ? `${gas.where} AND` : 'WHERE'} c.ambito = 'negocio'`;
    const gastosPorMetodo = db
      .prepare(
        `SELECT g.medio_pago AS metodo, ROUND(SUM(g.monto), 2) AS total, COUNT(*) AS cantidad
         FROM (${SQL_GASTOS_CAJA}) g JOIN categorias_gasto c ON c.id = g.categoria_id ${gasNegocio} GROUP BY g.medio_pago ORDER BY total DESC`
      )
      .all(...gas.params);
    const topGastos = db
      .prepare(
        `SELECT g.id, g.fecha, g.descripcion, g.monto, c.nombre AS categoria
         FROM (${SQL_GASTOS_CAJA}) g JOIN categorias_gasto c ON c.id = g.categoria_id ${gasNegocio}
         ORDER BY g.monto DESC LIMIT 8`
      )
      .all(...gas.params);

    // Salidas: pagos a proveedores.
    const pp = acotar('pp.fecha');
    const prov = db
      .prepare(
        `SELECT COUNT(*) AS cantidad,
                COALESCE(SUM(pp.efectivo), 0) AS efectivo,
                COALESCE(SUM(pp.transferencia), 0) AS transferencia,
                COALESCE(SUM((SELECT COALESCE(SUM(c.importe), 0) FROM cheques c WHERE c.pago_proveedor_id = pp.id)), 0) AS cheques
         FROM pagos_proveedor pp ${pp.where}`
      )
      .get(...pp.params);
    // La plata que un proveedor devolvió (devolución de mercadería) resta de lo pagado: efectivo o transferencia según dónde entró.
    const devProv = acotar('d.fecha');
    const reembolsos = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN lower(replace(d.reembolso_cuenta, ' ', '')) = 'efectivo' THEN d.monto ELSE 0 END), 0) AS efectivo,
                COALESCE(SUM(CASE WHEN lower(replace(d.reembolso_cuenta, ' ', '')) = 'efectivo' THEN 0 ELSE d.monto END), 0) AS transferencia
         FROM devoluciones_proveedor d ${devProv.where ? `${devProv.where} AND` : 'WHERE'} d.reembolso_cuenta IS NOT NULL`
      )
      .get(...devProv.params);
    const proveedores = {
      cantidad: prov.cantidad,
      efectivo: redondear2(prov.efectivo - reembolsos.efectivo),
      transferencia: redondear2(prov.transferencia - reembolsos.transferencia),
      cheques: redondear2(prov.cheques),
      total: redondear2(prov.efectivo + prov.transferencia + prov.cheques - reembolsos.efectivo - reembolsos.transferencia),
    };

    // Ingresos personales e intereses del período. Se agrupan por categoría (cada propiedad es una), igual que las salidas;
    // un ingreso viejo sin categoría se agrupa por su descripción.
    const ing = acotar('i.fecha');
    const ingresosPorOrigen = db
      .prepare(
        `SELECT COALESCE(c.nombre, i.descripcion) AS origen, ROUND(SUM(i.monto - i.retencion), 2) AS total, COUNT(*) AS cantidad
         FROM ingresos i LEFT JOIN categorias_gasto c ON c.id = i.categoria_id ${ing.where} GROUP BY COALESCE(c.nombre, i.descripcion) ORDER BY total DESC`
      )
      .all(...ing.params);
    const personalPeriodo = ingresosEIntereses(desde || '0000-00-00', hasta || '9999-12-31');

    // Mes a mes: los 12 meses que terminan en el mes de "hasta" (o de hoy).
    const fin = hasta ? new Date(`${hasta}T00:00:00`) : new Date();
    const meses = [];
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(fin.getFullYear(), fin.getMonth() - i, 1);
      meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const desdeSerie = `${meses[0]}-01`;
    const hastaSerie = `${meses[11]}-31`;
    const mapa = new Map(meses.map((m) => [m, { mes: m, entradas: 0, gastos: 0, particulares: 0, proveedores: 0, ingresos: 0, interesesGanados: 0, interesesPagados: 0, reintegros: 0 }]));
    db.prepare(
      `SELECT strftime('%Y-%m', fecha) AS mes, SUM(monto) AS total FROM pagos
       WHERE strftime('%Y-%m-%d', fecha) BETWEEN ? AND ? AND ${SQL_NO_CREDITO} GROUP BY mes`
    )
      .all(desdeSerie, hastaSerie)
      .forEach((f) => mapa.has(f.mes) && (mapa.get(f.mes).entradas = redondear2(f.total)));
    db.prepare(
      `SELECT substr(g.fecha, 1, 7) AS mes, SUM(g.monto) AS total,
              SUM(CASE WHEN c.ambito = 'personal' THEN g.monto ELSE 0 END) AS particulares
       FROM (${SQL_GASTOS_CAJA}) g JOIN categorias_gasto c ON c.id = g.categoria_id
       WHERE g.fecha BETWEEN ? AND ? GROUP BY mes`
    )
      .all(desdeSerie, hastaSerie)
      .forEach((f) => {
        if (!mapa.has(f.mes)) return;
        mapa.get(f.mes).gastos = redondear2(f.total);
        mapa.get(f.mes).particulares = redondear2(f.particulares);
      });
    db.prepare(
      `SELECT substr(pp.fecha, 1, 7) AS mes,
              SUM(pp.efectivo + pp.transferencia
                  + COALESCE((SELECT SUM(c.importe) FROM cheques c WHERE c.pago_proveedor_id = pp.id), 0)) AS total
       FROM pagos_proveedor pp WHERE pp.fecha BETWEEN ? AND ? GROUP BY mes`
    )
      .all(desdeSerie, hastaSerie)
      .forEach((f) => mapa.has(f.mes) && (mapa.get(f.mes).proveedores = redondear2(f.total)));
    db.prepare(
      `SELECT substr(fecha, 1, 7) AS mes, SUM(monto) AS total FROM devoluciones_proveedor
       WHERE reembolso_cuenta IS NOT NULL AND fecha BETWEEN ? AND ? GROUP BY mes`
    )
      .all(desdeSerie, hastaSerie)
      .forEach((f) => mapa.has(f.mes) && (mapa.get(f.mes).proveedores = redondear2((mapa.get(f.mes).proveedores || 0) - f.total)));
    db.prepare("SELECT substr(fecha, 1, 7) AS mes, SUM(monto - retencion) AS total FROM ingresos WHERE fecha BETWEEN ? AND ? GROUP BY mes")
      .all(desdeSerie, hastaSerie)
      .forEach((f) => mapa.has(f.mes) && (mapa.get(f.mes).ingresos = redondear2(f.total)));
    db.prepare(
      `SELECT substr(fecha, 1, 7) AS mes, SUM(CASE WHEN monto > 0 THEN monto ELSE 0 END) AS ganados, SUM(CASE WHEN monto < 0 THEN -monto ELSE 0 END) AS pagados
       FROM operaciones_caja WHERE tipo = 'interes' AND fecha BETWEEN ? AND ? GROUP BY mes`
    )
      .all(desdeSerie, hastaSerie)
      .forEach((f) => {
        if (!mapa.has(f.mes)) return;
        mapa.get(f.mes).interesesGanados = redondear2(f.ganados);
        mapa.get(f.mes).interesesPagados = redondear2(f.pagados);
      });
    db.prepare("SELECT substr(fecha, 1, 7) AS mes, SUM(monto) AS total FROM operaciones_caja WHERE tipo = 'reintegro' AND fecha BETWEEN ? AND ? GROUP BY mes")
      .all(desdeSerie, hastaSerie)
      .forEach((f) => mapa.has(f.mes) && (mapa.get(f.mes).reintegros = redondear2(f.total)));

    // Período anterior para comparar: el mismo largo, terminando el día antes de "desde". Si el período
    // termina en el futuro (por ejemplo, "este mes" a mitad de mes), se compara solo hasta hoy, para no
    // contar contra días que todavía no pasaron.
    let anterior = null;
    if (desde && hasta) {
      const aFecha = (iso) => new Date(`${iso}T00:00:00`);
      const aIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const hoy = aIso(new Date());
      const fin = hasta > hoy ? hoy : hasta;
      if (fin >= desde) {
        const dias = Math.round((aFecha(fin) - aFecha(desde)) / 86400000) + 1;
        const d0 = aFecha(desde);
        const esMes = d0.getDate() === 1 && aIso(new Date(d0.getFullYear(), d0.getMonth() + 1, 0)) === hasta;
        const esAnio = desde.endsWith('-01-01') && hasta === `${d0.getFullYear()}-12-31`;
        let antDesde;
        let antHasta;
        if (esMes || esAnio) {
          // Un mes se compara con el mes anterior (y un año con el anterior), los mismos primeros días.
          antDesde = esMes ? new Date(d0.getFullYear(), d0.getMonth() - 1, 1) : new Date(d0.getFullYear() - 1, 0, 1);
          antHasta = new Date(antDesde);
          antHasta.setDate(antHasta.getDate() + dias - 1);
          const topeAnterior = esMes ? new Date(antDesde.getFullYear(), antDesde.getMonth() + 1, 0) : new Date(antDesde.getFullYear(), 11, 31);
          if (antHasta > topeAnterior) antHasta = topeAnterior;
        } else {
          antHasta = new Date(d0);
          antHasta.setDate(antHasta.getDate() - 1);
          antDesde = new Date(antHasta);
          antDesde.setDate(antDesde.getDate() - (dias - 1));
        }
        anterior = { desde: aIso(antDesde), hasta: aIso(antHasta), comparadoHasta: fin, ...totalesDelPeriodo(aIso(antDesde), aIso(antHasta)) };
      }
    }

    return {
      ok: true,
      entradas: { total: totalEntradas, porMetodo },
      salidas: { gastos: { total: totalGastos, paraVivir, porCategoria, porMetodo: gastosPorMetodo, top: topGastos }, proveedores, total: redondear2(totalGastos + proveedores.total) },
      personal: { ingresos: { total: redondear2(ingresosPorOrigen.reduce((a, o) => a + o.total, 0)), porOrigen: ingresosPorOrigen } },
      intereses: { ganados: personalPeriodo.interesesGanados, pagados: personalPeriodo.interesesPagados, reintegros: personalPeriodo.reintegros },
      serie: Array.from(mapa.values()),
      anterior,
    };
  });

  // Totales de un período: entradas, gastos (y cuánto de eso es "Particulares") y pagos a proveedores.
  function totalesDelPeriodo(desde, hasta) {
    const entradas = db
      .prepare(`SELECT COALESCE(SUM(monto), 0) AS t FROM pagos WHERE strftime('%Y-%m-%d', fecha) BETWEEN ? AND ? AND ${SQL_NO_CREDITO}`)
      .get(desde, hasta).t;
    const gastos = db
      .prepare(
        `SELECT COALESCE(SUM(g.monto), 0) AS t,
                COALESCE(SUM(CASE WHEN c.ambito = 'personal' THEN g.monto ELSE 0 END), 0) AS particulares,
                COALESCE(SUM(CASE WHEN c.ambito = 'personal' AND g.medio_pago != 'Fondos personales' THEN g.monto ELSE 0 END), 0) AS para_vivir
         FROM (${SQL_GASTOS_CAJA}) g JOIN categorias_gasto c ON c.id = g.categoria_id WHERE g.fecha BETWEEN ? AND ?`
      )
      .get(desde, hasta);
    const proveedores = db
      .prepare(
        `SELECT COALESCE(SUM(pp.efectivo + pp.transferencia
                             + COALESCE((SELECT SUM(c.importe) FROM cheques c WHERE c.pago_proveedor_id = pp.id), 0)), 0) AS t
         FROM pagos_proveedor pp WHERE pp.fecha BETWEEN ? AND ?`
      )
      .get(desde, hasta).t
      - db.prepare('SELECT COALESCE(SUM(monto), 0) AS t FROM devoluciones_proveedor WHERE reembolso_cuenta IS NOT NULL AND fecha BETWEEN ? AND ?').get(desde, hasta).t;
    const personal = ingresosEIntereses(desde, hasta);
    return {
      entradas: redondear2(entradas),
      gastos: redondear2(gastos.t),
      particulares: redondear2(gastos.particulares),
      paraVivir: redondear2(gastos.para_vivir),
      proveedores: redondear2(proveedores),
      ingresos: personal.ingresos,
      interesesGanados: personal.interesesGanados,
      interesesPagados: personal.interesesPagados,
      reintegros: personal.reintegros,
    };
  }

  // Lo que no es venta ni gasto del negocio: los ingresos personales (Cobros → Otros ingresos) y los intereses que
  // el banco pagó (ganados) o cobró (pagados) en la Caja general.
  function ingresosEIntereses(desde, hasta) {
    const ing = db.prepare('SELECT COALESCE(SUM(monto - retencion), 0) AS t FROM ingresos WHERE fecha BETWEEN ? AND ?').get(desde, hasta).t;
    const inter = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN monto > 0 THEN monto ELSE 0 END), 0) AS ganados,
                COALESCE(SUM(CASE WHEN monto < 0 THEN -monto ELSE 0 END), 0) AS pagados
         FROM operaciones_caja WHERE tipo = 'interes' AND fecha BETWEEN ? AND ?`
      )
      .get(desde, hasta);
    const reint = db.prepare("SELECT COALESCE(SUM(monto), 0) AS t FROM operaciones_caja WHERE tipo = 'reintegro' AND fecha BETWEEN ? AND ?").get(desde, hasta).t;
    return { ingresos: redondear2(ing), interesesGanados: redondear2(inter.ganados), interesesPagados: redondear2(inter.pagados), reintegros: redondear2(reint) };
  }

  // Plata pendiente, hoy (no depende del período): lo que deben los clientes, lo que se debe a proveedores y
  // los cheques en cartera (con los que ya se pueden cobrar o vencen en los próximos 7 días).
  ipcMain.handle('estadisticas:pendiente', () => {
    const clientes = db
      .prepare(
        `SELECT id, nombre, apellido, saldo FROM clientes WHERE saldo > 0 ORDER BY saldo DESC`
      )
      .all();
    const proveedoresConDeuda = db
      .prepare(`SELECT id, nombre, saldo FROM (${SQL_PROVEEDORES}) WHERE saldo > 0 ORDER BY saldo DESC, nombre COLLATE NOCASE`)
      .all();
    const cheques = db
      .prepare("SELECT COUNT(*) AS cantidad, COALESCE(SUM(importe), 0) AS total FROM cheques WHERE estado = 'en_cartera'")
      .get();
    const porVencer = db
      .prepare(
        `SELECT COUNT(*) AS cantidad, COALESCE(SUM(importe), 0) AS total FROM cheques
         WHERE estado = 'en_cartera' AND fecha_cobro IS NOT NULL AND fecha_cobro <= date('now', 'localtime', '+7 day')`
      )
      .get();
    return {
      clientes: {
        cantidad: clientes.length,
        total: redondear2(clientes.reduce((acc, c) => acc + c.saldo, 0)),
        mayores: clientes.slice(0, 5).map((c) => ({
          id: c.id,
          nombre: `${c.nombre}${c.apellido ? ` ${c.apellido}` : ''}`,
          saldo: redondear2(c.saldo),
        })),
      },
      proveedores: {
        cantidad: proveedoresConDeuda.length,
        total: redondear2(proveedoresConDeuda.reduce((acc, p) => acc + p.saldo, 0)),
        mayores: proveedoresConDeuda.slice(0, 5).map((p) => ({ id: p.id, nombre: p.nombre, saldo: redondear2(p.saldo) })),
      },
      cheques: {
        cantidad: cheques.cantidad,
        total: redondear2(cheques.total),
        porVencer: { cantidad: porVencer.cantidad, total: redondear2(porVencer.total) },
      },
    };
  });

  // Lo más vendido y los clientes que más compraron en el período (facturas no anuladas).
  ipcMain.handle('estadisticas:rankings', (_event, { desde, hasta } = {}) => {
    if ((desde && !FECHA_VALIDA.test(desde)) || (hasta && !FECHA_VALIDA.test(hasta))) {
      return { ok: false, error: 'Fecha inválida.' };
    }
    const cond = ["f.estado != 'anulada'"];
    const params = [];
    if (desde) {
      cond.push("strftime('%Y-%m-%d', f.fecha) >= ?");
      params.push(desde);
    }
    if (hasta) {
      cond.push("strftime('%Y-%m-%d', f.fecha) <= ?");
      params.push(hasta);
    }
    const donde = `WHERE ${cond.join(' AND ')}`;
    const productos = db
      .prepare(
        `SELECT p.id, p.nombre, p.unidad, ROUND(SUM(fi.cantidad), 3) AS cantidad, ROUND(SUM(fi.subtotal), 2) AS importe
         FROM factura_items fi JOIN facturas f ON f.id = fi.factura_id JOIN productos p ON p.id = fi.producto_id
         ${donde} GROUP BY p.id ORDER BY importe DESC LIMIT 10`
      )
      .all(...params);
    const clientes = db
      .prepare(
        `SELECT c.id, c.nombre, c.apellido, COUNT(*) AS facturas, ROUND(SUM(f.total), 2) AS importe
         FROM facturas f JOIN clientes c ON c.id = f.cliente_id
         ${donde} GROUP BY c.id ORDER BY importe DESC LIMIT 10`
      )
      .all(...params)
      .map((c) => ({ id: c.id, nombre: `${c.nombre}${c.apellido ? ` ${c.apellido}` : ''}`, facturas: c.facturas, importe: c.importe }));
    const ventas = db
      .prepare(`SELECT COUNT(*) AS facturas, COALESCE(SUM(f.total), 0) AS importe FROM facturas f ${donde}`)
      .get(...params);
    // Ventas (facturado) de cada día de la semana, de lunes a domingo.
    const porDia = db
      .prepare(`SELECT CAST(strftime('%w', f.fecha) AS INTEGER) AS dia, COUNT(*) AS facturas, ROUND(SUM(f.total), 2) AS importe FROM facturas f ${donde} GROUP BY dia`)
      .all(...params);
    const nombresDias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const porDiaSemana = [1, 2, 3, 4, 5, 6, 0].map((d) => {
      const fila = porDia.find((x) => x.dia === d);
      return { dia: nombresDias[d], facturas: fila ? fila.facturas : 0, importe: fila ? fila.importe : 0 };
    });
    // Lo cobrado en el período por vendedor, aparte de lo vendido "de Freska" (clientes sin vendedor): a
    // diferencia del resto de esta pantalla, esto es sobre lo COBRADO, no lo facturado (2026-09-28), como
    // el informe de Vendedores. Un cobro con "saldo a favor" no es plata nueva, no cuenta.
    const cobrosCond = ["f.estado != 'anulada'", "lower(trim(p.metodo_pago)) != 'saldo a favor'"];
    const cobrosParams = [];
    if (desde) {
      cobrosCond.push("strftime('%Y-%m-%d', p.fecha) >= ?");
      cobrosParams.push(desde);
    }
    if (hasta) {
      cobrosCond.push("strftime('%Y-%m-%d', p.fecha) <= ?");
      cobrosParams.push(hasta);
    }
    const cobrosPorVendedor = db
      .prepare(
        `SELECT f.vendedor_id AS vendedor_id, ROUND(SUM(p.monto), 2) AS total
         FROM pagos p JOIN facturas f ON f.id = p.factura_id
         WHERE ${cobrosCond.join(' AND ')} GROUP BY f.vendedor_id`
      )
      .all(...cobrosParams);
    const listaVendedores = db.prepare('SELECT id, numero, nombre FROM vendedores ORDER BY numero, nombre COLLATE NOCASE').all();
    const conocidos = new Set(listaVendedores.map((v) => v.id));
    const comisionistas = {
      vendedores: listaVendedores
        .map((v) => ({ id: v.id, numero: v.numero, nombre: v.nombre, total: redondear2((cobrosPorVendedor.find((c) => c.vendedor_id === v.id) || {}).total || 0) }))
        .filter((v) => v.total > 0)
        .sort((a, b) => b.total - a.total),
      directo: redondear2(cobrosPorVendedor.filter((c) => !c.vendedor_id || !conocidos.has(c.vendedor_id)).reduce((acc, c) => acc + c.total, 0)),
    };
    return { ok: true, productos, clientes, ventas: { facturas: ventas.facturas, importe: redondear2(ventas.importe) }, porDiaSemana, comisionistas };
  });

  // Precio por kilo de lo que se compra: por producto (+ descripción, si tiene) y proveedor, el último precio
  // del período contra el anterior (la compra inmediatamente previa de ese mismo producto a ese proveedor) y
  // el promedio del período.
  ipcMain.handle('estadisticas:preciosCompras', (_event, { desde, hasta } = {}) => {
    if ((desde && !FECHA_VALIDA.test(desde)) || (hasta && !FECHA_VALIDA.test(hasta))) return { ok: false, error: 'Fecha inválida.' };
    const filas = db
      .prepare(
        `SELECT lower(trim(ci.producto)) || '|' || lower(trim(ci.descripcion)) AS clave,
                CASE WHEN trim(ci.descripcion) = '' THEN ci.producto ELSE ci.producto || ' — ' || ci.descripcion END AS producto,
                pr.id AS proveedor_id, pr.nombre AS proveedor, c.fecha, c.id AS compra_id, ci.kilos, ci.importe
         FROM compra_items ci JOIN compras c ON c.id = ci.compra_id JOIN proveedores pr ON pr.id = c.proveedor_id
         WHERE ci.unidad = 'kg' AND ci.kilos IS NOT NULL AND ci.kilos > 0 ORDER BY c.fecha, c.id`
      )
      .all();
    const grupos = new Map();
    filas.forEach((f) => {
      const k = `${f.proveedor_id}|${f.clave}`;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(f);
    });
    const filasPeriodo = [];
    grupos.forEach((lista) => {
      const enPeriodo = lista.filter((f) => (!desde || f.fecha >= desde) && (!hasta || f.fecha <= hasta));
      if (!enPeriodo.length) return;
      const ultima = enPeriodo[enPeriodo.length - 1];
      const indice = lista.indexOf(ultima);
      const previa = indice > 0 ? lista[indice - 1] : null;
      const kilos = enPeriodo.reduce((a, f) => a + f.kilos, 0);
      const importe = enPeriodo.reduce((a, f) => a + f.importe, 0);
      filasPeriodo.push({
        producto: ultima.producto,
        proveedor: ultima.proveedor,
        kilos: redondear2(kilos),
        promedio: redondear2(importe / kilos),
        ultimo: redondear2(ultima.importe / ultima.kilos),
        fechaUltimo: ultima.fecha,
        previo: previa ? redondear2(previa.importe / previa.kilos) : null,
        fechaPrevio: previa ? previa.fecha : null,
      });
    });
    filasPeriodo.sort((a, b) => b.kilos - a.kilos);
    return { ok: true, filas: filasPeriodo.slice(0, 20) };
  });

  ipcMain.handle('inflacion:listar', () => db.prepare('SELECT mes, porcentaje FROM inflacion ORDER BY mes').all());
  ipcMain.handle('inflacion:guardar', (_event, { mes, porcentaje }) => {
    if (!/^\d{4}-\d{2}$/.test(String(mes || ''))) return { ok: false, error: 'El mes no es válido.' };
    if (porcentaje === null || porcentaje === '' || porcentaje === undefined) {
      db.prepare('DELETE FROM inflacion WHERE mes = ?').run(mes);
      return { ok: true };
    }
    const n = Number(porcentaje);
    if (!Number.isFinite(n) || n < -50 || n > 500) return { ok: false, error: 'El porcentaje no es válido.' };
    db.prepare('INSERT INTO inflacion (mes, porcentaje) VALUES (?, ?) ON CONFLICT(mes) DO UPDATE SET porcentaje = excluded.porcentaje').run(mes, n);
    return { ok: true };
  });

  ipcMain.handle('reportes:cobrosPorDia', () => {
    return db
      .prepare(
        `SELECT strftime('%Y-%m-%d', fecha) as periodo, metodo_pago, SUM(monto) as total
         FROM pagos
         WHERE ${SQL_NO_CREDITO}
         GROUP BY periodo, metodo_pago
         ORDER BY periodo DESC`
      )
      .all();
  });

  // De dónde sale el total cobrado de un día (Cobros → Historial → Por día): un renglón por cliente y método de
  // pago, con el mismo criterio que `reportes:cobrosPorDia` (así la suma da el mismo total). Incluye los cobros
  // del saldo anterior, que no tienen factura. Un cliente que pagó dos veces con el mismo método sale en una línea.
  ipcMain.handle('reportes:cobrosDelDia', (_event, fecha) => {
    if (!FECHA_VALIDA.test(String(fecha || ''))) return [];
    const filas = db
      .prepare(
        `SELECT c.id AS cliente_id, c.nombre, c.apellido, c.negocio, p.metodo_pago, ROUND(SUM(p.monto), 2) AS monto, MIN(p.fecha) AS desde
         FROM pagos p
         LEFT JOIN facturas f ON f.id = p.factura_id
         LEFT JOIN clientes c ON c.id = COALESCE(f.cliente_id, p.cliente_id)
         WHERE strftime('%Y-%m-%d', p.fecha) = ? AND ${SQL_NO_CREDITO_P}
         GROUP BY c.id, p.metodo_pago
         ORDER BY desde, MIN(p.id)`
      )
      .all(fecha);
    // Los renglones de un mismo cliente van juntos, en el orden en que cada cliente pagó por primera vez.
    const orden = [];
    filas.forEach((f) => { if (!orden.includes(f.cliente_id)) orden.push(f.cliente_id); });
    return orden.flatMap((id) => filas.filter((f) => f.cliente_id === id));
  });

  ipcMain.handle('reportes:cobrosPorMes', () => {
    return db
      .prepare(
        `SELECT strftime('%Y-%m', fecha) as periodo, metodo_pago, SUM(monto) as total
         FROM pagos
         WHERE ${SQL_NO_CREDITO}
         GROUP BY periodo, metodo_pago
         ORDER BY periodo DESC`
      )
      .all();
  });

  ipcMain.handle('reportes:cantidadesPedidasPorDia', () => {
    return db
      .prepare(
        `SELECT strftime('%Y-%m-%d', COALESCE(p.para_fecha, p.fecha)) as periodo, pr.nombre as producto_nombre,
                COALESCE(pi.unidad_pedido, pr.unidad) as producto_unidad, pr.unidad as unidad_base, pr.peso_unidad_pedido, SUM(pi.cantidad) as total
         FROM pedido_items pi
         JOIN pedidos p ON p.id = pi.pedido_id
         JOIN productos pr ON pr.id = pi.producto_id
         GROUP BY periodo, pr.id, producto_unidad
         ORDER BY periodo DESC`
      )
      .all();
  });

  ipcMain.handle('reportes:cantidadesPedidasPorMes', () => {
    return db
      .prepare(
        `SELECT strftime('%Y-%m', COALESCE(p.para_fecha, p.fecha)) as periodo, pr.nombre as producto_nombre,
                COALESCE(pi.unidad_pedido, pr.unidad) as producto_unidad, pr.unidad as unidad_base, pr.peso_unidad_pedido, SUM(pi.cantidad) as total
         FROM pedido_items pi
         JOIN pedidos p ON p.id = pi.pedido_id
         JOIN productos pr ON pr.id = pi.producto_id
         GROUP BY periodo, pr.id, producto_unidad
         ORDER BY periodo DESC`
      )
      .all();
  });

  ipcMain.handle('reportes:saldosPorCliente', () => {
    return db
      .prepare('SELECT id, nombre, apellido, saldo FROM clientes WHERE ROUND(saldo, 2) > 0 ORDER BY saldo DESC')
      .all();
  });
}

module.exports = { registrar };
