// Cheques (cartera).
// (Antes todo estaba en renderer.js; se dividió por pantalla el 2026-09-24. Los archivos son scripts comunes que
// comparten el mismo espacio global: se cargan en el orden de index.html y no hace falta importar nada.)

// ---------- Cheques (cartera) ----------
let vistaChequesTab = 'en_cartera';
let mostrarFormCheque = false;
let busquedaCheques = '';
const CHEQUES_POR_PAGINA = 50;
let limiteCheques = CHEQUES_POR_PAGINA;

function chequesTabToggleHtml() {
  const boton = (valor, texto) =>
    `<button type="button" class="toggle ${vistaChequesTab === valor ? 'active' : ''}" data-cheques-tab="${valor}">${texto}</button>`;
  return `<div class="reportes-toggle">${boton('en_cartera', 'En cartera')}${boton('entregado', 'Entregados')}${boton('todos', 'Todos')}</div>`;
}

// Cuánto falta para que un cheque en cartera se pueda cobrar: vencido, hoy, en pocos días o nada que avisar.
function avisoVencimientoCheque(cheque) {
  if (cheque.estado !== 'en_cartera' || !cheque.fecha_cobro) return '';
  const hoy = fechaHoyISO();
  if (cheque.fecha_cobro < hoy) return '<span class="estado-cheque estado-cheque-vencido">Ya se puede cobrar</span>';
  if (cheque.fecha_cobro === hoy) return '<span class="estado-cheque estado-cheque-vencido">Se cobra hoy</span>';
  const dias = Math.round((new Date(`${cheque.fecha_cobro}T00:00:00`) - new Date(`${hoy}T00:00:00`)) / 86400000);
  return dias <= 7 ? `<span class="estado-cheque estado-cheque-pronto">En ${dias} ${dias === 1 ? 'día' : 'días'}</span>` : '';
}

