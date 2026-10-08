// Caja general: cuentas, saldos, operaciones y métodos de pago.
// (Antes todo estaba en renderer.js; se dividió por pantalla el 2026-09-24. Los archivos son scripts comunes que
// comparten el mismo espacio global: se cargan en el orden de index.html y no hace falta importar nada.)

// ---------- Caja general ----------
// Todo el dinero disponible: el efectivo, la plata de cada banco o app (cada método de pago es una cuenta), los
// dólares y los cheques en cartera. Cada cuenta se mueve sola con los cobros, gastos y pagos a proveedores.
let editandoSaldosCaja = false;
// Filtro de "Operaciones" (más abajo en la misma pantalla): rango de fechas y texto, los dos opcionales.
let operacionesDesde = '';
let operacionesHasta = '';
let operacionesBusqueda = '';

function textoSaldoCuenta(n) {
  return `${n < 0 ? '−' : ''}$${formatearMoneda(Math.abs(n))}`;
}

function formSaldosCajaHtml(res) {
  const hoy = fechaHoyISO();
  return `
    <div class="cierre-titulo-fila">
      <h2>Saldos al comenzar el día</h2>
      ${botonAyudaHtml('ayuda-saldos-caja', 'Cómo cargar los saldos', '<p>Cargá cuánto hay en cada cuenta al comenzar el día que elijas. Desde ahí la app suma y resta sola con los cobros, los gastos y los pagos a proveedores.</p><p>Los dólares se valúan con la cotización que pongas a mano. Los cheques en cartera se suman solos.</p>', 'izquierda')}
    </div>
    <div class="panel caja-saldos-form" id="form-saldos-caja">
      <div class="gasto-fila">
        <div class="gasto-campo">
          <span>Al comenzar el día</span>
          ${selectorFechaHtml('caja-desde', res.desde || hoy)}
        </div>
      </div>
      <div class="caja-saldos-lista">
        ${res.cuentas
          .map(
            (c, i) => `<label class="caja-saldo-fila"><span>${esc(c.nombre)}</span><div class="input-moneda"><span>$</span><input type="text" inputmode="decimal" class="caja-saldo-inicial" data-cuenta="${esc(c.nombre)}" autocomplete="off" value="${esc(c.saldo_inicial ? formatearMoneda(c.saldo_inicial) : '')}" placeholder="0" ${i === 0 ? 'id="caja-primer-saldo"' : ''} /></div></label>`
          )
          .join('')}
        <label class="caja-saldo-fila"><span>Dólares (U$S)</span><div class="input-moneda"><span>U$S</span><input type="text" inputmode="decimal" id="caja-dolares" autocomplete="off" value="${esc(res.dolares && res.dolares.usd ? formatearMoneda(res.dolares.usd) : '')}" placeholder="0" /></div></label>
        <label class="caja-saldo-fila"><span>Cotización del dólar hoy</span><div class="input-moneda"><span>$</span><input type="text" inputmode="decimal" id="caja-cotizacion" autocomplete="off" value="${esc(res.dolares && res.dolares.cotizacion ? formatearMoneda(res.dolares.cotizacion) : '')}" placeholder="0" /></div></label>
      </div>
      <div class="btn-group">
        <button type="button" id="btn-guardar-saldos-caja" class="primary">Guardar</button>
        ${res.configurado ? '<button type="button" id="btn-cancelar-saldos-caja" class="cancelar">Cancelar</button>' : ''}
      </div>
      <p id="error-saldos-caja" class="error-msg" style="display:none"></p>
    </div>`;
}

// El historial de una cuenta (banco, app o efectivo): cada movimiento con el saldo que fue quedando.
async function abrirMovimientosCuenta(nombre) {
  const [datos, resumen] = await Promise.all([window.freska.cuentas.movimientos(nombre), window.freska.cuentas.resumen()]);
  // El saldo inicial es el primer renglón del historial (el más antiguo, al final de la lista): de ahí parte el saldo.
  const movs = [...(datos.movimientos || [])];
  if (datos.desde) movs.push({ fecha: datos.desde, detalle: 'Saldo inicial', monto: datos.inicial || 0, saldo: datos.inicial || 0 });
  const cuenta = (resumen.cuentas || []).find((c) => c.nombre === nombre);
  const esEfectivo = /^efectivo$/i.test(nombre.trim());
  let limite = MOVIMIENTOS_POR_PAGINA;
  mostrarModal(`
    ${MODAL_X_HTML}
    <h3>${esc(nombre)}</h3>
    ${
      cuenta
        ? `<div class="acciones-detalle-cuenta">
      <button type="button" id="det-ajustar">Ajustar saldo</button>
      <button type="button" id="det-pasar">Pasar plata</button>
      ${esEfectivo ? '' : '<button type="button" id="det-editar">Cambiar nombre y tarjetas</button><button type="button" id="det-quitar" class="enlace-boton enlace-peligro">Quitar cuenta</button>'}
    </div>`
        : ''
    }
    <div class="caja-movimientos">
      <table>
        <thead><tr><th>Fecha</th><th>Detalle</th><th>Monto</th><th>Saldo</th></tr></thead>
        <tbody id="det-movimientos"></tbody>
      </table>
    </div>
    <p id="det-ver-mas" style="text-align:center; margin:0 0 6px;" hidden><button type="button" id="btn-det-ver-mas"></button></p>
  `);
  const pintar = () => {
    const mostrados = movs.slice(0, limite);
    document.getElementById('det-movimientos').innerHTML = movs.length === 0
      ? '<tr><td colspan="4">Todavía no cargaste los saldos iniciales.</td></tr>'
      : mostrados
          .map((m) => `<tr><td>${fechaLargaCierre(m.fecha)}</td><td>${esc(m.detalle)}</td><td class="${m.monto < 0 ? 'mov-sale' : 'mov-entra'}">$${formatearMoneda(Math.abs(m.monto))}</td><td>${textoSaldoCuenta(m.saldo)}</td></tr>`)
          .join('');
    const ocultos = movs.length - mostrados.length;
    document.getElementById('det-ver-mas').hidden = ocultos <= 0;
    document.getElementById('btn-det-ver-mas').textContent = `Ver más antiguos (${ocultos})`;
  };
  pintar();
  document.getElementById('btn-det-ver-mas').addEventListener('click', () => {
    limite += MOVIMIENTOS_POR_PAGINA;
    pintar();
  });
  document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
  if (cuenta) {
    document.getElementById('det-ajustar').addEventListener('click', () => abrirAjusteSaldoCuenta(nombre, cuenta.saldo));
    document.getElementById('det-pasar').addEventListener('click', () => {
      cerrarModal();
      abrirOperacionCaja('pase', resumen, () => renderCajaGeneral(), { origen: nombre });
    });
    document.getElementById('det-editar')?.addEventListener('click', () => abrirEdicionCuentaCaja(nombre));
    document.getElementById('det-quitar')?.addEventListener('click', () => pedirConfirmacionBajaCuenta(nombre));
  }
}

