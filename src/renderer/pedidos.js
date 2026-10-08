// Pedidos y lista de carga del día.
// (Antes todo estaba en renderer.js; se dividió por pantalla el 2026-09-24. Los archivos son scripts comunes que
// comparten el mismo espacio global: se cargan en el orden de index.html y no hace falta importar nada.)

let pestanaPedidos = 'pendientes';
let filtroFechaPedidos = fechaHoyISO();
let borradorPedido = { items: [] };
let pedidoEditandoId = null;
let paraFechaPedido = ''; // día para el que se programa el pedido que se está cargando (vacío = hoy)
let mostrarFormPedido = true;
let mostrarPedidosHoy = true;
let autoPedidosHecho = false; // al entrar a Pedidos sin pendientes, se muestran Todos una sola vez

// Un pedido anotado para un día futuro: queda aparte (pastilla Programados) hasta ese día.
function esPedidoProgramado(p) {
  return p.estado === 'pendiente' && Boolean(p.para_fecha) && p.para_fecha > fechaHoyISO();
}

async function facturarPedido(pedido) {
  const [items, productosTodos, facturasTodas, clientesTodos] = await Promise.all([
    window.freska.pedidos.items(pedido.id),
    window.freska.productos.listar(),
    window.freska.facturas.listar(),
    window.freska.clientes.listar(),
  ]);
  const productosPorId = Object.fromEntries(productosTodos.map((p) => [p.id, p]));
  const tipoPrecio = tipoPrecioMasUsado(facturasTodas, pedido.cliente_id, clientesTodos);

  borradorFactura.items = items.map((i) => {
    const producto = productosPorId[i.producto_id];
    const precioUnitario = tipoPrecio === 'cf' ? producto.precio_cf : producto.precio_cliente;
    // Lo pedido por unidad ("6 chorizos") se pesa al facturar: la línea arranca sin kilos y recuerda cuántas pidieron.
    if (i.unidad_pedido === 'unidad') {
      return {
        producto_id: i.producto_id,
        nombre: producto.nombre,
        unidad: producto.unidad,
        cantidad: '',
        precio_unitario: precioUnitario,
        subtotal: 0,
        pidieron_unidades: i.cantidad,
      };
    }
    return {
      producto_id: i.producto_id,
      nombre: producto.nombre,
      unidad: producto.unidad,
      cantidad: i.cantidad,
      precio_unitario: precioUnitario,
      subtotal: Math.round(precioUnitario * i.cantidad * 100) / 100,
    };
  });
  facturaEditandoId = null;
  errorEdicionFactura = null;
  pedidoParaFacturar = { pedidoId: pedido.id, clienteId: pedido.cliente_id, clienteNombre: pedido.cliente_nombre };
  registrarOrigenVolver('facturas', 'pedidos', 'pedidos');
  botonDeVista('facturas').click();
}

// Los botones al final de cada línea editable (Pedidos, Facturas, Compras): "−" para quitarla, solo cuando hay
// más de una (con una sola no hay nada que quitar), y "+" para agregar otra, solo en la última línea.
function accionesLineaHtml(claseQuitar, claseAgregar, idx, total) {
  return `${total > 1 ? `<button class="btn-redondo btn-menos ${claseQuitar}" data-idx="${idx}" type="button" aria-label="Quitar línea" title="Quitar línea">−</button>` : ''}${idx === total - 1 ? `<button class="btn-redondo btn-mas ${claseAgregar}" type="button" aria-label="Agregar otro producto" title="Agregar otro producto">+</button>` : ''}`;
}

