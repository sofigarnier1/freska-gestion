// Acceso (contraseña y bloqueo por inactividad), tema, avisos de error y arranque de la app.
// (Antes todo estaba en renderer.js; se dividió por pantalla el 2026-09-24. Los archivos son scripts comunes que
// comparten el mismo espacio global: se cargan en el orden de index.html y no hace falta importar nada.)

function bloquearApp() {
  pantallaPin.classList.add('visible');
  if (typeof cerrarPanelAvisos === 'function') cerrarPanelAvisos();
}

function desbloquearApp() {
  pantallaPin.classList.remove('visible');
  pantallaPin.innerHTML = '';
}

const ICONO_OJO =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICONO_OJO_TACHADO =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M6.61 6.61A18.5 18.5 0 0 0 1 12s4 8 11 8a9.26 9.26 0 0 0 5.39-1.61"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function campoPin(id, placeholder, { compacto = false, autofocus = false } = {}) {
  return `
    <div class="pin-input-wrapper">
      <input
        type="password"
        id="${id}"
        class="pin-input${compacto ? ' compacto' : ''}"
        placeholder="${esc(placeholder)}"
        ${autofocus ? 'autofocus' : ''}
      />
      <button type="button" class="toggle-ver-pin" data-target="${id}" aria-label="Mostrar contraseña" tabindex="-1">${ICONO_OJO}</button>
    </div>
  `;
}

function vincularTogglesPin() {
  // Busca en todo el documento, no solo en la pantalla de login: este mismo campo se reutiliza
  // en modales (por ejemplo "Agregar usuario"), que viven en otro contenedor (`modalOverlay`).
  document.querySelectorAll('.toggle-ver-pin').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      const mostrando = input.type === 'text';
      input.type = mostrando ? 'password' : 'text';
      btn.innerHTML = mostrando ? ICONO_OJO : ICONO_OJO_TACHADO;
    });
  });
}

// El logo de las pantallas de contraseña: una imagen para el modo claro y otra para el oscuro (se alterna con CSS).
const LOGO_PIN_HTML = `<img src="assets/logo-freska-nombre.png" alt="FRESKA" class="logo-freska logo-claro" /><img src="assets/logo-freska-nombre-oscuro.png" alt="" class="logo-freska logo-oscuro" />`;

// Quién está usando la app ahora ({ id, nombre, rol }), o null si todavía no entró nadie.
let sesionActual = null;

// A quién se le pregunta la contraseña: null hasta elegirlo en la pantalla "¿Quién sos?" (que solo aparece
// si hay más de un usuario cargado). Con uno solo, se salta directo a pedir la contraseña, como antes.
let usuarioParaIngresar = null;

function guardarUltimoUsuario(id) {
  try {
    localStorage.setItem('freska-ultimo-usuario', String(id));
  } catch (e) {
    // sin almacenamiento local, la próxima vez vuelve a preguntar quién es
  }
}
function ultimoUsuarioGuardado() {
  try {
    return Number(localStorage.getItem('freska-ultimo-usuario')) || null;
  } catch (e) {
    return null;
  }
}

// Primera vez que se abre la app: no hay nadie cargado todavía. Se crea el primer administrador (antes era
// "la" contraseña de toda la app).
function mostrarCrearPin() {
  pantallaPin.innerHTML = `
    <div class="pin-card">
      ${LOGO_PIN_HTML}
      <h2>Crear contraseña de acceso</h2>
      <p class="pin-subtitulo">Elegí una contraseña de al menos 4 caracteres para proteger la app.</p>
      <input id="pin-nombre" class="pin-input compacto" type="text" placeholder="Tu nombre" autofocus maxlength="40" />
      ${campoPin('pin-nuevo', 'Ingresá tu contraseña', { compacto: true })}
      ${campoPin('pin-confirmar', 'Confirmar contraseña', { compacto: true })}
      <p id="pin-error" class="error-msg" style="display:none"></p>
      <button id="btn-crear-pin" class="primary" type="button">Crear contraseña</button>
    </div>
  `;
  vincularTogglesPin();

  const inputNombre = document.getElementById('pin-nombre');
  const inputNuevo = document.getElementById('pin-nuevo');
  const inputConfirmar = document.getElementById('pin-confirmar');
  const error = document.getElementById('pin-error');
  inputNombre.focus();

  [inputNombre, inputNuevo, inputConfirmar].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-crear-pin').click();
    });
  });

  document.getElementById('btn-crear-pin').addEventListener('click', async () => {
    const nombre = inputNombre.value.trim();
    const pin = inputNuevo.value;
    const confirmar = inputConfirmar.value;
    if (!nombre) {
      error.textContent = 'Poné tu nombre.';
      error.style.display = '';
      return;
    }
    if (pin.length < 4) {
      error.textContent = 'La contraseña debe tener al menos 4 caracteres.';
      error.style.display = '';
      return;
    }
    if (pin !== confirmar) {
      error.textContent = 'Las contraseñas no coinciden.';
      error.style.display = '';
      return;
    }
    const resultado = await window.freska.usuarios.crearPrimero({ nombre, pin });
    if (resultado.ok === false) {
      error.textContent = resultado.error;
      error.style.display = '';
      return;
    }
    entrarComo(resultado.usuario);
  });
}

