// Pestaña Stock: lo que hay de cada cosa que se vende (en kilos), la producción que se va cargando y qué artículo de
// stock es cada producto. Se carga después de los archivos de pantallas (utilidades.js … inicio.js, ver index.html) y usa sus funciones.
// Stock = producción y ajustes − lo facturado desde la fecha de arranque. Las facturas descuentan solas.

let vistaStock = 'stock'; // 'stock' | 'produccion'
let fechaProduccionForm = '';
let articuloProduccionForm = '';
let unidadProduccionForm = 'kg';
let limiteMovimientosStock = 60;

const kilosTexto = (n) => `${formatearCantidad(n)} kg`;

function stockTabToggleHtml() {
  const boton = (id, texto) => `<button type="button" class="toggle ${vistaStock === id ? 'active' : ''}" data-stock-tab="${id}">${texto}</button>`;
  return `<div class="reportes-toggle">${boton('stock', 'Stock')}${boton('produccion', 'Producción')}${boton('rendimiento', 'Rendimiento')}${boton('insumos', 'Insumos')}</div>`;
}

function vincularStockTabToggle() {
  app.querySelectorAll('.toggle[data-stock-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      vistaStock = btn.dataset.stockTab;
      renderStock();
    });
  });
}

async function renderStock() {
  const res = await window.freska.stock.resumen();
  if (vistaStock === 'produccion') return renderProduccionStock(res);
  if (vistaStock === 'rendimiento') return renderRendimientoStock();
  if (vistaStock === 'insumos') return renderInsumosStock();
  return renderListaStock(res);
}

// ---------- Insumos ----------
// Bolsas, bandejas, film, ingredientes…: se gastan pero no se venden ni se producen. No se descuentan solos: se cuentan
// de vez en cuando y cada conteo guarda cuánto había ese día (la "diferencia" es contra el conteo anterior).

const UNIDADES_INSUMO = ['u.', 'kg', 'rollos', 'paquetes', 'cajas', 'litros'];
let formInsumo = null; // null | { id } (id null = agregar uno nuevo)
let formConteo = null; // null | { soloId } (soloId null = todos los insumos)
let errorInsumos = null;

function textoConteoInsumo(c, unidad) {
  return c ? `${formatearCantidad(c.cantidad)} ${esc(unidad)}` : '—';
}

