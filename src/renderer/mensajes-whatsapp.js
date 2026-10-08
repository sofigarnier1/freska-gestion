// Mensajes de WhatsApp: factura por WhatsApp y consultas a los clientes.
// (Antes todo estaba en renderer.js; se dividió por pantalla el 2026-09-24. Los archivos son scripts comunes que
// comparten el mismo espacio global: se cargan en el orden de index.html y no hace falta importar nada.)

function construirMensajeWhatsapp(factura, items, cliente) {
  const lineas = items
    .map((i) => {
      const unidad = i.producto_unidad === 'kg' ? 'kg' : 'u.';
      return `• ${formatearCantidad(i.cantidad)} ${unidad} ${i.producto_nombre}${sufijoPedidoUnidades(i)}  (x $${formatearMoneda(i.precio_unitario)}) = $${formatearMoneda(i.subtotal)}`;
    })
    .join('\n');
  const ESTADOS = { pendiente: 'Pendiente', parcial: 'Pago parcial', pagada: 'Pagada', anulada: 'Anulada' };
  const restante = factura.total - factura.pagado;
  const tipoPrecio = factura.tipo_precio === 'cf' ? 'Consumidor Final' : 'Cliente';

  let mensaje =
    `🥩 *FRESKA*\n` +
    `Factura #${factura.id}\n` +
    `Fecha: ${new Date(factura.fecha).toLocaleDateString('es-AR')}\n` +
    `Cliente: ${nombreCompleto(cliente)}\n` +
    `Precio: ${tipoPrecio}\n\n` +
    `*Detalle:*\n${lineas}\n\n` +
    `*Total: $${formatearMoneda(factura.total)}*\n`;

  if (factura.estado === 'pagada') {
    mensaje += `Estado: Pagada ✅`;
  } else if (factura.estado === 'parcial') {
    mensaje +=
      `Pagado: $${formatearMoneda(factura.pagado)}\n` +
      `Saldo pendiente: $${formatearMoneda(restante)}\n` +
      `Estado: Pago parcial`;
  } else {
    mensaje += `Estado: ${ESTADOS[factura.estado] || factura.estado}`;
  }

  mensaje += `\n\n¡Gracias por tu compra!`;
  return mensaje;
}

const PREGUNTAS_CONSULTA = {
  hoy: '¿Qué vas a necesitar hoy?',
  manana: '¿Qué vas a necesitar mañana?',
};

function construirMensajeConsulta(cliente, pregunta) {
  return `🥩 *FRESKA*\nHola ${cliente.nombre}! ${pregunta}`;
}

