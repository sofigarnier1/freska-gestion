// Lo que se ejecuta al cargar la app (listeners y arranque). Va al final, cuando todo lo anterior ya está definido.
// (Antes todo estaba en renderer.js; se dividió por pantalla el 2026-09-24. Los archivos son scripts comunes que
// comparten el mismo espacio global: se cargan en el orden de index.html y no hace falta importar nada.)

aplicarTemaGuardado();

// El modo elegido también vive en la base (lo de arriba es solo para que no parpadee al abrir): si la base
// tiene uno, manda ese.
window.freska.config
  .obtenerTema()
  .then((tema) => {
    if (tema !== 'light' && tema !== 'dark') return;
    try {
      localStorage.setItem('freska-tema', tema);
    } catch (e) {
      // sin almacenamiento local: igual queda en la base
    }
    document.documentElement.dataset.theme = tema;
    actualizarBotonTema();
  })
  .catch(() => {});

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) cerrarModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (modalOverlay.classList.contains('visible')) {
    cerrarModal();
    return;
  }
  const menuUsuario = document.getElementById('menu-usuario-lista');
  if (menuUsuario && menuUsuario.classList.contains('visible')) {
    menuUsuario.classList.remove('visible');
    document.getElementById('btn-menu-usuario')?.focus();
    return;
  }
  const menuFilaAbierto = document.querySelector('.menu-fila-lista.visible');
  if (menuFilaAbierto) {
    menuFilaAbierto.classList.remove('visible');
    menuFilaAbierto.previousElementSibling?.focus();
  }
});

window.addEventListener('resize', () => {
  document.querySelectorAll('tr.items-factura-tab-fila, tr.items-pedido-fila').forEach(alinearDetalleFactura);
});

const views = {
  facturas: renderFacturas,
  pedidos: renderPedidos,
  cobros: renderCobros,
  cierre: renderCierreCaja,
  gastos: renderGastos,
  ingresos: renderIngresos,
  cheques: renderCheques,
  clientes: renderClientes,
  proveedores: () => renderProveedores(),
  vendedores: () => {
    formVendedor = null;
    errorFormVendedor = null;
    limitesAnuladasVendedor = {};
    limitesPagosVendedor = {};
    return renderVendedores();
  },
  productos: renderProductos,
  stock: () => renderStock(),
  estadisticas: () => renderEstadisticas(),
};

['input', 'change', 'focusout'].forEach((evento) => app.addEventListener(evento, capturarCamposBorrador));

document.addEventListener('click', (e) => {
  if (flyout.classList.contains('visible') && !flyout.contains(e.target) && !e.target.closest('.grupo-boton')) {
    cerrarFlyout();
  }
});

grupoButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    // El de Estadísticas ya tiene su propio manejador más abajo (es también un botón de página):
    // no hace falta duplicar la navegación acá.
    if (btn.dataset.view) return;
    const grupo = btn.dataset.grupo;
    if (sidebar.classList.contains('colapsada')) {
      if (flyout.classList.contains('visible') && flyout.dataset.grupo === grupo) {
        cerrarFlyout();
      } else {
        abrirFlyout(grupo, btn);
      }
      return;
    }
    // Solo abre o cierra la sublista, nunca navega: para eso está tocar una página de adentro. Antes,
    // abrir un grupo cerrado navegaba a su última página, y eso te movía de pantalla sin querer.
    document.querySelector(`#sidebar .grupo[data-grupo="${grupo}"]`)?.classList.toggle('abierto');
  });
});

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    irAVista(btn);
    if (flyout.classList.contains('visible')) cerrarFlyout();
  });
});

if (sidebarColapsadaGuardada()) sidebar.classList.add('colapsada');

document.getElementById('btn-menu-lateral').addEventListener('click', () => alternarSidebar());

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key?.toLowerCase() === 'b') {
    e.preventDefault();
    alternarSidebar();
  }
});
document.addEventListener('click', cerrarAyudasFlotantes);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cerrarAyudasFlotantes();
});
document.addEventListener('click', cerrarFiltrosLista);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cerrarFiltrosLista();
});

btnMenuUsuario.addEventListener('click', (e) => {
  e.stopPropagation();
  cerrarPanelAvisos(); // los avisos y el menú del usuario no se quedan abiertos a la vez
  menuUsuarioLista.classList.toggle('visible');
});

document.addEventListener('click', () => {
  menuUsuarioLista.classList.remove('visible');
  document.querySelectorAll('.menu-fila-lista.visible').forEach((l) => l.classList.remove('visible'));
  document.querySelectorAll('.calendario-panel').forEach((p) => (p.style.display = 'none'));
});

menuUsuarioLista.addEventListener('click', (e) => {
  e.stopPropagation();
});

document.getElementById('btn-cambiar-pin').addEventListener('click', () => {
  menuUsuarioLista.classList.remove('visible');
  bloquearApp();
  mostrarCambiarPin();
});

document.getElementById('btn-manual').addEventListener('click', () => {
  menuUsuarioLista.classList.remove('visible');
  renderManual();
});

