// Gastos, categorías y descripciones sugeridas.
// (Antes todo estaba en renderer.js; se dividió por pantalla el 2026-09-24. Los archivos son scripts comunes que
// comparten el mismo espacio global: se cargan en el orden de index.html y no hace falta importar nada.)

// Gasto que se está cargando ({ fecha, categoria, descripcion, monto, medio, banco, numero, fechaCheque }).
let camposGasto = null;
// Gasto ya cargado que se está corrigiendo en el formulario (o null) y lo escrito mientras se corrige.
// Es un borrador aparte de `camposGasto`: así lo que se estaba tipeando para un gasto nuevo no se pierde
// ni se mezcla.
let gastoEditando = null;
let camposGastoEdicion = null;
let mostrarFormGasto = true;
// Categoría cuyo campo de "nueva descripción" está abierto en la vista Categorías (el "+" lo abre; queda
// abierto para cargar varias).
let descripcionAbiertaCategoria = null;

// Descripciones sugeridas de los gastos (las mismas para la pantalla Gastos y para los retiros del
// Cierre de caja: un retiro es un gasto en efectivo). Con una categoría elegida se ven las de esa
// categoría (las usadas primero); sin categoría ni texto no se muestra ninguna; al escribir se buscan
// entre todas, con las de la categoría elegida primero. Tocar una completa la descripción y su
// categoría; la × la saca de la lista (con confirmación).
// Una misma descripción puede estar en varias categorías: en ese caso el chip dice de cuál es (en chiquito).
function sugeridasDescripcionesHtml(descripciones, idContenedor) {
  if (!descripciones.length) return '';
  const veces = {};
  descripciones.forEach((d) => {
    const k = normalizarTexto(d.nombre);
    veces[k] = (veces[k] || 0) + 1;
  });
  return `<div class="retiro-sugerencias" id="${idContenedor}">
    ${descripciones
      .map(
        (d) => `<span class="chip-retiro-grupo" data-concepto="${esc(d.nombre)}" data-categoria="${d.categoria_id || ''}" data-orden="${d.orden}" data-monto="${d.ultimo_monto || ''}" data-medio="${esc(d.ultimo_medio || '')}" data-cuenta="${esc(d.ultima_cuenta || '')}"><button type="button" class="chip-retiro">${esc(d.nombre)}${veces[normalizarTexto(d.nombre)] > 1 && d.categoria_nombre ? ` <span class="etiqueta-gasto">${esc(d.categoria_nombre)}</span>` : ''}</button><button type="button" class="chip-retiro-x" data-id="${d.id}" aria-label="Sacar ${esc(d.nombre)} de las descripciones" title="Sacar de las descripciones">×</button></span>`
      )
      .join('')}
  </div>`;
}

// Las descripciones sugeridas se muestran como lista flotante debajo del casillero Descripción (no ocupan lugar en el
// formulario). Se abre al tocar el casillero, al escribir o al elegir la categoría (si hay algo para mostrar: `filtrar`
// ya dejó el contenedor oculto cuando no hay). Se cierra con Esc, Tab, al elegir una o al tocar afuera; ↑ ↓ y Enter eligen.
function vincularDesplegableSugeridas(contenedor, inputDescripcion, selectCategoria) {
  contenedor.classList.add('desplegable-sugeridas');
  const campo = contenedor.parentElement;
  const filas = () => Array.from(contenedor.querySelectorAll('.chip-retiro-grupo')).filter((c) => !c.hidden);
  const marcar = (i) => {
    const lista = filas();
    lista.forEach((c, j) => c.classList.toggle('activo', j === i));
    contenedor.dataset.activo = String(i);
    if (lista[i]) lista[i].scrollIntoView({ block: 'nearest' });
  };
  const abrir = () => {
    if (!contenedor.hidden) contenedor.classList.add('abierto');
  };
  const cerrar = () => {
    contenedor.classList.remove('abierto');
    marcar(-1);
  };
  inputDescripcion.addEventListener('focus', abrir);
  inputDescripcion.addEventListener('input', () => {
    marcar(-1);
    abrir();
  });
  selectCategoria.addEventListener('change', () => {
    marcar(-1);
    abrir();
  });
  inputDescripcion.addEventListener('keydown', (e) => {
    const lista = filas();
    const actual = Number(contenedor.dataset.activo || -1);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!lista.length) return;
      e.preventDefault();
      if (!contenedor.classList.contains('abierto')) return abrir();
      marcar(e.key === 'ArrowDown' ? Math.min(actual + 1, lista.length - 1) : Math.max(actual - 1, 0));
    } else if (e.key === 'Enter' && contenedor.classList.contains('abierto') && lista[actual]) {
      e.preventDefault();
      lista[actual].querySelector('.chip-retiro').click();
    } else if (e.key === 'Escape' && contenedor.classList.contains('abierto')) {
      e.stopPropagation();
      cerrar();
    } else if (e.key === 'Tab') {
      cerrar();
    }
  });
  // Tocar la lista no le saca el foco al casillero.
  contenedor.addEventListener('mousedown', (e) => e.preventDefault());
  contenedor.querySelectorAll('.chip-retiro').forEach((b) => b.addEventListener('click', cerrar));
  document.addEventListener('mousedown', (e) => {
    if (!document.body.contains(contenedor)) return;
    if (!campo.contains(e.target)) cerrar();
  });
}

function vincularSugeridasDescripcion({ idContenedor, inputDescripcion, selectCategoria, alElegir, alSacar }) {
  const contenedor = document.getElementById(idContenedor);
  if (!contenedor) return;
  const chips = Array.from(contenedor.querySelectorAll('.chip-retiro-grupo'));
  const filtrar = () => {
    const q = normalizarTexto(inputDescripcion.value.trim());
    const categoria = selectCategoria.value;
    const deLaCategoria = (chip) => categoria && chip.dataset.categoria === categoria;
    const candidatos = chips.filter((chip) => {
      if (q) return normalizarTexto(chip.dataset.concepto).includes(q);
      return categoria ? deLaCategoria(chip) : false;
    });
    // Las de la categoría elegida primero; el resto conserva el orden (las más usadas arriba).
    candidatos.sort((a, b) => Number(deLaCategoria(b)) - Number(deLaCategoria(a)));
    const limite = categoria ? CHIPS_GASTO_CATEGORIA : CHIPS_GASTO_VISIBLES;
    const visibles = new Set(candidatos.slice(0, limite));
    chips.forEach((chip) => {
      chip.hidden = !visibles.has(chip);
    });
    contenedor.append(...candidatos.slice(0, limite));
    contenedor.hidden = visibles.size === 0;
  };
  filtrar();
  inputDescripcion.addEventListener('input', filtrar);
  selectCategoria.addEventListener('change', filtrar);
  chips.forEach((chip) => {
    chip.querySelector('.chip-retiro').addEventListener('click', () => {
      inputDescripcion.value = chip.dataset.concepto;
      if (chip.dataset.categoria) selectCategoria.value = chip.dataset.categoria;
      filtrar();
      alElegir(chip);
    });
    chip.querySelector('.chip-retiro-x').addEventListener('click', () => {
      const id = Number(chip.querySelector('.chip-retiro-x').dataset.id);
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Sacar descripción</h3>
        <p>¿Sacar <strong>${esc(chip.dataset.concepto)}</strong> de las descripciones sugeridas?</p>
        <p class="pin-subtitulo">Se saca solo de esta categoría. Los gastos que ya cargaste con esa descripción no se borran. Si volvés a cargar uno, reaparece.</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, sacar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        await window.freska.gastos.quitarDescripcion(id);
        cerrarModal();
        mostrarToast('Descripción sacada.', 'ok');
        alSacar();
      });
    });
  });
  vincularDesplegableSugeridas(contenedor, inputDescripcion, selectCategoria);
}

