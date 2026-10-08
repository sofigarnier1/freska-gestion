// Vendedores: quiénes cobran comisión por lo que venden y el informe de un período (por defecto, el mes en curso) (solo el administrador).
// Los scripts comparten el espacio global (ver index.html): no hace falta importar nada.

// Período del informe (por defecto, el mes en curso). Se elige con el mismo selector de rango que el resto de la app.
let desdeInformeVendedores = primerDiaDelMes(new Date().getFullYear(), new Date().getMonth());
let hastaInformeVendedores = ultimoDiaDelMes(new Date().getFullYear(), new Date().getMonth());
let formVendedor = null; // null = cerrado | {} = alta | vendedor = edición
let errorFormVendedor = null;

// Cuántas facturas anuladas y pagos de comisión se muestran por vendedor (para que un mes con mucho movimiento
// no quede como una lista larga sin fin, 2026-09-28): igual criterio que el historial de un cliente, con
// "Ver más". La clave es el id del vendedor (o 'sinVendedor' para el bloque del dueño); se reinicia al cambiar
// de mes o volver a entrar a la pantalla.
const FILAS_POR_PAGINA_VENDEDOR = 10;
let limitesAnuladasVendedor = {};
let limitesPagosVendedor = {};

// Para el campo "Vendedor" de un cliente: solo el administrador puede pedirlos (a un empleado el servicio le
// contesta que no), así que para él la lista queda vacía y el campo directamente no aparece.
let vendedoresCache = [];
async function vendedoresParaElegir() {
  const lista = await window.freska.vendedores.listar();
  vendedoresCache = Array.isArray(lista) ? lista : [];
  return vendedoresCache;
}

// El campo "Vendedor" del cliente lo ve (y lo cambia) solo un administrador.
function puedeAsignarVendedor() {
  return !sesionActual || sesionActual.rol === 'admin';
}

// Un vendedor dado de baja no se ofrece para clientes nuevos, salvo que sea el que el cliente ya tiene.
function opcionesVendedorHtml(vendedores, actualId) {
  return `<option value="">Sin vendedor (del dueño)</option>${vendedores
    .filter((v) => v.activo || v.id === actualId)
    .map((v) => `<option value="${v.id}" ${v.id === actualId ? 'selected' : ''}>${v.numero} · ${esc(v.nombre)}${v.activo ? '' : ' (de baja)'}</option>`)
    .join('')}`;
}

