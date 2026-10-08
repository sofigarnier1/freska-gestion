// Fondos personales: ingresos (esta pantalla) y, en otras pastillas, gastos de propiedades y cuentas (fondos-personales.js).
// (Antes todo estaba en renderer.js; se dividió por pantalla el 2026-09-24. Los archivos son scripts comunes que
// comparten el mismo espacio global: se cargan en el orden de index.html y no hace falta importar nada.)

const CHIPS_INGRESO_VISIBLES = 6;
const CHIPS_INGRESO_CATEGORIA = 10;

let vistaIngresosTab = 'ingresos'; // 'ingresos' | 'retiros' | 'resultado' | 'cuentas' | 'categorias'
let mostrarFormCategoriaIngreso = false;
let mostrarFormCategoriaGastoPersonal = false; // la lista aparte de los gastos personales de Fondos personales
// Categoría cuyo campo de "nueva descripción" está abierto (el "+" lo abre; queda abierto para cargar varias).
let descripcionAbiertaCategoriaIngreso = null;
// Categorías que se ven desplegadas (con sus descripciones) en la vista Categorías.
const categoriasIngresoAbiertas = new Set();

let fechaIngresoForm = null;
let rangoIngresosIniciado = false;
let filtroIngresosDesde = '';
let filtroIngresosHasta = '';
let busquedaIngresos = '';
let filtroCuentaIngresos = 'todos';
let filtroOrigenIngresos = 'todos';
let cuentaIngresoForm = '';
let categoriaIngresoForm = '';
let comoIngresoForm = 'transferencia'; // 'transferencia' (el banco retiene un %) | 'sin_retencion'

function ingresosTabToggleHtml() {
  return `
    <div class="reportes-toggle">
      <button type="button" class="toggle ${vistaIngresosTab === 'ingresos' ? 'active' : ''}" data-ingresos-tab="ingresos">Ingresos</button>
      <button type="button" class="toggle ${vistaIngresosTab === 'retiros' ? 'active' : ''}" data-ingresos-tab="retiros">Gastos</button>
      <button type="button" class="toggle ${vistaIngresosTab === 'resultado' ? 'active' : ''}" data-ingresos-tab="resultado">Resultado</button>
      <button type="button" class="toggle ${vistaIngresosTab === 'cuentas' ? 'active' : ''}" data-ingresos-tab="cuentas">Cuentas</button>
      <button type="button" class="toggle ${vistaIngresosTab === 'categorias' ? 'active' : ''}" data-ingresos-tab="categorias">Categorías</button>
    </div>`;
}

function vincularIngresosTabToggle() {
  app.querySelectorAll('.toggle[data-ingresos-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      vistaIngresosTab = btn.dataset.ingresosTab;
      renderIngresos();
    });
  });
}

// Sugerencias de descripción (agrupadas por categoría, igual que en Gastos): sin categoría elegida ni texto
// escrito no se muestra ninguna; con categoría, las de esa categoría primero.
function sugeridasIngresoHtml(descripciones, idContenedor) {
  if (!descripciones.length) return '';
  return `<div class="retiro-sugerencias" id="${idContenedor}">
    ${descripciones
      .map(
        (d) => `<span class="chip-retiro-grupo" data-concepto="${esc(d.nombre)}" data-categoria="${d.categoria_id || ''}" data-orden="${d.orden}" data-monto="${d.ultimo_monto || ''}" data-cuenta="${esc(d.ultima_cuenta || '')}"><button type="button" class="chip-retiro">${esc(d.nombre)}</button><button type="button" class="chip-retiro-x" data-id="${d.id}" aria-label="Sacar ${esc(d.nombre)} de las descripciones" title="Sacar de las descripciones">×</button></span>`
      )
      .join('')}
  </div>`;
}