async function renderInsumosStock() {
  const insumos = await window.freska.insumos.listar();
  const enEdicion = formInsumo && formInsumo.id ? insumos.find((i) => i.id === formInsumo.id) || null : null;
  if (formInsumo && formInsumo.id && !enEdicion) formInsumo = null;
  const conteados = formConteo ? (formConteo.soloId ? insumos.filter((i) => i.id === formConteo.soloId) : insumos) : [];
  const hayFormulario = Boolean(formInsumo || formConteo);
  const fecha = fechaHoyISO();

  const barra = hayFormulario
    ? ''
    : `<div class="toolbar toolbar-agregar-insumos">
        <button type="button" id="btn-agregar-insumo" class="primary">+ Agregar insumo</button>
      </div>`;

  const formularioInsumo = formInsumo
    ? `<h2>${enEdicion ? 'Editar insumo' : 'Agregar insumo'}</h2>
      <form id="form-insumo" class="panel gasto-form">
        ${errorInsumos ? `<p class="error-msg">${esc(errorInsumos)}</p>` : ''}
        <div class="gasto-fila">
          <label class="gasto-campo gasto-campo-grande"><span>Nombre</span><input type="text" id="insumo-nombre" required maxlength="80" autocomplete="off" value="${esc(enEdicion ? enEdicion.nombre : '')}" /></label>
          <label class="gasto-campo"><span>Unidad</span><select id="insumo-unidad">${UNIDADES_INSUMO.map((u) => `<option ${enEdicion && enEdicion.unidad === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>
          ${enEdicion ? '' : '<label class="gasto-campo"><span>Cuánto hay hoy</span><input type="text" id="insumo-cantidad-hoy" inputmode="decimal" autocomplete="off" placeholder="Opcional" /></label>'}
          <label class="gasto-campo"><span>Avisar si queda menos de ${botonAyudaHtml('ayuda-insumo-minimo', 'Aviso de poco stock', '<p>Opcional. Cuando el último conteo esté por debajo de esta cantidad, la app te va a avisar en la campanita.</p>', 'izquierda')}</span><input type="text" id="insumo-minimo" inputmode="decimal" autocomplete="off" placeholder="Sin aviso" value="${enEdicion && enEdicion.minimo !== null ? esc(formatearCantidad(enEdicion.minimo)) : ''}" /></label>
        </div>
        <div class="btn-group">
          <button type="submit" class="primary">${enEdicion ? 'Guardar cambios' : 'Guardar'}</button>
          <button type="button" id="btn-cancelar-insumo">Cancelar</button>
        </div>
      </form>`
    : '';

  const formularioConteo = formConteo
    ? `<h2>${formConteo.soloId ? 'Contar insumo' : 'Nuevo conteo'}</h2>
      <form id="form-conteo" class="panel gasto-form">
        ${errorInsumos ? `<p class="error-msg">${esc(errorInsumos)}</p>` : ''}
        <div class="gasto-fila">
          <div class="gasto-campo"><span>Fecha</span>${selectorFechaHtml('conteo-fecha', fecha)}</div>
        </div>
        <div class="lista-conteo">
          ${conteados
            .map(
              (i) => `<label class="fila-conteo"><span class="conteo-nombre">${esc(i.nombre)}</span>
            <span class="input-unidad"><input type="text" class="conteo-cantidad" data-id="${i.id}" inputmode="decimal" autocomplete="off" placeholder="${i.ultimo ? esc(formatearCantidad(i.ultimo.cantidad)) : 'Cantidad'}" aria-label="Cantidad de ${esc(i.nombre)}" /><span class="unidad-label">${esc(i.unidad)}</span></span></label>`
            )
            .join('')}
        </div>
        <p class="pin-subtitulo">Lo que dejes vacío no se cuenta. Lo gris es el último conteo.</p>
        <div class="btn-group">
          <button type="submit" class="primary">Guardar conteo</button>
          <button type="button" id="btn-cancelar-conteo">Cancelar</button>
        </div>
      </form>`
    : '';

  app.innerHTML = `
    <div class="stock-pantalla">
      ${stockTabToggleHtml()}
      <div class="cierre-titulo-fila" style="margin-top:0">
        <h2>Insumos</h2>
        ${botonAyudaHtml('ayuda-insumos', 'Cómo funcionan', '<p>Los insumos son lo que se gasta pero no se vende ni se produce: bolsas, bandejas, film y también ingredientes (huevo, pan rallado…).</p><p>No se descuentan solos: cada tanto los <strong>contás</strong> (<em>⋮ → Contar</em>) y la app guarda cuánto había ese día. La <strong>diferencia</strong> es contra el conteo anterior; como las compras de insumos no se cargan por cantidad, sirve como referencia y no como consumo exacto.</p>', 'izquierda')}
      </div>
      ${barra}
      ${formularioInsumo}
      ${formularioConteo}
      ${
        insumos.length === 0
          ? '<p class="pin-subtitulo">Todavía no hay insumos. Agregá el primero con <em>+ Agregar insumo</em>.</p>'
          : `<table class="tabla-insumos">
        <thead><tr><th>Insumo</th><th>Unidad</th><th>Último conteo</th><th>Anterior</th><th>Diferencia</th><th></th></tr></thead>
        <tbody>
          ${insumos
            .map(
              (i) => `<tr>
            <td>${esc(i.nombre)}</td>
            <td>${esc(i.unidad)}</td>
            <td>${i.ultimo ? `<span class="${i.minimo !== null && i.ultimo.cantidad < i.minimo ? 'stock-falta' : ''}">${textoConteoInsumo(i.ultimo, i.unidad)}</span><div class="gasto-detalle-cheque">${fechaLargaCierre(i.ultimo.fecha)}</div>` : '<span class="texto-suave">Sin contar</span>'}</td>
            <td>${textoConteoInsumo(i.anterior, i.unidad)}</td>
            <td>${i.diferencia === null ? '—' : `${i.diferencia > 0 ? '+' : ''}${formatearCantidad(i.diferencia)}`}</td>
            <td class="celda-centrada"><div class="menu-fila">
              <button class="btn-menu-fila" type="button" aria-label="Acciones de ${esc(i.nombre)}">⋮</button>
              <div class="menu-fila-lista">
                <button type="button" class="item-menu contar-insumo" data-id="${i.id}">Contar</button>
                <button type="button" class="item-menu ver-conteos-insumo" data-id="${i.id}">Ver conteos</button>
                <button type="button" class="item-menu editar-insumo" data-id="${i.id}">Editar</button>
                <button type="button" class="item-menu quitar-insumo" data-id="${i.id}">Quitar</button>
              </div>
            </div></td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>`
      }
    </div>`;

  vincularStockTabToggle();
  vincularBotonAyuda('ayuda-insumos');
  vincularMenuFila();
  if (formInsumo) vincularBotonAyuda('ayuda-insumo-minimo');

  document.getElementById('btn-agregar-insumo')?.addEventListener('click', () => {
    formInsumo = { id: null };
    errorInsumos = null;
    renderInsumosStock();
  });
  app.querySelectorAll('.contar-insumo').forEach((btn) =>
    btn.addEventListener('click', () => {
      formConteo = { soloId: Number(btn.dataset.id) };
      errorInsumos = null;
      renderInsumosStock();
    })
  );
  app.querySelectorAll('.editar-insumo').forEach((btn) =>
    btn.addEventListener('click', () => {
      formInsumo = { id: Number(btn.dataset.id) };
      errorInsumos = null;
      renderInsumosStock();
    })
  );
  app.querySelectorAll('.ver-conteos-insumo').forEach((btn) => btn.addEventListener('click', () => abrirConteosInsumo(insumos.find((i) => i.id === Number(btn.dataset.id)))));
  app.querySelectorAll('.quitar-insumo').forEach((btn) =>
    btn.addEventListener('click', () => {
      const insumo = insumos.find((i) => i.id === Number(btn.dataset.id));
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Quitar insumo</h3>
        <p>¿Seguro que querés quitar <strong>${esc(insumo.nombre)}</strong>? Deja de aparecer en la lista y en los conteos nuevos.</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, quitar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        await window.freska.insumos.quitar(insumo.id);
        cerrarModal();
        mostrarToast('Insumo quitado.', 'ok');
        renderInsumosStock();
      });
    })
  );

  if (formInsumo) {
    document.getElementById('insumo-nombre').focus();
    vincularFormatoCantidad(document.getElementById('insumo-minimo'));
    const cantidadHoy = document.getElementById('insumo-cantidad-hoy');
    if (cantidadHoy) {
      vincularFormatoCantidad(cantidadHoy);
      vincularFlechasCantidad(cantidadHoy);
    }
    document.getElementById('btn-cancelar-insumo').addEventListener('click', () => {
      formInsumo = null;
      errorInsumos = null;
      renderInsumosStock();
    });
    document.getElementById('form-insumo').addEventListener('submit', async (e) => {
      e.preventDefault();
      const datos = {
        nombre: document.getElementById('insumo-nombre').value,
        unidad: document.getElementById('insumo-unidad').value,
        minimo: document.getElementById('insumo-minimo').value.trim() === '' ? null : limpiarNumeroCantidad(document.getElementById('insumo-minimo').value),
      };
      const r = enEdicion ? await window.freska.insumos.actualizar({ ...datos, id: enEdicion.id }) : await window.freska.insumos.crear(datos);
      if (!r.ok) {
        errorInsumos = r.error;
        renderInsumosStock();
        return;
      }
      // Si se puso cuánto hay hoy, queda como primer conteo.
      const hoyTexto = cantidadHoy ? cantidadHoy.value.trim() : '';
      if (!enEdicion && hoyTexto !== '' && r.id) {
        const c = await window.freska.insumos.contar({ fecha: fechaHoyISO(), conteos: [{ insumo_id: r.id, cantidad: limpiarNumeroCantidad(hoyTexto) }] });
        if (!c.ok) mostrarToast(c.error, 'error');
      }
      formInsumo = null;
      errorInsumos = null;
      mostrarToast('Insumo guardado.', 'ok');
      renderInsumosStock();
    });
  }

  if (formConteo) {
    vincularSelectorFecha('conteo-fecha', fecha, (nueva) => {
      document.getElementById('conteo-fecha').value = formatearFechaCorta(nueva || fechaHoyISO());
    });
    app.querySelectorAll('.conteo-cantidad').forEach((input) => {
      vincularFormatoCantidad(input);
      vincularFlechasCantidad(input);
    });
    app.querySelector('.conteo-cantidad')?.focus();
    document.getElementById('btn-cancelar-conteo').addEventListener('click', () => {
      formConteo = null;
      errorInsumos = null;
      renderInsumosStock();
    });
    document.getElementById('form-conteo').addEventListener('submit', async (e) => {
      e.preventDefault();
      const iso = fechaCortaAIso(document.getElementById('conteo-fecha').value);
      const r = !iso
        ? { ok: false, error: 'La fecha no es válida.' }
        : await window.freska.insumos.contar({
            fecha: iso,
            conteos: [...app.querySelectorAll('.conteo-cantidad')].map((input) => ({ insumo_id: Number(input.dataset.id), cantidad: input.value.trim() === '' ? '' : limpiarNumeroCantidad(input.value) })),
          });
      if (!r.ok) {
        errorInsumos = r.error;
        renderInsumosStock();
        return;
      }
      formConteo = null;
      errorInsumos = null;
      mostrarToast(r.cantidad === 1 ? 'Conteo guardado.' : `Conteo guardado (${r.cantidad} insumos).`, 'ok');
      renderInsumosStock();
    });
  }
}