// Abre una operación de la Caja desde otra pantalla (Cheques, Gastos), y al terminar vuelve a dibujar esa pantalla.
async function abrirOperacionDesde(tipo, alTerminar, extra = {}) {
  const res = await window.freska.cuentas.resumen();
  if (!res.configurado) {
    mostrarToast('Primero cargá los saldos iniciales en Dinero → Caja.', 'error');
    return;
  }
  abrirOperacionCaja(tipo, res, alTerminar, extra);
}

// Ventanas de las operaciones de la Caja general: cada una arma sus casilleros y llama a su IPC.
function abrirOperacionCaja(tipo, res, alTerminar = () => renderCajaGeneral(), extra = {}) {
  const nombres = res.cuentas.map((c) => c.nombre);
  const bancos = nombres.filter((n) => n.trim().toLowerCase() !== 'efectivo');
  const opciones = (lista, elegido) => lista.map((n) => `<option ${n === elegido ? 'selected' : ''}>${esc(n)}</option>`).join('');
  const fila = (etiqueta, html, completo) => `<label class="op-campo ${completo ? 'op-completo' : ''}"><span>${etiqueta}</span>${html}</label>`;
  const moneda = (id, valor = '', simbolo = '$') => `<div class="input-moneda"><span>${simbolo}</span><input type="text" inputmode="decimal" id="${id}" value="${esc(valor)}" autocomplete="off" /></div>`;
  const fecha = `<div class="op-campo"><span>Fecha</span>${selectorFechaHtml('op-fecha', fechaHoyISO())}</div>`;
  const marco = (titulo, cuerpo, textoBoton) => {
    mostrarModal(`${modalXHtml('modal-cancelar')}
      <h3>${titulo}</h3>
      <div class="op-form">${cuerpo}</div>
      <p id="modal-error" class="error-msg" style="display:none"></p>
      <div class="btn-group">
        <button type="button" id="modal-confirmar" class="primary">${textoBoton}</button>
      </div>
    `);
    vincularSelectorFecha('op-fecha', fechaHoyISO(), (nueva) => {
      document.getElementById('op-fecha').value = formatearFechaCorta(nueva || fechaHoyISO());
    });
    document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  };
  const enviar = (llamar, mensaje) => {
    document.getElementById('modal-confirmar').addEventListener('click', async () => {
      const r = await llamar();
      if (!r.ok) {
        const e = document.getElementById('modal-error');
        e.textContent = r.error;
        e.style.display = '';
        return;
      }
      cerrarModal();
      mostrarToast(mensaje, 'ok');
      alTerminar();
    });
  };
  const leerFecha = () => fechaCortaAIso(document.getElementById('op-fecha').value);
  const valor = (id) => document.getElementById(id).value;
  const num = (id) => limpiarNumeroMoneda(valor(id));

  if (tipo === 'pase') {
    marco(
      'Pasar plata',
      fecha +
        fila('Monto', moneda('op-monto')) +
        `<div class="op-completo op-de-a">${fila('De', `<select id="op-origen">${opciones(nombres, extra.origen || 'Efectivo')}</select>`)}${fila('A', '<select id="op-destino"></select>')}</div><p class="op-completo op-invertir-fila"><button type="button" id="op-invertir" class="enlace-boton">Invertir De y A</button></p>` +
        fila('Nota', '<input type="text" id="op-nota" placeholder="Opcional" maxlength="200" autocomplete="off" />', true),
      'Pasar'
    );
    // No se puede pasar plata de una cuenta a sí misma: "A" ofrece todas menos la de origen.
    const pintarDestino = (preferido) => {
      const destino = document.getElementById('op-destino');
      const anterior = preferido || destino.value;
      const posibles = nombres.filter((n) => n !== valor('op-origen'));
      destino.innerHTML = opciones(posibles, posibles.includes(anterior) ? anterior : posibles[0]);
    };
    document.getElementById('op-origen').addEventListener('change', () => pintarDestino());
    pintarDestino();
    // La flecha intercambia De y A (por ejemplo, un depósito y su retiro).
    document.getElementById('op-invertir').addEventListener('click', () => {
      const antesOrigen = valor('op-origen');
      const antesDestino = valor('op-destino');
      document.getElementById('op-origen').value = antesDestino;
      pintarDestino(antesOrigen);
    });
    vincularFormatoMoneda(document.getElementById('op-monto'));
    enviar(() => window.freska.operaciones.pase({ fecha: leerFecha(), origen: valor('op-origen'), destino: valor('op-destino'), monto: num('op-monto'), nota: valor('op-nota') }), 'Listo, la plata se pasó.');
  } else if (tipo === 'dolares') {
    marco(
      'Comprar dólares',
      fecha +
        fila('Pagó con', `<select id="op-cuenta">${opciones(nombres, 'Efectivo')}</select>`) +
        fila('Dólares', moneda('op-usd', '', 'U$S')) +
        fila('Cotización', moneda('op-cotizacion', res.dolares && res.dolares.cotizacion ? formatearMoneda(res.dolares.cotizacion) : '')) +
        '<p class="pin-subtitulo op-completo" id="op-total-pesos"></p>',
      'Comprar'
    );
    ['op-usd', 'op-cotizacion'].forEach((id) => {
      vincularFormatoMoneda(document.getElementById(id));
      document.getElementById(id).addEventListener('input', () => {
        const total = (num('op-usd') || 0) * (num('op-cotizacion') || 0);
        document.getElementById('op-total-pesos').textContent = total > 0 ? `Son $${formatearMoneda(Math.round(total * 100) / 100)}` : '';
      });
    });
    enviar(() => window.freska.operaciones.comprarDolares({ fecha: leerFecha(), cuenta: valor('op-cuenta'), usd: num('op-usd'), cotizacion: num('op-cotizacion') }), 'Dólares comprados.');
  } else if (tipo === 'canje') {
    window.freska.cheques.listar({ estado: 'en_cartera' }).then((cheques) => {
      if (!cheques.length) {
        mostrarModal(`${MODAL_X_HTML}<h3>Canjear cheque</h3><p>No tenés cheques en la cartera.</p>`);
        document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
        return;
      }
      marco(
        'Canjear cheque',
        fecha +
          fila('Entra en', `<select id="op-cuenta">${opciones(nombres, 'Efectivo')}</select>`) +
          fila('Cheque', `<select id="op-cheque">${cheques.map((ch) => `<option value="${ch.id}">${esc(textoChequeOpcion(ch))}</option>`).join('')}</select>`, true),
        'Canjear'
      );
      if (extra.chequeId) document.getElementById('op-cheque').value = String(extra.chequeId);
      enviar(() => window.freska.operaciones.canjearCheque({ fecha: leerFecha(), cheque_id: Number(valor('op-cheque')), cuenta: valor('op-cuenta') }), 'Cheque canjeado.');
    });
  } else if (tipo === 'interes') {
    marco(
      'Interés',
      fecha +
        fila('Cuenta', `<select id="op-cuenta">${opciones(nombres, bancos[0])}</select>`) +
        fila('Monto', moneda('op-monto')) +
        fila('Nota', '<input type="text" id="op-nota" placeholder="Opcional" maxlength="200" autocomplete="off" />', true),
      'Guardar'
    );
    vincularFormatoMoneda(document.getElementById('op-monto'));
    enviar(() => window.freska.operaciones.interes({ fecha: leerFecha(), cuenta: valor('op-cuenta'), tipo: 'ganado', monto: num('op-monto'), nota: valor('op-nota') }), 'Interés anotado.');
  } else if (tipo === 'reintegro') {
    marco(
      'Reintegro',
      fecha +
        fila('Cuenta', `<select id="op-cuenta">${opciones(nombres, bancos[0])}</select>`) +
        fila('Monto', moneda('op-monto')) +
        fila('Nota', '<input type="text" id="op-nota" placeholder="Opcional" maxlength="200" autocomplete="off" />', true),
      'Guardar'
    );
    vincularFormatoMoneda(document.getElementById('op-monto'));
    enviar(() => window.freska.operaciones.reintegro({ fecha: leerFecha(), cuenta: valor('op-cuenta'), monto: num('op-monto'), nota: valor('op-nota') }), 'Reintegro anotado.');
  } else if (tipo === 'resumen') {
    window.freska.gastos.cuotasPendientes().then((cuotas) => {
      if (!cuotas.length) {
        mostrarModal(`${MODAL_X_HTML}<h3>Pagar resumen de tarjeta</h3><p>No hay cuotas pendientes.</p>`);
        document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
        return;
      }
      const tarjetas = [...new Set(cuotas.map((c) => c.tarjeta || 'Sin tarjeta'))];
      marco(
        'Pagar resumen de tarjeta',
        fecha +
          fila('Pagó desde', `<select id="op-cuenta">${opciones(bancos, bancos[0])}</select>`) +
          fila('Tarjeta', `<select id="op-tarjeta">${opciones(tarjetas, tarjetas[0])}</select>`, true) +
          '<div id="op-cuotas" class="op-cuotas op-completo"></div><p class="pin-subtitulo op-completo" id="op-total-pesos"></p>',
        'Pagar'
      );
      const pintar = () => {
        const t = valor('op-tarjeta');
        const propias = cuotas.filter((c) => (c.tarjeta || 'Sin tarjeta') === t);
        document.getElementById('op-cuotas').innerHTML = propias
          .map((c) => `<label class="op-cuota"><input type="checkbox" value="${c.id}" data-monto="${c.monto}" checked /> <span>Cuota ${c.numero} de ${c.cuotas}: ${esc(c.descripcion)}</span><strong>$${formatearMoneda(c.monto)}</strong></label>`)
          .join('');
        const cuentaPropia = propias.find((c) => c.cuenta && bancos.includes(c.cuenta));
        if (cuentaPropia) document.getElementById('op-cuenta').value = cuentaPropia.cuenta;
        totalizar();
        document.querySelectorAll('#op-cuotas input').forEach((c) => c.addEventListener('change', totalizar));
      };
      const totalizar = () => {
        const marcadas = [...document.querySelectorAll('#op-cuotas input:checked')];
        document.getElementById('op-total-pesos').textContent = marcadas.length ? `Total a pagar: $${formatearMoneda(marcadas.reduce((a, c) => a + Number(c.dataset.monto), 0))}` : '';
      };
      document.getElementById('op-tarjeta').addEventListener('change', pintar);
      pintar();
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        const marcadas = [...document.querySelectorAll('#op-cuotas input:checked')];
        const errorEl = document.getElementById('modal-error');
        if (!marcadas.length) {
          errorEl.textContent = 'Marcá al menos una cuota.';
          errorEl.style.display = '';
          return;
        }
        for (const c of marcadas) {
          const r = await window.freska.gastos.pagarCuota({ id: Number(c.value), fecha: leerFecha(), cuenta: valor('op-cuenta') });
          if (!r.ok) {
            errorEl.textContent = r.error;
            errorEl.style.display = '';
            return;
          }
        }
        cerrarModal();
        mostrarToast(`Se pagaron ${marcadas.length} ${marcadas.length === 1 ? 'cuota' : 'cuotas'}.`, 'ok');
        alTerminar();
      });
    });
  }
}

