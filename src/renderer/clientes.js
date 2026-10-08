// Clientes: lista, ficha y cobros a clientes.
// (Antes todo estaba en renderer.js; se dividió por pantalla el 2026-09-24. Los archivos son scripts comunes que
// comparten el mismo espacio global: se cargan en el orden de index.html y no hace falta importar nada.)

let mostrarFormCliente = false;
let pestanaClientes = 'todos'; // 'todos' | 'baja'
let ordenClientes = 'saldo'; // 'saldo' | 'nombre' | 'ultima' | 'codigo'
let mostrarClientes = 'todos'; // 'todos' | 'deuda' | 'inactivos'
const DIAS_CLIENTE_INACTIVO = 30;
let mostrarDatosFichaCliente = false;
const MOVIMIENTOS_POR_PAGINA = 30;
let limiteHistorialFicha = MOVIMIENTOS_POR_PAGINA;
let origenFichaCliente = 'clientes';
let errorFormCliente = null;

async function renderClientes() {
  const clientes = await window.freska.clientes.listar();
  const vendedores = await vendedoresParaElegir();
  // En "Dados de baja" el saldo siempre sería $0, así que ahí se muestra la fecha de la última compra
  // (la factura más reciente que no esté anulada).
  const ultimaCompraPorCliente = {};
  const facturasDeClientes = await window.freska.facturas.listar();
  facturasDeClientes
    .filter((f) => f.estado !== 'anulada')
    .forEach((f) => {
      if (!ultimaCompraPorCliente[f.cliente_id] || f.fecha > ultimaCompraPorCliente[f.cliente_id]) {
        ultimaCompraPorCliente[f.cliente_id] = f.fecha;
      }
    });
  const clientesActivos = clientes.filter(clienteActivo);
  const clientesMostrados =
    pestanaClientes === 'baja'
      ? clientes.filter((c) => !clienteActivo(c))
      : ordenarClientes(filtrarClientes(clientesActivos, ultimaCompraPorCliente), ultimaCompraPorCliente);
  const mensajeListaVacia =
    pestanaClientes === 'baja'
      ? 'No hay clientes dados de baja.'
      : mostrarClientes === 'deuda'
        ? 'Ningún cliente tiene saldo pendiente.'
        : mostrarClientes === 'inactivos'
          ? `Ningún cliente lleva más de ${DIAS_CLIENTE_INACTIVO} días sin comprar.`
          : 'Todavía no hay clientes.';
  const verUltimaCompra = (orden) => orden === 'ultima' || mostrarClientes === 'inactivos';

  const toolbarClientesHtml = `
      <div class="busqueda-filtros">
      <input type="text" id="buscar-cliente" class="buscador" placeholder="Buscar cliente" />
      ${
        pestanaClientes === 'baja'
          ? ''
          : filtrosListaHtml('filtros-clientes', [
              {
                nombre: 'orden',
                titulo: 'Ordenar por',
                opciones: [['saldo', 'Mayor saldo'], ['nombre', 'Nombre A–Z'], ['ultima', 'Última compra'], ['codigo', 'Código']],
                actual: ordenClientes,
                porDefecto: 'saldo',
              },
              {
                nombre: 'ver',
                titulo: 'Ver',
                opciones: [['todos', 'Todos'], ['deuda', 'Solo con deuda'], ['inactivos', `Sin comprar hace más de ${DIAS_CLIENTE_INACTIVO} días`]],
                actual: mostrarClientes,
                porDefecto: 'todos',
              },
            ])
      }
      </div>`;
  const tabsClientesHtml = `
    <div class="reportes-toggle">
      <button type="button" class="toggle ${pestanaClientes === 'todos' ? 'active' : ''}" id="tab-todos-clientes">Todos</button>
      <button type="button" class="toggle ${pestanaClientes === 'baja' ? 'active' : ''}" id="tab-baja-clientes">Dados de baja</button>
    </div>`;
  const controlesClientesHtml = `${
    !mostrarFormCliente ? '<div class="lista-agregar"><button id="btn-toggle-form-cliente" class="primary" type="button">+ Agregar cliente</button></div>' : ''
  }<div class="toolbar toolbar-lista fila-controles-lista">${tabsClientesHtml}${toolbarClientesHtml}</div>`;
  app.innerHTML = `
    ${mostrarFormCliente ? '' : controlesClientesHtml}
    ${
      mostrarFormCliente
        ? `
    <h2>Agregar cliente</h2>
    <form id="form-cliente" class="panel gasto-form">
      ${errorFormCliente ? `<p class="error-msg">${esc(errorFormCliente)}</p>` : ''}
      <div class="gasto-fila">
        <label class="gasto-campo campo-codigo-cliente"><span>Código</span><input type="text" id="codigo-cliente" maxlength="20" value="${esc(siguienteCodigoCliente(clientes))}" /></label>
        <label class="gasto-campo"><span>Nombre</span><input type="text" id="nombre-cliente" required /></label>
        <label class="gasto-campo"><span>Apellido (opcional)</span><input type="text" id="apellido-cliente" /></label>
        <label class="gasto-campo"><span>Negocio (opcional)</span><input type="text" id="negocio-cliente" maxlength="80" placeholder="Ej: Almacén Don Pepe" /></label>
      </div>
      <div class="gasto-fila">
        <label class="gasto-campo"><span>Teléfono WhatsApp</span><input type="tel" id="telefono-cliente" placeholder="3511234567 (sin 0 ni 15)" /></label>
        <label class="gasto-campo"><span>Teléfono fijo (opcional)</span><input type="tel" id="telefono-fijo-cliente" /></label>
        <label class="gasto-campo gasto-campo-observacion"><span>Domicilio</span><input type="text" id="domicilio-cliente" /></label>
      </div>
      <div class="gasto-fila">
        <label class="gasto-campo"><span>Segundo WhatsApp (opcional)</span><input type="tel" id="telefono2-cliente" placeholder="3511234567" /></label>
        <label class="gasto-campo"><span>Nombre de quién es (opcional)</span><input type="text" id="telefono2-nombre-cliente" maxlength="40" placeholder="Ej: Juan (el otro dueño)" /></label>
        <label class="gasto-campo"><span>Saldo inicial (opcional)</span><div class="input-moneda"><span>$</span><input type="text" id="saldo-inicial-cliente" inputmode="decimal" autocomplete="off" /></div></label>
      </div>
      <div class="gasto-fila">
        <label class="gasto-campo campo-condicion-iva-cliente"><span>Condición frente al IVA (opcional)</span><select id="condicion-iva-cliente">${opcionesCondicionIvaHtml('')}</select></label>
        <label class="gasto-campo campo-cuit-cliente"><span>CUIT (opcional)</span><input type="text" id="cuit-cliente" inputmode="numeric" maxlength="13" placeholder="20-12345678-9" /></label>
        <label class="gasto-campo gasto-campo-observacion"><span>Nota (opcional)</span><input type="text" id="nota-cliente" /></label>
      </div>
      ${
        puedeAsignarVendedor()
          ? `<div class="gasto-fila">
        <label class="gasto-campo"><span>Vendedor (opcional)</span><select id="vendedor-cliente">${opcionesVendedorHtml(vendedores, null)}</select></label>
      </div>`
          : ''
      }
      <div class="btn-group">
        <button type="submit" class="primary">Guardar</button>
        <button type="button" id="btn-cancelar-form-cliente">Cancelar</button>
      </div>
    </form>
    ${controlesClientesHtml}`
        : ''
    }
    <table class="tabla-clientes">
      <thead><tr><th class="col-codigo">Cód.</th><th>Nombre</th><th>${pestanaClientes === 'baja' ? 'Última compra' : 'Saldo'}</th></tr></thead>
      <tbody id="clientes-body">
        ${
          clientesMostrados.length === 0
            ? `<tr><td colspan="3">${mensajeListaVacia}</td></tr>`
            : clientesMostrados.map((c) => filaCliente(c, pestanaClientes === 'baja', ultimaCompraPorCliente, pestanaClientes !== 'baja' && verUltimaCompra(ordenClientes))).join('')
        }
      </tbody>
    </table>
  `;

  document.getElementById(mostrarFormCliente ? 'nombre-cliente' : 'buscar-cliente').focus();

  // Ordenar / filtrar vuelve a dibujar la lista; lo escrito en el buscador se conserva.
  const alCambiarFiltroClientes = () => {
    const texto = document.getElementById('buscar-cliente').value;
    renderClientes().then(() => {
      const buscador = document.getElementById('buscar-cliente');
      if (texto && buscador) {
        buscador.value = texto;
        buscador.dispatchEvent(new Event('input'));
      }
    });
  };
  vincularFiltrosLista('filtros-clientes', (grupo, valor) => {
    if (grupo === 'orden') ordenClientes = valor;
    else mostrarClientes = valor;
    alCambiarFiltroClientes();
  });

  document.getElementById('tab-todos-clientes').addEventListener('click', () => {
    pestanaClientes = 'todos';
    renderClientes();
  });

  document.getElementById('tab-baja-clientes').addEventListener('click', () => {
    pestanaClientes = 'baja';
    renderClientes();
  });

  if (!mostrarFormCliente) {
    document.getElementById('btn-toggle-form-cliente').addEventListener('click', () => {
      mostrarFormCliente = true;
      errorFormCliente = null;
      renderClientes();
    });
  }


  if (mostrarFormCliente) {
    vincularFormatoMoneda(document.getElementById('saldo-inicial-cliente'));
    document.getElementById('btn-cancelar-form-cliente').addEventListener('click', () => {
      mostrarFormCliente = false;
      errorFormCliente = null;
      renderClientes();
    });
    document.getElementById('form-cliente').addEventListener('submit', async (e) => {
      e.preventDefault();
      const inputNombre = document.getElementById('nombre-cliente');
      const inputApellido = document.getElementById('apellido-cliente');
      const inputTelefono = document.getElementById('telefono-cliente');
      const inputTelefonoFijo = document.getElementById('telefono-fijo-cliente');
      const inputTelefono2 = document.getElementById('telefono2-cliente');
      const inputTelefono2Nombre = document.getElementById('telefono2-nombre-cliente');
      const inputDomicilio = document.getElementById('domicilio-cliente');
      const inputNota = document.getElementById('nota-cliente');
      const inputSaldoInicial = document.getElementById('saldo-inicial-cliente');
      if (!inputNombre.value.trim()) return;
      const resultado = await window.freska.clientes.crear({
        nombre: inputNombre.value.trim(),
        apellido: inputApellido.value.trim(),
        telefono: inputTelefono.value.trim(),
        telefono_fijo: inputTelefonoFijo.value.trim(),
        telefono2: inputTelefono2.value.trim(),
        telefono2_nombre: inputTelefono2Nombre.value.trim(),
        domicilio: inputDomicilio.value.trim(),
        nota: inputNota.value.trim(),
        negocio: document.getElementById('negocio-cliente').value.trim(),
        codigo: document.getElementById('codigo-cliente').value.trim(),
        condicion_iva: document.getElementById('condicion-iva-cliente').value,
        cuit: document.getElementById('cuit-cliente').value.trim(),
        saldo_inicial: inputSaldoInicial.value.trim() === '' ? 0 : limpiarNumeroMoneda(inputSaldoInicial.value),
        vendedor_id: document.getElementById('vendedor-cliente')?.value || null,
      });
      if (resultado.ok === false) {
        errorFormCliente = resultado.error;
        const nombreNuevo = normalizarTexto(`${inputNombre.value.trim()} ${inputApellido.value.trim()}`.trim());
        const dadoDeBaja = clientes.find((c) => !clienteActivo(c) && normalizarTexto(nombreCompleto(c)) === nombreNuevo);
        if (dadoDeBaja) {
          errorFormCliente = 'Ya existe un cliente con ese nombre, pero está dado de baja. Buscalo en la pestaña "Dados de baja" para darlo de alta de nuevo.';
        }
        renderClientes();
        return;
      }
      errorFormCliente = null;
      mostrarFormCliente = false;
      mostrarToast('Cliente guardado.', 'ok');
      renderClientes();
    });
  }

  document.getElementById('buscar-cliente').addEventListener('input', (e) => {
    const query = normalizarTexto(e.target.value.trim());
    document.querySelectorAll('#clientes-body tr').forEach((fila) => {
      fila.style.display = normalizarTexto(fila.dataset.busqueda || fila.dataset.nombre || '').includes(query) ? '' : 'none';
    });
  });

  app.querySelectorAll('#clientes-body tr[data-id]').forEach((fila) => {
    const abrirFicha = () => {
      mostrarDatosFichaCliente = false;
      limiteHistorialFicha = MOVIMIENTOS_POR_PAGINA;
      origenFichaCliente = 'clientes';
      renderClienteDetalle(Number(fila.dataset.id));
    };
    fila.addEventListener('click', abrirFicha);
    fila.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') abrirFicha();
    });
  });

}

