// Cobros: pendientes, historial y resumen por método.
// (Antes todo estaba en renderer.js; se dividió por pantalla el 2026-09-24. Los archivos son scripts comunes que
// comparten el mismo espacio global: se cargan en el orden de index.html y no hace falta importar nada.)

let vistaCobrosTab = 'pendientes';
let busquedaCobrosCierre = '';
let filtroMetodoCobrosCierre = 'todos';

// Cuántos cheques hay en cartera (se muestra en el botón "Cheques" de Cobros; lo actualiza `renderCobros`).
let cantidadChequesCartera = 0;

function cobrosTabToggleHtml() {
  return `
    ${negocioToggleHtml('cobros')}
    <div class="cobros-fila-pastillas">
      <div class="reportes-toggle">
        <button type="button" class="toggle ${vistaCobrosTab === 'pendientes' ? 'active' : ''}" data-cobros-tab="pendientes">Pendientes</button>
        <button type="button" class="toggle ${vistaCobrosTab === 'historial' ? 'active' : ''}" data-cobros-tab="historial">Historial de cobros</button>
      </div>
      ${
        sesionActual && sesionActual.rol === 'empleado'
          ? ''
          : `<div class="cobros-acciones">
        <button type="button" class="btn-accion" data-operacion-cobros="interes">Interés</button>
        <button type="button" class="btn-accion" data-operacion-cobros="reintegro">Reintegro</button>
      </div>`
      }
    </div>`;
}

function vincularCobrosTabToggle() {
  vincularNegocioToggle();
  // Interés y Reintegro del negocio: el mismo cuadro que usa la Caja general; al guardar se vuelve a dibujar Cobros.
  app.querySelectorAll('[data-operacion-cobros]').forEach((btn) => {
    btn.addEventListener('click', () => abrirOperacionDesde(btn.dataset.operacionCobros, () => renderCobros()));
  });
  app.querySelectorAll('.toggle[data-cobros-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      vistaCobrosTab = btn.dataset.cobrosTab;
      renderCobros();
    });
  });
}

async function renderCobros() {
  if (vistaCobrosTab === 'historial') {
    await renderHistorialCobros();
    return;
  }

  const clientes = await window.freska.clientes.listar();
  const conSaldo = clientes.filter((c) => c.saldo > 0).sort((a, b) => b.saldo - a.saldo);
  const totalPendiente = conSaldo.reduce((acc, c) => acc + c.saldo, 0);

  app.innerHTML = `
    ${cobrosTabToggleHtml()}
    <div class="toolbar toolbar-junta"><p class="total-pendiente-cobro">Pendiente de cobro: <strong>$${formatearMoneda(totalPendiente)}</strong></p><input type="text" id="buscar-cobro" class="buscador" placeholder="Buscar cliente" /></div>
    <table>
      <thead><tr><th>Nombre</th><th>Saldo</th><th></th></tr></thead>
      <tbody id="cobros-body">
        ${
          conSaldo.length === 0
            ? '<tr><td colspan="3">Ningún cliente tiene saldo pendiente.</td></tr>'
            : conSaldo
                .map(
                  (c) => `
          <tr class="fila-clickeable" tabindex="0" data-id="${c.id}" data-nombre="${esc(textoBusquedaCliente(c))}">
            <td>${esc(nombreConNegocio(c))}</td>
            <td>$${formatearMoneda(c.saldo)}</td>
            <td class="acciones-cliente">
              <button class="cobrar-cliente primary" data-id="${c.id}">Cobrar</button>
            </td>
          </tr>`
                )
                .join('')
        }
      </tbody>
    </table>
  `;

  vincularCobrosTabToggle();
  document.getElementById('buscar-cobro').focus();

  document.getElementById('buscar-cobro').addEventListener('input', (e) => {
    const query = normalizarTexto(e.target.value.trim());
    document.querySelectorAll('#cobros-body tr[data-nombre]').forEach((fila) => {
      fila.style.display = normalizarTexto(fila.dataset.nombre).includes(query) ? '' : 'none';
    });
  });

  app.querySelectorAll('.cobrar-cliente').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cliente = conSaldo.find((c) => c.id === Number(btn.dataset.id));
      if (!cliente) return;
      abrirRegistroPagoCliente(cliente, renderCobros);
    });
  });

  app.querySelectorAll('#cobros-body tr[data-id]').forEach((fila) => {
    const abrirHistorial = () => {
      mostrarDatosFichaCliente = false;
      limiteHistorialFicha = MOVIMIENTOS_POR_PAGINA;
      origenFichaCliente = 'cobros';
      renderClienteDetalle(Number(fila.dataset.id));
    };
    fila.addEventListener('click', (e) => {
      if (e.target.closest('.acciones-cliente')) return;
      abrirHistorial();
    });
    fila.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === fila) abrirHistorial();
    });
  });
}