async function renderCajaGeneral() {
  const res = await window.freska.cuentas.resumen();
  const operaciones = res.configurado ? await window.freska.operaciones.listar() : [];
  if (!res.configurado || editandoSaldosCaja) {
    app.innerHTML = `<div class="cierre-caja caja-general">${cierreTabToggleHtml()}${formSaldosCajaHtml(res)}</div>`;
    vincularCierreTabToggle();
    vincularFormSaldosCaja(res);
    vincularBotonAyuda('ayuda-saldos-caja');
    return;
  }
  // El rango de fechas redibuja (como en Rendimiento); el texto filtra en vivo sin redibujar, para no perder
  // el foco del casillero mientras se escribe (como el buscador de Proveedores).
  const operacionesFiltradas = operaciones.filter(
    (o) => (!operacionesDesde || o.fecha >= operacionesDesde) && (!operacionesHasta || o.fecha <= operacionesHasta)
  );
  const menuFila = (items) => `<div class="menu-fila"><button class="btn-menu-fila" type="button" aria-label="Acciones">⋮</button><div class="menu-fila-lista">${items}</div></div>`;
  const fila = (c) => `<tr class="fila-clickeable fila-cuenta-general" tabindex="0" data-cuenta="${esc(c.nombre)}">
        <td title="Ver los movimientos de ${esc(c.nombre)}">${esc(c.nombre)}${c.personal ? `<div class="pin-subtitulo caja-linea-personal">+ ${esc(textoSaldoCuenta(c.personal))} personales</div>` : ''}</td>
        <td class="caja-saldo ${c.saldo < 0 ? 'saldo-negativo' : ''}">${textoSaldoCuenta(c.saldo)}</td>
        <td class="celda-centrada">${menuFila(`<button type="button" class="item-menu ver-movimientos-cuenta" data-cuenta="${esc(c.nombre)}">Ver movimientos</button><button type="button" class="item-menu ajustar-cuenta" data-cuenta="${esc(c.nombre)}" data-saldo="${c.saldo}">Ajustar saldo</button><button type="button" class="item-menu pasar-desde-cuenta" data-cuenta="${esc(c.nombre)}">Pasar plata desde esta cuenta</button>${/^efectivo$/i.test(c.nombre.trim()) ? '' : `<button type="button" class="item-menu editar-cuenta" data-cuenta="${esc(c.nombre)}">Cambiar nombre y tarjetas</button><button type="button" class="item-menu quitar-cuenta" data-cuenta="${esc(c.nombre)}">Quitar cuenta</button>`}`)}</td>
      </tr>`;
  app.innerHTML = `
    <div class="cierre-caja caja-general">
      ${cierreTabToggleHtml()}
      <div class="caja-cabecera">
        <div class="caja-total-panel">
          <div class="caja-total-fila">
            <span class="caja-total-titulo">Dinero disponible</span>
            <div class="caja-total-botones">
              ${menuFila('<button type="button" class="item-menu" id="editar-saldos-caja">Saldos iniciales</button><button type="button" class="item-menu" id="btn-retencion-caja">Retención por transferencia</button>')}
              ${botonAyudaHtml('ayuda-caja-general', 'Cómo se calcula', '<p>Es todo lo que tenés: el efectivo, la plata de cada banco o app, los dólares y los cheques en cartera.</p><p>Cada cuenta parte de lo que cargaste al comenzar el día indicado y se mueve sola con los cobros, gastos y pagos a proveedores. Con <em>Ajustar saldo</em> la dejás igual que el banco.</p>', 'izquierda')}
            </div>
          </div>
          <div class="caja-total-monto-fila">
            <strong class="caja-total tapado" id="caja-total-monto">${textoSaldoCuenta(res.total)}</strong>
            <button type="button" id="btn-ver-monto-caja" class="btn-ojo" aria-label="Mostrar el monto" title="Mostrar el monto">${ICONO_OJO}</button>
          </div>
        </div>
        <div class="caja-acciones-cuentas">
          <button type="button" id="btn-agregar-cuenta" class="primary">+ Agregar cuenta</button>
        </div>
      </div>
      ${textoSaldoPases(res.saldoPases)}
      <table class="tabla-caja-general">
        <thead><tr><th>Cuenta</th><th>Saldo</th><th></th></tr></thead>
        <tbody>
          ${res.cuentas.map(fila).join('')}
          ${
            res.sinAsignar
              ? `<tr class="fila-clickeable fila-cuenta-general" tabindex="0" data-cuenta="Sin asignar" title="Ver los movimientos sin cuenta"><td>Sin asignar <span class="pin-subtitulo">(${res.sinAsignar.movimientos} movimientos sin cuenta)</span></td><td class="caja-saldo">${textoSaldoCuenta(res.sinAsignar.saldo)}</td><td></td></tr>`
              : ''
          }
          <tr>
            <td>Dólares <span class="pin-subtitulo">(U$S ${formatearMoneda(res.dolares.usd)} × $${formatearMoneda(res.dolares.cotizacion)})</span></td>
            <td class="caja-saldo">${textoSaldoCuenta(res.dolares.valor)}</td>
            <td class="celda-centrada">${menuFila('<button type="button" class="item-menu" data-operacion="dolares">Comprar dólares</button><button type="button" class="item-menu" id="editar-dolares-caja">Cambiar dólares y cotización</button>')}</td>
          </tr>
          <tr class="fila-clickeable" tabindex="0" id="ver-cheques-caja" title="Ver los cheques en cartera">
            <td>Cheques en cartera <span class="pin-subtitulo">(${res.cheques.cantidad})</span></td>
            <td class="caja-saldo">${textoSaldoCuenta(res.cheques.total)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
      ${
        operaciones.length
          ? `<h2>Operaciones</h2>
      <div class="toolbar toolbar-junta toolbar-operaciones">
        ${selectorRangoHtml('filtro-rango-operaciones', operacionesDesde, operacionesHasta)}
        <input type="text" id="buscar-operacion" class="buscador" placeholder="Buscar" autocomplete="off" value="${esc(operacionesBusqueda)}" />
      </div>
      <table class="tabla-operaciones">
        <thead><tr><th>Día</th><th>Cuenta</th><th>Detalle</th><th>Monto</th><th></th></tr></thead>
        <tbody>
          ${
            operacionesFiltradas.length
              ? operacionesFiltradas
                  .map(
                    (o) => `<tr data-detalle="${esc(normalizarTexto(`${o.cuenta} ${o.detalle}`))}"><td>${fechaLargaCierre(o.fecha)}</td><td>${esc(o.cuenta)}</td><td>${esc(o.detalle)}</td><td>$${formatearMoneda(o.monto)}</td><td class="celda-centrada"><button type="button" class="btn-redondo btn-tacho quitar-operacion" data-id="${o.id}" aria-label="Quitar operación" title="Quitar operación">${TACHITO_SVG}</button></td></tr>`
                  )
                  .join('')
              : '<tr><td colspan="5">No hay operaciones en ese rango.</td></tr>'
          }
        </tbody>
      </table>`
          : ''
      }
    </div>`;
  vincularCierreTabToggle();

  vincularBotonAyuda('ayuda-caja-general');
  vincularDevolverPases(res.saldoPases, renderCajaGeneral);
  vincularMenuFila();
  if (operaciones.length) {
    vincularSelectorRango('filtro-rango-operaciones', operacionesDesde, operacionesHasta, ({ desde, hasta }) => {
      operacionesDesde = desde;
      operacionesHasta = hasta;
      renderCajaGeneral();
    });
    const buscador = document.getElementById('buscar-operacion');
    buscador.addEventListener('input', (e) => {
      operacionesBusqueda = e.target.value;
      const q = normalizarTexto(operacionesBusqueda.trim());
      app.querySelectorAll('.tabla-operaciones tbody tr[data-detalle]').forEach((fila) => {
        fila.style.display = fila.dataset.detalle.includes(q) ? '' : 'none';
      });
    });
    if (operacionesBusqueda) buscador.dispatchEvent(new Event('input'));
  }
  app.querySelectorAll('.fila-cuenta-general').forEach((fila) => {
    const abrir = () => abrirMovimientosCuenta(fila.dataset.cuenta);
    fila.addEventListener('click', (e) => {
      if (!e.target.closest('.menu-fila')) abrir();
    });
    fila.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.target.closest('.menu-fila')) abrir();
    });
  });
  app.querySelectorAll('[data-operacion]').forEach((btn) => btn.addEventListener('click', () => abrirOperacionCaja(btn.dataset.operacion, res)));
  document.getElementById('btn-retencion-caja').addEventListener('click', async () => {
    const actual = await window.freska.config.obtenerRetencionTransferencia();
    mostrarModal(`${modalXHtml('modal-cancelar')}
      <h3>Retención por transferencia</h3>
      <p class="pin-subtitulo">El banco o app descuenta este % de cada cobro por transferencia y de cada ingreso que entra a una cuenta. Vale desde ahora en adelante; lo ya cargado no cambia.</p>
      <label class="op-campo op-completo"><span>Porcentaje</span><span class="input-porcentaje"><input type="text" id="retencion-caja-valor" inputmode="decimal" placeholder="0" value="${actual ? String(actual).replace('.', ',') : ''}" autocomplete="off" /><span>%</span></span></label>
      <p id="modal-error" class="error-msg" style="display:none"></p>
      <div class="btn-group">
        <button type="button" id="modal-confirmar" class="primary">Guardar</button>
      </div>
    `);
    const campo = document.getElementById('retencion-caja-valor');
    campo.focus();
    campo.select();
    document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
    const guardar = async () => {
      const texto = campo.value.trim().replace(',', '.');
      const r = await window.freska.config.guardarRetencionTransferencia(texto === '' ? 0 : Number(texto));
      if (!r.ok) {
        const e = document.getElementById('modal-error');
        e.textContent = r.error;
        e.style.display = '';
        return;
      }
      cerrarModal();
      mostrarToast('Retención guardada.', 'ok');
    };
    document.getElementById('modal-confirmar').addEventListener('click', guardar);
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') guardar();
    });
  });
  document.getElementById('btn-agregar-cuenta').addEventListener('click', () => abrirAltaCuentaCaja(res));
  // El monto arranca tapado cada vez que se entra a Caja general; el ojito lo muestra mientras se mantiene
  // esta pantalla abierta (no se acuerda entre entradas, a propósito).
  document.getElementById('btn-ver-monto-caja').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const monto = document.getElementById('caja-total-monto');
    const tapado = monto.classList.toggle('tapado');
    btn.innerHTML = tapado ? ICONO_OJO : ICONO_OJO_TACHADO;
    btn.setAttribute('aria-label', tapado ? 'Mostrar el monto' : 'Ocultar el monto');
    btn.setAttribute('title', tapado ? 'Mostrar el monto' : 'Ocultar el monto');
  });
  app.querySelectorAll('.editar-cuenta').forEach((btn) => btn.addEventListener('click', () => abrirEdicionCuentaCaja(btn.dataset.cuenta)));
  app.querySelectorAll('.quitar-cuenta').forEach((btn) => btn.addEventListener('click', () => pedirConfirmacionBajaCuenta(btn.dataset.cuenta)));
  app.querySelectorAll('.quitar-operacion').forEach((btn) => {
    btn.addEventListener('click', () => {
      const op = operaciones.find((o) => o.id === Number(btn.dataset.id));
      if (!op) return;
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Quitar operación</h3>
        <p>¿Seguro que querés quitar esta operación?</p>
        <p><strong>${esc(op.detalle)}</strong> — $${formatearMoneda(op.monto)}</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, quitar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        await window.freska.operaciones.eliminar(op.id);
        cerrarModal();
        mostrarToast('Operación quitada.', 'ok');
        renderCajaGeneral();
      });
    });
  });
  document.getElementById('editar-saldos-caja').addEventListener('click', () => {
    editandoSaldosCaja = true;
    renderCajaGeneral();
  });
  const irACheques = async () => {
    registrarOrigenVolver('cheques', 'cierre', 'caja');
    await irAVista(document.querySelector('nav button[data-view="cheques"]'));
  };
  document.getElementById('ver-cheques-caja').addEventListener('click', irACheques);
  document.getElementById('ver-cheques-caja').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') irACheques();
  });
  document.getElementById('editar-dolares-caja').addEventListener('click', () => {
    mostrarModal(`${modalXHtml('modal-cancelar')}
      <h3>Dólares</h3>
      <div class="caja-saldos-lista">
        <label class="caja-saldo-fila"><span>Dólares (U$S)</span><div class="input-moneda"><span>U$S</span><input type="text" inputmode="decimal" id="modal-dolares" value="${esc(formatearMoneda(res.dolares.usd))}" autocomplete="off" /></div></label>
        <label class="caja-saldo-fila"><span>Cotización de hoy</span><div class="input-moneda"><span>$</span><input type="text" inputmode="decimal" id="modal-cotizacion" value="${esc(formatearMoneda(res.dolares.cotizacion))}" autocomplete="off" /></div></label>
      </div>
      <p id="modal-error" class="error-msg" style="display:none"></p>
      <div class="btn-group">
        <button type="button" id="modal-confirmar" class="primary">Guardar</button>
      </div>
    `);
    vincularFormatoMoneda(document.getElementById('modal-dolares'));
    vincularFormatoMoneda(document.getElementById('modal-cotizacion'));
    document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('modal-confirmar').addEventListener('click', async () => {
      const r = await window.freska.cuentas.guardarDolares({
        dolares_usd: limpiarNumeroMoneda(document.getElementById('modal-dolares').value) || 0,
        cotizacion: limpiarNumeroMoneda(document.getElementById('modal-cotizacion').value) || 0,
      });
      if (!r.ok) {
        const e = document.getElementById('modal-error');
        e.textContent = r.error;
        e.style.display = '';
        return;
      }
      cerrarModal();
      mostrarToast('Dólares actualizados.', 'ok');
      renderCajaGeneral();
    });
  });

  app.querySelectorAll('.ver-movimientos-cuenta').forEach((btn) => {
    btn.addEventListener('click', () => abrirMovimientosCuenta(btn.dataset.cuenta));
  });

  app.querySelectorAll('.ajustar-cuenta').forEach((btn) => {
    btn.addEventListener('click', () => abrirAjusteSaldoCuenta(btn.dataset.cuenta, Number(btn.dataset.saldo)));
  });
  app.querySelectorAll('.pasar-desde-cuenta').forEach((btn) => {
    btn.addEventListener('click', () => abrirOperacionCaja('pase', res, () => renderCajaGeneral(), { origen: btn.dataset.cuenta }));
  });
}