// ---------- Gastos (indirectos) ----------
// "Débito / Tarjeta" es el de antes de separar débito y crédito: solo se ofrece al corregir un gasto que ya lo tenía.
const MEDIOS_GASTO = ['Efectivo', 'Transferencia', 'Cheque', 'Débito', 'Crédito', 'Débito / Tarjeta'];
const MEDIO_GASTO_VIEJO = 'Débito / Tarjeta';
// Con transferencia o débito se elige de qué cuenta (banco o app) salió la plata; el crédito no sale de ninguna
// cuenta hasta que se paga el resumen de la tarjeta.
const medioUsaCuenta = (medio) => medio === 'Transferencia' || medio === 'Débito' || medio === MEDIO_GASTO_VIEJO;
// Con débito o crédito se anota (opcional) cuál tarjeta; en crédito, además, las cuotas.
const medioUsaTarjeta = (medio) => medio === 'Débito' || medio === 'Crédito' || medio === MEDIO_GASTO_VIEJO;
const CUOTAS_GASTO = [1, 2, 3, 6, 9, 12, 18, 24];
const GASTOS_POR_PAGINA = 30;
const CHIPS_GASTO_VISIBLES = 6;
const CHIPS_GASTO_CATEGORIA = 10;
let vistaGastosTab = 'gastos';
let mostrarFormCategoriaGasto = null; // null, 'negocio' o 'personal': en qué grupo se está agregando una categoría
let filtroGastosDesde = '';
let filtroGastosHasta = '';
let rangoGastosIniciado = false;
let busquedaGastos = '';
let filtroMedioGastos = 'todos'; // 'todos' o una forma de pago
let limiteGastos = GASTOS_POR_PAGINA;

function gastosTabToggleHtml() {
  return `
    ${negocioToggleHtml('gastos')}
    <div class="reportes-toggle">
      <button type="button" class="toggle ${vistaGastosTab === 'gastos' ? 'active' : ''}" data-gastos-tab="gastos">Gastos</button>
      <button type="button" class="toggle ${vistaGastosTab === 'categorias' ? 'active' : ''}" data-gastos-tab="categorias">Categorías</button>
    </div>`;
}

function vincularGastosTabToggle() {
  vincularNegocioToggle();
  app.querySelectorAll('.toggle[data-gastos-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      vistaGastosTab = btn.dataset.gastosTab;
      renderGastos();
    });
  });
}

// Cómo se ve un cheque de la cartera en el desplegable: "Galicia · N° 00123 · $150.000 · cobra 15/10/2026".
function textoChequeOpcion(ch) {
  return [ch.banco, `N° ${ch.numero}`, `$${formatearMoneda(ch.importe)}`, ch.fecha_cobro ? `cobra ${formatearFechaCorta(ch.fecha_cobro)}` : '']
    .filter(Boolean)
    .join(' · ');
}

function terminarEdicionGasto() {
  gastoEditando = null;
  camposGastoEdicion = null;
}

function detalleChequeTexto(g) {
  return [g.cheque_banco, g.cheque_numero ? `N° ${g.cheque_numero}` : '', g.cheque_fecha ? `cobra ${formatearFechaCorta(g.cheque_fecha)}` : '']
    .filter(Boolean)
    .join(' · ');
}

// Debajo de la forma de pago: la cuenta de la que salió, la tarjeta y, en crédito, las cuotas.
function detallePagoGasto(g) {
  const partes = [];
  if (g.cuenta) partes.push(g.cuenta);
  if (g.tarjeta) partes.push(g.tarjeta);
  if (g.medio_pago === 'Crédito' && g.cuotas) {
    partes.push(g.cuotas === 1 ? '1 pago' : `${g.cuotas} cuotas de $${formatearMoneda(redondearPesos(g.monto / g.cuotas))}`);
    partes.push(`${g.cuotas_pagadas || 0} de ${g.cuotas} pagadas`);
  }
  return partes.length ? `<div class="gasto-detalle-cheque">${esc(partes.join(' · '))}</div>` : '';
}

