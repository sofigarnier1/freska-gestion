// La campanita de la barra: lista de avisos (cheques por cobrar, clientes que deben hace mucho, cierres de
// caja sin hacer, etc.) con un interruptor para apagar cada tipo. Se carga después de los archivos de pantallas (utilidades.js … inicio.js, ver index.html).

const ICONO_CAMPANA =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

let avisosActuales = [];
let vistaPanelAvisos = 'lista'; // 'lista' | 'config'
let avisoDeAperturaMostrado = false;
let mostrarAvisosLeidos = false; // ¿se ven también los que ya se marcaron como leídos?

const btnAvisos = document.getElementById('btn-avisos');
const panelAvisos = document.getElementById('avisos-panel');
const numeroAvisos = document.getElementById('avisos-numero');

function panelAvisosAbierto() {
  return panelAvisos && !panelAvisos.hidden;
}

function cerrarPanelAvisos() {
  if (!panelAvisos) return;
  panelAvisos.hidden = true;
  btnAvisos.setAttribute('aria-expanded', 'false');
}

// Vuelve a pedir los avisos y actualiza el numerito. Con `alAbrir`, la primera vez avisa con un cartelito.
async function refrescarAvisos(alAbrir = false) {
  if (!btnAvisos || pantallaPin.classList.contains('visible')) return;
  const respuesta = await window.freska.avisos.obtener();
  avisosActuales = respuesta.avisos || [];
  const pendientes = avisosActuales.filter((a) => !a.leido);
  const n = pendientes.length;
  numeroAvisos.hidden = n === 0;
  numeroAvisos.textContent = n > 9 ? '9+' : String(n);
  numeroAvisos.classList.toggle('alta', pendientes.some((a) => a.urgencia === 'alta'));
  btnAvisos.setAttribute('aria-label', n ? `Avisos (${n})` : 'Avisos');
  if (panelAvisosAbierto() && vistaPanelAvisos === 'lista') pintarPanelAvisos();
  if (alAbrir && n > 0 && !avisoDeAperturaMostrado) {
    avisoDeAperturaMostrado = true;
    mostrarToast(`Tenés ${n} ${n === 1 ? 'aviso' : 'avisos'}: mirá la campanita.`, 'ok');
  }
}

async function pintarPanelAvisos() {
  if (vistaPanelAvisos === 'config') {
    const tipos = await window.freska.avisos.tipos();
    panelAvisos.innerHTML = `
      <div class="avisos-titulo"><strong>Qué avisos querés ver</strong></div>
      <div class="avisos-config">
        ${tipos
          .map(
            (t) => `<label class="aviso-opcion"><input type="checkbox" data-tipo="${esc(t.id)}" ${t.activo ? 'checked' : ''} /> <span>${esc(t.nombre)}</span></label>`
          )
          .join('')}
      </div>
      <div class="avisos-pie"><button type="button" id="avisos-listo" class="primary">Listo</button></div>`;
    panelAvisos.querySelectorAll('.aviso-opcion input').forEach((input) => {
      input.addEventListener('change', async () => {
        await window.freska.avisos.activar({ tipo: input.dataset.tipo, activo: input.checked });
        refrescarAvisos();
      });
    });
    document.getElementById('avisos-listo').addEventListener('click', () => {
      vistaPanelAvisos = 'lista';
      pintarPanelAvisos();
    });
    return;
  }
  const filaAviso = (a, i) => `<div class="aviso-fila ${a.leido ? 'aviso-leido' : ''}">
        <button type="button" class="aviso-item aviso-${esc(a.urgencia)}" data-i="${i}">
          <span class="aviso-item-titulo">${esc(a.titulo)}</span>
          <span class="aviso-item-detalle">${esc(a.detalle)}</span>
        </button>
        <button type="button" class="aviso-marca" data-i="${i}" data-leido="${a.leido ? '0' : '1'}" aria-label="${a.leido ? 'Marcar como no leído' : 'Marcar como leído'}" title="${a.leido ? 'Marcar como no leído' : 'Marcar como leído'}">${a.leido ? '↩' : '✓'}</button>
      </div>`;
  const nuevos = avisosActuales.map((a, i) => ({ a, i })).filter(({ a }) => !a.leido);
  const leidos = avisosActuales.map((a, i) => ({ a, i })).filter(({ a }) => a.leido);
  panelAvisos.innerHTML = `
    <div class="avisos-titulo">
      <strong>Avisos</strong>
      ${nuevos.length > 1 ? '<button type="button" id="avisos-marcar-todos" class="enlace-boton">Marcar todos como leídos</button>' : ''}
    </div>
    <div class="avisos-lista">
      ${nuevos.length ? nuevos.map(({ a, i }) => filaAviso(a, i)).join('') : `<p class="avisos-vacio">${leidos.length ? 'No hay avisos nuevos.' : 'No hay avisos. Todo en orden.'}</p>`}
      ${mostrarAvisosLeidos && leidos.length ? `<p class="avisos-subtitulo">Leídos</p>${leidos.map(({ a, i }) => filaAviso(a, i)).join('')}` : ''}
    </div>
    <div class="avisos-pie">
      ${leidos.length ? `<button type="button" id="avisos-ver-leidos" class="enlace-boton">${mostrarAvisosLeidos ? 'Ocultar leídos' : `Ver leídos (${leidos.length})`}</button>` : ''}
      <button type="button" id="avisos-configurar" class="enlace-boton">Elegir qué avisos ver</button>
    </div>`;
  panelAvisos.querySelectorAll('.aviso-item').forEach((btn) => {
    btn.addEventListener('click', () => irAlAviso(avisosActuales[Number(btn.dataset.i)]));
  });
  const marcar = async (lista, leido) => {
    await window.freska.avisos.marcar({ avisos: lista.map((a) => ({ tipo: a.tipo, firma: a.firma })), leido });
    await refrescarAvisos();
    if (panelAvisosAbierto()) pintarPanelAvisos();
  };
  panelAvisos.querySelectorAll('.aviso-marca').forEach((btn) => {
    btn.addEventListener('click', () => marcar([avisosActuales[Number(btn.dataset.i)]], btn.dataset.leido === '1'));
  });
  document.getElementById('avisos-marcar-todos')?.addEventListener('click', () => marcar(nuevos.map(({ a }) => a), true));
  document.getElementById('avisos-ver-leidos')?.addEventListener('click', () => {
    mostrarAvisosLeidos = !mostrarAvisosLeidos;
    pintarPanelAvisos();
  });
  document.getElementById('avisos-configurar').addEventListener('click', () => {
    vistaPanelAvisos = 'config';
    pintarPanelAvisos();
  });
}