async function renderCheques() {
  const cheques = await window.freska.cheques.listar({});
  const enCartera = cheques.filter((c) => c.estado === 'en_cartera');
  const totalCartera = redondearPesos(enCartera.reduce((acc, c) => acc + c.importe, 0));
  const q = normalizarTexto(busquedaCheques.trim());
  const visibles = cheques
    .filter((c) => vistaChequesTab === 'todos' || c.estado === vistaChequesTab)
    .filter((c) => !q || normalizarTexto(`${c.banco} ${c.numero} ${c.librador || ''} ${c.entregado_a || ''}`).includes(q));
  const mostrados = visibles.slice(0, limiteCheques);
  const ocultos = visibles.length - mostrados.length;

  cantidadChequesCartera = enCartera.length;

  app.innerHTML = `
    <div class="cheques-pantalla">
      ${volverHtml('cheques')}
      ${!mostrarFormCheque ? '<div class="lista-agregar"><button type="button" id="btn-toggle-cheque" class="primary" aria-expanded="false">+ Agregar cheque</button></div>' : ''}
      ${
        mostrarFormCheque
          ? `<h2>Agregar cheque</h2>
      <div class="panel gasto-form" id="form-cheque">
        <div class="gasto-fila">
          <label class="gasto-campo"><span>Banco</span><input type="text" id="cheque-banco" maxlength="60" autocomplete="off" /></label>
          <label class="gasto-campo"><span>N° de cheque</span><input type="text" id="cheque-numero" maxlength="30" autocomplete="off" /></label>
          <label class="gasto-campo"><span>Importe</span><div class="input-moneda"><span>$</span><input type="text" id="cheque-importe" inputmode="decimal" autocomplete="off" /></div></label>
          <div class="gasto-campo"><span>Cobra el</span>${selectorFechaHtml('cheque-fecha', '')}</div>
          <label class="gasto-campo gasto-campo-grande"><span>Dado por</span><input type="text" id="cheque-librador" maxlength="120" placeholder="Cliente o quien te lo dio" autocomplete="off" /></label>
        </div>
        <div class="cheque-efectivo-cambio">
          <label><input type="checkbox" id="cheque-efectivo-cambio" /> Le di efectivo a cambio</label>
          ${botonAyudaHtml('ayuda-cheque-efectivo', 'Le di efectivo a cambio', '<p>Para cuando alguien (por ejemplo Hernán) te da un cheque y vos le das la misma plata en efectivo. El cheque entra a la cartera y sale ese importe del efectivo de la caja de hoy. No cuenta como ingreso ni como gasto. Si borrás el cheque, el efectivo vuelve.</p>')}
        </div>
        <p id="error-cheque" class="error-msg" style="display:none"></p>
        <div class="btn-group">
          <button type="button" id="btn-guardar-cheque" class="primary">Guardar</button>
          <button type="button" id="btn-cancelar-cheque">Cancelar</button>
        </div>
      </div>`
          : ''
      }
      <div class="toolbar fila-controles-lista">
        ${chequesTabToggleHtml()}
        <input type="text" id="buscar-cheque" class="buscador" placeholder="Buscar cheque" value="${esc(busquedaCheques)}" autocomplete="off" />
      </div>
      <table>
        <thead><tr><th>Cobra el</th><th>Banco</th><th>N°</th><th>Dado por</th><th>Importe</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${
            mostrados.length === 0
              ? `<tr><td colspan="7">${
                  vistaChequesTab === 'entregado' ? 'Todavía no entregaste ningún cheque.' : vistaChequesTab === 'todos' ? 'Todavía no hay cheques.' : 'No tenés cheques en cartera.'
                }</td></tr>`
              : mostrados
                  .map(
                    (c) => `<tr>
            <td><div class="cobra-el-celda">${c.fecha_cobro ? formatearFechaCorta(c.fecha_cobro) : '—'}<div class="aviso-bajo-fecha">${avisoVencimientoCheque(c)}</div></div></td>
            <td>${esc(c.banco)}</td>
            <td>${esc(c.numero)}</td>
            <td>${esc(c.librador || '—')}</td>
            <td>$${formatearMoneda(c.importe)}</td>
            <td>${c.estado === 'en_cartera' ? 'En cartera' : `Entregado a <strong>${esc(c.entregado_a)}</strong> el ${formatearFechaCorta(c.fecha_entrega)}`}</td>
            <td class="celda-centrada"><div class="menu-fila">
              <button class="btn-menu-fila" type="button" aria-label="Acciones del cheque ${esc(c.numero)}">⋮</button>
              <div class="menu-fila-lista">
                ${
                  c.estado === 'en_cartera'
                    ? `<button type="button" class="item-menu entregar-cheque" data-id="${c.id}">Entregar</button><button type="button" class="item-menu canjear-cheque" data-id="${c.id}">Canjear</button>`
                    : `<button type="button" class="item-menu volver-cheque" data-id="${c.id}">Volver a cartera</button>`
                }
                <button type="button" class="item-menu quitar-cheque" data-id="${c.id}">Eliminar</button>
              </div>
            </div></td>
          </tr>`
                  )
                  .join('')
          }
        </tbody>
      </table>
      ${ocultos > 0 ? `<p style="text-align:center; margin-top:16px;"><button type="button" id="btn-ver-mas-cheques">Ver más (${ocultos})</button></p>` : ''}
      ${visibles.length ? `<p class="pie-lista">${visibles.length} ${visibles.length === 1 ? 'cheque' : 'cheques'} por $${formatearMoneda(visibles.reduce((acc, c) => acc + c.importe, 0))}</p>` : ''}
    </div>
  `;

  vincularCobrosTabToggle();
  app.querySelectorAll('.toggle[data-cheques-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      vistaChequesTab = btn.dataset.chequesTab;
      limiteCheques = CHEQUES_POR_PAGINA;
      renderCheques();
    });
  });
  document.getElementById('btn-toggle-cheque')?.addEventListener('click', async () => {
    mostrarFormCheque = true;
    await renderCheques();
    document.getElementById('cheque-banco')?.focus();
  });
  document.getElementById('btn-cancelar-cheque')?.addEventListener('click', async () => {
    mostrarFormCheque = false;
    await renderCheques();
    document.getElementById('btn-toggle-cheque')?.focus();
  });
  const btnVerMas = document.getElementById('btn-ver-mas-cheques');
  if (btnVerMas) {
    btnVerMas.addEventListener('click', () => {
      limiteCheques += CHEQUES_POR_PAGINA;
      renderCheques();
    });
  }
  document.getElementById('buscar-cheque').addEventListener('input', (e) => {
    busquedaCheques = e.target.value;
    limiteCheques = CHEQUES_POR_PAGINA;
    renderCheques().then(() => {
      const input = document.getElementById('buscar-cheque');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  });

  if (mostrarFormCheque) {
    vincularFormatoMoneda(document.getElementById('cheque-importe'));
    const inputFecha = document.getElementById('cheque-fecha');
    vincularSelectorFecha('cheque-fecha', '', (nueva) => {
      inputFecha.value = nueva ? formatearFechaCorta(nueva) : '';
    });
    const guardar = async () => {
      const errorEl = document.getElementById('error-cheque');
      const textoFecha = inputFecha.value.trim();
      const fecha = textoFecha ? fechaCortaAIso(textoFecha) : null;
      const resultado =
        textoFecha && !fecha
          ? { ok: false, error: 'La fecha de cobro no es válida (dd/mm/aaaa).' }
          : await window.freska.cheques.crear({
              banco: document.getElementById('cheque-banco').value,
              numero: document.getElementById('cheque-numero').value,
              importe: limpiarNumeroMoneda(document.getElementById('cheque-importe').value),
              fecha_cobro: fecha,
              librador: document.getElementById('cheque-librador').value,
              efectivo_a_cambio: document.getElementById('cheque-efectivo-cambio').checked,
            });
      if (!resultado.ok) {
        errorEl.textContent = resultado.error;
        errorEl.style.display = 'block';
        return;
      }
      mostrarToast(
        document.getElementById('cheque-efectivo-cambio').checked
          ? 'Cheque agregado a la cartera. Salió el mismo importe del efectivo.'
          : 'Cheque agregado a la cartera.',
        'ok'
      );
      await renderCheques();
      document.getElementById('cheque-banco')?.focus();
    };
    document.getElementById('btn-guardar-cheque').addEventListener('click', guardar);
    vincularBotonAyuda('ayuda-cheque-efectivo');
    ['cheque-banco', 'cheque-numero', 'cheque-importe', 'cheque-fecha', 'cheque-librador'].forEach((id) => {
      document.getElementById(id).addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        guardar();
      });
    });
  }

  vincularMenuFila();
  vincularVolverGenerico();
  app.querySelectorAll('.canjear-cheque').forEach((btn) => {
    btn.addEventListener('click', () => abrirOperacionDesde('canje', () => renderCheques(), { chequeId: Number(btn.dataset.id) }));
  });
  app.querySelectorAll('.entregar-cheque').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cheque = cheques.find((c) => c.id === Number(btn.dataset.id));
      if (!cheque) return;
      const proveedoresActivos = (await window.freska.proveedores.listar()).filter((p) => p.activo !== 0);
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Entregar cheque</h3>
        <p>${esc(cheque.banco)} N° ${esc(cheque.numero)} — <strong>$${formatearMoneda(cheque.importe)}</strong></p>
        <label class="gasto-campo" style="margin-bottom:10px;"><span>¿A quién se lo entregás?</span>
          <select id="entrega-proveedor">
            <option value="">Elegí un proveedor…</option>
            ${proveedoresActivos.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}
            <option value="__otro__">Otro (escribir el nombre)…</option>
          </select>
          <input type="text" id="entrega-destino" maxlength="120" placeholder="Nombre" autocomplete="off" hidden /></label>
        <p id="entrega-nota" class="pin-subtitulo" hidden>Se anota como un pago a ese proveedor: baja lo que le debés.</p>
        <div class="gasto-campo" style="margin-bottom:14px;"><span>Fecha de entrega</span>
          ${selectorFechaHtml('entrega-fecha', fechaHoyISO())}</div>
        <p id="error-entrega" class="error-msg" style="display:none"></p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary">Entregar</button>
        </div>
      `);
      const inputFechaEntrega = document.getElementById('entrega-fecha');
      // Calendario: al elegir un día solo se escribe en el casillero (no se redibuja el cuadro).
      vincularSelectorFecha('entrega-fecha', fechaHoyISO(), (nueva) => {
        inputFechaEntrega.value = formatearFechaCorta(nueva || fechaHoyISO());
      });
      const selectProveedor = document.getElementById('entrega-proveedor');
      const inputDestino = document.getElementById('entrega-destino');
      const notaEntrega = document.getElementById('entrega-nota');
      // Un proveedor de la lista: la entrega es un pago a ese proveedor. "Otro": se escribe el nombre a mano.
      selectProveedor.addEventListener('change', () => {
        const otro = selectProveedor.value === '__otro__';
        inputDestino.hidden = !otro;
        notaEntrega.hidden = !(selectProveedor.value && !otro);
        if (otro) inputDestino.focus();
      });
      if (!proveedoresActivos.length) {
        selectProveedor.value = '__otro__';
        selectProveedor.dispatchEvent(new Event('change'));
      } else {
        selectProveedor.focus();
      }
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      const confirmar = async () => {
        const errorEl = document.getElementById('error-entrega');
        const fecha = fechaCortaAIso(inputFechaEntrega.value.trim());
        const elegido = selectProveedor.value;
        let resultado;
        if (!fecha) resultado = { ok: false, error: 'La fecha no es válida (dd/mm/aaaa).' };
        else if (!elegido) resultado = { ok: false, error: 'Elegí a quién se lo entregás.' };
        else if (elegido === '__otro__') {
          resultado = await window.freska.cheques.entregar({ id: cheque.id, entregado_a: inputDestino.value, fecha_entrega: fecha });
        } else {
          resultado = await window.freska.proveedores.pagar({ proveedor_id: Number(elegido), fecha, cheque_ids: [cheque.id] });
        }
        if (!resultado.ok) {
          errorEl.textContent = resultado.error;
          errorEl.style.display = 'block';
          return;
        }
        cerrarModal();
        mostrarToast('Cheque entregado.', 'ok');
        renderCheques();
      };
      document.getElementById('modal-confirmar').addEventListener('click', confirmar);
      ['entrega-destino', 'entrega-fecha'].forEach((id) => {
        document.getElementById(id).addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          confirmar();
        });
      });
    });
  });

  app.querySelectorAll('.volver-cheque').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.freska.cheques.volverACartera(Number(btn.dataset.id));
      mostrarToast('El cheque volvió a la cartera.', 'ok');
      renderCheques();
    });
  });

  app.querySelectorAll('.quitar-cheque').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cheque = cheques.find((c) => c.id === Number(btn.dataset.id));
      if (!cheque) return;
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Quitar cheque</h3>
        <p>¿Seguro que querés quitar este cheque?</p>
        <p><strong>${esc(cheque.banco)} N° ${esc(cheque.numero)}</strong> — $${formatearMoneda(cheque.importe)}</p>
        <p class="pin-subtitulo">Si vino de un cobro, el cobro queda registrado igual; solo se saca de esta lista.</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, quitar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        const resultado = await window.freska.cheques.eliminar(cheque.id);
        cerrarModal();
        if (resultado && resultado.ok === false) {
          mostrarToast(resultado.error, 'error');
          return;
        }
        mostrarToast('Cheque quitado.', 'ok');
        renderCheques();
      });
    });
  });
}