// Todos los conteos de un insumo, del más nuevo al más viejo (por si hay que borrar uno cargado por error).
async function abrirConteosInsumo(insumo) {
  const conteos = await window.freska.insumos.conteos(insumo.id);
  mostrarModal(`${modalXHtml('modal-cerrar')}
    <h3>Conteos de ${esc(insumo.nombre)}</h3>
    <div class="caja-movimientos">
      <table>
        <thead><tr><th>Fecha</th><th>Cantidad</th><th></th></tr></thead>
        <tbody>
          ${
            conteos.length === 0
              ? '<tr><td colspan="3">Todavía no hay conteos.</td></tr>'
              : conteos.map((c) => `<tr><td>${fechaLargaCierre(c.fecha)}</td><td>${textoConteoInsumo(c, insumo.unidad)}</td><td class="celda-centrada"><button type="button" class="btn-redondo btn-tacho quitar-conteo-insumo" data-id="${c.id}" aria-label="Quitar este conteo" title="Quitar conteo">${TACHITO_SVG}</button></td></tr>`).join('')
          }
        </tbody>
      </table>
    </div>
  `);
  document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
  document.querySelectorAll('.quitar-conteo-insumo').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await window.freska.insumos.quitarConteo(Number(btn.dataset.id));
      await abrirConteosInsumo(insumo);
      renderInsumosStock();
    })
  );
}

// ---------- Rendimiento ----------
// Por tipo de carne y período: kilos comprados, producidos y vendidos, y el rinde (producido ÷ comprado).

let rendimientoDesde = '';
let rendimientoHasta = '';

async function renderRendimientoStock() {
  if (!rendimientoDesde) {
    const hoy = new Date();
    rendimientoDesde = primerDiaDelMes(hoy.getFullYear(), hoy.getMonth());
    rendimientoHasta = ultimoDiaDelMes(hoy.getFullYear(), hoy.getMonth());
  }
  const res = await window.freska.stock.rendimiento({ desde: rendimientoDesde, hasta: rendimientoHasta });
  const kg = (n) => `${formatearCantidad(n)} kg`;
  const rinde = (f) => (f.comprado > 0 && f.tipo !== 'Sin tipo' ? `${formatearCantidad(Math.round((f.producido / f.comprado) * 1000) / 10)} %` : '—');
  const filaHtml = (f, esTotal) => `<tr class="${esTotal ? 'fila-total-rendimiento' : ''}${!esTotal && f.tipo === 'Sin tipo' ? ' fila-clickeable fila-sin-tipo' : ''}" ${!esTotal && f.tipo === 'Sin tipo' ? 'tabindex="0" title="Ver qué artículos no tienen tipo de carne"' : ''}>
      <td>${esTotal ? 'Total' : esc(f.tipo)}${!esTotal && f.tipo === 'Sin tipo' ? ' <span class="est-barra-detalle">· ver cuáles</span>' : ''}</td>
      <td>${kg(f.comprado)}</td>
      <td>${kg(f.producido)}</td>
      <td>${rinde(f)}</td>
      <td>${kg(f.vendido)}</td>
    </tr>`;
  app.innerHTML = `
    <div class="stock-pantalla">
      ${stockTabToggleHtml()}
      <div class="cierre-titulo-fila" style="margin-top:0">
        <h2>Rendimiento</h2>
        ${botonAyudaHtml('ayuda-rendimiento', 'Cómo se calcula', '<p>El <strong>rinde</strong> es cuántos kilos de producto salen por cada kilo comprado: <em>producido ÷ comprado</em>. Si comprás 100 kg de vaca y producís 74 kg, el rinde es 74 %.</p><p><strong>Comprado</strong> son los kilos de las compras a proveedor, por tipo de carne. <strong>Producido</strong> es lo que cargaste en <em>Producción</em>, según el tipo de cada artículo del Stock. <strong>Vendido</strong> son los kilos facturados de esos productos.</p><p>Si un producto lleva otras cosas además de carne (las milanesas, con huevo y pan rallado), con el botón <em>Stock</em> de Productos cargá cuánta carne lleva cada kilo (<em>Lleva carne</em>, por ejemplo 70 %): para el rinde solo cuenta esa parte, tanto en lo producido como en lo vendido. Vacío = 100 %.</p><p>Lo que no tiene tipo asignado va en <em>Sin tipo</em>: elegí el tipo de cada artículo con el botón <em>Stock</em>, en Productos.</p><p>Si lo que comprás un mes se produce recién el mes siguiente, el rinde de un mes suelto sale desparejo: para un número más confiable, mirá un período largo (por ejemplo, tres meses). Y el rinde solo es tan bueno como lo cargado: si un día no se carga la producción, baja sin que sea real.</p>', 'izquierda')}
      </div>
      <div class="toolbar toolbar-junta">
        ${selectorRangoHtml('filtro-rango-rendimiento', rendimientoDesde, rendimientoHasta)}
      </div>
      ${
        !res.ok || res.tipos.length === 0
          ? `<p class="pin-subtitulo">${res.ok ? 'No hay compras, producción ni ventas en ese período.' : esc(res.error)}</p>`
          : `<table class="tabla-rendimiento">
        <thead><tr><th>Tipo</th><th>Comprado</th><th>Producido</th><th>Rinde</th><th>Vendido</th></tr></thead>
        <tbody>${res.tipos.map((f) => filaHtml(f, false)).join('')}${res.tipos.length > 1 ? filaHtml({ ...res.total }, true) : ''}</tbody>
      </table>`
      }
    </div>`;
  vincularStockTabToggle();
  vincularBotonAyuda('ayuda-rendimiento');
  app.querySelectorAll('.fila-sin-tipo').forEach((fila) => {
    fila.addEventListener('click', abrirSinTipoRendimiento);
    fila.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === fila) abrirSinTipoRendimiento();
    });
  });
  vincularSelectorRango('filtro-rango-rendimiento', rendimientoDesde, rendimientoHasta, ({ desde, hasta }) => {
    rendimientoDesde = desde;
    rendimientoHasta = hasta;
    renderRendimientoStock();
  });
}

// Qué artículos suma la fila "Sin tipo": los que se produjeron o vendieron en el período sin tener tipo de carne.
async function abrirSinTipoRendimiento() {
  const r = await window.freska.stock.sinTipo({ desde: rendimientoDesde, hasta: rendimientoHasta });
  if (!r.ok) {
    mostrarToast(r.error, 'error');
    return;
  }
  const kg = (n) => `${formatearCantidad(n)} kg`;
  mostrarModal(`
    ${MODAL_X_HTML}
    <h3>Sin tipo de carne</h3>
    <p class="pin-subtitulo">${formatearFechaCorta(rendimientoDesde)} → ${formatearFechaCorta(rendimientoHasta)}</p>
    ${
      r.articulos.length
        ? `<div class="caja-movimientos"><table>
        <thead><tr><th>Artículo</th><th>Producido</th><th>Vendido</th></tr></thead>
        <tbody>${r.articulos.map((a) => `<tr><td>${esc(a.nombre)}</td><td>${kg(a.producido)}</td><td>${kg(a.vendido)}</td></tr>`).join('')}</tbody>
      </table></div>`
        : '<p>No hay artículos sin tipo con producción ni ventas en ese período.</p>'
    }
    ${r.compradoSinProducto > 0 ? `<p class="pin-subtitulo">Además, ${kg(r.compradoSinProducto)} de compras a proveedores sin producto elegido (Proveedores → compra).</p>` : ''}
    <p class="pin-subtitulo">Para cargarles el tipo: Productos → Stock del producto. Si un producto comparte stock con otro, el tipo va en el que tiene el stock propio.</p>
  `);
  document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
}

// ---------- Stock ----------

