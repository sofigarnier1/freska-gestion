// Avisos (la campanita).
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

function registrar(ctx) {
  const { SQL_PROVEEDORES, claveCuenta, db, ipcMain, leerConfig, movimientosDeOperaciones, redondear2, resumenDeStock } = ctx;

  // ---------- Avisos (la campanita) ----------
  // Cada tipo de aviso se puede apagar (interruptor en la campanita). Se calculan al pedirlos: no se guarda
  // nada salvo cuáles están apagados. Los plazos son fijos.
  const DIAS_CLIENTE_DEUDA = 30;
  const DIAS_PROVEEDOR_SIN_PAGO = 21;
  const DIAS_CLIENTE_INACTIVO = 45;
  const DIAS_COPIA_VIEJA = 14;
  const DIAS_CHEQUE_PRONTO = 7;
  const DIAS_INSUMO_SIN_CONTAR = 30;
  const DIAS_REVISAR_ANULACIONES = 14;
  const TIPOS_AVISO = [
    { id: 'cheques', nombre: `Cheques que ya se pueden cobrar o vencen en ${DIAS_CHEQUE_PRONTO} días` },
    { id: 'clientes_deuda', nombre: `Clientes que deben hace más de ${DIAS_CLIENTE_DEUDA} días` },
    { id: 'proveedores_deuda', nombre: `Proveedores a los que hace más de ${DIAS_PROVEEDOR_SIN_PAGO} días que no les pagás` },
    { id: 'pedidos', nombre: 'Pedidos de días anteriores sin facturar' },
    { id: 'pedidos_programados', nombre: 'Pedidos programados para mañana' },
    { id: 'cierre_caja', nombre: 'Cierres de caja sin hacer o con diferencia (últimos 7 días)' },
    { id: 'clientes_inactivos', nombre: `Clientes que dejaron de comprar (más de ${DIAS_CLIENTE_INACTIVO} días)` },
    { id: 'copia', nombre: `Copia de seguridad fuera de la computadora (más de ${DIAS_COPIA_VIEJA} días)` },
    { id: 'productos_sin_precio', nombre: 'Productos con precio en $0' },
    { id: 'stock_bajo', nombre: 'Productos con poco stock (por debajo del mínimo que cargaste)' },
    { id: 'insumos_bajos', nombre: 'Insumos por debajo del mínimo' },
    { id: 'insumos_sin_contar', nombre: `Insumos que hace más de ${DIAS_INSUMO_SIN_CONTAR} días que no contás` },
    { id: 'anulaciones_empleado', nombre: `Anulaciones hechas por un empleado (últimos ${DIAS_REVISAR_ANULACIONES} días)` },
    { id: 'saldos_clientes', nombre: 'Clientes cuyo saldo no coincide con sus facturas y cobros' },
    { id: 'cambios_metodo_empleado', nombre: `Cobros que un empleado cambió de forma de pago (últimos ${DIAS_REVISAR_ANULACIONES} días)` },
  ];
  const avisosApagados = () => {
    try {
      const fila = db.prepare("SELECT valor FROM configuracion WHERE clave = 'avisos_apagados'").get();
      const lista = fila ? JSON.parse(fila.valor) : [];
      return Array.isArray(lista) ? lista : [];
    } catch (e) {
      return [];
    }
  };

  // Avisos "leídos": por tipo se guarda la "firma" del aviso (los ids de lo que lo compone) cuando se lo marcó.
  // Vuelve a aparecer solo si cambia (por ejemplo, otro cheque que vence o otro cliente que se atrasa).
  const avisosLeidos = () => {
    try {
      const fila = db.prepare("SELECT valor FROM configuracion WHERE clave = 'avisos_leidos'").get();
      const mapa = fila ? JSON.parse(fila.valor) : {};
      return mapa && typeof mapa === 'object' && !Array.isArray(mapa) ? mapa : {};
    } catch (e) {
      return {};
    }
  };
  const guardarAvisosLeidos = (mapa) =>
    db
      .prepare("INSERT INTO configuracion (clave, valor) VALUES ('avisos_leidos', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor")
      .run(JSON.stringify(mapa));

  // Marca como leídos (o como no leídos) uno o varios avisos: [{ tipo, firma }].
  ipcMain.handle('avisos:marcar', (_event, { avisos, leido }) => {
    if (!Array.isArray(avisos)) return { ok: false };
    const mapa = avisosLeidos();
    avisos.forEach(({ tipo, firma }) => {
      if (!TIPOS_AVISO.some((t) => t.id === tipo)) return;
      if (leido) mapa[tipo] = String(firma ?? '');
      else delete mapa[tipo];
    });
    guardarAvisosLeidos(mapa);
    return { ok: true };
  });

  ipcMain.handle('avisos:tipos', () => {
    const apagados = avisosApagados();
    return TIPOS_AVISO.map((t) => ({ ...t, activo: !apagados.includes(t.id) }));
  });

  ipcMain.handle('avisos:activar', (_event, { tipo, activo }) => {
    if (!TIPOS_AVISO.some((t) => t.id === tipo)) return { ok: false };
    const apagados = avisosApagados().filter((t) => t !== tipo);
    if (!activo) apagados.push(tipo);
    db.prepare(
      "INSERT INTO configuracion (clave, valor) VALUES ('avisos_apagados', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor"
    ).run(JSON.stringify(apagados));
    return { ok: true };
  });

  // Saldo que tendría que tener cada cliente: saldo inicial + facturas (sin las anuladas) − cobros. Los pagos con "Saldo a
  // favor" no cuentan (gastan crédito, no mueven el saldo). Los cobros de una factura anulada sí cuentan (quedaron como saldo
  // a favor o se devolvieron), salvo en las anuladas de antes de las notas de crédito (sin nota): ahí la plata se daba por
  // devuelta y el saldo nunca la tuvo en cuenta.
  function saldosQueNoCierran() {
    return db
      .prepare(
        `SELECT c.id, c.nombre, c.apellido, ROUND(c.saldo, 2) AS saldo, ROUND(esperado, 2) AS esperado FROM (
           SELECT c.*, c.saldo_inicial
             + COALESCE((SELECT SUM(f.total) FROM facturas f WHERE f.cliente_id = c.id AND f.estado != 'anulada'), 0)
             - COALESCE((SELECT SUM(p.monto) FROM pagos p LEFT JOIN facturas f ON f.id = p.factura_id
                         WHERE COALESCE(f.cliente_id, p.cliente_id) = c.id AND lower(trim(p.metodo_pago)) != 'saldo a favor'
                           AND (f.id IS NULL OR f.estado != 'anulada' OR EXISTS (SELECT 1 FROM notas_credito n WHERE n.factura_id = f.id))), 0) AS esperado
           FROM clientes c) c
         WHERE ABS(c.saldo - c.esperado) > 0.01 ORDER BY ABS(c.saldo - c.esperado) DESC`
      )
      .all();
  }

  ipcMain.handle('avisos:obtener', () => {
    const apagados = avisosApagados();
    const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
    const pesos = (n) => `$${redondear2(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
    const hoy = db.prepare("SELECT date('now', 'localtime') AS d").get().d;
    const diasDesde = (iso) => Math.floor((new Date(`${hoy}T00:00:00`) - new Date(`${String(iso).slice(0, 10)}T00:00:00`)) / 86400000);
    const nombre = (n, a) => `${n}${a ? ` ${a}` : ''}`;
    const avisos = [];
    const activo = (tipo) => !apagados.includes(tipo);

    // 1. Cheques que ya se pueden cobrar o vencen pronto.
    if (activo('cheques')) {
      const filasYa = db
        .prepare("SELECT id, importe FROM cheques WHERE estado = 'en_cartera' AND fecha_cobro IS NOT NULL AND fecha_cobro <= ? ORDER BY id")
        .all(hoy);
      const filasPronto = db
        .prepare(
          `SELECT id, importe FROM cheques
           WHERE estado = 'en_cartera' AND fecha_cobro > ? AND fecha_cobro <= date(?, '+${DIAS_CHEQUE_PRONTO} day') ORDER BY id`
        )
        .all(hoy, hoy);
      const suma = (filas) => filas.reduce((acc, c) => acc + c.importe, 0);
      const ya = { n: filasYa.length, t: suma(filasYa) };
      const pronto = { n: filasPronto.length, t: suma(filasPronto) };
      if (ya.n + pronto.n > 0) {
        const partes = [];
        if (ya.n) partes.push(`${plural(ya.n, 'ya se puede cobrar', 'ya se pueden cobrar')}`);
        if (pronto.n) partes.push(`${plural(pronto.n, 'vence', 'vencen')} en los próximos ${DIAS_CHEQUE_PRONTO} días`);
        avisos.push({
          tipo: 'cheques',
          urgencia: ya.n ? 'alta' : 'media',
          firma: `ya:${filasYa.map((c) => c.id).join(',')}|pronto:${filasPronto.map((c) => c.id).join(',')}`,
          titulo: 'Cheques para cobrar',
          detalle: `${partes.join(' y ')} · ${pesos(ya.t + pronto.t)} en total`,
        });
      }
    }

    // 2. Clientes con facturas sin pagar hace mucho.
    if (activo('clientes_deuda')) {
      const filas = db
        .prepare(
          `SELECT c.id, c.nombre, c.apellido, ROUND(SUM(f.total - COALESCE(p.pagado, 0)), 2) AS pendiente, MIN(f.fecha) AS desde
           FROM facturas f JOIN clientes c ON c.id = f.cliente_id
           LEFT JOIN (SELECT factura_id, SUM(monto) AS pagado FROM pagos GROUP BY factura_id) p ON p.factura_id = f.id
           WHERE f.estado IN ('pendiente', 'parcial') AND (f.total - COALESCE(p.pagado, 0)) > 0.005
             AND julianday(?) - julianday(substr(f.fecha, 1, 10)) > ${DIAS_CLIENTE_DEUDA}
           GROUP BY c.id ORDER BY pendiente DESC`
        )
        .all(hoy);
      if (filas.length) {
        const masVieja = Math.max(...filas.map((f) => diasDesde(f.desde)));
        avisos.push({
          tipo: 'clientes_deuda',
          urgencia: masVieja > 90 ? 'alta' : 'media',
          firma: filas.map((f) => f.id).sort((a, b) => a - b).join(','),
          titulo: `${plural(filas.length, 'cliente debe', 'clientes deben')} hace más de ${DIAS_CLIENTE_DEUDA} días`,
          detalle: filas.slice(0, 3).map((f) => `${nombre(f.nombre, f.apellido)} (${pesos(f.pendiente)}, hace ${diasDesde(f.desde)} días)`).join(' · ') + (filas.length > 3 ? ` · y ${filas.length - 3} más` : ''),
        });
      }
    }

    // 3. Proveedores con deuda a los que hace mucho que no se les paga.
    if (activo('proveedores_deuda')) {
      const filas = db
        .prepare(`${SQL_PROVEEDORES} WHERE p.activo = 1`)
        .all()
        .filter((p) => p.saldo > 0)
        .map((p) => {
          const ultimoPago = db.prepare('SELECT MAX(fecha) AS f FROM pagos_proveedor WHERE proveedor_id = ?').get(p.id).f;
          const primeraCompra = db.prepare('SELECT MIN(fecha) AS f FROM compras WHERE proveedor_id = ?').get(p.id).f;
          const referencia = ultimoPago || primeraCompra;
          return { id: p.id, nombre: p.nombre, saldo: p.saldo, dias: referencia ? diasDesde(referencia) : null, nunca: !ultimoPago };
        })
        .filter((p) => p.dias !== null && p.dias > DIAS_PROVEEDOR_SIN_PAGO)
        .sort((a, b) => b.saldo - a.saldo);
      if (filas.length) {
        avisos.push({
          tipo: 'proveedores_deuda',
          urgencia: 'media',
          firma: filas.map((p) => p.id).sort((a, b) => a - b).join(','),
          titulo: `${plural(filas.length, 'proveedor', 'proveedores')} sin pagar hace más de ${DIAS_PROVEEDOR_SIN_PAGO} días`,
          detalle: filas.slice(0, 3).map((p) => `${p.nombre} (${pesos(p.saldo)}, ${p.nunca ? 'sin pagos desde la primera compra: ' : ''}hace ${p.dias} días)`).join(' · ') + (filas.length > 3 ? ` · y ${filas.length - 3} más` : ''),
        });
      }
    }

    // 4. Pedidos de días anteriores que quedaron sin facturar.
    if (activo('pedidos')) {
      const pedidosViejos = db
        .prepare("SELECT id FROM pedidos WHERE estado = 'pendiente' AND COALESCE(para_fecha, substr(fecha, 1, 10)) < ? ORDER BY id")
        .all(hoy);
      const viejos = pedidosViejos.length;
      if (viejos) {
        avisos.push({
          tipo: 'pedidos',
          urgencia: 'media',
          firma: pedidosViejos.map((p) => p.id).join(','),
          titulo: `${plural(viejos, 'pedido', 'pedidos')} de días anteriores sin facturar`,
          detalle: 'Quedaron pendientes: revisá si ya se entregaron.',
        });
      }
    }

    // 4 bis. Pedidos programados para mañana (anotados antes para ese día).
    if (activo('pedidos_programados')) {
      const manana = db.prepare("SELECT date(?, '+1 day') AS d").get(hoy).d;
      const paraManana = db.prepare("SELECT id FROM pedidos WHERE estado = 'pendiente' AND para_fecha = ? ORDER BY id").all(manana);
      if (paraManana.length) {
        avisos.push({
          tipo: 'pedidos_programados',
          urgencia: 'baja',
          firma: `${manana}:${paraManana.map((p) => p.id).join(',')}`,
          titulo: `${plural(paraManana.length, 'pedido programado', 'pedidos programados')} para mañana`,
          detalle: 'Mañana aparecen solos en Pedidos pendientes.',
        });
      }
    }

    // 5. Cierres de caja de los últimos 7 días (sin hoy): sin hacer o con diferencia.
    if (activo('cierre_caja')) {
      const sinHacer = [];
      const conDiferencia = [];
      for (let i = 1; i <= 7; i += 1) {
        const dia = db.prepare("SELECT date(?, ?) AS d").get(hoy, `-${i} day`).d;
        const cobrosEfectivo = db
          .prepare("SELECT COALESCE(SUM(monto), 0) AS t, COUNT(*) AS n FROM pagos WHERE substr(fecha, 1, 10) = ? AND lower(trim(metodo_pago)) = 'efectivo'")
          .get(dia);
        const retiros =
          db.prepare("SELECT COALESCE(SUM(monto), 0) AS t, COUNT(*) AS n FROM gastos WHERE fecha = ? AND lower(trim(medio_pago)) = 'efectivo'").get(dia) ;
        // El efectivo pagado a proveedores también sale del cajón; y los depósitos, retiros y canjes lo mueven.
        const retirosProv = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(efectivo), 0) AS t FROM pagos_proveedor WHERE fecha = ?').get(dia);
        const otrosEfectivo = movimientosDeOperaciones(dia)
          .filter((o) => o.fecha === dia && claveCuenta(o.cuenta) === 'efectivo')
          .reduce((acc, o) => acc + o.monto, 0);
        const cierre = db.prepare('SELECT fondo_inicial, efectivo_contado FROM cierres_caja WHERE fecha = ?').get(dia);
        const hubo = cobrosEfectivo.n + retiros.n + retirosProv.n > 0;
        if (hubo && (!cierre || cierre.efectivo_contado === null)) sinHacer.push(dia);
        else if (cierre && cierre.efectivo_contado !== null) {
          const dif = redondear2(cierre.efectivo_contado - (cierre.fondo_inicial + cobrosEfectivo.t - retiros.t - retirosProv.t + otrosEfectivo));
          if (Math.abs(dif) >= 1) conDiferencia.push({ dia, dif });
        }
      }
      if (sinHacer.length || conDiferencia.length) {
        const corta = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
        const partes = [];
        if (sinHacer.length) partes.push(`Sin cerrar: ${sinHacer.map(corta).join(', ')}`);
        if (conDiferencia.length) partes.push(`Con diferencia: ${conDiferencia.map((c) => `${corta(c.dia)} (${c.dif > 0 ? '+' : '−'}${pesos(Math.abs(c.dif))})`).join(', ')}`);
        avisos.push({
          tipo: 'cierre_caja',
          urgencia: 'media',
          firma: `sin:${sinHacer.join(',')}|dif:${conDiferencia.map((c) => `${c.dia}=${c.dif}`).join(',')}`,
          titulo: 'Cierre de caja',
          detalle: partes.join(' · '),
          fecha: sinHacer[0] || conDiferencia[0].dia,
        });
      }
    }

    // 6. Clientes habituales que dejaron de comprar.
    if (activo('clientes_inactivos')) {
      const filas = db
        .prepare(
          `SELECT c.id, c.nombre, c.apellido, COUNT(f.id) AS n, MAX(f.fecha) AS ultima
           FROM clientes c JOIN facturas f ON f.cliente_id = c.id AND f.estado != 'anulada'
           WHERE c.activo = 1 GROUP BY c.id HAVING n >= 3 ORDER BY ultima`
        )
        .all()
        .map((c) => ({ ...c, dias: diasDesde(c.ultima) }))
        .filter((c) => c.dias > DIAS_CLIENTE_INACTIVO && c.dias < 365);
      if (filas.length) {
        avisos.push({
          tipo: 'clientes_inactivos',
          urgencia: 'baja',
          firma: filas.map((c) => c.id).sort((a, b) => a - b).join(','),
          titulo: `${plural(filas.length, 'cliente habitual dejó', 'clientes habituales dejaron')} de comprar`,
          detalle: filas.slice(0, 3).map((c) => `${nombre(c.nombre, c.apellido)} (hace ${c.dias} días)`).join(' · ') + (filas.length > 3 ? ` · y ${filas.length - 3} más` : ''),
        });
      }
    }

    // 7. Copia de seguridad fuera de la computadora.
    if (activo('copia')) {
      const fila = db.prepare("SELECT valor FROM configuracion WHERE clave = 'ultima_copia_manual'").get();
      const carpetaExterna = leerConfig('copia_externa_carpeta');
      if (carpetaExterna) {
        // Con la copia automática puesta, el aviso es solo para cuando dejó de funcionar.
        const ultimaExterna = leerConfig('copia_externa_ultima');
        const dias = ultimaExterna ? diasDesde(ultimaExterna) : null;
        if (dias === null || dias >= 3) {
          avisos.push({
            tipo: 'copia',
            urgencia: 'media',
            firma: `externa:${ultimaExterna || 'nunca'}`,
            titulo: 'Copia de seguridad',
            detalle: `${dias === null ? 'La copia automática todavía no se pudo hacer.' : `Hace ${dias} días que no se hace la copia automática.`} Revisá que Drive (o el pendrive) esté conectado.`,
          });
        }
      } else if (!fila) {
        if (db.prepare('SELECT 1 FROM facturas LIMIT 1').get()) {
          avisos.push({ tipo: 'copia', urgencia: 'media', firma: 'nunca', titulo: 'Copia de seguridad', detalle: 'Todavía no guardaste ninguna copia fuera de la computadora.' });
        }
      } else if (diasDesde(fila.valor) > DIAS_COPIA_VIEJA) {
        avisos.push({ tipo: 'copia', urgencia: 'media', firma: `ultima:${fila.valor}`, titulo: 'Copia de seguridad', detalle: `Hace ${diasDesde(fila.valor)} días que no guardás una copia fuera de la computadora.` });
      }
    }

    // 8. Productos con precio en cero.
    if (activo('productos_sin_precio')) {
      const filas = db.prepare('SELECT id, nombre FROM productos WHERE activo = 1 AND (precio_cliente <= 0 OR precio_cf <= 0) ORDER BY nombre').all();
      if (filas.length) {
        avisos.push({
          tipo: 'productos_sin_precio',
          urgencia: 'media',
          firma: filas.map((p) => p.id).sort((a, b) => a - b).join(','),
          titulo: `${plural(filas.length, 'producto', 'productos')} sin precio`,
          detalle: filas.slice(0, 3).map((p) => p.nombre).join(' · ') + (filas.length > 3 ? ` · y ${filas.length - 3} más` : ''),
        });
      }
    }

    // 9. Productos con poco stock: por debajo del mínimo. Un stock en negativo no avisa (suele ser producción sin cargar).
    if (activo('stock_bajo')) {
      const filas = resumenDeStock().articulos.filter((a) => a.minimo > 0 && a.stock > 0 && a.stock < a.minimo);
      if (filas.length) {
        avisos.push({
          tipo: 'stock_bajo',
          urgencia: 'media',
          firma: filas.map((a) => a.id).sort((a, b) => a - b).join(','),
          titulo: `Stock bajo: ${plural(filas.length, 'producto', 'productos')}`,
          detalle: filas.slice(0, 3).map((a) => `${a.nombre}: ${redondear2(a.stock)} kg (mínimo ${a.minimo})`).join(' · ') + (filas.length > 3 ? ` · y ${filas.length - 3} más` : ''),
        });
      }
    }

    // 10 y 11. Insumos por debajo del mínimo, y los que hace mucho que no se cuentan.
    if (activo('insumos_bajos') || activo('insumos_sin_contar')) {
      const insumos = db.prepare('SELECT id, nombre, unidad, minimo FROM insumos WHERE activo = 1 ORDER BY nombre COLLATE NOCASE').all();
      const ultimo = db.prepare('SELECT fecha, cantidad FROM conteos_insumo WHERE insumo_id = ? ORDER BY fecha DESC, id DESC LIMIT 1');
      const conUltimo = insumos.map((i) => ({ ...i, ultimo: ultimo.get(i.id) || null }));
      if (activo('insumos_bajos')) {
        const filas = conUltimo.filter((i) => i.minimo !== null && i.ultimo && i.ultimo.cantidad < i.minimo);
        if (filas.length) {
          avisos.push({
            tipo: 'insumos_bajos',
            urgencia: 'media',
            firma: filas.map((i) => i.id).join(','),
            titulo: `Insumos con poco stock: ${filas.length}`,
            detalle: filas.slice(0, 3).map((i) => `${i.nombre}: ${redondear2(i.ultimo.cantidad)} ${i.unidad} (mínimo ${redondear2(i.minimo)})`).join(' · ') + (filas.length > 3 ? ` · y ${filas.length - 3} más` : ''),
          });
        }
      }
      if (activo('insumos_sin_contar')) {
        const filas = conUltimo.filter((i) => i.ultimo && diasDesde(i.ultimo.fecha) > DIAS_INSUMO_SIN_CONTAR);
        if (filas.length) {
          avisos.push({
            tipo: 'insumos_sin_contar',
            urgencia: 'baja',
            firma: filas.map((i) => i.id).join(','),
            titulo: `Hace tiempo que no contás: ${filas.length} ${filas.length === 1 ? 'insumo' : 'insumos'}`,
            detalle: filas.slice(0, 3).map((i) => `${i.nombre}: hace ${diasDesde(i.ultimo.fecha)} días`).join(' · ') + (filas.length > 3 ? ` · y ${filas.length - 3} más` : ''),
          });
        }
      }
    }

    // 12. Anulaciones (cobros o facturas) hechas por un empleado: para que el administrador las revise y, si
    // alguna estuvo mal, la reactive. Se avisa mientras no se reactivó y esté dentro de los últimos días; una vez
    // reactivada (o pasado ese plazo) deja de aparecer sola.
    if (activo('anulaciones_empleado')) {
      const cobros = db
        .prepare(
          `SELECT ca.id, ca.fecha, ca.motivo, (c.nombre || CASE WHEN c.apellido IS NOT NULL AND c.apellido != '' THEN ' ' || c.apellido ELSE '' END) AS cliente
           FROM cobros_anulados ca JOIN usuarios u ON u.id = ca.anulado_por JOIN clientes c ON c.id = ca.cliente_id
           WHERE u.rol = 'empleado' AND ca.reactivado_en IS NULL AND substr(ca.fecha, 1, 10) >= date(?, '-${DIAS_REVISAR_ANULACIONES} days')`
        )
        .all(hoy);
      const facs = db
        .prepare(
          `SELECT f.id, f.motivo_anulacion AS motivo, (c.nombre || CASE WHEN c.apellido IS NOT NULL AND c.apellido != '' THEN ' ' || c.apellido ELSE '' END) AS cliente
           FROM facturas f JOIN usuarios u ON u.id = f.anulado_por JOIN clientes c ON c.id = f.cliente_id
           WHERE u.rol = 'empleado' AND f.estado = 'anulada' AND f.anulado_estado_previo IS NOT NULL
             AND substr(f.anulado_en, 1, 10) >= date(?, '-${DIAS_REVISAR_ANULACIONES} days')`
        )
        .all(hoy);
      const total = cobros.length + facs.length;
      if (total) {
        const ejemplos = [...cobros.map((c) => `Cobro de ${c.cliente}`), ...facs.map((f) => `Factura de ${f.cliente}`)];
        avisos.push({
          tipo: 'anulaciones_empleado',
          urgencia: 'media',
          firma: [...cobros.map((c) => `c${c.id}`), ...facs.map((f) => `f${f.id}`)].sort().join(','),
          titulo: `${plural(total, 'anulación', 'anulaciones')} de empleados para revisar`,
          detalle: ejemplos.slice(0, 3).join(' · ') + (ejemplos.length > 3 ? ` · y ${ejemplos.length - 3} más` : ''),
        });
      }
    }

    // 13. Cobros a los que un empleado les cambió la forma de pago (efectivo → transferencia, por ejemplo): se avisa para que
    // el administrador lo revise contra la plata contada.
    if (activo('cambios_metodo_empleado')) {
      const cambios = db
        .prepare(
          `SELECT m.id, m.monto, m.metodo_anterior, m.metodo_nuevo, m.motivo,
                  (c.nombre || CASE WHEN c.apellido IS NOT NULL AND c.apellido != '' THEN ' ' || c.apellido ELSE '' END) AS cliente
           FROM cobros_metodo_cambiado m JOIN usuarios u ON u.id = m.usuario_id LEFT JOIN clientes c ON c.id = m.cliente_id
           WHERE u.rol = 'empleado' AND substr(m.fecha, 1, 10) >= date(?, '-${DIAS_REVISAR_ANULACIONES} days') ORDER BY m.id DESC`
        )
        .all(hoy);
      if (cambios.length) {
        avisos.push({
          tipo: 'cambios_metodo_empleado',
          urgencia: 'media',
          firma: cambios.map((c) => c.id).sort((a, b) => a - b).join(','),
          titulo: `${plural(cambios.length, 'cobro cambiado de forma de pago', 'cobros cambiados de forma de pago')} por un empleado`,
          detalle: cambios.slice(0, 3).map((c) => `${c.cliente || 'Cliente'}: ${pesos(c.monto)} de ${c.metodo_anterior} a ${c.metodo_nuevo}${c.motivo ? ` (${c.motivo})` : ''}`).join(' · ') + (cambios.length > 3 ? ` · y ${cambios.length - 3} más` : ''),
        });
      }
    }

    // 14. Clientes cuyo saldo guardado no coincide con lo que dan sus facturas y cobros (solo para el administrador). El saldo
    // se guarda y se va moviendo con cada factura, cobro, anulación y edición: si algún día algo lo deja mal, acá se nota
    // en vez de descubrirse cuando el cliente reclama.
    if (activo('saldos_clientes') && !(ctx.usuarioActual && ctx.usuarioActual.rol === 'empleado')) {
      const descuadrados = saldosQueNoCierran();
      if (descuadrados.length) {
        avisos.push({
          tipo: 'saldos_clientes',
          urgencia: 'alta',
          firma: descuadrados.map((c) => `${c.id}:${c.saldo}:${c.esperado}`).join(','),
          titulo: `${plural(descuadrados.length, 'cliente tiene el saldo descuadrado', 'clientes tienen el saldo descuadrado')}`,
          detalle: descuadrados.slice(0, 3).map((c) => `${nombre(c.nombre, c.apellido)} (el saldo dice ${pesos(c.saldo)} y sus facturas y cobros dan ${pesos(c.esperado)})`).join(' · ') + (descuadrados.length > 3 ? ` · y ${descuadrados.length - 3} más` : ''),
        });
      }
    }

    const leidos = avisosLeidos();
    avisos.forEach((a) => {
      a.leido = leidos[a.tipo] === a.firma;
    });
    const peso = { alta: 0, media: 1, baja: 2 };
    avisos.sort((a, b) => peso[a.urgencia] - peso[b.urgencia]);
    return { ok: true, avisos };
  });
}

module.exports = { registrar };