// Las cuotas de un gasto en crédito: cuáles se pagaron (y con qué cuenta) y las que faltan, con el botón para pagar
// cada una. Pagar una saca la plata de esa cuenta ese día y cuenta como gasto en las estadísticas.
async function abrirCuotasGasto(gasto, cuentasBanco, alCambiar) {
  const cuotas = await window.freska.gastos.cuotas(gasto.id);
  mostrarModal(`${MODAL_X_HTML}
    <h3>Cuotas: ${esc(gasto.descripcion)}</h3>
    <p class="pin-subtitulo">${esc([gasto.tarjeta, `$${formatearMoneda(gasto.monto)} en ${gasto.cuotas} cuotas`].filter(Boolean).join(' · '))}</p>
    <div class="cuotas-lista">
      ${cuotas
        .map(
          (c) => `<div class="cuota-fila">
        <span>Cuota ${c.numero} de ${cuotas.length}</span>
        <span>$${formatearMoneda(c.monto)}</span>
        <span class="${c.fecha_pago ? 'cuota-pagada' : 'texto-suave'}">${c.fecha_pago ? `Pagada el ${fechaLargaCierre(c.fecha_pago)} · ${esc(c.cuenta || '')}` : 'Pendiente'}</span>
        ${c.fecha_pago ? `<button type="button" class="deshacer-cuota" data-id="${c.id}">Deshacer</button>` : `<button type="button" class="primary pagar-cuota" data-id="${c.id}">Pagar</button>`}
      </div>`
        )
        .join('')}
    </div>
  `);
  document.getElementById('modal-cerrar').addEventListener('click', () => {
    cerrarModal();
    alCambiar();
  });
  document.querySelectorAll('.deshacer-cuota').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.freska.gastos.deshacerCuota(Number(btn.dataset.id));
      abrirCuotasGasto(gasto, cuentasBanco, alCambiar);
    });
  });
  document.querySelectorAll('.pagar-cuota').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cuota = cuotas.find((c) => c.id === Number(btn.dataset.id));
      let fecha = fechaHoyISO();
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Pagar la cuota ${cuota.numero} de ${cuotas.length}</h3>
        <p>$${formatearMoneda(cuota.monto)} — ${esc(gasto.descripcion)}${gasto.tarjeta ? ` (${esc(gasto.tarjeta)})` : ''}</p>
        <div class="gasto-fila">
          <div class="gasto-campo"><span>Fecha</span>${selectorFechaHtml('cuota-fecha', fecha)}</div>
          <label class="gasto-campo"><span>De qué cuenta</span>
            <select id="cuota-cuenta"><option value="">Elegí una…</option>${cuentasBanco.map((n) => `<option ${n === gasto.cuenta ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
          </label>
        </div>
        <p id="modal-error" class="error-msg" style="display:none"></p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary">Pagar cuota</button>
        </div>
      `);
      vincularSelectorFecha('cuota-fecha', fecha, (nueva) => {
        fecha = nueva || fechaHoyISO();
        document.getElementById('cuota-fecha').value = formatearFechaCorta(fecha);
      });
      document.getElementById('modal-cancelar').addEventListener('click', () => abrirCuotasGasto(gasto, cuentasBanco, alCambiar));
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        const r = await window.freska.gastos.pagarCuota({ id: cuota.id, fecha, cuenta: document.getElementById('cuota-cuenta').value });
        if (!r.ok) {
          const e = document.getElementById('modal-error');
          e.textContent = r.error;
          e.style.display = '';
          return;
        }
        mostrarToast('Cuota pagada.', 'ok');
        abrirCuotasGasto(gasto, cuentasBanco, alCambiar);
      });
    });
  });
}

function detalleChequeGasto(g) {
  if (g.medio_pago !== 'Cheque') return '';
  const texto = detalleChequeTexto(g);
  return texto ? `<div class="gasto-detalle-cheque">${esc(texto)}</div>` : '';
}