async function renderListaStock(res) {
  const sinConfigurar = res.productos.filter((p) => !p.articulo_id || !p.kg_por_unidad);
  app.innerHTML = `
    <div class="stock-pantalla">
      ${stockTabToggleHtml()}
      <div class="cierre-titulo-fila" style="margin-top:0">
        <h2>Stock</h2>
        ${botonAyudaHtml('ayuda-stock', 'Cómo se calcula', '<p>El stock se lleva en <strong>kilos</strong> por artículo (hamburguesas, picada, chorizos secos…).</p><p><strong>Hay</strong> = lo que se produjo y ajustaste, menos lo que se facturó desde el ' + esc(fechaLargaCierre(res.desde)) + '. Las facturas descuentan solas (una anulada no descuenta).</p><p><strong>Pedido</strong> es lo que se pidió y todavía no se facturó. <strong>Disponible</strong> = Hay − Pedido.</p><p>Con <em>Ajustar</em> dejás el número igual al que contaste. Cada producto lleva su propio stock. Si se vende por unidad (caja, bolsa), en <em>Productos</em> se dice cuánto pesa cada una, y lo que se vende suelto puede compartir el stock de la caja.</p><p><strong>Tipo</strong> es de qué carne sale (Vaca, Cerdo, Pollo), la misma lista que usás al cargar una compra — sirve para más adelante poder comparar cuánto se compró de cada tipo contra cuánto se produjo. Se elige con el botón <em>Stock</em> de Productos, junto con <em>Lleva carne</em>.</p>', 'izquierda')}
      </div>
      ${
        sinConfigurar.length
          ? `<p class="stock-aviso">Hay ${sinConfigurar.length} ${sinConfigurar.length === 1 ? 'producto' : 'productos'} sin configurar (${esc(sinConfigurar.map((p) => p.nombre).join(', '))}): configuralos con el botón <em>Stock</em>, en <button type="button" class="enlace-boton" id="ir-productos-stock">Productos</button>.</p>`
          : ''
      }
      ${
        res.articulos.length === 0
          ? '<p class="pin-subtitulo">Todavía no hay stock. Cada producto lo lleva solo: los que se venden por kilo aparecen acá, y los que se venden por unidad cuando les cargás cuánto pesa en Productos.</p>'
          : `<table class="tabla-stock tabla-stock-resumen">
        <thead><tr><th>Artículo</th><th>Tipo</th><th>Hay</th><th>Pedido</th><th>Disponible</th><th>Producción</th><th></th></tr></thead>
        <tbody>
          ${res.articulos
            .map(
              (a) => `<tr>
            <td>${esc(a.nombre)}</td>
            <td>${a.tipo ? carnesHtml(a.carnes, a.tipo) : '<span class="texto-suave">—</span>'}</td>
            <td class="${a.stock < 0 ? 'stock-falta' : ''}"><strong>${kilosTexto(a.stock)}</strong>${a.cajas !== null && a.cajas !== undefined ? `<div class="gasto-detalle-cheque">${formatearCantidad(a.cajas)} ${a.cajas === 1 ? 'caja' : 'cajas'}</div>` : ''}</td>
            <td>${a.pendiente ? kilosTexto(a.pendiente) : '<span class="texto-suave">—</span>'}</td>
            <td class="${a.disponible < 0 ? 'stock-falta' : ''}">${kilosTexto(a.disponible)}</td>
            <td>${a.ultimaProduccion ? fechaLargaCierre(a.ultimaProduccion) : '<span class="texto-suave">—</span>'}</td>
            <td class="celda-centrada"><div class="menu-fila"><button class="btn-menu-fila" type="button" aria-label="Acciones">⋮</button><div class="menu-fila-lista"><button type="button" class="item-menu ajustar-stock" data-id="${a.id}" data-nombre="${esc(a.nombre)}" data-stock="${a.stock}" data-hoy="${a.ajusteHoy ? '1' : ''}">${a.ajusteHoy ? 'Editar el ajuste de hoy' : 'Ajustar stock'}</button></div></div></td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>`
      }
    </div>`;
  vincularStockTabToggle();
  vincularBotonAyuda('ayuda-stock');
  document.getElementById('ir-productos-stock')?.addEventListener('click', () => {
    registrarOrigenVolver('productos', 'stock', 'stock');
    irAVista(document.querySelector('nav button[data-view="productos"]'));
  });
  vincularMenuFila();
  app.querySelectorAll('.ajustar-stock').forEach((btn) => {
    btn.addEventListener('click', () => {
      const yaContadoHoy = btn.dataset.hoy === '1';
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>${yaContadoHoy ? 'Editar el ajuste de hoy de' : 'Ajustar stock de'} ${esc(btn.dataset.nombre)}</h3>
        <p>${yaContadoHoy ? 'Ya se contó este artículo hoy. La app dice que hay' : 'La app dice que hay'} <strong>${kilosTexto(Number(btn.dataset.stock))}</strong>. Poné cuánto hay realmente.</p>
        <div class="input-moneda caja-ajuste"><span>kg</span><input type="text" inputmode="decimal" id="ajuste-stock-kilos" value="${esc(formatearCantidad(Number(btn.dataset.stock)))}" autocomplete="off" aria-label="Kilos que hay" /></div>
        <p id="modal-error" class="error-msg" style="display:none"></p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary">${yaContadoHoy ? 'Guardar' : 'Ajustar'}</button>
        </div>
      `);
      const campo = document.getElementById('ajuste-stock-kilos');
      vincularFormatoCantidad(campo);
      vincularFlechasCantidad(campo);
      campo.focus();
      campo.select();
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      const confirmar = async () => {
        const r = await window.freska.stock.ajustar({ articulo_id: Number(btn.dataset.id), kilos_reales: limpiarNumeroCantidad(campo.value) });
        if (!r.ok) {
          const e = document.getElementById('modal-error');
          e.textContent = r.error;
          e.style.display = '';
          return;
        }
        cerrarModal();
        mostrarToast('Stock ajustado.', 'ok');
        renderStock();
      };
      document.getElementById('modal-confirmar').addEventListener('click', confirmar);
      campo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmar();
      });
    });
  });
}

// ---------- Producción ----------

let produccionDesde = '';
let produccionHasta = '';