// Sugiere el código del próximo cliente: el número más alto usado, más uno (el servidor lo vuelve a calcular).
function siguienteCodigoCliente(clientes) {
  const numeros = clientes.map((c) => Number(String(c.codigo || '').trim())).filter((n) => Number.isInteger(n) && n > 0);
  return String((numeros.length ? Math.max(...numeros) : 0) + 1);
}

const CONDICIONES_IVA = ['Consumidor final', 'Monotributista', 'Responsable inscripto'];

function opcionesCondicionIvaHtml(actual) {
  return `<option value="">Sin especificar</option>${CONDICIONES_IVA.map((c) => `<option ${c === actual ? 'selected' : ''}>${c}</option>`).join('')}`;
}

// Clientes activos según "Ver" (todos / solo con deuda / sin comprar hace más de 30 días).
function filtrarClientes(lista, ultimaCompraPorCliente) {
  if (mostrarClientes === 'deuda') return lista.filter((c) => c.saldo > 0);
  if (mostrarClientes === 'inactivos') {
    const limite = Date.now() - DIAS_CLIENTE_INACTIVO * 86400000;
    return lista.filter((c) => ultimaCompraPorCliente[c.id] && new Date(ultimaCompraPorCliente[c.id]).getTime() < limite);
  }
  return lista;
}