// Estado del cierre de caja de un día para la columna del Historial de cobros.
function estadoCierreHtml(resumen) {
  if (!resumen) return '<span class="estado-cierre estado-cierre-nada">Sin cerrar</span>';
  if (resumen.diferencia === null) return '<span class="estado-cierre estado-cierre-nada">Sin contar</span>';
  if (resumen.diferencia === 0) return '<span class="estado-cierre estado-cierre-ok">Cierra justo</span>';
  const texto = resumen.diferencia > 0 ? `Sobran $${formatearMoneda(resumen.diferencia)}` : `Faltan $${formatearMoneda(-resumen.diferencia)}`;
  return `<span class="estado-cierre estado-cierre-mal">${texto}</span>`;
}

// Ventana "Cobros del día": un bloque por cliente (el nombre una sola vez) y, debajo, una línea por cada método con
// el que pagó. La suma de abajo es el mismo total que muestra la tabla.
async function abrirCobrosDelDia(fecha) {
  const filas = await window.freska.reportes.cobrosDelDia(fecha);
  let total = 0;
  let anterior = null;
  const renglones = filas
    .map((f) => {
      total = redondearPesos(total + f.monto);
      const nuevoCliente = f.cliente_id !== anterior;
      anterior = f.cliente_id;
      const nombre = f.cliente_id == null ? 'Sin cliente' : nombreConNegocio(f);
      return `<tr class="${nuevoCliente ? 'cobros-dia-nuevo' : ''}">
        <td>${nuevoCliente ? (f.cliente_id == null ? esc(nombre) : `<button type="button" class="enlace-boton ir-cliente-cobro-dia" data-id="${f.cliente_id}">${esc(nombre)}</button>`) : ''}</td>
        <td>${esc(f.metodo_pago)}</td>
        <td>${f.monto < 0 ? '<span class="monto-negativo">-$' + formatearMoneda(-f.monto) + '</span>' : '$' + formatearMoneda(f.monto)}</td>
      </tr>`;
    })
    .join('');
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Cobros del ${formatearPeriodo(fecha, 'dia')}</h3>
    ${
      filas.length === 0
        ? '<p>No hay cobros ese día.</p>'
        : `<table class="cobros-dia-tabla">
      <thead><tr><th>Cliente</th><th>Cómo pagó</th><th>Monto</th></tr></thead>
      <tbody>${renglones}</tbody>
      <tfoot><tr><td><strong>Total</strong></td><td></td><td><strong>$${formatearMoneda(total)}</strong></td></tr></tfoot>
    </table>`
    }`);
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.querySelectorAll('.ir-cliente-cobro-dia').forEach((btn) => {
    btn.addEventListener('click', () => {
      cerrarModal();
      mostrarDatosFichaCliente = false;
      limiteHistorialFicha = MOVIMIENTOS_POR_PAGINA;
      origenFichaCliente = 'cobros';
      renderClienteDetalle(Number(btn.dataset.id));
    });
  });
}

function agruparCobrosDiariosPorMes(filasDiarias) {
  const totales = {};
  filasDiarias.forEach((f) => {
    const clave = `${f.periodo.slice(0, 7)}|${f.metodo_pago}`;
    totales[clave] = redondearPesos((totales[clave] || 0) + f.total);
  });
  return Object.entries(totales).map(([clave, total]) => {
    const [periodo, metodo_pago] = clave.split('|');
    return { periodo, metodo_pago, total };
  });
}

async function renderHistorialCobros() {
  // La caja (fondo, efectivo, gastos en efectivo) es plata: un empleado no la ve, así que ni se pide.
  const puedeVerCaja = !sesionActual || sesionActual.rol === 'admin';
  const [cobrosDiarios, metodosPago, resumenCierres] = await Promise.all([
    window.freska.reportes.cobrosPorDia(),
    window.freska.metodosPago.listar(),
    vistaCobros === 'dia' && puedeVerCaja ? window.freska.caja.resumenCierres() : Promise.resolve([]),
  ]);
  // Por mes se arma sumando los días que caen dentro del rango elegido (todos, si no hay rango).
  const cobrosCrudos =
    vistaCobros === 'dia'
      ? cobrosDiarios
      : agruparCobrosDiariosPorMes(cobrosDiarios.filter((c) => (!filtroMesDesde || c.periodo >= filtroMesDesde) && (!filtroMesHasta || c.periodo <= filtroMesHasta)));
  const cierrePorDia = {};
  resumenCierres.forEach((c) => {
    cierrePorDia[c.fecha] = c;
  });
  const nombresMetodos = metodosPago.map((m) => m.nombre);
  let cobros = pivotarCobros(cobrosCrudos, nombresMetodos);
  if (vistaCobros === 'dia' && filtroFechaCobros) {
    cobros = cobros.filter((c) => c.periodo === filtroFechaCobros);
  }
  const metodosVisibles = nombresMetodos.filter((n) => !metodosOcultos.has(n));
  const totalFila = (c) => metodosVisibles.reduce((acc, n) => acc + (c.porMetodo[n] || 0), 0);

  app.innerHTML = `
    ${cobrosTabToggleHtml()}
    <div class="toolbar toolbar-junta">
      <div class="reportes-toggle">
        <button class="toggle ${vistaCobros === 'dia' ? 'active' : ''}" data-vista="dia">Por día</button>
        <button class="toggle ${vistaCobros === 'mes' ? 'active' : ''}" data-vista="mes">Por mes</button>
      </div>
      ${vistaCobros === 'dia' ? selectorFechaHtml('filtro-fecha-cobros', filtroFechaCobros) : selectorRangoHtml('filtro-rango-cobros', filtroMesDesde, filtroMesHasta)}
    </div>
    ${
      vistaCobros === 'mes'
        ? `
    <div class="filtros-mes">
      <div class="filtro-metodos">
        ${nombresMetodos
          .map(
            (n) =>
              `<label><input type="checkbox" class="filtro-metodo-check" value="${esc(n)}" ${metodosOcultos.has(n) ? '' : 'checked'} /> ${esc(n)}</label>`
          )
          .join('')}
      </div>
    </div>`
        : ''
    }
    <table>
        <thead>
          <tr>
            <th>${vistaCobros === 'dia' ? 'Día' : 'Mes'}</th>
            ${metodosVisibles.map((nombre) => `<th>${esc(nombre)}</th>`).join('')}
            <th>Total</th>
            ${vistaCobros === 'dia' && puedeVerCaja ? '<th>Cierre de caja</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${
            cobros.length === 0
              ? `<tr><td colspan="${metodosVisibles.length + (vistaCobros === 'dia' ? 3 : 2)}">Todavía no hay cobros registrados.</td></tr>`
              : cobros
                  .map(
                    (c) => `
            <tr ${vistaCobros === 'dia' && puedeVerCaja ? `class="fila-clickeable" tabindex="0" data-fecha="${c.periodo}"` : ''}>
              <td>${formatearPeriodo(c.periodo, vistaCobros)}</td>
              ${metodosVisibles.map((nombre) => `<td>$${formatearMoneda(c.porMetodo[nombre] || 0)}</td>`).join('')}
              <td>${vistaCobros === 'dia' && puedeVerCaja ? `<button type="button" class="enlace-boton btn-total-cobrado" data-fecha="${c.periodo}" title="Ver de dónde sale este total"><strong>$${formatearMoneda(totalFila(c))}</strong></button>` : `<strong>$${formatearMoneda(totalFila(c))}</strong>`}</td>
              ${vistaCobros === 'dia' && puedeVerCaja ? `<td>${estadoCierreHtml(cierrePorDia[c.periodo])}</td>` : ''}
            </tr>`
                  )
                  .join('')
          }
        </tbody>
      </table>
  `;

  vincularCobrosTabToggle();

  // Tocar un día abre el cierre de caja de ese día (un empleado no tiene filas clickeables: no ve la caja).
  app.querySelectorAll('tr[data-fecha]').forEach((fila) => {
    const abrirCierre = () => {
      fechaCierreCaja = fila.dataset.fecha;
      edicionCierre = null;
      vistaCierreTab = 'dia';
      origenCierreCaja = 'cobros';
      irAVista(document.querySelector('nav button[data-view="cierre"]'));
    };
    fila.addEventListener('click', abrirCierre);
    fila.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === fila) abrirCierre();
    });
  });

  // El total de cada día es un botón: abre quién pagó, con qué y cuánto (para compararlo con el cuaderno).
  app.querySelectorAll('.btn-total-cobrado').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      abrirCobrosDelDia(btn.dataset.fecha);
    });
  });

  app.querySelectorAll('.toggle[data-vista]').forEach((btn) => {
    btn.addEventListener('click', () => {
      vistaCobros = btn.dataset.vista;
      filtroFechaCobros = vistaCobros === 'dia' ? fechaHoyISO() : '';
      renderHistorialCobros();
    });
  });

  vincularSelectorFecha('filtro-fecha-cobros', filtroFechaCobros, (fecha) => {
    filtroFechaCobros = fecha;
    renderHistorialCobros();
  });

  vincularSelectorRango('filtro-rango-cobros', filtroMesDesde, filtroMesHasta, ({ desde, hasta }) => {
    filtroMesDesde = desde;
    filtroMesHasta = hasta;
    renderHistorialCobros();
  });

  app.querySelectorAll('.filtro-metodo-check').forEach((check) => {
    check.addEventListener('change', () => {
      if (check.checked) {
        metodosOcultos.delete(check.value);
      } else {
        metodosOcultos.add(check.value);
      }
      renderHistorialCobros();
    });
  });
}

let vistaCobros = 'dia';

let filtroFechaCobros = fechaHoyISO();
let filtroMesDesde = '';
let filtroMesHasta = '';
let metodosOcultos = new Set();

function pivotarCobros(filas, nombresMetodos) {
  const porPeriodo = {};
  filas.forEach((f) => {
    if (!porPeriodo[f.periodo]) {
      porPeriodo[f.periodo] = { periodo: f.periodo, porMetodo: {}, total: 0 };
    }
    porPeriodo[f.periodo].porMetodo[f.metodo_pago] =
      (porPeriodo[f.periodo].porMetodo[f.metodo_pago] || 0) + f.total;
    porPeriodo[f.periodo].total += f.total;
    if (!nombresMetodos.includes(f.metodo_pago)) nombresMetodos.push(f.metodo_pago);
  });
  return Object.values(porPeriodo).sort((a, b) => (a.periodo < b.periodo ? 1 : -1));
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function formatearPeriodo(periodo, vista) {
  if (vista === 'dia') {
    const [anio, mes, dia] = periodo.split('-');
    return `${dia}/${mes}/${anio}`;
  }
  const [anio, mes] = periodo.split('-');
  return `${MESES[Number(mes) - 1]} ${anio}`;
}

const pantallaPin = document.getElementById('pantalla-pin');
