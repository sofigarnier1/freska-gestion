// Navegación con teclado para toda la app.
//  - Flechas: el foco salta al elemento enfocable más cercano en esa dirección
//    (en un campo de texto, ←/→ saltan solo si el cursor está en el borde).
//  - Enter en un cuadro de diálogo confirma (salvo las acciones destructivas).
//  - Cmd/Ctrl + Enter guarda la factura o el pedido en carga.
//  - Enter/Espacio en un título colapsable lo abre o cierra; Enter en un radio lo elige y en un desplegable lo abre; ←/→ dentro de un grupo de radios los eligen.
(function () {
  const ENFOCABLES =
    'a[href], button:not([data-omitir-teclado]), input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';
  const TIPOS_SIN_TEXTO = ['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'];

  function esVisible(el) {
    if (el.disabled || el.hidden) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const estilo = getComputedStyle(el);
    return estilo.visibility !== 'hidden' && estilo.display !== 'none';
  }

  function alcance(el) {
    const pin = document.getElementById('pantalla-pin');
    if (pin && esVisible(pin)) return pin;
    const modal = document.querySelector('#modal-overlay.visible .modal-card');
    if (modal) return modal;
    const menu = document.querySelector('.menu-fila-lista.visible, .menu-usuario-lista.visible');
    if (menu && menu.parentElement.contains(el)) return menu.parentElement;
    return document.body;
  }

  function vecinoEnDireccion(actual, direccion) {
    const desde = actual.getBoundingClientRect();
    const cx = desde.left + desde.width / 2;
    const cy = desde.top + desde.height / 2;
    const vertical = direccion === 'ArrowUp' || direccion === 'ArrowDown';
    const candidatos = [];

    for (const cand of alcance(actual).querySelectorAll(ENFOCABLES)) {
      if (cand === actual || !esVisible(cand)) continue;
      if (cand.tabIndex < 0) continue;
      if (mismoGrupoRadio(actual, cand)) continue;
      // Entre filas, no meterse en los botones de la propia fila (ni salir a su contenedor).
      if (vertical && (actual.contains(cand) || cand.contains(actual))) continue;

      const r = cand.getBoundingClientRect();
      const dx = r.left + r.width / 2 - cx;
      const dy = r.top + r.height / 2 - cy;
      let principal;
      let hueco;
      if (direccion === 'ArrowDown') {
        if (dy <= 4) continue;
        principal = dy;
        hueco = Math.max(0, r.left - desde.right, desde.left - r.right);
      } else if (direccion === 'ArrowUp') {
        if (dy >= -4) continue;
        principal = -dy;
        hueco = Math.max(0, r.left - desde.right, desde.left - r.right);
      } else if (direccion === 'ArrowRight') {
        if (dx <= 4) continue;
        principal = dx;
        hueco = Math.max(0, r.top - desde.bottom, desde.top - r.bottom);
      } else {
        if (dx >= -4) continue;
        principal = -dx;
        hueco = Math.max(0, r.top - desde.bottom, desde.top - r.bottom);
      }
      const puntaje = principal + hueco * 3 + Math.abs(vertical ? dx : dy) * 0.05;
      candidatos.push({ cand, principal, hueco, puntaje });
    }

    const mejorPorPuntaje = (lista) =>
      lista.reduce((mejor, c) => (!mejor || c.puntaje < mejor.puntaje ? c : mejor), null)?.cand || null;

    if (vertical) {
      // ↑/↓ van al renglón más cercano en esa dirección y, dentro de él, al que mejor cae.
      if (candidatos.length === 0) return null;
      const renglon = Math.min(...candidatos.map((c) => c.principal));
      return mejorPorPuntaje(candidatos.filter((c) => c.principal <= renglon + 14));
    }
    // ←/→: solo elementos alineados en el mismo renglón; nunca saltan a otro renglón.
    return mejorPorPuntaje(candidatos.filter((c) => c.hueco === 0));
  }

  function esRadio(el) {
    return el.tagName === 'INPUT' && el.type === 'radio';
  }

  function mismoGrupoRadio(a, b) {
    return esRadio(a) && esRadio(b) && a.name === b.name && a.form === b.form;
  }

  function gruposDeRadio(radio) {
    return Array.from(document.querySelectorAll('input[type="radio"]'))
      .filter((r) => mismoGrupoRadio(radio, r) && esVisible(r))
      .sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left);
  }

  function esCampoDeTexto(el) {
    return el.tagName === 'INPUT' && !TIPOS_SIN_TEXTO.includes(el.type);
  }

  function cursorEnElBorde(input, tecla) {
    if (input.selectionStart === null) return true;
    if (input.selectionStart !== input.selectionEnd) return false;
    return tecla === 'ArrowRight' ? input.selectionStart === input.value.length : input.selectionStart === 0;
  }

  document.addEventListener('keydown', (e) => {
    if (!e.key?.startsWith('Arrow') || e.defaultPrevented) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const actual = document.activeElement;
    if (!actual || actual === document.body) {
      // Si se venía usando el teclado y el foco se perdió (por ejemplo al volver del diálogo de
      // impresión del sistema), la flecha lo recupera en vez de scrollear la página.
      if (usandoTeclado && !document.querySelector('#modal-overlay.visible')) {
        const destino = recuperarFoco();
        if (destino) e.preventDefault();
      }
      return;
    }
    // Estos ya usan las flechas por su cuenta. Los botones de opción (radio) NO se dejan
    // con sus flechas nativas: cambiarían la opción elegida y no dejarían salir del grupo;
    // acá las flechas solo mueven el foco y la opción se elige con Espacio o Enter.
    if (actual.tagName === 'TEXTAREA') return;
    // Los desplegables (select) igual que los radios: con sus flechas nativas cambian la
    // opción y no dejan salir; acá las flechas mueven el foco y se abren con Enter o Espacio.
    if (actual.tagName === 'SELECT') e.preventDefault();
    // En un campo de texto, izquierda/derecha mueven el cursor; solo saltan al vecino
    // cuando el cursor ya está en el borde (campo vacío, o al final/al principio del texto).
    if (esCampoDeTexto(actual) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !cursorEnElBorde(actual, e.key)) {
      return;
    }

    // Radios: ←/→ dentro del grupo mueven y eligen la opción (como en cualquier formulario);
    // en los extremos, la flecha sale del grupo hacia el vecino.
    // (Se frena siempre la acción nativa: envuelve del último al primero y cambia la opción.)
    if (esRadio(actual)) e.preventDefault();
    if (esRadio(actual) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const grupo = gruposDeRadio(actual);
      const vecino = grupo[grupo.indexOf(actual) + (e.key === 'ArrowRight' ? 1 : -1)];
      if (vecino) {
        e.preventDefault();
        vecino.focus();
        vecino.click();
        return;
      }
    }

    // Dentro de un menú desplegable, ↑/↓ recorren sus opciones en orden visual
    // (el menú puede abrirse hacia arriba o hacia abajo del botón).
    const menu = document.querySelector('.menu-fila-lista.visible, .menu-usuario-lista.visible');
    if (menu && menu.parentElement.contains(actual)) {
      e.preventDefault();
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const boton = menu.previousElementSibling;
      const opciones = Array.from(menu.querySelectorAll('button')).filter(esVisible);
      const seAbreHaciaArriba = menu.getBoundingClientRect().bottom <= boton.getBoundingClientRect().top + 4;
      const orden = seAbreHaciaArriba ? [...opciones, boton] : [boton, ...opciones];
      const indice = orden.indexOf(actual);
      const destino = orden[indice + (e.key === 'ArrowDown' ? 1 : -1)];
      if (indice >= 0 && destino) destino.focus();
      return;
    }

    // Entre la barra de arriba (pestañas y menú de usuario) y la pantalla el "más cercano"
    // no sirve, porque no quedan alineados: ↓ entra al primer elemento de la pantalla y
    // ↑ vuelve a la pestaña activa.
    const app = document.getElementById('app');
    const enBarraSuperior = actual.closest('header');
    if (enBarraSuperior && e.key === 'ArrowDown' && app && !document.querySelector('#modal-overlay.visible')) {
      const primero = Array.from(app.querySelectorAll(ENFOCABLES)).find((el) => el.tabIndex >= 0 && esVisible(el));
      if (primero) {
        e.preventDefault();
        primero.focus();
        return;
      }
    }

    let siguiente = vecinoEnDireccion(actual, e.key);
    if (siguiente && e.key === 'ArrowUp' && !enBarraSuperior && siguiente.closest('header')) {
      siguiente = document.querySelector('nav button.active') || siguiente;
    }
    if (!siguiente) return;
    // Al entrar a un grupo de radios desde afuera se cae en la opción elegida, sin cambiarla.
    if (esRadio(siguiente)) {
      siguiente = gruposDeRadio(siguiente).find((r) => r.checked) || siguiente;
    }
    e.preventDefault();
    siguiente.focus();
    siguiente.scrollIntoView({ block: 'nearest' });
    if (esCampoDeTexto(siguiente)) siguiente.select();
  });

  function confirmacionDestructiva(boton) {
    return boton.dataset.destructivo === 'true';
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing) return;
    const modalAbierto = document.querySelector('#modal-overlay.visible .modal-card');

    if (e.metaKey || e.ctrlKey) {
      if (modalAbierto) return;
      const guardar = ['btn-guardar-factura', 'btn-guardar-pedido']
        .map((id) => document.getElementById(id))
        .find((b) => b && esVisible(b));
      if (guardar) {
        e.preventDefault();
        guardar.click();
      }
      return;
    }

    if (!modalAbierto && e.target.tagName === 'SELECT') {
      e.preventDefault();
      try {
        e.target.showPicker();
      } catch (err) {
        e.target.click();
      }
      return;
    }

    if (!modalAbierto && e.target.tagName === 'INPUT' && e.target.type === 'radio') {
      e.preventDefault();
      e.target.click();
      return;
    }

    if (modalAbierto) {
      const destino = e.target;
      // Un botón enfocado ya se acciona con Enter por su cuenta.
      if (destino.tagName === 'BUTTON' || destino.tagName === 'A' || destino.tagName === 'TEXTAREA') return;
      const confirmar = modalAbierto.querySelector('.primary:not([disabled])');
      if (confirmar && !confirmacionDestructiva(confirmar)) {
        e.preventDefault();
        confirmar.click();
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.defaultPrevented) return;
    const titulo = e.target.closest?.('.titulo-colapsable');
    if (titulo && e.target === titulo) {
      e.preventDefault();
      titulo.click();
    }
  });

  // Si se venía usando el teclado y una pantalla nueva se dibuja, el foco queda en el
  // fondo de la página y las flechas dejarían de andar: se lo lleva al primer elemento.
  let usandoTeclado = false;
  document.addEventListener('keydown', () => (usandoTeclado = true), true);
  document.addEventListener('pointerdown', () => (usandoTeclado = false), true);

  let ultimoFocoFueraDeModal = null;
  // Cómo volver a encontrar el elemento con foco si la pantalla se redibuja (por ejemplo
  // al destildar un filtro): por id, o por clase + valor en los casilleros.
  let ultimoSelectorEnfocado = null;
  function selectorDe(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.tagName === 'INPUT' && el.className && el.getAttribute('value')) {
      const clase = CSS.escape(el.className.split(/\s+/)[0]);
      return `input.${clase}[value="${el.getAttribute('value').replace(/"/g, '\\"')}"]`;
    }
    return null;
  }
  document.addEventListener('focusin', (e) => {
    if (!e.target.closest('#modal-overlay')) ultimoFocoFueraDeModal = e.target;
    ultimoSelectorEnfocado = e.target.closest('#app') ? selectorDe(e.target) : null;
  });

  function recuperarFoco() {
    const app = document.getElementById('app');
    const mismo = ultimoSelectorEnfocado && app && app.querySelector(ultimoSelectorEnfocado);
    const previo = ultimoFocoFueraDeModal && document.contains(ultimoFocoFueraDeModal) ? ultimoFocoFueraDeModal : null;
    const destino =
      (mismo && esVisible(mismo) && mismo) ||
      (previo && esVisible(previo) && previo) ||
      (app && Array.from(app.querySelectorAll(ENFOCABLES)).find((el) => el.tabIndex >= 0 && esVisible(el)));
    destino?.focus();
    return destino || null;
  }

  // Al volver del diálogo de impresión del sistema la ventana recupera el foco pero la página no.
  window.addEventListener('focus', () => {
    setTimeout(() => {
      if (usandoTeclado && document.activeElement === document.body && !document.querySelector('#modal-overlay.visible')) {
        recuperarFoco();
      }
    }, 0);
  });

  // Los títulos colapsables son <h2>: se hacen enfocables para poder llegar con las flechas.
  const app = document.getElementById('app');
  if (app) {
    const volverEnfocables = () => {
      app.querySelectorAll('.titulo-colapsable:not([tabindex])').forEach((titulo) => {
        titulo.tabIndex = 0;
        titulo.setAttribute('role', 'button');
      });
    };
    new MutationObserver(() => {
      volverEnfocables();
      setTimeout(() => {
        if (!usandoTeclado || document.activeElement !== document.body) return;
        if (document.querySelector('#modal-overlay.visible')) return;
        const mismo = ultimoSelectorEnfocado && app.querySelector(ultimoSelectorEnfocado);
        if (mismo && esVisible(mismo)) {
          mismo.focus();
          return;
        }
        const primero = Array.from(app.querySelectorAll(ENFOCABLES)).find(
          (el) => el.tabIndex >= 0 && esVisible(el)
        );
        primero?.focus();
      }, 0);
    }).observe(app, { childList: true, subtree: true });
    volverEnfocables();
  }

  // Al abrirse un cuadro de diálogo, el foco entra en él: en un campo si hay,
  // si no en el botón principal, y en las acciones destructivas en "Cancelar".
  const overlay = document.getElementById('modal-overlay');
  if (overlay) {
    new MutationObserver(() => {
      const modal = overlay.classList.contains('visible') && overlay.querySelector('.modal-card');
      if (!modal) {
        // Al cerrarse el cuadro, el foco vuelve a donde estaba (si sigue en pantalla).
        setTimeout(() => {
          if (usandoTeclado && document.activeElement === document.body && document.contains(ultimoFocoFueraDeModal)) {
            ultimoFocoFueraDeModal.focus();
          }
        }, 0);
        return;
      }
      if (modal.contains(document.activeElement)) return;
      const primario = modal.querySelector('.primary');
      const campo = modal.querySelector(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])'
      );
      const destino =
        campo ||
        (primario && confirmacionDestructiva(primario) ? modal.querySelector('#modal-cancelar') : primario) ||
        modal.querySelector('button');
      destino?.focus();
    }).observe(overlay, { childList: true, attributes: true, attributeFilter: ['class'] });
  }
})();
