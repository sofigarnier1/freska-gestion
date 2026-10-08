// Fondos personales: retiros (lo que sale de la plata personal) y cuentas personales con sus pases al negocio.
// Los ingresos y las categorías viven en ingresos.js (misma pantalla, otras pastillas). Los archivos son scripts comunes
// que comparten el espacio global: se cargan en el orden de index.html.

let fechaRetiroForm = null;
let categoriaRetiroForm = '';
let cuentaRetiroForm = '';
let busquedaRetiros = '';

// Plata con signo: un saldo personal puede quedar en negativo si se cargan retiros antes de cargar lo que había.
function montoFondos(n) {
  return n < 0 ? `-$${formatearMoneda(-n)}` : `$${formatearMoneda(n)}`;
}

function opcionesCuentaHtml(cuentas, elegida) {
  return cuentas.map((n) => `<option value="${esc(n)}" ${n === elegida ? 'selected' : ''}>${esc(n)}</option>`).join('');
}

// Gastos de Fondos personales (antes "Retiros"): de propiedades y personales en una sola lista; la categoría (agrupada en Propiedades y Personales, como en Gastos del negocio) dice cuál es. La plata personal que se usa (arreglos y mantenimiento de las casas…). Salen de una cuenta personal y no tocan la caja del negocio.
async function renderRetirosPersonales() {
  if (!rangoIngresosIniciado) {
    rangoIngresosIniciado = true;
    const hoy = new Date();
    filtroIngresosDesde = primerDiaDelMes(hoy.getFullYear(), hoy.getMonth());
    filtroIngresosHasta = ultimoDiaDelMes(hoy.getFullYear(), hoy.getMonth());
  }
  const [categorias, categoriasPersonales, descripciones, todos, saldos] = await Promise.all([
    window.freska.ingresos.categorias(),
    window.freska.ingresos.categoriasGastosPersonales(),
    window.freska.ingresos.descripciones(),
    window.freska.ingresos.retiros(),
    window.freska.ingresos.saldos(),
  ]);
  const cuentas = saldos.cuentas.map((c) => c.nombre);
  const fecha = fechaRetiroForm || fechaHoyISO();
  const cuentaElegida = cuentas.includes(cuentaRetiroForm) ? cuentaRetiroForm : cuentas[0];
  const lista = todos.filter((r) => (!filtroIngresosDesde || r.fecha >= filtroIngresosDesde) && (!filtroIngresosHasta || r.fecha <= filtroIngresosHasta));
  app.innerHTML = `
    <div class="gastos-pantalla">
      ${ingresosTabToggleHtml()}
      <div class="cierre-titulo-fila" style="margin-top:0">
        <h2>Nuevo gasto</h2>
        ${botonAyudaHtml(
          'ayuda-retiros',
          'Gastos',
          '<p>Para lo que gastás de tu plata personal: arreglos y mantenimiento de las propiedades, o tus gastos privados (comida, salud, ropa…). Elegís la categoría (el desplegable las separa en <em>Propiedades</em> y <em>Privados</em>), de qué cuenta personal salió y se resta de ahí.</p><p>No afecta la caja del negocio ni el cierre del día. Cada grupo tiene su lista de categorías, propia de Fondos personales y aparte de la de Gastos del negocio; para agregar una, andá a la pastilla <em>Categorías</em>.</p>',
          'izquierda'
        )}
      </div>
      <div class="panel gasto-form">
        <div class="gasto-fila">
          <div class="gasto-campo">
            <span>Fecha</span>
            ${selectorFechaHtml('retiro-fecha', fecha)}
          </div>
          <label class="gasto-campo">
            <span>Categoría</span>
            <select id="retiro-categoria">
              <option value="">Elegí una…</option>
              ${[['Propiedades', categorias], ['Privados', categoriasPersonales]]
                .filter(([, lista]) => lista.length)
                .map(([titulo, lista]) => `<optgroup label="${titulo}">${lista.map((cat) => `<option value="${cat.id}" ${String(cat.id) === String(categoriaRetiroForm) ? 'selected' : ''}>${esc(cat.nombre)}</option>`).join('')}</optgroup>`)
                .join('')}
            </select>
          </label>
          <label class="gasto-campo gasto-campo-grande">
            <span>Descripción</span>
            ${campoLimpiableHtml('<input type="text" id="retiro-descripcion" maxlength="200" placeholder="Ej: Service de la moto" autocomplete="off" />')}
            ${sugeridasIngresoHtml(descripciones, 'retiro-sugerencias')}
          </label>
          <label class="gasto-campo">
            <span>Monto</span>
            <div class="input-moneda"><span>$</span><input type="text" id="retiro-monto" inputmode="decimal" autocomplete="off" /></div>
          </label>
        </div>
        <div class="gasto-fila">
          <label class="gasto-campo">
            <span>Salió de</span>
            <select id="retiro-cuenta">${opcionesCuentaHtml(cuentas, cuentaElegida)}</select>
          </label>
          <label class="gasto-campo gasto-campo-observacion">
            <span>Observación (opcional)</span>
            ${campoLimpiableHtml('<input type="text" id="retiro-observacion" maxlength="300" placeholder="Ej: casa de Juncal, plomero" autocomplete="off" />')}
          </label>
          <button type="button" id="btn-agregar-retiro" class="btn-redondo btn-mas" aria-label="Agregar gasto" title="Agregar gasto">+</button>
        </div>
        <div class="gasto-fila gasto-fila-acciones">
          <button type="button" id="btn-limpiar-retiro" class="btn-limpiar">Limpiar</button>
        </div>
        <p id="error-retiro" class="error-msg" style="display:none"></p>
      </div>
      <h2>Gastos cargados</h2>
      <div class="toolbar toolbar-junta">
        <span id="retiros-total" class="gastos-total-barra"></span>
        ${selectorRangoHtml('filtro-rango-retiros', filtroIngresosDesde, filtroIngresosHasta)}
        <input type="text" id="buscar-retiro" class="buscador" placeholder="Buscar" value="${esc(busquedaRetiros)}" autocomplete="off" />
      </div>
      <table class="tabla-ingresos">
        <thead><tr><th>Día</th><th>Categoría</th><th>Descripción</th><th>Salió de</th><th>Monto</th><th></th></tr></thead>
        <tbody id="retiros-body"></tbody>
      </table>
    </div>`;
  vincularIngresosTabToggle();
  vincularBotonAyuda('ayuda-retiros');
  const inputMonto = document.getElementById('retiro-monto');
  const inputDescripcion = document.getElementById('retiro-descripcion');
  vincularFormatoMoneda(inputMonto);
  vincularCampoLimpiable(inputDescripcion);
  vincularSugeridasIngreso({
    idContenedor: 'retiro-sugerencias',
    inputDescripcion,
    selectCategoria: document.getElementById('retiro-categoria'),
    alElegir: () => {
      inputMonto.focus();
      inputMonto.select();
    },
    alSacar: () => renderRetirosPersonales(),
  });
  vincularSelectorFecha('retiro-fecha', fecha, (nueva) => {
    fechaRetiroForm = nueva || fechaHoyISO();
    renderRetirosPersonales();
  });
  vincularSelectorRango('filtro-rango-retiros', filtroIngresosDesde, filtroIngresosHasta, ({ desde, hasta }) => {
    filtroIngresosDesde = desde;
    filtroIngresosHasta = hasta;
    renderRetirosPersonales();
  });

  const pintarRetiros = () => {
    const q = normalizarTexto(busquedaRetiros.trim());
    const visibles = lista.filter((r) => !q || normalizarTexto(`${r.descripcion} ${r.categoria || ''} ${r.observacion || ''} ${r.cuenta}`).includes(q));
    const total = visibles.reduce((acc, r) => acc + r.monto, 0);
    document.getElementById('retiros-total').textContent = visibles.length ? `Total: $${formatearMoneda(total)}` : '';
    document.getElementById('retiros-body').innerHTML = visibles.length
      ? visibles
          .map(
            (r) => `<tr>
            <td>${formatearFechaCorta(r.fecha)}</td>
            <td>${esc(r.categoria || '')}</td>
            <td>${esc(r.descripcion)}${r.observacion ? `<div class="gasto-detalle-cheque">${esc(r.observacion)}</div>` : ''}${r.reintegrado ? `<div class="gasto-detalle-cheque">reintegro $${formatearMoneda(r.reintegrado)}</div>` : ''}</td>
            <td>${esc(r.cuenta)}</td>
            <td>$${formatearMoneda(r.monto)}</td>
            <td class="celda-centrada"><button type="button" class="btn-redondo btn-tacho quitar-retiro" data-id="${r.id}" aria-label="Quitar gasto: ${esc(r.descripcion)}" title="Quitar gasto">${TACHITO_SVG}</button></td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="6">No hay gastos en ese período.</td></tr>';
    app.querySelectorAll('.quitar-retiro').forEach((btn) => {
      btn.addEventListener('click', () => {
        const retiro = lista.find((r) => r.id === Number(btn.dataset.id));
        if (!retiro) return;
        mostrarModal(`${modalXHtml('modal-cancelar')}
          <h3>Quitar gasto</h3>
          <p>¿Seguro que querés quitar este gasto? La plata vuelve a la cuenta.</p>
          <p><strong>${esc(retiro.descripcion)}</strong> — $${formatearMoneda(retiro.monto)}</p>
          ${retiro.reintegrado ? `<p class="pin-subtitulo">Tiene reintegros por $${formatearMoneda(retiro.reintegrado)}: se quitan también.</p>` : ''}
          <div class="btn-group">
            <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, quitar</button>
          </div>
        `);
        document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
        document.getElementById('modal-confirmar').addEventListener('click', async () => {
          await window.freska.ingresos.eliminarRetiro(retiro.id);
          cerrarModal();
          mostrarToast('Gasto quitado.', 'ok');
          renderRetirosPersonales();
        });
      });
    });
  };
  document.getElementById('buscar-retiro').addEventListener('input', (e) => {
    busquedaRetiros = e.target.value;
    pintarRetiros();
  });
  document.getElementById('btn-limpiar-retiro').addEventListener('click', () => {
    fechaRetiroForm = null;
    categoriaRetiroForm = '';
    cuentaRetiroForm = '';
    renderRetirosPersonales();
  });
  const agregar = async () => {
    const errorEl = document.getElementById('error-retiro');
    const categoria = document.getElementById('retiro-categoria').value;
    const cuenta = document.getElementById('retiro-cuenta').value;
    const iso = fechaCortaAIso(document.getElementById('retiro-fecha').value);
    const resultado = !iso
      ? { ok: false, error: 'La fecha no es válida.' }
      : await window.freska.ingresos.crearRetiro({
          fecha: iso,
          categoria_id: categoria,
          descripcion: inputDescripcion.value,
          monto: limpiarNumeroMoneda(inputMonto.value),
          cuenta,
          observacion: document.getElementById('retiro-observacion').value,
        });
    if (!resultado.ok) {
      errorEl.textContent = resultado.error;
      errorEl.style.display = 'block';
      return;
    }
    categoriaRetiroForm = ''; // la categoría vuelve a "Elegí una…"; la cuenta queda
    cuentaRetiroForm = cuenta;
    mostrarToast('Gasto cargado.', 'ok');
    await renderRetirosPersonales();
    document.getElementById('retiro-descripcion')?.focus();
  };
  document.getElementById('btn-agregar-retiro').addEventListener('click', agregar);
  inputMonto.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    agregar();
  });
  pintarRetiros();
}

// Resultado: cuánto queda de cada categoría en el período (entró − gastó). Cada propiedad (Casa Norte, el local…) y la pensión
// son categorías: se cargan en la pastilla Categorías y se eligen al anotar un ingreso o un gasto.
async function renderResultadoPersonal() {
  if (!rangoIngresosIniciado) {
    rangoIngresosIniciado = true;
    const hoy = new Date();
    filtroIngresosDesde = primerDiaDelMes(hoy.getFullYear(), hoy.getMonth());
    filtroIngresosHasta = ultimoDiaDelMes(hoy.getFullYear(), hoy.getMonth());
  }
  const resultado = await window.freska.ingresos.resultado({ desde: filtroIngresosDesde, hasta: filtroIngresosHasta });
  const clase = (n) => (n < 0 ? 'saldo-negativo' : n > 0 ? 'texto-ganancia' : '');
  app.innerHTML = `
    <div class="gastos-pantalla">
      ${ingresosTabToggleHtml()}
      <div class="cierre-titulo-fila" style="margin-top:0">
        <h2>Resultado</h2>
        ${botonAyudaHtml('ayuda-resultado-personal', 'Resultado', '<p>Muestra, por cada categoría, lo que <em>entró</em> (ya sin la retención del banco), lo que <em>gastaste</em> y lo que <em>queda</em> en el período que elijas con el calendario (un mes, un año…).</p><p>Tocá una fila para ver los ingresos y retiros que la forman.</p><p>Si cargás cada propiedad como una categoría (Casa Norte, el local, el campo…) y la elegís al anotar un ingreso o un gasto, acá ves cuánto te deja cada una. La pensión también puede ser una categoría. Las categorías se agregan en la pastilla <em>Categorías</em>.</p><p>Más abajo, si cargaste gastos privados, hay una tabla aparte con lo que gastaste en cada categoría privada: no se mezclan con las propiedades.</p>', 'izquierda')}
      </div>
      <div class="toolbar toolbar-junta">
        ${selectorRangoHtml('filtro-rango-resultado', filtroIngresosDesde, filtroIngresosHasta)}
      </div>
      <table class="angosto tabla-fondos-resultado">
        <thead><tr><th>Categoría</th><th>Entró</th><th>Gastó</th><th>Queda</th></tr></thead>
        <tbody>
          ${
            resultado.filas.length
              ? resultado.filas
                  .map(
                    (f) => `<tr class="fila-clickeable fila-resultado" tabindex="0" data-id="${f.id === null ? '' : f.id}" data-nombre="${esc(f.nombre)}" title="Ver los movimientos de ${esc(f.nombre)}">
            <td>${esc(f.nombre)}</td>
            <td>${montoFondos(f.entro)}</td>
            <td>${montoFondos(f.gasto)}</td>
            <td class="${clase(f.deja)}"><strong>${montoFondos(f.deja)}</strong></td>
          </tr>`
                  )
                  .join('')
              : '<tr><td colspan="4">No hay ingresos ni gastos en ese período.</td></tr>'
          }
        </tbody>
        ${
          resultado.filas.length > 1
            ? `<tfoot><tr><td><strong>Total</strong></td><td>${montoFondos(resultado.total.entro)}</td><td>${montoFondos(resultado.total.gasto)}</td><td class="${clase(resultado.total.deja)}"><strong>${montoFondos(resultado.total.deja)}</strong></td></tr></tfoot>`
            : ''
        }
      </table>
      ${
        resultado.personales.filas.length
          ? `<h2>Gastos privados</h2>
      <table class="angosto tabla-fondos-resultado">
        <thead><tr><th>Categoría</th><th>Gastó</th></tr></thead>
        <tbody>
          ${resultado.personales.filas
            .map(
              (f) => `<tr class="fila-clickeable fila-resultado" tabindex="0" data-id="${f.id}" data-nombre="${esc(f.nombre)}" title="Ver los movimientos de ${esc(f.nombre)}">
            <td>${esc(f.nombre)}</td>
            <td>${montoFondos(f.gasto)}</td>
          </tr>`
            )
            .join('')}
        </tbody>
        ${resultado.personales.filas.length > 1 ? `<tfoot><tr><td><strong>Total</strong></td><td><strong>${montoFondos(resultado.personales.total)}</strong></td></tr></tfoot>` : ''}
      </table>`
          : ''
      }
    </div>`;
  vincularIngresosTabToggle();
  vincularBotonAyuda('ayuda-resultado-personal');
  // Tocar una fila abre los movimientos que la forman.
  app.querySelectorAll('.fila-resultado').forEach((fila) => {
    const abrir = () => abrirDetalleResultado(fila.dataset.id === '' ? null : Number(fila.dataset.id), fila.dataset.nombre);
    fila.addEventListener('click', abrir);
    fila.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === fila) abrir();
    });
  });
  vincularSelectorRango('filtro-rango-resultado', filtroIngresosDesde, filtroIngresosHasta, ({ desde, hasta }) => {
    filtroIngresosDesde = desde;
    filtroIngresosHasta = hasta;
    renderResultadoPersonal();
  });
}

// Los ingresos y gastos de una categoría en el período que se está viendo (lo que suma cada fila del Resultado).
async function abrirDetalleResultado(categoriaId, nombre) {
  const movs = await window.freska.ingresos.resultadoDetalle({ categoria_id: categoriaId, desde: filtroIngresosDesde, hasta: filtroIngresosHasta });
  let limite = MOVIMIENTOS_POR_PAGINA;
  const quedan = movs.reduce((a, m) => a + m.monto, 0);
  mostrarModal(`
    ${MODAL_X_HTML}
    <h3>${esc(nombre)}</h3>
    <p class="pin-subtitulo">${formatearFechaCorta(filtroIngresosDesde)} → ${formatearFechaCorta(filtroIngresosHasta)}</p>
    <div class="caja-movimientos">
      <table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Cuenta</th><th>Monto</th></tr></thead>
        <tbody id="det-resultado"></tbody>
        ${movs.length ? `<tfoot><tr><td colspan="4" style="text-align:right"><strong>Total</strong></td><td class="${quedan < 0 ? 'mov-sale' : 'mov-entra'}"><strong>${montoFondos(quedan)}</strong></td></tr></tfoot>` : ''}
      </table>
    </div>
    <p id="det-resultado-mas" style="text-align:center; margin:0 0 6px;" hidden><button type="button" id="btn-det-resultado-mas"></button></p>
  `);
  const pintar = () => {
    const mostrados = movs.slice(0, limite);
    document.getElementById('det-resultado').innerHTML = movs.length === 0
      ? '<tr><td colspan="5">No hay movimientos en ese período.</td></tr>'
      : mostrados
          .map(
            (m) => `<tr><td>${fechaLargaCierre(m.fecha)}</td><td class="${m.monto < 0 ? 'mov-sale' : 'mov-entra'}">${m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'}</td><td>${esc(m.descripcion)}${m.observacion ? `<div class="gasto-detalle-cheque">${esc(m.observacion)}</div>` : ''}${m.retencion ? `<div class="gasto-detalle-cheque">retención $${formatearMoneda(m.retencion)}</div>` : ''}</td><td>${m.cuenta ? esc(m.cuenta) : '<span class="texto-suave">—</span>'}</td><td class="${m.monto < 0 ? 'mov-sale' : 'mov-entra'}">$${formatearMoneda(Math.abs(m.monto))}</td></tr>`
          )
          .join('');
    const ocultos = movs.length - mostrados.length;
    document.getElementById('det-resultado-mas').hidden = ocultos <= 0;
    document.getElementById('btn-det-resultado-mas').textContent = `Ver más antiguos (${ocultos})`;
  };
  pintar();
  document.getElementById('btn-det-resultado-mas').addEventListener('click', () => {
    limite += MOVIMIENTOS_POR_PAGINA;
    pintar();
  });
  document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
}

// Cuentas: cuánta plata personal hay en cada una (lo del negocio está en la Caja) y los pases entre las dos partes.
async function renderCuentasPersonales() {
  const [saldos, resumen, pases, comprasDolares] = await Promise.all([
    window.freska.ingresos.saldos(),
    window.freska.cuentas.resumen(),
    window.freska.ingresos.pases(),
    window.freska.ingresos.comprasDolares(),
  ]);
  const dolares = saldos.dolares;
  app.innerHTML = `
    <div class="gastos-pantalla">
      ${ingresosTabToggleHtml()}
      <div class="cierre-titulo-fila" style="margin-top:0">
        <h2>Cuentas personales</h2>
        ${botonAyudaHtml('ayuda-cuentas-personales', 'Cuentas personales', '<p>Los bancos y apps son los mismos del negocio: la plata de cada una se divide en la parte <em>del negocio</em> y la <em>personal</em>. Acá ves solo la personal; la del negocio está en la <em>Caja</em>, que avisa cuánta plata personal hay de más en cada cuenta.</p><p><em>Efectivo personal</em> es un sobre aparte que nunca toca el cajón.</p><p>Los <em>dólares</em> son tu ahorro personal, aparte de los del negocio: con el <em>⋮</em> los comprás con plata de una cuenta personal o los ajustás (la cotización es la misma que la de la Caja). Suman al dinero disponible.</p><p><em>Ajustar</em> deja la parte personal en lo que tenés hoy. <em>Pasar plata</em> mueve plata entre el negocio y lo personal (por ejemplo, un retiro tuyo).</p>', 'izquierda')}
      </div>
      <div class="caja-cabecera">
        <div class="caja-total-panel">
          <div class="caja-total-fila">
            <span class="caja-total-titulo">Dinero disponible</span>
          </div>
          <div class="caja-total-monto-fila">
            <strong class="caja-total tapado" id="fondos-total-monto">${montoFondos(saldos.total)}</strong>
            <button type="button" id="btn-ver-monto-fondos" class="btn-ojo" aria-label="Mostrar el monto" title="Mostrar el monto">${ICONO_OJO}</button>
          </div>
        </div>
        <button type="button" id="btn-pase-personal" class="primary">Pasar plata</button>
      </div>
      <table class="angosto tabla-fondos-cuentas">
        <thead><tr><th>Cuenta</th><th>Personal</th><th></th></tr></thead>
        <tbody>
          ${saldos.cuentas
            .map(
              (c) => `<tr class="fila-clickeable fila-cuenta-personal" tabindex="0" data-cuenta="${esc(c.nombre)}" title="Ver los movimientos de ${esc(c.nombre)}">
            <td>${esc(c.nombre)}</td>
            <td>${montoFondos(c.saldo)}</td>
            <td class="celda-centrada"><button type="button" class="enlace-boton ajustar-cuenta-personal" data-cuenta="${esc(c.nombre)}" data-saldo="${c.saldo}">Ajustar</button></td>
          </tr>`
            )
            .join('')}
          <tr>
            <td>Dólares <span class="pin-subtitulo">(U$S ${formatearMoneda(dolares.usd)} × $${formatearMoneda(dolares.cotizacion)})</span></td>
            <td>${montoFondos(dolares.valor)}</td>
            <td class="celda-centrada"><div class="menu-fila"><button class="btn-menu-fila" type="button" aria-label="Acciones">⋮</button><div class="menu-fila-lista"><button type="button" class="item-menu" id="comprar-dolares-personal">Comprar dólares</button><button type="button" class="item-menu" id="ajustar-dolares-personal">Ajustar dólares y cotización</button></div></div></td>
          </tr>
        </tbody>
      </table>
      ${
        comprasDolares.length
          ? `<h2>Compras de dólares</h2>
      <table class="angosto tabla-fondos-pases">
        <thead><tr><th>Día</th><th>Compra</th><th>Monto</th><th></th></tr></thead>
        <tbody>
          ${comprasDolares
            .map(
              (c) => `<tr>
            <td>${formatearFechaCorta(c.fecha)}</td>
            <td>U$S ${formatearMoneda(c.usd)} a $${formatearMoneda(c.cotizacion)}<div class="gasto-detalle-cheque">Pagó con ${esc(c.cuenta)} (personal)</div></td>
            <td>$${formatearMoneda(c.monto)}</td>
            <td class="celda-centrada"><button type="button" class="btn-redondo btn-tacho quitar-compra-dolares" data-id="${c.id}" aria-label="Quitar compra de dólares" title="Quitar compra">${TACHITO_SVG}</button></td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>`
          : ''
      }
      <div class="cierre-titulo-fila">
        <h2>Pases con el negocio</h2>
        ${botonAyudaHtml('ayuda-saldo-pases', 'Pases con el negocio', '<p>Cada pase cuenta como plata prestada. Lo que pasás del negocio a lo personal lo debe lo personal; lo que pasás de lo personal al negocio lo debe el negocio. Acá se compensan y ves quién le debe a quién.</p><p>Si un pase fue plata que sacaste del negocio para vivir y no la vas a devolver, igual cuenta. Es solo un dato para vos: no cambia ninguna cuenta ni las estadísticas.</p>', 'izquierda')}
      </div>
      ${textoSaldoPases(saldos.saldoPases)}
      <table class="angosto tabla-fondos-pases">
        <thead><tr><th>Día</th><th>Pase</th><th>Monto</th><th></th></tr></thead>
        <tbody id="pases-body">
          ${
            pases.length
              ? pases
                  .map(
                    (p) => `<tr>
            <td>${formatearFechaCorta(p.fecha)}</td>
            <td>${p.sentido === 'a_personal' ? `${esc(p.cuenta_negocio)} (negocio) → ${esc(p.cuenta_personal)} (personal)` : `${esc(p.cuenta_personal)} (personal) → ${esc(p.cuenta_negocio)} (negocio)`}${p.nota ? `<div class="gasto-detalle-cheque">${esc(p.nota)}</div>` : ''}</td>
            <td>$${formatearMoneda(p.monto)}</td>
            <td class="celda-centrada"><button type="button" class="btn-redondo btn-tacho quitar-pase-personal" data-id="${p.id}" aria-label="Quitar pase" title="Quitar pase">${TACHITO_SVG}</button></td>
          </tr>`
                  )
                  .join('')
              : '<tr><td colspan="4">Todavía no hiciste pases.</td></tr>'
          }
        </tbody>
      </table>
    </div>`;
  vincularIngresosTabToggle();
  vincularBotonAyuda('ayuda-cuentas-personales');
  vincularBotonAyuda('ayuda-saldo-pases');
  vincularDevolverPases(saldos.saldoPases, renderCuentasPersonales);
  // Como en la Caja general: el monto arranca tapado cada vez que se entra, y el ojito lo muestra mientras esta pantalla siga abierta.
  document.getElementById('btn-ver-monto-fondos').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const tapado = document.getElementById('fondos-total-monto').classList.toggle('tapado');
    btn.innerHTML = tapado ? ICONO_OJO : ICONO_OJO_TACHADO;
    btn.setAttribute('aria-label', tapado ? 'Mostrar el monto' : 'Ocultar el monto');
    btn.setAttribute('title', tapado ? 'Mostrar el monto' : 'Ocultar el monto');
  });
  vincularMenuFila();
  document.getElementById('comprar-dolares-personal').addEventListener('click', () => abrirCompraDolaresPersonal(saldos.cuentas.map((c) => c.nombre), dolares.cotizacion));
  document.getElementById('ajustar-dolares-personal').addEventListener('click', () => abrirAjusteDolaresPersonal(dolares));
  app.querySelectorAll('.quitar-compra-dolares').forEach((btn) =>
    btn.addEventListener('click', () => {
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Quitar compra de dólares</h3>
        <p>¿Seguro? Los pesos vuelven a la cuenta y se sacan esos dólares.</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, quitar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        await window.freska.ingresos.eliminarCompraDolares(Number(btn.dataset.id));
        cerrarModal();
        mostrarToast('Compra quitada.', 'ok');
        renderCuentasPersonales();
      });
    })
  );
  document.getElementById('btn-pase-personal').addEventListener('click', () => abrirPasePersonal(resumen.cuentas.map((c) => c.nombre), saldos.cuentas.map((c) => c.nombre)));
  app.querySelectorAll('.ajustar-cuenta-personal').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // no abre además el historial de la fila
      abrirAjusteCuentaPersonal(btn.dataset.cuenta, Number(btn.dataset.saldo));
    })
  );
  // Tocar una cuenta muestra su historial, como en la Caja general.
  const cuentasNegocio = resumen.cuentas.map((c) => c.nombre);
  const cuentasPersonales = saldos.cuentas.map((c) => c.nombre);
  app.querySelectorAll('.fila-cuenta-personal').forEach((fila) => {
    const abrir = () => abrirMovimientosPersonales(fila.dataset.cuenta, cuentasNegocio, cuentasPersonales);
    fila.addEventListener('click', abrir);
    fila.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === fila) abrir();
    });
  });
  app.querySelectorAll('.quitar-pase-personal').forEach((btn) => {
    btn.addEventListener('click', () => {
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Quitar pase</h3>
        <p>¿Seguro? La plata vuelve a donde estaba antes del pase.</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, quitar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        await window.freska.ingresos.eliminarPase(Number(btn.dataset.id));
        cerrarModal();
        mostrarToast('Pase quitado.', 'ok');
        renderCuentasPersonales();
      });
    });
  });
}

// Lo que se deben el negocio y lo personal por los pases (`saldoPases` de `ingresos:saldos` y de `cuentas:resumen`). Se usa en
// Fondos personales → Cuentas y en la Caja general; si están a mano, no dice nada.
function textoSaldoPases(saldoPases) {
  if (!saldoPases || !saldoPases.cantidad) return '';
  const neto = saldoPases.neto;
  if (neto === 0) return ''; // a mano: no se dice nada
  return `<p class="saldo-pases">${neto > 0 ? 'El negocio le debe' : 'Lo personal le debe al negocio'} <strong>$${formatearMoneda(Math.abs(neto))}</strong>${neto > 0 ? ' a lo personal' : ''}. <button type="button" class="enlace-boton btn-devolver-pases">Devolver</button></p>`;
}

// Engancha el botón "Devolver" de la línea de deuda: abre Pasar plata ya completo (todo el monto, el sentido contrario al que
// creó la deuda y las cuentas del último pase que la generó). Al guardar, `alTerminar` vuelve a dibujar la pantalla.
function vincularDevolverPases(saldoPases, alTerminar) {
  const boton = app.querySelector('.btn-devolver-pases');
  if (!boton || !saldoPases || !saldoPases.devolver) return;
  boton.addEventListener('click', async () => {
    const [saldos, resumen] = await Promise.all([window.freska.ingresos.saldos(), window.freska.cuentas.resumen()]);
    const d = saldoPases.devolver;
    abrirPasePersonal(
      resumen.cuentas.map((c) => c.nombre),
      saldos.cuentas.map((c) => c.nombre),
      { titulo: 'Devolver plata', boton: 'Devolver', monto: d.monto, sentido: d.sentido, cuentaNegocio: d.cuenta_negocio, cuentaPersonal: d.cuenta_personal, nota: 'Devolución' },
      alTerminar
    );
  });
}

// Los dólares personales (ahorro): cuántos son y a cuánto se valúan hoy. La cotización es la misma que la de la Caja.
function abrirAjusteDolaresPersonal(dolares) {
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Dólares personales</h3>
    <p class="pin-subtitulo">La cotización es la misma que la de la Caja.</p>
    <div class="op-form">
      <label class="op-campo op-completo"><span>Dólares (U$S)</span><div class="input-moneda"><span>U$S</span><input type="text" inputmode="decimal" id="dolares-usd" value="${esc(dolares.usd ? formatearMoneda(dolares.usd) : '')}" placeholder="0" autocomplete="off" /></div></label>
      <label class="op-campo op-completo"><span>Cotización de hoy</span><div class="input-moneda"><span>$</span><input type="text" inputmode="decimal" id="dolares-cotizacion" value="${esc(dolares.cotizacion ? formatearMoneda(dolares.cotizacion) : '')}" placeholder="0" autocomplete="off" /></div></label>
    </div>
    <p id="modal-error" class="error-msg" style="display:none"></p>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary">Guardar</button>
    </div>
  `);
  const usd = document.getElementById('dolares-usd');
  const cot = document.getElementById('dolares-cotizacion');
  vincularFormatoMoneda(usd);
  vincularFormatoMoneda(cot);
  usd.focus();
  usd.select();
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  const guardar = async () => {
    const r = await window.freska.ingresos.guardarDolares({ dolares_usd: limpiarNumeroMoneda(usd.value) || 0, cotizacion: limpiarNumeroMoneda(cot.value) || 0 });
    if (!r.ok) {
      const e = document.getElementById('modal-error');
      e.textContent = r.error;
      e.style.display = '';
      return;
    }
    cerrarModal();
    mostrarToast('Dólares actualizados.', 'ok');
    renderCuentasPersonales();
  };
  document.getElementById('modal-confirmar').addEventListener('click', guardar);
  [usd, cot].forEach((input) =>
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') guardar();
    })
  );
}