// Ajustar el saldo de una cuenta a lo que dice el banco (desde el ⋮ de la fila o desde el detalle de la cuenta).
function abrirAjusteSaldoCuenta(nombre, saldo) {
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Ajustar saldo de ${esc(nombre)}</h3>
    <p>La app dice que hay <strong>${textoSaldoCuenta(saldo)}</strong>. Poné cuánto hay realmente (por ejemplo, lo que dice el banco) y la diferencia queda anotada como un ajuste.</p>
    <div class="input-moneda caja-ajuste"><span>$</span><input type="text" inputmode="decimal" id="ajuste-saldo" value="${esc(formatearMoneda(saldo))}" autocomplete="off" aria-label="Saldo real" /></div>
    <input type="text" id="ajuste-nota" placeholder="Motivo (opcional)" maxlength="120" autocomplete="off" />
    <p id="modal-error" class="error-msg" style="display:none"></p>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary">Ajustar</button>
    </div>
  `);
  vincularFormatoMoneda(document.getElementById('ajuste-saldo'));
  document.getElementById('ajuste-saldo').select();
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    const real = limpiarNumeroMoneda(document.getElementById('ajuste-saldo').value);
    const r = await window.freska.cuentas.ajustar({ cuenta: nombre, saldo_real: Number.isNaN(real) ? NaN : real, nota: document.getElementById('ajuste-nota').value });
    if (!r.ok) {
      const e = document.getElementById('modal-error');
      e.textContent = r.error;
      e.style.display = '';
      return;
    }
    cerrarModal();
    mostrarToast(r.diferencia ? 'Saldo ajustado.' : 'El saldo ya coincidía.', 'ok');
    renderCajaGeneral();
  });
}

function vincularFormSaldosCaja(res) {
  let desde = res.desde || fechaHoyISO();
  document.querySelectorAll('#form-saldos-caja input.caja-saldo-inicial, #caja-dolares, #caja-cotizacion').forEach(vincularFormatoMoneda);
  vincularSelectorFecha('caja-desde', desde, (nueva) => {
    desde = nueva || fechaHoyISO();
    document.getElementById('caja-desde').value = formatearFechaCorta(desde);
  });
  document.getElementById('caja-primer-saldo')?.focus();
  document.getElementById('btn-cancelar-saldos-caja')?.addEventListener('click', () => {
    editandoSaldosCaja = false;
    renderCajaGeneral();
  });
  document.getElementById('btn-guardar-saldos-caja').addEventListener('click', async () => {
    const saldos = {};
    document.querySelectorAll('#form-saldos-caja input.caja-saldo-inicial').forEach((input) => {
      const n = limpiarNumeroMoneda(input.value);
      saldos[input.dataset.cuenta] = Number.isNaN(n) ? 0 : n;
    });
    const r = await window.freska.cuentas.guardarSaldos({
      desde: fechaCortaAIso(document.getElementById('caja-desde').value) || desde,
      saldos,
      dolares_usd: limpiarNumeroMoneda(document.getElementById('caja-dolares').value) || 0,
      cotizacion: limpiarNumeroMoneda(document.getElementById('caja-cotizacion').value) || 0,
    });
    if (!r.ok) {
      const e = document.getElementById('error-saldos-caja');
      e.textContent = r.error;
      e.style.display = 'block';
      return;
    }
    editandoSaldosCaja = false;
    mostrarToast('Saldos guardados.', 'ok');
    renderCajaGeneral();
  });
}

// Las tarjetas de un banco o app: chips con su tipo y un "+ Tarjeta" para agregar otra.
function tarjetasDeMetodoHtml(metodo, tarjetas, tipo) {
  const propias = tarjetas.filter((t) => t.cuenta === metodo.nombre && t.tipo === tipo);
  return propias
    .map(
      (t) => `<span class="chip-retiro-grupo"><span class="chip-retiro chip-texto">${esc(t.nombre)}</span><button type="button" class="chip-retiro-x quitar-tarjeta" data-id="${t.id}" aria-label="Sacar ${esc(t.nombre)}" title="Sacar tarjeta">×</button></span>`
    )
    .join('');
}

// Cuentas de la Caja general (cada banco o app es un método de pago): alta, edición (nombre y tarjetas) y baja.
function abrirAltaCuentaCaja(res) {
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Agregar cuenta</h3>
    <p class="pin-subtitulo">Un banco, app o método de pago nuevo. Aparece acá y al cobrar o pagar. Después, con ⋮ → Ajustar saldo, cargás lo que tiene.</p>
    <div class="op-form">
      <label class="op-campo op-completo"><span>Nombre</span><input type="text" id="cuenta-nueva-nombre" maxlength="40" placeholder="Ej: Cuenta DNI" autocomplete="off" /></label>
      <label class="op-campo op-completo"><span>Tarjetas de débito (opcional)</span><input type="text" id="cuenta-nueva-debito" maxlength="120" placeholder="Ej: Visa, Maestro" autocomplete="off" /></label>
      <label class="op-campo op-completo"><span>Tarjetas de crédito (opcional)</span><input type="text" id="cuenta-nueva-credito" maxlength="120" placeholder="Ej: Visa, Master" autocomplete="off" /></label>
    </div>
    <p id="modal-error" class="error-msg" style="display:none"></p>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary">Agregar</button>
    </div>
  `);
  const campo = document.getElementById('cuenta-nueva-nombre');
  campo.focus();
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  const guardar = async () => {
    const nombre = campo.value.trim();
    const error = document.getElementById('modal-error');
    const mostrar = (texto) => {
      error.textContent = texto;
      error.style.display = '';
    };
    if (!nombre) return mostrar('Escribí el nombre de la cuenta.');
    if (res.cuentas.some((cu) => cu.nombre.trim().toLowerCase() === nombre.toLowerCase())) return mostrar('Ya hay una cuenta con ese nombre.');
    let nuevo;
    try {
      nuevo = await window.freska.metodosPago.crear(nombre);
      if (nuevo && nuevo.ok === false) return mostrar(nuevo.error);
    } catch (e) {
      return mostrar('No se pudo agregar (¿ya existe un método de pago con ese nombre?).');
    }
    // Las tarjetas escritas (separadas por comas) quedan cargadas en la cuenta recién creada.
    for (const [id, tipo] of [['cuenta-nueva-debito', 'Débito'], ['cuenta-nueva-credito', 'Crédito']]) {
      for (const t of document.getElementById(id).value.split(',').map((n) => n.trim()).filter(Boolean)) {
        await window.freska.tarjetas.crear({ cuenta: nombre, nombre: t, tipo });
      }
    }
    cerrarModal();
    mostrarToast('Cuenta agregada.', 'ok');
    renderCajaGeneral();
  };
  document.getElementById('modal-confirmar').addEventListener('click', guardar);
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') guardar();
  });
}