// Cuando hay más de un usuario: elegir el nombre antes de pedir la contraseña. Recuerda al último que entró
// (como el candado de un teléfono), con un link para elegir a otro.
async function mostrarQuienSos(forzarLista = false) {
  const usuarios = await window.freska.usuarios.paraElegir();
  if (usuarios.length <= 1) {
    usuarioParaIngresar = usuarios[0] || null;
    mostrarIngresarPin();
    return;
  }
  const ultimo = ultimoUsuarioGuardado();
  const preseleccionado = !forzarLista && usuarios.find((u) => u.id === ultimo);
  if (preseleccionado) {
    usuarioParaIngresar = preseleccionado;
    mostrarIngresarPin();
    return;
  }
  pantallaPin.innerHTML = `
    <div class="pin-card">
      ${LOGO_PIN_HTML}
      <h2>¿Quién sos?</h2>
      <div class="quien-sos-lista">
        ${usuarios.map((u) => `<button type="button" class="quien-sos-item" data-id="${u.id}">${esc(u.nombre)}</button>`).join('')}
      </div>
    </div>
  `;
  pantallaPin.querySelectorAll('.quien-sos-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      usuarioParaIngresar = usuarios.find((u) => u.id === Number(btn.dataset.id));
      mostrarIngresarPin();
    });
  });
}

function mostrarIngresarPin() {
  const usuario = usuarioParaIngresar;
  pantallaPin.innerHTML = `
    <div class="pin-card">
      ${LOGO_PIN_HTML}
      ${usuario ? `<p class="pin-subtitulo">${esc(usuario.nombre)}</p>` : ''}
      ${campoPin('pin-ingresar', 'Ingresá tu contraseña', { compacto: true, autofocus: true })}
      <p id="pin-error" class="error-msg" style="display:none"></p>
      <button id="btn-ingresar-pin" class="primary" type="button">Ingresar</button>
      ${usuario ? '<button type="button" id="btn-no-soy-yo" class="link-secundario">¿No sos vos?</button>' : ''}
    </div>
  `;
  vincularTogglesPin();

  const inputPin = document.getElementById('pin-ingresar');
  const error = document.getElementById('pin-error');
  // El `autofocus` del HTML no siempre alcanza cuando el formulario se arma desde el código: se enfoca a mano para poder
  // escribir la contraseña apenas aparece.
  inputPin.focus();

  inputPin.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-ingresar-pin').click();
  });

  document.getElementById('btn-no-soy-yo')?.addEventListener('click', () => {
    usuarioParaIngresar = null;
    try {
      localStorage.removeItem('freska-ultimo-usuario');
    } catch (e) {
      // nada que limpiar
    }
    mostrarQuienSos();
  });

  const btnIngresar = document.getElementById('btn-ingresar-pin');
  // Tras varios errores seguidos hay que esperar: se muestra la cuenta regresiva y se traba el campo.
  const esperar = (segundos) => {
    inputPin.disabled = true;
    btnIngresar.disabled = true;
    let resta = segundos;
    const pintar = () => {
      error.textContent = `Demasiados intentos. Esperá ${resta} ${resta === 1 ? 'segundo' : 'segundos'}.`;
      error.style.display = '';
    };
    pintar();
    const timer = setInterval(() => {
      resta -= 1;
      if (resta > 0) return pintar();
      clearInterval(timer);
      inputPin.disabled = false;
      btnIngresar.disabled = false;
      error.style.display = 'none';
      inputPin.focus();
    }, 1000);
  };

  btnIngresar.addEventListener('click', async () => {
    if (!usuario) return; // no debería pasar: sin usuarios para elegir no hay nada para validar
    const resultado = await window.freska.usuarios.ingresar({ usuario_id: usuario.id, pin: inputPin.value });
    if (!resultado.ok) {
      inputPin.value = '';
      if (resultado.bloqueadoSegundos > 0) {
        esperar(resultado.bloqueadoSegundos);
        return;
      }
      error.textContent = 'Contraseña incorrecta.';
      error.style.display = '';
      inputPin.focus();
      return;
    }
    entrarComo(resultado.usuario);
  });
}