// Una línea del pedido: producto (autocomplete propio, uno por fila) y cantidad, las dos editables ahí
// mismo — igual criterio que las líneas de una compra (ver proveedores.js). El id y la unidad del producto
// elegido quedan en campos ocultos para poder leer la fila entera sin guardar referencias de JS por fila.
// Un producto que se vende por kilo pero se puede pedir por unidad (el chorizo seco) lleva, en vez de la etiqueta "kg", un
// desplegable kg / u. dentro del casillero de cantidad. Arranca en "u." (o en lo último que se pidió de ese producto).
function lineaPedidoHtml(item, idx, total) {
  const enUnidades = item.unidad_pedido === 'unidad';
  const pesaEnKilos = item.unidad === 'kg' && !enUnidades;
  const unidadHtml = item.pedible
    ? `<select class="pedido-unidad-select" aria-label="Se pide en"><option value="kg" ${enUnidades ? '' : 'selected'}>kg</option><option value="unidad" ${enUnidades ? 'selected' : ''}>u.</option></select>`
    : `<span class="unidad-label" ${item.unidad ? '' : 'style="display:none"'}>${item.unidad === 'kg' ? 'kg' : item.unidad ? 'u.' : ''}</span>`;
  return `
    <tr class="linea-pedido" data-idx="${idx}">
      <td>
        ${productoAutocompleteHtml(`pedido-producto-${idx}`, item.nombre || '')}
        <input type="hidden" class="pedido-item-id" value="${item.producto_id || ''}" />
        <input type="hidden" class="pedido-item-unidad" value="${esc(item.unidad || '')}" />
        <input type="hidden" class="pedido-item-pedible" value="${item.pedible ? '1' : ''}" />
      </td>
      <td>
        <span class="input-unidad">
          <input type="number" class="pedido-item-cantidad" placeholder="${pesaEnKilos ? 'Peso' : 'Cantidad'}" min="0" step="any" value="${item.cantidad || ''}" aria-label="Cantidad" />
          ${unidadHtml}
        </span>
      </td>
      <td class="acciones-linea">${accionesLineaHtml('quitar-item-pedido', 'agregar-linea-pedido', idx, total)}</td>
    </tr>
  `;
}

// La fecha va primero: arranca en hoy (o, al editar, el día en que se anotó) y se puede cambiar. Un día futuro programa el pedido.
function formPedidoHtml(clienteNombreInicial = '', editando = false, fechaBase = fechaHoyISO()) {
  return `
    <div class="panel panel-angosto">
      <div class="pedido-cuerpo">
        <div class="pedido-fila-superior">
          <div class="factura-header">
            ${clienteAutocompleteHtml('pedido-cliente', clienteNombreInicial, editando)}
          </div>
          <div class="pedido-fecha">${selectorFechaHtml('pedido-para-fecha', paraFechaPedido || fechaBase)}</div>
        </div>
        <table class="tabla-compra tabla-pedido tabla-sin-cajas">
          <tbody id="pedido-items-body"></tbody>
        </table>
      </div>
      <p id="error-pedido" class="error-msg" style="display:none"></p>
      <div class="btn-group">
        <button id="btn-guardar-pedido" class="primary" type="button">${editando ? 'Guardar cambios' : 'Guardar pedido'}</button>
        ${editando ? '<button id="btn-cancelar-edicion-pedido" type="button">Cancelar edición</button>' : '<button id="btn-limpiar-pedido" class="btn-limpiar" type="button">Limpiar pedido</button>'}
      </div>
    </div>
  `;
}

// ---------- Lista de carga del día ----------
// Para preparar y cargar la camioneta: por producto, los bultos (cada línea facturada: el peso de la bolsa o caja,
// todos los clientes juntos) con un tilde de "verificado" (arrancan sin tildar: se tilda cada bolsa o caja que está); y
// lo pedido hoy que todavía no se facturó (no se pesó) aparte, como "sin pesar". Se imprime para cargar y se
// puede volver a revisar una vez cargado.
function textoBultoCarga(producto, b) {
  if (producto.unidad === 'kg') return `${formatearPeso(b.peso)} kg`;
  return `${formatearCantidad(b.cantidad)} u.`;
}

function resumenProductoCarga(p) {
  if (p.unidad === 'kg') {
    return p.bultos.length ? `${p.bultos.length} ${p.bultos.length === 1 ? 'bulto' : 'bultos'}` : '';
  }
  return p.bultos.length ? `${formatearCantidad(redondearCantidad(p.bultos.reduce((acc, b) => acc + b.cantidad, 0)))} u.` : '';
}