function abrirSeleccionConsulta(clientes) {
  const conTelefono = clientes.filter((c) => (c.telefono || '').trim() !== '');
  if (conTelefono.length === 0) {
    mostrarToast('Ningún cliente tiene teléfono cargado.', 'error');
    return;
  }

  let pestanaConsulta = 'todos';
  let tipoMensaje = 'hoy';
  let mensajePersonalizado = '';

  function ordenadosPorRecencia(lista) {
    return [...lista].sort((a, b) => {
      if (!a.ultima_consulta && !b.ultima_consulta) return 0;
      if (!a.ultima_consulta) return 1;
      if (!b.ultima_consulta) return -1;
      return new Date(b.ultima_consulta) - new Date(a.ultima_consulta);
    });
  }

  function listaSegunPestana() {
    const base =
      pestanaConsulta === 'recientes' ? conTelefono.filter((c) => c.ultima_consulta) : conTelefono;
    return ordenadosPorRecencia(base);
  }

  function render() {
    const lista = listaSegunPestana();
    mostrarModal(`${modalXHtml('btn-cancelar-consulta')}
      <h3>Enviar consulta por WhatsApp</h3>
      <p>Elegí a quién le querés preguntar qué necesita.</p>
      <div class="reportes-toggle consulta-toggle">
        <button type="button" class="toggle ${pestanaConsulta === 'todos' ? 'active' : ''}" id="tab-todos-consulta">Todos</button>
        <button type="button" class="toggle ${pestanaConsulta === 'recientes' ? 'active' : ''}" id="tab-recientes-consulta">Recientes</button>
      </div>
      <label class="check-todos-consulta">
        <input type="checkbox" id="check-todos-consulta" />
        Seleccionar todos
      </label>
      <div class="lista-consulta-clientes">
        ${
          lista.length === 0
            ? '<p class="lista-consulta-vacia">Todavía no le mandaste una consulta a nadie desde acá.</p>'
            : lista
                .map(
                  (c) => `
        <label class="item-consulta-cliente">
          <input type="checkbox" class="check-consulta-cliente" value="${c.id}" />
          ${esc(nombreCompleto(c))}
        </label>`
                )
                .join('')
        }
      </div>
      <p class="consulta-mensaje-titulo">Mensaje a enviar</p>
      <div class="opciones-mensaje-consulta">
        <label>
          <input type="radio" name="tipo-mensaje-consulta" value="hoy" ${tipoMensaje === 'hoy' ? 'checked' : ''} />
          ¿Qué necesitás hoy?
        </label>
        <label>
          <input type="radio" name="tipo-mensaje-consulta" value="manana" ${tipoMensaje === 'manana' ? 'checked' : ''} />
          ¿Qué necesitás mañana?
        </label>
        <label>
          <input type="radio" name="tipo-mensaje-consulta" value="personalizado" ${tipoMensaje === 'personalizado' ? 'checked' : ''} />
          Escribir el mensaje
        </label>
      </div>
      ${
        tipoMensaje === 'personalizado'
          ? `<textarea id="texto-mensaje-personalizado" class="texto-mensaje-personalizado" placeholder="Escribí acá lo que querés preguntarle...">${esc(mensajePersonalizado)}</textarea>`
          : ''
      }
      <div class="btn-group">
        <button type="button" id="btn-iniciar-consulta" class="primary">Enviar consulta</button>
      </div>
    `);

    document.getElementById('tab-todos-consulta').addEventListener('click', () => {
      pestanaConsulta = 'todos';
      render();
    });
    document.getElementById('tab-recientes-consulta').addEventListener('click', () => {
      pestanaConsulta = 'recientes';
      render();
    });

    const checkTodos = document.getElementById('check-todos-consulta');
    const checksIndividuales = () => Array.from(document.querySelectorAll('.check-consulta-cliente'));

    checkTodos.addEventListener('change', () => {
      checksIndividuales().forEach((chk) => (chk.checked = checkTodos.checked));
    });

    checksIndividuales().forEach((chk) => {
      chk.addEventListener('change', () => {
        checkTodos.checked = checksIndividuales().length > 0 && checksIndividuales().every((c) => c.checked);
      });
    });

    document.querySelectorAll('input[name="tipo-mensaje-consulta"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        tipoMensaje = radio.value;
        render();
      });
    });

    const textoPersonalizado = document.getElementById('texto-mensaje-personalizado');
    if (textoPersonalizado) {
      textoPersonalizado.addEventListener('input', () => {
        mensajePersonalizado = textoPersonalizado.value;
      });
      textoPersonalizado.focus();
    }

    document.getElementById('btn-cancelar-consulta').addEventListener('click', cerrarModal);

    document.getElementById('btn-iniciar-consulta').addEventListener('click', () => {
      const idsSeleccionados = checksIndividuales()
        .filter((chk) => chk.checked)
        .map((chk) => Number(chk.value));
      if (idsSeleccionados.length === 0) return;
      const pregunta =
        tipoMensaje === 'personalizado' ? mensajePersonalizado.trim() : PREGUNTAS_CONSULTA[tipoMensaje];
      if (!pregunta) {
        mostrarToast('Escribí el mensaje antes de enviar.', 'error');
        return;
      }
      const seleccionados = conTelefono.filter((c) => idsSeleccionados.includes(c.id));
      iniciarEnvioConsultas(seleccionados, pregunta);
    });
  }

  render();
}

function iniciarEnvioConsultas(lista, pregunta) {
  let indice = 0;

  function mostrarPaso() {
    if (indice >= lista.length) {
      mostrarToast('Listo, se envió la consulta a todos los seleccionados.');
      cerrarModal();
      return;
    }
    const cliente = lista[indice];
    mostrarModal(`${modalXHtml('btn-cancelar-envio')}
      <h3>Enviar consulta (${indice + 1} de ${lista.length})</h3>
      <p>Se va a abrir WhatsApp con <strong>${esc(nombreCompleto(cliente))}</strong> y el mensaje ya escrito. Revisalo, apretá Enviar ahí adentro y volvé a FRESKA.</p>
      <div class="btn-group">
        <button type="button" id="btn-saltear-envio">Saltear</button>
        <button type="button" id="btn-abrir-envio" class="primary">Abrir WhatsApp</button>
      </div>
    `);

    document.getElementById('btn-cancelar-envio').addEventListener('click', cerrarModal);
    document.getElementById('btn-saltear-envio').addEventListener('click', () => {
      indice += 1;
      mostrarPaso();
    });
    document.getElementById('btn-abrir-envio').addEventListener('click', async () => {
      const telefono = (cliente.telefono || '').replace(/\D/g, '');
      const mensaje = construirMensajeConsulta(cliente, pregunta);
      const url = `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
      await window.freska.sistema.abrirEnlace(url);
      await window.freska.clientes.registrarConsulta(cliente.id);
      indice += 1;
      mostrarPaso();
    });
  }

  mostrarPaso();
}