// Comprar dólares con plata de una cuenta personal: resta los pesos de esa cuenta y suma los dólares (no es ingreso ni gasto).
function abrirCompraDolaresPersonal(cuentasPersonales, cotizacionActual) {
  const fila = (etiqueta, html, completo) => `<label class="op-campo ${completo ? 'op-completo' : ''}"><span>${etiqueta}</span>${html}</label>`;
  const moneda = (id, valor, simbolo = '$') => `<div class="input-moneda"><span>${simbolo}</span><input type="text" inputmode="decimal" id="${id}" value="${esc(valor || '')}" autocomplete="off" /></div>`;
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Comprar dólares</h3>
    <div class="op-form">
      <div class="op-campo"><span>Fecha</span>${selectorFechaHtml('dolares-fecha', fechaHoyISO())}</div>
      ${fila('Pagó con', `<select id="dolares-cuenta">${opcionesCuentaHtml(cuentasPersonales, cuentasPersonales[0])}</select>`)}
      ${fila('Dólares', moneda('dolares-comprados', '', 'U$S'))}
      ${fila('Cotización', moneda('dolares-cot-compra', cotizacionActual ? formatearMoneda(cotizacionActual) : ''))}
      <p class="pin-subtitulo op-completo" id="dolares-total-pesos"></p>
    </div>
    <p id="modal-error" class="error-msg" style="display:none"></p>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary">Comprar</button>
    </div>
  `);
  vincularSelectorFecha('dolares-fecha', fechaHoyISO(), (nueva) => {
    document.getElementById('dolares-fecha').value = formatearFechaCorta(nueva || fechaHoyISO());
  });
  const num = (id) => limpiarNumeroMoneda(document.getElementById(id).value);
  ['dolares-comprados', 'dolares-cot-compra'].forEach((id) => {
    vincularFormatoMoneda(document.getElementById(id));
    document.getElementById(id).addEventListener('input', () => {
      const total = (num('dolares-comprados') || 0) * (num('dolares-cot-compra') || 0);
      document.getElementById('dolares-total-pesos').textContent = total > 0 ? `Son $${formatearMoneda(Math.round(total * 100) / 100)}` : '';
    });
  });
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    const r = await window.freska.ingresos.comprarDolares({
      fecha: fechaCortaAIso(document.getElementById('dolares-fecha').value),
      cuenta: document.getElementById('dolares-cuenta').value,
      usd: num('dolares-comprados'),
      cotizacion: num('dolares-cot-compra'),
    });
    if (!r.ok) {
      const e = document.getElementById('modal-error');
      e.textContent = r.error;
      e.style.display = '';
      return;
    }
    cerrarModal();
    mostrarToast('Dólares comprados.', 'ok');
    renderCuentasPersonales();
  });
}

function abrirAjusteCuentaPersonal(cuenta, saldoActual) {
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Ajustar ${esc(cuenta)}</h3>
    <p class="pin-subtitulo">¿Cuánta plata personal hay hoy en esta cuenta?</p>
    <div class="op-form">
      <label class="op-campo op-completo"><span>Plata personal</span><div class="input-moneda"><span>$</span><input type="text" inputmode="decimal" id="ajuste-saldo" value="${esc(formatearMoneda(saldoActual))}" autocomplete="off" /></div></label>
    </div>
    <p id="modal-error" class="error-msg" style="display:none"></p>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary">Guardar</button>
    </div>
  `);
  const input = document.getElementById('ajuste-saldo');
  vincularFormatoMoneda(input);
  input.focus();
  input.select();
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  const guardar = async () => {
    const r = await window.freska.ingresos.ajustarSaldo({ cuenta, saldo: limpiarNumeroMoneda(input.value) });
    if (!r.ok) {
      const e = document.getElementById('modal-error');
      e.textContent = r.error;
      e.style.display = '';
      return;
    }
    cerrarModal();
    mostrarToast('Saldo ajustado.', 'ok');
    renderCuentasPersonales();
  };
  document.getElementById('modal-confirmar').addEventListener('click', guardar);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') guardar();
  });
}

