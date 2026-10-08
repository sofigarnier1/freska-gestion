// Pestaña Estadísticas: entradas y salidas de un período. Se carga después de los archivos de pantallas (utilidades.js … inicio.js, ver index.html) y usa sus funciones.
// Todo se cuenta "en base caja", como la planilla del dueño: lo cobrado el día que se cobró y lo pagado (gastos
// y pagos a proveedores) el día que se pagó.

let rangoEstadisticas = null; // { desde, hasta }; se arma la primera vez (este mes)
let seccionEstadisticas = 'resumen'; // resumen | ventas | compras | pendiente | inflacion
let vistaEstadisticas = 'negocio'; // 'negocio' | 'personal' | 'total': qué se cuenta (los gastos "Particulares" y los ingresos personales son lo personal)

function periodoActualEstadisticas() {
  const hoy = new Date();
  return { desde: primerDiaDelMes(hoy.getFullYear(), hoy.getMonth()), hasta: ultimoDiaDelMes(hoy.getFullYear(), hoy.getMonth()) };
}

// Los períodos rápidos de arriba: Este mes, Mes pasado, Este año y Todo.
function periodosRapidosEstadisticas() {
  const hoy = new Date();
  const mesPasado = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  return [
    { id: 'este-mes', texto: 'Este mes', ...periodoActualEstadisticas() },
    { id: 'mes-pasado', texto: 'Mes pasado', desde: primerDiaDelMes(mesPasado.getFullYear(), mesPasado.getMonth()), hasta: ultimoDiaDelMes(mesPasado.getFullYear(), mesPasado.getMonth()) },
    { id: 'este-anio', texto: 'Este año', desde: `${hoy.getFullYear()}-01-01`, hasta: `${hoy.getFullYear()}-12-31` },
    { id: 'todo', texto: 'Todo', desde: '', hasta: '' },
  ];
}

// Una lista de barras horizontales: cada fila con su nombre, la barra (proporcional al mayor) y el monto.
function barrasEstadisticaHtml(filas, clase) {
  if (!filas.length) return '<p class="pin-subtitulo">No hay movimientos en este período.</p>';
  const maximo = Math.max(...filas.map((f) => f.total), 1);
  return `<div class="est-barras">${filas
    .map(
      (f) => `<div class="est-barra-fila">
      <span class="est-barra-nombre">${esc(f.nombre)}${f.detalle ? ` <span class="est-barra-detalle">${esc(f.detalle)}</span>` : ''}</span>
      <span class="est-barra-pista"><span class="est-barra ${f.clase || clase}" style="width:${Math.max(2, Math.round((f.total / maximo) * 100))}%"></span></span>
      <span class="est-barra-monto">$${formatearMoneda(f.total)}</span>
    </div>`
    )
    .join('')}</div>`;
}

// La línea de comparación de una tarjeta: "▲ 12% que el período anterior". `mejorSiSube` dice si subir es bueno
// (entradas, resultado) o malo (salidas). Con el resultado se muestra la diferencia en pesos, porque el
// porcentaje no tiene sentido cuando antes daba negativo o cero.
function variacionEstadisticaHtml(actual, previo, mejorSiSube, anterior, enPesos) {
  if (previo === null || previo === undefined) return '';
  const titulo = `Período anterior: ${fechaLargaCierre(anterior.desde)} al ${fechaLargaCierre(anterior.hasta)}`;
  const diferencia = redondearPesos(actual - previo);
  if (diferencia === 0) return `<span class="est-var" title="${esc(titulo)}">= igual que el período anterior</span>`;
  // Si el período anterior dio $0 (o negativo), un porcentaje de cambio no tiene sentido (sería
  // dividir por cero): se muestra directamente cuánto fue el período anterior, para tener contexto igual.
  if (!enPesos && previo <= 0) return `<span class="est-var" title="${esc(titulo)}">Período anterior: $${formatearMoneda(previo)}</span>`;
  const sube = diferencia > 0;
  const bien = sube === mejorSiSube;
  const texto = enPesos
    ? `$${formatearMoneda(Math.abs(diferencia))} ${sube ? 'más' : 'menos'} que el período anterior`
    : `${Math.round((Math.abs(diferencia) / previo) * 100)}% ${sube ? 'más' : 'menos'} que el período anterior`;
  return `<span class="est-var ${bien ? 'est-var-bien' : 'est-var-mal'}" title="${esc(titulo)}">${sube ? '▲' : '▼'} ${texto}</span>`;
}

function etiquetaMesEstadistica(mes) {
  const [anio, m] = mes.split('-').map(Number);
  const nombre = new Date(anio, m - 1, 1).toLocaleDateString('es-AR', { month: 'short' }).replace('.', '');
  return `${nombre} ${String(anio).slice(2)}`;
}

