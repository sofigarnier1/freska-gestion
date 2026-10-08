// Cierre de caja: el día, el mes y el día a día.
// (Antes todo estaba en renderer.js; se dividió por pantalla el 2026-09-24. Los archivos son scripts comunes que
// comparten el mismo espacio global: se cargan en el orden de index.html y no hace falta importar nada.)

// ---------- Cierre de caja ----------
let fechaCierreCaja = fechaHoyISO();
let vistaCierreTab = 'dia'; // 'dia' | 'mes' | 'general'
// De dónde se abrió "Cierre del día" cuando no fue tocando esa pestaña a mano (tocando un día en "Día a
// día", o desde el historial de Cobros): null | 'dia-a-dia' | 'cobros'. Muestra un "← Volver a..." arriba
// para no perder el lugar en el que estabas; se limpia al tocar cualquier pestaña de Caja a mano o al
// irse a otra pantalla (ver `irAVista`).
let origenCierreCaja = null;
// Última categoría usada en el formulario de retiros del Cierre (por defecto, "Otros").
let ultimaCategoriaRetiro = null;
function categoriaRetiroSeleccionada(categorias) {
  if (ultimaCategoriaRetiro !== null) return ultimaCategoriaRetiro;
  const otros = categorias.find((c) => c.nombre === 'Otros');
  return otros ? otros.id : '';
}

function esMetodoEfectivo(nombre) {
  return String(nombre).trim().toLowerCase() === 'efectivo';
}

function redondearPesos(n) {
  return Math.round(n * 100) / 100;
}

// Pesos con el signo adelante del $ (-$48.000), no en medio ($-48.000).
function pesosConSigno(n) {
  return `${n < 0 ? '-' : ''}$${formatearMoneda(Math.abs(n))}`;
}

function textoMonto(n) {
  return n === null || n === undefined || Number.isNaN(n) ? '' : formatearMoneda(n);
}

function calcularCuentaCaja({ cobros, retiros, fondo, contado, otros: otrosEfectivo = 0 }) {
  const porMetodo = {};
  cobros.forEach((c) => {
    porMetodo[c.metodo_pago] = redondearPesos((porMetodo[c.metodo_pago] || 0) + c.monto);
  });
  const efectivo = Object.entries(porMetodo)
    .filter(([nombre]) => esMetodoEfectivo(nombre))
    .reduce((acc, [, monto]) => acc + monto, 0);
  const otros = Object.entries(porMetodo).filter(([nombre]) => !esMetodoEfectivo(nombre));
  const totalOtros = otros.reduce((acc, [, monto]) => acc + monto, 0);
  const totalRetiros = retiros.reduce((acc, r) => acc + r.monto, 0);
  const esperado = redondearPesos((fondo || 0) + efectivo - totalRetiros + otrosEfectivo);
  const diferencia = contado === null || Number.isNaN(contado) ? null : redondearPesos(contado - esperado);
  return { efectivo, otros, totalOtros, totalRetiros, otrosEfectivo, esperado, diferencia };
}

// "Toda la plata del día" (pedido del dueño, 2026-09-29): efectivo, bancos y apps y el total, con lo que había
// al empezar, lo que entró, lo que salió y lo que queda. El efectivo sale de la cuenta del cajón (el fondo que se
// escribió y lo esperado); los bancos, de la Caja general (si todavía no tiene saldos cargados, solo se ve el efectivo).
function plataDelDiaHtml(datos, cuenta, fondo) {
  const ef = {
    alEmpezar: fondo || 0,
    entro: redondearPesos(cuenta.efectivo + (datos.otrosEfectivoEntro || 0)),
    salio: redondearPesos(cuenta.totalRetiros + (datos.otrosEfectivoSalio || 0)),
    alCerrar: cuenta.esperado,
  };
  const cuentas = datos.cuentas || [];
  const hayBancos = cuentas.length > 0;
  const suma = (campo) => redondearPesos(cuentas.reduce((acc, c) => acc + c[campo], 0));
  const ba = { alEmpezar: suma('alEmpezar'), entro: suma('entro'), salio: suma('salio'), alCerrar: suma('deberia') };
  const fila = (titulo, campo, signo, clase = '') => {
    const celda = (n) => `<td>${signo && n ? `${signo} ` : ''}${pesosConSigno(n)}</td>`;
    return `<tr class="${clase}"><td>${titulo}</td>${celda(ef[campo])}${hayBancos ? celda(ba[campo]) + `<td><strong>${signo && ef[campo] + ba[campo] ? `${signo} ` : ''}${pesosConSigno(redondearPesos(ef[campo] + ba[campo]))}</strong></td>` : ''}</tr>`;
  };
  return `
    <table class="tabla-plata-dia">
      <thead><tr><th></th><th>Efectivo</th>${hayBancos ? '<th>Bancos y apps</th><th>Total</th>' : ''}</tr></thead>
      <tbody>
        ${fila('Al empezar el día', 'alEmpezar', '')}
        ${fila('Entró', 'entro', '+', 'plata-entro')}
        ${fila('Salió', 'salio', '−', 'plata-salio')}
        ${fila('Al cerrar', 'alCerrar', '', 'fila-total-plata')}
      </tbody>
    </table>`;
}