async function renderGastos() {
  if (vistaGastosTab === 'categorias') {
    await renderCategoriasGasto();
    return;
  }
  if (!rangoGastosIniciado) {
    const hoy = new Date();
    filtroGastosDesde = primerDiaDelMes(hoy.getFullYear(), hoy.getMonth());
    filtroGastosHasta = ultimoDiaDelMes(hoy.getFullYear(), hoy.getMonth());
    rangoGastosIniciado = true;
  }
  const [categorias, descripciones, gastos, chequesCartera, resumenCuentas, tarjetasTodas, cuotasPendientesTodas] = await Promise.all([
    window.freska.gastos.categorias(),
    window.freska.gastos.descripciones(),
    window.freska.gastos.listar({ desde: filtroGastosDesde, hasta: filtroGastosHasta }),
    window.freska.cheques.listar({ estado: 'en_cartera' }),
    window.freska.cuentas.resumen(),
    window.freska.tarjetas.listar(),
    window.freska.gastos.cuotasPendientes(),
  ]);
  const hayCuotasPendientes = cuotasPendientesTodas.length > 0;
  // Lo que hay en cada cuenta (si la Caja general ya está cargada): se muestra al elegir con qué se paga.
  const saldosCuentas = {};
  if (resumenCuentas.configurado) resumenCuentas.cuentas.forEach((cu) => (saldosCuentas[cu.nombre] = cu.saldo));
  // Las cuentas de las que puede salir un gasto pagado por transferencia o débito (todas menos el efectivo).
  const cuentasBanco = resumenCuentas.cuentas.filter((cu) => !/^efectivo$/i.test(cu.nombre.trim())).map((cu) => cu.nombre);
  const c = (gastoEditando ? camposGastoEdicion : camposGasto) || {};
  const chequeElegido = chequesCartera.find((ch) => String(ch.id) === String(c.cheque));
  const fechaForm = c.fecha || fechaHoyISO();
  // El "Débito / Tarjeta" de antes se muestra como Débito.
  const medioForm = c.medio === MEDIO_GASTO_VIEJO ? 'Débito' : MEDIOS_GASTO.includes(c.medio) ? c.medio : 'Efectivo';
  const esBancoForm = medioForm !== 'Efectivo' && medioForm !== 'Cheque';
  // "Cómo pagó": Efectivo, Transferencia, Débito, Crédito o Cheque. Con transferencia, débito o crédito, "Pagó con"
  // ofrece los bancos y apps (y de ahí, la tarjeta y las cuotas).
  const pagoConForm = esBancoForm ? c.cuenta || '' : '';
  // Al corregir: un gasto pagado con cheque conserva su forma de pago (y, si salió de la cartera, su monto).
  const medioBloqueado = Boolean(gastoEditando && gastoEditando.medio_pago === 'Cheque');
  const montoBloqueado = Boolean(gastoEditando && gastoEditando.cheque_id);
  const opcionesComo = ['Efectivo', 'Transferencia', 'Débito', 'Crédito', ...(gastoEditando && !medioBloqueado ? [] : ['Cheque'])];
  const opcionesPagoCon = [...cuentasBanco];
  if (pagoConForm && !opcionesPagoCon.includes(pagoConForm)) opcionesPagoCon.push(pagoConForm);
  const saldoInicialForm = medioForm === 'Crédito' ? undefined : saldosCuentas[medioForm === 'Efectivo' ? 'Efectivo' : pagoConForm];

  app.innerHTML = `
    <div class="gastos-pantalla">
      ${gastosTabToggleHtml()}
      <h2 id="titulo-form-gasto" class="${gastoEditando ? '' : 'titulo-colapsable'}" ${gastoEditando ? '' : 'tabindex="0"'}>
        ${gastoEditando ? 'Editar gasto' : 'Nuevo gasto'}
        ${gastoEditando ? '' : `<span class="icono-colapsar ${mostrarFormGasto ? 'abierto' : ''}">▾</span>`}
      </h2>
      <div class="panel gasto-form" ${gastoEditando ? 'data-editando' : ''} ${gastoEditando || mostrarFormGasto ? '' : 'style="display:none"'}>
        <div class="gasto-fila">
          <div class="gasto-campo">
            <span>Fecha</span>
            ${selectorFechaHtml('gasto-fecha', fechaForm)}
          </div>
          <label class="gasto-campo">
            <span>Categoría</span>
            <select id="gasto-categoria">
              <option value="">Elegí una…</option>
              ${['negocio', 'personal']
                .map((ambito) => {
                  const propias = categorias.filter((cat) => (cat.ambito || 'negocio') === ambito);
                  return propias.length
                    ? `<optgroup label="${ambito === 'negocio' ? 'Negocio' : 'Personal'}">${propias.map((cat) => `<option value="${cat.id}" ${String(cat.id) === String(c.categoria) ? 'selected' : ''}>${esc(cat.nombre)}</option>`).join('')}</optgroup>`
                    : '';
                })
                .join('')}
            </select>
          </label>
          <label class="gasto-campo gasto-campo-grande">
            <span>Descripción</span>
            ${campoLimpiableHtml(`<input type="text" id="gasto-descripcion" maxlength="200" placeholder="Ej: Internet" autocomplete="off" value="${esc(c.descripcion || '')}" />`)}
            ${sugeridasDescripcionesHtml(descripciones, 'gasto-sugerencias')}
          </label>
          <label class="gasto-campo">
            <span>Monto</span>
            <div class="input-moneda"><span>$</span><input type="text" id="gasto-monto" inputmode="decimal" autocomplete="off" value="${esc(chequeElegido ? formatearMoneda(chequeElegido.importe) : c.monto || '')}" ${chequeElegido || montoBloqueado ? 'readonly' : ''} /></div>
          </label>
        </div>
        <div class="gasto-fila">
          <div class="gasto-col-medio">
          <label class="gasto-campo">
            <span>Cómo pagó</span>
            <select id="gasto-como" ${medioBloqueado ? 'disabled' : ''}>
              ${opcionesComo.map((m) => `<option ${m === medioForm ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
            <input type="hidden" id="gasto-medio" value="${esc(medioForm)}" />
          </label>
          <span id="gasto-saldo-efectivo" class="gasto-saldo-cuenta" ${medioForm === 'Efectivo' && saldoInicialForm !== undefined ? '' : 'hidden'}>${medioForm === 'Efectivo' && saldoInicialForm !== undefined ? `Hay ${textoSaldoCuenta(saldoInicialForm)}` : ''}</span>
          </div>
          <div class="gasto-col-medio" id="gasto-pago-con-campo" ${esBancoForm ? '' : 'hidden'}>
          <label class="gasto-campo">
            <span>Pagó con</span>
            <select id="gasto-pago-con">
              ${pagoConForm === '' ? '<option value="" selected>Elegí una…</option>' : ''}
              ${opcionesPagoCon.map((n) => `<option value="${esc(n)}" ${n === pagoConForm ? 'selected' : ''}>${esc(n)}</option>`).join('')}
            </select>
          </label>
          <span id="gasto-saldo-cuenta" class="gasto-saldo-cuenta" ${esBancoForm && saldoInicialForm !== undefined ? '' : 'hidden'}>${esBancoForm && saldoInicialForm !== undefined ? `Hay ${textoSaldoCuenta(saldoInicialForm)}` : ''}</span>
          </div>
          <label class="gasto-campo" id="gasto-tarjeta-campo" ${esBancoForm && medioUsaTarjeta(medioForm) ? '' : 'hidden'}>
            <span>Tarjeta</span>
            <select id="gasto-tarjeta"></select>
          </label>
          <label class="gasto-campo" id="gasto-cuotas-campo" ${medioForm === 'Crédito' ? '' : 'hidden'}>
            <span>Cuotas</span>
            <select id="gasto-cuotas">
              ${CUOTAS_GASTO.map((n) => `<option value="${n}" ${String(n) === String(c.cuotas || 1) ? 'selected' : ''}>${n === 1 ? '1 pago' : `${n} cuotas`}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="gasto-fila gasto-fila-botones">
          <label class="gasto-campo gasto-campo-observacion">
            <span>Observación (opcional)</span>
            ${campoLimpiableHtml(`<input type="text" id="gasto-observacion" maxlength="300" autocomplete="off" value="${esc(c.observacion || '')}" />`)}
          </label>
          ${gastoEditando ? '' : `<button type="button" id="btn-agregar-gasto" class="btn-redondo btn-mas" aria-label="Agregar gasto" title="Agregar gasto">+</button>`}
        </div>
        ${gastoEditando || !hayCuotasPendientes ? '' : '<div class="gasto-resumen-tarjeta"><button type="button" id="btn-pagar-resumen" class="enlace-boton">Pagar resumen de tarjeta</button></div>'}
        <div class="gasto-fila gasto-cheque" id="gasto-cheque" ${medioForm === 'Cheque' ? '' : 'hidden'}>
          ${
            gastoEditando && gastoEditando.medio_pago === 'Cheque'
              ? `<div class="pin-subtitulo">${gastoEditando.cheque_id ? 'Pagado con el cheque' : 'Pagado con cheque'}: ${esc(detalleChequeTexto(gastoEditando) || 'sin datos')} ${botonAyudaHtml('ayuda-gasto-cheque', 'Cambiar el cheque', '<p>Para cambiar el cheque, quitá el gasto y cargalo de nuevo.</p>', 'izquierda')}</div><input type="hidden" id="gasto-cheque-id" value="" />`
              : chequesCartera.length
              ? `<label class="gasto-campo">
            <span>Cheque de la cartera</span>
            <select id="gasto-cheque-id">
              <option value="">Elegí un cheque…</option>
              ${chequesCartera.map((ch) => `<option value="${ch.id}" ${chequeElegido && chequeElegido.id === ch.id ? 'selected' : ''}>${esc(textoChequeOpcion(ch))}</option>`).join('')}
            </select>
          </label>`
              : '<p class="pin-subtitulo">No tenés cheques en cartera. Se cargan en Dinero → Cheques.</p><input type="hidden" id="gasto-cheque-id" value="" />'
          }
        </div>
        ${gastoEditando ? '' : `<div class="gasto-fila gasto-fila-acciones"><button type="button" id="btn-limpiar-gasto" class="btn-limpiar">Limpiar</button></div>`}
        ${
          gastoEditando
            ? `<div class="btn-group">
          <button type="button" id="btn-guardar-edicion-gasto" class="primary">Guardar cambios</button>
          <button type="button" id="btn-cancelar-edicion-gasto" class="cancelar">Cancelar</button>
        </div>`
            : ''
        }
        <p id="error-gasto" class="error-msg" style="display:none"></p>
      </div>

      <h2>Gastos cargados</h2>
      <div class="toolbar toolbar-junta">
        <span id="gastos-total" class="gastos-total-barra"></span>
        ${selectorRangoHtml('filtro-rango-gastos', filtroGastosDesde, filtroGastosHasta)}
        <input type="text" id="buscar-gasto" class="buscador" placeholder="Buscar" value="${esc(busquedaGastos)}" autocomplete="off" />
        ${filtrosListaHtml('filtros-gastos', [
          {
            nombre: 'medio',
            titulo: 'Forma de pago',
            opciones: [['todos', 'Todas'], ['Efectivo', 'Efectivo'], ['Transferencia', 'Transferencia'], ['Débito', 'Débito'], ['Crédito', 'Crédito'], ['Cheque', 'Cheque']],
            actual: filtroMedioGastos,
            porDefecto: 'todos',
          },
        ])}
      </div>
      <table>
        <thead><tr><th>Día</th><th>Categoría</th><th>Descripción</th><th>Pagó con</th><th>Monto</th><th></th></tr></thead>
        <tbody id="gastos-body"></tbody>
      </table>
      <p id="gastos-ver-mas" style="text-align:center; margin-top:16px;" hidden>
        <button type="button" id="btn-ver-mas-gastos"></button>
      </p>
    </div>
  `;

  const inputMonto = document.getElementById('gasto-monto');
  vincularFormatoMoneda(inputMonto);

  const pintarLista = () => {
    const q = normalizarTexto(busquedaGastos.trim());
    // El "Débito / Tarjeta" de antes cuenta como débito.
    const mismoMedio = (g) => filtroMedioGastos === 'todos' || g.medio_pago === filtroMedioGastos || (filtroMedioGastos === 'Débito' && g.medio_pago === MEDIO_GASTO_VIEJO);
    const visibles = gastos.filter(
      (g) => mismoMedio(g) && (!q || normalizarTexto(`${g.descripcion} ${g.categoria} ${g.medio_pago} ${g.observacion || ''}`).includes(q))
    );
    const total = redondearPesos(visibles.reduce((acc, g) => acc + g.monto, 0));
    document.getElementById('gastos-total').textContent = visibles.length
      ? `Total: $${formatearMoneda(total)}`
      : '';
    const mostrados = visibles.slice(0, limiteGastos);
    const ocultos = visibles.length - mostrados.length;
    document.getElementById('gastos-ver-mas').hidden = ocultos <= 0;
    document.getElementById('btn-ver-mas-gastos').textContent = `Ver más antiguos (${ocultos})`;
    document.getElementById('gastos-body').innerHTML = visibles.length
      ? mostrados
          .map(
            (g) => `<tr>
          <td>${fechaLargaCierre(g.fecha)}</td>
          <td>${esc(g.categoria)}${g.categoria_ambito === 'personal' ? ' <span class="etiqueta-gasto" title="Gasto personal (no del negocio)">personal</span>' : ''}</td>
          <td>${esc(g.descripcion)}${detalleChequeGasto(g)}${g.observacion ? `<div class="gasto-detalle-cheque">${esc(g.observacion)}</div>` : ''}</td>
          <td>${esc(g.medio_pago)}${detallePagoGasto(g)}</td>
          <td>$${formatearMoneda(g.monto)}</td>
          <td class="celda-centrada"><div class="menu-fila">
            <button class="btn-menu-fila" type="button" aria-label="Acciones del gasto: ${esc(g.descripcion)}">⋮</button>
            <div class="menu-fila-lista">
              ${g.medio_pago === 'Crédito' && g.cuotas ? `<button type="button" class="item-menu ver-cuotas-gasto" data-id="${g.id}">Ver cuotas</button>` : ''}
              <button type="button" class="item-menu editar-gasto" data-id="${g.id}">Editar</button>
              <button type="button" class="item-menu quitar-gasto" data-id="${g.id}">Eliminar</button>
            </div>
          </div></td>
        </tr>`
          )
          .join('')
      : '<tr><td colspan="6">No hay gastos en ese período.</td></tr>';
    vincularMenuFila();
    document.querySelectorAll('#gastos-body .editar-gasto').forEach((btn) => {
      btn.addEventListener('click', () => {
        const gasto = gastos.find((g) => g.id === Number(btn.dataset.id));
        if (!gasto) return;
        gastoEditando = gasto;
        camposGastoEdicion = {
          fecha: gasto.fecha,
          categoria: String(gasto.categoria_id),
          descripcion: gasto.descripcion,
          monto: formatearMoneda(gasto.monto),
          medio: gasto.medio_pago,
          cuenta: gasto.cuenta || '',
          tarjeta: gasto.tarjeta || '',
          cuotas: gasto.cuotas || 1,
          observacion: gasto.observacion || '',
        };
        renderGastos().then(() => {
          window.scrollTo({ top: 0 });
          document.getElementById('gasto-descripcion')?.focus();
        });
      });
    });
    document.querySelectorAll('#gastos-body .ver-cuotas-gasto').forEach((btn) => {
      btn.addEventListener('click', () => {
        const gasto = gastos.find((g) => g.id === Number(btn.dataset.id));
        if (gasto) abrirCuotasGasto(gasto, cuentasBanco, () => renderGastos());
      });
    });
    document.querySelectorAll('#gastos-body .quitar-gasto').forEach((btn) => {
      btn.addEventListener('click', () => {
        const gasto = gastos.find((g) => g.id === Number(btn.dataset.id));
        if (!gasto) return;
        mostrarModal(`${modalXHtml('modal-cancelar')}
          <h3>Quitar gasto</h3>
          <p>¿Seguro que querés quitar este gasto?</p>
          <p><strong>${esc(gasto.descripcion)}</strong> — $${formatearMoneda(gasto.monto)} (${fechaLargaCierre(gasto.fecha)})</p>
          ${gasto.medio_pago === 'Efectivo' ? '<p class="pin-subtitulo">Como se pagó en efectivo, también deja de contar como retiro en el Cierre de caja de ese día.</p>' : ''}
          ${gasto.cheque_id ? '<p class="pin-subtitulo">El cheque vuelve a la cartera.</p>' : ''}
          ${gasto.categoria === 'Comisiones de vendedores' ? '<p class="pin-subtitulo">También deja de figurar como pagado en Vendedores.</p>' : ''}
          <div class="btn-group">
            <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, quitar</button>
          </div>
        `);
        document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
        document.getElementById('modal-confirmar').addEventListener('click', async () => {
          await window.freska.gastos.eliminar(gasto.id);
          if (gastoEditando && gastoEditando.id === gasto.id) terminarEdicionGasto();
          cerrarModal();
          mostrarToast('Gasto quitado.', 'ok');
          renderGastos();
        });
      });
    });
  };
  pintarLista();

  vincularGastosTabToggle();
  document.getElementById('btn-ver-mas-gastos').addEventListener('click', () => {
    limiteGastos += GASTOS_POR_PAGINA;
    pintarLista();
  });
  document.getElementById('btn-pagar-resumen')?.addEventListener('click', () => abrirOperacionDesde('resumen', () => renderGastos()));
  vincularFiltrosLista('filtros-gastos', (grupo, valor) => {
    filtroMedioGastos = valor;
    limiteGastos = GASTOS_POR_PAGINA;
    renderGastos();
  });

  document.getElementById('buscar-gasto').addEventListener('input', (e) => {
    busquedaGastos = e.target.value;
    limiteGastos = GASTOS_POR_PAGINA;
    pintarLista();
  });
  vincularSelectorRango('filtro-rango-gastos', filtroGastosDesde, filtroGastosHasta, ({ desde, hasta }) => {
    filtroGastosDesde = desde;
    filtroGastosHasta = hasta;
    limiteGastos = GASTOS_POR_PAGINA;
    capturarCamposBorrador();
    renderGastos();
  });

  // Fechas del formulario: al elegir una, se redibuja conservando lo que ya se escribió.
  // Importante: la fecha nueva se escribe primero en el casillero. Mientras la pantalla se vuelve a
  // dibujar, un "focusout" tardío vuelve a leer el formulario (`capturarCamposBorrador`) y, si el
  // casillero todavía tuviera la fecha vieja, la fecha elegida se perdería.
  vincularSelectorFecha('gasto-fecha', fechaForm, (nueva) => {
    const fecha = nueva || fechaHoyISO();
    document.getElementById('gasto-fecha').value = formatearFechaCorta(fecha);
    capturarCamposBorrador();
    if (gastoEditando) camposGastoEdicion = { ...(camposGastoEdicion || {}), fecha };
    else camposGasto = { ...(camposGasto || {}), fecha };
    renderGastos();
  });

  // Al elegir un cheque, el monto pasa a ser el del cheque (no se edita). Si se cambia la forma de pago,
  // el cheque elegido se descarta.
  const actualizarMontoPorCheque = () => {
    const ch = chequesCartera.find((x) => String(x.id) === document.getElementById('gasto-cheque-id').value);
    const usaCheque = document.getElementById('gasto-medio').value === 'Cheque' && ch;
    inputMonto.readOnly = Boolean(usaCheque);
    if (usaCheque) inputMonto.value = formatearMoneda(ch.importe);
  };
  document.getElementById('gasto-cheque-id').addEventListener('change', () => {
    actualizarMontoPorCheque();
    capturarCamposBorrador();
  });
  // "Pagó con" + "Cómo": deciden la forma de pago (medio) que se guarda, qué campos se ven y qué tarjetas se ofrecen.
  const elPagoCon = document.getElementById('gasto-pago-con');
  const elComo = document.getElementById('gasto-como');
  const elMedio = document.getElementById('gasto-medio');
  const elTarjeta = document.getElementById('gasto-tarjeta');
  const rellenarTarjetas = (elegida) => {
    const tipo = elMedio.value;
    const propias = tarjetasTodas.filter((t) => t.cuenta === elPagoCon.value && t.tipo === tipo).map((t) => t.nombre);
    const actual = elegida !== undefined ? elegida : elTarjeta.value;
    if (actual && !propias.includes(actual)) propias.push(actual); // una tarjeta escrita antes, o ya quitada
    elTarjeta.innerHTML = `<option value="">${propias.length ? 'Sin tarjeta' : 'Sin tarjetas cargadas'}</option>${propias.map((n) => `<option ${n === actual ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;
  };
  const sincronizarPago = () => {
    const medio = elComo.value;
    const esBanco = medio === 'Transferencia' || medio === 'Débito' || medio === 'Crédito';
    elMedio.value = medio;
    document.getElementById('gasto-pago-con-campo').hidden = !esBanco;
    document.getElementById('gasto-tarjeta-campo').hidden = !(esBanco && medioUsaTarjeta(medio));
    document.getElementById('gasto-cuotas-campo').hidden = !(esBanco && medio === 'Crédito');
    rellenarTarjetas();
    // Con crédito no hay saldo que mirar: la plata sale recién al pagar cada cuota. Con efectivo el saldo va
    // bajo "Cómo pagó"; con transferencia o débito, bajo "Pagó con" (el de la cuenta elegida).
    const saldoEfectivo = document.getElementById('gasto-saldo-efectivo');
    const saldoCuenta = document.getElementById('gasto-saldo-cuenta');
    const hayEfectivo = medio === 'Efectivo' ? saldosCuentas.Efectivo : undefined;
    const hayCuenta = esBanco && medio !== 'Crédito' ? saldosCuentas[elPagoCon.value] : undefined;
    saldoEfectivo.hidden = hayEfectivo === undefined;
    saldoEfectivo.textContent = hayEfectivo === undefined ? '' : `Hay ${textoSaldoCuenta(hayEfectivo)}`;
    saldoCuenta.hidden = hayCuenta === undefined;
    saldoCuenta.textContent = hayCuenta === undefined ? '' : `Hay ${textoSaldoCuenta(hayCuenta)}`;
    const esCheque = medio === 'Cheque';
    document.getElementById('gasto-cheque').hidden = !esCheque;
    if (!esCheque) {
      document.getElementById('gasto-cheque-id').value = '';
      if (inputMonto.readOnly) inputMonto.value = '';
      inputMonto.readOnly = false;
    }
    actualizarMontoPorCheque();
  };
  rellenarTarjetas(c.tarjeta || '');
  vincularBotonAyuda('ayuda-gasto-cheque');
  elPagoCon.addEventListener('change', sincronizarPago);
  elComo.addEventListener('change', sincronizarPago);

  const inputDescripcion = document.getElementById('gasto-descripcion');
  vincularCampoLimpiable(inputDescripcion);
  vincularSugeridasDescripcion({
    idContenedor: 'gasto-sugerencias',
    inputDescripcion,
    selectCategoria: document.getElementById('gasto-categoria'),
    alElegir: (chip) => {
      // Se completa con lo último que se pagó con esa descripción: el monto y con qué se pagó.
      const monto = Number(chip && chip.dataset.monto);
      if (monto > 0 && !inputMonto.disabled) inputMonto.value = formatearMoneda(monto);
      const medio = chip ? chip.dataset.medio : '';
      const cuenta = chip ? chip.dataset.cuenta : '';
      if (medio === 'Efectivo') {
        elComo.value = 'Efectivo';
        sincronizarPago();
      } else if (cuenta && ['Transferencia', 'Débito', 'Débito / Tarjeta'].includes(medio) && Array.from(elPagoCon.options).some((o) => o.value === cuenta)) {
        elComo.value = medio === 'Transferencia' ? 'Transferencia' : 'Débito';
        elPagoCon.value = cuenta;
        sincronizarPago();
      }
      capturarCamposBorrador();
      inputMonto.focus();
      inputMonto.select();
    },
    alSacar: () => {
      capturarCamposBorrador();
      renderGastos();
    },
  });

  const agregarGasto = async () => {
    const errorEl = document.getElementById('error-gasto');
    const valor = (id) => document.getElementById(id).value;
    const fecha = fechaCortaAIso(valor('gasto-fecha'));
    const medio = valor('gasto-medio');
    const datos = {
      fecha,
      categoria_id: Number(valor('gasto-categoria')) || null,
      descripcion: valor('gasto-descripcion'),
      monto: limpiarNumeroMoneda(valor('gasto-monto')),
      medio_pago: medio,
      observacion: valor('gasto-observacion'),
      cuenta: medio === 'Efectivo' || medio === 'Cheque' ? '' : valor('gasto-pago-con'),
      tarjeta: medioUsaTarjeta(medio) ? valor('gasto-tarjeta') : '',
      cuotas: medio === 'Crédito' ? Number(valor('gasto-cuotas')) : null,
    };
    const resultado = !fecha
      ? { ok: false, error: 'La fecha no es válida.' }
      : gastoEditando
        ? await window.freska.gastos.actualizar({ ...datos, id: gastoEditando.id })
        : await window.freska.gastos.crear({ ...datos, cheque_id: Number(valor('gasto-cheque-id')) || null });
    if (!resultado.ok) {
      errorEl.textContent = resultado.error;
      errorEl.style.display = 'block';
      return;
    }
    if (gastoEditando) {
      terminarEdicionGasto();
      mostrarToast('Gasto actualizado.', 'ok');
      await renderGastos();
      return;
    }
    // Queda la misma fecha y forma de pago para cargar el siguiente; lo demás se limpia.
    camposGasto = { fecha, medio };
    mostrarToast('Gasto guardado.', 'ok');
    await renderGastos();
    document.getElementById('gasto-descripcion')?.focus();
  };
  document.getElementById('titulo-form-gasto')?.addEventListener('click', () => {
    if (gastoEditando) return;
    mostrarFormGasto = !mostrarFormGasto;
    document.querySelector('.gasto-form').style.display = mostrarFormGasto ? '' : 'none';
    document.querySelector('#titulo-form-gasto .icono-colapsar')?.classList.toggle('abierto', mostrarFormGasto);
  });
  document.getElementById('btn-agregar-gasto')?.addEventListener('click', agregarGasto);
  document.getElementById('btn-limpiar-gasto')?.addEventListener('click', () => {
    camposGasto = null;
    renderGastos();
  });
  document.getElementById('btn-guardar-edicion-gasto')?.addEventListener('click', agregarGasto);
  document.getElementById('btn-cancelar-edicion-gasto')?.addEventListener('click', () => {
    terminarEdicionGasto();
    renderGastos();
  });
  // Enter en la descripción pasa al monto; Enter en el monto agrega (o guarda los cambios al corregir).
  inputDescripcion.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    inputMonto.focus();
  });
  [inputMonto, document.getElementById('gasto-observacion')].forEach((campo) =>
    campo.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      agregarGasto();
    })
  );
}