// Según "Ordenar"; a igual valor queda el orden alfabético que ya traen.
function ordenarClientes(lista, ultimaCompraPorCliente) {
  const copia = [...lista];
  if (ordenClientes === 'nombre') return copia.sort((a, b) => nombreCompleto(a).localeCompare(nombreCompleto(b), 'es'));
  if (ordenClientes === 'ultima') return copia.sort((a, b) => (ultimaCompraPorCliente[b.id] || '').localeCompare(ultimaCompraPorCliente[a.id] || ''));
  if (ordenClientes === 'codigo') return copia.sort((a, b) => String(a.codigo || '').localeCompare(String(b.codigo || ''), 'es', { numeric: true }));
  return copia.sort((a, b) => b.saldo - a.saldo);
}

// El saldo de un cliente: lo que debe, o "A favor $X" si tiene saldo a favor (saldo negativo).
function textoSaldoCliente(saldo) {
  return saldo < -0.005 ? `<span class="saldo-a-favor">A favor $${formatearMoneda(-saldo)}</span>` : `$${formatearMoneda(saldo)}`;
}

function filaCliente(c, mostrarUltimaCompra = false, ultimaCompraPorCliente = {}, ultimaBajoNombre = false) {
  const ultimaCompra = ultimaCompraPorCliente[c.id];
  return `
    <tr class="fila-clickeable" tabindex="0" data-id="${c.id}" data-nombre="${esc(nombreCompleto(c))}" data-busqueda="${esc(`${textoBusquedaCliente(c)} ${c.codigo || ''} ${c.cuit || ''}`)}">
      <td class="col-codigo">${esc(c.codigo || '')}</td>
      <td>${esc(nombreConNegocio(c))}${
        ultimaBajoNombre
          ? `<div class="texto-suave detalle-ultima-compra">${ultimaCompra ? `Última compra: ${new Date(ultimaCompra).toLocaleDateString('es-AR')}` : 'Todavía no compró'}</div>`
          : ''
      }</td>
      <td>${
        mostrarUltimaCompra
          ? ultimaCompra
            ? new Date(ultimaCompra).toLocaleDateString('es-AR')
            : '<span class="texto-suave">Sin compras</span>'
          : textoSaldoCliente(c.saldo)
      }</td>
    </tr>`;
}