// Cómo se nombra el período del informe: "agosto de 2026" si es un mes entero, o "el período del 01/08/2026 al 15/08/2026".
function textoPeriodoInforme(desde, hasta) {
  const mes = desde.slice(0, 7);
  if (desde.slice(8) === '01' && hasta === ultimoDiaDelMes(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1)) {
    return `${MESES_LARGO[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;
  }
  return `el período del ${formatearFechaCorta(desde)} al ${formatearFechaCorta(hasta)}`;
}

function textoPorcentaje(n) {
  return `${formatearCantidad(n)}%`;
}

// Los porcentajes que se usaron en el mes (uno solo, salvo que le hayan cambiado la comisión a mitad de mes).
function textoPorcentajesInforme(v) {
  const lista = v.porcentajesAplicados && v.porcentajesAplicados.length ? v.porcentajesAplicados : [v.porcentaje];
  return lista.map(textoPorcentaje).join(' y ');
}

function mensajeWhatsappVendedor(v, periodo) {
  const nombreMes = periodo;
  if (!v.cantidad) return `Hola ${v.nombre}! En ${nombreMes} no cobramos nada de tus clientes.`;
  return `Hola ${v.nombre}! En ${nombreMes} cobramos $${formatearMoneda(v.total)} de tus clientes (${v.cantidad} ${v.cantidad === 1 ? 'factura' : 'facturas'}) y te corresponde $${formatearMoneda(v.comision)} de comisión (${textoPorcentajesInforme(v)}).`;
}

// Cómo se ve lo pagado de la comisión: cada pago con su fecha, monto y "×" para deshacerlo, más lo que falta
// (o lo que se pagó de más, si mandó un adelanto) y el botón para registrar otro. `v` trae `pagos`, `pagado`
// y `pendiente` (del informe, ver `vendedores:informe`).
function bloqueComisionPagadaHtml(v) {
  if (!v.comision && !v.pagado) return '';
  const limite = limitesPagosVendedor[v.id] || FILAS_POR_PAGINA_VENDEDOR;
  const ocultos = v.pagos.length - limite;
  const lista = v.pagos.length
    ? `<div style="margin-top:4px;">${v.pagos
        .slice(0, limite)
        .map(
          (p) =>
            `<span class="texto-suave" style="margin-right:6px;">${fechaLegible(`${p.fecha}T12:00:00`)}: $${formatearMoneda(p.monto)}<button type="button" class="chip-retiro-x deshacer-pago-comision" data-id="${p.id}" data-vendedor="${v.id}" title="Deshacer este pago" aria-label="Deshacer este pago">×</button></span>`
        )
        .join('')}${ocultos > 0 ? `<button type="button" class="enlace-boton ver-mas-pagos-vendedor" data-id="${v.id}">Ver ${ocultos} más</button>` : ''}</div>`
    : '';
  const estado =
    v.pendiente > 0.005
      ? `Falta <strong>$${formatearMoneda(v.pendiente)}</strong> de comisión.`
      : v.pendiente < -0.005
        ? `Se le pagó <strong>$${formatearMoneda(-v.pendiente)}</strong> de más.`
        : v.pagado > 0
          ? 'Comisión pagada.'
          : '';
  return `<div style="margin-top:6px;">
    ${v.pagado > 0 ? `<span class="texto-suave">Pagado: $${formatearMoneda(v.pagado)}.</span> ` : ''}${estado}
    <button type="button" class="secondary registrar-pago-comision" data-id="${v.id}" style="padding:2px 10px;margin-left:6px;">Registrar pago</button>
    ${lista}
  </div>`;
}

function bloqueVendedorInformeHtml(titulo, datos, { whatsappId } = {}) {
  const claveAnuladas = datos.id || 'sinVendedor';
  const limiteAnuladas = limitesAnuladasVendedor[claveAnuladas] || FILAS_POR_PAGINA_VENDEDOR;
  const anuladasOcultas = datos.anuladas.length - limiteAnuladas;
  const anuladas = datos.anuladas.length
    ? `<p class="texto-anulacion" style="margin:10px 0 4px;"><strong>Facturas anuladas (no suman):</strong></p>
       ${datos.anuladas
         .slice(0, limiteAnuladas)
         .map(
           (f) =>
             `<p class="texto-anulacion" style="margin:0 0 2px;">N° ${f.id} · ${esc(fechaLegible(f.fecha))} · ${esc(f.cliente)} · $${formatearMoneda(f.total)} · ${f.motivo ? `Motivo: ${esc(f.motivo)}` : 'Sin motivo cargado'}</p>`
         )
         .join('')}${anuladasOcultas > 0 ? `<button type="button" class="enlace-boton ver-mas-anuladas-vendedor" data-id="${claveAnuladas}">Ver ${anuladasOcultas} más</button>` : ''}`
    : '';
  return `
    <div class="panel" style="margin-bottom:16px;">
      <h3 style="margin:0 0 6px;">${titulo}</h3>
      <p style="margin:0 0 10px;">
        Cobró <strong>$${formatearMoneda(datos.total)}</strong> de ${datos.cantidad} ${datos.cantidad === 1 ? 'factura' : 'facturas'}${
          datos.comision === undefined ? '' : ` · Comisión: <strong>$${formatearMoneda(datos.comision)}</strong>`
        }
        ${whatsappId ? `<button type="button" class="btn-whatsapp-fila enviar-whatsapp-vendedor" data-id="${whatsappId}" title="Enviarle el resumen por WhatsApp" aria-label="Enviarle el resumen por WhatsApp" style="vertical-align:middle;margin-left:8px;">${ICONO_WHATSAPP}</button>` : ''}
        ${datos.comision !== undefined ? bloqueComisionPagadaHtml(datos) : ''}
      </p>
      ${
        datos.clientes.length
          ? `<table class="angosto">
        <thead><tr><th>Cliente</th><th>Facturas</th><th>Total</th></tr></thead>
        <tbody>${datos.clientes.map((c) => `<tr><td>${esc(c.cliente)}</td><td>${c.facturas}</td><td>$${formatearMoneda(c.total)}</td></tr>`).join('')}</tbody>
      </table>`
          : '<p class="texto-suave" style="margin:0;">No hay ventas en este período.</p>'
      }
      ${anuladas}
    </div>`;
}

async function renderVendedores() {
  const [vendedores, informe] = await Promise.all([window.freska.vendedores.listar(), window.freska.vendedores.informe({ desde: desdeInformeVendedores, hasta: hastaInformeVendedores })]);
  const enEdicion = formVendedor && formVendedor.id ? formVendedor : null;
  const ventasDelDueno = informe.ok !== false && (informe.sinVendedor.cantidad > 0 || informe.sinVendedor.anuladas.length > 0);

  app.innerHTML = `
    <h2>Vendedores</h2>
    ${
      formVendedor
        ? `<h2 style="font-size:18px;">${enEdicion ? 'Editar vendedor' : 'Agregar vendedor'}</h2>
    <form id="form-vendedor" class="panel gasto-form">
      ${errorFormVendedor ? `<p class="error-msg">${esc(errorFormVendedor)}</p>` : ''}
      <div class="gasto-fila">
        <label class="gasto-campo campo-codigo-cliente"><span>Código</span><input type="text" id="vendedor-codigo" inputmode="numeric" maxlength="4" value="${enEdicion ? enEdicion.numero : ''}" /></label>
        <label class="gasto-campo"><span>Nombre</span><input type="text" id="vendedor-nombre" maxlength="60" required value="${esc(enEdicion ? enEdicion.nombre : '')}" /></label>
        <label class="gasto-campo"><span>WhatsApp (opcional)</span><input type="tel" id="vendedor-telefono" placeholder="3511234567 (sin 0 ni 15)" value="${esc(enEdicion ? enEdicion.telefono || '' : '')}" /></label>
        <label class="gasto-campo"><span>Comisión (%)</span><input type="text" id="vendedor-porcentaje" inputmode="decimal" autocomplete="off" value="${enEdicion ? esc(formatearCantidad(enEdicion.porcentaje)) : ''}" /></label>
      </div>
      <div class="btn-group">
        <button type="submit" class="primary">Guardar</button>
        <button type="button" id="btn-cancelar-form-vendedor">Cancelar</button>
      </div>
    </form>`
        : `<p class="pin-subtitulo" style="margin-bottom:16px;">Los que cobran comisión por lo que venden. Los clientes sin vendedor son los del dueño y no generan comisión.</p>
    <div class="lista-agregar"><button id="btn-agregar-vendedor" class="primary" type="button">+ Agregar vendedor</button></div>`
    }
    <table class="angosto">
      <thead><tr><th>Cód.</th><th>Nombre</th><th>Comisión</th><th></th></tr></thead>
      <tbody>
        ${
          vendedores.length === 0
            ? '<tr><td colspan="4">Todavía no cargaste ningún vendedor.</td></tr>'
            : vendedores
                .map(
                  (v) => `<tr${v.activo ? '' : ' class="fila-anulada"'}>
          <td>${v.numero}</td>
          <td>${esc(v.nombre)}${v.activo ? '' : ' · Dado de baja'}</td>
          <td>${textoPorcentaje(v.porcentaje)}</td>
          <td class="celda-centrada"><div class="menu-fila">
            <button class="btn-menu-fila" type="button" aria-label="Acciones de ${esc(v.nombre)}">⋮</button>
            <div class="menu-fila-lista">
              <button type="button" class="item-menu editar-vendedor" data-id="${v.id}">Editar</button>
              <button type="button" class="item-menu alternar-vendedor" data-id="${v.id}" data-activo="${v.activo ? 1 : 0}">${v.activo ? 'Dar de baja' : 'Dar de alta'}</button>
            </div>
          </div></td>
        </tr>`
                )
                .join('')
        }
      </tbody>
    </table>

    <h2 style="margin-top:28px;">Informe</h2>
    <div class="toolbar toolbar-junta">${selectorRangoHtml('rango-informe-vendedores', desdeInformeVendedores, hastaInformeVendedores)}</div>
    <p class="pin-subtitulo" style="margin-bottom:16px;">La comisión se calcula sobre lo que se cobró en el período (no sobre lo facturado): un pago cuenta el día que se cobró, con el porcentaje que tenía el vendedor ese día. Las facturas anuladas no generan comisión, se hayan cobrado o no.</p>
    ${
      informe.ok === false
        ? `<p class="error-msg">${esc(informe.error)}</p>`
        : `${informe.vendedores
            .map((v) =>
              bloqueVendedorInformeHtml(`${v.numero} · ${esc(v.nombre)} (${textoPorcentajesInforme(v)})`, v, { whatsappId: v.telefono ? v.id : null })
            )
            .join('')}${ventasDelDueno ? bloqueVendedorInformeHtml('Ventas sin vendedor (del dueño, sin comisión)', informe.sinVendedor) : ''}`
    }
  `;

  vincularMenuFila();
  vincularSelectorRango('rango-informe-vendedores', desdeInformeVendedores, hastaInformeVendedores, ({ desde, hasta }) => {
    // El informe necesita las dos fechas: si se borra una, se queda con el período que ya estaba.
    if (desde && hasta && desde <= hasta) {
      desdeInformeVendedores = desde;
      hastaInformeVendedores = hasta;
    }
    limitesAnuladasVendedor = {};
    limitesPagosVendedor = {};
    renderVendedores();
  });

  document.getElementById('btn-agregar-vendedor')?.addEventListener('click', () => {
    formVendedor = {};
    errorFormVendedor = null;
    renderVendedores();
  });
  if (formVendedor) {
    vincularFormatoCantidad(document.getElementById('vendedor-porcentaje'));
    document.getElementById('vendedor-nombre').focus();
    document.getElementById('btn-cancelar-form-vendedor').addEventListener('click', () => {
      formVendedor = null;
      errorFormVendedor = null;
      renderVendedores();
    });
    document.getElementById('form-vendedor').addEventListener('submit', async (e) => {
      e.preventDefault();
      const datos = {
        nombre: document.getElementById('vendedor-nombre').value.trim(),
        numero: Number(document.getElementById('vendedor-codigo').value.trim()),
        telefono: document.getElementById('vendedor-telefono').value.trim(),
        porcentaje: limpiarNumeroCantidad(document.getElementById('vendedor-porcentaje').value),
      };
      const r = enEdicion ? await window.freska.vendedores.actualizar({ ...datos, id: enEdicion.id }) : await window.freska.vendedores.crear(datos);
      if (r.ok === false) {
        errorFormVendedor = r.error.replace('número', 'código');
        renderVendedores();
        return;
      }
      formVendedor = null;
      errorFormVendedor = null;
      mostrarToast('Vendedor guardado.', 'ok');
      renderVendedores();
    });
  }

  app.querySelectorAll('.editar-vendedor').forEach((btn) =>
    btn.addEventListener('click', () => {
      formVendedor = vendedores.find((v) => v.id === Number(btn.dataset.id));
      errorFormVendedor = null;
      renderVendedores();
    })
  );
  app.querySelectorAll('.alternar-vendedor').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const v = vendedores.find((x) => x.id === Number(btn.dataset.id));
      const r = await window.freska.vendedores.actualizar({ ...v, activo: btn.dataset.activo !== '1' });
      if (r.ok === false) {
        mostrarToast(r.error, 'error');
        return;
      }
      renderVendedores();
    })
  );
  app.querySelectorAll('.enviar-whatsapp-vendedor').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const v = informe.vendedores.find((x) => x.id === Number(btn.dataset.id));
      const telefono = String(v.telefono || '').replace(/\D/g, '');
      await window.freska.sistema.abrirEnlace(`https://wa.me/${telefono}?text=${encodeURIComponent(mensajeWhatsappVendedor(v, textoPeriodoInforme(desdeInformeVendedores, hastaInformeVendedores)))}`);
    })
  );
  app.querySelectorAll('.ver-mas-anuladas-vendedor').forEach((btn) =>
    btn.addEventListener('click', () => {
      limitesAnuladasVendedor[btn.dataset.id] = (limitesAnuladasVendedor[btn.dataset.id] || FILAS_POR_PAGINA_VENDEDOR) + FILAS_POR_PAGINA_VENDEDOR;
      renderVendedores();
    })
  );
  app.querySelectorAll('.ver-mas-pagos-vendedor').forEach((btn) =>
    btn.addEventListener('click', () => {
      limitesPagosVendedor[btn.dataset.id] = (limitesPagosVendedor[btn.dataset.id] || FILAS_POR_PAGINA_VENDEDOR) + FILAS_POR_PAGINA_VENDEDOR;
      renderVendedores();
    })
  );
  app.querySelectorAll('.registrar-pago-comision').forEach((btn) =>
    btn.addEventListener('click', () => {
      const v = informe.vendedores.find((x) => x.id === Number(btn.dataset.id));
      abrirRegistrarPagoComision(v);
    })
  );
  app.querySelectorAll('.deshacer-pago-comision').forEach((btn) =>
    btn.addEventListener('click', () => {
      const v = informe.vendedores.find((x) => x.id === Number(btn.dataset.vendedor));
      const pago = v.pagos.find((p) => p.id === Number(btn.dataset.id));
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Deshacer pago</h3>
        <p>¿Sacar el gasto de <strong>$${formatearMoneda(pago.monto)}</strong> del ${fechaLegible(`${pago.fecha}T12:00:00`)} que se cargó por la comisión de ${esc(v.nombre)}? Se puede volver a cargar después.</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, deshacer</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        await window.freska.vendedores.deshacerPagoComision({ id: pago.id });
        cerrarModal();
        mostrarToast('Se sacó el gasto de ese pago.', 'ok');
        renderVendedores();
      });
    })
  );
}