async function renderProduccionStock(res) {
  if (!produccionDesde) {
    const hoy = new Date();
    produccionDesde = primerDiaDelMes(hoy.getFullYear(), hoy.getMonth());
    produccionHasta = ultimoDiaDelMes(hoy.getFullYear(), hoy.getMonth());
  }
  const [movimientos, producido] = await Promise.all([
    window.freska.stock.movimientos({ limite: limiteMovimientosStock, desde: produccionDesde, hasta: produccionHasta }),
    window.freska.stock.producidoPorArticulo({ desde: produccionDesde, hasta: produccionHasta }),
  ]);
  const fecha = fechaProduccionForm || fechaHoyISO();
  app.innerHTML = `
    <div class="stock-pantalla">
      ${stockTabToggleHtml()}
      <div class="cierre-titulo-fila" style="margin-top:0">
        <h2>Producción</h2>
        ${botonAyudaHtml('ayuda-produccion', 'Producción', '<p>Cargá lo que se va produciendo, el día que se produce (por ejemplo, los chorizos secos los días que se hacen). Suma al stock.</p><p>Podés ponerlo en <strong>kilos</strong> o en <strong>cajas</strong>: con cajas, la app usa cuánto pesa cada una (la de hamburguesas y picada ya lo sabe por el producto; si no, la primera vez te pide el peso y lo recuerda).</p><p>Si cargaste algo mal, el tachito lo quita.</p>', 'izquierda')}
      </div>
      <div class="panel gasto-form">
        <div class="gasto-fila">
          <div class="gasto-campo"><span>Fecha</span>${selectorFechaHtml('produccion-fecha', fecha)}</div>
          <label class="gasto-campo">
            <span>Qué se produjo</span>
            <select id="produccion-articulo">
              <option value="">Elegí uno…</option>
              ${res.articulos.map((a) => `<option value="${a.id}" ${String(a.id) === String(articuloProduccionForm) ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('')}
            </select>
          </label>
          <label class="gasto-campo"><span>Cantidad</span><div class="peso-unidad"><div class="input-moneda producto-kg"><input type="text" id="produccion-kilos" inputmode="decimal" autocomplete="off" placeholder="0" /></div><select id="produccion-unidad" aria-label="En kilos o en cajas"><option value="kg" ${unidadProduccionForm === 'kg' ? 'selected' : ''}>kg</option><option value="cajas" ${unidadProduccionForm === 'cajas' ? 'selected' : ''}>cajas</option></select></div></label>
          <label class="gasto-campo" id="produccion-peso-caja-campo" hidden><span>Cada caja pesa</span><div class="input-moneda producto-kg"><span>kg</span><input type="text" id="produccion-peso-caja" inputmode="decimal" autocomplete="off" placeholder="0" /></div></label>
          <label class="gasto-campo gasto-campo-observacion"><span>Nota (opcional)</span>${campoLimpiableHtml('<input type="text" id="produccion-nota" maxlength="200" placeholder="Ej: tanda de la mañana" autocomplete="off" />')}</label>
          <button type="button" id="btn-agregar-produccion" class="btn-redondo btn-mas" aria-label="Agregar producción" title="Agregar producción">+</button>
        </div>
        <p id="error-produccion" class="error-msg" style="display:none"></p>
      </div>

      <div class="toolbar toolbar-junta">
        ${selectorRangoHtml('filtro-rango-produccion', produccionDesde, produccionHasta)}
      </div>
      <h2>Producido por artículo</h2>
      ${
        !producido.ok || producido.filas.length === 0
          ? `<p class="pin-subtitulo">${producido.ok ? 'No hay producción cargada en ese período.' : esc(producido.error)}</p>`
          : `<table class="tabla-stock">
        <thead><tr><th>Artículo</th><th>Kilos producidos</th><th>Tandas</th><th>Promedio por tanda</th><th>Última vez</th></tr></thead>
        <tbody>${producido.filas.map((f) => `<tr><td>${esc(f.nombre)}</td><td><strong>${kilosTexto(f.kilos)}</strong></td><td>${f.tandas}</td><td>${kilosTexto(f.promedio)}</td><td>${formatearFechaCorta(f.ultima)}</td></tr>`).join('')}</tbody>
        ${producido.filas.length > 1 ? `<tfoot><tr><td><strong>Total</strong></td><td><strong>${kilosTexto(producido.total)}</strong></td><td><strong>${producido.tandas}</strong></td><td></td><td></td></tr></tfoot>` : ''}
      </table>`
      }

      <h2>Movimientos</h2>
      ${
        movimientos.length === 0
          ? '<p class="pin-subtitulo">No hay movimientos en ese período.</p>'
          : `<table class="tabla-stock">
        <thead><tr><th>Día</th><th>Artículo</th><th>Tipo</th><th>Kilos</th><th>Nota</th><th></th></tr></thead>
        <tbody>
          ${movimientos
            .map(
              (m) => `<tr>
            <td>${fechaLargaCierre(m.fecha)}</td>
            <td>${esc(m.articulo || '')}</td>
            <td>${m.tipo === 'produccion' ? 'Producción' : 'Ajuste'}</td>
            <td class="${m.kilos < 0 ? 'stock-falta' : ''}">${m.tipo === 'ajuste' && m.kilos > 0 ? '+' : ''}${kilosTexto(m.kilos)}</td>
            <td>${esc(m.nota || '')}</td>
            <td class="celda-centrada"><button type="button" class="btn-redondo btn-tacho quitar-movimiento-stock" data-id="${m.id}" aria-label="Quitar movimiento" title="Quitar movimiento">${TACHITO_SVG}</button></td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>${movimientos.length >= limiteMovimientosStock ? '<p style="text-align:center;margin-top:16px;"><button type="button" id="ver-mas-movimientos-stock">Ver más antiguos</button></p>' : ''}`
      }
    </div>`;
  vincularStockTabToggle();
  vincularBotonAyuda('ayuda-produccion');
  vincularSelectorRango('filtro-rango-produccion', produccionDesde, produccionHasta, ({ desde, hasta }) => {
    produccionDesde = desde;
    produccionHasta = hasta;
    limiteMovimientosStock = 60;
    renderStock();
  });
  vincularFormatoCantidad(document.getElementById('produccion-kilos'));
  vincularFlechasCantidad(document.getElementById('produccion-kilos'));
  vincularCampoLimpiable(document.getElementById('produccion-nota'));
  vincularSelectorFecha('produccion-fecha', fecha, (nueva) => {
    fechaProduccionForm = nueva || fechaHoyISO();
    document.getElementById('produccion-fecha').value = formatearFechaCorta(fechaProduccionForm);
  });
  vincularFormatoCantidad(document.getElementById('produccion-peso-caja'));
  // Por cajas: si esa cosa ya sabe cuánto pesa una caja (o el producto por unidad lo dice), se usa; si no, se pide una vez.
  const actualizarPesoCaja = () => {
    const art = res.articulos.find((a) => String(a.id) === document.getElementById('produccion-articulo').value);
    const porCajas = document.getElementById('produccion-unidad').value === 'cajas';
    const campo = document.getElementById('produccion-peso-caja-campo');
    campo.hidden = !(porCajas && art && !art.kg_por_caja);
  };
  document.getElementById('produccion-unidad').addEventListener('change', (e) => {
    unidadProduccionForm = e.target.value;
    actualizarPesoCaja();
  });
  actualizarPesoCaja();
  document.getElementById('produccion-articulo').addEventListener('change', (e) => {
    articuloProduccionForm = e.target.value;
    actualizarPesoCaja();
  });
  const agregar = async () => {
    const errorEl = document.getElementById('error-produccion');
    const iso = fechaCortaAIso(document.getElementById('produccion-fecha').value);
    const r = !iso
      ? { ok: false, error: 'La fecha no es válida.' }
      : await window.freska.stock.producir({
          fecha: iso,
          articulo_id: Number(document.getElementById('produccion-articulo').value) || null,
          ...(document.getElementById('produccion-unidad').value === 'cajas'
            ? { cajas: limpiarNumeroCantidad(document.getElementById('produccion-kilos').value), kg_por_caja: limpiarNumeroCantidad(document.getElementById('produccion-peso-caja').value) || null }
            : { kilos: limpiarNumeroCantidad(document.getElementById('produccion-kilos').value) }),
          nota: document.getElementById('produccion-nota').value,
        });
    if (!r.ok) {
      errorEl.textContent = r.error;
      errorEl.style.display = 'block';
      return;
    }
    mostrarToast('Producción cargada.', 'ok');
    await renderStock();
    document.getElementById('produccion-kilos')?.focus();
  };
  document.getElementById('btn-agregar-produccion').addEventListener('click', agregar);
  ['produccion-kilos', 'produccion-nota'].forEach((id) =>
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      agregar();
    })
  );
  app.querySelectorAll('.quitar-movimiento-stock').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.freska.stock.quitarMovimiento(Number(btn.dataset.id));
      mostrarToast('Movimiento quitado.', 'ok');
      renderStock();
    });
  });
  document.getElementById('ver-mas-movimientos-stock')?.addEventListener('click', () => {
    limiteMovimientosStock += 60;
    renderStock();
  });
}


