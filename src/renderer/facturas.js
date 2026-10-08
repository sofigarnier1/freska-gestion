// Facturas: nueva factura, lista, detalle, cobro y anulación.
// (Antes todo estaba en renderer.js; se dividió por pantalla el 2026-09-24. Los archivos son scripts comunes que
// comparten el mismo espacio global: se cargan en el orden de index.html y no hace falta importar nada.)

// Una fila por producto, en cuatro columnas: cantidad · descripción · precio unitario · importe.
// Cantidad y precio unitario van alineados a la izquierda (cada uno empieza siempre en el mismo
// lugar, así la descripción queda cerca de la cantidad) y el importe, a la derecha para sumarlo.
// Encabezado de las columnas del detalle de una factura (en pantalla y en el ticket impreso).
const ENCABEZADO_LINEAS_FACTURA_HTML = `<thead><tr>
  <th class="col-cantidad">Cant.</th><th class="col-descripcion">Producto</th><th class="col-precio">Precio unit.</th><th class="col-importe">Subtotal</th>
</tr></thead>`;

// Lo que pidieron por unidad, entre paréntesis detrás del producto ("Chorizos secos (5 u.)"), en la factura y el WhatsApp.
function sufijoPedidoUnidades(i) {
  return i.pedido_unidades > 0 ? ` (${formatearCantidad(i.pedido_unidades)} u.)` : '';
}

function filasLineasFacturaHtml(items) {
  return items
    .map((i) => {
      const unidad = i.producto_unidad === 'kg' ? 'kg' : 'u.';
      return `<tr>
          <td class="col-cantidad">${formatearCantidad(i.cantidad)} ${unidad}</td>
          <td class="col-descripcion">${esc(i.producto_nombre)}${esc(sufijoPedidoUnidades(i))}</td>
          <td class="col-precio">$${formatearMoneda(i.precio_unitario)}/${unidad}</td>
          <td class="col-importe">$${formatearMoneda(i.subtotal)}</td>
        </tr>`;
    })
    .join('');
}

// La fila desplegada de una factura arranca (con sangría) justo debajo de una columna de la fila de
// arriba, para que se lea como su detalle: en Facturas, bajo el cliente; en la ficha del cliente,
// bajo "Tipo". Se recalcula al abrirla y cuando cambia el tamaño de la ventana.
function alinearDetalleFactura(filaItems) {
  const fila = filaItems.previousElementSibling;
  if (!fila || filaItems.style.display === 'none') return;
  const indice = filaItems.classList.contains('items-factura-tab-fila') ? 1 : 1;
  const celda = fila.children[indice];
  if (!celda) return;
  filaItems.querySelector('td').style.paddingLeft =
    `${celda.offsetLeft + parseFloat(getComputedStyle(celda).paddingLeft)}px`;
}

// Con qué se pagó una factura (debajo de su detalle): un renglón por método, con "Cambiar" para corregirlo.
function pagosDeFacturaHtml(pagos, anulada = false) {
  if (!pagos.length) return '';
  const porMetodo = new Map();
  pagos.forEach((p) => porMetodo.set(p.metodo_pago, [...(porMetodo.get(p.metodo_pago) || []), p]));
  const filas = [...porMetodo.entries()].map(([metodo, lista], i) => {
    const monto = redondearPesos(lista.reduce((acc, p) => acc + p.monto, 0));
    const cambiables = anulada ? [] : lista.filter((p) => puedeCambiarseElMetodo({ monto: p.monto, metodo }));
    const ids = cambiables.map((p) => p.id).join(',');
    return `<div class="pago-factura-fila">
      <span class="pago-factura"><span class="pago-etiqueta ${i > 0 ? 'oculta' : ''}">Pagó con:</span> ${esc(metodo)} $${formatearMoneda(monto)}</span>
      ${
        cambiables.length
          ? `<span class="acciones-pago"><button type="button" class="enlace-boton cambiar-metodo-factura" data-ids="${ids}" data-metodo="${esc(metodo)}" title="Corregir con qué se pagó">Cambiar método</button><span class="texto-suave">·</span><button type="button" class="enlace-boton enlace-peligro anular-cobro-factura" data-ids="${ids}" data-metodo="${esc(metodo)}" data-monto="${monto}" title="Anular este cobro">Anular cobro</button></span>`
          : ''
      }
    </div>`;
  });
  return `<div class="pagos-de-factura">${filas.join('')}</div>`;
}

// Líneas de una factura desplegada (Facturas y ficha del cliente): lo mismo que sale en el ticket (la tabla
// de líneas y, abajo, el total). Si se cobró algo pero no todo, se agrega lo pagado y lo que falta.
// `factura` = { total, pagado?, saldoCliente?, motivo_anulacion? }: abajo a la izquierda va el saldo total del
// cliente (como en el ticket) y, si esta factura tiene un pago parcial, cuánto se pagó y cuánto falta.
function itemsFacturaListaHtml(items, factura = {}) {
  const {
    total,
    pagado,
    saldoCliente,
    estado,
    motivo_anulacion: motivoAnulacion,
    creado_por_nombre: creadoPorNombre,
    creado_por_rol: creadoPorRol,
    anulado_por_nombre: anuladoPorNombre,
    anulado_por_rol: anuladoPorRol,
  } = factura;
  const restante = redondearPesos((total || 0) - (pagado || 0));
  return `
    <table class="factura-impresion-tabla items-factura-tabla">
      ${ENCABEZADO_LINEAS_FACTURA_HTML}
      <tbody>${filasLineasFacturaHtml(items)}</tbody>
    </table>
    ${
      total === undefined
        ? ''
        : `<p class="factura-impresion-total-saldo items-factura-total">
      <span class="factura-impresion-saldo">${saldoCliente > 0 ? `Saldo total: $${formatearMoneda(saldoCliente)}` : ''}${
        pagado > 0 && restante > 0 ? `<span class="factura-parcial">Pagado $${formatearMoneda(pagado)} · Falta $${formatearMoneda(restante)}</span>` : ''
      }</span>
      <span class="factura-impresion-total">Total: $${formatearMoneda(total)}</span>
    </p>`
    }
    ${creadoPorNombre && creadoPorRol !== 'admin' ? `<p class="pin-subtitulo" style="margin-top:8px;">Cargado por: ${esc(creadoPorNombre)}</p>` : ''}
    ${motivoAnulacion ? `<p class="texto-anulacion" style="margin-top:8px;">Motivo de anulación: ${esc(motivoAnulacion)}</p>` : ''}
    ${estado === 'anulada' && anuladoPorNombre && anuladoPorRol !== 'admin' ? `<p class="texto-anulacion" style="margin-top:4px;">Anulado por: ${esc(anuladoPorNombre)}</p>` : ''}`;
}

// El diálogo de impresión usa document.title como nombre sugerido del PDF.
// `fechaISO` (AAAA-MM-DD) es opcional: sin ella se usa la fecha de hoy.
function imprimirConTitulo(prefijo, fechaISO) {
  const tituloOriginal = document.title;
  const hoy = new Date();
  const fecha = fechaISO
    ? fechaISO.split('-').reverse().join('-')
    : [hoy.getDate(), hoy.getMonth() + 1, hoy.getFullYear()]
        .map((n) => String(n).padStart(2, '0'))
        .join('-');
  document.title = `${prefijo} ${fecha}`;
  window.addEventListener('afterprint', () => { document.title = tituloOriginal; }, { once: true });
  window.print();
}

// Ticket impreso (y su vista previa): cliente y N° · fecha arriba; una fila por producto con
// cantidad, descripción, precio unitario e importe (los dos precios alineados a la derecha);
// abajo, el saldo total del cliente a la izquierda (vacío si no debe nada) y el total a la derecha.
function facturaImpresionCardHtml(factura, items, cliente) {
  return `
    <div class="factura-impresion-card">
      <p class="factura-impresion-titulo">
        <span>${esc(factura.cliente_nombre)}</span>
        <span class="factura-impresion-fecha">N° ${factura.id} · ${new Date(factura.fecha).toLocaleDateString('es-AR')}</span>
      </p>
      <table class="factura-impresion-tabla">
        ${ENCABEZADO_LINEAS_FACTURA_HTML}
        <tbody>${filasLineasFacturaHtml(items)}</tbody>
      </table>
      <p class="factura-impresion-total-saldo">
        <span class="factura-impresion-saldo">${cliente && cliente.saldo > 0 ? `Saldo total: $${formatearMoneda(cliente.saldo)}` : ''}</span>
        <span class="factura-impresion-total">Total: $${formatearMoneda(factura.total)}</span>
      </p>
    </div>`;
}

let borradorFactura = { items: [] };
// Lo que se está escribiendo en los formularios de Nueva factura / Nuevo pedido (cliente, tipo de
// precio, producto y cantidad todavía sin agregar). Vive mientras la app está abierta, para que al
// volver de otra pantalla siga todo como estaba. Se descarta al guardar, limpiar o cancelar.
let camposFactura = null;
let camposPedido = null;
let facturaEditandoId = null;
let errorEdicionFactura = null;
let mostrarFormFactura = true;
let filtroFechaFacturasTab = fechaHoyISO();
let busquedaFacturasTab = '';
let mostrarFacturasTab = 'todas'; // 'todas' | 'anuladas'
// "Ver: Anuladas" no tiene filtro de fecha (a propósito: es para revisar todas, sin importar cuándo), así que
// con los años podía quedar como una lista sin fin (2026-09-28, mismo problema que ya se había
// acotado en Vendedores). Igual criterio que el historial de un cliente: de a 30, con "Ver más antiguas".
const FACTURAS_ANULADAS_POR_PAGINA = 30;
let limiteFacturasAnuladas = FACTURAS_ANULADAS_POR_PAGINA;