function textoDiferencia(diferencia) {
  if (diferencia === null) return { clase: '', texto: '' };
  if (diferencia === 0) return { clase: 'cierre-dif-ok', texto: 'La caja cierra justo.' };
  if (diferencia > 0) return { clase: 'cierre-dif-mal', texto: `Sobran $${formatearMoneda(diferencia)}` };
  return { clase: 'cierre-dif-mal', texto: `Faltan $${formatearMoneda(-diferencia)}` };
}

// Un cobro de un cliente que la app reparte entre varias facturas queda anotado por factura. Para el
// detalle del cierre se juntan en una sola línea los que son del mismo cliente, con el mismo método y
// del mismo minuto (es decir, el mismo momento de cobro), y se indica a qué facturas se aplicó.
function agruparCobrosDelDia(cobros) {
  const grupos = new Map();
  cobros.forEach((c) => {
    const clave = `${String(c.fecha).slice(0, 16)}|${c.cliente_nombre}|${c.metodo_pago}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, { fecha: c.fecha, cliente_nombre: c.cliente_nombre, metodo_pago: c.metodo_pago, monto: 0, facturas: [] });
    }
    const g = grupos.get(clave);
    g.monto = redondearPesos(g.monto + c.monto);
    if (!g.facturas.includes(c.factura_id ?? null)) g.facturas.push(c.factura_id ?? null);
  });
  return Array.from(grupos.values());
}

// `null` en la lista = una parte del cobro que no es de ninguna factura (el saldo anterior del cliente).
function textoFacturasCobro(facturas) {
  const conFactura = facturas.filter((n) => n != null);
  if (conFactura.length === 0) return 'Saldo anterior';
  const lista = conFactura.map((n) => `N° ${n}`);
  const texto = lista.length > 1 ? `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}` : lista[0];
  const base = `${conFactura.length > 1 ? 'Facturas' : 'Factura'} ${texto}`;
  return conFactura.length < facturas.length ? `${base} y saldo anterior` : base;
}

function horaDeCobro(fecha) {
  return new Date(String(fecha).replace(' ', 'T')).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fechaLargaCierre(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-');
  return `${dia}/${mes}/${anio}`;
}

function construirHojaCierre(fecha, datos, fondo, contado, cuenta) {
  const dif = textoDiferencia(cuenta.diferencia);
  return `
    <div class="hoja-impresion-cierre">
      <h1>Cierre de caja — ${fechaLargaCierre(fecha)}</h1>
      <h2>Toda la plata del día</h2>
      ${plataDelDiaHtml(datos, cuenta, fondo)}
      <h2>Efectivo</h2>
      <table class="tabla-impresion-cierre">
        <tbody>
          <tr><td>Fondo inicial</td><td>$${formatearMoneda(fondo || 0)}</td></tr>
          <tr><td>Cobros en efectivo</td><td>+ $${formatearMoneda(cuenta.efectivo)}</td></tr>
          <tr><td>Gastos y pagos en efectivo</td><td>− $${formatearMoneda(cuenta.totalRetiros)}</td></tr>
          ${cuenta.otrosEfectivo ? `<tr><td>Depósitos, retiros y cheques</td><td>${pesosConSigno(cuenta.otrosEfectivo)}</td></tr>` : ''}
          <tr class="fila-total"><td>Efectivo esperado</td><td>${pesosConSigno(cuenta.esperado)}</td></tr>
          <tr><td>Efectivo contado</td><td>${contado === null || Number.isNaN(contado) ? '—' : `$${formatearMoneda(contado)}`}</td></tr>
          <tr class="fila-total"><td>Diferencia</td><td>${cuenta.diferencia === null ? '—' : dif.texto}</td></tr>
        </tbody>
      </table>
      <p class="total-cobrado-impresion">Total cobrado en el día (todos los métodos): $${formatearMoneda(cuenta.efectivo + cuenta.totalOtros)}</p>
      ${
        cuenta.otros.length > 0
          ? `<h2>Cobrado por otros medios (bancos y apps)</h2>
      <table class="tabla-impresion-cierre">
        <tbody>${cuenta.otros.map(([nombre, monto]) => `<tr><td>${esc(nombre)}</td><td>$${formatearMoneda(monto)}</td></tr>`).join('')}</tbody>
      </table>`
          : ''
      }
      ${
        datos.retiros.length > 0
          ? `<h2>Gastos y pagos en efectivo</h2>
      <table class="tabla-impresion-cierre">
        <tbody>${datos.retiros.map((r) => `<tr><td>${esc(r.concepto)}</td><td>$${formatearMoneda(r.monto)}</td></tr>`).join('')}</tbody>
      </table>`
          : ''
      }
      ${
        datos.cobros.length > 0
          ? `<h2>Cobros del día</h2>
      <table class="tabla-impresion-cierre">
        <tbody>${agruparCobrosDelDia(datos.cobros)
          .map(
            (c) =>
              `<tr><td>${horaDeCobro(c.fecha)} · ${esc(c.cliente_nombre || '')} · ${esc(c.metodo_pago)} (${textoFacturasCobro(c.facturas)})</td><td>$${formatearMoneda(c.monto)}</td></tr>`
          )
          .join('')}</tbody>
      </table>`
          : ''
      }
    </div>`;
}

function cierreTabToggleHtml() {
  return `
    <div class="reportes-toggle">
      <button type="button" class="toggle ${vistaCierreTab === 'dia' ? 'active' : ''}" data-cierre-tab="dia">Cierre del día</button>
      <button type="button" class="toggle ${vistaCierreTab === 'mes' ? 'active' : ''}" data-cierre-tab="mes">Día a día</button>
      <button type="button" class="toggle ${vistaCierreTab === 'general' ? 'active' : ''}" data-cierre-tab="general">Caja general</button>
    </div>`;
}

function vincularCierreTabToggle() {
  app.querySelectorAll('.toggle[data-cierre-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      vistaCierreTab = btn.dataset.cierreTab;
      origenCierreCaja = null;
      renderCierreCaja();
    });
  });
}

// Día a día: una fila por cada día del mes con cómo dio el cierre (los días sin cierre también, para ver cuáles
// quedaron pendientes). Tocar una fila abre el cierre de ese día.
let mesCierre = null; // { anio, mes } (mes 0-11); null = el mes de hoy

let diaResaltadoDiaADia = '';

async function renderCierreDiaADia() {
  if (!mesCierre) {
    const hoy = new Date();
    mesCierre = { anio: hoy.getFullYear(), mes: hoy.getMonth() };
  }
  const { anio, mes } = mesCierre;
  const resultado = await window.freska.caja.resumenMes({ anio, mes });
  const dias = (resultado.dias || []).slice().reverse();
  const conMovimiento = dias.filter((d) => d.estado !== 'sin_movimiento');
  const sinCerrar = dias.filter((d) => d.estado === 'sin_cerrar').length;
  const cerrados = dias.filter((d) => d.estado === 'justo' || d.estado === 'sobra' || d.estado === 'falta' || d.estado === 'sin_contar').length;
  const diferenciaMes = redondearPesos(dias.reduce((acc, d) => acc + (d.diferencia || 0), 0));
  const hayOtrosEfectivo = dias.some((d) => d.otros);
  const textoEstado = (d) => {
    if (d.estado === 'sin_movimiento') return '<span class="texto-suave">—</span>';
    return estadoCierreHtml(d.estado === 'sin_cerrar' ? null : { diferencia: d.diferencia });
  };
  const nombreMes = MESES_LARGO[mes][0].toUpperCase() + MESES_LARGO[mes].slice(1);

  app.innerHTML = `
    <div class="cierre-caja cierre-dia-a-dia">
      ${cierreTabToggleHtml()}
      <div class="mes-cabecera">
      <div class="mes-selector">
        <button type="button" class="calendario-nav mes-nav" data-mes-nav="-12" aria-label="Año anterior" title="Año anterior">&laquo;</button>
        <button type="button" class="calendario-nav mes-nav" data-mes-nav="-1" aria-label="Mes anterior" title="Mes anterior">&larr;</button>
        <strong>${nombreMes} de ${anio}</strong>
        <button type="button" class="calendario-nav mes-nav" data-mes-nav="1" aria-label="Mes siguiente" title="Mes siguiente">&rarr;</button>
        <button type="button" class="calendario-nav mes-nav" data-mes-nav="12" aria-label="Año siguiente" title="Año siguiente">&raquo;</button>
        ${selectorFechaHtml('filtro-dia-dia-a-dia', diaResaltadoDiaADia)}
      </div>
      ${
        conMovimiento.length
          ? `<p class="pin-subtitulo cierre-mes-resumen">${conMovimiento.length} ${conMovimiento.length === 1 ? 'día con movimiento' : 'días con movimiento'} · ${cerrados} ${cerrados === 1 ? 'cerrado' : 'cerrados'} · ${sinCerrar} sin cerrar</p>`
          : ''
      }
      </div>
      <table class="tabla-dia-a-dia">
        <thead><tr><th>Día</th><th>Cobrado</th><th>Pagado</th><th>Fondo inicial</th><th>Cobros en efectivo</th><th>Pagos en efectivo</th>${hayOtrosEfectivo ? '<th>Depósitos, retiros y cheques</th>' : ''}<th>Esperado</th><th>Contado</th><th>Cierre</th></tr></thead>
        <tbody>
          ${
            conMovimiento.length
              ? `<tr class="fila-total-mes">
            <td>Total del mes</td>
            <td><span class="est-entradas">$${formatearMoneda(redondearPesos(dias.reduce((a, d) => a + d.cobrado, 0)))}</span></td>
            <td><span class="est-salidas">$${formatearMoneda(redondearPesos(dias.reduce((a, d) => a + d.pagado, 0)))}</span></td>
            <td><span class="texto-suave">—</span></td>
            <td>$${formatearMoneda(redondearPesos(dias.reduce((a, d) => a + d.efectivo, 0)))}</td>
            <td>$${formatearMoneda(redondearPesos(dias.reduce((a, d) => a + d.retiros, 0)))}</td>
            ${hayOtrosEfectivo ? `<td>${pesosConSigno(redondearPesos(dias.reduce((a, d) => a + (d.otros || 0), 0)))}</td>` : ''}
            <td><span class="texto-suave">—</span></td>
            <td><span class="texto-suave">—</span></td>
            <td>${
              cerrados
                ? `<span class="estado-cierre ${diferenciaMes === 0 ? 'estado-cierre-ok' : 'estado-cierre-mal'}">${diferenciaMes === 0 ? 'Todo justo' : diferenciaMes > 0 ? `Sobran $${formatearMoneda(diferenciaMes)}` : `Faltan $${formatearMoneda(-diferenciaMes)}`}</span>`
                : '<span class="texto-suave">—</span>'
            }
          </tr>`
              : ''
          }
          ${
            dias.length === 0
              ? '<tr><td colspan="10">Este mes todavía no empezó.</td></tr>'
              : dias
                  .map((d) => {
                    const vacio = d.estado === 'sin_movimiento';
                    const celda = (n) => (vacio ? '<span class="texto-suave">—</span>' : `$${formatearMoneda(n)}`);
                    const celdaColor = (n, clase) => (vacio || !n ? '<span class="texto-suave">—</span>' : `<span class="${clase}">$${formatearMoneda(n)}</span>`);
                    const fecha = new Date(`${d.fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' });
                    return `<tr class="fila-clickeable ${vacio ? 'fila-sin-movimiento' : ''} ${d.fecha === diaResaltadoDiaADia ? 'fila-resaltada' : ''}" tabindex="0" data-fecha="${d.fecha}">
            <td>${esc(fecha)}</td>
            <td>${celdaColor(d.cobrado, 'est-entradas')}</td>
            <td>${celdaColor(d.pagado, 'est-salidas')}</td>
            <td>${celda(d.fondo)}</td>
            <td>${celda(d.efectivo)}</td>
            <td>${celda(d.retiros)}</td>
            ${hayOtrosEfectivo ? `<td>${vacio || !d.otros ? '<span class="texto-suave">—</span>' : pesosConSigno(d.otros)}</td>` : ''}
            <td>${vacio ? '<span class="texto-suave">—</span>' : pesosConSigno(d.esperado)}</td>
            <td>${d.contado === null || d.contado === undefined ? '<span class="texto-suave">—</span>' : `$${formatearMoneda(d.contado)}`}</td>
            <td>${textoEstado(d)}</td>
          </tr>`;
                  })
                  .join('')
          }
        </tbody>
      </table>
    </div>`;

  vincularCierreTabToggle();
  // Elegir un día en el calendario: se va a ese mes y queda marcada la fila del día.
  vincularSelectorFecha('filtro-dia-dia-a-dia', diaResaltadoDiaADia, (fecha) => {
    diaResaltadoDiaADia = fecha || '';
    if (fecha) mesCierre = { anio: Number(fecha.slice(0, 4)), mes: Number(fecha.slice(5, 7)) - 1 };
    renderCierreDiaADia().then(() => document.querySelector('.tabla-dia-a-dia .fila-resaltada')?.scrollIntoView({ block: 'center' }));
  });
  app.querySelectorAll('.mes-nav').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nuevo = new Date(anio, mes + Number(btn.dataset.mesNav), 1);
      mesCierre = { anio: nuevo.getFullYear(), mes: nuevo.getMonth() };
      renderCierreDiaADia();
    });
  });
  const abrirDia = (fila) => {
    fechaCierreCaja = fila.dataset.fecha;
    vistaCierreTab = 'dia';
    origenCierreCaja = 'dia-a-dia';
    renderCierreCaja();
  };
  app.querySelectorAll('.tabla-dia-a-dia tr[data-fecha]').forEach((fila) => {
    fila.addEventListener('click', () => abrirDia(fila));
    fila.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') abrirDia(fila);
    });
  });
}