function textoPendienteCarga(p) {
  if (!p.pendiente) return '';
  const partes = [];
  if (p.pendiente.cantidad > 0 || !p.pendiente.unidades) partes.push(`${formatearCantidad(p.pendiente.cantidad)} ${p.unidad === 'kg' ? 'kg' : 'u.'}`);
  if (p.pendiente.unidades > 0) partes.push(`${formatearCantidad(p.pendiente.unidades)} u.`);
  return `Todavía sin facturar: pidieron ${partes.join(' + ')} (${p.pendiente.clientes.join(', ')})`;
}

async function abrirListaDeCarga(alCerrar) {
  const carga = await window.freska.carga.hoy();
  const total = carga.productos.reduce((acc, p) => acc + p.bultos.length, 0);
  mostrarModal(`${MODAL_X_HTML}
    <h3>Imprimir lista de carga</h3>
    ${
      carga.productos.length === 0
        ? '<p>Todavía no hay pedidos ni facturas hoy.</p>'
        : `${total ? '' : '<p class="pin-subtitulo">Todavía no se facturó nada: solo hay pedidos pendientes.</p>'}
    <div class="carga-lista">
      ${carga.productos
        .map(
          (p) => `<div class="carga-producto">
        <div class="carga-titulo"><strong>${esc(p.nombre)}</strong>${resumenProductoCarga(p) ? `<span class="texto-suave">${esc(resumenProductoCarga(p))}</span>` : ''}</div>
        ${
          p.bultos.length
            ? `<div class="carga-bultos">${p.bultos
                .map(
                  (b) => `<span class="carga-bulto cargado" title="${esc(b.cliente)} · factura N° ${b.factura_id}">${esc(textoBultoCarga(p, b))}</span>`
                )
                .join('')}</div>`
            : ''
        }
        ${p.pendiente ? `<div class="carga-pendiente">${esc(textoPendienteCarga(p))}</div>` : ''}
      </div>`
        )
        .join('')}
    </div>`
    }
    <div class="btn-group">
      ${carga.productos.length ? '<button type="button" id="carga-imprimir">Imprimir</button>' : ''}
    </div>
  `);
  document.getElementById('modal-cerrar').addEventListener('click', () => {
    cerrarModal();
    if (alCerrar) alCerrar();
  });
  document.getElementById('carga-imprimir')?.addEventListener('click', () => {
    document.getElementById('area-impresion').innerHTML = `
      <div class="hoja-impresion-carga">
        <h1>Lista de carga — ${new Date().toLocaleDateString('es-AR')}</h1>
        ${carga.productos
          .map(
            (p) => `<div class="carga-impresion-producto">
          <p><strong>${esc(p.nombre)}</strong> ${esc(resumenProductoCarga(p))}</p>
          ${p.bultos.length ? `<p class="carga-impresion-bultos">${p.bultos.map((b) => `<span>☐ ${esc(textoBultoCarga(p, b))}</span>`).join('')}</p>` : ''}
          ${p.pendiente ? `<p class="carga-impresion-pendiente">${esc(textoPendienteCarga(p))}</p>` : ''}
        </div>`
          )
          .join('')}
      </div>`;
    imprimirConTitulo('Lista de carga');
  });
}