// Toma lo que hay escrito en los formularios de nueva factura / nuevo pedido (si están en pantalla y
// no se está editando algo existente). Se llama al escribir, al salir de un campo y al cambiar de pestaña.
function capturarCamposBorrador() {
  const valor = (id) => document.getElementById(id)?.value ?? '';
  if (document.getElementById('factura-cliente-buscar') && !facturaEditandoId && !pedidoParaFacturar) {
    camposFactura = {
      cliente: valor('factura-cliente-buscar'),
      tipoPrecio: document.querySelector('input[name="tipo-precio"]:checked')?.value || 'cliente',
    };
  }
  if (document.getElementById('gasto-descripcion')) {
    // Se guarda donde corresponde según lo que muestra el formulario (no según el estado): un "focusout"
    // tardío, justo después de guardar o cancelar, todavía lee el formulario viejo.
    const editandoEnPantalla = Boolean(document.querySelector('.gasto-form[data-editando]'));
    const camposActuales = editandoEnPantalla ? camposGastoEdicion : camposGasto;
    const camposLeidos = {
      fecha: fechaCortaAIso(valor('gasto-fecha')) || camposActuales?.fecha || '',
      categoria: valor('gasto-categoria'),
      descripcion: valor('gasto-descripcion'),
      monto: valor('gasto-monto'),
      medio: valor('gasto-medio'),
      cuenta: valor('gasto-pago-con'),
      tarjeta: valor('gasto-tarjeta'),
      cuotas: valor('gasto-cuotas'),
      cheque: valor('gasto-cheque-id'),
      observacion: valor('gasto-observacion'),
    };
    if (editandoEnPantalla) camposGastoEdicion = camposLeidos;
    else camposGasto = camposLeidos;
  }
  if (document.getElementById('pedido-cliente-buscar') && !pedidoEditandoId) {
    camposPedido = { cliente: valor('pedido-cliente-buscar') };
  }
}

// Un peso con al menos dos decimales, como se lee en la balanza: 2,10 · 2,15 · 2,155.
function formatearPeso(n) {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 3, useGrouping: false });
}

// Qué precio se le pone a un cliente al facturar: si tiene cargada su condición frente al IVA, el consumidor
// final paga el precio CF y monotributistas / responsables inscriptos el precio Cliente; si no la tiene
// cargada, el que más veces se le facturó (por defecto, Cliente). Siempre se puede cambiar a mano.
function tipoPrecioMasUsado(facturas, clienteId, clientes) {
  const cliente = clientes && clientes.find((c) => c.id === clienteId);
  if (cliente && cliente.condicion_iva) return cliente.condicion_iva === 'Consumidor final' ? 'cf' : 'cliente';
  const conteo = { cliente: 0, cf: 0 };
  facturas.forEach((f) => {
    if (f.cliente_id === clienteId && f.estado !== 'anulada') {
      conteo[f.tipo_precio] = (conteo[f.tipo_precio] || 0) + 1;
    }
  });
  return conteo.cf > conteo.cliente ? 'cf' : 'cliente';
}

let pedidoParaFacturar = null;

function esFechaHoy(fechaStr) {
  const hoy = new Date();
  const fecha = new Date(fechaStr);
  return (
    fecha.getFullYear() === hoy.getFullYear() &&
    fecha.getMonth() === hoy.getMonth() &&
    fecha.getDate() === hoy.getDate()
  );
}

// Elegir un pedido pendiente para facturarlo desde la pantalla de Facturas: carga el cliente y sus productos
// (lo mismo que el botón "Facturar" de Pedidos).
function abrirElegirPedidoPendiente(pedidos) {
  const elegir = (pedido) => {
    if (borradorFactura.items.length === 0 && !pedidoParaFacturar) return facturarPedido(pedido);
    mostrarModal(`${modalXHtml('modal-cancelar')}
      <h3>Facturar el pedido de ${esc(pedido.cliente_nombre)}</h3>
      <p>Ya hay una factura empezada: se reemplaza por este pedido.</p>
      <div class="btn-group">
        <button type="button" id="modal-confirmar" class="primary">Reemplazar</button>
      </div>
    `);
    document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('modal-confirmar').addEventListener('click', () => {
      cerrarModal();
      facturarPedido(pedido);
    });
  };
  mostrarModal(`${MODAL_X_HTML}
    <h3>Pedidos pendientes</h3>
    <div class="pedidos-pendientes-lista">
      ${pedidos
        .map(
          (p) => `<div class="pedido-pendiente-fila">
        <div class="pedido-pendiente-datos">
          <strong>${esc(p.cliente_nombre)}</strong> <span class="texto-suave">${new Date(p.fecha).toLocaleDateString('es-AR')}</span>
          <div class="texto-suave">${String(p.resumen || '').split(/,\s*(?=\d)/).map((l) => `<div>${esc(l)}</div>`).join('')}</div>
        </div>
        <button type="button" class="primary elegir-pedido-pendiente" data-id="${p.id}">Facturar</button>
      </div>`
        )
        .join('')}
    </div>
  `);
  document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
  document.querySelectorAll('.elegir-pedido-pendiente').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pedido = pedidos.find((p) => p.id === Number(btn.dataset.id));
      cerrarModal();
      if (pedido) elegir(pedido);
    });
  });
}