// Categorías que se ven desplegadas (con sus descripciones) en la vista Categorías.
const categoriasGastoAbiertas = new Set();

async function renderCategoriasGasto() {
  const [categorias, descripciones] = await Promise.all([
    window.freska.gastos.categorias(),
    window.freska.gastos.descripciones(),
  ]);
  const porCategoria = {};
  descripciones.forEach((d) => {
    (porCategoria[d.categoria_id] = porCategoria[d.categoria_id] || []).push(d);
  });
  Object.values(porCategoria).forEach((lista) => lista.sort((a, b) => a.nombre.localeCompare(b.nombre)));

  app.innerHTML = `
    <div class="gastos-pantalla">
      ${gastosTabToggleHtml()}
      <div class="cierre-titulo-fila" style="margin-top:0">
        <h2>Categorías de gasto</h2>
        ${botonAyudaHtml('ayuda-categorias-gasto', 'Categorías de gasto', '<p>Son las opciones que aparecen al cargar un gasto. Tocá una categoría para ver y armar sus descripciones: las que agregues acá te aparecen como sugeridas al elegirla.</p><p>Los gastos ya cargados no se borran.</p>', 'izquierda')}
      </div>
      <table class="angosto tabla-categorias-gasto">
        <tbody>
          ${['negocio', 'personal']
            .map(
              (ambito) => `<tr class="fila-ambito-categoria"><td colspan="2"><span>${ambito === 'negocio' ? 'Negocio' : 'Personal'}</span><button type="button" class="btn-redondo btn-mas btn-mas-ambito ${mostrarFormCategoriaGasto === ambito ? 'abierto' : ''}" data-ambito="${ambito}" aria-label="Agregar categoría ${ambito === 'negocio' ? 'del negocio' : 'personal'}" title="Agregar categoría ${ambito === 'negocio' ? 'del negocio' : 'personal'}">+</button></td></tr>${
            mostrarFormCategoriaGasto === ambito
              ? `<tr class="fila-form-categoria"><td colspan="2"><form id="form-categoria-gasto" class="form-categoria-inline"><input type="text" id="nueva-categoria-gasto" placeholder="Nombre de la categoría" maxlength="80" autocomplete="off" required /><button type="submit" class="primary">Guardar</button><button type="button" id="btn-cancelar-categoria-gasto">Cancelar</button></form><p id="error-categoria-gasto" class="error-msg" style="display:none"></p></td></tr>`
              : ''
          }${categorias
            .filter((cat) => (cat.ambito || 'negocio') === ambito)
            .map((cat) => {
              const lista = porCategoria[cat.id] || [];
              const abierta = categoriasGastoAbiertas.has(cat.id);
              return `<tr class="fila-clickeable fila-categoria-gasto" tabindex="0" data-id="${cat.id}">
            <td><span class="icono-fila ${abierta ? 'abierto' : ''}">▾</span>${esc(cat.nombre)} <span class="cantidad-descripciones">${lista.length ? `(${lista.length})` : ''}</span></td>
            <td><button type="button" class="btn-redondo btn-tacho quitar-categoria-gasto" data-id="${cat.id}" data-nombre="${esc(cat.nombre)}" aria-label="Quitar ${esc(cat.nombre)}" title="Quitar categoría">${TACHITO_SVG}</button></td>
          </tr>
          <tr class="detalle-categoria-gasto" data-detalle-de="${cat.id}" ${abierta ? '' : 'style="display:none"'}>
            <td colspan="2">
              <div class="descripciones-linea">
              ${
                lista.length
                  ? `<div class="retiro-sugerencias">${lista
                      .map(
                        (d) => `<span class="chip-retiro-grupo"><span class="chip-retiro-texto">${esc(d.nombre)}</span><button type="button" class="chip-retiro-x quitar-descripcion-categoria" data-id="${d.id}" data-nombre="${esc(d.nombre)}" aria-label="Sacar ${esc(d.nombre)}" title="Sacar descripción">×</button></span>`
                      )
                      .join('')}</div>`
                  : '<p class="ayuda-campo">Todavía no tiene descripciones.</p>'
              }
              <div class="agregar-descripcion-categoria">
                <button type="button" class="btn-redondo btn-mas btn-mostrar-descripcion-categoria ${descripcionAbiertaCategoria === cat.id ? 'abierto' : ''}" data-categoria="${cat.id}" aria-label="Agregar descripción a ${esc(cat.nombre)}" aria-expanded="${descripcionAbiertaCategoria === cat.id}" title="Agregar descripción">+</button>
                <input type="text" class="nueva-descripcion-categoria" data-categoria="${cat.id}" maxlength="200" placeholder="Nueva descripción (Enter para agregar)" autocomplete="off" ${descripcionAbiertaCategoria === cat.id ? '' : 'hidden'} />
              </div>
              </div>
              <p class="error-msg error-descripcion-categoria" style="display:none"></p>
            </td>
          </tr>`;
            })
            .join('')}`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;

  vincularGastosTabToggle();
  vincularBotonAyuda('ayuda-categorias-gasto');
  app.querySelectorAll('.btn-mas-ambito').forEach((btn) => {
    btn.addEventListener('click', async () => {
      mostrarFormCategoriaGasto = mostrarFormCategoriaGasto === btn.dataset.ambito ? null : btn.dataset.ambito;
      await renderCategoriasGasto();
      document.getElementById('nueva-categoria-gasto')?.focus();
    });
  });
  if (mostrarFormCategoriaGasto) {
    document.getElementById('btn-cancelar-categoria-gasto').addEventListener('click', () => {
      mostrarFormCategoriaGasto = null;
      renderCategoriasGasto();
    });
    document.getElementById('form-categoria-gasto').addEventListener('submit', async (e) => {
      e.preventDefault();
      const resultado = await window.freska.gastos.crearCategoria({ nombre: document.getElementById('nueva-categoria-gasto').value, ambito: mostrarFormCategoriaGasto });
      if (!resultado.ok) {
        const errorEl = document.getElementById('error-categoria-gasto');
        errorEl.textContent = resultado.error;
        errorEl.style.display = 'block';
        return;
      }
      mostrarFormCategoriaGasto = null;
      mostrarToast('Categoría guardada.', 'ok');
      renderCategoriasGasto();
    });
  }

  // Tocar la fila (o Enter) despliega / pliega las descripciones de esa categoría.
  app.querySelectorAll('tr.fila-categoria-gasto').forEach((fila) => {
    const alternar = () => {
      const idCategoria = Number(fila.dataset.id);
      const detalle = app.querySelector(`tr.detalle-categoria-gasto[data-detalle-de="${idCategoria}"]`);
      const abrir = detalle.style.display === 'none';
      detalle.style.display = abrir ? '' : 'none';
      fila.querySelector('.icono-fila').classList.toggle('abierto', abrir);
      if (abrir) categoriasGastoAbiertas.add(idCategoria);
      else categoriasGastoAbiertas.delete(idCategoria);
    };
    fila.addEventListener('click', (e) => {
      if (e.target.closest('.quitar-categoria-gasto')) return;
      alternar();
    });
    fila.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === fila) alternar();
    });
  });

  const agregarDescripcion = async (idCategoria) => {
    const detalle = app.querySelector(`tr.detalle-categoria-gasto[data-detalle-de="${idCategoria}"]`);
    const input = detalle.querySelector('.nueva-descripcion-categoria');
    const resultado = await window.freska.gastos.crearDescripcion({ nombre: input.value, categoria_id: idCategoria });
    if (!resultado.ok) {
      const errorEl = detalle.querySelector('.error-descripcion-categoria');
      errorEl.textContent = resultado.error;
      errorEl.style.display = 'block';
      return;
    }
    categoriasGastoAbiertas.add(idCategoria);
    descripcionAbiertaCategoria = idCategoria;
    await renderCategoriasGasto();
    app.querySelector(`.nueva-descripcion-categoria[data-categoria="${idCategoria}"]`)?.focus();
  };
  app.querySelectorAll('.btn-mostrar-descripcion-categoria').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idCategoria = Number(btn.dataset.categoria);
      const input = app.querySelector(`.nueva-descripcion-categoria[data-categoria="${idCategoria}"]`);
      const abrir = input.hidden;
      input.hidden = !abrir;
      btn.classList.toggle('abierto', abrir);
      btn.setAttribute('aria-expanded', String(abrir));
      descripcionAbiertaCategoria = abrir ? idCategoria : null;
      if (abrir) input.focus();
    });
  });
  app.querySelectorAll('.nueva-descripcion-categoria').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        agregarDescripcion(Number(input.dataset.categoria));
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        app.querySelector(`.btn-mostrar-descripcion-categoria[data-categoria="${input.dataset.categoria}"]`).click();
      }
    });
  });
  app.querySelectorAll('.quitar-descripcion-categoria').forEach((btn) => {
    btn.addEventListener('click', () => {
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Sacar descripción</h3>
        <p>¿Sacar <strong>${esc(btn.dataset.nombre)}</strong> de las descripciones sugeridas?</p>
        <p class="pin-subtitulo">Los gastos que ya cargaste con esa descripción no se borran.</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, sacar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        await window.freska.gastos.quitarDescripcion(Number(btn.dataset.id));
        cerrarModal();
        mostrarToast('Descripción sacada.', 'ok');
        renderCategoriasGasto();
      });
    });
  });

  app.querySelectorAll('.quitar-categoria-gasto').forEach((btn) => {
    btn.addEventListener('click', () => {
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Quitar categoría</h3>
        <p>¿Seguro que querés quitar <strong>${esc(btn.dataset.nombre)}</strong>?</p>
        <p class="pin-subtitulo">Deja de aparecer al cargar un gasto nuevo. Los gastos que ya cargaste con esa categoría se mantienen.</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, quitar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        await window.freska.gastos.quitarCategoria(Number(btn.dataset.id));
        cerrarModal();
        mostrarToast('Categoría quitada.', 'ok');
        renderCategoriasGasto();
      });
    });
  });
}