async function abrirEdicionCuentaCaja(nombre, nombreEscrito) {
  const [metodos, tarjetas] = await Promise.all([window.freska.metodosPago.listar(), window.freska.tarjetas.listar()]);
  const metodo = metodos.find((m) => m.nombre === nombre);
  if (!metodo) return;
  const grupo = (tipo, titulo) => `
    <span class="edit-metodo-etiqueta">${titulo}</span>
    <div class="edit-metodo-tarjetas">${tarjetasDeMetodoHtml({ nombre }, tarjetas, tipo)}<input type="text" class="nueva-tarjeta-inline" data-tipo="${tipo}" placeholder="Agregar (Enter)" maxlength="60" autocomplete="off" /></div>`;
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Cambiar nombre y tarjetas</h3>
    <div class="edit-metodo">
      <span class="edit-metodo-etiqueta">Nombre</span>
      <input type="text" class="edit-nombre" value="${esc(nombreEscrito ?? nombre)}" maxlength="40" />
      ${grupo('Débito', 'Tarjetas de débito')}
      ${grupo('Crédito', 'Tarjetas de crédito')}
    </div>
    <div class="btn-group edit-metodo-botones">
      <button type="button" id="modal-confirmar" class="primary">Guardar</button>
    </div>
  `);
  const modal = document.querySelector('.modal-card');
  const nombreInput = modal.querySelector('.edit-nombre');
  nombreInput.focus();
  modal.querySelectorAll('.nueva-tarjeta-inline').forEach((input) => {
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      const texto = input.value.trim();
      if (!texto) return;
      const r = await window.freska.tarjetas.crear({ cuenta: nombre, nombre: texto, tipo: input.dataset.tipo });
      if (!r.ok) {
        mostrarToast(r.error || 'No se pudo guardar la tarjeta.', 'error');
        return;
      }
      await abrirEdicionCuentaCaja(nombre, nombreInput.value);
    });
  });
  modal.querySelectorAll('.quitar-tarjeta').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.freska.tarjetas.quitar(Number(btn.dataset.id));
      await abrirEdicionCuentaCaja(nombre, nombreInput.value);
    });
  });
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  const guardar = async () => {
    const nuevoNombre = nombreInput.value.trim();
    if (!nuevoNombre) return;
    if (nuevoNombre !== nombre) {
      const r = await window.freska.metodosPago.actualizar({ id: metodo.id, nombre: nuevoNombre });
      if (r && r.ok === false) {
        mostrarToast(r.error, 'error');
        return;
      }
    }
    cerrarModal();
    mostrarToast('Cuenta guardada.', 'ok');
    renderCajaGeneral();
  };
  document.getElementById('modal-confirmar').addEventListener('click', guardar);
  nombreInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') guardar();
  });
}

async function pedirConfirmacionBajaCuenta(nombre) {
  const metodo = (await window.freska.metodosPago.listar()).find((m) => m.nombre === nombre);
  if (!metodo) return;
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Quitar cuenta</h3>
    <p>¿Seguro que querés quitar <strong>${esc(nombre)}</strong>? Va a dejar de aparecer como opción al registrar un pago nuevo y sale de esta lista.</p>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, quitar</button>
    </div>
  `);
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    const r = await window.freska.metodosPago.baja(metodo.id);
    if (r && r.ok === false) {
      cerrarModal();
      mostrarToast(r.error, 'error');
      return;
    }
    cerrarModal();
    mostrarToast('Cuenta quitada.', 'ok');
    renderCajaGeneral();
  });
}