// ---------- Stock de un producto (se carga al agregar o editar un producto, en Productos) ----------
// Cada producto lleva su propio stock. Solo hace falta decir cuánto pesa cada unidad (si se vende por unidad) y, si
// corresponde, que comparte el stock de otro producto (la hamburguesa suelta sale del stock de la caja).

// "Tipo de carne" (Vaca, Cerdo, Pollo…) para un producto, en el botón Stock de Productos: lista propia y chica
// (`tiposCarneCache`, tabla `tipos_carne`), separada de la de Proveedores (`tipos_producto`, que es para
// anotar cualquier compra, no solo carne). Vive en este archivo porque es el único lugar que la usa.
let tiposCarneCache = [];

// Un producto puede llevar más de una carne (chorizo fresco: vaca y cerdo), cada una con su porcentaje; suman 100 %.
// El valor del campo oculto es un JSON `[{ tipo, porcentaje }]` ('' = sin tipo). Con una sola carne no se pide porcentaje.
function tipoSegmentadoHtml(id) {
  return `<div class="tipo-segmentado" role="group" aria-label="Tipo de carne">
    <input type="hidden" id="${id}" value="" />
    ${tiposCarneCache.map((t) => `<button type="button" class="tipo-opcion" data-tipo="${esc(t.nombre)}">${esc(t.nombre)}</button>`).join('')}
    <button type="button" class="tipo-opcion tipo-editar" data-tipo="__editar__" title="Editar tipos" aria-label="Editar tipos">✎</button>
  </div>`;
}

function leerCarnesCampo(campo) {
  try {
    const lista = JSON.parse(campo.value || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function escribirCarnesCampo(campo, carnes) {
  campo.value = carnes.length ? JSON.stringify(carnes) : '';
}

// Acepta lo que venga de la base (lista), de un valor guardado del campo (JSON) o un tipo suelto de una versión vieja.
function carnesDesde(valor) {
  if (Array.isArray(valor)) return valor.map((c) => ({ tipo: c.tipo, porcentaje: c.porcentaje }));
  if (typeof valor === 'string' && valor.trim().startsWith('[')) {
    try {
      return carnesDesde(JSON.parse(valor));
    } catch {
      return [];
    }
  }
  return valor ? [{ tipo: String(valor), porcentaje: 100 }] : [];
}

function totalCarnes(carnes) {
  return Math.round(carnes.reduce((acc, c) => acc + (Number(c.porcentaje) || 0), 0) * 100) / 100;
}

// Las carnes de una pila para la tabla de Stock: una por renglón con su porcentaje ("Vaca 70 %"), o solo el nombre si lleva una sola.
function carnesHtml(carnes, tipo) {
  if (carnes && carnes.length > 1) return carnes.map((c) => `<div class="carne-linea">${esc(c.tipo)} <span class="texto-suave">${formatearCantidad(c.porcentaje)} %</span></div>`).join('');
  return esc((carnes && carnes[0] && carnes[0].tipo) || tipo || '');
}

// Marca las carnes elegidas y, si hay más de una, muestra el porcentaje de cada una con el total.
function pintarMezclaCarnes(campo) {
  const grupo = campo.parentElement;
  const mezcla = grupo.parentElement.querySelector('.sp-mezcla');
  const carnes = leerCarnesCampo(campo);
  grupo.querySelectorAll('.tipo-opcion').forEach((b) => b.classList.toggle('active', carnes.some((c) => c.tipo === b.dataset.tipo)));
  if (carnes.length < 2) {
    mezcla.innerHTML = '';
    return;
  }
  mezcla.innerHTML = `${carnes
    .map(
      (c, i) => `<label class="sp-mezcla-fila"><span class="sp-mezcla-nombre">${esc(c.tipo)}</span><span class="input-porcentaje producto-kg"><input type="text" inputmode="decimal" class="sp-mezcla-pct" data-i="${i}" maxlength="6" value="${esc(formatearCantidad(c.porcentaje))}" autocomplete="off" aria-label="Porcentaje de ${esc(c.tipo)}" /><span>%</span></span></label>`
    )
    .join('')}<span class="sp-mezcla-total"></span>`;
  const total = mezcla.querySelector('.sp-mezcla-total');
  const actualizarTotal = () => {
    const suma = totalCarnes(leerCarnesCampo(campo));
    const bien = Math.abs(suma - 100) <= 0.01;
    total.textContent = bien ? 'Suman 100 %' : `Suman ${formatearCantidad(suma)} %: tienen que sumar 100`;
    total.classList.toggle('visible', !bien);
  };
  actualizarTotal();
  mezcla.querySelectorAll('.sp-mezcla-pct').forEach((input) => {
    vincularFormatoCantidad(input);
    input.addEventListener('input', () => {
      const lista = leerCarnesCampo(campo);
      lista[Number(input.dataset.i)].porcentaje = limpiarNumeroCantidad(input.value) || 0;
      escribirCarnesCampo(campo, lista);
      actualizarTotal();
    });
  });
}

function vincularTipoSegmentado(id, alCambiarLista) {
  const campo = document.getElementById(id);
  const grupo = campo.parentElement;
  grupo.querySelectorAll('.tipo-opcion').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tipo === '__editar__') {
        abrirEditorTiposCarne(alCambiarLista);
        return;
      }
      let carnes = leerCarnesCampo(campo);
      if (carnes.some((c) => c.tipo === btn.dataset.tipo)) carnes = carnes.filter((c) => c.tipo !== btn.dataset.tipo);
      else carnes.push({ tipo: btn.dataset.tipo, porcentaje: 0 });
      // Al sumar o sacar una carne, se reparte parejo (el 100 % entre las que quedan); después se ajusta a mano.
      const parte = Math.floor((10000 / (carnes.length || 1))) / 100;
      carnes.forEach((c, i) => (c.porcentaje = i === carnes.length - 1 ? Math.round((100 - parte * (carnes.length - 1)) * 100) / 100 : parte));
      escribirCarnesCampo(campo, carnes);
      pintarMezclaCarnes(campo);
    });
  });
  pintarMezclaCarnes(campo);
}