// Registrar un pago (total o parcial) de la comisión de un vendedor: se carga como gasto (categoría "Comisiones
// de vendedores"), como al registrar el cobro de una factura, pero acá además hay que elegir la fecha (de eso
// depende en qué período queda el pago: no tiene por qué ser el que se está mirando). Con transferencia o débito
// pide de qué cuenta salió, como el resto de los gastos (`cuentas.resumen`, igual que en gastos.js).
async function abrirRegistrarPagoComision(v) {
  const resumenCuentas = await window.freska.cuentas.resumen();
  const cuentasBanco = resumenCuentas.cuentas.filter((cu) => !/^efectivo$/i.test(cu.nombre.trim())).map((cu) => cu.nombre);
  let fecha = fechaHoyISO();
  const medios = ['Efectivo', 'Transferencia', 'Débito'];
  const sugerido = v.pendiente > 0.005 ? v.pendiente : v.comision;
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Registrar pago de comisión</h3>
    <p style="margin:0 0 4px;">${esc(v.nombre)} — comisión de ${textoPeriodoInforme(desdeInformeVendedores, hastaInformeVendedores)}: <strong>$${formatearMoneda(v.comision)}</strong>${v.pagado > 0 ? ` (ya pagado $${formatearMoneda(v.pagado)})` : ''}.</p>
    <div class="gasto-fila">
      <label class="gasto-campo"><span>Monto</span>
        <div class="input-moneda"><span>$</span><input type="text" inputmode="decimal" class="monto-pago" id="comision-pago-monto" value="${esc(formatearMoneda(sugerido))}" /></div>
      </label>
      <div class="gasto-campo"><span>Fecha</span>${selectorFechaHtml('comision-pago-fecha', fecha)}</div>
      <label class="gasto-campo"><span>Cómo se pagó</span>
        <select id="comision-pago-medio">${medios.map((m) => `<option>${m}</option>`).join('')}</select>
      </label>
      <label class="gasto-campo" id="comision-pago-cuenta-campo" hidden><span>De qué cuenta</span>
        <select id="comision-pago-cuenta"><option value="">Elegí una…</option>${cuentasBanco.map((n) => `<option>${esc(n)}</option>`).join('')}</select>
      </label>
    </div>
    <p id="comision-pago-aviso-mes" class="pin-subtitulo" style="display:none;margin:0 0 8px;"></p>
    <p id="modal-error" class="error-msg" style="display:none"></p>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary">Registrar pago</button>
    </div>
  `);
  vincularFormatoMoneda(document.getElementById('comision-pago-monto'));
  const avisoMes = document.getElementById('comision-pago-aviso-mes');
  const actualizarAvisoMes = () => {
    // El pago aparece en el informe que se está mirando solo si su fecha cae dentro del período elegido.
    if (fecha >= desdeInformeVendedores && fecha <= hastaInformeVendedores) {
      avisoMes.style.display = 'none';
      return;
    }
    avisoMes.textContent = `Ojo: con esta fecha, el pago no va a aparecer en el informe que estás mirando (${textoPeriodoInforme(desdeInformeVendedores, hastaInformeVendedores)}).`;
    avisoMes.style.display = 'block';
  };
  vincularSelectorFecha('comision-pago-fecha', fecha, (nueva) => {
    fecha = nueva || fechaHoyISO();
    document.getElementById('comision-pago-fecha').value = formatearFechaCorta(fecha);
    actualizarAvisoMes();
  });
  actualizarAvisoMes();
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  const selectMedio = document.getElementById('comision-pago-medio');
  const campoCuenta = document.getElementById('comision-pago-cuenta-campo');
  const actualizarCuenta = () => {
    campoCuenta.hidden = selectMedio.value === 'Efectivo';
  };
  selectMedio.addEventListener('change', actualizarCuenta);
  actualizarCuenta();
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    const r = await window.freska.vendedores.pagarComision({
      vendedor_id: v.id,
      fecha,
      monto: limpiarNumeroMoneda(document.getElementById('comision-pago-monto').value),
      medio_pago: selectMedio.value,
      cuenta: document.getElementById('comision-pago-cuenta').value,
    });
    if (r.ok === false) {
      const error = document.getElementById('modal-error');
      error.textContent = r.error;
      error.style.display = 'block';
      return;
    }
    cerrarModal();
    mostrarToast(fecha >= desdeInformeVendedores && fecha <= hastaInformeVendedores ? 'Pago registrado.' : 'Pago registrado (queda fuera del período que estás mirando).', 'ok');
    renderVendedores();
  });
}