// Deja entrar a la app ya con la sesión puesta: recuerda quién es para la próxima vez y acomoda el menú y la
// barra lateral según sea administrador o empleado.
function entrarComo(usuario) {
  sesionActual = usuario;
  guardarUltimoUsuario(usuario.id);
  aplicarPermisosUI();
  desbloquearApp();
  iniciarApp();
}

function mostrarCambiarPin() {
  pantallaPin.innerHTML = `
    <div class="pin-card">
      <h2>Cambiar contraseña</h2>
      ${sesionActual ? `<p class="pin-subtitulo">${esc(sesionActual.nombre)}</p>` : ''}
      ${campoPin('pin-actual', 'Contraseña actual', { compacto: true, autofocus: true })}
      ${campoPin('pin-nuevo', 'Contraseña nueva', { compacto: true })}
      ${campoPin('pin-confirmar', 'Confirmar contraseña nueva', { compacto: true })}
      <p id="pin-error" class="error-msg" style="display:none"></p>
      <div class="btn-group">
        <button id="btn-guardar-cambio-pin" class="primary" type="button">Guardar</button>
        <button id="btn-cancelar-cambio-pin" type="button">Cancelar</button>
      </div>
    </div>
  `;
  vincularTogglesPin();

  const inputActual = document.getElementById('pin-actual');
  inputActual.focus();
  const inputNuevo = document.getElementById('pin-nuevo');
  const inputConfirmar = document.getElementById('pin-confirmar');
  const error = document.getElementById('pin-error');

  document.getElementById('btn-cancelar-cambio-pin').addEventListener('click', () => {
    desbloquearApp();
  });

  document.getElementById('btn-guardar-cambio-pin').addEventListener('click', async () => {
    if (inputNuevo.value.length < 4) {
      error.textContent = 'La contraseña nueva debe tener al menos 4 caracteres.';
      error.style.display = '';
      return;
    }
    if (inputNuevo.value !== inputConfirmar.value) {
      error.textContent = 'Las contraseñas nuevas no coinciden.';
      error.style.display = '';
      return;
    }
    const resultado = await window.freska.usuarios.cambiarPin({
      actual: inputActual.value,
      nuevo: inputNuevo.value,
    });
    if (resultado.ok === false) {
      error.textContent = resultado.error;
      error.style.display = '';
      return;
    }
    desbloquearApp();
    mostrarToast('Contraseña actualizada.', 'ok');
  });
}

// Qué puede ver un empleado: se le ocultan de la barra lateral Dinero, Proveedores, Productos y stock y
// Estadísticas, y del menú del usuario, Usuarios, Dirección del local y Copia de seguridad, y la campanita de
// avisos. Un administrador ve todo (y esta función lo deja todo visible por si venía oculto de una sesión
// anterior de otra persona en la misma compu).
function aplicarPermisosUI() {
  const esEmpleado = sesionActual && sesionActual.rol === 'empleado';
  // Para un empleado son solo 4 pantallas (Pedidos, Facturas, Cobros, Clientes): en vez de esconderlas
  // atrás de las flechitas de "Ventas"/"Clientes y proveedores" (pensadas para el administrador, que tiene
  // mucho más adentro), se ocultan esos grupos enteros y se muestran los 4 ítems sueltos de `.grupo-empleado`.
  document.querySelectorAll('#sidebar [data-grupo="dinero"], #sidebar [data-grupo="productos"], #sidebar [data-grupo="estadisticas"], #sidebar [data-grupo="ventas"], #sidebar [data-grupo="clientes"]').forEach((el) => {
    el.hidden = esEmpleado;
  });
  document.querySelectorAll('#sidebar .grupo-empleado').forEach((el) => {
    el.hidden = !esEmpleado;
  });
  const avisosContenedor = document.querySelector('.avisos-contenedor');
  if (avisosContenedor) avisosContenedor.hidden = esEmpleado;
  ['btn-usuarios', 'btn-direccion-local', 'btn-backup', 'btn-actualizar'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = esEmpleado;
  });
  const nombre = document.getElementById('menu-usuario-nombre');
  if (nombre) {
    nombre.hidden = !sesionActual;
    nombre.textContent = sesionActual ? `${sesionActual.nombre} · ${sesionActual.rol === 'admin' ? 'Administrador' : 'Empleado'}` : '';
  }
}

