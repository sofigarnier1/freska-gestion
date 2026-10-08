// Utilidades compartidas: tema, cuadros de diálogo, formato de dinero y fechas, calendario, autocompletado, ayudas y filtros.
// (Antes todo estaba en renderer.js; se dividió por pantalla el 2026-09-24. Los archivos son scripts comunes que
// comparten el mismo espacio global: se cargan en el orden de index.html y no hace falta importar nada.)

function temaGuardado() {
  try {
    return localStorage.getItem('freska-tema');
  } catch (e) {
    return null;
  }
}

function temaEfectivo() {
  const guardado = temaGuardado();
  if (guardado === 'light' || guardado === 'dark') return guardado;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function aplicarTemaGuardado() {
  const guardado = temaGuardado();
  if (guardado === 'light' || guardado === 'dark') {
    document.documentElement.dataset.theme = guardado;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

// El tachito de los botones que borran un registro de una lista (ver `.btn-tacho`).
const TACHITO_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

// El "✓" de los botones de guardar de un campo suelto (ver `.btn-guardar-campo`): campos sensibles
// (retención por transferencia, inflación) que no se guardan solos al salir del campo, para que un click o
// un tab de más no cambie un número de plata sin querer — hay que guardarlos a propósito.
const GUARDAR_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

const app = document.getElementById('app');
// Botones de página: los de cada `.sublista` (Pedidos, Facturas...) más el de Estadísticas, que al no
// tener subpáginas hace las dos veces de botón de grupo y de página (tiene `data-view` y `data-grupo`
// juntos, ver index.html).
const navButtons = document.querySelectorAll('#sidebar [data-view]');
const grupoButtons = document.querySelectorAll('.grupo-boton');
const sidebar = document.getElementById('sidebar');
const migaGrupo = document.getElementById('miga-grupo');
// La última página que se vio dentro de cada grupo (Ventas, Dinero, etc.): al volver a un grupo se abre
// esa, no siempre la primera.
const ultimaVistaPorGrupo = {};

const modalOverlay = document.getElementById('modal-overlay');

// Las ventanas de solo lectura se cierran con una × arriba a la derecha (sin botón "Cerrar" abajo).
function modalXHtml(id = 'modal-cerrar') {
  return `<button type="button" class="modal-x" id="${id}" aria-label="Cerrar" title="Cerrar"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
}
const MODAL_X_HTML = modalXHtml();

// Si el cuadro es más alto que la ventana (una ventana baja, o un cuadro que crece al agregar líneas de pago), se limita
// al alto de la ventana y se puede scrollear por dentro; si no, arriba y abajo quedaban cortados y sin poder llegar. Solo
// se activa cuando hace falta: con `overflow` siempre, los desplegables que salen del cuadro (calendario, listas) se recortarían.
let observadorModal = null;
function ajustarAlturaModal() {
  const tarjeta = modalOverlay.querySelector('.modal-card');
  if (!tarjeta) return;
  // scrollHeight es el alto real del contenido, aunque el cuadro ya esté recortado
  tarjeta.classList.toggle('modal-con-scroll', tarjeta.scrollHeight > window.innerHeight - 24);
}
window.addEventListener('resize', ajustarAlturaModal);

function mostrarModal(html) {
  modalOverlay.innerHTML = `<div class="modal-card">${html}</div>`;
  modalOverlay.classList.add('visible');
  ajustarAlturaModal();
  if (observadorModal) observadorModal.disconnect();
  if (window.ResizeObserver) {
    observadorModal = new ResizeObserver(ajustarAlturaModal);
    observadorModal.observe(modalOverlay.querySelector('.modal-card'));
  }
}

function cerrarModal() {
  if (observadorModal) observadorModal.disconnect();
  modalOverlay.classList.remove('visible');
  modalOverlay.innerHTML = '';
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function distanciaKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function ordenarPorCercania(origenCoords, puntos) {
  const restantes = [...puntos];
  const ordenados = [];
  let actual = origenCoords;
  while (restantes.length > 0) {
    let idxMasCercano = 0;
    let distMinima = Infinity;
    restantes.forEach((p, idx) => {
      const d = distanciaKm(actual, p.coords);
      if (d < distMinima) {
        distMinima = d;
        idxMasCercano = idx;
      }
    });
    const [siguiente] = restantes.splice(idxMasCercano, 1);
    ordenados.push(siguiente);
    actual = siguiente.coords;
  }
  return ordenados;
}

// Qué tan bien coincide un texto (ya normalizado) con lo buscado: 0 = igual, 1 = empieza con eso,
// 2 = alguna palabra empieza con eso, 3 = lo contiene, null = no coincide. Sirve para mostrar
// primero lo que más se parece.
function puntajeCoincidencia(texto, consulta) {
  if (!consulta) return 3;
  if (texto === consulta) return 0;
  if (texto.startsWith(consulta)) return 1;
  if (texto.split(/\s+/).some((palabra) => palabra.startsWith(consulta))) return 2;
  return texto.includes(consulta) ? 3 : null;
}

function normalizarTexto(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Todo texto que escribe el usuario (nombres, notas, domicilios...) se inserta en las pantallas
// con esc(): así siempre se ve como texto y nunca se interpreta como código HTML.
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// La base devuelve activo = 1/0; el resto del código trata "sin dato" como activo.
function clienteActivo(cliente) {
  return cliente.activo !== 0;
}

// Enter en un campo de una edición guarda, igual que apretar "Guardar".
function guardarConEnter(contenedor, selectorBoton) {
  contenedor.querySelectorAll('input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.defaultPrevented) return;
      e.preventDefault();
      contenedor.querySelector(selectorBoton)?.click();
    });
  });
}

function nombreCompleto(cliente) {
  if (!cliente) return '';
  return cliente.apellido ? `${cliente.nombre} ${cliente.apellido}` : cliente.nombre;
}

// Para las listas (Clientes, Cobros, ficha, buscador): el nombre de la persona y, si tiene, el del negocio entre
// paréntesis. En la factura y en la etiqueta de las bolsas se sigue usando `nombreCompleto` (solo la persona), sin
// el negocio: ver CLAUDE.md, "Nombre del negocio en la ficha del cliente" (2026-09-27).
function nombreConNegocio(cliente) {
  if (!cliente) return '';
  return cliente.negocio ? `${nombreCompleto(cliente)} (${cliente.negocio})` : nombreCompleto(cliente);
}

// Texto por el que se puede encontrar a un cliente al buscarlo (nombre, apellido, negocio y código; igual que los
// productos, que también se buscan por código). 2026-09-27: buscar por código no andaba en el campo de
// cliente de Facturas/Pedidos ni en Cobros (en la lista de Clientes y en la lupa ya andaba).
function textoBusquedaCliente(cliente) {
  if (!cliente) return '';
  return `${nombreCompleto(cliente)} ${cliente.negocio || ''} ${cliente.codigo || ''}`;
}

function formatearMoneda(monto) {
  const conDecimales = Math.round(monto * 100) % 100 !== 0;
  return monto.toLocaleString('es-AR', {
    minimumFractionDigits: conDecimales ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

// Sumar kilos con coma flotante deja colas tipo 8.629999999999999
function redondearCantidad(n) {
  return Math.round(n * 1000) / 1000;
}

// Cantidad con coma decimal, como se escribe en Argentina (3,5). Sin separador de miles.
function formatearCantidad(n) {
  return redondearCantidad(n).toLocaleString('es-AR', { maximumFractionDigits: 3, useGrouping: false });
}

function limpiarNumeroMoneda(valor) {
  if (typeof valor !== 'string') return NaN;
  const limpio = valor.replace(/\./g, '').replace(',', '.').trim();
  if (limpio === '') return NaN;
  return parseFloat(limpio);
}

// Para cantidades y pesos (kilos, bultos, mínimos de stock), a diferencia de la plata: acá el punto no separa
// miles (son números chicos), así que también puede usarse como coma decimal (2026-09-27: "en toda la
// app dejá las dos opciones"). El primer punto o coma que se escribe queda como la coma decimal de siempre.
function limpiarNumeroCantidad(valor) {
  if (typeof valor !== 'string') return NaN;
  const limpio = valor.replace(',', '.').trim();
  if (limpio === '') return NaN;
  return parseFloat(limpio);
}

function formatearCantidadMientrasEscribe(valorCrudo) {
  const soloDigitosYSeparador = valorCrudo.replace(/[^\d.,]/g, '');
  const idx = soloDigitosYSeparador.search(/[.,]/);
  if (idx === -1) return soloDigitosYSeparador;
  const entero = soloDigitosYSeparador.slice(0, idx);
  const decimal = soloDigitosYSeparador.slice(idx + 1).replace(/[.,]/g, '').slice(0, 3);
  return `${entero},${decimal}`;
}

function vincularFormatoCantidad(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    const cursorAlFinal = input.selectionEnd === input.value.length;
    input.value = formatearCantidadMientrasEscribe(input.value);
    if (cursorAlFinal) {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
}

function formatearMientrasEscribe(valorCrudo) {
  const soloDigitosYComa = valorCrudo.replace(/[^\d,]/g, '');
  const idxComa = soloDigitosYComa.indexOf(',');
  let entero = soloDigitosYComa;
  let decimal;
  if (idxComa !== -1) {
    entero = soloDigitosYComa.slice(0, idxComa);
    decimal = soloDigitosYComa.slice(idxComa + 1).replace(/,/g, '').slice(0, 2);
  }
  entero = entero.replace(/^0+(?=\d)/, '');
  const enteroFormateado = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimal !== undefined ? `${enteroFormateado},${decimal}` : enteroFormateado;
}

function vincularFormatoMoneda(input) {
  // El punto del teclado numérico escribe la coma decimal (con otros teclados esa tecla da "." y el punto
  // se descartaría). Se reconoce por la tecla física, no por el carácter.
  input.addEventListener('keydown', (e) => {
    if (e.code !== 'NumpadDecimal' || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const ini = input.selectionStart ?? input.value.length;
    const fin = input.selectionEnd ?? input.value.length;
    input.setRangeText(',', ini, fin, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  input.addEventListener('input', () => {
    const cursorAlFinal = input.selectionEnd === input.value.length;
    input.value = formatearMientrasEscribe(input.value);
    if (cursorAlFinal) {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
}

// Flechitas ▲▼ (y las teclas ↑ ↓) para subir o bajar una cantidad de a 1: de a un kilo o de a una unidad,
// nunca de a gramos. Sirve para campos de texto (con coma decimal) y numéricos.
function vincularFlechasCantidad(input, paso = 1) {
  if (!input || input.dataset.flechas) return;
  input.dataset.flechas = '1';
  const mover = (direccion) => {
    const actual = input.type === 'number' ? parseFloat(input.value) : limpiarNumeroMoneda(input.value);
    const base = Number.isFinite(actual) ? actual : 0;
    const nuevo = Math.max(0, redondearCantidad(base + direccion * paso));
    input.value = input.type === 'number' ? String(nuevo) : formatearCantidad(nuevo);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    mover(e.key === 'ArrowUp' ? 1 : -1);
  });
  const envoltorio = document.createElement('span');
  envoltorio.className = 'campo-con-flechas';
  input.replaceWith(envoltorio);
  envoltorio.appendChild(input);
  const flechas = document.createElement('span');
  flechas.className = 'flechas-cantidad';
  flechas.innerHTML = '<button type="button" tabindex="-1" data-dir="1" aria-label="Sumar" title="Sumar">▲</button><button type="button" tabindex="-1" data-dir="-1" aria-label="Restar" title="Restar">▼</button>';
  flechas.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      mover(Number(b.dataset.dir));
      input.focus();
    })
  );
  envoltorio.appendChild(flechas);
}

function autocompleteBuscadorHtml(idPrefix, placeholder, valorInicial = '', deshabilitado = false) {
  return `
    <div class="autocomplete-buscador">
      <div class="autocomplete-buscador-campo">
        <input
          type="text"
          id="${idPrefix}-buscar"
          placeholder="${esc(placeholder)}"
          autocomplete="off"
          value="${esc(valorInicial)}"
          ${deshabilitado ? 'disabled' : ''}
        />
        <button type="button" class="autocomplete-buscador-icono" id="${idPrefix}-icono" aria-label="Mostrar lista" tabindex="-1" ${deshabilitado ? 'disabled' : ''}>
          ${ICONO_FLECHA_ABAJO}
        </button>
      </div>
      <div id="${idPrefix}-sugerencias" class="sugerencias-lista"></div>
    </div>
  `;
}

function vincularAutocompleteBuscador(idPrefix, opciones, { etiquetar, coincide, onSeleccionar, puntajeOpcion, detalle }) {
  const input = document.getElementById(`${idPrefix}-buscar`);
  const lista = document.getElementById(`${idPrefix}-sugerencias`);
  if (!input || input.disabled) return { obtenerSeleccionado: () => null, focus: () => {} };

  let coincidencias = [];
  let indiceResaltado = -1;
  let seleccionado = input.value.trim()
    ? opciones.find((o) => etiquetar(o) === input.value.trim()) || null
    : null;

  function resaltar() {
    lista.querySelectorAll('.sugerencia-item').forEach((item, idx) => {
      item.classList.toggle('resaltada', idx === indiceResaltado);
    });
  }

  function cerrar() {
    lista.style.display = 'none';
    coincidencias = [];
    indiceResaltado = -1;
  }

  function mostrar({ ignorarFiltro = false } = {}) {
    const query = normalizarTexto(input.value.trim());
    coincidencias = !ignorarFiltro && query ? opciones.filter((o) => coincide(o, query)) : opciones;
    if (!ignorarFiltro && query) {
      const puntaje = (o) => (puntajeOpcion ? puntajeOpcion(o, query) : puntajeCoincidencia(normalizarTexto(etiquetar(o)), query)) ?? 3;
      coincidencias = coincidencias.map((o) => ({ o, p: puntaje(o) })).sort((a, b) => a.p - b.p).map((x) => x.o);
    }
    indiceResaltado = -1;
    if (coincidencias.length === 0) {
      lista.style.display = 'none';
      return;
    }
    lista.innerHTML = coincidencias
      .map((o, idx) => {
        const texto = detalle ? detalle(o, query) : '';
        return `<div class="sugerencia-item" data-idx="${idx}">${esc(etiquetar(o))}${texto ? `<span class="sugerencia-item-detalle">${esc(texto)}</span>` : ''}</div>`;
      })
      .join('');
    lista.style.display = 'block';
    acomodarPanelVertical(lista, 4);
    lista.querySelectorAll('.sugerencia-item').forEach((item, idx) => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        elegir(coincidencias[idx]);
      });
      item.addEventListener('mouseenter', () => {
        indiceResaltado = idx;
        resaltar();
      });
    });
  }

  function elegir(opcion) {
    seleccionado = opcion;
    input.value = etiquetar(opcion);
    cerrar();
    if (onSeleccionar) onSeleccionar(opcion);
  }

  input.addEventListener('input', () => {
    seleccionado = null;
    mostrar();
  });
  input.addEventListener('blur', cerrar);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (lista.style.display !== 'none' && coincidencias.length > 0) {
        if (indiceResaltado >= 0) {
          e.preventDefault();
          elegir(coincidencias[indiceResaltado]);
        } else if (coincidencias.length === 1 || input.value.trim()) {
          e.preventDefault();
          elegir(coincidencias[0]);
        }
      }
      return;
    }
    if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault();
      mostrar({ ignorarFiltro: true });
      return;
    }
    if (lista.style.display === 'none' || coincidencias.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      indiceResaltado = (indiceResaltado + 1) % coincidencias.length;
      resaltar();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      indiceResaltado = (indiceResaltado - 1 + coincidencias.length) % coincidencias.length;
      resaltar();
    } else if (e.key === 'Escape') {
      cerrar();
    }
  });

  const icono = document.getElementById(`${idPrefix}-icono`);
  if (icono) {
    icono.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (lista.style.display === 'block') {
        cerrar();
      } else {
        input.focus();
        mostrar({ ignorarFiltro: true });
      }
    });
  }

  return {
    obtenerSeleccionado: () => seleccionado,
    limpiar: () => {
      seleccionado = null;
      input.value = '';
    },
    focus: () => input.focus(),
  };
}

function clienteAutocompleteHtml(idPrefix, valorInicial = '', deshabilitado = false) {
  return autocompleteBuscadorHtml(idPrefix, 'Nombre del cliente...', valorInicial, deshabilitado);
}

function vincularClienteAutocomplete(idPrefix, clientes, opciones = {}) {
  return vincularAutocompleteBuscador(idPrefix, clientes, {
    etiquetar: nombreCompleto,
    coincide: (c, query) => normalizarTexto(textoBusquedaCliente(c)).includes(query),
    // Si lo encontró por el nombre del negocio (y no por el de la persona), se lo aclara en la lista de sugerencias:
    // así no queda la duda de por qué apareció.
    detalle: (c, query) => (c.negocio && normalizarTexto(c.negocio).includes(query) && !normalizarTexto(nombreCompleto(c)).includes(query) ? c.negocio : ''),
    ...opciones,
  });
}

function productoAutocompleteHtml(idPrefix, valorInicial = '') {
  return autocompleteBuscadorHtml(idPrefix, 'Producto (nombre o código)...', valorInicial);
}

function etiquetaProducto(producto) {
  return producto.codigo ? `${producto.nombre} (${producto.codigo})` : producto.nombre;
}

function vincularProductoAutocomplete(idPrefix, productos, opciones = {}) {
  return vincularAutocompleteBuscador(idPrefix, productos, {
    etiquetar: etiquetaProducto,
    coincide: (p, query) =>
      normalizarTexto(p.nombre).includes(query) || (p.codigo && normalizarTexto(p.codigo).includes(query)),
    puntajeOpcion: (p, query) => {
      const porNombre = puntajeCoincidencia(normalizarTexto(p.nombre), query);
      const porCodigo = p.codigo ? puntajeCoincidencia(normalizarTexto(p.codigo), query) : null;
      return Math.min(porNombre ?? 9, porCodigo ?? 9);
    },
    ...opciones,
  });
}

const ICONO_WHATSAPP =
  '<svg viewBox="0 0 448 512" width="18" height="18" fill="#25D366"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222.2 99.9-222.2 222.4 0 39.2 10.2 77.5 29.6 111.1L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.9 224.1-222.4 0-59.3-25.2-115-67.1-156.6zM223.9 439.9c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.8-186.6 184.8zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg>';

// Campo de texto con una "×" adentro, a la derecha, para borrar de una vez lo que se escribió. La "×"
// solo se ve cuando hay algo escrito y se salta con el teclado (no estorba con Tab ni con las flechas).
function campoLimpiableHtml(inputHtml) {
  return `<span class="campo-limpiable">${inputHtml}<button type="button" class="btn-limpiar-campo" data-omitir-teclado tabindex="-1" aria-label="Borrar lo escrito" title="Borrar" hidden>×</button></span>`;
}

function vincularCampoLimpiable(input) {
  const boton = input.parentElement.querySelector('.btn-limpiar-campo');
  if (!boton) return;
  const actualizar = () => {
    boton.hidden = input.value === '';
  };
  actualizar();
  input.addEventListener('input', actualizar);
  boton.addEventListener('mousedown', (e) => e.preventDefault());
  boton.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
}

// Botón "?" con un cuadro flotante de ayuda (patrón acordado: nada de textos explicativos fijos; lo
// imprescindible va a la vista y el resto detrás del "?"). Se cierra tocando afuera, el "?" o con Escape.
// `alineado` = 'izquierda' abre el cuadro hacia la derecha del botón (para un "?" que no está al borde derecho).
function botonAyudaHtml(id, titulo, textoHtml, alineado = 'derecha') {
  return `<div class="est-ayuda ${alineado === 'izquierda' ? 'ayuda-izquierda' : ''}">
    <button type="button" id="${id}" class="btn-ayuda-est" aria-label="${esc(titulo)}" aria-expanded="false" title="${esc(titulo)}">?</button>
    <div id="${id}-panel" class="est-ayuda-panel" hidden><strong>${esc(titulo)}</strong>${textoHtml}</div>
  </div>`;
}

function vincularBotonAyuda(id) {
  const boton = document.getElementById(id);
  const panel = document.getElementById(`${id}-panel`);
  if (!boton || !panel) return;
  boton.addEventListener('click', (e) => {
    e.stopPropagation();
    const abrir = panel.hidden;
    cerrarAyudasFlotantes();
    panel.hidden = !abrir;
    boton.setAttribute('aria-expanded', String(abrir));
    if (abrir) acomodarPanelAyuda(panel);
  });
  panel.addEventListener('click', (e) => e.stopPropagation());
}

// Un panel que se abre debajo de un botón (ayuda "?", Filtros...) puede no entrar en la ventana si esta es chica o el
// botón está cerca de un borde. A los costados: se alinea a la derecha del botón y, si aun así se sale por la izquierda, se
// pega al borde. Abajo (`acomodarPanelVertical`): si no entra debajo del botón se abre hacia ARRIBA, y si no entra en ningún
// lado se limita al espacio que hay y scrollea por dentro.
function acomodarPanelFlotante(panel) {
  panel.style.left = '';
  panel.style.right = '';
  const margen = 8;
  const r = panel.getBoundingClientRect();
  if (r.right > window.innerWidth - margen) {
    panel.style.left = 'auto';
    panel.style.right = '0';
    const r2 = panel.getBoundingClientRect();
    if (r2.left < margen) {
      panel.style.right = `${r2.left - margen}px`;
    }
  }
  acomodarPanelVertical(panel);
}

// Solo el sentido vertical (lo usan también el calendario y la lista de sugerencias). `separacion` es el espacio entre el
// panel y su botón (el que tiene el CSS del panel). La referencia es el elemento que lo posiciona (`offsetParent`).
function acomodarPanelVertical(panel, separacion = 6) {
  panel.style.top = '';
  panel.style.bottom = '';
  panel.style.maxHeight = '';
  panel.style.overflowY = '';
  const margen = 8;
  const r = panel.getBoundingClientRect();
  if (r.bottom <= window.innerHeight - margen) return;
  const ancla = (panel.offsetParent || panel.parentElement).getBoundingClientRect();
  const arriba = ancla.top - margen; // lugar que hay encima del botón
  const abajo = window.innerHeight - r.top - margen; // lugar que hay debajo
  const irArriba = () => {
    panel.style.top = 'auto';
    panel.style.bottom = `calc(100% + ${separacion}px)`;
  };
  if (arriba >= r.height + separacion) {
    irArriba();
    return;
  }
  // No entra entero en ningún lado: se usa el lado con más lugar y el panel scrollea por dentro.
  if (arriba > abajo) {
    irArriba();
    panel.style.maxHeight = `${Math.max(120, arriba - separacion)}px`;
  } else {
    panel.style.maxHeight = `${Math.max(120, abajo)}px`;
  }
  panel.style.overflowY = 'auto';
}

function acomodarPanelAyuda(panel) {
  acomodarPanelFlotante(panel);
}

function cerrarAyudasFlotantes() {
  document.querySelectorAll('.est-ayuda-panel').forEach((p) => {
    p.hidden = true;
    p.parentElement.querySelector('.btn-ayuda-est')?.setAttribute('aria-expanded', 'false');
  });
}

// Botón "Filtros" junto al buscador de una lista: abre un panel con grupos de opciones (Ordenar, Ver…).
// `grupos` = [{ nombre, titulo, opciones: [[valor, texto]], actual, porDefecto }]. El botón muestra cuántos
// grupos están fuera de su valor por defecto. El panel queda abierto mientras se eligen cosas.
const filtrosAbiertos = {};
function filtrosListaHtml(id, grupos) {
  const cambiados = grupos.filter((g) => g.actual !== g.porDefecto).length;
  return `
    <div class="filtros-lista" id="${id}">
      <button type="button" class="btn-filtros ${cambiados ? 'con-filtros' : ''}" aria-expanded="${Boolean(filtrosAbiertos[id])}">Filtros${cambiados ? `<span class="filtros-cuenta">${cambiados}</span>` : ''} ▾</button>
      <div class="filtros-panel" ${filtrosAbiertos[id] ? '' : 'hidden'}>
        ${grupos
          .map(
            (g) => `<div class="filtros-grupo"><span class="filtros-titulo">${esc(g.titulo)}</span>${g.opciones
              .map(([valor, texto]) => `<label class="filtros-opcion"><input type="radio" name="${id}-${g.nombre}" value="${esc(valor)}" ${g.actual === valor ? 'checked' : ''} /> ${esc(texto)}</label>`)
              .join('')}</div>`
          )
          .join('')}
        ${cambiados ? `<button type="button" class="enlace-boton limpiar-filtros" data-defectos='${esc(JSON.stringify(grupos.map((g) => [g.nombre, g.porDefecto])))}'>Limpiar filtros</button>` : ''}
      </div>
    </div>`;
}

function vincularFiltrosLista(id, alElegir) {
  const cont = document.getElementById(id);
  if (!cont) return;
  const panel = cont.querySelector('.filtros-panel');
  cont.querySelector('.btn-filtros').addEventListener('click', (e) => {
    e.stopPropagation();
    filtrosAbiertos[id] = panel.hidden;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) acomodarPanelFlotante(panel);
  });
  panel.addEventListener('click', (e) => e.stopPropagation());
  if (!panel.hidden) acomodarPanelFlotante(panel); // ya venía abierto (la pantalla se volvió a dibujar)
  cont.querySelectorAll('input[type="radio"]').forEach((radio) => {
    radio.addEventListener('change', () => alElegir(radio.name.slice(id.length + 1), radio.value));
  });
  // "Limpiar filtros": todos los grupos vuelven a su valor de siempre.
  cont.querySelector('.limpiar-filtros')?.addEventListener('click', () => {
    JSON.parse(cont.querySelector('.limpiar-filtros').dataset.defectos).forEach(([nombre, defecto]) => alElegir(nombre, defecto));
  });
}

// Tocar en cualquier otro lado (o Escape) cierra los paneles de filtros abiertos.
function cerrarFiltrosLista() {
  Object.keys(filtrosAbiertos).forEach((id) => {
    filtrosAbiertos[id] = false;
  });
  document.querySelectorAll('.filtros-panel').forEach((p) => (p.hidden = true));
}

function fechaLegible(iso) {
  return new Date(iso).toLocaleDateString('es-AR');
}

function tamanoLegible(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function fechaHoyISO() {
  const hoy = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`;
}

const ICONO_CALENDARIO =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
const ICONO_FLECHA_ABAJO =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
const DIAS_SEMANA_CORTO = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MESES_LARGO = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatearFechaCorta(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatearFechaMientrasEscribe(valorCrudo) {
  const soloDigitos = valorCrudo.replace(/\D/g, '').slice(0, 8);
  const partes = [];
  if (soloDigitos.length > 0) partes.push(soloDigitos.slice(0, 2));
  if (soloDigitos.length > 2) partes.push(soloDigitos.slice(2, 4));
  if (soloDigitos.length > 4) partes.push(soloDigitos.slice(4, 8));
  return partes.join('/');
}

function fechaCortaAIso(valor) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor.trim());
  if (!match) return null;
  const dia = Number(match[1]);
  const mes = Number(match[2]);
  const anio = Number(match[3]);
  const d = new Date(anio, mes - 1, dia);
  if (d.getFullYear() !== anio || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${anio}-${pad(mes)}-${pad(dia)}`;
}

function isoDeFecha(anio, mes, dia) {
  const d = new Date(anio, mes, dia);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function construirGridCalendario(anio, mes) {
  const primerDiaSemana = (new Date(anio, mes, 1).getDay() + 6) % 7;
  const diasEnMes = new Date(anio, mes + 1, 0).getDate();
  const diasMesAnterior = new Date(anio, mes, 0).getDate();
  const celdas = [];
  for (let i = primerDiaSemana - 1; i >= 0; i--) {
    celdas.push({ dia: diasMesAnterior - i, mesOffset: -1, fueraDeMes: true });
  }
  for (let d = 1; d <= diasEnMes; d++) {
    celdas.push({ dia: d, mesOffset: 0, fueraDeMes: false });
  }
  let diaSiguiente = 1;
  while (celdas.length % 7 !== 0) {
    celdas.push({ dia: diaSiguiente++, mesOffset: 1, fueraDeMes: true });
  }
  return celdas;
}

function selectorFechaHtml(id, valorActual, deshabilitado) {
  return `
    <div class="selector-fecha">
      <div class="selector-fecha-campo">
        <input
          type="text"
          inputmode="numeric"
          class="selector-fecha-input"
          id="${id}"
          placeholder="dd/mm/aaaa"
          value="${valorActual ? formatearFechaCorta(valorActual) : ''}"
          ${deshabilitado ? 'disabled' : ''}
        />
        <button type="button" class="selector-fecha-icono" id="${id}-icono" aria-label="Abrir calendario" ${deshabilitado ? 'disabled' : ''}>
          ${ICONO_CALENDARIO}
        </button>
      </div>
      <div class="calendario-panel" id="${id}-panel" style="display:none"></div>
    </div>
  `;
}

// `rango` (opcional) = { desde, hasta, pendiente }: pinta el tramo elegido y cambia el pie del calendario.
function renderPanelCalendario(anioMostrado, mesMostrado, valorSeleccionado, rango) {
  const celdas = construirGridCalendario(anioMostrado, mesMostrado);
  const hoyIso = fechaHoyISO();
  return `
    <div class="calendario-header">
      <span class="calendario-nav-grupo">
        <button type="button" class="calendario-nav calendario-nav-anio" data-anio="-1" aria-label="Año anterior" title="Año anterior">&laquo;</button>
        <button type="button" class="calendario-nav" data-dir="-1" aria-label="Mes anterior" title="Mes anterior">&larr;</button>
      </span>
      <strong>${MESES_LARGO[mesMostrado][0].toUpperCase()}${MESES_LARGO[mesMostrado].slice(1)} de ${anioMostrado}</strong>
      <span class="calendario-nav-grupo">
        <button type="button" class="calendario-nav" data-dir="1" aria-label="Mes siguiente" title="Mes siguiente">&rarr;</button>
        <button type="button" class="calendario-nav calendario-nav-anio" data-anio="1" aria-label="Año siguiente" title="Año siguiente">&raquo;</button>
      </span>
    </div>
    <div class="calendario-semana">
      ${DIAS_SEMANA_CORTO.map((d) => `<span>${d}</span>`).join('')}
    </div>
    <div class="calendario-grid">
      ${celdas
        .map((c) => {
          const mesReal = mesMostrado + c.mesOffset;
          const iso = isoDeFecha(anioMostrado, mesReal, c.dia);
          const clases = ['calendario-dia'];
          if (c.fueraDeMes) clases.push('fuera-de-mes');
          if (iso === valorSeleccionado) clases.push('seleccionado');
          if (rango) {
            const extremo = iso === rango.desde || iso === rango.hasta;
            if (extremo) clases.push('seleccionado');
            else if (rango.desde && rango.hasta && iso > rango.desde && iso < rango.hasta) clases.push('en-rango');
          }
          if (iso === hoyIso) clases.push('hoy');
          return `<button type="button" class="${clases.join(' ')}" data-fecha="${iso}">${c.dia}</button>`;
        })
        .join('')}
    </div>
    ${
      rango
        ? `<p class="calendario-pista">${rango.pendiente ? 'Ahora elegí el último día.' : 'Elegí el primer día y después el último.'}</p>
    <div class="calendario-acciones">
      <button type="button" class="calendario-limpiar">Borrar</button>
      <button type="button" class="calendario-atajo" data-atajo="mes-pasado">Mes pasado</button>
      <button type="button" class="calendario-atajo" data-atajo="este-mes">Este mes</button>
    </div>`
        : `<div class="calendario-acciones">
      <button type="button" class="calendario-limpiar">Borrar</button>
      <button type="button" class="calendario-hoy">Hoy</button>
    </div>`
    }
  `;
}

function vincularMenuFila(raiz = app) {
  raiz.querySelectorAll('.btn-menu-fila').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lista = btn.nextElementSibling;
      const yaVisible = lista.classList.contains('visible');
      app.querySelectorAll('.menu-fila-lista.visible').forEach((l) => l.classList.remove('visible', 'menu-fila-lista-arriba'));
      if (yaVisible) return;
      lista.classList.add('visible');
      if (lista.getBoundingClientRect().bottom > window.innerHeight) {
        lista.classList.add('menu-fila-lista-arriba');
      }
    });
  });
}

function vincularSelectorFecha(id, valorActual, onSeleccionar) {
  const input = document.getElementById(id);
  const icono = document.getElementById(`${id}-icono`);
  if (!input || input.disabled) return;
  const panel = document.getElementById(`${id}-panel`);
  const base = valorActual ? new Date(`${valorActual}T00:00:00`) : new Date();
  let anioMostrado = base.getFullYear();
  let mesMostrado = base.getMonth();

  input.addEventListener('input', () => {
    const cursorAlFinal = input.selectionEnd === input.value.length;
    input.value = formatearFechaMientrasEscribe(input.value);
    if (cursorAlFinal) {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      panel.style.display = 'none';
    }
  });

  input.addEventListener('blur', () => {
    if (input.value.trim() === '') {
      if (valorActual) onSeleccionar('');
      return;
    }
    const iso = fechaCortaAIso(input.value);
    if (iso) {
      if (iso !== valorActual) onSeleccionar(iso);
    } else {
      input.value = valorActual ? formatearFechaCorta(valorActual) : '';
    }
  });

  function pintar() {
    panel.innerHTML = renderPanelCalendario(anioMostrado, mesMostrado, valorActual);

    panel.querySelectorAll('.calendario-nav').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.dataset.anio) {
          anioMostrado += Number(btn.dataset.anio);
        } else {
          mesMostrado += Number(btn.dataset.dir);
          if (mesMostrado < 0) {
            mesMostrado = 11;
            anioMostrado--;
          } else if (mesMostrado > 11) {
            mesMostrado = 0;
            anioMostrado++;
          }
        }
        pintar();
      });
    });

    panel.querySelectorAll('.calendario-dia').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.style.display = 'none';
        onSeleccionar(btn.dataset.fecha);
      });
    });

    panel.querySelector('.calendario-limpiar').addEventListener('click', (e) => {
      e.stopPropagation();
      panel.style.display = 'none';
      onSeleccionar('');
    });

    panel.querySelector('.calendario-hoy').addEventListener('click', (e) => {
      e.stopPropagation();
      panel.style.display = 'none';
      onSeleccionar(fechaHoyISO());
    });
  }

  icono.addEventListener('click', (e) => {
    e.stopPropagation();
    const abierto = panel.style.display !== 'none';
    document.querySelectorAll('.calendario-panel').forEach((p) => (p.style.display = 'none'));
    if (!abierto) {
      const base2 = valorActual ? new Date(`${valorActual}T00:00:00`) : new Date();
      anioMostrado = base2.getFullYear();
      mesMostrado = base2.getMonth();
      pintar();
      panel.style.display = 'block';
      ajustarPanelCalendario(panel);
    }
  });

  panel.addEventListener('click', (e) => e.stopPropagation());
}

// Si el selector está pegado al borde derecho, el calendario se abre hacia la izquierda.
function ajustarPanelCalendario(panel) {
  panel.classList.remove('a-la-derecha');
  if (panel.getBoundingClientRect().right > document.documentElement.clientWidth - 8) {
    panel.classList.add('a-la-derecha');
  }
  acomodarPanelVertical(panel); // si no entra hacia abajo, se abre hacia arriba
}

function primerDiaDelMes(anio, mes) {
  return isoDeFecha(anio, mes, 1);
}

function ultimoDiaDelMes(anio, mes) {
  return isoDeFecha(anio, mes + 1, 0);
}

// Rango de fechas: dos casilleros (se puede escribir) y un solo calendario en el que se marca
// el primer día y después el último.
function selectorRangoHtml(id, desde, hasta) {
  const casillero = (sufijo, valor, etiqueta) => `
        <input type="text" inputmode="numeric" class="selector-fecha-input" id="${id}-${sufijo}"
          placeholder="${etiqueta}" aria-label="${etiqueta}" value="${valor ? formatearFechaCorta(valor) : ''}" />`;
  return `
    <div class="selector-fecha selector-rango" id="${id}">
      <div class="selector-fecha-campo">
        ${casillero('desde', desde, 'Desde')}
        <span class="selector-rango-flecha" aria-hidden="true">→</span>
        ${casillero('hasta', hasta, 'Hasta')}
        <button type="button" class="selector-fecha-icono" id="${id}-icono" aria-label="Abrir calendario">${ICONO_CALENDARIO}</button>
      </div>
      <div class="calendario-panel" id="${id}-panel" style="display:none"></div>
    </div>`;
}

function vincularSelectorRango(id, desde, hasta, onCambio) {
  const inputDesde = document.getElementById(`${id}-desde`);
  const inputHasta = document.getElementById(`${id}-hasta`);
  const icono = document.getElementById(`${id}-icono`);
  const panel = document.getElementById(`${id}-panel`);
  if (!inputDesde || !inputHasta) return;
  let inicioPendiente = null;
  const base = desde ? new Date(`${desde}T00:00:00`) : new Date();
  let anioMostrado = base.getFullYear();
  let mesMostrado = base.getMonth();

  const cambiar = (nuevoDesde, nuevoHasta) => {
    if (nuevoDesde && nuevoHasta && nuevoDesde > nuevoHasta) [nuevoDesde, nuevoHasta] = [nuevoHasta, nuevoDesde];
    if (nuevoDesde !== desde || nuevoHasta !== hasta) onCambio({ desde: nuevoDesde, hasta: nuevoHasta });
  };

  [inputDesde, inputHasta].forEach((input) => {
    input.addEventListener('input', () => {
      const cursorAlFinal = input.selectionEnd === input.value.length;
      input.value = formatearFechaMientrasEscribe(input.value);
      if (cursorAlFinal) input.setSelectionRange(input.value.length, input.value.length);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        panel.style.display = 'none';
      }
    });
    input.addEventListener('blur', () => {
      const esDesde = input === inputDesde;
      const actual = esDesde ? desde : hasta;
      if (input.value.trim() === '') {
        if (actual) cambiar(esDesde ? '' : desde, esDesde ? hasta : '');
        return;
      }
      const iso = fechaCortaAIso(input.value);
      if (!iso) {
        input.value = actual ? formatearFechaCorta(actual) : '';
      } else if (iso !== actual) {
        cambiar(esDesde ? iso : desde, esDesde ? hasta : iso);
      }
    });
  });

  function pintar() {
    panel.innerHTML = renderPanelCalendario(
      anioMostrado,
      mesMostrado,
      null,
      inicioPendiente ? { desde: inicioPendiente, hasta: '', pendiente: true } : { desde, hasta, pendiente: false }
    );

    panel.querySelectorAll('.calendario-nav').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.dataset.anio) {
          anioMostrado += Number(btn.dataset.anio);
        } else {
          mesMostrado += Number(btn.dataset.dir);
          if (mesMostrado < 0) {
            mesMostrado = 11;
            anioMostrado--;
          } else if (mesMostrado > 11) {
            mesMostrado = 0;
            anioMostrado++;
          }
        }
        pintar();
      });
    });

    const dias = panel.querySelectorAll('.calendario-dia');
    dias.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!inicioPendiente) {
          inicioPendiente = btn.dataset.fecha;
          pintar();
          return;
        }
        const primero = inicioPendiente;
        inicioPendiente = null;
        panel.style.display = 'none';
        cambiar(primero, btn.dataset.fecha);
      });
      // Mientras se elige el último día, se va pintando el tramo hasta donde está el mouse.
      btn.addEventListener('mouseenter', () => {
        if (!inicioPendiente) return;
        const [a, b] = [inicioPendiente, btn.dataset.fecha].sort();
        dias.forEach((d) => d.classList.toggle('en-rango', d.dataset.fecha > a && d.dataset.fecha < b));
      });
    });

    panel.querySelector('.calendario-limpiar').addEventListener('click', (e) => {
      e.stopPropagation();
      inicioPendiente = null;
      panel.style.display = 'none';
      cambiar('', '');
    });

    panel.querySelectorAll('.calendario-atajo').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const hoy = new Date();
        const mes = btn.dataset.atajo === 'este-mes' ? hoy.getMonth() : hoy.getMonth() - 1;
        inicioPendiente = null;
        panel.style.display = 'none';
        cambiar(primerDiaDelMes(hoy.getFullYear(), mes), ultimoDiaDelMes(hoy.getFullYear(), mes));
      });
    });
  }

  icono.addEventListener('click', (e) => {
    e.stopPropagation();
    const abierto = panel.style.display !== 'none';
    document.querySelectorAll('.calendario-panel').forEach((p) => (p.style.display = 'none'));
    if (!abierto) {
      inicioPendiente = null;
      const b = desde ? new Date(`${desde}T00:00:00`) : new Date();
      anioMostrado = b.getFullYear();
      mesMostrado = b.getMonth();
      pintar();
      panel.style.display = 'block';
      ajustarPanelCalendario(panel);
    }
  });

  panel.addEventListener('click', (e) => e.stopPropagation());
}

// Suma ciudad y provincia (de la zona del local) a una dirección que no las trae, y "Argentina", para buscarla en el mapa.
function direccionConZona(direccion, zona) {
  const base = String(direccion || '').trim();
  if (!base) return '';
  const partes = [base];
  const yaEsta = normalizarTexto(base);
  [zona && zona.ciudad, zona && zona.provincia].forEach((parte) => {
    const t = String(parte || '').trim();
    if (t && !yaEsta.includes(normalizarTexto(t))) partes.push(t);
  });
  partes.push('Argentina');
  return partes.join(', ');
}