// Pasar plata entre el negocio y lo personal. Mismo cuadro que "Pasar plata" de la Caja (De / A / Invertir De y A): las
// cuentas se muestran con su lado ("Mercado Pago (negocio)", "Mercado Pago (personal)") y "A" ofrece solo las del otro lado,
// porque un pase siempre va de una parte a la otra. `previo` lo completa (para devolver una deuda): título, texto del botón,
// monto, sentido, cuentas y nota. Al guardar llama a `alTerminar`.
function abrirPasePersonal(cuentasNegocio, cuentasPersonales, previo = {}, alTerminar = renderCuentasPersonales) {
  const fila = (etiqueta, html, completo) => `<label class="op-campo ${completo ? 'op-completo' : ''}"><span>${etiqueta}</span>${html}</label>`;
  const cuentas = [
    ...cuentasNegocio.map((nombre) => ({ lado: 'negocio', nombre, valor: `negocio|${nombre}`, etiqueta: `${nombre} (negocio)` })),
    ...cuentasPersonales.map((nombre) => ({ lado: 'personal', nombre, valor: `personal|${nombre}`, etiqueta: nombre === 'Efectivo personal' ? nombre : `${nombre} (personal)` })),
  ];
  // Las cuentas van divididas en dos grupos con título (Negocio / Personal); cada una conserva su lado en el texto para que se
  // entienda también con la lista cerrada.
  const opciones = (lista, elegida) =>
    [['negocio', 'Negocio'], ['personal', 'Personal']]
      .map(([lado, titulo]) => {
        const propias = lista.filter((c) => c.lado === lado);
        return propias.length ? `<optgroup label="${titulo}">${propias.map((c) => `<option value="${esc(c.valor)}" ${c.valor === elegida ? 'selected' : ''}>${esc(c.etiqueta)}</option>`).join('')}</optgroup>` : '';
      })
      .join('');
  const negocioInicial = `negocio|${cuentasNegocio.includes(previo.cuentaNegocio) ? previo.cuentaNegocio : 'Efectivo'}`;
  const personalInicial = `personal|${cuentasPersonales.includes(previo.cuentaPersonal) ? previo.cuentaPersonal : cuentasPersonales[0]}`;
  const deInicial = previo.sentido === 'al_negocio' ? personalInicial : negocioInicial;
  const aInicial = previo.sentido === 'al_negocio' ? negocioInicial : personalInicial;
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>${esc(previo.titulo || 'Pasar plata')}</h3>
    <div class="op-form">
      <div class="op-campo"><span>Fecha</span>${selectorFechaHtml('pase-fecha', fechaHoyISO())}</div>
      ${fila('Monto', `<div class="input-moneda"><span>$</span><input type="text" inputmode="decimal" id="pase-monto" value="${esc(previo.monto ? formatearMoneda(previo.monto) : '')}" autocomplete="off" /></div>`)}
      <div class="op-completo op-de-a">${fila('De', `<select id="pase-origen">${opciones(cuentas, deInicial)}</select>`)}${fila('A', '<select id="pase-destino"></select>')}</div>
      <p class="op-completo op-invertir-fila"><button type="button" id="pase-invertir" class="enlace-boton">Invertir De y A</button></p>
      ${fila('Nota', `<input type="text" id="pase-nota" placeholder="Opcional" maxlength="200" value="${esc(previo.nota || '')}" autocomplete="off" />`, true)}
    </div>
    <p id="modal-error" class="error-msg" style="display:none"></p>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary">${esc(previo.boton || 'Pasar')}</button>
    </div>
  `);
  const valor = (id) => document.getElementById(id).value;
  // "A" ofrece solo las cuentas del otro lado que "De".
  const pintarDestino = (preferido) => {
    const destino = document.getElementById('pase-destino');
    const ladoOrigen = valor('pase-origen').split('|')[0];
    const posibles = cuentas.filter((c) => c.lado !== ladoOrigen);
    const anterior = preferido || destino.value;
    destino.innerHTML = opciones(posibles, posibles.some((c) => c.valor === anterior) ? anterior : posibles[0] && posibles[0].valor);
  };
  document.getElementById('pase-origen').addEventListener('change', () => pintarDestino());
  pintarDestino(aInicial);
  // La flecha intercambia De y A (por ejemplo, un pase y su devolución).
  document.getElementById('pase-invertir').addEventListener('click', () => {
    const antesOrigen = valor('pase-origen');
    const antesDestino = valor('pase-destino');
    document.getElementById('pase-origen').value = antesDestino;
    pintarDestino(antesOrigen);
  });
  vincularSelectorFecha('pase-fecha', fechaHoyISO(), (nueva) => {
    document.getElementById('pase-fecha').value = formatearFechaCorta(nueva || fechaHoyISO());
  });
  vincularFormatoMoneda(document.getElementById('pase-monto'));
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    const [ladoDe, nombreDe] = [valor('pase-origen').split('|')[0], valor('pase-origen').slice(valor('pase-origen').indexOf('|') + 1)];
    const nombreA = valor('pase-destino').slice(valor('pase-destino').indexOf('|') + 1);
    const deNegocio = ladoDe === 'negocio';
    const r = await window.freska.ingresos.crearPase({
      fecha: fechaCortaAIso(document.getElementById('pase-fecha').value),
      monto: limpiarNumeroMoneda(document.getElementById('pase-monto').value),
      sentido: deNegocio ? 'a_personal' : 'al_negocio',
      cuenta_negocio: deNegocio ? nombreDe : nombreA,
      cuenta_personal: deNegocio ? nombreA : nombreDe,
      nota: document.getElementById('pase-nota').value,
    });
    if (!r.ok) {
      const e = document.getElementById('modal-error');
      e.textContent = r.error;
      e.style.display = '';
      return;
    }
    cerrarModal();
    mostrarToast(previo.boton === 'Devolver' ? 'Listo, la plata se devolvió.' : 'Listo, la plata se pasó.', 'ok');
    alTerminar();
  });
}


// El historial de una cuenta personal (como el de la Caja general): cada movimiento con el saldo personal que fue quedando.
async function abrirMovimientosPersonales(nombre, cuentasNegocio, cuentasPersonales) {
  const movs = await window.freska.ingresos.movimientos(nombre);
  const saldoActual = movs.length ? movs[0].saldo : 0;
  let limite = MOVIMIENTOS_POR_PAGINA;
  mostrarModal(`
    ${MODAL_X_HTML}
    <h3>${esc(nombre)}</h3>
    <div class="acciones-detalle-cuenta">
      <button type="button" id="det-ajustar-personal">Ajustar saldo</button>
      <button type="button" id="det-pasar-personal">Pasar plata</button>
    </div>
    <div class="caja-movimientos">
      <table>
        <thead><tr><th>Fecha</th><th>Detalle</th><th>Monto</th><th>Saldo</th></tr></thead>
        <tbody id="det-movimientos-personal"></tbody>
      </table>
    </div>
    <p id="det-ver-mas-personal" style="text-align:center; margin:0 0 6px;" hidden><button type="button" id="btn-det-ver-mas-personal"></button></p>
  `);
  const pintar = () => {
    const mostrados = movs.slice(0, limite);
    document.getElementById('det-movimientos-personal').innerHTML = movs.length === 0
      ? '<tr><td colspan="4">Todavía no hay movimientos personales en esta cuenta.</td></tr>'
      : mostrados
          .map((m) => `<tr><td>${fechaLargaCierre(m.fecha)}</td><td>${esc(m.detalle)}</td><td class="${m.monto < 0 ? 'mov-sale' : 'mov-entra'}">$${formatearMoneda(Math.abs(m.monto))}</td><td>${montoFondos(m.saldo)}</td></tr>`)
          .join('');
    const ocultos = movs.length - mostrados.length;
    document.getElementById('det-ver-mas-personal').hidden = ocultos <= 0;
    document.getElementById('btn-det-ver-mas-personal').textContent = `Ver más antiguos (${ocultos})`;
  };
  pintar();
  document.getElementById('btn-det-ver-mas-personal').addEventListener('click', () => {
    limite += MOVIMIENTOS_POR_PAGINA;
    pintar();
  });
  document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
  document.getElementById('det-ajustar-personal').addEventListener('click', () => abrirAjusteCuentaPersonal(nombre, saldoActual));
  document.getElementById('det-pasar-personal').addEventListener('click', () => {
    cerrarModal();
    abrirPasePersonal(cuentasNegocio, cuentasPersonales);
  });
}