const btnMenuUsuario = document.getElementById('btn-menu-usuario');
const menuUsuarioLista = document.getElementById('menu-usuario-lista');

const btnTema = document.getElementById('btn-tema');

function actualizarBotonTema() {
  btnTema.textContent = temaEfectivo() === 'dark' ? 'Modo claro' : 'Modo oscuro';
}

// Si nadie toca la app por un rato, se bloquea sola y vuelve a pedir la contraseña.
const MINUTOS_SIN_ACTIVIDAD = 20;
let ultimaActividad = Date.now();

// Si algo falla y nadie lo atajó (un guardado que no llegó a la base, por ejemplo), en vez de que el botón "no haga
// nada" se avisa. Uno cada pocos segundos, para que una cadena de errores no tape la pantalla.
let ultimoAvisoDeError = 0;
function avisarErrorInesperado() {
  const ahora = Date.now();
  if (ahora - ultimoAvisoDeError < 4000) return;
  ultimoAvisoDeError = ahora;
  mostrarToast('Algo falló y no se pudo completar. Probá de nuevo; si sigue pasando, avisá.', 'error');
}

function mostrarToast(mensaje, tipo = 'ok') {
  const toast = document.getElementById('toast');
  toast.textContent = mensaje;
  toast.className = `visible ${tipo}`;
  setTimeout(() => {
    toast.className = '';
  }, 4000);
}