async function renderCierreCaja() {
  if (vistaCierreTab === 'general') {
    await renderCajaGeneral();
    return;
  }
  if (vistaCierreTab === 'mes') {
    await renderCierreDiaADia();
    return;
  }
  const fecha = fechaCierreCaja;
  const datos = await window.freska.caja.obtenerDia(fecha);
  if (!datos.ok) {
    app.innerHTML = `<p class="error-msg">${esc(datos.error)}</p>`;
    return;
  }

  // Lo que salió del cajón ese día: los gastos pagados en efectivo. Un "retiro" es un gasto en efectivo:
  // se carga acá o en la pestaña Gastos y aparece en los dos lados (es el mismo registro).
  const salidas = (datos.gastosEfectivo || []).map((g) => ({
    id: g.id,
    monto: g.monto,
    concepto: g.descripcion,
    categoria: g.categoria,
    origen: g.origen,
  }));
  const cuentasCierre = datos.cuentas || [];
  // Todo lo que se pagó ese día (efectivo, transferencias, débito, cuotas y pagos a proveedores).
  const gastosDelDia = datos.salidasDelDia || [];
  // Movimientos de bancos y apps que no son cobros (gastos pagados con banco/app, pases entre cuentas,
  // ajustes de saldo, etc.): se combinan más abajo con los cobros del día en una sola lista, "Detalle de
  // movimientos" (antes eran dos tablas separadas y quedaba confuso, ver CLAUDE.md).
  const movimientosBancosDia = cuentasCierre.length
    ? (await Promise.all(cuentasCierre.map((c) => window.freska.cuentas.movimientos(c.nombre)))).flatMap((d) =>
        (d.movimientos || []).filter((m) => m.fecha === fecha && m.tipo !== 'cobro')
      )
    : [];
  const fondoGuardado = datos.cierre ? datos.cierre.fondo_inicial : datos.fondoSugerido;
  const contadoGuardado = datos.cierre ? datos.cierre.efectivo_contado : null;
  // El fondo y lo contado se confirman con su "✓" (no se guardan ni recalculan solos al escribir): lo que se ve es lo
  // guardado, o el fondo sugerido si el día todavía no tiene cierre.
  const textoFondo = fondoGuardado > 0 ? textoMonto(fondoGuardado) : '';
  const textoContado = textoMonto(contadoGuardado);
  const inicial = calcularCuentaCaja({
    cobros: datos.cobros,
    retiros: salidas,
    fondo: limpiarNumeroMoneda(textoFondo) || 0,
    contado: limpiarNumeroMoneda(textoContado),
    otros: datos.otrosEfectivo || 0,
  });
  const difInicial = textoDiferencia(inicial.diferencia);
  // Cuentas del día: el efectivo (el cajón) y cada banco o app; y los tres números de arriba (lo cobrado y los otros
  // ingresos contra todo lo que se pagó: sin los pases entre cuentas, que no son plata que entra ni que sale).
  const efEntro = redondearPesos(inicial.efectivo + (datos.otrosEfectivoEntro || 0));
  const efSalio = redondearPesos(inicial.totalRetiros + (datos.otrosEfectivoSalio || 0));
  const sumaBancos = (campo) => redondearPesos(cuentasCierre.reduce((acc, c) => acc + c[campo], 0));
  const bancos = { alEmpezar: sumaBancos('alEmpezar'), entro: sumaBancos('entro'), salio: sumaBancos('salio'), deberia: sumaBancos('deberia') };
  const entroDelDia = redondearPesos(inicial.efectivo + inicial.totalOtros + (datos.ingresosDelDia || 0));
  const salioDelDia = redondearPesos(gastosDelDia.reduce((acc, g) => acc + g.monto, 0));
  const resultadoDelDia = redondearPesos(entroDelDia - salioDelDia);
  // El detalle de cobros: el último que se cobró va primero.
  const cobrosAgrupados = agruparCobrosDelDia(datos.cobros).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  // Todo lo que se movió ese día, cobros y bancos juntos: los cobros tienen hora exacta y van primero (ya
  // vienen ordenados); los gastos/ajustes/pases de banco solo tienen el día, así que van después, en el
  // orden en que se cargaron.
  const movimientosDelDia = [
    ...cobrosAgrupados.map((c) => ({
      hora: horaDeCobro(c.fecha),
      cuenta: c.metodo_pago,
      detalle: `${c.cliente_nombre || ''} ${textoFacturasCobro(c.facturas)}`,
      detalleHtml: `${esc(c.cliente_nombre || '')}<div class="gasto-detalle-cheque">${textoFacturasCobro(c.facturas)}</div>`,
      monto: c.monto,
    })),
    ...movimientosBancosDia.map((m) => ({
      hora: '—',
      cuenta: m.cuenta,
      detalle: m.detalle,
      detalleHtml: esc(m.detalle),
      monto: m.monto,
    })),
  ];

  const estadoInicial = datos.cierre
      ? `Guardado el ${new Date(datos.cierre.guardado_en.replace(' ', 'T')).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} hs.`
      : 'Todavía sin guardar.';

  app.innerHTML = `
    <div class="cierre-caja">
      ${
        origenCierreCaja
          ? `<button id="btn-volver-cierre" class="btn-volver" type="button">&larr; Volver a ${origenCierreCaja === 'cobros' ? 'cobros' : 'día a día'}</button>`
          : ''
      }
      ${cierreTabToggleHtml()}
      <div class="toolbar">
        ${selectorFechaHtml('filtro-fecha-cierre', fecha)}
        <div class="cierre-acciones-top">
          <p id="cierre-estado" class="ayuda-campo">${estadoInicial}</p>
          <button type="button" id="btn-imprimir-cierre">Imprimir / PDF</button>
        </div>
      </div>

      <div class="est-tarjetas cierre-tarjetas">
        <div class="est-tarjeta"><span class="est-tarjeta-titulo">Entró</span><strong class="est-entradas">$${formatearMoneda(entroDelDia)}</strong></div>
        <div class="est-tarjeta"><span class="est-tarjeta-titulo">Salió</span><strong class="est-salidas">$${formatearMoneda(salioDelDia)}</strong></div>
        <div class="est-tarjeta"><span class="est-tarjeta-titulo">Resultado del día</span><strong class="${resultadoDelDia < 0 ? 'est-salidas' : ''}">${pesosConSigno(resultadoDelDia)}</strong></div>
      </div>

      <div class="cierre-titulo-fila"><h2>Cuentas del día</h2>${botonAyudaHtml('ayuda-cuentas-cierre', 'Cuentas del día', '<p>Cada forma de pago en una fila: lo que había al empezar el día, lo que entró, lo que salió y lo que tiene que quedar. En <em>Efectivo</em> escribís el <em>fondo inicial</em> (viene solo con lo que quedó el día anterior) y lo que <em>contaste</em> en el cajón. Tocá un banco o app para ver todos sus movimientos; si no coincide con el banco, corregilo con <em>Ajustar saldo</em> en la Caja general.</p>', 'izquierda')}</div>
      <table class="tabla-cuentas-dia">
        <thead><tr><th>Cuenta</th><th>Al empezar</th><th>Entró</th><th>Salió</th><th>Al cerrar</th><th>Contado</th></tr></thead>
        <tbody>
          <tr class="fila-efectivo-dia">
            <td><strong>Efectivo</strong></td>
            <td><span class="campo-con-guardar">
              <input type="text" id="cierre-fondo" inputmode="decimal" value="${textoFondo}" placeholder="0" autocomplete="off" aria-label="Fondo inicial" title="Fondo inicial: si el día no está guardado, se completa solo con lo que quedó en la caja el día anterior" />
              <button type="button" id="btn-guardar-fondo" class="btn-redondo btn-guardar-campo" disabled aria-label="Guardar el fondo inicial" title="Guardar">${GUARDAR_SVG}</button>
            </span></td>
            <td>${efEntro ? `$${formatearMoneda(efEntro)}` : '—'}</td>
            <td>${efSalio ? `$${formatearMoneda(efSalio)}` : '—'}</td>
            <td><strong id="cierre-esperado">${pesosConSigno(inicial.esperado)}</strong></td>
            <td><span class="campo-con-guardar">
              <input type="text" id="cierre-contado" inputmode="decimal" value="${textoContado}" placeholder="0" autocomplete="off" aria-label="Efectivo contado" />
              <button type="button" id="btn-guardar-contado" class="btn-redondo btn-guardar-campo" disabled aria-label="Guardar lo contado" title="Guardar">${GUARDAR_SVG}</button>
            </span>
            <button type="button" id="btn-dio-justo" class="enlace-boton" title="Guarda como contado el efectivo esperado">Dio justo</button></td>
          </tr>
          ${cuentasCierre
            .map(
              (cu) => `<tr class="fila-clickeable fila-cuenta-cierre" tabindex="0" data-cuenta="${esc(cu.nombre)}" title="Ver los movimientos de ${esc(cu.nombre)}">
            <td>${esc(cu.nombre)}</td>
            <td>${textoSaldoCuenta(cu.alEmpezar)}</td>
            <td>${cu.entro ? `$${formatearMoneda(cu.entro)}` : '—'}</td>
            <td>${cu.salio ? `$${formatearMoneda(cu.salio)}` : '—'}</td>
            <td><strong>${textoSaldoCuenta(cu.deberia)}</strong></td>
            <td></td>
          </tr>`
            )
            .join('')}
          ${
            cuentasCierre.length
              ? `<tr class="fila-total-plata">
            <td>Total</td>
            <td id="total-al-empezar">${pesosConSigno(redondearPesos((limpiarNumeroMoneda(textoFondo) || 0) + bancos.alEmpezar))}</td>
            <td>$${formatearMoneda(redondearPesos(efEntro + bancos.entro))}</td>
            <td>$${formatearMoneda(redondearPesos(efSalio + bancos.salio))}</td>
            <td id="total-al-cerrar">${pesosConSigno(redondearPesos(inicial.esperado + bancos.deberia))}</td>
            <td></td>
          </tr>`
              : ''
          }
        </tbody>
      </table>
      <p id="cierre-diferencia" class="cierre-dif ${difInicial.clase}" ${difInicial.texto ? '' : 'hidden'}>${difInicial.texto}</p>
      ${
        cuentasCierre.length || datos.cajaConfigurada
          ? ''
          : '<p class="pin-subtitulo cierre-sin-caja">Para ver también los bancos y las apps, cargá los saldos en <button type="button" class="enlace-boton" id="ir-a-caja-general">Caja general</button>.</p>'
      }

      <div class="cierre-columnas">
      <div class="cierre-col-izq">
      <h2>Cobros del día</h2>
      <table>
        <thead><tr><th>Método</th><th>Total</th></tr></thead>
        <tbody>
          ${
            datos.cobros.length === 0
              ? '<tr><td colspan="2">No hay cobros registrados este día.</td></tr>'
              : `<tr><td><strong>Efectivo</strong></td><td><strong>$${formatearMoneda(inicial.efectivo)}</strong></td></tr>
                 ${inicial.otros.map(([nombre, monto]) => `<tr><td>${esc(nombre)}</td><td>$${formatearMoneda(monto)}</td></tr>`).join('')}
                 <tr class="fila-total-cobrado"><td>Total cobrado</td><td>$${formatearMoneda(inicial.efectivo + inicial.totalOtros)}</td></tr>`
          }
        </tbody>
      </table>
      </div>
      <div class="cierre-col-der">
      <h2>Gastos del día</h2>
      <table>
        <thead><tr><th>Para qué</th><th>Pagó con</th><th>Monto</th></tr></thead>
        <tbody>
          ${
            gastosDelDia.length === 0
              ? '<tr><td colspan="3">No hay gastos este día.</td></tr>'
              : `${gastosDelDia
                  .map(
                    (g) => `<tr><td>${esc(g.detalle)} <span class="etiqueta-gasto">${esc(g.categoria || '')}${g.ambito === 'personal' ? ' · personal' : ''}</span></td><td>${esc(g.pagoCon)}</td><td>$${formatearMoneda(g.monto)}</td></tr>`
                  )
                  .join('')}
                 <tr class="fila-total-cobrado"><td colspan="2">Total gastado</td><td>$${formatearMoneda(redondearPesos(gastosDelDia.reduce((acc, g) => acc + g.monto, 0)))}</td></tr>`
          }
        </tbody>
      </table>
      </div>
      </div>

      ${
        // Todo lo que se movió ese día en una sola lista (cobros, gastos, ajustes, pases), en vez de tener
        // "Detalle de cobros" y los movimientos de bancos por separado — quedaba confuso tener dos listas
        // pareidas mostrando cada una una mitad de la plata del día.
        movimientosDelDia.length > 0
          ? `<h2>Detalle de movimientos</h2>
      <div class="toolbar toolbar-junta toolbar-pegada">
        <input type="text" id="buscar-cobro-cierre" class="buscador" placeholder="Buscar" value="${esc(busquedaCobrosCierre)}" autocomplete="off" />
        ${filtrosListaHtml('filtros-cobros-cierre', [
          {
            nombre: 'metodo',
            titulo: 'Cuenta',
            opciones: [['todos', 'Todas'], ...[...new Set(movimientosDelDia.map((m) => m.cuenta))].map((n) => [n, n])],
            actual: filtroMetodoCobrosCierre,
            porDefecto: 'todos',
          },
        ])}
      </div>
      <table>
        <thead><tr><th>Hora</th><th>Detalle</th><th>Cuenta</th><th>Monto</th></tr></thead>
        <tbody id="cobros-cierre-body"></tbody>
      </table>`
          : ''
      }
    </div>
  `;

  const pintarCobrosCierre = () => {
    const cuerpo = document.getElementById('cobros-cierre-body');
    if (!cuerpo) return;
    const q = normalizarTexto(busquedaCobrosCierre.trim());
    const visibles = movimientosDelDia.filter(
      (m) => (filtroMetodoCobrosCierre === 'todos' || m.cuenta === filtroMetodoCobrosCierre) && (!q || normalizarTexto(m.detalle).includes(q))
    );
    cuerpo.innerHTML = visibles.length
      ? visibles
          .map(
            (m) => `<tr>
            <td>${m.hora}</td>
            <td>${m.detalleHtml}</td>
            <td>${esc(m.cuenta)}</td>
            <td><span class="${m.monto < 0 ? 'est-salidas' : 'est-entradas'}">$${formatearMoneda(Math.abs(m.monto))}</span></td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="4">No hay movimientos con ese filtro.</td></tr>';
  };
  pintarCobrosCierre();
  vincularFiltrosLista('filtros-cobros-cierre', (grupo, valor) => {
    filtroMetodoCobrosCierre = valor;
    renderCierreCaja();
  });
  document.getElementById('buscar-cobro-cierre')?.addEventListener('input', (e) => {
    busquedaCobrosCierre = e.target.value;
    pintarCobrosCierre();
  });
  const inputFondo = document.getElementById('cierre-fondo');
  const inputContado = document.getElementById('cierre-contado');
  vincularFormatoMoneda(inputFondo);
  vincularFormatoMoneda(inputContado);
  // Al entrar a un campo con un valor ya escrito, queda seleccionado: se pisa escribiendo encima.
  [inputFondo, inputContado].forEach((input) => input.addEventListener('focus', () => input.select()));

  // Guardar el cierre con el fondo y lo contado. Cada "✓" guarda solo su campo: el otro queda como estaba guardado.
  const guardarCierre = async ({ fondo, contado }) => {
    const resultado = await window.freska.caja.guardarCierre({
      fecha,
      fondo_inicial: fondo,
      efectivo_contado: contado === null || Number.isNaN(contado) ? null : contado,
    });
    if (!resultado.ok) {
      mostrarToast(resultado.error, 'error');
      return;
    }
    mostrarToast('Cierre guardado.', 'ok');
    renderCierreCaja();
  };
  const fondoActual = () => fondoGuardado || 0;
  const contadoActual = () => (contadoGuardado === null || contadoGuardado === undefined ? null : contadoGuardado);
  const btnFondo = document.getElementById('btn-guardar-fondo');
  const btnContado = document.getElementById('btn-guardar-contado');
  const guardarFondo = () => {
    if (btnFondo.disabled) return;
    const v = limpiarNumeroMoneda(inputFondo.value);
    guardarCierre({ fondo: Number.isNaN(v) ? 0 : v, contado: contadoActual() });
  };
  const guardarContado = () => {
    if (btnContado.disabled) return;
    const v = limpiarNumeroMoneda(inputContado.value);
    guardarCierre({ fondo: fondoActual(), contado: inputContado.value.trim() === '' || Number.isNaN(v) ? null : v });
  };
  const marcarCambio = () => {
    btnFondo.disabled = inputFondo.value === textoFondo;
    btnContado.disabled = inputContado.value === textoContado;
    const estado = document.getElementById('cierre-estado');
    const hayCambios = !btnFondo.disabled || !btnContado.disabled;
    estado.textContent = hayCambios ? 'Tocá ✓ para guardar.' : estadoInicial;
    estado.classList.toggle('cierre-estado-pendiente', hayCambios);
  };
  inputFondo.addEventListener('input', marcarCambio);
  inputContado.addEventListener('input', marcarCambio);
  btnFondo.addEventListener('click', guardarFondo);
  btnContado.addEventListener('click', guardarContado);
  inputFondo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') guardarFondo();
  });
  inputContado.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') guardarContado();
  });

  document.getElementById('ir-a-caja-general')?.addEventListener('click', () => {
    vistaCierreTab = 'general';
    renderCierreCaja();
  });

  vincularSelectorFecha('filtro-fecha-cierre', fecha, (nueva) => {
    fechaCierreCaja = nueva || fechaHoyISO();
    renderCierreCaja();
  });

  vincularCierreTabToggle();
  document.getElementById('btn-volver-cierre')?.addEventListener('click', () => {
    const origen = origenCierreCaja;
    origenCierreCaja = null;
    if (origen === 'cobros') {
      irAVista(botonDeVista('cobros'));
    } else {
      vistaCierreTab = 'mes';
      renderCierreCaja();
    }
  });
  vincularBotonAyuda('ayuda-cuentas-cierre');
  app.querySelectorAll('.fila-cuenta-cierre').forEach((fila) => {
    fila.addEventListener('click', () => abrirMovimientosCuenta(fila.dataset.cuenta));
    fila.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') abrirMovimientosCuenta(fila.dataset.cuenta);
    });
  });

  // "Dio justo": lo contado es el efectivo esperado (con el fondo guardado); se toca a propósito, así que guarda directo.
  document.getElementById('btn-dio-justo').addEventListener('click', () => {
    const esperado = calcularCuentaCaja({ cobros: datos.cobros, retiros: salidas, fondo: fondoActual(), contado: null, otros: datos.otrosEfectivo || 0 }).esperado;
    guardarCierre({ fondo: fondoActual(), contado: esperado });
  });

  document.getElementById('btn-imprimir-cierre').addEventListener('click', () => {
    const cuenta = calcularCuentaCaja({ cobros: datos.cobros, retiros: salidas, fondo: fondoActual(), contado: contadoActual(), otros: datos.otrosEfectivo || 0 });
    const fondo = fondoActual();
    const contado = contadoActual();
    document.getElementById('area-impresion').innerHTML = construirHojaCierre(fecha, { ...datos, retiros: salidas }, fondo, contado, cuenta);
    imprimirConTitulo('Cierre de caja', fecha);
  });
}