async function renderClienteDetalle(id) {
  await vendedoresParaElegir();
  const [clientes, historial, historialPagos, notasCredito, cobrosAnulados] = await Promise.all([
    window.freska.clientes.listar(),
    window.freska.clientes.historial(id),
    window.freska.clientes.historialPagos(id),
    window.freska.clientes.notasCredito(id),
    window.freska.clientes.cobrosAnulados(id),
  ]);
  const cliente = clientes.find((c) => c.id === id);
  if (!cliente) return renderClientes();

  const movimientos = [];
  // Una nota de crédito (factura anulada que tenía pagos) deja saldo a favor: baja el saldo como un recibo.
  notasCredito
    .filter((n) => n.credito > 0)
    .forEach((n) => movimientos.push({ tipo: 'nota_credito', fecha: n.fecha, id: n.id, monto: n.credito, factura_id: n.factura_id, devuelto: n.devuelto }));
  historial
    .filter((f) => f.estado !== 'anulada')
    .forEach((f) => {
      movimientos.push({ tipo: 'factura', fecha: f.fecha, id: f.id, monto: f.total, pagado: f.pagado });
    });
  // Un cobro anulado ya no cuenta en el saldo: queda como renglón informativo (gris, tachado) con su motivo.
  cobrosAnulados.forEach((c) =>
    movimientos.push({
      tipo: 'cobro_anulado',
      fecha: c.fecha,
      id: c.id,
      monto: c.monto,
      metodo: c.metodo,
      facturas: c.facturas,
      motivo: c.motivo,
      reactivado_en: c.reactivado_en,
      reactivable: !!c.reactivable,
      anulado_por_nombre: c.anulado_por_rol !== 'admin' ? c.anulado_por_nombre : null,
    })
  );
  historialPagos.forEach((p) => {
    movimientos.push({
      tipo: 'recibo',
      fecha: p.fecha,
      id: p.id,
      monto: p.monto,
      metodo: p.metodo_pago,
      factura_id: p.factura_id,
      creado_por_nombre: p.creado_por_rol !== 'admin' ? p.creado_por_nombre : null,
    });
  });
  movimientos.sort((a, b) => {
    const diff = new Date(a.fecha) - new Date(b.fecha);
    if (diff !== 0) return diff;
    return a.tipo === 'factura' ? -1 : 1;
  });
  // Un cobro repartido entre varias facturas (o pagado con más de un método) queda anotado por partes.
  // En el historial se junta en un solo recibo por cobro (mismo minuto); el desglose se ve al desplegarlo.
  const movimientosAgrupados = [];
  movimientos.forEach((m) => {
    const anterior = movimientosAgrupados[movimientosAgrupados.length - 1];
    const claveMinuto = String(m.fecha).slice(0, 16);
    if (m.tipo === 'recibo' && anterior && anterior.tipo === 'recibo' && anterior.claveMinuto === claveMinuto) {
      anterior.monto = redondearPesos(anterior.monto + m.monto);
      anterior.partes.push({ id: m.id, factura_id: m.factura_id, metodo: m.metodo, monto: m.monto });
    } else if (m.tipo === 'recibo') {
      movimientosAgrupados.push({
        tipo: 'recibo',
        fecha: m.fecha,
        id: m.id,
        claveMinuto,
        monto: m.monto,
        creado_por_nombre: m.creado_por_nombre,
        partes: [{ id: m.id, factura_id: m.factura_id, metodo: m.metodo, monto: m.monto }],
      });
    } else {
      movimientosAgrupados.push(m);
    }
  });
  // Dentro de un recibo, las partes van de lo más antiguo a lo más nuevo (el orden en que se cubrieron).
  movimientosAgrupados.forEach((m) => {
    // La parte sin factura (el saldo anterior) va primero: es la deuda más vieja y es lo primero que baja un cobro.
    if (m.partes) m.partes.sort((a, b) => (a.factura_id ?? -Infinity) === (b.factura_id ?? -Infinity) ? 0 : (a.factura_id ?? -Infinity) < (b.factura_id ?? -Infinity) ? -1 : 1);
  });
  movimientos.length = 0;
  movimientos.push(...movimientosAgrupados);
  // El saldo inicial cargado a mano no es una factura ni un cobro, pero es de donde parte la cuenta: va primero,
  // para que la columna Saldo coincida con lo que debe de verdad.
  if (cliente.saldo_inicial) movimientos.unshift({ tipo: 'saldo_inicial', monto: cliente.saldo_inicial });
  let saldoAcumulado = 0;
  movimientos.forEach((m) => {
    if (m.tipo !== 'cobro_anulado') saldoAcumulado = redondearPesos(saldoAcumulado + (m.tipo === 'factura' || m.tipo === 'saldo_inicial' ? m.monto : -m.monto));
    m.saldo = saldoAcumulado;
  });
  movimientos.reverse();
  const movimientosVisibles = movimientos.slice(0, limiteHistorialFicha);
  const movimientosOcultos = movimientos.length - movimientosVisibles.length;

  app.innerHTML = `
    <button id="btn-volver-clientes" class="btn-volver" type="button">&larr; Volver a ${origenFichaCliente === 'cobros' ? 'cobros' : origenFichaCliente === 'estadisticas' ? 'estadísticas' : 'clientes'}</button>
    <div class="ficha-cliente-header">
      <h2 id="titulo-ficha-cliente" class="titulo-colapsable">
        ${esc(nombreConNegocio(cliente))}
        <span class="icono-colapsar ${mostrarDatosFichaCliente ? 'abierto' : ''}">▾</span>
      </h2>
      <div class="ficha-cliente-estado">
        ${cliente.saldo > 0 ? `<span class="badge badge-pendiente">Debe $${formatearMoneda(cliente.saldo)}</span>` : ''}
        ${cliente.saldo < -0.005 ? `<span class="badge badge-pagada">A favor $${formatearMoneda(-cliente.saldo)}</span>` : ''}
        ${
          !clienteActivo(cliente)
            ? '<span class="badge badge-baja">Dado de baja</span><button type="button" id="btn-alta-cliente" class="primary">Dar de alta</button>'
            : ''
        }
      </div>
    </div>
    ${mostrarDatosFichaCliente ? `<div class="panel" id="ficha-cliente">${vistaFichaCliente(cliente, historial.length > 0 && clienteActivo(cliente))}</div>` : ''}

    <h2>Historial</h2>
    <table>
      <thead><tr><th>Fecha</th><th>Tipo</th><th>Comprobante</th><th>Monto</th><th>Saldo</th></tr></thead>
      <tbody id="cuenta-corriente-body">
        ${
          movimientos.length === 0
            ? '<tr><td colspan="5">Todavía no hay movimientos.</td></tr>'
            : movimientosVisibles
                .map((m) => {
                  if (m.tipo === 'factura') {
                    return `
          <tr class="fila-clickeable fila-factura-historial" tabindex="0" data-id="${m.id}">
            <td><span class="icono-fila">▾</span>${new Date(m.fecha).toLocaleDateString('es-AR')}</td>
            <td>Factura</td>
            <td>N° ${m.id}</td>
            <td>$${formatearMoneda(m.monto)}</td>
            <td>${textoSaldoCliente(m.saldo)}</td>
          </tr>
          <tr class="items-pedido-fila" data-items-de="${m.id}" style="display:none">
            <td colspan="5"></td>
          </tr>`;
                  }
                  if (m.tipo === 'saldo_inicial') {
                    return `
          <tr>
            <td></td>
            <td>Saldo anterior</td>
            <td>Saldo inicial cargado a mano</td>
            <td>${m.monto < 0 ? `<span class="monto-negativo">$${formatearMoneda(-m.monto)}</span>` : `$${formatearMoneda(m.monto)}`}</td>
            <td>${textoSaldoCliente(m.saldo)}</td>
          </tr>`;
                  }
                  if (m.tipo === 'cobro_anulado') {
                    return `
          <tr class="fila-anulada">
            <td>${new Date(m.fecha).toLocaleDateString('es-AR')}</td>
            <td>Cobro anulado</td>
            <td>${esc(m.metodo || '')}${m.facturas ? ` · factura${String(m.facturas).includes(',') ? 's' : ''} N° ${esc(String(m.facturas).split(',').join(', '))}` : ''}${m.motivo ? ` · Motivo: ${esc(m.motivo)}` : ''}${m.anulado_por_nombre ? ` · Anulado por ${esc(m.anulado_por_nombre)}` : ''}</td>
            <td>$${formatearMoneda(m.monto)}</td>
            <td>${
              m.reactivado_en
                ? `<span class="texto-suave">Se reactivó el ${fechaLegible(m.reactivado_en)}</span>`
                : m.reactivable
                  ? `<button type="button" class="enlace-boton enlace-peligro reactivar-cobro" data-id="${m.id}">Reactivar</button>`
                  : ''
            }</td>
          </tr>`;
                  }
                  if (m.tipo === 'nota_credito') {
                    return `
          <tr>
            <td>${new Date(m.fecha).toLocaleDateString('es-AR')}</td>
            <td>Nota de crédito</td>
            <td>Anulación de la factura N° ${m.factura_id}${m.devuelto > 0 ? ` (se devolvieron $${formatearMoneda(m.devuelto)})` : ''}</td>
            <td><span class="monto-negativo">$${formatearMoneda(m.monto)}</span></td>
            <td>${textoSaldoCliente(m.saldo)}</td>
          </tr>`;
                  }
                  const facturasRecibo = [...new Set(m.partes.map((x) => x.factura_id))];
                  const metodosRecibo = [...new Set(m.partes.map((x) => x.metodo).filter(Boolean))];
                  return `
          <tr class="fila-clickeable fila-recibo-historial" tabindex="0" data-recibo="${m.id}">
            <td><span class="icono-fila">▾</span>${new Date(m.fecha).toLocaleDateString('es-AR')}</td>
            <td>Recibo</td>
            <td>${textoFacturasCobro(facturasRecibo)}${metodosRecibo.length ? ` — ${esc(metodosRecibo.length > 1 ? `${metodosRecibo.slice(0, -1).join(', ')} y ${metodosRecibo[metodosRecibo.length - 1]}` : metodosRecibo[0])}` : ''}${m.creado_por_nombre ? ` · Cargado por ${esc(m.creado_por_nombre)}` : ''}</td>
            <td><span class="monto-negativo">$${formatearMoneda(m.monto)}</span></td>
            <td>${textoSaldoCliente(m.saldo)}</td>
          </tr>
          <tr class="items-pedido-fila" data-recibo-de="${m.id}" style="display:none">
            <td colspan="5">
              <table class="factura-impresion-tabla items-factura-tabla">
                <tbody>
                  ${m.partes
                    .map(
                      (x) => `<tr>
                    <td class="col-recibo-factura">${x.factura_id == null ? 'Saldo anterior' : `Factura N° ${x.factura_id}`}</td>
                    <td class="col-descripcion">${esc(x.metodo || '')}${puedeCambiarseElMetodo(x) ? ` <button type="button" class="enlace-boton cambiar-metodo-cobro" data-ids="${m.partes.filter((y) => y.metodo === x.metodo && puedeCambiarseElMetodo(y)).map((y) => y.id).join(',')}" data-metodo="${esc(x.metodo)}" title="Corregir con qué se pagó">Cambiar</button>` : ''}</td>
                    <td class="col-importe">$${formatearMoneda(x.monto)}</td>
                  </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
              ${m.partes.every((y) => puedeCambiarseElMetodo(y)) ? `<p class="anular-cobro-linea"><button type="button" class="enlace-boton enlace-peligro anular-cobro-cliente" data-ids="${m.partes.map((y) => y.id).join(',')}" data-monto="${m.monto}" data-metodo="${esc([...new Set(m.partes.map((y) => y.metodo))].join(' y '))}">Anular cobro</button></p>` : ''}
            </td>
          </tr>`;
                })
                .join('')
        }
      </tbody>
    </table>
    ${
      movimientosOcultos > 0
        ? `<p style="text-align:center; margin-top:16px;"><button type="button" id="btn-ver-mas-historial">Ver más antiguos (${movimientosOcultos})</button></p>`
        : ''
    }
  `;

  const btnVerMasHistorial = document.getElementById('btn-ver-mas-historial');
  if (btnVerMasHistorial) {
    btnVerMasHistorial.addEventListener('click', () => {
      limiteHistorialFicha += MOVIMIENTOS_POR_PAGINA;
      renderClienteDetalle(cliente.id);
    });
  }

  document.getElementById('btn-volver-clientes').addEventListener('click', () => {
    if (origenFichaCliente === 'cobros') {
      renderCobros();
    } else if (origenFichaCliente === 'estadisticas') {
      irAVista(botonDeVista('estadisticas'));
    } else {
      renderClientes();
    }
  });

  const btnAlta = document.getElementById('btn-alta-cliente');
  if (btnAlta) btnAlta.addEventListener('click', () => darDeAltaCliente(cliente));

  document.getElementById('titulo-ficha-cliente').addEventListener('click', async () => {
    mostrarDatosFichaCliente = !mostrarDatosFichaCliente;
    await renderClienteDetalle(cliente.id);
    document.getElementById('titulo-ficha-cliente')?.focus();
  });

  if (mostrarDatosFichaCliente) {
    vincularFichaCliente(cliente, historial.length === 0);
  }

  // "Cambiar": corrige con qué método se pagó (por ejemplo, se cargó efectivo y era Mercado Pago). Cambia todas las
  // partes de ese recibo que tenían el mismo método.
  app.querySelectorAll('.anular-cobro-cliente').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      abrirAnularCobro({ ids: btn.dataset.ids.split(',').map(Number), monto: Number(btn.dataset.monto), metodo: btn.dataset.metodo }, () => renderClienteDetalle(cliente.id));
    });
  });
  // "Reactivar": deshace la anulación de un cobro (vuelve a estar cobrado, tal cual estaba antes).
  app.querySelectorAll('.reactivar-cobro').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Reactivar cobro</h3>
        <p>Vuelve a quedar como estaba antes de anularlo: se recrea el cobro y la factura vuelve a estar pagada (o parcial, según corresponda).</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary">Sí, reactivar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        const resultado = await window.freska.pagos.reactivarCobro(Number(btn.dataset.id));
        cerrarModal();
        if (resultado.ok === false) {
          mostrarToast(resultado.error, 'error');
          return;
        }
        mostrarToast('Cobro reactivado.', 'ok');
        renderClienteDetalle(cliente.id);
      });
    });
  });
  app.querySelectorAll('.cambiar-metodo-cobro').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      abrirCambioMetodoCobro(btn.dataset.ids.split(',').map(Number), btn.dataset.metodo, () => renderClienteDetalle(cliente.id));
    });
  });

  // Los recibos vienen cerrados; al tocar uno (o Enter) se ve a qué facturas se aplicó cada parte.
  app.querySelectorAll('tr.fila-recibo-historial').forEach((fila) => {
    const alternarRecibo = () => {
      const detalle = app.querySelector(`tr[data-recibo-de="${fila.dataset.recibo}"]`);
      const abrir = detalle.style.display === 'none';
      detalle.style.display = abrir ? '' : 'none';
      fila.querySelector('.icono-fila').classList.toggle('abierto', abrir);
      if (abrir) alinearDetalleFactura(detalle);
    };
    fila.addEventListener('click', alternarRecibo);
    fila.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') alternarRecibo();
    });
  });

  app.querySelectorAll('tr.fila-factura-historial').forEach((fila) => {
    const alternarDetalle = async () => {
      const facturaId = Number(fila.dataset.id);
      const filaItems = app.querySelector(`.items-pedido-fila[data-items-de="${facturaId}"]`);
      const icono = fila.querySelector('.icono-fila');
      if (filaItems.style.display !== 'none') {
        filaItems.style.display = 'none';
        icono.classList.remove('abierto');
        return;
      }
      const items = await window.freska.facturas.items(facturaId);
      const movimiento = movimientos.find((m) => m.tipo === 'factura' && m.id === facturaId);
      filaItems.querySelector('td').innerHTML = itemsFacturaListaHtml(items, movimiento ? { total: movimiento.monto, pagado: movimiento.pagado, saldoCliente: cliente.saldo } : {});
      filaItems.style.display = '';
      alinearDetalleFactura(filaItems);
      icono.classList.add('abierto');
    };
    fila.addEventListener('click', alternarDetalle);
    fila.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') alternarDetalle();
    });
  });
}

// Corregir con qué se pagó un cobro (los `ids` son las filas de pago que se cambian juntas).
// Anular un cobro que se cargó por error: las facturas vuelven a quedar con deuda y el saldo del cliente sube lo mismo.
function abrirAnularCobro({ ids, monto, metodo }, alTerminar) {
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Anular cobro</h3>
    <p>¿Seguro que querés anular este cobro de <strong>$${formatearMoneda(monto)}</strong> (${esc(metodo)})?</p>
    <p class="pin-subtitulo">Las facturas que había pagado vuelven a quedar con deuda, el saldo del cliente sube $${formatearMoneda(monto)} y la plata sale de la cuenta donde había entrado. Si te equivocás, después lo podés "Reactivar" desde acá mismo.</p>
    <label class="op-campo op-completo campo-motivo-anulacion"><span>Motivo${sesionActual && sesionActual.rol === 'empleado' ? '' : ' (opcional)'}</span><input type="text" id="motivo-anulacion-cobro" maxlength="200" autocomplete="off" /></label>
    <p id="modal-error" class="error-msg" style="display:none"></p>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, anular cobro</button>
    </div>
  `);
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    const r = await window.freska.pagos.anular({ ids, motivo: document.getElementById('motivo-anulacion-cobro').value.trim() });
    if (!r.ok) {
      const e = document.getElementById('modal-error');
      e.textContent = r.error;
      e.style.display = '';
      return;
    }
    cerrarModal();
    mostrarToast('Cobro anulado.', 'ok');
    alTerminar();
  });
}