// ---------- Actualizaciones (solo el administrador) ----------
async function ofrecerActualizacion(r) {
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Hay una versión nueva</h3>
    <p>Tenés la versión ${esc(r.actual)} y ya está la ${esc(r.version)}. Al actualizar, la app se cierra y se vuelve a abrir sola. Tus datos no se tocan.</p>
    <div class="btn-group">
      <button type="button" id="modal-ahora-no" class="secondary">Ahora no</button>
      <button type="button" id="modal-confirmar" class="primary">Actualizar</button>
    </div>
  `);
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-ahora-no').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    mostrarModal('<h3>Descargando la actualización…</h3><p>No cierres la app. Puede tardar unos minutos.</p>');
    const res = await window.freska.sistema.instalarActualizacion();
    if (!res || !res.ok) {
      cerrarModal();
      mostrarToast((res && res.error) || 'No se pudo actualizar.', 'error');
    }
  });
}

// `manual`: lo pidió la persona desde el menú (avisa también si no hay nada nuevo o si falló);
// al abrir la app solo aparece algo si hay una versión nueva.
async function buscarActualizacion(manual) {
  const r = await window.freska.sistema.buscarActualizacion();
  if (r && r.ok && r.disponible) return ofrecerActualizacion(r);
  if (!manual) return;
  if (!r || !r.ok) return mostrarToast((r && r.error) || 'No se pudo buscar actualizaciones.', 'error');
  mostrarToast(r.enDesarrollo ? 'Solo se puede buscar en la app instalada.' : `Ya tenés la última versión (${r.actual}).`, 'ok');
}

// Flecha para volver arriba: aparece cuando se scrolleó bastante hacia abajo.
const btnSubir = document.getElementById('btn-subir');

function iniciarApp() {
  // Siempre arranca en Pedidos. Se elige el botón del sidebar que corresponde (el ítem suelto para un
  // empleado, el de adentro de "Ventas" para el administrador) para que la miga de pan y el resaltado
  // del menú queden bien desde el arranque, no solo la pantalla.
  // No se reusa el ".active" que haya quedado de antes: si se cambia de usuario, puede ser el de un rol
  // distinto (oculto ahora) y dejaría la miga de pan y el resaltado del sidebar apuntando a otro lado.
  const esEmpleado = sesionActual && sesionActual.rol === 'empleado';
  const inicial = esEmpleado
    ? document.querySelector('#sidebar button[data-grupo="pedidos-plano"]')
    : document.querySelector('#sidebar button[data-view="pedidos"][data-grupo="ventas"]');
  if (inicial) {
    actualizarMigaGrupo(inicial);
    activarGrupo(inicial.dataset.grupo);
    navButtons.forEach((b) => b.classList.remove('active'));
    inicial.classList.add('active');
  }
  renderPedidos();
  if (typeof refrescarAvisos === 'function') refrescarAvisos(true);
  if (!esEmpleado) buscarActualizacion(false).catch(() => {});
}

// ---------- Usuarios (solo el administrador): quién puede entrar, con qué contraseña y qué tipo de acceso ----------
let formUsuario = null; // null = cerrado | {} = alta | usuario = edición
let errorFormUsuario = null;

async function renderUsuarios() {
  const usuarios = await window.freska.usuarios.listar();
  const enEdicion = formUsuario && formUsuario.id ? formUsuario : null;
  app.innerHTML = `
    <button id="btn-volver-menu" class="btn-volver" type="button">&larr; Volver</button>
    <h2>Usuarios</h2>
    <p class="pin-subtitulo" style="margin-bottom:20px;">
      Un <strong>administrador</strong> ve todo, incluida la plata del negocio. Un <strong>empleado</strong> solo puede usar Pedidos, Facturas, Cobros y Clientes.
    </p>
    ${
      formUsuario
        ? `<h2 style="font-size:18px;">${enEdicion ? 'Editar usuario' : 'Agregar usuario'}</h2>
    <form id="form-usuario" class="panel gasto-form">
      ${errorFormUsuario ? `<p class="error-msg">${esc(errorFormUsuario)}</p>` : ''}
      <div class="gasto-fila">
        <label class="gasto-campo"><span>Nombre</span><input type="text" id="usuario-nombre" maxlength="40" required value="${enEdicion ? esc(enEdicion.nombre) : ''}" /></label>
        <label class="gasto-campo"><span>Tipo</span>
          <select id="usuario-rol">
            <option value="empleado" ${!enEdicion || enEdicion.rol === 'empleado' ? 'selected' : ''}>Empleado</option>
            <option value="admin" ${enEdicion && enEdicion.rol === 'admin' ? 'selected' : ''}>Administrador</option>
          </select>
        </label>
      </div>
      ${
        enEdicion
          ? ''
          : `<div class="gasto-fila">
        <div class="gasto-campo"><span>Contraseña</span>${campoPin('usuario-pin', 'Al menos 4 caracteres', { compacto: true })}</div>
      </div>`
      }
      <div class="btn-group">
        <button type="submit" class="primary">${enEdicion ? 'Guardar' : 'Agregar'}</button>
        <button type="button" id="btn-cancelar-form-usuario">Cancelar</button>
      </div>
    </form>`
        : `<div class="lista-agregar"><button id="btn-agregar-usuario" class="primary" type="button">+ Agregar usuario</button></div>`
    }
    <table class="angosto">
      <thead><tr><th>Nombre</th><th>Tipo</th><th></th><th></th></tr></thead>
      <tbody>
        ${usuarios
          .map(
            (u) => `
        <tr${u.activo ? '' : ' class="fila-anulada"'}>
          <td>${esc(u.nombre)}</td>
          <td>${u.rol === 'admin' ? 'Administrador' : 'Empleado'}${u.activo ? '' : ' · Dado de baja'}</td>
          <td class="celda-centrada"><div class="menu-fila">
            <button class="btn-menu-fila" type="button" aria-label="Acciones de ${esc(u.nombre)}">⋮</button>
            <div class="menu-fila-lista">
              <button type="button" class="item-menu editar-usuario" data-id="${u.id}">Editar</button>
              <button type="button" class="item-menu resetear-pin-usuario" data-id="${u.id}" data-nombre="${esc(u.nombre)}">Resetear contraseña</button>
              ${u.activo ? `<button type="button" class="item-menu baja-usuario" data-id="${u.id}">Dar de baja</button>` : `<button type="button" class="item-menu alta-usuario" data-id="${u.id}">Dar de alta</button>`}
            </div>
          </div></td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;

  document.getElementById('btn-volver-menu').addEventListener('click', () => renderPedidos());
  vincularMenuFila();

  document.getElementById('btn-agregar-usuario')?.addEventListener('click', () => {
    formUsuario = {};
    errorFormUsuario = null;
    renderUsuarios();
  });
  if (formUsuario) {
    vincularTogglesPin();
    document.getElementById('usuario-nombre').focus();
    document.getElementById('btn-cancelar-form-usuario').addEventListener('click', () => {
      formUsuario = null;
      errorFormUsuario = null;
      renderUsuarios();
    });
    document.getElementById('form-usuario').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = document.getElementById('usuario-nombre').value.trim();
      const rol = document.getElementById('usuario-rol').value;
      if (!nombre) {
        errorFormUsuario = 'Poné un nombre.';
        renderUsuarios();
        return;
      }
      const r = enEdicion
        ? await window.freska.usuarios.actualizar({ id: enEdicion.id, nombre, rol })
        : await window.freska.usuarios.crear({ nombre, rol, pin: document.getElementById('usuario-pin').value });
      if (r.ok === false) {
        errorFormUsuario = r.error;
        renderUsuarios();
        return;
      }
      if (enEdicion && sesionActual && sesionActual.id === enEdicion.id) {
        sesionActual = { ...sesionActual, nombre, rol };
        aplicarPermisosUI();
      }
      formUsuario = null;
      errorFormUsuario = null;
      mostrarToast(enEdicion ? 'Usuario actualizado.' : 'Usuario agregado.', 'ok');
      renderUsuarios();
    });
  }

  // Para resetear la contraseña de OTRO usuario (no la propia: eso es "Cambiar contraseña", que sí pide la
  // actual). Acá no se pide la anterior porque quien resetea no tiene por qué saberla (es común que se use
  // justo porque la persona la olvidó); en cambio si pide repetirla dos veces, para no errar al tipearla.
  const pedirPin = (titulo, alConfirmar) => {
    mostrarModal(`${modalXHtml('modal-cancelar')}
      <h3>${esc(titulo)}</h3>
      ${campoPin('modal-pin-nuevo', 'Contraseña nueva (al menos 4 caracteres)', { compacto: true, autofocus: true })}
      ${campoPin('modal-pin-repetir', 'Repetir contraseña nueva', { compacto: true })}
      <p id="modal-pin-error" class="error-msg" style="display:none"></p>
      <div class="btn-group">
        <button type="button" id="modal-confirmar" class="primary">Guardar</button>
      </div>
    `);
    vincularTogglesPin();
    document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('modal-confirmar').addEventListener('click', async () => {
      const pin = document.getElementById('modal-pin-nuevo').value;
      const repetir = document.getElementById('modal-pin-repetir').value;
      const error = document.getElementById('modal-pin-error');
      if (pin.length < 4) {
        error.textContent = 'La contraseña debe tener al menos 4 caracteres.';
        error.style.display = '';
        return;
      }
      if (pin !== repetir) {
        error.textContent = 'Las dos contraseñas no coinciden.';
        error.style.display = '';
        return;
      }
      const resultado = await alConfirmar(pin);
      if (resultado && resultado.ok === false) {
        error.textContent = resultado.error;
        error.style.display = '';
        return;
      }
      cerrarModal();
      mostrarToast('Listo.', 'ok');
      renderUsuarios();
    });
  };

  app.querySelectorAll('.editar-usuario').forEach((btn) => {
    btn.addEventListener('click', () => {
      formUsuario = usuarios.find((u) => u.id === Number(btn.dataset.id));
      errorFormUsuario = null;
      renderUsuarios();
    });
  });

  app.querySelectorAll('.resetear-pin-usuario').forEach((btn) => {
    btn.addEventListener('click', () => {
      pedirPin(`Nueva contraseña para ${btn.dataset.nombre}`, (pin) =>
        window.freska.usuarios.resetearPin({ id: Number(btn.dataset.id), pin })
      );
    });
  });

  app.querySelectorAll('.baja-usuario').forEach((btn) => {
    btn.addEventListener('click', () => {
      const usuario = usuarios.find((u) => u.id === Number(btn.dataset.id));
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Dar de baja</h3>
        <p>¿Dar de baja a <strong>${esc(usuario.nombre)}</strong>? Deja de poder entrar a FRESKA hasta que lo des de alta de nuevo.</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, dar de baja</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        const resultado = await window.freska.usuarios.actualizar({ id: usuario.id, activo: false });
        cerrarModal();
        if (resultado.ok === false) {
          mostrarToast(resultado.error, 'error');
          return;
        }
        mostrarToast('Usuario dado de baja.', 'ok');
        renderUsuarios();
      });
    });
  });

  app.querySelectorAll('.alta-usuario').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const resultado = await window.freska.usuarios.actualizar({ id: Number(btn.dataset.id), activo: true });
      if (resultado.ok === false) {
        mostrarToast(resultado.error, 'error');
        return;
      }
      mostrarToast('Usuario dado de alta.', 'ok');
      renderUsuarios();
    });
  });
}