async function renderPedidos() {
  const [pedidosTodos, clientes, productos, cantidadesPedidasCrudo] = await Promise.all([
    window.freska.pedidos.listar(),
    window.freska.clientes.listar(),
    window.freska.productos.listar(),
    window.freska.reportes.cantidadesPedidasPorDia(),
  ]);

  // Sin pedidos pendientes, al entrar se muestran Todos (los del día elegido) si hay.
  if (!autoPedidosHecho) {
    autoPedidosHecho = true;
    if (pestanaPedidos === 'pendientes' && !pedidosTodos.some((p) => p.estado === 'pendiente' && !esPedidoProgramado(p)) && pedidosTodos.some((p) => p.estado !== 'pendiente' && p.fecha.slice(0, 10) === filtroFechaPedidos)) {
      pestanaPedidos = 'todos';
    }
  }
  const programados = pedidosTodos
    .filter(esPedidoProgramado)
    .sort((a, b) => a.para_fecha.localeCompare(b.para_fecha) || a.id - b.id);
  const pedidosMostrados =
    pestanaPedidos === 'pendientes'
      ? pedidosTodos.filter((p) => p.estado === 'pendiente' && !esPedidoProgramado(p))
      : pestanaPedidos === 'programados'
        ? programados
        : pedidosTodos.filter((p) => p.estado !== 'pendiente' && p.fecha.slice(0, 10) === filtroFechaPedidos);

  const pedidoEnEdicion = pedidoEditandoId
    ? pedidosTodos.find((p) => p.id === pedidoEditandoId)
    : null;
  if (pedidoEditandoId && !pedidoEnEdicion) pedidoEditandoId = null;

  // Fecha que muestra el formulario cuando el pedido no está programado: hoy, o el día en que se anotó si se está editando.
  const fechaBasePedido = pedidoEnEdicion ? String(pedidoEnEdicion.fecha).slice(0, 10) : fechaHoyISO();
  const cantidadesHoy = cantidadesPedidasCrudo.filter((c) => c.periodo === fechaHoyISO());
  const carga = await window.freska.carga.hoy();
  const stockRes = await window.freska.stock.resumen();
  // Una fila por producto: lo que pidieron, lo que ya se facturó (bultos y kilos) y cuántos bultos están preparados.
  const nombresHoy = [...new Set([...cantidadesHoy.map((c) => c.producto_nombre), ...carga.productos.map((p) => p.nombre)])].sort((a, b) => a.localeCompare(b));
  const filasHoy = nombresHoy.map((nombre) => {
    // Un mismo producto puede tener lo pedido en kilos y lo pedido por unidad ("2 kg + 6 u.").
    const pedidoKg = cantidadesHoy.find((c) => c.producto_nombre === nombre && c.producto_unidad === 'kg');
    const pedidoUnidades = cantidadesHoy.find((c) => c.producto_nombre === nombre && c.producto_unidad === 'unidad');
    const unidadesDeUnKg = Boolean(pedidoUnidades) && pedidoUnidades.unidad_base === 'kg'; // un producto por kilo pedido por unidad
    const prod = carga.productos.find((p) => p.nombre === nombre);
    const bultos = prod ? prod.bultos : [];
    return {
      nombre,
      pidieron: !pedidoKg && !pedidoUnidades ? '—' : [pedidoKg ? `${formatearCantidad(pedidoKg.total)} kg` : '', pedidoUnidades ? `${formatearCantidad(pedidoUnidades.total)} u.` : ''].filter(Boolean).join(' + '),
      facturado: prod && bultos.length ? resumenProductoCarga(prod) : '—',
      producto: prod,
      bultos,
      hay: (stockRes.productos.find((p) => p.nombre === nombre) || {}).hay ?? null,
      // Para marcar si falta stock: en kilos (lo pedido por unidad cuenta por su peso aproximado, si lo tiene).
      pidieronNumero: (pedidoKg ? pedidoKg.total : 0) + (pedidoUnidades ? (unidadesDeUnKg ? pedidoUnidades.total * (pedidoUnidades.peso_unidad_pedido || 0) : pedidoUnidades.total) : 0),
      unidadHay: (stockRes.productos.find((p) => p.nombre === nombre) || {}).unidad === 'kg' ? 'kg' : 'u.',
    };
  });
  const panelPedidoVisible = mostrarFormPedido || Boolean(pedidoEnEdicion);

  app.innerHTML = `
    <div class="pedidos-hoy">
      <div class="cierre-titulo-fila" style="margin-top:0">
        <h2 id="titulo-pedidos-hoy" class="titulo-colapsable" tabindex="0">Pedidos de hoy <span class="icono-colapsar ${mostrarPedidosHoy ? 'abierto' : ''}">▾</span></h2>
        <button id="btn-consulta-whatsapp" class="btn-icono-imprimir" type="button" aria-label="Enviar consulta por WhatsApp" title="Enviar consulta por WhatsApp">${ICONO_WHATSAPP}</button>
        <div class="pedidos-hoy-acciones">
          ${filasHoy.length && mostrarPedidosHoy ? '<button type="button" id="btn-resumen-pedido-hoy" class="btn-icono-imprimir" aria-label="Imprimir lista de carga" title="Imprimir lista de carga">🖨️</button>' : ''}
        </div>
      </div>
      ${
        !mostrarPedidosHoy
          ? ''
          : filasHoy.length === 0
          ? '<p class="pin-subtitulo">Todavía no hay pedidos hoy.</p>'
          : `<table class="tabla-pedidos-hoy">
        <thead><tr><th>Producto</th><th>Pidieron</th><th>Hay</th><th>Bolsas y cajas</th><th>Bultos</th></tr></thead>
        <tbody>
          ${filasHoy
            .map(
              (f) => `<tr>
            <td>${esc(f.nombre)}</td>
            <td>${esc(f.pidieron)}</td>
            <td>${f.hay === null ? '<span class="texto-suave">—</span>' : `<span class="${f.pidieronNumero > f.hay ? 'stock-falta' : ''}">${formatearCantidad(f.hay)} ${f.unidadHay}</span>`}</td>
            <td>${
              f.bultos.length
                ? `<div class="carga-bultos">${f.bultos
                    .map((b) => `<span class="carga-bulto cargado" title="${esc(b.cliente)} · factura N° ${b.factura_id}">${esc(textoBultoCarga(f.producto, b))}</span>`)
                    .join('')}</div>`
                : '—'
            }</td>
            <td>${f.bultos.length ? `${f.bultos.length} ${f.bultos.length === 1 ? 'bulto' : 'bultos'}` : '—'}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>`
      }
    </div>
    <h2 id="titulo-form-pedido" class="${pedidoEnEdicion ? '' : 'titulo-colapsable'}">
      ${pedidoEnEdicion ? `Editar pedido de ${esc(pedidoEnEdicion.cliente_nombre)}` : 'Nuevo pedido'}
      ${pedidoEnEdicion ? '' : `<span class="icono-colapsar ${mostrarFormPedido ? 'abierto' : ''}">▾</span>`}
    </h2>
    ${panelPedidoVisible ? formPedidoHtml(pedidoEnEdicion ? pedidoEnEdicion.cliente_nombre : camposPedido?.cliente || '', Boolean(pedidoEnEdicion), fechaBasePedido) : ''}
    <div class="toolbar toolbar-pegada">
      <div class="toolbar-grupo">
        <div class="reportes-toggle">
          <button type="button" class="toggle ${pestanaPedidos === 'pendientes' ? 'active' : ''}" data-vista="pendientes">Pendientes</button>
          <button type="button" class="toggle ${pestanaPedidos === 'programados' ? 'active' : ''}" data-vista="programados">Programados${programados.length ? ` (${programados.length})` : ''}</button>
          <button type="button" class="toggle ${pestanaPedidos === 'todos' ? 'active' : ''}" data-vista="todos">Facturados</button>
        </div>
        ${pestanaPedidos === 'todos' ? selectorFechaHtml('filtro-fecha-pedidos', filtroFechaPedidos) : ''}
      </div>
    </div>
    <table>
      <thead><tr><th>${pestanaPedidos === 'programados' ? 'Para el día' : 'Fecha'}</th><th>Cliente</th><th>Pedido</th><th></th></tr></thead>
      <tbody>
        ${
          pedidosMostrados.length === 0
            ? `<tr><td colspan="4">${pedidosTodos.length === 0 ? 'No hay pedidos.' : pestanaPedidos === 'pendientes' ? 'No hay pedidos pendientes.' : pestanaPedidos === 'programados' ? 'No hay pedidos programados.' : 'No hay pedidos facturados ese día.'}</td></tr>`
            : pedidosMostrados
                .map(
                  (p) => `
          <tr>
            <td>${p.para_fecha && p.estado === 'pendiente' ? `${formatearFechaCorta(p.para_fecha)}${pestanaPedidos === 'programados' ? `<br><span class="texto-suave" style="font-size:12px;">Anotado el ${new Date(p.fecha).toLocaleDateString('es-AR')}</span>` : ''}` : new Date(p.fecha).toLocaleDateString('es-AR')}</td>
            <td>${esc(p.cliente_nombre)}${p.creado_por_nombre && p.creado_por_rol !== 'admin' ? `<br><span class="texto-suave" style="font-size:12px;">Cargado por ${esc(p.creado_por_nombre)}</span>` : ''}</td>
            <td>${esc(p.resumen)}</td>
            <td class="acciones-factura">
              ${
                p.estado === 'pendiente'
                  ? `<button class="facturar-pedido primary" data-id="${p.id}">Facturar</button>
                     <div class="menu-fila">
                       <button class="btn-menu-fila" type="button" aria-label="Acciones">⋮</button>
                       <div class="menu-fila-lista">
                         <button class="item-menu editar-pedido" data-id="${p.id}">Editar</button>
                         <button class="item-menu eliminar-pedido" data-id="${p.id}">Eliminar</button>
                       </div>
                     </div>`
                  : ''
              }
            </td>
          </tr>`
                )
                .join('')
        }
      </tbody>
    </table>
  `;

  app.querySelectorAll('.toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      pestanaPedidos = btn.dataset.vista;
      renderPedidos();
    });
  });

  document.getElementById('titulo-pedidos-hoy').addEventListener('click', () => {
    mostrarPedidosHoy = !mostrarPedidosHoy;
    renderPedidos();
  });
  document.getElementById('btn-resumen-pedido-hoy')?.addEventListener('click', () => abrirListaDeCarga(() => renderPedidos()));
  vincularSelectorFecha('filtro-fecha-pedidos', filtroFechaPedidos, (fecha) => {
    filtroFechaPedidos = fecha;
    renderPedidos();
  });

  document.getElementById('btn-consulta-whatsapp').addEventListener('click', () => {
    abrirSeleccionConsulta(clientes.filter(clienteActivo));
  });

  if (!pedidoEnEdicion) {
    document.getElementById('titulo-form-pedido').addEventListener('click', async () => {
      mostrarFormPedido = !mostrarFormPedido;
      await renderPedidos();
      document.getElementById('titulo-form-pedido')?.focus();
    });
  }

  if (panelPedidoVisible) {
    // Lee las líneas directamente del DOM (igual que `leerLineasCompra` en proveedores.js): el id y la
    // unidad del producto elegido quedan en campos ocultos de cada fila al seleccionarlo.
    function leerLineasPedido() {
      return Array.from(document.querySelectorAll('#pedido-items-body .linea-pedido')).map((fila) => {
        const id = fila.querySelector('.pedido-item-id').value;
        return {
          producto_id: id ? Number(id) : null,
          nombre: fila.querySelector('input[id$="-buscar"]').value,
          unidad: fila.querySelector('.pedido-item-unidad').value || null,
          pedible: Boolean(fila.querySelector('.pedido-item-pedible').value),
          unidad_pedido: fila.querySelector('.pedido-unidad-select')?.value === 'unidad' ? 'unidad' : null,
          cantidad: parseFloat(fila.querySelector('.pedido-item-cantidad').value) || '',
        };
      });
    }

    const contenedorItemsPedido = document.getElementById('pedido-items-body');

    function enlazarLineasPedido() {
      contenedorItemsPedido.querySelectorAll('.linea-pedido').forEach((fila) => {
        const idx = fila.dataset.idx;
        const idHidden = fila.querySelector('.pedido-item-id');
        const unidadHidden = fila.querySelector('.pedido-item-unidad');
        const cantidadInput = fila.querySelector('.pedido-item-cantidad');
        vincularFlechasCantidad(cantidadInput);
        const unidadLabel = fila.querySelector('.unidad-label');
        const selectUnidad = fila.querySelector('.pedido-unidad-select');
        const actualizarPlaceholder = () => {
          const enUnidades = fila.querySelector('.pedido-unidad-select')?.value === 'unidad';
          cantidadInput.placeholder = fila.querySelector('.pedido-item-unidad').value === 'kg' && !enUnidades ? 'Peso' : 'Cantidad';
        };
        selectUnidad?.addEventListener('change', () => {
          actualizarPlaceholder();
          borradorPedido.items = leerLineasPedido().filter((l) => l.producto_id && l.cantidad > 0);
          cantidadInput.focus();
        });
        vincularProductoAutocomplete(`pedido-producto-${idx}`, productos, {
          onSeleccionar: (producto) => {
            idHidden.value = producto.id;
            unidadHidden.value = producto.unidad;
            // Un producto que cambia el tipo de unidad (con o sin desplegable) obliga a redibujar la fila.
            const lineas = leerLineasPedido();
            lineas[Number(idx)] = {
              ...lineas[Number(idx)],
              producto_id: producto.id,
              nombre: producto.nombre,
              unidad: producto.unidad,
              pedible: producto.unidad === 'kg' && Boolean(producto.pedible_por_unidad),
              // De entrada, "u." (así lo piden casi siempre) o lo último que se pidió de ese producto.
              unidad_pedido: producto.unidad === 'kg' && producto.pedible_por_unidad && producto.ultima_unidad_pedido !== 'kg' ? 'unidad' : null,
            };
            redibujarLineasPedido(lineas);
            contenedorItemsPedido.querySelector(`.linea-pedido[data-idx="${idx}"] .pedido-item-cantidad`)?.focus();
          },
        });
        cantidadInput.addEventListener('input', () => {
          borradorPedido.items = leerLineasPedido().filter((l) => l.producto_id && l.cantidad > 0);
        });
        cantidadInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            document.querySelector('.agregar-linea-pedido').click();
          }
        });
        fila.querySelector('.quitar-item-pedido')?.addEventListener('click', () => {
          const lineas = leerLineasPedido();
          lineas.splice(Number(idx), 1);
          redibujarLineasPedido(lineas);
        });
        fila.querySelector('.agregar-linea-pedido')?.addEventListener('click', agregarLineaPedido);
      });
    }

    function agregarLineaPedido() {
      const lineas = leerLineasPedido();
      lineas.push({ producto_id: null, nombre: '', unidad: null, cantidad: '' });
      redibujarLineasPedido(lineas);
      contenedorItemsPedido.querySelector('.linea-pedido:last-child input[id$="-buscar"]').focus();
    }

    function redibujarLineasPedido(lineas) {
      borradorPedido.items = lineas.filter((l) => l.producto_id && l.cantidad > 0);
      contenedorItemsPedido.innerHTML = lineas.map((item, idx) => lineaPedidoHtml(item, idx, lineas.length)).join('');
      enlazarLineasPedido();
    }

    const clientesElegiblesPedido = clientes.filter(
      (c) => clienteActivo(c) || c.id === pedidoEnEdicion?.cliente_id
    );
    const clienteAutocompletePedido = vincularClienteAutocomplete('pedido-cliente', clientesElegiblesPedido);
    document.getElementById('pedido-para-fecha').setAttribute('aria-label', 'Fecha del pedido');
    // La fecha: solo un día futuro programa el pedido; hoy o un día pasado vuelve a la fecha de siempre.
    vincularSelectorFecha('pedido-para-fecha', paraFechaPedido || fechaBasePedido, (nueva) => {
      paraFechaPedido = nueva && nueva > fechaHoyISO() ? nueva : '';
      document.getElementById('pedido-para-fecha').value = formatearFechaCorta(paraFechaPedido || fechaBasePedido);
    });
    // Siempre queda al menos una fila para cargar (como en Compras): si el pedido arranca vacío, se
    // agrega una en blanco.
    redibujarLineasPedido(borradorPedido.items.length ? borradorPedido.items : [{ producto_id: null, nombre: '', unidad: null, cantidad: '' }]);
    if (pedidoEnEdicion || camposPedido?.cliente) {
      contenedorItemsPedido.querySelector('.linea-pedido input[id$="-buscar"]')?.focus();
    } else {
      clienteAutocompletePedido.focus();
    }


    document.getElementById('btn-guardar-pedido').addEventListener('click', async () => {
      const error = document.getElementById('error-pedido');
      const items = leerLineasPedido()
        .filter((i) => i.producto_id && i.cantidad > 0)
        .map((i) => ({ producto_id: i.producto_id, cantidad: i.cantidad, unidad_pedido: i.unidad_pedido }));
      if (items.length === 0) {
        error.textContent = 'Agregá al menos un producto.';
        error.style.display = '';
        return;
      }

      if (pedidoEnEdicion) {
        await window.freska.pedidos.actualizar({ id: pedidoEnEdicion.id, items, para_fecha: paraFechaPedido });
        pedidoEditandoId = null;
        paraFechaPedido = '';
        borradorPedido = { items: [] };
        camposPedido = null;
        mostrarToast('Pedido actualizado.', 'ok');
        renderPedidos();
        return;
      }

      const cliente = clienteAutocompletePedido.obtenerSeleccionado();
      if (!cliente) {
        error.textContent = 'Elegí un cliente.';
        error.style.display = '';
        return;
      }
      const programadoPara = paraFechaPedido;
      await window.freska.pedidos.crear({ cliente_id: cliente.id, items, para_fecha: programadoPara });
      borradorPedido = { items: [] };
      camposPedido = null;
      paraFechaPedido = '';
      mostrarToast(programadoPara && programadoPara > fechaHoyISO() ? `Pedido programado para el ${formatearFechaCorta(programadoPara)}.` : 'Pedido guardado.', 'ok');
      renderPedidos();
    });

    const btnLimpiarPedido = document.getElementById('btn-limpiar-pedido');
    if (btnLimpiarPedido) {
      btnLimpiarPedido.addEventListener('click', () => {
        const limpiar = () => {
          borradorPedido = { items: [] };
          camposPedido = null;
          paraFechaPedido = '';
          renderPedidos();
        };

        const algoCargado = leerLineasPedido().some((i) => i.producto_id || i.cantidad) || Boolean(document.getElementById('pedido-cliente-buscar')?.value.trim()) || Boolean(paraFechaPedido);
        if (!algoCargado) {
          limpiar();
          return;
        }

        mostrarModal(`${modalXHtml('modal-cancelar')}
          <h3>Limpiar pedido</h3>
          <p>¿Seguro que querés descartar este pedido? Vas a perder los productos que ya cargaste.</p>
          <div class="btn-group">
            <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, limpiar</button>
          </div>
        `);
        document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
        document.getElementById('modal-confirmar').addEventListener('click', () => {
          cerrarModal();
          limpiar();
        });
      });
    }

    const btnCancelarEdicionPedido = document.getElementById('btn-cancelar-edicion-pedido');
    if (btnCancelarEdicionPedido) {
      btnCancelarEdicionPedido.addEventListener('click', () => {
        pedidoEditandoId = null;
        paraFechaPedido = '';
        borradorPedido = { items: [] };
        camposPedido = null;
        renderPedidos();
      });
    }
  }

  app.querySelectorAll('.facturar-pedido').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pedido = pedidosTodos.find((p) => p.id === Number(btn.dataset.id));
      if (!pedido) return;
      facturarPedido(pedido);
    });
  });

  vincularMenuFila();

  app.querySelectorAll('.editar-pedido').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const items = await window.freska.pedidos.items(id);
      borradorPedido.items = items.map((i) => {
        const producto = productos.find((p) => p.id === i.producto_id) || {};
        return {
          producto_id: i.producto_id,
          nombre: i.producto_nombre,
          unidad: i.producto_unidad,
          pedible: i.producto_unidad === 'kg' && Boolean(producto.pedible_por_unidad),
          unidad_pedido: i.unidad_pedido === 'unidad' ? 'unidad' : null,
          cantidad: i.cantidad,
        };
      });
      pedidoEditandoId = id;
      paraFechaPedido = (pedidosTodos.find((p) => p.id === id) || {}).para_fecha || '';
      renderPedidos();
    });
  });

  app.querySelectorAll('.eliminar-pedido').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Eliminar pedido</h3>
        <p>¿Seguro que querés eliminar este pedido? Esta acción no se puede deshacer.</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, eliminar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        await window.freska.pedidos.eliminar(id);
        cerrarModal();
        mostrarToast('Pedido eliminado.', 'ok');
        renderPedidos();
      });
    });
  });
}