async function abrirCambioMetodoCobro(ids, metodoActual, alTerminar) {
  const metodos = (await window.freska.metodosPago.listar()).filter((m) => !/^(cheque|saldo a favor)$/i.test(m.nombre.trim()) && m.nombre !== metodoActual);
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Corregir cómo se pagó</h3>
    <p>Se cargó como <strong>${esc(metodoActual)}</strong>. ¿Con qué se pagó realmente?</p>
    <div class="cambio-metodo-fila">
      <label class="op-campo campo-cambio-metodo"><span>Pagó con</span><select id="nuevo-metodo-cobro">${metodos.map((m) => `<option>${esc(m.nombre)}</option>`).join('')}</select></label>
      <button type="button" id="modal-confirmar" class="primary">Cambiar</button>
    </div>
    <label class="op-campo campo-cambio-metodo campo-motivo-cambio"><span>Motivo</span><input type="text" id="motivo-cambio-metodo" maxlength="200" autocomplete="off" /></label>
    <p id="modal-error" class="error-msg" style="display:none"></p>
  `);
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    const r = await window.freska.pagos.cambiarMetodo({ ids, metodo_pago: document.getElementById('nuevo-metodo-cobro').value, motivo: document.getElementById('motivo-cambio-metodo').value.trim() });
    if (!r.ok) {
      const err = document.getElementById('modal-error');
      err.textContent = r.error;
      err.style.display = '';
      return;
    }
    cerrarModal();
    mostrarToast('Listo: el cobro quedó con el método corregido.', 'ok');
    alTerminar();
  });
}

// Un cobro con cheque, con saldo a favor o una devolución no se puede corregir de método.
function puedeCambiarseElMetodo(parte) {
  return parte.monto > 0 && !/^(cheque|saldo a favor)$/i.test(String(parte.metodo || '').trim());
}

function vistaFichaCliente(cliente, puedeDarDeBaja) {
  return `
    <p><strong>Código:</strong> ${esc(cliente.codigo || '—')}</p>
    <p><strong>Negocio:</strong> ${esc(cliente.negocio || 'No cargado')}</p>
    <p><strong>Teléfono WhatsApp:</strong> ${esc(cliente.telefono || 'No cargado')}</p>
    <p><strong>Teléfono fijo:</strong> ${esc(cliente.telefono_fijo || 'No cargado')}</p>
    ${puedeAsignarVendedor() ? `<p><strong>Vendedor:</strong> ${esc((vendedoresCache.find((v) => v.id === cliente.vendedor_id) || {}).nombre || 'Sin vendedor (del dueño)')}</p>` : ''}
    ${cliente.telefono2 ? `<p><strong>Segundo WhatsApp${cliente.telefono2_nombre ? ` (${esc(cliente.telefono2_nombre)})` : ''}:</strong> ${esc(cliente.telefono2)}</p>` : ''}
    <p><strong>Domicilio:</strong> ${esc(cliente.domicilio || 'No cargado')}</p>
    <p><strong>Condición frente al IVA:</strong> ${esc(cliente.condicion_iva || 'No cargada')}</p>
    <p><strong>CUIT:</strong> ${esc(cliente.cuit || 'No cargado')}</p>
    <p><strong>Nota:</strong> ${esc(cliente.nota || 'Sin nota')}</p>
    ${cliente.saldo_inicial ? `<p><strong>Saldo inicial:</strong> $${formatearMoneda(cliente.saldo_inicial)}</p>` : ''}
    <p><strong>${cliente.saldo < -0.005 ? 'Saldo a favor' : 'Saldo pendiente'}:</strong> $${formatearMoneda(Math.abs(cliente.saldo))}</p>
    <div class="btn-group">
      <button class="editar-ficha-cliente" type="button">Editar</button>
      ${puedeDarDeBaja ? '<button class="btn-baja-cliente" type="button">Dar de baja</button>' : ''}
    </div>
  `;
}

async function abrirRegistroPagoCliente(cliente, alConfirmar) {
  const metodos = await window.freska.metodosPago.listar();

  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Registrar pago</h3>
    <p>${esc(nombreCompleto(cliente))} debe <strong>$${formatearMoneda(cliente.saldo)}</strong>.</p>
    ${editorLineasPagoHtml(metodos, formatearMoneda(cliente.saldo))}
    <p id="error-pago-cliente" class="error-msg" style="display:none"></p>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary">Confirmar</button>
    </div>
  `);

  const modalCard = document.querySelector('.modal-card');
  vincularEditorLineasPago(modalCard, metodos, cliente.saldo);

  const primerMonto = modalCard.querySelector('.monto-pago');
  primerMonto.focus();
  primerMonto.select();

  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    const lineas = leerLineasPago(modalCard);
    const error = document.getElementById('error-pago-cliente');
    if (lineas.length === 0) {
      error.textContent = 'Ingresá un monto válido.';
      error.style.display = '';
      return;
    }
    const totalIngresado = lineas.reduce((acc, l) => acc + l.monto, 0);
    if (totalIngresado > cliente.saldo + 0.01) {
      error.textContent = `Ese monto es mayor a lo que debe (le queda pendiente $${formatearMoneda(cliente.saldo)}).`;
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
      const resultado = await window.freska.clientes.registrarPagoGeneral({
        cliente_id: cliente.id,
        monto: l.monto,
        metodo_pago: l.metodo_pago,
        cheque: l.cheque,
      });
      if (resultado.ok === false) {
        error.textContent = resultado.error;
        error.style.display = '';
        return;
      }
    }
    cerrarModal();
    mostrarToast('Pago registrado.', 'ok');
    alConfirmar();
  });
}

