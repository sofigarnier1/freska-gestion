// Menú lateral: grupos, submenús flotantes y colapsado de la barra.
// (Antes todo estaba en renderer.js; se dividió por pantalla el 2026-09-24. Los archivos son scripts comunes que
// comparten el mismo espacio global: se cargan en el orden de index.html y no hace falta importar nada.)

// Abre en la barra lateral el grupo elegido (le pone `.abierto` a su `.grupo`, que muestra la
// `.sublista` por CSS) y marca su ícono como activo. Solo abre el grupo actual: no cierra los demás,
// así navegar a otra sección no colapsa la que tenías abierta (para eso está `alternarGrupo`, que sí
// cierra un grupo a mano cuando se lo vuelve a tocar). El de Estadísticas no tiene `.sublista` propia
// (es su propia página), así que no hay nada que abrir.
// Devuelve el botón de esa pantalla que está visible ahora. Desde que existen los ítems sueltos de un
// empleado (`.grupo-empleado` en index.html, ver `aplicarPermisosUI` en sistema.js), puede haber DOS
// botones con el mismo `data-view` (el de siempre, adentro de un grupo, y el suelto): sin este chequeo,
// un simple `document.querySelector('nav button[data-view="..."]')` siempre agarra el primero del HTML,
// que a veces es el que está oculto para ese rol.
function botonDeVista(nombre) {
  return (
    Array.from(document.querySelectorAll(`nav button[data-view="${nombre}"]`)).find((b) => {
      const grupo = b.closest('.grupo');
      return !grupo || !grupo.hidden;
    }) || null
  );
}

// Algunas pantallas comparten una entrada del menú con otra (Gastos vive dentro de "Negocio", junto a Cobros): su botón
// queda oculto en `li[hidden]` y el visible lleva `data-vistas-extra="gastos"`. Devuelve el botón que se ve.
function botonPrincipalDeVista(btn) {
  if (!btn.closest('li[hidden]')) return btn;
  return document.querySelector(`#sidebar button[data-vistas-extra~="${btn.dataset.view}"]`) || btn;
}

// "Negocio": las pastillas Cobros | Gastos de arriba de esas dos pantallas. Un empleado no tiene Gastos, así que para
// él no hay pastillas (solo ve Cobros). `actual` es 'cobros' o 'gastos'.
function negocioToggleHtml(actual) {
  if (sesionActual && sesionActual.rol === 'empleado') return '';
  return `
    <div class="reportes-toggle negocio-toggle">
      <button type="button" class="toggle ${actual === 'cobros' ? 'active' : ''}" data-negocio-tab="cobros">Cobros</button>
      <button type="button" class="toggle ${actual === 'gastos' ? 'active' : ''}" data-negocio-tab="gastos">Gastos</button>
    </div>`;
}

function vincularNegocioToggle() {
  app.querySelectorAll('.toggle[data-negocio-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!btn.classList.contains('active')) irAVista(botonDeVista(btn.dataset.negocioTab));
    });
  });
}

function activarGrupo(grupo) {
  grupoButtons.forEach((b) => b.classList.toggle('active', b.dataset.grupo === grupo));
  document.querySelector(`#sidebar .grupo[data-grupo="${grupo}"]`)?.classList.add('abierto');
}

// El nombre del grupo arriba del título de cada pantalla ("VENTAS" arriba de "Pedidos de hoy"). Se dejа
// vacío cuando el botón es a la vez el de grupo y el de página (Estadísticas): mostrarlo repetiría el
// mismo texto dos veces.
function actualizarMigaGrupo(btn) {
  if (!migaGrupo) return;
  btn = botonPrincipalDeVista(btn);
  const nombreGrupo = document.querySelector(`.grupo-boton[data-grupo="${btn.dataset.grupo}"] .texto`)?.textContent || '';
  // Si el botón clickeado es a la vez el de grupo y el de página (Estadísticas, sin sublista propia),
  // alcanza con el nombre del grupo: agregar la página repetiría el mismo texto.
  const esBotonDeGrupo = btn.classList.contains('grupo-boton');
  const nombrePagina = esBotonDeGrupo ? '' : btn.textContent.trim();
  migaGrupo.textContent = nombrePagina ? `${nombreGrupo} - ${nombrePagina}` : nombreGrupo;
}

// "Volver a…": un solo mecanismo para toda la app (antes cada pantalla armaba el suyo a mano, y varios
// links nuevos se quedaban sin vuelta). Cuando un link puntual manda a otra pantalla (no el menú lateral),
// `registrarOrigenVolver` anota desde dónde vino; la pantalla de destino muestra el botón con
// `volverHtml(destino)` y lo engancha con `vincularVolverGenerico()`. Se olvida solo la próxima vez que se
// navega a una vista distinta de `destino` (ya no tendría sentido si volviste a entrar por tu cuenta).
let origenVolver = null; // { destino, origenVista, etiqueta }