document.getElementById('btn-direccion-local').addEventListener('click', async () => {
  menuUsuarioLista.classList.remove('visible');
  const actual = await window.freska.config.obtenerDireccionLocal();
  const zona = await window.freska.config.obtenerZonaLocal();
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Dirección del local</h3>
    <p>Se usa como punto de partida del recorrido de reparto; la ciudad y la provincia también se suman a las direcciones de los clientes.</p>
    <label>Provincia <input type="text" id="input-provincia-local" value="${esc(zona.provincia)}" placeholder="Provincia del local" /></label>
    <label>Ciudad <input type="text" id="input-ciudad-local" value="${esc(zona.ciudad)}" placeholder="Ciudad del local" /></label>
    <label>Calle y número <input type="text" id="input-direccion-local" value="${esc(actual)}" placeholder="Ej: Díaz Vélez 244" /></label>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary">Guardar</button>
    </div>
  `);
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    const valor = document.getElementById('input-direccion-local').value.trim();
    await window.freska.config.guardarDireccionLocal(valor);
    await window.freska.config.guardarZonaLocal({
      ciudad: document.getElementById('input-ciudad-local').value,
      provincia: document.getElementById('input-provincia-local').value,
    });
    cerrarModal();
    mostrarToast('Dirección del local guardada.', 'ok');
  });
});

btnTema.addEventListener('click', () => {
  const nuevoTema = temaEfectivo() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('freska-tema', nuevoTema);
  } catch (e) {
    // Si el almacenamiento local no está disponible, el tema no se recuerda entre sesiones.
  }
  document.documentElement.dataset.theme = nuevoTema;
  window.freska.config.guardarTema(nuevoTema);
  actualizarBotonTema();
  menuUsuarioLista.classList.remove('visible');
});

actualizarBotonTema();

document.getElementById('btn-usuarios').addEventListener('click', () => {
  menuUsuarioLista.classList.remove('visible');
  formUsuario = null;
  errorFormUsuario = null;
  renderUsuarios();
});

document.getElementById('btn-cerrar-sesion').addEventListener('click', async () => {
  menuUsuarioLista.classList.remove('visible');
  await window.freska.usuarios.cerrarSesion();
  sesionActual = null;
  bloquearApp();
  mostrarQuienSos(true); // fuerza la lista de nombres: capaz sigue otra persona
});
['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach((tipo) => {
  document.addEventListener(tipo, () => (ultimaActividad = Date.now()), true);
});
setInterval(() => {
  if (pantallaPin.classList.contains('visible')) return;
  if (Date.now() - ultimaActividad < MINUTOS_SIN_ACTIVIDAD * 60000) return;
  cerrarModal();
  menuUsuarioLista.classList.remove('visible');
  bloquearApp();
  // Por inactividad se le vuelve a pedir la contraseña a la MISMA persona (no hace falta que vuelva a elegir su
  // nombre): puede haberse alejado un momento, no necesariamente cambió quién está usando la compu.
  usuarioParaIngresar = sesionActual;
  mostrarIngresarPin();
}, 15000);
window.addEventListener('unhandledrejection', (e) => {
  console.error('Error sin atajar:', e.reason && (e.reason.stack || e.reason.message || e.reason));
  avisarErrorInesperado();
});
window.addEventListener('error', (e) => {
  if (String(e.message || '').includes('ResizeObserver')) return; // aviso del navegador, no es un error real
  console.error('Error en la pantalla:', e.message, e.filename ? `(${e.filename}:${e.lineno})` : '');
  avisarErrorInesperado();
});

document.getElementById('btn-actualizar').addEventListener('click', () => {
  menuUsuarioLista.classList.remove('visible');
  buscarActualizacion(true);
});
document.getElementById('btn-backup').addEventListener('click', () => {
  menuUsuarioLista.classList.remove('visible');
  renderCopias();
});
window.addEventListener('scroll', () => {
  btnSubir.classList.toggle('visible', window.scrollY > 500);
});
btnSubir.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

(async () => {
  const usuarios = await window.freska.usuarios.paraElegir();
  bloquearApp();
  if (usuarios.length === 0) {
    mostrarCrearPin();
  } else {
    mostrarQuienSos();
  }
})();


// Mensaje al pasar el mouse por un botón que es solo un ícono o un símbolo (+, −, ×, ⋮, $, 🖨️, el de WhatsApp,
// la campanita, el ojo…): el `title` nativo tarda cerca de un segundo y no se puede acelerar, así que se muestra
// uno propio a los ~120 ms. Toma el texto de `data-tip`, `title` o `aria-label` (el `title` se pasa a `data-tip` la
// primera vez para que el nativo no salga también). Los botones con texto propio no lo llevan: sobraría.
(function () {
  const tip = document.createElement('div');
  tip.className = 'tooltip-rapido';
  tip.hidden = true;
  document.body.appendChild(tip);
  let espera;
  const botonConMensaje = (el) => {
    const boton = el.closest && el.closest('button');
    if (!boton) return null;
    if ([...(boton.textContent || '').trim()].length > 2) return null;
    return boton;
  };
  document.addEventListener('mouseover', (e) => {
    const boton = botonConMensaje(e.target);
    if (!boton) return;
    if (boton.title) {
      boton.dataset.tip = boton.title;
      boton.removeAttribute('title');
    }
    const texto = boton.dataset.tip || boton.getAttribute('aria-label');
    if (!texto) return;
    clearTimeout(espera);
    espera = setTimeout(() => {
      tip.textContent = texto;
      tip.hidden = false;
      const r = boton.getBoundingClientRect();
      const izquierda = Math.min(Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2), window.innerWidth - tip.offsetWidth - 8);
      const arriba = r.top - tip.offsetHeight - 8;
      tip.style.left = `${izquierda}px`;
      tip.style.top = `${arriba < 8 ? r.bottom + 8 : arriba}px`;
    }, 120);
  });
  const ocultar = (e) => {
    if (botonConMensaje(e.target)) {
      clearTimeout(espera);
      tip.hidden = true;
    }
  };
  document.addEventListener('mouseout', ocultar);
  document.addEventListener('click', ocultar);
})();