function confirmarBorrarCliente(cliente) {
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Borrar cliente</h3>
    <p>¿Borrar a <strong>${esc(nombreCompleto(cliente))}</strong>? Esta acción no se puede deshacer.</p>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, borrar</button>
    </div>
  `);

  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    const resultado = await window.freska.clientes.eliminar(cliente.id);
    if (resultado.ok === false) {
      mostrarModal(`${MODAL_X_HTML}
        <h3>No se pudo borrar</h3>
        <p class="error-msg">${esc(resultado.error)}</p>
      `);
      document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
      return;
    }
    cerrarModal();
    mostrarToast('Cliente borrado.', 'ok');
    renderClientes();
  });
}

function confirmarBajaCliente(cliente) {
  if (cliente.saldo > 0.005) {
    mostrarModal(`${MODAL_X_HTML}
      <h3>No se puede dar de baja</h3>
      <p class="error-msg">${esc(nombreCompleto(cliente))} todavía debe $${formatearMoneda(cliente.saldo)}. Primero hay que saldar la cuenta (Cobros), así el saldo no queda escondido.</p>
    `);
    document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
    return;
  }
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Dar de baja</h3>
    <p>¿Dar de baja a <strong>${esc(nombreCompleto(cliente))}</strong>? Deja de aparecer en la lista de clientes y en los buscadores de pedidos y facturas. Su historial se conserva y lo podés dar de alta de nuevo desde la pestaña "Dados de baja" de Clientes.</p>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, dar de baja</button>
    </div>
  `);
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    const resultado = await window.freska.clientes.darDeBaja(cliente.id);
    if (resultado.ok === false) {
      mostrarModal(`${MODAL_X_HTML}
        <h3>No se pudo dar de baja</h3>
        <p class="error-msg">${esc(resultado.error)}</p>
      `);
      document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
      return;
    }
    cerrarModal();
    mostrarToast('Cliente dado de baja.', 'ok');
    renderClientes();
  });
}