// Cuadros de Interés (lo que las apps te dan por tener la plata) y Reintegro (plata que te devuelven de una compra
// personal, opcionalmente ligada al gasto de propiedades que la originó). Los dos entran a una cuenta personal.
async function abrirIngresoDirecto(tipo, cuentas, alTerminar) {
  const esReintegro = tipo === 'reintegro';
  const fila = (etiqueta, html, completo) => `<label class="op-campo ${completo ? 'op-completo' : ''}"><span>${etiqueta}</span>${html}</label>`;
  let compras = [];
  if (esReintegro) compras = (await window.freska.ingresos.retiros()).slice(0, 100);
  const opcionesCompra = [
    '<option value="">Ninguna (reintegro suelto)</option>',
    ...compras.map((r) => `<option value="${r.id}">${esc(`${formatearFechaCorta(r.fecha)} · ${r.categoria || 'Sin categoría'} · ${r.descripcion} · $${formatearMoneda(r.monto)}${r.reintegrado ? ` (ya reintegrado $${formatearMoneda(r.reintegrado)})` : ''}`)}</option>`),
  ].join('');
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>${esReintegro ? 'Reintegro' : 'Interés'}</h3>
    <div class="op-form">
      <div class="op-campo"><span>Fecha</span>${selectorFechaHtml('directo-fecha', fechaHoyISO())}</div>
      ${fila('Monto', '<div class="input-moneda"><span>$</span><input type="text" inputmode="decimal" id="directo-monto" autocomplete="off" /></div>')}
      ${fila(esReintegro ? 'Entró a' : 'Cuenta', `<select id="directo-cuenta">${cuentas.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select>`, true)}
      ${esReintegro ? fila('¿De qué compra? (opcional)', `<select id="directo-compra">${opcionesCompra}</select>`, true) : ''}
      ${fila('Nota', '<input type="text" id="directo-nota" placeholder="Opcional" maxlength="300" autocomplete="off" />', true)}
    </div>
    <p id="modal-error" class="error-msg" style="display:none"></p>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary">Guardar</button>
    </div>
  `);
  vincularSelectorFecha('directo-fecha', fechaHoyISO(), (nueva) => {
    document.getElementById('directo-fecha').value = formatearFechaCorta(nueva || fechaHoyISO());
  });
  vincularFormatoMoneda(document.getElementById('directo-monto'));
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    const datos = {
      fecha: fechaCortaAIso(document.getElementById('directo-fecha').value),
      monto: limpiarNumeroMoneda(document.getElementById('directo-monto').value),
      cuenta: document.getElementById('directo-cuenta').value,
      observacion: document.getElementById('directo-nota').value,
    };
    if (esReintegro) datos.retiro_id = document.getElementById('directo-compra').value || null;
    const r = esReintegro ? await window.freska.ingresos.reintegro(datos) : await window.freska.ingresos.rendimiento(datos);
    if (!r.ok) {
      const e = document.getElementById('modal-error');
      e.textContent = r.error;
      e.style.display = '';
      return;
    }
    cerrarModal();
    mostrarToast(esReintegro ? 'Reintegro anotado.' : 'Interés anotado.', 'ok');
    alTerminar();
  });
}

function vincularSugeridasIngreso({ idContenedor, inputDescripcion, selectCategoria, alElegir, alSacar }) {
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
    candidatos.sort((a, b) => Number(deLaCategoria(b)) - Number(deLaCategoria(a)));
    const limite = categoria ? CHIPS_INGRESO_CATEGORIA : CHIPS_INGRESO_VISIBLES;
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
        <p class="pin-subtitulo">Los ingresos que ya cargaste con esa descripción no se borran. Si volvés a cargar uno, reaparece.</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, sacar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        await window.freska.ingresos.quitarDescripcion(id);
        cerrarModal();
        mostrarToast('Descripción sacada.', 'ok');
        alSacar();
      });
    });
  });
  vincularDesplegableSugeridas(contenedor, inputDescripcion, selectCategoria);
}

// Ingresos personales (por ejemplo los alquileres que cobra el dueño): no son ventas del negocio y no entran en las
// estadísticas de ventas. Entran a la parte personal de una cuenta (un banco o app, o Efectivo personal) y no suman a la
// caja del negocio.
async function renderIngresos() {
  if (vistaIngresosTab === 'categorias') {
    await renderCategoriasIngreso();
    return;
  }
  if (vistaIngresosTab === 'retiros') {
    await renderRetirosPersonales();
    return;
  }
  if (vistaIngresosTab === 'resultado') {
    await renderResultadoPersonal();
    return;
  }
  if (vistaIngresosTab === 'cuentas') {
    await renderCuentasPersonales();
    return;
  }
  if (!rangoIngresosIniciado) {
    rangoIngresosIniciado = true;
    const hoy = new Date();
    filtroIngresosDesde = primerDiaDelMes(hoy.getFullYear(), hoy.getMonth());
    filtroIngresosHasta = ultimoDiaDelMes(hoy.getFullYear(), hoy.getMonth());
  }
  const [categorias, descripciones, todos, saldos] = await Promise.all([
    window.freska.ingresos.categorias(),
    window.freska.ingresos.descripciones(),
    window.freska.ingresos.listar(),
    window.freska.ingresos.saldos(),
  ]);
  const origenes = [...new Set(todos.map((i) => i.descripcion))].sort((a, b) => a.localeCompare(b));
  const lista = todos.filter((i) => (!filtroIngresosDesde || i.fecha >= filtroIngresosDesde) && (!filtroIngresosHasta || i.fecha <= filtroIngresosHasta));
  const cuentas = saldos.cuentas.map((c) => c.nombre);
  const cuentaElegida = cuentas.includes(cuentaIngresoForm) ? cuentaIngresoForm : cuentas[0];
  const tasaRetencion = saldos.retencion || 0;
  const fecha = fechaIngresoForm || fechaHoyISO();
  app.innerHTML = `
    <div class="gastos-pantalla">
      ${ingresosTabToggleHtml()}
      <div class="cierre-titulo-fila" style="margin-top:0">
        <h2>Nuevo ingreso</h2>
        ${botonAyudaHtml('ayuda-ingresos', 'Ingresos', '<p>Para plata que entra y no es de las ventas, como los alquileres que cobrás. No suma a las estadísticas del negocio.</p><p>Si se lo transfirieron a un banco o app, el banco retiene un porcentaje antes de que llegue (el de <em>Caja → ⋮ Retención</em>): elegí <em>Transferencia</em> en <em>Cómo entró</em> y se descuenta solo. Si no hubo retención, elegí <em>Sin retención</em>.</p><p>Elegís en qué cuenta entró: un banco o app (la misma del negocio, pero se anota en su parte <em>personal</em>) o <em>Efectivo personal</em>. La caja del negocio no la cuenta. En la pastilla <em>Cuentas</em> ves cuánto hay en cada una.</p>', 'izquierda')}
      </div>
      <div class="panel gasto-form">
        <div class="gasto-fila">
          <div class="gasto-campo">
            <span>Fecha</span>
            ${selectorFechaHtml('ingreso-fecha', fecha)}
          </div>
          <label class="gasto-campo">
            <span>Categoría</span>
            <select id="ingreso-categoria">
              <option value="">Elegí una…</option>
              ${categorias.map((cat) => `<option value="${cat.id}" ${String(cat.id) === String(categoriaIngresoForm) ? 'selected' : ''}>${esc(cat.nombre)}</option>`).join('')}
            </select>
          </label>
          <label class="gasto-campo gasto-campo-grande">
            <span>Descripción</span>
            ${campoLimpiableHtml('<input type="text" id="ingreso-descripcion" maxlength="200" placeholder="Ej: Gabriela" autocomplete="off" />')}
            ${sugeridasIngresoHtml(descripciones, 'ingreso-sugerencias')}
          </label>
          <label class="gasto-campo">
            <span>Monto</span>
            <div class="input-moneda"><span>$</span><input type="text" id="ingreso-monto" inputmode="decimal" autocomplete="off" /></div>
          </label>
        </div>
        <div class="gasto-fila">
          <label class="gasto-campo">
            <span>Entró en</span>
            <select id="ingreso-cuenta">
              ${cuentas.map((n) => `<option value="${esc(n)}" ${n === cuentaElegida ? 'selected' : ''}>${esc(n)}</option>`).join('')}
            </select>
          </label>
          <label class="gasto-campo" id="ingreso-como-campo" ${cuentaElegida === 'Efectivo personal' || !tasaRetencion ? 'hidden' : ''}>
            <span>Cómo entró</span>
            <select id="ingreso-como">
              <option value="transferencia" ${comoIngresoForm === 'transferencia' ? 'selected' : ''}>Transferencia (retiene ${String(tasaRetencion).replace('.', ',')} %)</option>
              <option value="sin_retencion" ${comoIngresoForm === 'sin_retencion' ? 'selected' : ''}>Sin retención</option>
            </select>
          </label>
          <label class="gasto-campo gasto-campo-observacion">
            <span>Observación (opcional)</span>
            ${campoLimpiableHtml('<input type="text" id="ingreso-observacion" maxlength="300" placeholder="Ej: mes de septiembre, adelanto" autocomplete="off" />')}
          </label>
          <button type="button" id="btn-agregar-ingreso" class="btn-redondo btn-mas" aria-label="Agregar ingreso" title="Agregar ingreso">+</button>
        </div>
        <div class="gasto-fila gasto-fila-acciones">
          <button type="button" id="btn-limpiar-ingreso" class="btn-limpiar">Limpiar</button>
          <button type="button" id="btn-rendimiento" class="btn-accion">Interés</button>
          <button type="button" id="btn-reintegro" class="btn-accion">Reintegro</button>
        </div>
        <p id="error-ingreso" class="error-msg" style="display:none"></p>
      </div>
      <h2>Ingresos cargados</h2>
      <div class="toolbar toolbar-junta">
        <span id="ingresos-total" class="gastos-total-barra"></span>
        ${selectorRangoHtml('filtro-rango-ingresos', filtroIngresosDesde, filtroIngresosHasta)}
        <input type="text" id="buscar-ingreso" class="buscador" placeholder="Buscar" value="${esc(busquedaIngresos)}" autocomplete="off" />
        ${filtrosListaHtml('filtros-ingresos', [
          {
            nombre: 'origen',
            titulo: 'Descripción',
            opciones: [['todos', 'Todas'], ...origenes.map((o) => [o, o])],
            actual: filtroOrigenIngresos,
            porDefecto: 'todos',
          },
          {
            nombre: 'cuenta',
            titulo: 'Entró en',
            opciones: [['todos', 'Todas'], ...cuentas.map((n) => [n, n]), ['ninguna', 'Sin cuenta (anteriores)']],
            actual: filtroCuentaIngresos,
            porDefecto: 'todos',
          },
        ])}
      </div>
      <table class="tabla-ingresos">
        <thead><tr><th>Día</th><th>Categoría</th><th>Descripción</th><th>Entró en</th><th>Monto</th><th></th></tr></thead>
        <tbody id="ingresos-body"></tbody>
      </table>
    </div>`;
  vincularIngresosTabToggle();
  vincularCobrosTabToggle();
  vincularBotonAyuda('ayuda-ingresos');
  vincularFormatoMoneda(document.getElementById('ingreso-monto'));
  const pintarIngresos = () => {
    const q = normalizarTexto(busquedaIngresos.trim());
    const visibles = lista.filter(
      (i) =>
        (filtroCuentaIngresos === 'todos' || (filtroCuentaIngresos === 'ninguna' ? !i.cuenta : i.cuenta === filtroCuentaIngresos)) &&
        (filtroOrigenIngresos === 'todos' || i.descripcion === filtroOrigenIngresos) &&
        (!q || normalizarTexto(`${i.descripcion} ${i.categoria || ''} ${i.observacion || ''} ${i.cuenta || ''}`).includes(q))
    );
    const total = visibles.reduce((acc, i) => acc + i.monto, 0);
    document.getElementById('ingresos-total').textContent = visibles.length ? `Total: $${formatearMoneda(total)}` : '';
    document.getElementById('ingresos-body').innerHTML = visibles.length
      ? visibles
          .map(
            (i) => `<tr>
            <td>${formatearFechaCorta(i.fecha)}</td>
            <td>${esc(i.categoria || '')}</td>
            <td>${esc(i.descripcion)}${i.observacion ? `<div class="gasto-detalle-cheque">${esc(i.observacion)}</div>` : ''}</td>
            <td>${i.cuenta ? esc(i.cuenta) : '<span class="texto-suave">Sin cuenta</span>'}${i.cuenta && !i.fondo_personal ? ' <span class="etiqueta-gasto" title="Cargado antes de Fondos personales: sigue sumando a la caja del negocio">caja</span>' : ''}</td>
            <td>$${formatearMoneda(i.monto)}${i.retencion ? `<div class="gasto-detalle-cheque">retención $${formatearMoneda(i.retencion)}</div>` : ''}</td>
            <td class="celda-centrada"><button type="button" class="btn-redondo btn-tacho quitar-ingreso" data-id="${i.id}" aria-label="Quitar ingreso: ${esc(i.descripcion)}" title="Quitar ingreso">${TACHITO_SVG}</button></td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="6">No hay ingresos en ese período.</td></tr>';
    vincularQuitarIngresos();
  };
  vincularFiltrosLista('filtros-ingresos', (grupo, valor) => {
    if (grupo === 'origen') filtroOrigenIngresos = valor;
    else filtroCuentaIngresos = valor;
    renderIngresos();
  });
  document.getElementById('buscar-ingreso').addEventListener('input', (e) => {
    busquedaIngresos = e.target.value;
    pintarIngresos();
  });
  vincularSelectorRango('filtro-rango-ingresos', filtroIngresosDesde, filtroIngresosHasta, ({ desde, hasta }) => {
    filtroIngresosDesde = desde;
    filtroIngresosHasta = hasta;
    renderIngresos();
  });
  const inputDescripcion = document.getElementById('ingreso-descripcion');
  vincularCampoLimpiable(inputDescripcion);
  vincularSelectorFecha('ingreso-fecha', fecha, (nueva) => {
    fechaIngresoForm = nueva || fechaHoyISO();
    renderIngresos();
  });
  const inputMonto = document.getElementById('ingreso-monto');
  vincularSugeridasIngreso({
    idContenedor: 'ingreso-sugerencias',
    inputDescripcion,
    selectCategoria: document.getElementById('ingreso-categoria'),
    alElegir: (chip) => {
      const monto = Number(chip && chip.dataset.monto);
      if (monto > 0) inputMonto.value = formatearMoneda(monto);
      const cuentaSugerida = chip && chip.dataset.cuenta;
      if (cuentaSugerida && cuentas.includes(cuentaSugerida)) document.getElementById('ingreso-cuenta').value = cuentaSugerida;
      inputMonto.focus();
      inputMonto.select();
    },
    alSacar: () => renderIngresos(),
  });
  document.getElementById('ingreso-cuenta').addEventListener('change', (e) => {
    document.getElementById('ingreso-como-campo').hidden = e.target.value === 'Efectivo personal' || !tasaRetencion;
  });
  document.getElementById('btn-rendimiento').addEventListener('click', () => abrirIngresoDirecto('rendimiento', cuentas, renderIngresos));
  document.getElementById('btn-reintegro').addEventListener('click', () => abrirIngresoDirecto('reintegro', cuentas, renderIngresos));
  document.getElementById('btn-limpiar-ingreso').addEventListener('click', () => {
    fechaIngresoForm = null;
    cuentaIngresoForm = '';
    categoriaIngresoForm = '';
    comoIngresoForm = 'transferencia';
    renderIngresos();
  });
  const agregar = async () => {
    const errorEl = document.getElementById('error-ingreso');
    const cuenta = document.getElementById('ingreso-cuenta').value;
    const categoria = document.getElementById('ingreso-categoria').value;
    const iso = fechaCortaAIso(document.getElementById('ingreso-fecha').value);
    const resultado = !iso
      ? { ok: false, error: 'La fecha no es válida.' }
      : await window.freska.ingresos.crear({
          fecha: iso,
          categoria_id: categoria,
          descripcion: inputDescripcion.value,
          monto: limpiarNumeroMoneda(inputMonto.value),
          cuenta,
          con_retencion: document.getElementById('ingreso-como').value === 'transferencia',
          observacion: document.getElementById('ingreso-observacion').value,
        });
    if (!resultado.ok) {
      errorEl.textContent = resultado.error;
      errorEl.style.display = 'block';
      return;
    }
    cuentaIngresoForm = cuenta;
    categoriaIngresoForm = ''; // la categoría vuelve a "Elegí una…" (la cuenta y el modo sí quedan, para cargar el siguiente)
    comoIngresoForm = document.getElementById('ingreso-como').value;
    mostrarToast('Ingreso cargado.', 'ok');
    await renderIngresos();
    document.getElementById('ingreso-descripcion')?.focus();
  };
  document.getElementById('btn-agregar-ingreso').addEventListener('click', agregar);
  inputMonto.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    agregar();
  });
  function vincularQuitarIngresos() {
  app.querySelectorAll('.quitar-ingreso').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ingreso = lista.find((i) => i.id === Number(btn.dataset.id));
      if (!ingreso) return;
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Quitar ingreso</h3>
        <p>¿Seguro que querés quitar este ingreso?</p>
        <p><strong>${esc(ingreso.descripcion)}</strong> — $${formatearMoneda(ingreso.monto)}</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, quitar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        await window.freska.ingresos.eliminar(ingreso.id);
        cerrarModal();
        mostrarToast('Ingreso quitado.', 'ok');
        renderIngresos();
      });
    });
  });
  }
  pintarIngresos();
}