function registrarOrigenVolver(destino, origenVista, etiqueta) {
  origenVolver = { destino, origenVista, etiqueta };
}

function volverHtml(destino) {
  if (!origenVolver || origenVolver.destino !== destino) return '';
  return `<button id="btn-volver-generico" class="btn-volver" type="button">&larr; Volver a ${esc(origenVolver.etiqueta)}</button>`;
}

function vincularVolverGenerico() {
  document.getElementById('btn-volver-generico')?.addEventListener('click', () => {
    irAVista(botonDeVista(origenVolver.origenVista));
  });
}

let navegacionEnCurso = 0;
let botonVistaActual = null; // el botón de la última pantalla a la que se navegó (puede ser el oculto de Gastos)
async function irAVista(btn) {
  if (btn.dataset.view !== 'pedidos') autoPedidosHecho = false;
  // Si te vas a otra pantalla (no a Caja), el "← Volver a..." de Cierre del día ya no tiene sentido la
  // próxima vez que entres ahí por su cuenta.
  if (btn.dataset.view !== 'cierre') origenCierreCaja = null;
  if (origenVolver && btn.dataset.view !== origenVolver.destino) origenVolver = null;
  capturarCamposBorrador();
  if (gastoEditando) terminarEdicionGasto();
  if (typeof refrescarAvisos === 'function') refrescarAvisos();
  activarGrupo(btn.dataset.grupo);
  actualizarMigaGrupo(btn);
  ultimaVistaPorGrupo[btn.dataset.grupo] = btn;
  navButtons.forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  botonPrincipalDeVista(btn).classList.add('active');
  botonVistaActual = btn;
  const mia = ++navegacionEnCurso;
  await views[btn.dataset.view]();
  // Si mientras esta pantalla se dibujaba se cambió de pestaña (por ejemplo con las flechas, rápido), la pantalla
  // vieja puede haber terminado última y pisado a la actual: se vuelve a dibujar la que corresponde a la pestaña marcada.
  if (mia !== navegacionEnCurso && botonVistaActual) await views[botonVistaActual.dataset.view]();
}

// Menú cortito que aparece al lado de un ícono cuando la barra está achicada (ver estilos de
// `.flyout`): reaprovecha la `.sublista` real del grupo en vez de duplicar los botones.
const flyout = document.getElementById('flyout');

function cerrarFlyout() {
  const grupo = flyout.dataset.grupo;
  if (grupo) {
    const sublista = flyout.querySelector('.sublista');
    const grupoDiv = document.querySelector(`#sidebar .grupo[data-grupo="${grupo}"]`);
    if (sublista && grupoDiv) grupoDiv.appendChild(sublista);
  }
  flyout.classList.remove('visible');
  flyout.innerHTML = '';
  delete flyout.dataset.grupo;
}

function abrirFlyout(grupo, botonEl) {
  cerrarFlyout();
  const grupoDiv = document.querySelector(`#sidebar .grupo[data-grupo="${grupo}"]`);
  const sublista = grupoDiv?.querySelector('.sublista');
  if (!sublista) return;
  const rect = botonEl.getBoundingClientRect();
  flyout.style.top = `${rect.top}px`;
  flyout.style.left = `${sidebar.getBoundingClientRect().right + 6}px`;
  flyout.dataset.grupo = grupo;
  const nombreGrupo = botonEl.querySelector('.texto')?.textContent || '';
  flyout.innerHTML = `<div class="flyout-titulo">${nombreGrupo}</div>`;
  flyout.appendChild(sublista);
  flyout.classList.add('visible');
}

// Mostrar/ocultar toda la barra lateral: botón ☰ o Ctrl/Cmd + B. FRESKA se acuerda de cómo la dejaste.
function sidebarColapsadaGuardada() {
  try {
    return localStorage.getItem('freska-sidebar-colapsada') === '1';
  } catch (e) {
    return false;
  }
}

function alternarSidebar(forzar) {
  const colapsar = forzar !== undefined ? forzar : !sidebar.classList.contains('colapsada');
  sidebar.classList.toggle('colapsada', colapsar);
  cerrarFlyout();
  try {
    localStorage.setItem('freska-sidebar-colapsada', colapsar ? '1' : '0');
  } catch (e) {
    // sin almacenamiento local: no se recuerda entre sesiones, no pasa nada grave
  }
}