async function darDeAltaCliente(cliente) {
  await window.freska.clientes.darDeAlta(cliente.id);
  mostrarToast('Cliente dado de alta.', 'ok');
  renderClienteDetalle(cliente.id);
}

function vincularFichaCliente(cliente, puedeBorrar) {
  const ficha = document.getElementById('ficha-cliente');

  const btnBaja = ficha.querySelector('.btn-baja-cliente');
  if (btnBaja) btnBaja.addEventListener('click', () => confirmarBajaCliente(cliente));

  function mostrarFormularioEdicion(error) {
    ficha.innerHTML = `
      <div class="panel gasto-form">
        ${error ? `<p class="error-msg">${esc(error)}</p>` : ''}
        <div class="gasto-fila">
          <label class="gasto-campo campo-codigo-cliente"><span>Código</span><input type="text" class="edit-codigo-cliente" maxlength="20" value="${esc(cliente.codigo || '')}" /></label>
          <label class="gasto-campo"><span>Nombre</span><input type="text" class="edit-nombre" value="${esc(cliente.nombre)}" /></label>
          <label class="gasto-campo"><span>Apellido (opcional)</span><input type="text" class="edit-apellido" value="${esc(cliente.apellido || '')}" /></label>
          <label class="gasto-campo"><span>Negocio (opcional)</span><input type="text" class="edit-negocio" maxlength="80" value="${esc(cliente.negocio || '')}" /></label>
        </div>
        <div class="gasto-fila">
          <label class="gasto-campo"><span>Teléfono WhatsApp</span><input type="tel" class="edit-telefono" placeholder="3511234567 (sin 0 ni 15)" value="${esc(cliente.telefono || '')}" /></label>
          <label class="gasto-campo"><span>Teléfono fijo (opcional)</span><input type="tel" class="edit-telefono-fijo" value="${esc(cliente.telefono_fijo || '')}" /></label>
          <label class="gasto-campo gasto-campo-observacion"><span>Domicilio</span><input type="text" class="edit-domicilio" value="${esc(cliente.domicilio || '')}" /></label>
        </div>
        <div class="gasto-fila">
          <label class="gasto-campo"><span>Segundo WhatsApp (opcional)</span><input type="tel" class="edit-telefono2" value="${esc(cliente.telefono2 || '')}" /></label>
          <label class="gasto-campo"><span>Nombre de quién es (opcional)</span><input type="text" class="edit-telefono2-nombre" maxlength="40" placeholder="Ej: Juan (el otro dueño)" value="${esc(cliente.telefono2_nombre || '')}" /></label>
          <label class="gasto-campo"><span>Saldo inicial (opcional)</span><div class="input-moneda"><span>$</span><input type="text" class="edit-saldo-inicial monto-pago" inputmode="decimal" autocomplete="off" value="${esc(cliente.saldo_inicial ? formatearMoneda(cliente.saldo_inicial) : '')}" /></div></label>
        </div>
        <div class="gasto-fila">
          <label class="gasto-campo campo-condicion-iva-cliente"><span>Condición frente al IVA (opcional)</span><select class="edit-condicion-iva">${opcionesCondicionIvaHtml(cliente.condicion_iva || '')}</select></label>
          <label class="gasto-campo campo-cuit-cliente"><span>CUIT (opcional)</span><input type="text" class="edit-cuit" inputmode="numeric" maxlength="13" placeholder="20-12345678-9" value="${esc(cliente.cuit || '')}" /></label>
          <label class="gasto-campo gasto-campo-observacion"><span>Nota (opcional)</span><input type="text" class="edit-nota" value="${esc(cliente.nota || '')}" /></label>
        </div>
        ${
          puedeAsignarVendedor()
            ? `<div class="gasto-fila">
          <label class="gasto-campo"><span>Vendedor (opcional)</span><select class="edit-vendedor">${opcionesVendedorHtml(vendedoresCache, cliente.vendedor_id)}</select></label>
        </div>`
            : ''
        }
        <div class="ficha-cliente-acciones">
          <button class="primary guardar-ficha-cliente" type="button">Guardar</button>
          <button class="cancelar-ficha-cliente" type="button">Cancelar</button>
          ${
            puedeBorrar
              ? '<button class="btn-borrar-cliente-directo" type="button">Borrar cliente</button>'
              : ''
          }
        </div>
      </div>
    `;

    const btnBorrar = ficha.querySelector('.btn-borrar-cliente-directo');
    if (btnBorrar) btnBorrar.addEventListener('click', () => confirmarBorrarCliente(cliente));
    guardarConEnter(ficha, '.guardar-ficha-cliente');
    vincularFormatoMoneda(ficha.querySelector('.edit-saldo-inicial'));
    ficha.querySelector('input')?.focus();

    ficha.querySelector('.guardar-ficha-cliente').addEventListener('click', async () => {
      const nombre = ficha.querySelector('.edit-nombre').value.trim();
      const apellido = ficha.querySelector('.edit-apellido').value.trim();
      const telefono = ficha.querySelector('.edit-telefono').value.trim();
      const telefono_fijo = ficha.querySelector('.edit-telefono-fijo').value.trim();
      const telefono2 = ficha.querySelector('.edit-telefono2').value.trim();
      const telefono2_nombre = ficha.querySelector('.edit-telefono2-nombre').value.trim();
      const domicilio = ficha.querySelector('.edit-domicilio').value.trim();
      const nota = ficha.querySelector('.edit-nota').value.trim();
      const negocio = ficha.querySelector('.edit-negocio').value.trim();
      const saldoInicialTexto = ficha.querySelector('.edit-saldo-inicial').value.trim();
      if (!nombre) return;
      const resultado = await window.freska.clientes.actualizar({
        id: cliente.id,
        nombre,
        apellido,
        telefono,
        telefono_fijo,
        telefono2,
        telefono2_nombre,
        domicilio,
        nota,
        negocio,
        codigo: ficha.querySelector('.edit-codigo-cliente').value.trim(),
        condicion_iva: ficha.querySelector('.edit-condicion-iva').value,
        cuit: ficha.querySelector('.edit-cuit').value.trim(),
        saldo_inicial: saldoInicialTexto === '' ? 0 : limpiarNumeroMoneda(saldoInicialTexto),
        // Si no hay desplegable (empleado, o todavía no hay vendedores), no se manda: queda el que tenía.
        ...(ficha.querySelector('.edit-vendedor') ? { vendedor_id: ficha.querySelector('.edit-vendedor').value || null } : {}),
      });
      if (resultado.ok === false) {
        mostrarFormularioEdicion(resultado.error);
        return;
      }
      mostrarToast('Cliente guardado.', 'ok');
      renderClienteDetalle(cliente.id);
    });

    ficha.querySelector('.cancelar-ficha-cliente').addEventListener('click', () => {
      renderClienteDetalle(cliente.id);
    });
  }

  ficha.querySelector('.editar-ficha-cliente').addEventListener('click', () => {
    mostrarFormularioEdicion();
  });

}