async function irAlAviso(aviso) {
  cerrarPanelAvisos();
  const vista = (nombre) => botonDeVista(nombre);
  switch (aviso.tipo) {
    case 'cheques':
      vistaChequesTab = 'en_cartera';
      busquedaCheques = '';
      return irAVista(vista('cheques'));
    case 'clientes_deuda':
      pestanaClientes = 'todos';
      ordenClientes = 'saldo';
      mostrarClientes = 'deuda';
      return irAVista(vista('clientes'));
    case 'proveedores_deuda':
      pestanaProveedores = 'todos';
      ordenProveedores = 'saldo';
      mostrarProveedores = 'deuda';
      return irAVista(vista('proveedores'));
    case 'pedidos':
      pestanaPedidos = 'pendientes';
      return irAVista(vista('pedidos'));
    case 'pedidos_programados':
      pestanaPedidos = 'programados';
      return irAVista(vista('pedidos'));
    case 'cierre_caja':
      vistaCierreTab = 'dia';
      edicionCierre = null;
      if (aviso.fecha) fechaCierreCaja = aviso.fecha;
      return irAVista(vista('cierre'));
    case 'clientes_inactivos':
      pestanaClientes = 'todos';
      ordenClientes = 'ultima';
      mostrarClientes = 'inactivos';
      return irAVista(vista('clientes'));
    case 'copia':
      return document.getElementById('btn-backup').click();
    case 'productos_sin_precio':
      return irAVista(vista('productos'));
    case 'stock_bajo':
      vistaStock = 'stock';
      return irAVista(vista('stock'));
    case 'insumos_bajos':
    case 'insumos_sin_contar':
      vistaStock = 'insumos';
      return irAVista(vista('stock'));
    case 'anulaciones_empleado':
      // El aviso junta cobros y facturas anuladas; solo las facturas tienen una lista propia donde
      // revisarlas todas juntas (los cobros anulados viven en la ficha de cada cliente).
      busquedaFacturasTab = '';
      mostrarFacturasTab = 'anuladas';
      limiteFacturasAnuladas = FACTURAS_ANULADAS_POR_PAGINA;
      return irAVista(vista('facturas'));
    default:
      return null;
  }
}

btnAvisos?.addEventListener('click', async (e) => {
  e.stopPropagation();
  menuUsuarioLista.classList.remove('visible'); // los avisos y el menú del usuario no se quedan abiertos a la vez
  if (panelAvisosAbierto()) return cerrarPanelAvisos();
  vistaPanelAvisos = 'lista';
  await refrescarAvisos();
  await pintarPanelAvisos();
  panelAvisos.hidden = false;
  btnAvisos.setAttribute('aria-expanded', 'true');
});
panelAvisos?.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', cerrarPanelAvisos);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && panelAvisosAbierto()) {
    cerrarPanelAvisos();
    btnAvisos.focus();
  }
});
// Cada tanto se vuelven a calcular (la app suele quedar abierta todo el día).
setInterval(() => refrescarAvisos(), 10 * 60 * 1000);