// Mismo patrón que `abrirEditorTipos` de Proveedores (agregar/sacar de una lista propia), pero sobre
// `tipos_carne` en vez de `tipos_producto`.
async function abrirEditorTiposCarne(alCerrar) {
  let cambio = false;
  const pintar = async () => {
    tiposCarneCache = await window.freska.stock.tiposCarne();
    mostrarModal(`
      <h3>Tipo de carne</h3>
      <p class="pin-subtitulo">Son las opciones de "Tipo de carne" al editar un producto. Para que se cruce con lo comprado en el rendimiento, tiene que llamarse igual que en Proveedores. Sacar uno no cambia lo que ya cargaste.</p>
      <div class="retiro-sugerencias" style="margin:10px 0">
        ${
          tiposCarneCache.length
            ? tiposCarneCache
                .map(
                  (t) => `<span class="chip-retiro-grupo"><span class="chip-retiro chip-texto">${esc(t.nombre)}</span><button type="button" class="chip-retiro-x quitar-tipo-carne" data-id="${t.id}" aria-label="Sacar ${esc(t.nombre)}" title="Sacar">×</button></span>`
                )
                .join('')
            : '<span class="pin-subtitulo">No hay tipos.</span>'
        }
      </div>
      <div class="fila-producto-proveedor">
        <input type="text" id="nuevo-tipo-carne" maxlength="40" placeholder="Nuevo tipo (ej: Cordero)" autocomplete="off" />
        <button type="button" id="btn-agregar-tipo-carne" class="btn-redondo btn-mas" aria-label="Agregar tipo" title="Agregar">+</button>
      </div>
      <p id="error-tipo-carne" class="error-msg" style="display:none"></p>
      <div class="btn-group" style="margin-top:14px">
        <button type="button" id="modal-cerrar-tipos-carne" class="primary">Listo</button>
      </div>
    `);
    const agregar = async () => {
      const resultado = await window.freska.stock.agregarTipoCarne(document.getElementById('nuevo-tipo-carne').value);
      if (!resultado.ok) {
        const el = document.getElementById('error-tipo-carne');
        el.textContent = resultado.error;
        el.style.display = 'block';
        return;
      }
      cambio = true;
      await pintar();
      document.getElementById('nuevo-tipo-carne').focus();
    };
    document.getElementById('btn-agregar-tipo-carne').addEventListener('click', agregar);
    document.getElementById('nuevo-tipo-carne').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      agregar();
    });
    document.querySelectorAll('.quitar-tipo-carne').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await window.freska.stock.quitarTipoCarne(Number(btn.dataset.id));
        cambio = true;
        pintar();
      });
    });
    document.getElementById('modal-cerrar-tipos-carne').addEventListener('click', () => {
      cerrarModal();
      if (cambio && alCerrar) alCerrar();
    });
    document.getElementById('nuevo-tipo-carne').focus();
  };
  await pintar();
}