async function renderCategoriasIngreso() {
  const [categorias, descripciones, categoriasPersonales] = await Promise.all([
    window.freska.ingresos.categorias(),
    window.freska.ingresos.descripciones(),
    window.freska.ingresos.categoriasGastosPersonales(),
  ]);
  const porCategoria = {};
  descripciones.forEach((d) => {
    (porCategoria[d.categoria_id] = porCategoria[d.categoria_id] || []).push(d);
  });
  Object.values(porCategoria).forEach((l) => l.sort((a, b) => a.nombre.localeCompare(b.nombre)));

  // Una categoría con su fila y el detalle desplegable de descripciones (la usan las dos listas; cada una trae su propio tachito).
  const filaCategoriaHtml = (cat, claseQuitar) => {
    const l = porCategoria[cat.id] || [];
    const abierta = categoriasIngresoAbiertas.has(cat.id);
    return `<tr class="fila-clickeable fila-categoria-gasto" tabindex="0" data-id="${cat.id}">
            <td><span class="icono-fila ${abierta ? 'abierto' : ''}">▾</span>${esc(cat.nombre)} <span class="cantidad-descripciones">${l.length ? `(${l.length})` : ''}</span></td>
            <td><button type="button" class="btn-redondo btn-tacho ${claseQuitar}" data-id="${cat.id}" data-nombre="${esc(cat.nombre)}" aria-label="Quitar ${esc(cat.nombre)}" title="Quitar categoría">${TACHITO_SVG}</button></td>
          </tr>
          <tr class="detalle-categoria-gasto" data-detalle-de="${cat.id}" ${abierta ? '' : 'style="display:none"'}>
            <td colspan="2">
    <div class="descripciones-linea">
    ${
      l.length
        ? `<div class="retiro-sugerencias">${l
            .map(
              (d) => `<span class="chip-retiro-grupo"><span class="chip-retiro-texto">${esc(d.nombre)}</span><button type="button" class="chip-retiro-x quitar-descripcion-categoria-ingreso" data-id="${d.id}" data-nombre="${esc(d.nombre)}" aria-label="Sacar ${esc(d.nombre)}" title="Sacar descripción">×</button></span>`
            )
            .join('')}</div>`
        : '<p class="ayuda-campo">Todavía no tiene descripciones.</p>'
    }
    <div class="agregar-descripcion-categoria">
      <button type="button" class="btn-redondo btn-mas btn-mostrar-descripcion-categoria-ingreso ${descripcionAbiertaCategoriaIngreso === cat.id ? 'abierto' : ''}" data-categoria="${cat.id}" aria-label="Agregar descripción a ${esc(cat.nombre)}" aria-expanded="${descripcionAbiertaCategoriaIngreso === cat.id}" title="Agregar descripción">+</button>
      <input type="text" class="nueva-descripcion-categoria-ingreso" data-categoria="${cat.id}" maxlength="200" placeholder="Nueva descripción (Enter para agregar)" autocomplete="off" ${descripcionAbiertaCategoriaIngreso === cat.id ? '' : 'hidden'} />
    </div>
    </div>
    <p class="error-msg error-descripcion-categoria-ingreso" style="display:none"></p>
            </td>
          </tr>`;
  };


  app.innerHTML = `
    <div class="gastos-pantalla">
      ${ingresosTabToggleHtml()}
      <div class="cierre-titulo-fila" style="margin-top:0">
        <h2>Categorías</h2>
        ${botonAyudaHtml('ayuda-categorias-ingreso', 'Categorías', '<p>Son las opciones que aparecen al cargar un ingreso o un gasto de propiedades: una sola lista para los dos. Es propia de Fondos personales: no se mezcla con las categorías de Gastos. Tocá una categoría para ver y armar sus descripciones (por ejemplo, un inquilino): las que agregues acá te aparecen como sugeridas al elegirla en un ingreso.</p><p>Más abajo, <em>Gastos privados</em> tiene su propia lista, aparte, para cargar gastos privados en la pastilla Gastos. Funciona igual: tocá una categoría para armar sus descripciones sugeridas.</p><p>Lo ya cargado no se borra.</p>', 'izquierda')}
      </div>
      <table class="angosto tabla-categorias-gasto">
        <tbody>
          <tr class="fila-ambito-categoria"><td colspan="2"><span>Ingresos y propiedades</span><button type="button" class="btn-redondo btn-mas btn-mas-ambito ${mostrarFormCategoriaIngreso ? 'abierto' : ''}" id="btn-agregar-categoria-ingreso" aria-label="Agregar categoría" title="Agregar categoría">+</button></td></tr>
          ${
            mostrarFormCategoriaIngreso
              ? `<tr class="fila-form-categoria"><td colspan="2"><form id="form-categoria-ingreso" class="form-categoria-inline"><input type="text" id="nueva-categoria-ingreso" placeholder="Nombre de la categoría" maxlength="80" autocomplete="off" required /><button type="submit" class="primary">Guardar</button><button type="button" id="btn-cancelar-categoria-ingreso">Cancelar</button></form><p id="error-categoria-ingreso" class="error-msg" style="display:none"></p></td></tr>`
              : ''
          }
          ${categorias.map((cat) => filaCategoriaHtml(cat, 'quitar-categoria-ingreso')).join('')}
          <tr class="fila-ambito-categoria"><td colspan="2"><span>Gastos privados</span><button type="button" class="btn-redondo btn-mas btn-mas-ambito ${mostrarFormCategoriaGastoPersonal ? 'abierto' : ''}" id="btn-agregar-categoria-personal" aria-label="Agregar categoría de gastos privados" title="Agregar categoría">+</button></td></tr>
          ${
            mostrarFormCategoriaGastoPersonal
              ? `<tr class="fila-form-categoria"><td colspan="2"><form id="form-categoria-personal" class="form-categoria-inline"><input type="text" id="nueva-categoria-personal" placeholder="Nombre de la categoría" maxlength="80" autocomplete="off" required /><button type="submit" class="primary">Guardar</button><button type="button" id="btn-cancelar-categoria-personal">Cancelar</button></form><p id="error-categoria-personal" class="error-msg" style="display:none"></p></td></tr>`
              : ''
          }
          ${
            categoriasPersonales.length
              ? categoriasPersonales.map((cat) => filaCategoriaHtml(cat, 'quitar-categoria-personal')).join('')
              : '<tr><td colspan="2" class="ayuda-campo">Todavía no hay categorías de gastos privados: agregá la primera con el +.</td></tr>'
          }
        </tbody>
      </table>
    </div>
  `;

  vincularIngresosTabToggle();
  vincularBotonAyuda('ayuda-categorias-ingreso');
  document.getElementById('btn-agregar-categoria-personal').addEventListener('click', async () => {
    mostrarFormCategoriaGastoPersonal = !mostrarFormCategoriaGastoPersonal;
    await renderCategoriasIngreso();
    document.getElementById('nueva-categoria-personal')?.focus();
  });
  if (mostrarFormCategoriaGastoPersonal) {
    document.getElementById('btn-cancelar-categoria-personal').addEventListener('click', () => {
      mostrarFormCategoriaGastoPersonal = false;
      renderCategoriasIngreso();
    });
    document.getElementById('form-categoria-personal').addEventListener('submit', async (e) => {
      e.preventDefault();
      const resultado = await window.freska.ingresos.crearCategoriaGastoPersonal(document.getElementById('nueva-categoria-personal').value);
      if (!resultado.ok) {
        const errorEl = document.getElementById('error-categoria-personal');
        errorEl.textContent = resultado.error;
        errorEl.style.display = 'block';
        return;
      }
      mostrarFormCategoriaGastoPersonal = false;
      mostrarToast('Categoría guardada.', 'ok');
      renderCategoriasIngreso();
    });
  }
  app.querySelectorAll('.quitar-categoria-personal').forEach((btn) => {
    btn.addEventListener('click', () => {
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Quitar categoría</h3>
        <p>¿Quitar <strong>${esc(btn.dataset.nombre)}</strong>? Los gastos ya cargados con esta categoría no se borran; solo deja de ofrecerse para cargar nuevos.</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, quitar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        await window.freska.ingresos.quitarCategoriaGastoPersonal(Number(btn.dataset.id));
        cerrarModal();
        mostrarToast('Categoría quitada.', 'ok');
        renderCategoriasIngreso();
      });
    });
  });
  document.getElementById('btn-agregar-categoria-ingreso').addEventListener('click', async () => {
    mostrarFormCategoriaIngreso = !mostrarFormCategoriaIngreso;
    await renderCategoriasIngreso();
    document.getElementById('nueva-categoria-ingreso')?.focus();
  });
  if (mostrarFormCategoriaIngreso) {
    document.getElementById('btn-cancelar-categoria-ingreso').addEventListener('click', () => {
      mostrarFormCategoriaIngreso = false;
      renderCategoriasIngreso();
    });
    document.getElementById('form-categoria-ingreso').addEventListener('submit', async (e) => {
      e.preventDefault();
      const resultado = await window.freska.ingresos.crearCategoria(document.getElementById('nueva-categoria-ingreso').value);
      if (!resultado.ok) {
        const errorEl = document.getElementById('error-categoria-ingreso');
        errorEl.textContent = resultado.error;
        errorEl.style.display = 'block';
        return;
      }
      mostrarFormCategoriaIngreso = false;
      mostrarToast('Categoría guardada.', 'ok');
      renderCategoriasIngreso();
    });
  }

  app.querySelectorAll('tr.fila-categoria-gasto').forEach((fila) => {
    const alternar = () => {
      const idCategoria = Number(fila.dataset.id);
      const detalle = app.querySelector(`tr.detalle-categoria-gasto[data-detalle-de="${idCategoria}"]`);
      const abrir = detalle.style.display === 'none';
      detalle.style.display = abrir ? '' : 'none';
      fila.querySelector('.icono-fila').classList.toggle('abierto', abrir);
      if (abrir) categoriasIngresoAbiertas.add(idCategoria);
      else categoriasIngresoAbiertas.delete(idCategoria);
    };
    fila.addEventListener('click', (e) => {
      if (e.target.closest('.quitar-categoria-ingreso, .quitar-categoria-personal')) return;
      alternar();
    });
    fila.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === fila) alternar();
    });
  });

  const agregarDescripcion = async (idCategoria) => {
    const detalle = app.querySelector(`tr.detalle-categoria-gasto[data-detalle-de="${idCategoria}"]`);
    const input = detalle.querySelector('.nueva-descripcion-categoria-ingreso');
    const resultado = await window.freska.ingresos.crearDescripcion({ nombre: input.value, categoria_id: idCategoria });
    if (!resultado.ok) {
      const errorEl = detalle.querySelector('.error-descripcion-categoria-ingreso');
      errorEl.textContent = resultado.error;
      errorEl.style.display = 'block';
      return;
    }
    categoriasIngresoAbiertas.add(idCategoria);
    descripcionAbiertaCategoriaIngreso = idCategoria;
    await renderCategoriasIngreso();
    app.querySelector(`.nueva-descripcion-categoria-ingreso[data-categoria="${idCategoria}"]`)?.focus();
  };
  app.querySelectorAll('.btn-mostrar-descripcion-categoria-ingreso').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idCategoria = Number(btn.dataset.categoria);
      const input = app.querySelector(`.nueva-descripcion-categoria-ingreso[data-categoria="${idCategoria}"]`);
      const abrir = input.hidden;
      input.hidden = !abrir;
      btn.classList.toggle('abierto', abrir);
      btn.setAttribute('aria-expanded', String(abrir));
      descripcionAbiertaCategoriaIngreso = abrir ? idCategoria : null;
      if (abrir) input.focus();
    });
  });
  app.querySelectorAll('.nueva-descripcion-categoria-ingreso').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        agregarDescripcion(Number(input.dataset.categoria));
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        app.querySelector(`.btn-mostrar-descripcion-categoria-ingreso[data-categoria="${input.dataset.categoria}"]`).click();
      }
    });
  });
  app.querySelectorAll('.quitar-descripcion-categoria-ingreso').forEach((btn) => {
    btn.addEventListener('click', () => {
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Sacar descripción</h3>
        <p>¿Sacar <strong>${esc(btn.dataset.nombre)}</strong> de las descripciones sugeridas?</p>
        <p class="pin-subtitulo">Los ingresos que ya cargaste con esa descripción no se borran. Si volvés a cargar uno, reaparece.</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, sacar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        await window.freska.ingresos.quitarDescripcion(Number(btn.dataset.id));
        cerrarModal();
        mostrarToast('Descripción sacada.', 'ok');
        renderCategoriasIngreso();
      });
    });
  });
  app.querySelectorAll('.quitar-categoria-ingreso').forEach((btn) => {
    btn.addEventListener('click', () => {
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Quitar categoría</h3>
        <p>¿Quitar <strong>${esc(btn.dataset.nombre)}</strong>? Los ingresos ya cargados con esta categoría no se borran; solo deja de ofrecerse para cargar nuevos.</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, quitar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        await window.freska.ingresos.quitarCategoria(Number(btn.dataset.id));
        cerrarModal();
        mostrarToast('Categoría quitada.', 'ok');
        renderCategoriasIngreso();
      });
    });
  });
}