async function renderFacturas() {
  const [clientes, productos, facturas, pedidosTodos] = await Promise.all([
    window.freska.clientes.listar(),
    window.freska.productos.listar(),
    window.freska.facturas.listar(),
    window.freska.pedidos.listar(),
  ]);
  // Los programados para un día futuro no se facturan todavía: quedan en Pedidos → Programados hasta su día.
  const pedidosPendientes = pedidosTodos.filter((p) => p.estado === 'pendiente' && !esPedidoProgramado(p));

  const facturasHoy = facturas.filter((f) => esFechaHoy(f.fecha));
  const busquedaFacturas = busquedaFacturasTab.trim();
  let facturasMostradas;
  if (busquedaFacturas) {
    const queryNormalizado = normalizarTexto(busquedaFacturas);
    // Lo que más se parece va primero (el N° exacto, después los que empiezan igual...); a igual
    // parecido queda el orden de siempre, el más nuevo arriba.
    facturasMostradas = facturas
      .map((f) => {
        const porNumero = puntajeCoincidencia(String(f.id), busquedaFacturas);
        const porCliente = puntajeCoincidencia(normalizarTexto(f.cliente_nombre), queryNormalizado);
        return { f, puntaje: Math.min(porNumero ?? 9, porCliente ?? 9) };
      })
      .filter((x) => x.puntaje < 9)
      .sort((a, b) => a.puntaje - b.puntaje)
      .map((x) => x.f);
  } else if (mostrarFacturasTab === 'anuladas') {
    // Sin importar la fecha: es para revisar todas las anulaciones (por ejemplo, desde el aviso de
    // "anulaciones de empleados para revisar"), no solo las de un día puntual.
    facturasMostradas = facturas.filter((f) => f.estado === 'anulada').sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  } else {
    facturasMostradas = facturas.filter((f) => f.fecha.slice(0, 10) === filtroFechaFacturasTab);
  }
  const esHoy = filtroFechaFacturasTab === fechaHoyISO();

  const facturaEnEdicion = facturaEditandoId
    ? facturas.find((f) => f.id === facturaEditandoId)
    : null;
  if (facturaEditandoId && !facturaEnEdicion) facturaEditandoId = null;
  const clienteSeleccionadoId = facturaEnEdicion ? facturaEnEdicion.cliente_id : '';
  const camposGuardados = !facturaEnEdicion && !pedidoParaFacturar ? camposFactura : null;
  const tipoPrecioInicial = facturaEnEdicion
    ? facturaEnEdicion.tipo_precio
    : pedidoParaFacturar
      ? tipoPrecioMasUsado(facturas, pedidoParaFacturar.clienteId, clientes)
      : camposGuardados?.tipoPrecio || 'cliente';
  const forzarPanelFactura = Boolean(facturaEnEdicion) || Boolean(pedidoParaFacturar);
  const panelFacturaVisible = mostrarFormFactura || forzarPanelFactura;

  app.innerHTML = `
    ${volverHtml('facturas')}
    <div class="cierre-titulo-fila">
    <h2 id="titulo-form-factura" class="${forzarPanelFactura ? '' : 'titulo-colapsable'}">
      ${facturaEnEdicion ? `Editar factura #${facturaEnEdicion.id}` : 'Nueva factura'}
      ${forzarPanelFactura ? '' : `<span class="icono-colapsar ${mostrarFormFactura ? 'abierto' : ''}">▾</span>`}
    </h2>
    ${!facturaEnEdicion && pedidosPendientes.length ? `<button type="button" id="btn-elegir-pedido-pendiente">📦 Pedidos pendientes (${pedidosPendientes.length})</button>` : ''}
    </div>
    ${
      panelFacturaVisible
        ? `
    <div class="panel">
      ${errorEdicionFactura ? `<p class="error-msg">${esc(errorEdicionFactura)}</p>` : ''}
      <div class="factura-header">
        ${clienteAutocompleteHtml(
          'factura-cliente',
          facturaEnEdicion
            ? facturaEnEdicion.cliente_nombre
            : pedidoParaFacturar
              ? pedidoParaFacturar.clienteNombre
              : camposGuardados?.cliente || '',
          Boolean(facturaEnEdicion)
        )}
        <label><input type="radio" name="tipo-precio" value="cliente" ${tipoPrecioInicial === 'cliente' ? 'checked' : ''} /> Precio Cliente</label>
        <label><input type="radio" name="tipo-precio" value="cf" ${tipoPrecioInicial === 'cf' ? 'checked' : ''} /> Precio Consumidor Final</label>
      </div>

      <table class="tabla-compra tabla-pedido tabla-factura tabla-sin-cajas">
        <tbody id="lineas-body"></tbody>
        <tfoot><tr class="fila-total-factura"><td colspan="3" class="total-etiqueta"><span class="factura-total-panel">Total:</span></td><td><span class="factura-total-panel">$<span id="factura-total">0.00</span></span></td></tr></tfoot>
      </table>
      <div class="btn-group">
        <button id="btn-guardar-factura" class="primary">${facturaEnEdicion ? 'Guardar cambios' : 'Guardar factura'}</button>
        ${facturaEnEdicion ? '<button id="btn-cancelar-edicion" type="button">Cancelar edición</button>' : '<button id="btn-limpiar-factura" class="btn-limpiar" type="button">Limpiar factura</button>'}
      </div>
    </div>`
        : ''
    }

    <h2>${busquedaFacturas ? 'Resultado de la búsqueda' : mostrarFacturasTab === 'anuladas' ? 'Facturas anuladas' : esHoy ? 'Facturas de hoy' : 'Facturas'}</h2>
    <div class="toolbar">
      ${selectorFechaHtml('filtro-fecha-facturas-tab', filtroFechaFacturasTab, Boolean(busquedaFacturas) || mostrarFacturasTab === 'anuladas')}
      <div class="btn-group">
        ${
          !busquedaFacturas && esHoy && mostrarFacturasTab === 'todas'
            ? `<div class="menu-fila">
                 <button class="btn-menu-fila" type="button" aria-label="Imprimir">🖨️</button>
                 <div class="menu-fila-lista">
                   <button class="item-menu" id="btn-imprimir-facturas-hoy" type="button">Imprimir facturas de hoy</button>
                   <button class="item-menu" id="btn-imprimir-reparto" type="button">Imprimir hoja de reparto</button>
                 </div>
               </div>`
            : ''
        }
        ${filtrosListaHtml('filtros-facturas', [
          { nombre: 'ver', titulo: 'Ver', opciones: [['todas', 'Todas'], ['anuladas', 'Anuladas']], actual: mostrarFacturasTab, porDefecto: 'todas' },
        ])}
        <input type="text" id="buscar-factura-tab" class="buscador" placeholder="Buscar cliente" value="${esc(busquedaFacturas)}" />
      </div>
    </div>
    ${
      busquedaFacturas
        ? '<p class="pin-subtitulo" style="margin-bottom:16px;">Mostrando el resultado de la búsqueda, sin importar la fecha.</p>'
        : mostrarFacturasTab === 'anuladas'
          ? '<p class="pin-subtitulo" style="margin-bottom:16px;">Mostrando todas las facturas anuladas, sin importar la fecha.</p>'
          : ''
    }
    <table>
      <thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Pagado</th><th>Saldo</th><th></th></tr></thead>
      <tbody>
        ${
          facturasMostradas.length === 0
            ? '<tr><td colspan="7">No hay facturas para mostrar.</td></tr>'
            : (mostrarFacturasTab === 'anuladas' && !busquedaFacturas ? facturasMostradas.slice(0, limiteFacturasAnuladas) : facturasMostradas)
          .map((f) => {
            const restante = f.total - f.pagado;
            const anulada = f.estado === 'anulada';
            const editable = !anulada && esFechaHoy(f.fecha);
            const puedeAnular = !anulada;
            const puedeReactivar = anulada && Boolean(f.anulado_estado_previo);
            return `
          <tr class="fila-clickeable fila-factura-tab${anulada ? ' fila-anulada' : ''}" tabindex="0" data-id="${f.id}" data-total="${f.total}" data-pagado="${f.pagado}" data-nombre="${esc(f.cliente_nombre)}">
            <td><span class="icono-fila">▾</span>${f.id}</td>
            <td>${new Date(f.fecha).toLocaleDateString('es-AR')}</td>
            <td>${esc(f.cliente_nombre)}</td>
            <td>$${formatearMoneda(f.total)}</td>
            <td>$${formatearMoneda(f.pagado)}</td>
            <td class="celda-saldo ${anulada ? 'saldo-anulada' : restante > 0.005 ? 'saldo-deuda' : 'saldo-cero'}">${anulada ? 'Anulada' : `$${formatearMoneda(restante)}`}</td>
            <td class="acciones-factura">
              ${!anulada && f.estado !== 'pagada' ? `<button class="btn-pago-fila registrar-pago" data-id="${f.id}" title="Registrar pago" aria-label="Registrar pago">$</button>` : ''}
              ${!anulada ? `<button class="btn-whatsapp-fila enviar-whatsapp" data-id="${f.id}" title="Enviar por WhatsApp" aria-label="Enviar por WhatsApp">${ICONO_WHATSAPP}</button>` : ''}
              ${
                editable || puedeAnular || puedeReactivar
                  ? `<div class="menu-fila">
                <button class="btn-menu-fila" type="button" aria-label="Acciones">⋮</button>
                <div class="menu-fila-lista">
                  ${editable ? `<button class="item-menu editar-factura" data-id="${f.id}">Editar</button>` : ''}
                  ${puedeAnular ? `<button class="item-menu anular-factura" data-id="${f.id}">Anular</button>` : ''}
                  ${puedeReactivar ? `<button class="item-menu reactivar-factura" data-id="${f.id}">Reactivar</button>` : ''}
                </div>
              </div>`
                  : ''
              }
            </td>
          </tr>
          <tr class="items-factura-tab-fila" data-items-de="${f.id}" style="display:none">
            <td colspan="7"></td>
          </tr>`;
          })
          .join('')}
      </tbody>
    </table>
    ${
      mostrarFacturasTab === 'anuladas' && !busquedaFacturas && facturasMostradas.length > limiteFacturasAnuladas
        ? `<p style="text-align:center; margin-top:16px;"><button type="button" id="btn-ver-mas-anuladas">Ver más antiguas (${facturasMostradas.length - limiteFacturasAnuladas})</button></p>`
        : ''
    }
    ${
      !busquedaFacturas && esHoy
        ? '<p style="text-align:right; margin-top:16px;"><button type="button" id="btn-recorrido-hoy">🚚 Ver recorrido de hoy</button></p>'
        : ''
    }
  `;

  const productosPorId = Object.fromEntries(productos.map((p) => [p.id, p]));
  const clientesPorId = Object.fromEntries(clientes.map((c) => [c.id, c]));

  document.getElementById('btn-elegir-pedido-pendiente')?.addEventListener('click', () => abrirElegirPedidoPendiente(pedidosPendientes));
  vincularVolverGenerico();

  if (!forzarPanelFactura) {
    document.getElementById('titulo-form-factura').addEventListener('click', async () => {
      mostrarFormFactura = !mostrarFormFactura;
      await renderFacturas();
      document.getElementById('titulo-form-factura')?.focus();
    });
  }

  if (panelFacturaVisible) {
  function tipoPrecioSeleccionado() {
    return document.querySelector('input[name="tipo-precio"]:checked').value;
  }

  // Líneas de la factura: cada fila es editable ahí mismo (producto, cantidad y precio), igual que las de
  // Pedidos y Compras. Se leen del DOM; el id y la unidad del producto elegido quedan en campos ocultos.
  const lineaFacturaVacia = () => ({ producto_id: null, nombre: '', unidad: null, cantidad: '', precio_unitario: '' });

  function leerLineasFactura() {
    return Array.from(document.querySelectorAll('#lineas-body .linea-factura')).map((fila) => {
      const id = fila.querySelector('.factura-item-id').value;
      const cantidad = parseFloat(fila.querySelector('.factura-item-cantidad').value) || '';
      const precio = limpiarNumeroMoneda(fila.querySelector('.factura-item-precio').value);
      return {
        producto_id: id ? Number(id) : null,
        nombre: fila.querySelector('input[id$="-buscar"]').value,
        unidad: fila.querySelector('.factura-item-unidad').value || null,
        cantidad,
        precio_unitario: Number.isNaN(precio) ? '' : precio,
        // Lo que pidieron por unidad ("6 chorizos") para pesarlo acá: queda en la línea hasta que se carguen los kilos.
        pidieron_unidades: Number(fila.querySelector('.factura-item-pidieron').value) || null,
      };
    });
  }

  const lineaFacturaCompleta = (l) => l.producto_id && l.cantidad > 0 && l.precio_unitario !== '';

  function sincronizarBorradorFactura() {
    // Una línea pedida por unidad que todavía no se pesó se conserva (sin subtotal) para no perderla al redibujar.
    borradorFactura.items = leerLineasFactura()
      .filter((l) => lineaFacturaCompleta(l) || l.pidieron_unidades)
      .map((l) => ({ ...l, subtotal: lineaFacturaCompleta(l) ? Math.round(l.precio_unitario * l.cantidad * 100) / 100 : 0 }));
  }

  function actualizarTotalFactura() {
    const total = leerLineasFactura().reduce((acc, l) => acc + (lineaFacturaCompleta(l) ? Math.round(l.precio_unitario * l.cantidad * 100) / 100 : 0), 0);
    document.getElementById('factura-total').textContent = formatearMoneda(total);
    const pie = document.querySelector('.fila-total-factura');
    if (pie) pie.style.display = total > 0 ? '' : 'none';
    document.querySelector('.tabla-factura')?.classList.toggle('con-subtotal', total > 0);
  }

  function lineaFacturaHtml(item, idx, total) {
    return `
      <tr class="linea-factura" data-idx="${idx}">
        <td>
          ${productoAutocompleteHtml(`linea-producto-${idx}`, item.nombre || '')}
          <input type="hidden" class="factura-item-id" value="${item.producto_id || ''}" />
          <input type="hidden" class="factura-item-unidad" value="${esc(item.unidad || '')}" />
          <input type="hidden" class="factura-item-pidieron" value="${item.pidieron_unidades || ''}" />
          ${item.pidieron_unidades ? `<span class="tag-pedido-unidades" title="Pidieron ${esc(formatearCantidad(item.pidieron_unidades))} unidades">${esc(formatearCantidad(item.pidieron_unidades))} u.</span>` : ''}
        </td>
        <td>
          <span class="input-unidad">
            <input type="number" class="factura-item-cantidad" placeholder="${item.unidad === 'kg' ? 'Peso' : 'Cantidad'}" min="0" step="any" value="${item.cantidad || ''}" aria-label="Cantidad" />
            <span class="unidad-label" ${item.unidad ? '' : 'style="display:none"'}>${item.unidad === 'kg' ? 'kg' : item.unidad ? 'u.' : ''}</span>
          </span>
        </td>
        <td><div class="input-moneda"><span>$</span><input type="text" inputmode="decimal" class="factura-item-precio" placeholder="Precio" autocomplete="off" value="${item.precio_unitario === '' || item.precio_unitario === undefined ? '' : esc(formatearMoneda(item.precio_unitario))}" aria-label="Precio unitario" /></div></td>
        <td class="subtotal-linea"><span class="subtotal-monto"></span><span class="acciones-linea">${accionesLineaHtml('quitar-item-factura', 'agregar-linea-factura', idx, total)}</span></td>
      </tr>`;
  }

  function actualizarSubtotalFila(fila) {
    const cantidad = parseFloat(fila.querySelector('.factura-item-cantidad').value);
    const precio = limpiarNumeroMoneda(fila.querySelector('.factura-item-precio').value);
    fila.querySelector('.subtotal-monto').textContent = cantidad > 0 && precio > 0 ? `$${formatearMoneda(cantidad * precio)}` : '';
  }

  function precioDeCatalogo(producto) {
    return tipoPrecioSeleccionado() === 'cf' ? producto.precio_cf : producto.precio_cliente;
  }

  function enlazarLineasFactura() {
    document.querySelectorAll('#lineas-body .linea-factura').forEach((fila) => {
      const idx = fila.dataset.idx;
      const idHidden = fila.querySelector('.factura-item-id');
      const unidadHidden = fila.querySelector('.factura-item-unidad');
      const cantidadInput = fila.querySelector('.factura-item-cantidad');
      vincularFlechasCantidad(cantidadInput);
      const precioInput = fila.querySelector('.factura-item-precio');
      const unidadLabel = fila.querySelector('.unidad-label');
      vincularFormatoMoneda(precioInput);
      vincularProductoAutocomplete(`linea-producto-${idx}`, productos, {
        onSeleccionar: (producto) => {
          idHidden.value = producto.id;
          unidadHidden.value = producto.unidad;
          cantidadInput.placeholder = producto.unidad === 'kg' ? 'Peso' : 'Cantidad';
          unidadLabel.textContent = producto.unidad === 'kg' ? 'kg' : 'u.';
          unidadLabel.style.display = '';
          precioInput.value = formatearMoneda(precioDeCatalogo(producto));
          actualizarSubtotalFila(fila);
          actualizarTotalFactura();
          sincronizarBorradorFactura();
          cantidadInput.focus();
        },
      });
      [cantidadInput, precioInput].forEach((input) => {
        input.addEventListener('input', () => {
          actualizarSubtotalFila(fila);
          actualizarTotalFactura();
          sincronizarBorradorFactura();
        });
      });
      cantidadInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          document.querySelector('.agregar-linea-factura').click();
        }
      });
      fila.querySelector('.quitar-item-factura')?.addEventListener('click', () => {
        const lineas = leerLineasFactura();
        lineas.splice(Number(idx), 1);
        redibujarLineasFactura(lineas);
      });
      fila.querySelector('.agregar-linea-factura')?.addEventListener('click', agregarLineaFactura);
      actualizarSubtotalFila(fila);
    });
    actualizarTotalFactura();
  }

  function agregarLineaFactura() {
    const lineas = leerLineasFactura();
    lineas.push(lineaFacturaVacia());
    redibujarLineasFactura(lineas);
    document.querySelector('#lineas-body .linea-factura:last-child input[id$="-buscar"]').focus();
  }

  function redibujarLineasFactura(lineas) {
    document.getElementById('lineas-body').innerHTML = lineas.map((l, i) => lineaFacturaHtml(l, i, lineas.length)).join('');
    enlazarLineasFactura();
    sincronizarBorradorFactura();
  }

  const clientesElegiblesFactura = clientes.filter(
    (c) => clienteActivo(c) || c.id === facturaEnEdicion?.cliente_id
  );
  const clienteAutocomplete = vincularClienteAutocomplete('factura-cliente', clientesElegiblesFactura, {
    onSeleccionar: (cliente) => {
      const radio = document.querySelector(
        `input[name="tipo-precio"][value="${tipoPrecioMasUsado(facturas, cliente.id, clientes)}"]`
      );
      if (radio) {
        radio.checked = true;
        recalcularPreciosSegunTipo();
      }
    },
  });

  // Al cambiar entre Precio Cliente y Consumidor Final, las líneas con producto vuelven al precio de lista
  // de ese tipo (como siempre: un precio cambiado a mano se pisa).
  function recalcularPreciosSegunTipo() {
    document.querySelectorAll('#lineas-body .linea-factura').forEach((fila) => {
      const producto = productosPorId[fila.querySelector('.factura-item-id').value];
      if (!producto) return;
      fila.querySelector('.factura-item-precio').value = formatearMoneda(precioDeCatalogo(producto));
      actualizarSubtotalFila(fila);
    });
    actualizarTotalFactura();
    sincronizarBorradorFactura();
  }

  document.querySelectorAll('input[name="tipo-precio"]').forEach((radio) => {
    radio.addEventListener('change', recalcularPreciosSegunTipo);
  });

  // Siempre queda al menos una fila para cargar: si la factura arranca vacía, se agrega una en blanco.
  redibujarLineasFactura(borradorFactura.items.length ? borradorFactura.items : [lineaFacturaVacia()]);
  if (!facturaEnEdicion) {
    // Si ya había un cliente elegido (se volvió de otra pantalla), el cursor va directo al producto.
    if (camposGuardados?.cliente) document.querySelector('#lineas-body .linea-factura input[id$="-buscar"]')?.focus();
    else clienteAutocomplete.focus();
  }

  document.getElementById('btn-guardar-factura').addEventListener('click', async () => {
    let clienteId;
    if (facturaEnEdicion) {
      clienteId = facturaEnEdicion.cliente_id;
    } else {
      const clienteEncontrado = clienteAutocomplete.obtenerSeleccionado();
      if (!clienteEncontrado) {
        errorEdicionFactura = 'No encontramos ese cliente. Elegilo de la lista o revisá el nombre.';
        renderFacturas();
        return;
      }
      clienteId = clienteEncontrado.id;
    }
    sincronizarBorradorFactura();
    if (!clienteId || borradorFactura.items.length === 0) return;
    // Lo pedido por unidad se pesa acá: sin los kilos la línea no entraría a la factura (y el pedido se daría por facturado).
    const sinPesar = borradorFactura.items.filter((i) => i.pidieron_unidades && !(i.cantidad > 0));
    if (sinPesar.length) {
      errorEdicionFactura = `Falta pesar: ${sinPesar.map((i) => `${i.nombre} (pidieron ${formatearCantidad(i.pidieron_unidades)} u.)`).join(', ')}.`;
      renderFacturas();
      return;
    }
    const veniaDeUnPedido = Boolean(pedidoParaFacturar);
    const eraEdicion = Boolean(facturaEditandoId);
    errorEdicionFactura = null;
    const items = borradorFactura.items.map((i) => ({
      producto_id: i.producto_id,
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
      pedido_unidades: i.pidieron_unidades || null,
    }));

    const guardarFactura = async () => {
      if (facturaEditandoId) {
        const resultado = await window.freska.facturas.actualizar({
          id: facturaEditandoId,
          tipo_precio: tipoPrecioSeleccionado(),
          items,
        });
        if (resultado.ok === false) {
          errorEdicionFactura = resultado.error;
          renderFacturas();
          return;
        }
        errorEdicionFactura = null;
        facturaEditandoId = null;
        mostrarToast('Factura actualizada.', 'ok');
      } else {
        const nuevaFactura = await window.freska.facturas.crear({
          cliente_id: clienteId,
          tipo_precio: tipoPrecioSeleccionado(),
          items,
        });
        if (pedidoParaFacturar && nuevaFactura && nuevaFactura.id) {
          await window.freska.pedidos.marcarFacturado({
            id: pedidoParaFacturar.pedidoId,
            factura_id: nuevaFactura.id,
            items: items.map((i) => ({ producto_id: i.producto_id, cantidad: i.cantidad })),
          });
        }
      }

      pedidoParaFacturar = null;
      borradorFactura = { items: [] };
      camposFactura = null;

      if (!eraEdicion) {
        if (veniaDeUnPedido) {
          const pedidosTodos = await window.freska.pedidos.listar();
          const siguientePedido = pedidosTodos.find((p) => p.estado === 'pendiente' && !esPedidoProgramado(p));
          if (siguientePedido) {
            await facturarPedido(siguientePedido);
            mostrarToast(`Factura guardada. Cargamos el siguiente pedido pendiente: ${siguientePedido.cliente_nombre}.`, 'ok');
            return;
          }
        }
        mostrarToast('Factura guardada.', 'ok');
      }
      renderFacturas();
    };

    if (eraEdicion) {
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Guardar cambios</h3>
        <p>¿Seguro que querés guardar los cambios en la factura #${facturaEditandoId}?</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary">Sí, guardar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        cerrarModal();
        await guardarFactura();
      });
      return;
    }

    await guardarFactura();
  });

  const btnCancelarEdicion = document.getElementById('btn-cancelar-edicion');
  if (btnCancelarEdicion) {
    btnCancelarEdicion.addEventListener('click', () => {
      facturaEditandoId = null;
      errorEdicionFactura = null;
      borradorFactura = { items: [] };
      camposFactura = null;
      renderFacturas();
    });
  }

  const btnLimpiarFactura = document.getElementById('btn-limpiar-factura');
  if (btnLimpiarFactura) {
    btnLimpiarFactura.addEventListener('click', () => {
      function limpiar() {
        errorEdicionFactura = null;
        pedidoParaFacturar = null;
        borradorFactura = { items: [] };
        camposFactura = null;
        renderFacturas();
      }

      const algoCargado = leerLineasFactura().some((l) => l.producto_id || l.cantidad) || Boolean(document.getElementById('factura-cliente-buscar')?.value.trim());
      if (!algoCargado) {
        limpiar();
        return;
      }

      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Limpiar factura</h3>
        <p>¿Seguro que querés descartar esta factura? Vas a perder los productos que ya cargaste.</p>
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

  }

  vincularMenuFila();

  const btnImprimirFacturasHoy = document.getElementById('btn-imprimir-facturas-hoy');
  if (btnImprimirFacturasHoy) {
    btnImprimirFacturasHoy.addEventListener('click', () => {
      const facturasValidas = facturasHoy.filter((f) => f.estado !== 'anulada');
      if (facturasValidas.length === 0) {
        mostrarToast('No hay facturas de hoy para imprimir.', 'error');
        return;
      }
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Imprimir facturas de hoy</h3>
        <p>Elegí cuáles imprimir:</p>
        <label class="check-todos-consulta">
          <input type="checkbox" id="check-todas-imprimir-facturas" checked />
          Seleccionar todos
        </label>
        <ul class="recorrido-lista">
          ${facturasValidas
            .map(
              (f) => `
          <li>
            <div class="fila-imprimir-factura">
              <label>
                <input type="checkbox" class="check-imprimir-factura" value="${f.id}" checked />
                <span>N° ${f.id} — ${esc(f.cliente_nombre)}</span>
              </label>
              <button type="button" class="btn-ver-preview" data-id="${f.id}">Ver</button>
            </div>
            <div class="preview-factura-impresion" id="preview-factura-${f.id}" hidden></div>
          </li>`
            )
            .join('')}
        </ul>
        <div class="btn-group">
          <button type="button" id="modal-imprimir-facturas" class="primary">Imprimir</button>
        </div>
      `);

      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.querySelectorAll('.btn-ver-preview').forEach((btnVer) => {
        btnVer.addEventListener('click', async () => {
          const factura = facturasValidas.find((f) => f.id === Number(btnVer.dataset.id));
          const contenedor = document.getElementById(`preview-factura-${factura.id}`);
          if (!contenedor.hidden) {
            contenedor.hidden = true;
            btnVer.textContent = 'Ver';
            return;
          }
          if (!contenedor.innerHTML) {
            const items = await window.freska.facturas.items(factura.id);
            contenedor.innerHTML = facturaImpresionCardHtml(factura, items, clientesPorId[factura.cliente_id]);
          }
          contenedor.hidden = false;
          btnVer.textContent = 'Ocultar';
        });
      });
      document.getElementById('check-todas-imprimir-facturas').addEventListener('change', (e) => {
        document.querySelectorAll('.check-imprimir-factura').forEach((chk) => {
          chk.checked = e.target.checked;
        });
      });
      document.getElementById('modal-imprimir-facturas').addEventListener('click', async () => {
        const idsElegidos = Array.from(document.querySelectorAll('.check-imprimir-factura:checked')).map((chk) =>
          Number(chk.value)
        );
        if (idsElegidos.length === 0) {
          mostrarToast('Elegí al menos una factura.', 'error');
          return;
        }
        const btn = document.getElementById('modal-imprimir-facturas');
        btn.disabled = true;
        btn.textContent = 'Preparando...';
        const facturasElegidas = facturasValidas.filter((f) => idsElegidos.includes(f.id));
        const tarjetas = [];
        for (const f of facturasElegidas) {
          const items = await window.freska.facturas.items(f.id);
          const cliente = clientesPorId[f.cliente_id];
          tarjetas.push(facturaImpresionCardHtml(f, items, cliente));
        }
        document.getElementById('area-impresion').innerHTML = `<div class="hoja-impresion-facturas">${tarjetas.join('')}</div>`;
        cerrarModal();
        imprimirConTitulo('Facturacion');
      });
    });
  }

  const btnImprimirReparto = document.getElementById('btn-imprimir-reparto');
  if (btnImprimirReparto) {
    btnImprimirReparto.addEventListener('click', async () => {
      const facturasValidas = facturasHoy.filter((f) => f.estado !== 'anulada');
      if (facturasValidas.length === 0) {
        mostrarToast('No hay facturas de hoy para armar la hoja de reparto.', 'error');
        return;
      }
      const metodosPagoLista = await window.freska.metodosPago.listar();

      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Imprimir hoja de reparto</h3>
        <p>Elegí a quién repartís hoy (sacá a quien pasa a buscar en persona):</p>
        <label class="check-todos-consulta">
          <input type="checkbox" id="check-todas-reparto" checked />
          Seleccionar todos
        </label>
        <ul class="recorrido-lista">
          ${facturasValidas
            .map(
              (f) => `
          <li>
            <label>
              <input type="checkbox" class="check-reparto-factura" value="${f.id}" checked />
              <span>N° ${f.id} — ${esc(f.cliente_nombre)}</span>
            </label>
          </li>`
            )
            .join('')}
        </ul>
        <p style="margin-top:16px;">¿Qué métodos de pago querés que tengan columna en la hoja?</p>
        <label class="check-todos-consulta">
          <input type="checkbox" id="check-todos-metodos-reparto" checked />
          Seleccionar todos
        </label>
        <ul class="recorrido-lista">
          ${metodosPagoLista
            .map(
              (m) => `
          <li>
            <label>
              <input type="checkbox" class="check-reparto-metodo" value="${esc(m.nombre)}" checked />
              <span>${esc(m.nombre)}</span>
            </label>
          </li>`
            )
            .join('')}
        </ul>
        <div style="margin-bottom:14px;">
          <button type="button" class="btn-ver-preview" id="btn-preview-reparto">Ver vista previa</button>
        </div>
        <div class="preview-reparto" id="preview-reparto" hidden></div>
        <div class="btn-group">
          <button type="button" id="modal-imprimir-reparto" class="primary">Imprimir</button>
        </div>
      `);

      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('check-todas-reparto').addEventListener('change', (e) => {
        document.querySelectorAll('.check-reparto-factura').forEach((chk) => {
          chk.checked = e.target.checked;
        });
      });
      document.getElementById('check-todos-metodos-reparto').addEventListener('change', (e) => {
        document.querySelectorAll('.check-reparto-metodo').forEach((chk) => {
          chk.checked = e.target.checked;
        });
      });
      const leerSeleccionReparto = () => ({
        ids: Array.from(document.querySelectorAll('.check-reparto-factura:checked')).map((chk) => Number(chk.value)),
        metodos: Array.from(document.querySelectorAll('.check-reparto-metodo:checked')).map((chk) => chk.value),
      });

      const construirHojaReparto = async (idsElegidos, metodosElegidos) => {
        const facturasElegidas = facturasValidas.filter((f) => idsElegidos.includes(f.id));

        // Una fila por cliente: junta todas sus facturas de hoy
        const porCliente = new Map();
        for (const f of facturasElegidas) {
          const items = await window.freska.facturas.items(f.id);
          if (!porCliente.has(f.cliente_id)) {
            porCliente.set(f.cliente_id, { nombre: f.cliente_nombre, total: 0, productos: new Map() });
          }
          const fila = porCliente.get(f.cliente_id);
          fila.total += f.total;
          for (const i of items) {
            const unidad = i.producto_unidad === 'kg' ? 'kg' : 'u.';
            const actual = fila.productos.get(i.producto_id);
            if (actual) actual.cantidad += i.cantidad;
            else fila.productos.set(i.producto_id, { cantidad: i.cantidad, unidad, nombre: i.producto_nombre });
          }
        }
        const redondear = formatearCantidad;
        const filas = [];
        let totalPedidos = 0;
        for (const [clienteId, fila] of porCliente) {
          const saldoCliente = clientesPorId[clienteId]?.saldo || 0;
          const resumen = `<ul class="lista-pedido-reparto">${[...fila.productos.values()]
            .map((p) => `<li>${redondear(p.cantidad)} ${p.unidad} ${esc(p.nombre)}</li>`)
            .join('')}</ul>`;
          totalPedidos += fila.total;
          filas.push(`
          <tr>
            <td>${esc(fila.nombre)}</td>
            <td>${resumen}</td>
            <td class="col-a-cobrar">$${formatearMoneda(fila.total)}</td>
            <td class="col-a-cobrar">${saldoCliente > 0 ? '$' + formatearMoneda(saldoCliente) : ''}</td>
            ${metodosElegidos.map(() => '<td></td>').join('')}
          </tr>`);
        }
        return `
          <div class="hoja-impresion-reparto">
            <h2>Reparto — ${new Date().toLocaleDateString('es-AR')}</h2>
            <table class="tabla-impresion-reparto">
              <thead>
                <tr>
                  <th class="col-cliente">Cliente</th>
                  <th class="col-pedido">Pedido</th>
                  <th class="col-monto">Total pedido</th>
                  <th class="col-monto">Saldo</th>
                  ${metodosElegidos.map((m) => `<th>${esc(m)}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${filas.join('')}
                <tr class="fila-total-reparto">
                  <td colspan="2">Total</td>
                  <td class="col-a-cobrar">$${formatearMoneda(totalPedidos)}</td>
                  <td></td>
                  ${metodosElegidos.map(() => '<td></td>').join('')}
                </tr>
              </tbody>
            </table>
          </div>
        `;
      };

      const previewReparto = document.getElementById('preview-reparto');
      const btnPreviewReparto = document.getElementById('btn-preview-reparto');
      const refrescarPreviewReparto = async () => {
        const { ids, metodos } = leerSeleccionReparto();
        previewReparto.innerHTML =
          ids.length === 0 ? '<p>Elegí al menos un cliente.</p>' : await construirHojaReparto(ids, metodos);
      };
      btnPreviewReparto.addEventListener('click', async () => {
        if (!previewReparto.hidden) {
          previewReparto.hidden = true;
          btnPreviewReparto.textContent = 'Ver vista previa';
          return;
        }
        await refrescarPreviewReparto();
        previewReparto.hidden = false;
        btnPreviewReparto.textContent = 'Ocultar vista previa';
      });
      document
        .querySelectorAll(
          '.check-reparto-factura, .check-reparto-metodo, #check-todas-reparto, #check-todos-metodos-reparto'
        )
        .forEach((chk) => {
          chk.addEventListener('change', () => {
            if (!previewReparto.hidden) refrescarPreviewReparto();
          });
        });

      document.getElementById('modal-imprimir-reparto').addEventListener('click', async () => {
        const { ids, metodos } = leerSeleccionReparto();
        if (ids.length === 0) {
          mostrarToast('Elegí al menos un cliente.', 'error');
          return;
        }
        const btn = document.getElementById('modal-imprimir-reparto');
        btn.disabled = true;
        btn.textContent = 'Preparando...';
        document.getElementById('area-impresion').innerHTML = await construirHojaReparto(ids, metodos);
        cerrarModal();
        imprimirConTitulo('Reparto');
      });
    });
  }

  app.querySelectorAll('.registrar-pago').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fila = btn.closest('tr');
      await abrirRegistroPago(fila);
    });
  });

  app.querySelectorAll('.editar-factura').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const facturaId = Number(btn.dataset.id);
      const items = await window.freska.facturas.items(facturaId);
      borradorFactura.items = items.map((i) => ({
        producto_id: i.producto_id,
        nombre: i.producto_nombre,
        pidieron_unidades: i.pedido_unidades || null,
        unidad: i.producto_unidad,
        cantidad: i.cantidad,
        precio_unitario: i.precio_unitario,
        subtotal: i.subtotal,
      }));
      facturaEditandoId = facturaId;
      errorEdicionFactura = null;
      renderFacturas();
    });
  });

  app.querySelectorAll('.anular-factura').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fila = btn.closest('tr');
      abrirConfirmacionAnular(fila);
    });
  });

  app.querySelectorAll('.reactivar-factura').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Reactivar factura</h3>
        <p>La factura N° ${id} vuelve a quedar como estaba antes de anularla.</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary">Sí, reactivar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        const resultado = await window.freska.facturas.reactivar(id);
        cerrarModal();
        if (resultado.ok === false) {
          mostrarToast(resultado.error, 'error');
          return;
        }
        mostrarToast('Factura reactivada.', 'ok');
        renderFacturas();
      });
    });
  });

  app.querySelectorAll('tr.fila-factura-tab').forEach((fila) => {
    const alternarDetalle = async () => {
      const facturaId = Number(fila.dataset.id);
      const filaItems = app.querySelector(`.items-factura-tab-fila[data-items-de="${facturaId}"]`);
      const icono = fila.querySelector('.icono-fila');
      if (filaItems.style.display !== 'none') {
        filaItems.style.display = 'none';
        icono.classList.remove('abierto');
        return;
      }
      const factura = facturas.find((f) => f.id === facturaId);
      const [items, pagosFactura] = await Promise.all([window.freska.facturas.items(facturaId), window.freska.facturas.pagos(facturaId)]);
      // Una factura anulada no muestra con qué se pagó (ya no hay cobro que corregir ni anular).
      const pagosAMostrar = factura && factura.estado === 'anulada' ? [] : pagosFactura;
      const clienteDeFactura = factura ? clientes.find((c) => c.id === factura.cliente_id) : null;
      filaItems.querySelector('td').innerHTML =
        itemsFacturaListaHtml(items, factura ? { ...factura, saldoCliente: factura.estado !== 'anulada' && clienteDeFactura ? clienteDeFactura.saldo : 0 } : {}) +
        pagosDeFacturaHtml(pagosAMostrar);
      // Editar y Anular factura también a mano, en el detalle (los mismos que el ⋮ de la fila; no hay en una factura anulada).
      const itemEditar = fila.querySelector('.editar-factura');
      const itemAnular = fila.querySelector('.anular-factura');
      const itemReactivar = fila.querySelector('.reactivar-factura');
      if (itemEditar || itemAnular || itemReactivar) {
        const botones = [
          itemEditar ? '<button type="button" class="enlace-boton" id="det-editar-factura">Editar</button>' : '',
          itemAnular ? '<button type="button" class="enlace-boton enlace-peligro" id="det-anular-factura">Anular factura</button>' : '',
          itemReactivar ? '<button type="button" class="enlace-boton enlace-peligro" id="det-reactivar-factura">Reactivar</button>' : '',
        ].filter(Boolean);
        filaItems.querySelector('td').insertAdjacentHTML(
          'beforeend',
          `<p class="acciones-detalle-factura">${botones.join('<span class="texto-suave">·</span>')}</p>`
        );
        filaItems.querySelector('#det-editar-factura')?.addEventListener('click', (e) => {
          e.stopPropagation();
          itemEditar.click();
        });
        filaItems.querySelector('#det-anular-factura')?.addEventListener('click', (e) => {
          e.stopPropagation();
          itemAnular.click();
        });
        filaItems.querySelector('#det-reactivar-factura')?.addEventListener('click', (e) => {
          e.stopPropagation();
          itemReactivar.click();
        });
      }
      filaItems.querySelectorAll('.anular-cobro-factura').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          abrirAnularCobro({ ids: btn.dataset.ids.split(',').map(Number), monto: Number(btn.dataset.monto), metodo: btn.dataset.metodo }, () => renderFacturas());
        });
      });
      filaItems.querySelectorAll('.cambiar-metodo-factura').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          abrirCambioMetodoCobro(btn.dataset.ids.split(',').map(Number), btn.dataset.metodo, () => renderFacturas());
        });
      });
      filaItems.style.display = '';
      alinearDetalleFactura(filaItems);
      icono.classList.add('abierto');
    };
    fila.addEventListener('click', (e) => {
      if (e.target.closest('.acciones-factura')) return;
      alternarDetalle();
    });
    fila.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === fila) alternarDetalle();
    });
  });

  vincularSelectorFecha('filtro-fecha-facturas-tab', filtroFechaFacturasTab, (fecha) => {
    filtroFechaFacturasTab = fecha;
    renderFacturas();
  });

  vincularFiltrosLista('filtros-facturas', (_grupo, valor) => {
    mostrarFacturasTab = valor;
    limiteFacturasAnuladas = FACTURAS_ANULADAS_POR_PAGINA;
    renderFacturas();
  });

  const inputBuscarFacturaTab = document.getElementById('buscar-factura-tab');
  inputBuscarFacturaTab.addEventListener('input', async () => {
    busquedaFacturasTab = inputBuscarFacturaTab.value;
    await renderFacturas();
    const nuevoInput = document.getElementById('buscar-factura-tab');
    nuevoInput.focus();
    nuevoInput.setSelectionRange(nuevoInput.value.length, nuevoInput.value.length);
  });

  app.querySelectorAll('.enviar-whatsapp').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const facturaId = Number(btn.dataset.id);
      const factura = facturas.find((f) => f.id === facturaId);
      const items = await window.freska.facturas.items(facturaId);
      const mensaje = construirMensajeWhatsapp(factura, items, clientesPorId[factura.cliente_id]);
      const abrirWhatsappA = async (telefonoCrudo) => {
        const telefono = (telefonoCrudo || '').replace(/\D/g, '');
        const url = telefono
          ? `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`
          : `https://wa.me/?text=${encodeURIComponent(mensaje)}`;
        await window.freska.sistema.abrirEnlace(url);
      };
      if (!factura.cliente_telefono2) {
        await abrirWhatsappA(factura.cliente_telefono);
        return;
      }
      // El cliente tiene un segundo WhatsApp cargado (por ejemplo, un negocio con dos dueños): antes de
      // mandarlo, preguntamos a quién.
      mostrarModal(`${MODAL_X_HTML}
        <h3>¿A quién se lo mandás?</h3>
        <div class="btn-group" style="flex-direction:column; align-items:stretch; gap:8px;">
          <button type="button" class="primary" id="wa-contacto-1">${esc(factura.cliente_nombre)}</button>
          <button type="button" class="primary" id="wa-contacto-2">${esc(factura.cliente_telefono2_nombre || 'Segundo WhatsApp')}</button>
          <button type="button" id="wa-contacto-ambos">A los dos</button>
        </div>
      `);
      document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
      document.getElementById('wa-contacto-1').addEventListener('click', async () => {
        cerrarModal();
        await abrirWhatsappA(factura.cliente_telefono);
      });
      document.getElementById('wa-contacto-2').addEventListener('click', async () => {
        cerrarModal();
        await abrirWhatsappA(factura.cliente_telefono2);
      });
      document.getElementById('wa-contacto-ambos').addEventListener('click', async () => {
        cerrarModal();
        await abrirWhatsappA(factura.cliente_telefono);
        await abrirWhatsappA(factura.cliente_telefono2);
      });
    });
  });

  document.getElementById('btn-ver-mas-anuladas')?.addEventListener('click', () => {
    limiteFacturasAnuladas += FACTURAS_ANULADAS_POR_PAGINA;
    renderFacturas();
  });

  const btnRecorridoHoy = document.getElementById('btn-recorrido-hoy');
  if (btnRecorridoHoy) {
  btnRecorridoHoy.addEventListener('click', () => {
    const clientesDelDia = [];
    const vistos = new Set();
    facturasHoy
      .filter((f) => f.estado !== 'anulada')
      .forEach((f) => {
        if (vistos.has(f.cliente_id)) return;
        vistos.add(f.cliente_id);
        clientesDelDia.push(clientesPorId[f.cliente_id]);
      });

    if (clientesDelDia.length === 0) {
      mostrarToast('No hay facturas de hoy para armar un recorrido.', 'error');
      return;
    }

    mostrarModal(`${modalXHtml('modal-cancelar')}
      <h3>Recorrido de hoy</h3>
      <p>Elegí a quién se le reparte hoy:</p>
      <ul class="recorrido-lista">
        ${clientesDelDia
          .map(
            (c) => `
          <li>
            <label>
              <input type="checkbox" class="check-recorrido" value="${c.id}" ${c.domicilio ? 'checked' : 'disabled'} />
              <span>${esc(nombreCompleto(c))}${c.domicilio ? ` — ${esc(c.domicilio)}` : ' <span class="recorrido-sin-domicilio">(sin dirección cargada)</span>'}</span>
            </label>
          </li>`
          )
          .join('')}
      </ul>
      <div class="btn-group">
        <button type="button" id="modal-abrir-recorrido" class="primary">Abrir recorrido</button>
      </div>
    `);

    document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('modal-abrir-recorrido').addEventListener('click', async () => {
      const direcciones = Array.from(document.querySelectorAll('.check-recorrido:checked')).map(
        (chk) => clientesPorId[Number(chk.value)].domicilio
      );
      if (direcciones.length === 0) {
        mostrarToast('Elegí al menos un cliente con dirección cargada.', 'error');
        return;
      }

      const direccionLocalCargada = await window.freska.config.obtenerDireccionLocal();
      const zona = await window.freska.config.obtenerZonaLocal();
      const direccionLocal = direccionConZona(direccionLocalCargada, zona);
      if (!direccionLocalCargada) {
        mostrarToast(
          'Falta cargar la dirección del local. La encontrás en el menú (☰) → Dirección del local.',
          'error'
        );
        return;
      }

      const btnAbrir = document.getElementById('modal-abrir-recorrido');
      btnAbrir.disabled = true;
      btnAbrir.textContent = 'Calculando recorrido...';

      const origenCoords = await window.freska.sistema.geocodificar(direccionLocal);
      if (!origenCoords || origenCoords.error) {
        mostrarToast(
          origenCoords && origenCoords.error
            ? 'No hay conexión para buscar el mapa. Revisá internet y probá de nuevo.'
            : 'No pudimos ubicar la dirección del local. Revisala en el menú (☰) → Dirección del local: conviene cargar la ciudad y la provincia.',
          'error'
        );
        btnAbrir.disabled = false;
        btnAbrir.textContent = 'Abrir recorrido';
        return;
      }

      const puntos = [];
      const sinUbicar = [];
      for (const direccion of direcciones) {
        await esperar(1100);
        const direccionCompleta = direccionConZona(direccion, zona);
        const coords = await window.freska.sistema.geocodificar(direccionCompleta);
        if (coords && !coords.error) {
          puntos.push({ direccion: direccionCompleta, coords });
        } else {
          sinUbicar.push(direccion);
        }
      }

      if (puntos.length === 0) {
        mostrarToast('No pudimos ubicar ninguna de las direcciones elegidas.', 'error');
        btnAbrir.disabled = false;
        btnAbrir.textContent = 'Abrir recorrido';
        return;
      }

      const puntosOrdenados = ordenarPorCercania(origenCoords, puntos);
      const destino = encodeURIComponent(puntosOrdenados[puntosOrdenados.length - 1].direccion);
      const paradas = puntosOrdenados
        .slice(0, -1)
        .map((p) => encodeURIComponent(p.direccion))
        .join('|');
      const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(direccionLocal)}&destination=${destino}${paradas ? `&waypoints=${paradas}` : ''}&travelmode=driving`;
      await window.freska.sistema.abrirEnlace(url);
      cerrarModal();
      if (sinUbicar.length > 0) {
        mostrarToast(`No pudimos ubicar: ${sinUbicar.join(', ')}. Revisá esas direcciones.`, 'error');
      }
    });
  });
  }
}

function lineaPagoHtml(metodos, valorInicial) {
  return `
    <div class="pago-linea">
      <div class="input-moneda">
        <span>$</span>
        <input type="text" inputmode="decimal" class="monto-pago" value="${esc(valorInicial)}" />
      </div>
      <select class="metodo-pago">
        ${metodos.map((m) => `<option value="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('')}
      </select>
      <button class="btn-redondo btn-menos quitar-linea-pago" type="button" aria-label="Quitar método de pago" title="Quitar">−</button>
      <div class="pago-cheque" hidden>
        <input type="text" class="cheque-banco" placeholder="Banco" maxlength="60" autocomplete="off" aria-label="Banco del cheque" />
        <input type="text" class="cheque-numero" placeholder="N° de cheque" maxlength="30" autocomplete="off" aria-label="Número del cheque" />
        <input type="text" class="cheque-fecha" placeholder="Cobra el (dd/mm/aaaa)" inputmode="numeric" autocomplete="off" aria-label="Fecha de cobro del cheque" />
      </div>
    </div>
  `;
}

// El "+" de agregar otro método de pago vive al final de la última línea (junto a su "−"), no suelto abajo:
// se mueve ahí cada vez que cambian las líneas. Antes de quitar una línea hay que devolverlo a su lugar, para
// que no se lleve el botón puesto.
function ubicarBotonAgregarPago() {
  const boton = document.querySelector('.btn-agregar-pago');
  const lineas = document.querySelectorAll('.pago-linea');
  if (!boton || !lineas.length) return;
  const ultima = lineas[lineas.length - 1];
  const quitar = ultima.querySelector('.quitar-linea-pago');
  if (quitar) quitar.after(boton);
  else ultima.appendChild(boton);
}

function devolverBotonAgregarPago() {
  const boton = document.querySelector('.pago-linea .btn-agregar-pago');
  const destino = document.querySelector('.pago-agregar');
  if (boton && destino) destino.appendChild(boton);
}

function editorLineasPagoHtml(metodos, valorInicial) {
  return `
    <div class="pago-lineas">${lineaPagoHtml(metodos, valorInicial)}</div>
    <div class="pago-agregar">
      <button class="btn-redondo btn-mas btn-agregar-pago" type="button" aria-label="Agregar otro método de pago" title="Agregar otro método de pago">+</button>
    </div>
  `;
}

function vincularEditorLineasPago(contenedor, metodos, montoTotal) {
  const lineasCont = contenedor.querySelector('.pago-lineas');

  // Un método ya elegido en una línea no se puede elegir de nuevo en otra: se oculta de las demás listas, y si ya
  // están todos usados no se ofrece el "+".
  function refrescarMetodosUsados() {
    const selects = Array.from(lineasCont.querySelectorAll('.metodo-pago'));
    selects.forEach((sel) => {
      const usados = new Set(selects.filter((o) => o !== sel).map((o) => o.value));
      Array.from(sel.options).forEach((op) => {
        op.disabled = usados.has(op.value);
        op.hidden = usados.has(op.value);
      });
    });
    const boton = contenedor.querySelector('.btn-agregar-pago');
    if (boton) boton.hidden = selects.length >= metodos.length;
  }

  function actualizarBotonesQuitar() {
    refrescarMetodosUsados();
    const lineas = lineasCont.querySelectorAll('.pago-linea');
    lineasCont.querySelectorAll('.quitar-linea-pago').forEach((btn) => {
      btn.style.display = lineas.length > 1 ? '' : 'none';
    });
    ubicarBotonAgregarPago();
  }

  function vincularQuitarLineas() {
    lineasCont.querySelectorAll('.quitar-linea-pago').forEach((btn) => {
      btn.onclick = () => {
        devolverBotonAgregarPago();
        btn.closest('.pago-linea').remove();
        actualizarBotonesQuitar();
      };
    });
  }

  // Con exactamente dos líneas, lo que se escribe en una completa la otra con lo que falta (lo más
  // común es partir el pago en efectivo + otro método). Si esa otra ya se escribió a mano, no se toca.
  function autocompletarOtraLinea(lineaEditada) {
    const lineas = Array.from(lineasCont.querySelectorAll('.pago-linea'));
    if (lineas.length !== 2) return;
    const otra = lineas.find((l) => l !== lineaEditada);
    if (otra.dataset.manual === '1') return;
    const escrito = limpiarNumeroMoneda(lineaEditada.querySelector('.monto-pago').value) || 0;
    const falta = Math.max(0, redondearPesos(montoTotal - escrito));
    otra.querySelector('.monto-pago').value = falta > 0 ? formatearMoneda(falta) : '';
  }

  function vincularFormatoLineas() {
    lineasCont.querySelectorAll('.monto-pago').forEach((input) => {
      if (input.dataset.formatoVinculado) return;
      input.dataset.formatoVinculado = '1';
      vincularFormatoMoneda(input);
      input.addEventListener('input', () => {
        const linea = input.closest('.pago-linea');
        linea.dataset.manual = '1';
        autocompletarOtraLinea(linea);
      });
    });
  }

  // Con el método "Cheque" aparecen banco, número y fecha de cobro (el cheque queda en la cartera).
  function vincularChequeLineas() {
    lineasCont.querySelectorAll('.pago-linea').forEach((linea) => {
      if (linea.dataset.chequeVinculado) return;
      linea.dataset.chequeVinculado = '1';
      const bloque = linea.querySelector('.pago-cheque');
      const select = linea.querySelector('.metodo-pago');
      const actualizar = () => {
        const esCheque = esMetodoChequeTexto(select.value);
        bloque.hidden = !esCheque;
        if (esCheque && linea.dataset.chequeAbierto !== '1') {
          linea.dataset.chequeAbierto = '1';
          bloque.querySelector('.cheque-banco').focus();
        }
      };
      select.addEventListener('change', actualizar);
      select.addEventListener('change', refrescarMetodosUsados);
      const fecha = bloque.querySelector('.cheque-fecha');
      fecha.addEventListener('input', () => {
        fecha.value = formatearFechaMientrasEscribe(fecha.value);
      });
      actualizar();
    });
  }

  actualizarBotonesQuitar();
  vincularQuitarLineas();
  vincularFormatoLineas();
  vincularChequeLineas();
  ubicarBotonAgregarPago();

  contenedor.querySelector('.btn-agregar-pago').addEventListener('click', () => {
    const usado = Array.from(lineasCont.querySelectorAll('.monto-pago')).reduce(
      (acc, input) => acc + (limpiarNumeroMoneda(input.value) || 0),
      0
    );
    const sinAsignar = Math.max(0, montoTotal - usado);
    lineasCont.insertAdjacentHTML(
      'beforeend',
      lineaPagoHtml(metodos, sinAsignar > 0 ? formatearMoneda(sinAsignar) : '')
    );
    // La línea nueva arranca con el primer método que todavía no se usó.
    const nueva = lineasCont.lastElementChild.querySelector('.metodo-pago');
    const yaUsados = new Set(Array.from(lineasCont.querySelectorAll('.metodo-pago')).filter((o) => o !== nueva).map((o) => o.value));
    const libre = metodos.find((m) => !yaUsados.has(m.nombre));
    if (libre) nueva.value = libre.nombre;
    vincularQuitarLineas();
    vincularFormatoLineas();
    vincularChequeLineas();
    actualizarBotonesQuitar();
  });
}

function esMetodoChequeTexto(metodo) {
  return String(metodo || '').trim().toLowerCase() === 'cheque';
}

function leerLineasPago(contenedor) {
  return Array.from(contenedor.querySelectorAll('.pago-linea'))
    .map((linea) => {
      const metodo = linea.querySelector('.metodo-pago').value;
      const resultado = {
        monto: limpiarNumeroMoneda(linea.querySelector('.monto-pago').value),
        metodo_pago: metodo,
      };
      if (esMetodoChequeTexto(metodo)) {
        const textoFecha = linea.querySelector('.cheque-fecha').value.trim();
        resultado.cheque = {
          banco: linea.querySelector('.cheque-banco').value.trim(),
          numero: linea.querySelector('.cheque-numero').value.trim(),
          fecha_cobro: textoFecha ? fechaCortaAIso(textoFecha) : null,
          fecha_invalida: Boolean(textoFecha) && !fechaCortaAIso(textoFecha),
        };
      }
      return resultado;
    })
    .filter((linea) => linea.monto > 0);
}

// Devuelve el mensaje de error si alguna línea con cheque está incompleta (banco y número son obligatorios).
function errorDeChequesEnLineas(lineas) {
  for (const l of lineas) {
    if (!l.cheque) continue;
    if (!l.cheque.banco || !l.cheque.numero) return 'Para cobrar con cheque poné el banco y el número.';
    if (l.cheque.fecha_invalida) return 'La fecha de cobro del cheque no es válida (dd/mm/aaaa).';
  }
  return null;
}

async function abrirRegistroPago(fila) {
  const id = Number(fila.dataset.id);
  const total = parseFloat(fila.dataset.total);
  const pagado = parseFloat(fila.dataset.pagado);
  const restante = total - pagado;
  const nombreCliente = fila.dataset.nombre;
  const metodos = await window.freska.metodosPago.listar();

  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Registrar pago</h3>
    <p>${esc(nombreCliente)} — falta pagar <strong>$${formatearMoneda(restante)}</strong> de esta factura.</p>
    ${editorLineasPagoHtml(metodos, formatearMoneda(restante))}
    <p id="error-pago-factura" class="error-msg" style="display:none"></p>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary">Confirmar</button>
    </div>
  `);

  const modalCard = document.querySelector('.modal-card');
  vincularEditorLineasPago(modalCard, metodos, restante);

  const primerMonto = modalCard.querySelector('.monto-pago');
  primerMonto.focus();
  primerMonto.select();

  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    const lineas = leerLineasPago(modalCard);
    const error = document.getElementById('error-pago-factura');
    if (lineas.length === 0) {
      error.textContent = 'Ingresá un monto válido.';
      error.style.display = '';
      return;
    }
    const totalIngresado = lineas.reduce((acc, l) => acc + l.monto, 0);
    if (totalIngresado > restante + 0.01) {
      error.textContent = 'La suma de los montos supera lo que falta pagar.';
      error.style.display = '';
      return;
    }
    const errorCheque = errorDeChequesEnLineas(lineas);
    if (errorCheque) {
      error.textContent = errorCheque;
      error.style.display = '';
      return;
    }
    for (const l of lineas) {
      await window.freska.facturas.registrarPago({
        factura_id: id,
        monto: l.monto,
        metodo_pago: l.metodo_pago,
        cheque: l.cheque,
      });
    }
    cerrarModal();
    mostrarToast('Pago registrado.', 'ok');
    renderFacturas();
  });
}

async function abrirConfirmacionAnular(fila) {
  const id = Number(fila.dataset.id);
  const nombreCliente = fila.dataset.nombre;
  // Si la factura ya tenía pagos, se pregunta qué pasa con esa plata: saldo a favor del cliente (lo normal) o
  // devolverla. Lo pagado con cheque o con saldo a favor no se puede devolver en plata: queda como saldo a favor.
  const pagos = await window.freska.facturas.pagos(id);
  const pagado = redondearPesos(pagos.reduce((acc, p) => acc + p.monto, 0));
  const devolvible = redondearPesos(
    pagos.filter((p) => !/^(cheque|saldo a favor)$/i.test(String(p.metodo_pago).trim())).reduce((acc, p) => acc + p.monto, 0)
  );
  const porMetodo = {};
  pagos.forEach((p) => (porMetodo[String(p.metodo_pago).trim().toLowerCase()] = String(p.metodo_pago).trim()));
  const detallePagosAnular = Object.values(porMetodo).map((n) => n.toLowerCase()).join(' y ');
  const metodos = (await window.freska.metodosPago.listar()).filter((m) => !/^(cheque|saldo a favor)$/i.test(m.nombre.trim()));
  const metodoSugerido = (pagos.find((p) => metodos.some((m) => m.nombre === p.metodo_pago)) || {}).metodo_pago || (metodos[0] && metodos[0].nombre) || '';

  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Anular factura</h3>
    <p>¿Seguro que querés anular la factura de <strong>${esc(nombreCliente)}</strong>?</p>
    ${
      pagado > 0.005
        ? `<div class="anular-destino">
      ${
        devolvible > 0.005 && metodos.length
          ? `<p class="anular-destino-titulo">Ya tenía pagos por <strong>$${formatearMoneda(pagado)}</strong>. ¿Qué hacemos con esa plata?</p>
      <div class="anular-bloque">
        <label class="anular-opcion"><input type="radio" name="anular-destino" value="credito" checked /><span>Dejarla como <strong>saldo a favor</strong> del cliente</span></label>
      </div>
      <div class="anular-bloque">
        <label class="anular-opcion"><input type="radio" name="anular-destino" value="devolver" /><span><strong>Devolver la plata</strong> ($${formatearMoneda(devolvible)})</span></label>
        <div class="anular-devolver" id="anular-devolver" hidden>
          <label class="op-campo"><span>Devolver con</span><select id="anular-metodo" aria-label="Con qué se devuelve">${metodos.map((m) => `<option ${m.nombre === metodoSugerido ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}</select></label>
        </div>
      </div>
      ${devolvible < pagado - 0.005 ? `<p class="pin-subtitulo">Lo pagado con cheque o con saldo a favor ($${formatearMoneda(redondearPesos(pagado - devolvible))}) no se devuelve en plata: queda como saldo a favor.</p>` : ''}`
          : `<p>Esta factura estaba pagada con <strong>${esc(detallePagosAnular)}</strong>, por $${formatearMoneda(pagado)}. Como no fue plata que entró, no hay nada para devolver: ese importe vuelve a quedar como <strong>saldo a favor</strong> del cliente.</p><input type="radio" name="anular-destino" value="credito" checked hidden />`
      }
    </div>`
        : ''
    }
    <label class="op-campo op-completo campo-motivo-anulacion"><span>Motivo${sesionActual && sesionActual.rol === 'empleado' ? '' : ' (opcional)'}</span><input type="text" id="motivo-anulacion" maxlength="200" autocomplete="off" /></label>
    <div id="modal-error" class="error-msg" style="display:none"></div>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, anular</button>
    </div>
  `);

  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    const motivo = document.getElementById('motivo-anulacion').value.trim();
    const destino = document.querySelector('input[name="anular-destino"]:checked')?.value || 'credito';
    const resultado = await window.freska.facturas.anular({
      id,
      motivo,
      destino,
      metodo: destino === 'devolver' ? document.getElementById('anular-metodo').value : undefined,
      monto: destino === 'devolver' ? devolvible : undefined,
    });
    if (resultado.ok === false) {
      const error = document.getElementById('modal-error');
      error.textContent = resultado.error;
      error.style.display = '';
      return;
    }
    cerrarModal();
    mostrarToast(
      destino === 'devolver' ? 'Factura anulada: se devolvió la plata.' : pagado > 0.005 ? 'Factura anulada: la plata quedó como saldo a favor del cliente.' : 'Factura anulada.',
      'ok'
    );
    renderFacturas();
  });

  document.querySelectorAll('input[name="anular-destino"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const devolver = document.querySelector('input[name="anular-destino"]:checked').value === 'devolver';
      const caja = document.getElementById('anular-devolver');
      if (caja) caja.hidden = !devolver;
    });
  });

  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
}