function camposStockProductoHtml(productosStock, actual, unidad, propioId) {
  const kg = actual && actual.kg_por_unidad ? actual.kg_por_unidad : 0;
  const enGramos = kg > 0 && kg < 1;
  const base = actual ? actual.de_producto_id : null;
  return `<div class="campos-stock-producto">
    <div class="campos-stock-fila">
      <label class="gasto-campo sp-peso-campo" ${unidad === 'kg' ? 'hidden' : ''}><span class="sp-peso-etiqueta">${unidad === 'caja' ? 'Cada caja pesa' : 'Cada unidad pesa'}</span>
        <div class="peso-unidad"><div class="input-moneda producto-kg"><input type="text" inputmode="decimal" class="sp-kg" value="${kg ? esc(formatearCantidad(enGramos ? kg * 1000 : kg)) : ''}" placeholder="0" autocomplete="off" /></div><select class="sp-kg-unidad" aria-label="Unidad de peso"><option value="kg" ${enGramos ? '' : 'selected'}>kg</option><option value="g" ${enGramos ? 'selected' : ''}>g</option></select></div>
      </label>
      <div class="gasto-campo"><span>Comparte el stock con ${botonAyudaHtml('ayuda-comparte-stock', 'Comparte el stock', '<p>Si este producto sale del mismo stock que otro (por ejemplo, la hamburguesa suelta y la caja), elegí cuál. Los dos descuentan de la misma cantidad.</p><p>El <strong>tipo de carne</strong>, <strong>cuánta carne lleva</strong> y el <strong>aviso de mínimo</strong> son del stock compartido: se cargan en el otro producto (el que tiene su propio stock) y acá no se piden.</p>', 'izquierda')}</span>
        <select class="sp-base"><option value="">Ninguno (tiene su propio stock)</option>${productosStock.filter((p) => p.id !== propioId).map((p) => `<option value="${p.id}" ${p.id === base ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="sp-carne-fila" ${base ? 'hidden' : ''}>
      <div class="campos-stock-fila">
        <div class="gasto-campo"><span>Tipo de carne ${botonAyudaHtml('ayuda-tipo-carne-producto', 'Más de un tipo de carne', '<p>Si el producto lleva más de una carne (el chorizo fresco, por ejemplo, vaca y cerdo), tocá las que lleva y poné qué porcentaje es de cada una. Tienen que sumar 100 %.</p><p>Eso reparte el rendimiento: lo producido y vendido cuenta para cada carne según su porcentaje. Con una sola carne no hace falta poner nada.</p>', 'izquierda')}</span>${tipoSegmentadoHtml('sp-tipo')}<div class="sp-mezcla"></div></div>
      </div>
    </div>
    <div class="campos-stock-fila">
      <div class="gasto-campo sp-carne-campo" ${base ? 'hidden' : ''}><span>Lleva carne ${botonAyudaHtml('ayuda-carne-producto', 'Cuánta carne lleva', '<p>Para el <strong>rendimiento</strong> solo cuenta la parte de carne. Si un kilo de milanesa lleva 70 % de carne (el resto es huevo, pan rallado…), poné <em>70</em>. Vacío = 100 % (carne pura).</p>', 'izquierda')}</span>
        <span class="input-porcentaje producto-kg"><input type="text" inputmode="decimal" class="sp-carne" maxlength="3" value="${actual && actual.carne_pct ? esc(formatearCantidad(actual.carne_pct)) : ''}" placeholder="100" autocomplete="off" aria-label="Porcentaje de carne" /><span>%</span></span>
        <span class="campo-error-linea sp-carne-error">Entre 1 y 100.</span>
      </div>
      <div class="gasto-campo sp-minimo-campo" ${base ? 'hidden' : ''}><span>Avisar si queda menos de ${botonAyudaHtml('ayuda-minimo-producto', 'Aviso de stock bajo', '<p>Opcional. Cuando el stock de este producto (en kilos) baje de esta cantidad, la campanita te avisa. Un stock en negativo no avisa: suele ser producción sin cargar.</p>', 'izquierda')}</span>
        <span class="input-porcentaje producto-kg"><input type="text" inputmode="decimal" class="sp-minimo" value="${actual && actual.minimo ? esc(formatearCantidad(actual.minimo)) : ''}" placeholder="Sin aviso" autocomplete="off" aria-label="Mínimo de stock en kilos" /><span>kg</span></span>
      </div>
    </div>
  </div>`;
}

// El peso solo se pide si el producto se vende por unidad. `alCambiarTipos`, si viene, reemplaza el
// refresco en el lugar de siempre (pensado para cuando `contenedor` sigue en la pantalla, como el viejo
// formulario de Productos) — hace falta cuando `contenedor` vive adentro de un cuadro (mostrarModal), porque
// agregar un tipo abre otro cuadro que lo pisa, y `contenedor` ya no sirve para nada al volver.
function vincularCamposStockProducto(contenedor, leerUnidad, tipoActual, alCambiarTipos) {
  const peso = contenedor.querySelector('.sp-peso-campo');
  const actualizarPeso = () => {
    peso.hidden = leerUnidad() === 'kg';
    peso.querySelector('.sp-peso-etiqueta').textContent = leerUnidad() === 'caja' ? 'Cada caja pesa' : 'Cada unidad pesa';
  };
  actualizarPeso();
  contenedor.__actualizarPeso = actualizarPeso;
  vincularFormatoCantidad(contenedor.querySelector('.sp-kg'));
  // Aviso al tipear, antes de guardar: no tiene sentido un porcentaje de carne fuera de 1-100.
  const campoCarneValor = contenedor.querySelector('.sp-carne');
  const errorCarne = contenedor.querySelector('.sp-carne-error');
  campoCarneValor.addEventListener('input', () => {
    const texto = campoCarneValor.value.trim().replace(',', '.');
    const valor = Number(texto);
    const invalido = texto !== '' && (!Number.isFinite(valor) || valor <= 0 || valor > 100);
    errorCarne.classList.toggle('visible', invalido);
    campoCarneValor.closest('.input-porcentaje').classList.toggle('campo-invalido', invalido);
  });
  // El tipo de carne y el porcentaje son de la pila de stock: si el producto comparte el stock de otro, se
  // editan en ese otro (acá no tendría sentido repetirlos).
  const base = contenedor.querySelector('.sp-base');
  const carneFila = contenedor.querySelector('.sp-carne-fila');
  const carneCampo = contenedor.querySelector('.sp-carne-campo');
  const minimo = contenedor.querySelector('.sp-minimo-campo');
  base.addEventListener('change', () => {
    carneFila.hidden = Boolean(base.value);
    carneCampo.hidden = Boolean(base.value);
    minimo.hidden = Boolean(base.value);
  });
  // Si se agrega un tipo nuevo desde el "✎", solo se rehace el desplegable, no todo el formulario: así no se
  // pierde lo que ya se cargó de nombre, precio, etc. (solo cuando `contenedor` sigue en la pantalla).
  const refrescarTipos =
    alCambiarTipos ||
    (() => {
      const campo = contenedor.querySelector('#sp-tipo');
      const valorPrevio = campo.value;
      campo.closest('.tipo-segmentado').outerHTML = tipoSegmentadoHtml('sp-tipo');
      const nuevo = contenedor.querySelector('#sp-tipo');
      nuevo.value = valorPrevio;
      vincularTipoSegmentado('sp-tipo', refrescarTipos);
    });
  const campoTipo = contenedor.querySelector('#sp-tipo');
  escribirCarnesCampo(campoTipo, carnesDesde(tipoActual));
  vincularTipoSegmentado('sp-tipo', refrescarTipos);
  vincularBotonAyuda('ayuda-comparte-stock');
  vincularBotonAyuda('ayuda-tipo-carne-producto');
  vincularBotonAyuda('ayuda-carne-producto');
  vincularBotonAyuda('ayuda-minimo-producto');
  vincularFormatoCantidad(contenedor.querySelector('.sp-minimo'));
}

// Mismas validaciones que hace `guardarStockProducto` al guardar, pero antes: para frenar el envío del
// formulario entero (nombre, precio, etc. incluidos) si algo acá está mal, en vez de guardar el producto y
// recién darse cuenta después de que el tipo de carne o el mínimo no entraron.
function validarCamposStockProducto(contenedor, unidad) {
  const base = contenedor.querySelector('.sp-base').value;
  const campoCarne = contenedor.querySelector('.sp-carne');
  if (!campoCarne) return null;
  const texto = campoCarne.value.trim().replace(',', '.');
  if (texto !== '') {
    const valor = Number(texto);
    if (!Number.isFinite(valor) || valor <= 0 || valor > 100) return 'El porcentaje de carne tiene que estar entre 1 y 100.';
  }
  const carnes = leerCarnesCampo(contenedor.querySelector('#sp-tipo'));
  if (!base && carnes.length > 1 && Math.abs(totalCarnes(carnes) - 100) > 0.01) return 'Los porcentajes de las carnes tienen que sumar 100 %.';
  if (!base && unidad !== 'kg') {
    const peso = limpiarNumeroCantidad(contenedor.querySelector('.sp-kg').value);
    const pesoValido = Number.isFinite(peso) && peso > 0;
    const algoCargado = contenedor.querySelector('#sp-tipo').value || texto || contenedor.querySelector('.sp-minimo').value.trim();
    if (!pesoValido && algoCargado) return 'Para guardar el tipo de carne, cuánto lleva o el aviso de mínimo, primero poné cuánto pesa cada unidad.';
  }
  return null;
}

// Guarda el peso de cada unidad y con quién comparte el stock. Devuelve el resultado (con `error` si falta el peso).
async function guardarStockProducto(productoId, contenedor, unidad) {
  const base = contenedor.querySelector('.sp-base').value;
  const valor = limpiarNumeroCantidad(contenedor.querySelector('.sp-kg').value);
  const enGramos = contenedor.querySelector('.sp-kg-unidad').value === 'g';
  const resultado = await window.freska.stock.vincular({
    producto_id: productoId,
    de_producto_id: base ? Number(base) : null,
    kg_por_unidad: unidad === 'kg' ? 1 : enGramos ? valor / 1000 : valor,
  });
  if (!resultado.ok) return resultado;
  // Tipo de carne, cuánta lleva y el aviso de mínimo (solo si el producto tiene su propio stock).
  const campoCarne = contenedor.querySelector('.sp-carne');
  if (!base && campoCarne) {
    const st = await window.freska.stock.resumen();
    const producto = st.productos.find((p) => p.id === productoId);
    if (producto && producto.articulo_id) {
      const rTipo = await window.freska.stock.actualizarCarnes({ articulo_id: producto.articulo_id, carnes: leerCarnesCampo(contenedor.querySelector('#sp-tipo')) });
      if (!rTipo.ok) return rTipo;
      const texto = campoCarne.value.trim().replace(',', '.');
      const r = await window.freska.stock.actualizarCarne({ articulo_id: producto.articulo_id, porcentaje: texto });
      if (!r.ok) return r;
      const rMin = await window.freska.stock.actualizarMinimo({ articulo_id: producto.articulo_id, minimo: contenedor.querySelector('.sp-minimo').value.trim().replace(',', '.') });
      if (!rMin.ok) return rMin;
    } else {
      // Sin peso no hay stock propio, así que el tipo de carne, el porcentaje y el mínimo no tienen dónde
      // guardarse. Si se cargó alguno, se avisa en vez de perderlo en silencio.
      const algoCargado = contenedor.querySelector('#sp-tipo').value || campoCarne.value.trim() || contenedor.querySelector('.sp-minimo').value.trim();
      if (algoCargado) return { ok: false, error: 'Para guardar el tipo de carne, cuánto lleva o el aviso de mínimo, primero poné cuánto pesa cada unidad.' };
    }
  }
  return resultado;
}