async function renderEstadisticas() {
  if (!rangoEstadisticas) rangoEstadisticas = periodoActualEstadisticas();
  const { desde, hasta } = rangoEstadisticas;
  const [res, pendiente, rankings, precios, inflacionLista] = await Promise.all([
    window.freska.estadisticas.resumen({ desde, hasta }),
    window.freska.estadisticas.pendiente(),
    window.freska.estadisticas.rankings({ desde, hasta }),
    window.freska.estadisticas.preciosCompras({ desde, hasta }),
    window.freska.inflacion.listar(),
    vendedoresParaElegir(),
  ]);
  const inflacionPorMes = new Map(inflacionLista.map((i) => [i.mes, i.porcentaje]));
  if (!res.ok) {
    app.innerHTML = `<p class="error-msg">${esc(res.error || 'No se pudieron calcular las estadísticas.')}</p>`;
    return;
  }

  const particulares = res.salidas.gastos.porCategoria.filter((c) => c.ambito === 'personal').reduce((acc, c) => acc + c.total, 0);
  // Lo que se cuenta según la vista. Negocio: ventas, gastos (sin los particulares), proveedores e intereses.
  // Personal: los ingresos personales (alquileres, etc.) y los gastos particulares. Total: todo junto.
  const totalesVista = (t) => {
    const negocio = { entradas: t.entradas + t.interesesGanados + (t.reintegros || 0), salidas: t.gastos - t.particulares + t.proveedores + t.interesesPagados };
    const personal = { entradas: t.ingresos, salidas: t.particulares };
    const v = vistaEstadisticas === 'negocio' ? negocio : vistaEstadisticas === 'personal' ? personal : { entradas: negocio.entradas + personal.entradas, salidas: negocio.salidas + personal.salidas };
    return { entradas: redondearPesos(v.entradas), salidas: redondearPesos(v.salidas), resultado: redondearPesos(v.entradas - v.salidas) };
  };
  const actual = totalesVista({
    entradas: res.entradas.total,
    gastos: res.salidas.gastos.total,
    particulares,
    proveedores: res.salidas.proveedores.total,
    ingresos: res.personal.ingresos.total,
    interesesGanados: res.intereses.ganados,
    interesesPagados: res.intereses.pagados,
    reintegros: res.intereses.reintegros || 0,
  });
  const totalEntradas = actual.entradas;
  const totalSalidas = actual.salidas;
  const resultado = actual.resultado;

  // Período anterior (si el período elegido tiene fechas): mismas cuentas, con la misma vista.
  const ant = res.anterior;
  const antVista = ant ? totalesVista(ant) : null;
  const antEntradas = ant ? antVista.entradas : null;
  const antSalidas = ant ? antVista.salidas : null;
  const antResultado = ant ? antVista.resultado : null;

  // Resultado final (solo vista Negocio): el resultado del negocio menos lo que se sacó para vivir (los gastos de Gastos con
  // categoría personal). Si en el período no se sacó nada, sería igual al Resultado y no se muestra.
  const paraVivir = redondearPesos(res.salidas.gastos.paraVivir || 0);
  const resultadoFinal = redondearPesos(resultado - paraVivir);
  const antResultadoFinal = ant ? redondearPesos(antResultado - redondearPesos(ant.paraVivir || 0)) : null;
  const montoConSigno = (n) => `${n < 0 ? '−' : ''}$${formatearMoneda(Math.abs(n))}`;
  const resultadoFinalHtml =
    vistaEstadisticas === 'negocio' && paraVivir > 0
      ? `<div class="est-tarjeta est-final">
          <div class="est-final-principal">
            <div class="est-final-titulo"><span class="est-tarjeta-titulo">Resultado final</span>${botonAyudaHtml('ayuda-resultado-final', 'Resultado final', '<p>Es lo que le queda al negocio después de lo que sacaste para vivir (el supermercado, la nafta…): los gastos de <em>Gastos</em> con una categoría <em>Personal</em>.</p><p>El <em>Resultado</em> de arriba no cuenta esos gastos, para saber si el negocio se defiende solo. Acá se restan para ver cuánto queda de verdad.</p><p>Los gastos de tus propiedades no entran: son de Fondos personales.</p>', 'izquierda')}</div>
            <strong class="${resultadoFinal < 0 ? 'est-salidas' : ''}">${montoConSigno(resultadoFinal)}</strong>
            ${ant && antResultadoFinal !== 0 ? variacionEstadisticaHtml(resultadoFinal, antResultadoFinal, true, ant, false) : ''}
          </div>
          <details class="est-final-detalle">
            <summary>Ver cuenta</summary>
            <div class="est-final-fila"><span>Resultado del negocio</span><span class="${resultado < 0 ? 'est-salidas' : ''}">${montoConSigno(resultado)}</span></div>
            <div class="est-final-fila"><span>− Sacaste para vivir</span><span class="est-salidas">$${formatearMoneda(paraVivir)}</span></div>
            <div class="est-final-fila est-final-total"><span>= Resultado final</span><span class="${resultadoFinal < 0 ? 'est-salidas' : ''}">${montoConSigno(resultadoFinal)}</span></div>
          </details>
        </div>`
      : '';

  const veNegocio = vistaEstadisticas !== 'personal';
  const vePersonal = vistaEstadisticas !== 'negocio';
  // Lo de ventas, compras y plata pendiente es del negocio: en Personal solo quedan el resumen y la inflación.
  const seccion = !veNegocio && ['ventas', 'compras', 'pendiente'].includes(seccionEstadisticas) ? 'resumen' : seccionEstadisticas;
  // Salidas: los pagos a proveedores y cada categoría de gasto, de mayor a menor.
  const filasSalidas = [];
  if (veNegocio && res.salidas.proveedores.total > 0) {
    filasSalidas.push({ nombre: 'Proveedores (pagos)', total: res.salidas.proveedores.total, clase: 'est-barra-proveedores' });
  }
  res.salidas.gastos.porCategoria.forEach((c) => {
    const esParticular = c.ambito === 'personal';
    if (esParticular ? !vePersonal : !veNegocio) return;
    filasSalidas.push({ nombre: c.categoria, total: c.total });
  });
  if (veNegocio && res.intereses.pagados > 0) filasSalidas.push({ nombre: 'Intereses pagados', total: res.intereses.pagados });
  filasSalidas.sort((a, b) => b.total - a.total);
  const prov = res.salidas.proveedores;
  const detalleProveedores = veNegocio
    ? [
        prov.efectivo > 0 ? `Efectivo $${formatearMoneda(prov.efectivo)}` : '',
        prov.transferencia > 0 ? `Transferencia $${formatearMoneda(prov.transferencia)}` : '',
        prov.cheques > 0 ? `Cheques $${formatearMoneda(prov.cheques)}` : '',
      ].filter(Boolean)
    : [];

  const filasEntradas = [];
  if (veNegocio) {
    res.entradas.porMetodo.forEach((m) => filasEntradas.push({ nombre: m.metodo, total: m.total, detalle: `${m.cantidad} ${m.cantidad === 1 ? 'cobro' : 'cobros'}` }));
    if (res.intereses.ganados > 0) filasEntradas.push({ nombre: 'Intereses ganados', total: res.intereses.ganados });
    if (res.intereses.reintegros > 0) filasEntradas.push({ nombre: 'Reintegros', total: res.intereses.reintegros });
  }
  if (vePersonal) {
    res.personal.ingresos.porOrigen.forEach((o) => filasEntradas.push({ nombre: o.origen, total: o.total, detalle: `${o.cantidad} ${o.cantidad === 1 ? 'ingreso' : 'ingresos'} · personal`, clase: 'est-barra-personal' }));
  }
  filasEntradas.sort((a, b) => b.total - a.total);

  // Gastos por forma de pago y los gastos más grandes del período (solo negocio, ver estadisticas.js del main).
  const filasGastosPorMetodo = veNegocio
    ? res.salidas.gastos.porMetodo.map((m) => ({ nombre: m.metodo, total: m.total, detalle: `${m.cantidad} ${m.cantidad === 1 ? 'gasto' : 'gastos'}` }))
    : [];
  const filasTopGastos = veNegocio
    ? res.salidas.gastos.top.map((g) => ({ nombre: g.descripcion, total: g.monto, detalle: `${g.categoria} · ${formatearFechaCorta(g.fecha)}`, clase: 'est-barra-salidas' }))
    : [];

  // Mes a mes.
  const serie = res.serie.map((m) => ({
    mes: m.mes,
    ...(() => {
      const v = totalesVista({ entradas: m.entradas, gastos: m.gastos, particulares: m.particulares, proveedores: m.proveedores, ingresos: m.ingresos || 0, interesesGanados: m.interesesGanados || 0, interesesPagados: m.interesesPagados || 0, reintegros: m.reintegros || 0 });
      return { entradas: v.entradas, salidas: v.salidas };
    })(),
  }));
  // La tabla de inflación arranca en el primer mes con movimiento (o los últimos 3 meses si no hay nada).
  const primerMesConDatos = serie.findIndex((m) => m.entradas > 0 || inflacionPorMes.has(m.mes));
  const mesInicialInflacion = primerMesConDatos === -1 ? serie.length - 3 : primerMesConDatos;
  const maximoSerie = Math.max(...serie.map((m) => Math.max(m.entradas, m.salidas)), 1);

  const rapidos = periodosRapidosEstadisticas();
  const activo = rapidos.find((p) => p.desde === desde && p.hasta === hasta);

  app.innerHTML = `
    <div class="estadisticas-pantalla est-vista-${vistaEstadisticas} est-sec-${seccion}">
      <div class="reportes-toggle est-vistas">
        <button type="button" class="toggle ${vistaEstadisticas === 'negocio' ? 'active' : ''}" data-vista-est="negocio">Negocio</button>
        <button type="button" class="toggle ${vistaEstadisticas === 'personal' ? 'active' : ''}" data-vista-est="personal">Personal</button>
        <button type="button" class="toggle ${vistaEstadisticas === 'total' ? 'active' : ''}" data-vista-est="total">Total</button>
      </div>
      <div class="toolbar toolbar-junta est-toolbar">
        <div class="reportes-toggle">
          ${rapidos.map((p) => `<button type="button" class="toggle ${activo && activo.id === p.id ? 'active' : ''}" data-periodo="${p.id}">${p.texto}</button>`).join('')}
        </div>
        ${selectorRangoHtml('filtro-rango-estadisticas', desde, hasta)}
        <div class="est-ayuda">
          <button type="button" id="btn-ayuda-estadisticas" class="btn-ayuda-est" aria-label="Cómo se cuenta" aria-expanded="false" title="Cómo se cuenta">?</button>
          <div id="est-ayuda-panel" class="est-ayuda-panel" hidden>
            <strong>Cómo se cuenta</strong>
            <p><em>Negocio</em>: ventas, gastos, proveedores, intereses y reintegros. <em>Personal</em>: ingresos y gastos de propiedades de Fondos personales y gastos de las categorías <em>Personal</em>. <em>Total</em>: todo junto.</p>
            <p>Se cuenta lo que se cobró y se pagó cada día. Un cobro cuenta el día que se cobró y un gasto o un pago a un proveedor, el día que se pagó.</p>
            <p>Una compra a un proveedor entra en las salidas cuando se le paga, no cuando se carga.</p>
            <p>Las flechas comparan con el período anterior: un mes con el mes anterior, un año con el año anterior y cualquier otro rango con el tramo de igual largo justo antes. Si el período todavía no terminó (por ejemplo, este mes), se compara solo hasta el mismo día. Pasá el mouse por una flecha para ver las fechas.</p>
            <p>"Plata pendiente" es la situación de hoy y no depende del período.</p>
            <p>El mes a mes muestra los 12 meses que terminan en el último mes del período elegido.</p>
          </div>
        </div>
      </div>

      <div class="est-tarjetas">
        <div class="est-tarjeta"><span class="est-tarjeta-titulo">Entradas</span><strong class="est-entradas">$${formatearMoneda(totalEntradas)}</strong>${ant ? variacionEstadisticaHtml(totalEntradas, antEntradas, true, ant, false) : ''}</div>
        <div class="est-tarjeta"><span class="est-tarjeta-titulo">Salidas</span><strong class="est-salidas">$${formatearMoneda(totalSalidas)}</strong>${ant ? variacionEstadisticaHtml(totalSalidas, antSalidas, false, ant, false) : ''}</div>
        <div class="est-tarjeta"><span class="est-tarjeta-titulo">Resultado</span><strong class="${resultado < 0 ? 'est-salidas' : ''}">${resultado < 0 ? '−' : ''}$${formatearMoneda(Math.abs(resultado))}</strong>${ant ? variacionEstadisticaHtml(resultado, antResultado, true, ant, true) : ''}</div>
      </div>

      ${resultadoFinalHtml}

      <div class="reportes-toggle est-secciones">
        <button type="button" class="toggle ${seccion === 'resumen' ? 'active' : ''}" data-sec-est="resumen">Resumen</button>
        ${vePersonal && !veNegocio ? '' : `<button type="button" class="toggle ${seccion === 'ventas' ? 'active' : ''}" data-sec-est="ventas">Ventas</button>
        <button type="button" class="toggle ${seccion === 'compras' ? 'active' : ''}" data-sec-est="compras">Compras</button>
        <button type="button" class="toggle ${seccion === 'pendiente' ? 'active' : ''}" data-sec-est="pendiente">Plata pendiente</button>`}
        <button type="button" class="toggle ${seccion === 'inflacion' ? 'active' : ''}" data-sec-est="inflacion">Inflación</button>
      </div>

      <div class="est-seccion" data-sec="resumen">
      <div class="est-columnas">
        <section>
          <h2>${vistaEstadisticas === 'negocio' ? 'Entradas por forma de pago' : vistaEstadisticas === 'personal' ? 'Ingresos personales' : 'Entradas'}</h2>
          ${barrasEstadisticaHtml(filasEntradas, 'est-barra-entradas')}
        </section>
        <section>
          <h2>Salidas</h2>
          ${barrasEstadisticaHtml(filasSalidas, 'est-barra-salidas')}
          ${detalleProveedores.length ? `<p class="pin-subtitulo est-nota">Pagos a proveedores: ${detalleProveedores.join(' · ')} (${prov.cantidad} ${prov.cantidad === 1 ? 'pago' : 'pagos'}).</p>` : ''}
        </section>
      </div>
      ${
        veNegocio
          ? `<div class="est-columnas">
        <section>
          <h2>Gastos por forma de pago</h2>
          ${barrasEstadisticaHtml(filasGastosPorMetodo, 'est-barra-salidas')}
        </section>
        <section>
          <h2>Gastos más grandes</h2>
          ${barrasEstadisticaHtml(filasTopGastos, 'est-barra-salidas')}
        </section>
      </div>`
          : ''
      }

      <h2>Mes a mes</h2>
      <div class="est-leyenda"><span class="est-punto est-barra-entradas"></span> Entradas <span class="est-punto est-barra-salidas"></span> Salidas</div>
      <div class="est-grafico">
        ${serie
          .map(
            (m) => `<div class="est-mes" title="${esc(etiquetaMesEstadistica(m.mes))}: entradas $${formatearMoneda(m.entradas)} · salidas $${formatearMoneda(m.salidas)}">
          <div class="est-mes-barras">
            <span class="est-col est-barra-entradas" style="height:${m.entradas > 0 ? Math.max(2, Math.round((m.entradas / maximoSerie) * 100)) : 0}%"></span>
            <span class="est-col est-barra-salidas" style="height:${m.salidas > 0 ? Math.max(2, Math.round((m.salidas / maximoSerie) * 100)) : 0}%"></span>
          </div>
          <span class="est-mes-nombre">${esc(etiquetaMesEstadistica(m.mes))}</span>
        </div>`
          )
          .join('')}
      </div>
      </div>

      <div class="est-seccion" data-sec="ventas">
      <h2 class="est-solo-negocio">Ventas del período</h2>
      <p class="est-ventas est-solo-negocio">${
        rankings.ventas.facturas
          ? `Facturaste <strong>$${formatearMoneda(rankings.ventas.importe)}</strong> en ${rankings.ventas.facturas} ${rankings.ventas.facturas === 1 ? 'factura' : 'facturas'} (unos <strong>$${formatearMoneda(Math.round(rankings.ventas.importe / rankings.ventas.facturas))}</strong> por factura).`
          : 'No hay facturas en este período.'
      }</p>
      ${
        rankings.ventas.facturas
          ? `<p class="est-var est-solo-negocio">${
              pendiente.clientes.total > 0
                ? `Hoy tenés <strong>$${formatearMoneda(pendiente.clientes.total)}</strong> pendientes de cobrar entre ${pendiente.clientes.cantidad} ${pendiente.clientes.cantidad === 1 ? 'cliente' : 'clientes'}. <button type="button" class="enlace-boton ir-a-pendiente-est">Ver detalle</button>`
                : 'No tenés plata pendiente de cobrar entre clientes.'
            }</p>`
          : ''
      }
      <div class="est-columnas est-solo-negocio">
        <section>
          <h3 class="est-subtitulo">Productos más vendidos</h3>
          ${barrasEstadisticaHtml(
            rankings.productos.map((p) => ({ nombre: p.nombre, total: p.importe, detalle: `${formatearCantidad(p.cantidad)} ${p.unidad === 'kg' ? 'kg' : 'u.'}` })),
            'est-barra-entradas'
          )}
        </section>
        <section>
          <h3 class="est-subtitulo">Clientes que más compraron</h3>
          ${barrasEstadisticaHtml(
            rankings.clientes.map((c) => ({ nombre: c.nombre, total: c.importe, detalle: `${c.facturas} ${c.facturas === 1 ? 'factura' : 'facturas'}` })),
            'est-barra-entradas'
          )}
        </section>
      </div>

        <h3 class="est-subtitulo">Ventas por día de la semana</h3>
        ${barrasEstadisticaHtml(
          rankings.porDiaSemana.map((d) => ({ nombre: d.dia, total: d.importe, detalle: `${d.facturas} ${d.facturas === 1 ? 'factura' : 'facturas'}` })).filter((d) => d.total > 0),
          'est-barra-entradas'
        )}

        ${
          vendedoresCache.length
            ? `<h3 class="est-subtitulo">Comisionistas</h3>
        <p class="pin-subtitulo" style="margin:-6px 0 10px;">Sobre lo <strong>cobrado</strong> en el período (no lo facturado), como en el informe de Vendedores.</p>
        ${barrasEstadisticaHtml(
          [
            ...rankings.comisionistas.vendedores.map((v) => ({ nombre: v.nombre, total: v.total })),
            rankings.comisionistas.directo > 0 ? { nombre: 'Directo (Freska)', total: rankings.comisionistas.directo, clase: 'est-barra-personal' } : null,
          ].filter(Boolean),
          'est-barra-entradas'
        )}`
            : ''
        }
      </div>

      <div class="est-seccion" data-sec="compras">
        <div class="cierre-titulo-fila"><h2>Precio por kilo de lo que comprás</h2>${botonAyudaHtml('ayuda-est-precios', 'Precio por kilo', '<p>Sale de los kilos y el importe de cada compra cargada en <em>Proveedores</em>. Para cada producto y proveedor muestra el último precio por kilo, el de la compra anterior y cuánto cambió.</p><p><strong>▲ rojo</strong>: ahora pagás más por kilo que la compra anterior. <strong>▼ verde</strong>: pagás menos.</p>', 'izquierda')}</div>
        ${
          precios.ok && precios.filas.length
            ? `<table class="est-tabla-precios">
          <thead><tr><th>Producto</th><th>Proveedor</th><th>Último</th><th>Antes</th><th>Cambio</th><th>Promedio</th></tr></thead>
          <tbody>
            ${precios.filas
              .map((f) => {
                const cambio = f.previo ? ((f.ultimo - f.previo) / f.previo) * 100 : null;
                const cambioHtml =
                  cambio === null
                    ? '<span class="texto-suave">—</span>'
                    : Math.abs(cambio) < 0.05
                      ? '<span class="texto-suave">igual</span>'
                      : `<span class="est-var ${cambio > 0 ? 'est-var-mal' : 'est-var-bien'}">${cambio > 0 ? '▲' : '▼'} ${Math.abs(cambio).toFixed(1).replace('.', ',')}%</span>`;
                return `<tr><td>${esc(f.producto)}</td><td>${esc(f.proveedor)}</td><td>$${formatearMoneda(f.ultimo)} <span class="est-barra-detalle">${formatearFechaCorta(f.fechaUltimo)}</span></td><td>${f.previo ? `$${formatearMoneda(f.previo)} <span class="est-barra-detalle">${formatearFechaCorta(f.fechaPrevio)}</span>` : '<span class="texto-suave">—</span>'}</td><td>${cambioHtml}</td><td>$${formatearMoneda(f.promedio)}</td></tr>`;
              })
              .join('')}
          </tbody>
        </table>`
            : '<p class="pin-subtitulo">No hay compras con kilos en este período.</p>'
        }
      </div>

      <div class="est-seccion" data-sec="pendiente">
      <h2 class="est-solo-negocio">Plata pendiente <span class="est-hoy">hoy</span></h2>
      <div class="est-pendiente est-solo-negocio">
        <div class="est-tarjeta">
          <span class="est-tarjeta-titulo">Te deben los clientes</span>
          <strong>$${formatearMoneda(pendiente.clientes.total)}</strong>
          <span class="est-var">${pendiente.clientes.cantidad} ${pendiente.clientes.cantidad === 1 ? 'cliente' : 'clientes'}</span>
          ${
            pendiente.clientes.mayores.length
              ? `<ul class="est-mayores">${pendiente.clientes.mayores
                  .map((c) => `<li><button type="button" class="enlace-boton ir-a-cliente" data-id="${c.id}">${esc(c.nombre)}</button><span>$${formatearMoneda(c.saldo)}</span></li>`)
                  .join('')}</ul>`
              : ''
          }
        </div>
        <div class="est-tarjeta">
          <span class="est-tarjeta-titulo">Les debés a proveedores</span>
          <strong>$${formatearMoneda(pendiente.proveedores.total)}</strong>
          <span class="est-var">${pendiente.proveedores.cantidad} ${pendiente.proveedores.cantidad === 1 ? 'proveedor' : 'proveedores'}</span>
          ${
            pendiente.proveedores.mayores.length
              ? `<ul class="est-mayores">${pendiente.proveedores.mayores
                  .map((p) => `<li><button type="button" class="enlace-boton ir-a-proveedor" data-id="${p.id}">${esc(p.nombre)}</button><span>$${formatearMoneda(p.saldo)}</span></li>`)
                  .join('')}</ul>`
              : ''
          }
          ${pendiente.proveedores.cantidad > pendiente.proveedores.mayores.length ? '<button type="button" class="enlace-boton ir-a-proveedores-est">Ver todos los proveedores</button>' : ''}
        </div>
        <div class="est-tarjeta">
          <span class="est-tarjeta-titulo">Cheques en cartera</span>
          <strong>$${formatearMoneda(pendiente.cheques.total)}</strong>
          <span class="est-var">${pendiente.cheques.cantidad} ${pendiente.cheques.cantidad === 1 ? 'cheque' : 'cheques'}</span>
          ${
            pendiente.cheques.porVencer.cantidad
              ? `<span class="est-var est-var-mal">${pendiente.cheques.porVencer.cantidad} ${pendiente.cheques.porVencer.cantidad === 1 ? 'cheque' : 'cheques'} ($${formatearMoneda(pendiente.cheques.porVencer.total)}) ya se pueden cobrar o vencen en 7 días</span>`
              : ''
          }
          ${pendiente.cheques.cantidad ? '<button type="button" class="enlace-boton ir-a-cheques-est">Ver cheques</button>' : ''}
        </div>
      </div>
      </div>

      <div class="est-seccion" data-sec="inflacion">
      <div class="cierre-titulo-fila"><h2>Inflación</h2>${botonAyudaHtml('ayuda-est-inflacion', 'Cómo usar la inflación', '<p>Sirve para ver si tus entradas <strong>le ganan a los precios</strong>.</p><p>Cargá a mano, en cada mes, el porcentaje de inflación (por ejemplo el que publica el INDEC: 4,5).</p><p><strong>Cambio</strong> es cuánto subieron o bajaron las entradas contra el mes anterior. <strong>Cambio real</strong> le descuenta la inflación: si las entradas subieron 10% y la inflación fue 4,5%, ganaste 5,3% real. Si subieron menos que la inflación, perdiste, aunque en pesos hayas cobrado más.</p><p>Para calcularlo hace falta la inflación del mes y que el mes anterior tenga entradas.</p>', 'izquierda')}</div>
      <table class="est-tabla-inflacion">
        <thead><tr><th>Mes</th><th>${vistaEstadisticas === 'personal' ? 'Ingresos' : vistaEstadisticas === 'total' ? 'Entradas' : 'Entradas'}</th><th>Cambio</th><th>Inflación del mes</th><th>Cambio real</th></tr></thead>
        <tbody>
          ${serie
            .map((m, i) => ({ m, i }))
            .filter(({ m, i }) => i >= Math.min(mesInicialInflacion, serie.length - 3) || m.entradas > 0 || inflacionPorMes.has(m.mes))
            .map(({ m, i }) => {
              const previo = i > 0 ? serie[i - 1].entradas : 0;
              const pct = inflacionPorMes.has(m.mes) ? inflacionPorMes.get(m.mes) : null;
              const nominal = previo > 0 ? m.entradas / previo - 1 : null;
              const real = nominal !== null && pct !== null ? (1 + nominal) / (1 + pct / 100) - 1 : null;
              const fmt = (n) => `${n > 0 ? '+' : ''}${(n * 100).toFixed(1).replace('.', ',')}%`;
              return `<tr>
            <td>${esc(etiquetaMesEstadistica(m.mes))}</td>
            <td>$${formatearMoneda(m.entradas)}</td>
            <td>${nominal === null ? '<span class="texto-suave">—</span>' : `<span class="est-var ${nominal >= 0 ? 'est-var-bien' : 'est-var-mal'}">${fmt(nominal)}</span>`}</td>
            <td><span class="fila-inflacion-input">
              <span class="input-porcentaje"><input type="text" class="est-inflacion-input" data-mes="${m.mes}" data-original="${pct === null ? '' : String(pct).replace('.', ',')}" inputmode="decimal" placeholder="0" value="${pct === null ? '' : String(pct).replace('.', ',')}" autocomplete="off" aria-label="Inflación de ${esc(etiquetaMesEstadistica(m.mes))}" /><span>%</span></span>
              <button type="button" class="btn-redondo btn-guardar-campo btn-guardar-inflacion" data-mes="${m.mes}" disabled aria-label="Guardar inflación de ${esc(etiquetaMesEstadistica(m.mes))}" title="Guardar">${GUARDAR_SVG}</button>
            </span></td>
            <td>${real === null ? '<span class="texto-suave">—</span>' : `<span class="est-var ${real >= 0 ? 'est-var-bien' : 'est-var-mal'}">${real >= 0 ? '▲ Ganó' : '▼ Perdió'} ${Math.abs(real * 100).toFixed(1).replace('.', ',')}%</span>`}</td>
          </tr>`;
            })
            .reverse()
            .join('')}
        </tbody>
      </table>
      </div>
    </div>
  `;

  app.querySelectorAll('[data-periodo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const elegido = rapidos.find((p) => p.id === btn.dataset.periodo);
      rangoEstadisticas = { desde: elegido.desde, hasta: elegido.hasta };
      renderEstadisticas();
    });
  });
  vincularSelectorRango('filtro-rango-estadisticas', desde, hasta, ({ desde: d, hasta: h }) => {
    rangoEstadisticas = { desde: d, hasta: h };
    renderEstadisticas();
  });
  app.querySelectorAll('.ir-a-cliente').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await irAVista(botonDeVista('clientes'));
      mostrarDatosFichaCliente = false;
      limiteHistorialFicha = MOVIMIENTOS_POR_PAGINA;
      origenFichaCliente = 'estadisticas';
      renderClienteDetalle(Number(btn.dataset.id));
    });
  });
  app.querySelectorAll('.ir-a-proveedor').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await irAVista(document.querySelector('nav button[data-view="proveedores"]'));
      mostrarDatosProveedor = false;
      limiteHistorialProveedor = 30;
      renderProveedorDetalle(Number(btn.dataset.id));
    });
  });
  app.querySelector('.ir-a-proveedores-est')?.addEventListener('click', () => irAVista(document.querySelector('nav button[data-view="proveedores"]')));
  app.querySelector('.ir-a-pendiente-est')?.addEventListener('click', () => {
    seccionEstadisticas = 'pendiente';
    renderEstadisticas();
  });
  app.querySelector('.ir-a-cheques-est')?.addEventListener('click', async () => {
    registrarOrigenVolver('cheques', 'estadisticas', 'estadísticas');
    await irAVista(document.querySelector('nav button[data-view="cheques"]'));
  });

  // El "?" abre y cierra el cuadro de ayuda (también se cierra al tocar en cualquier otro lado o con Escape).
  const btnAyuda = document.getElementById('btn-ayuda-estadisticas');
  const panelAyuda = document.getElementById('est-ayuda-panel');
  const cerrarAyuda = () => {
    panelAyuda.hidden = true;
    btnAyuda.setAttribute('aria-expanded', 'false');
  };
  btnAyuda.addEventListener('click', (e) => {
    e.stopPropagation();
    const abrir = panelAyuda.hidden;
    panelAyuda.hidden = !abrir;
    btnAyuda.setAttribute('aria-expanded', String(abrir));
    if (abrir) acomodarPanelFlotante(panelAyuda);
  });
  panelAyuda.addEventListener('click', (e) => e.stopPropagation());
  app.addEventListener('click', cerrarAyuda);
  btnAyuda.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarAyuda();
  });
  // No se guarda solo al salir del campo (es un número que afecta cálculos de plata): el "✓" de cada fila
  // se habilita recién cuando ese mes cambió, y hay que tocarlo a propósito (ver btn-guardar-campo).
  app.querySelectorAll('.est-inflacion-input').forEach((input) => {
    const btn = app.querySelector(`.btn-guardar-inflacion[data-mes="${input.dataset.mes}"]`);
    const guardar = async () => {
      const texto = input.value.trim().replace(',', '.');
      const r = await window.freska.inflacion.guardar({ mes: input.dataset.mes, porcentaje: texto === '' ? null : Number(texto) });
      if (!r.ok) {
        mostrarToast(r.error, 'error');
        return;
      }
      renderEstadisticas();
    };
    input.addEventListener('input', () => {
      btn.disabled = input.value === input.dataset.original;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !btn.disabled) guardar();
    });
    btn.addEventListener('click', guardar);
  });
  app.querySelectorAll('[data-sec-est]').forEach((btn) => {
    btn.addEventListener('click', () => {
      seccionEstadisticas = btn.dataset.secEst;
      renderEstadisticas();
    });
  });
  ['ayuda-est-precios', 'ayuda-est-inflacion', 'ayuda-resultado-final'].forEach((id) => vincularBotonAyuda(id));
  app.querySelectorAll('[data-vista-est]').forEach((btn) => {
    btn.addEventListener('click', () => {
      vistaEstadisticas = btn.dataset.vistaEst;
      renderEstadisticas();
    });
  });
}
