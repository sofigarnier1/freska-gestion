// Productos y lista de precios.
// (Antes todo estaba en renderer.js; se dividió por pantalla el 2026-09-24. Los archivos son scripts comunes que
// comparten el mismo espacio global: se cargan en el orden de index.html y no hace falta importar nada.)

let mostrarFormProducto = false;
let errorFormProducto = null;
let productoEditandoId = null; // null = agregar uno nuevo; si no, el formulario edita ese producto

// Hoja con los precios de todos los productos: los dos (Cliente y CF) o uno solo, a elección.
function construirHojaPrecios(productos, cuales) {
  const conCliente = cuales !== 'cf';
  const conCf = cuales !== 'cliente';
  const porNombre = (a, b) => a.nombre.localeCompare(b.nombre, 'es');
  const precio = (valor, p) => `$${formatearMoneda(valor)} / ${p.unidad === 'kg' ? 'kg' : 'u'}`;
  return `
    <div class="hoja-impresion-precios">
      <h1>Lista de precios — ${new Date().toLocaleDateString('es-AR')}</h1>
      <table class="tabla-impresion-precios">
        <thead><tr><th>Producto</th>${conCliente ? '<th>Precio Cliente</th>' : ''}${conCf ? '<th>Precio CF</th>' : ''}</tr></thead>
        <tbody>
          ${[...productos]
            .sort(porNombre)
            .map(
              (p) => `<tr><td>${esc(p.nombre)}</td>${conCliente ? `<td>${precio(p.precio_cliente, p)}</td>` : ''}${conCf ? `<td>${precio(p.precio_cf, p)}</td>` : ''}</tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function abrirImpresionListaPrecios(productos) {
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Imprimir lista de precios</h3>
    <div class="opciones-impresion-precios">
      <label><input type="radio" name="precios-cuales" value="ambos" checked /> Los dos precios (Cliente y CF)</label>
      <label><input type="radio" name="precios-cuales" value="cliente" /> Solo precio Cliente</label>
      <label><input type="radio" name="precios-cuales" value="cf" /> Solo precio CF</label>
    </div>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary">Imprimir</button>
    </div>
  `);
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', () => {
    const cuales = document.querySelector('input[name="precios-cuales"]:checked').value;
    cerrarModal();
    document.getElementById('area-impresion').innerHTML = construirHojaPrecios(productos, cuales);
    imprimirConTitulo('Lista de precios');
  });
}

// Sugiere el próximo código: el número más alto que ya se usó, más uno.
function siguienteCodigoProducto(productos) {
  const numeros = productos.map((p) => Number(String(p.codigo || '').trim())).filter((n) => Number.isInteger(n) && n > 0);
  return String((numeros.length ? Math.max(...numeros) : 0) + 1);
}

function codigoProductoHtml(p, repetidos) {
  const codigo = String(p.codigo || '').trim();
  if (!codigo) return '<span class="codigo-falta" title="Falta el código">Falta</span>';
  return repetidos.has(normalizarTexto(codigo)) ? `<span class="codigo-falta" title="Otro producto tiene este mismo código">${esc(codigo)}</span>` : esc(codigo);
}

// Cómo se vende un producto: 'kg', 'caja' o 'unidad' (en la base: unidad = kg | unidad, y presentacion = caja | unidad).
const ventaDeProducto = (p) => (p.unidad === 'kg' ? 'kg' : p.presentacion === 'caja' ? 'caja' : 'unidad');
const datosDeVenta = (venta) => ({ unidad: venta === 'kg' ? 'kg' : 'unidad', presentacion: venta === 'caja' ? 'caja' : venta === 'unidad' ? 'unidad' : null });
const OPCIONES_VENTA_HTML = (actual) => `<option value="unidad" ${actual === 'unidad' ? 'selected' : ''}>Por unidad</option><option value="caja" ${actual === 'caja' ? 'selected' : ''}>Por caja</option><option value="kg" ${actual === 'kg' ? 'selected' : ''}>Por kg (peso)</option>`;

// Cuadro aparte para "Para el stock y el rendimiento" de un producto (botón "Stock" de la lista): no comparte
// formulario con nombre/precio/código porque es lo que de verdad se toca seguido, y antes quedaba escondido
// al final de Editar.
// `valoresPrevios`, si viene, son los campos que ya se habían tocado en esta misma sesión del modal: la app
// no tiene cuadros anidados (mostrarModal/cerrarModal manejan uno solo), así que el "✎" para agregar un tipo
// nuevo ABRE SU PROPIO cuadro encima de este (lo pisa) y, al cerrarse, vuelve a abrir este desde cero en vez
// de intentar actualizar un cuadro que ya no está — por eso hace falta pasarle lo que no se había guardado
// todavía, para no perderlo.
async function abrirModalStockProducto(producto, valoresPrevios) {
  const stockRes = await window.freska.stock.resumen();
  tiposCarneCache = await window.freska.stock.tiposCarne();
  const actual = stockRes.productos.find((sp) => sp.id === producto.id) || null;
  const unidad = ventaDeProducto(producto);
  mostrarModal(`${modalXHtml('modal-cancelar-stock')}
    <h3>Stock — ${esc(producto.nombre)}</h3>
    <p id="error-stock-producto" class="error-msg" style="display:none"></p>
    ${camposStockProductoHtml(stockRes.productos, actual, unidad, producto.id)}
    <div class="btn-group" style="margin-top:14px">
      <button type="button" id="modal-guardar-stock" class="primary">Guardar</button>
    </div>
  `);
  document.getElementById('modal-cancelar-stock').addEventListener('click', cerrarModal);
  const campos = document.querySelector('.campos-stock-producto');
  if (valoresPrevios) {
    campos.querySelector('.sp-kg').value = valoresPrevios.kg;
    campos.querySelector('.sp-kg-unidad').value = valoresPrevios.kgUnidad;
    campos.querySelector('.sp-base').value = valoresPrevios.base;
    campos.querySelector('.sp-carne').value = valoresPrevios.carne;
    campos.querySelector('.sp-minimo').value = valoresPrevios.minimo;
  }
  vincularCamposStockProducto(campos, () => unidad, valoresPrevios ? valoresPrevios.tipo : actual ? actual.carnes : null, () =>
    abrirModalStockProducto(producto, {
      kg: campos.querySelector('.sp-kg').value,
      kgUnidad: campos.querySelector('.sp-kg-unidad').value,
      base: campos.querySelector('.sp-base').value,
      carne: campos.querySelector('.sp-carne').value,
      minimo: campos.querySelector('.sp-minimo').value,
      tipo: campos.querySelector('#sp-tipo').value,
    })
  );
  if (valoresPrevios) campos.querySelector('.sp-base').dispatchEvent(new Event('change'));
  document.getElementById('modal-guardar-stock').addEventListener('click', async () => {
    const errorEl = document.getElementById('error-stock-producto');
    const errorStock = validarCamposStockProducto(campos, unidad);
    if (errorStock) {
      errorEl.textContent = errorStock;
      errorEl.style.display = 'block';
      return;
    }
    const r = await guardarStockProducto(producto.id, campos, unidad);
    if (!r.ok) {
      errorEl.textContent = r.error;
      errorEl.style.display = 'block';
      return;
    }
    cerrarModal();
    mostrarToast('Stock guardado.', 'ok');
    renderProductos();
  });
}

async function renderProductos() {
  const [productos, stockRes] = await Promise.all([window.freska.productos.listar(), window.freska.stock.resumen()]);
  const stockDe = (id) => stockRes.productos.find((p) => p.id === id) || {};
  const contadorCodigos = {};
  productos.forEach((p) => {
    const c = normalizarTexto(String(p.codigo || '').trim());
    if (c) contadorCodigos[c] = (contadorCodigos[c] || 0) + 1;
  });
  const codigosRepetidos = new Set(Object.keys(contadorCodigos).filter((c) => contadorCodigos[c] > 1));
  const productoEnEdicion = productoEditandoId ? productos.find((p) => p.id === productoEditandoId) || null : null;
  if (productoEditandoId && !productoEnEdicion) productoEditandoId = null;
  const ventaForm = productoEnEdicion ? ventaDeProducto(productoEnEdicion) : 'unidad';
  const toolbarProductosHtml = `
    <div class="toolbar">
      ${!mostrarFormProducto ? '<button id="btn-toggle-form-producto" class="primary" type="button">+ Agregar producto</button>' : ''}
      <div class="btn-group buscador-e-imprimir">
        <input type="text" id="buscar-producto" class="buscador" placeholder="Buscar producto" />
        ${
          !mostrarFormProducto
            ? `<div class="menu-fila">
          <button class="btn-menu-fila" type="button" aria-label="Imprimir">🖨️</button>
          <div class="menu-fila-lista">
            <button class="item-menu" id="btn-imprimir-precios" type="button">Imprimir lista de precios</button>
          </div>
        </div>`
            : ''
        }
      </div>
    </div>`;
  app.innerHTML = `
    ${volverHtml('productos')}
    ${mostrarFormProducto ? '' : toolbarProductosHtml}
    ${
      mostrarFormProducto
        ? `
    <h2>${productoEnEdicion ? 'Editar producto' : 'Agregar producto'}</h2>
    <form id="form-producto" class="panel gasto-form">
      ${errorFormProducto ? `<p class="error-msg">${esc(errorFormProducto)}</p>` : ''}
      <div class="gasto-fila">
        <label class="gasto-campo campo-codigo-cliente"><span>Código</span><input type="text" id="nuevo-codigo" required maxlength="20" value="${esc(productoEnEdicion ? productoEnEdicion.codigo || '' : siguienteCodigoProducto(productos))}" /></label>
        <label class="gasto-campo gasto-campo-grande"><span>Nombre</span><input type="text" id="nuevo-nombre" required maxlength="80" value="${esc(productoEnEdicion ? productoEnEdicion.nombre : '')}" /></label>
      </div>
      <div class="gasto-fila">
        <label class="gasto-campo"><span>Precio Cliente</span><div class="input-moneda"><span>$</span><input type="text" inputmode="decimal" id="nuevo-precio-cliente" required value="${productoEnEdicion ? esc(formatearMoneda(Number(productoEnEdicion.precio_cliente))) : ''}" /></div></label>
        <label class="gasto-campo"><span>Precio CF</span><div class="input-moneda"><span>$</span><input type="text" inputmode="decimal" id="nuevo-precio-cf" required value="${productoEnEdicion ? esc(formatearMoneda(Number(productoEnEdicion.precio_cf))) : ''}" /></div></label>
        <label class="gasto-campo"><span>Se vende</span><select id="nuevo-unidad">${OPCIONES_VENTA_HTML(ventaForm)}</select></label>
        <label class="gasto-campo" id="campo-pedible" ${ventaForm === 'kg' ? '' : 'hidden'}><span>Se puede pedir por unidad</span><select id="nuevo-pedible"><option value="0">No</option><option value="1" ${productoEnEdicion && productoEnEdicion.pedible_por_unidad ? 'selected' : ''}>Sí</option></select></label>
        <label class="gasto-campo" id="campo-peso-unidad" ${ventaForm === 'kg' && productoEnEdicion && productoEnEdicion.pedible_por_unidad ? '' : 'hidden'}><span>Pesa cada una (aprox.)</span><span class="input-unidad"><input type="text" inputmode="decimal" id="nuevo-peso-unidad" maxlength="6" placeholder="Ej: 200" autocomplete="off" value="${productoEnEdicion && productoEnEdicion.peso_unidad_pedido ? esc(String(Math.round(productoEnEdicion.peso_unidad_pedido * 1000))) : ''}" /><span class="unidad-label">g</span></span></label>
      </div>
      <div class="btn-group">
        <button type="submit" class="primary">${productoEnEdicion ? 'Guardar cambios' : 'Guardar'}</button>
        <button type="button" id="btn-cancelar-form-producto">Cancelar</button>
      </div>
    </form>
    ${toolbarProductosHtml}`
        : ''
    }
    ${
      productos.some((p) => !String(p.codigo || '').trim() || codigosRepetidos.has(normalizarTexto(String(p.codigo || '').trim())))
        ? '<p class="error-msg" style="margin:0 0 10px">Hay productos sin código o con el código repetido (marcados en rojo). Editalos: el código es obligatorio y no puede repetirse.</p>'
        : ''
    }
    <table class="tabla-productos">
      <thead><tr><th>Código</th><th>Nombre</th><th>Precio Cliente</th><th>Precio CF</th><th>Se vende</th><th>Hay</th><th></th></tr></thead>
      <tbody id="productos-body">
        ${productos
          .map(
            (p) => `
          <tr data-id="${p.id}" data-codigo="${esc(p.codigo || '')}" data-nombre="${esc(p.nombre)}" data-precio-cliente="${p.precio_cliente}" data-precio-cf="${p.precio_cf}" data-unidad="${ventaDeProducto(p)}">
            <td>${codigoProductoHtml(p, codigosRepetidos)}</td>
            <td>${esc(p.nombre)}</td>
            <td>$${formatearMoneda(p.precio_cliente)} / ${p.unidad === 'kg' ? 'kg' : 'u'}</td>
            <td>$${formatearMoneda(p.precio_cf)} / ${p.unidad === 'kg' ? 'kg' : 'u'}</td>
            <td>${{ kg: 'Por peso (kg)', caja: 'Por caja', unidad: 'Por unidad' }[ventaDeProducto(p)]}</td>
            <td>${
              stockDe(p.id).hay === null || stockDe(p.id).hay === undefined
                ? `<span class="texto-suave">${stockDe(p.id).articulo_id ? 'Sin peso' : '—'}</span>`
                : `${formatearCantidad(stockDe(p.id).hay)} ${p.unidad === 'kg' ? 'kg' : p.presentacion === 'caja' ? (stockDe(p.id).hay === 1 ? 'caja' : 'cajas') : 'u.'}`
            }${stockDe(p.id).de_producto_id ? `<div class="gasto-detalle-cheque">del stock de ${esc(stockDe(p.id).articulo || '')}</div>` : ''}</td>
            <td class="celda-centrada"><button type="button" class="stock-producto-fila" data-id="${p.id}" aria-label="Stock de ${esc(p.nombre)}">Stock</button><div class="menu-fila">
              <button class="btn-menu-fila" type="button" aria-label="Acciones de ${esc(p.nombre)}">⋮</button>
              <div class="menu-fila-lista">
                <button type="button" class="item-menu editar" data-id="${p.id}">Editar</button>
                <button type="button" class="item-menu quitar" data-id="${p.id}">Quitar</button>
              </div>
            </div></td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;

  document.getElementById(mostrarFormProducto ? 'nuevo-codigo' : 'buscar-producto').focus();

  vincularMenuFila();
  document.getElementById('btn-imprimir-precios')?.addEventListener('click', () => abrirImpresionListaPrecios(productos));
  document.querySelectorAll('.stock-producto-fila').forEach((btn) => {
    btn.addEventListener('click', () => {
      const producto = productos.find((p) => p.id === Number(btn.dataset.id));
      if (producto) abrirModalStockProducto(producto);
    });
  });

  document.getElementById('buscar-producto').addEventListener('input', (e) => {
    const query = normalizarTexto(e.target.value.trim());
    document.querySelectorAll('#productos-body tr').forEach((fila) => {
      const coincide =
        normalizarTexto(fila.dataset.nombre).includes(query) ||
        normalizarTexto(fila.dataset.codigo).includes(query);
      fila.style.display = coincide ? '' : 'none';
    });
  });

  if (!mostrarFormProducto) {
    document.getElementById('btn-toggle-form-producto').addEventListener('click', () => {
      mostrarFormProducto = true;
      productoEditandoId = null;
      errorFormProducto = null;
      renderProductos();
    });
  }

  if (mostrarFormProducto) {
    document.getElementById('btn-cancelar-form-producto').addEventListener('click', () => {
      mostrarFormProducto = false;
      productoEditandoId = null;
      errorFormProducto = null;
      renderProductos();
    });
    vincularFormatoMoneda(document.getElementById('nuevo-precio-cliente'));
    vincularFormatoMoneda(document.getElementById('nuevo-precio-cf'));

    // "Se puede pedir por unidad" solo tiene sentido en lo que se vende por kilo; el peso aparece si se elige Sí.
    const actualizarCamposPedido = () => {
      const porKilo = document.getElementById('nuevo-unidad').value === 'kg';
      document.getElementById('campo-pedible').hidden = !porKilo;
      document.getElementById('campo-peso-unidad').hidden = !(porKilo && document.getElementById('nuevo-pedible').value === '1');
    };
    document.getElementById('nuevo-unidad').addEventListener('change', actualizarCamposPedido);
    document.getElementById('nuevo-pedible').addEventListener('change', actualizarCamposPedido);
    document.getElementById('form-producto').addEventListener('submit', async (e) => {
      e.preventDefault();
      const codigo = document.getElementById('nuevo-codigo').value.trim();
      const nombre = document.getElementById('nuevo-nombre').value.trim();
      const precioCliente = limpiarNumeroMoneda(document.getElementById('nuevo-precio-cliente').value);
      const precioCf = limpiarNumeroMoneda(document.getElementById('nuevo-precio-cf').value);
      const venta = document.getElementById('nuevo-unidad').value;
      const unidad = venta === 'kg' ? 'kg' : 'unidad';
      if (!nombre || isNaN(precioCliente) || isNaN(precioCf)) return;
      const pedible = venta === 'kg' && document.getElementById('nuevo-pedible').value === '1';
      const gramos = limpiarNumeroMoneda(document.getElementById('nuevo-peso-unidad').value);
      const pedidoPorUnidad = { pedible_por_unidad: pedible ? 1 : 0, peso_unidad_pedido: pedible && gramos > 0 ? gramos / 1000 : '' };

      // Editar: si cambió algún precio, se pide confirmación (se aplica a las próximas facturas).
      if (productoEnEdicion) {
        const guardarEdicion = async () => {
          const resultado = await window.freska.productos.actualizar({
            id: productoEnEdicion.id,
            codigo,
            nombre,
            precio_cliente: precioCliente,
            precio_cf: precioCf,
            ...datosDeVenta(venta),
            ...pedidoPorUnidad,
          });
          if (resultado.ok === false) {
            errorFormProducto = resultado.error;
            renderProductos();
            return;
          }
          errorFormProducto = null;
          mostrarFormProducto = false;
          productoEditandoId = null;
          mostrarToast('Producto guardado.', 'ok');
          renderProductos();
        };
        const precioCambio = precioCliente !== Number(productoEnEdicion.precio_cliente) || precioCf !== Number(productoEnEdicion.precio_cf);
        if (!precioCambio) {
          await guardarEdicion();
          return;
        }
        mostrarModal(`${modalXHtml('modal-cancelar')}
          <h3>Guardar nuevo precio</h3>
          <p>¿Seguro que querés cambiar el precio de <strong>${esc(nombre)}</strong>? Se va a aplicar a las próximas facturas.</p>
          <div class="btn-group">
            <button type="button" id="modal-confirmar" class="primary">Sí, guardar</button>
          </div>
        `);
        document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
        document.getElementById('modal-confirmar').addEventListener('click', async () => {
          cerrarModal();
          await guardarEdicion();
        });
        return;
      }

      const resultado = await window.freska.productos.crear({
        nombre,
        codigo,
        precio_cliente: precioCliente,
        precio_cf: precioCf,
        ...datosDeVenta(venta),
        ...pedidoPorUnidad,
      });
      if (resultado.ok === false) {
        errorFormProducto = resultado.error;
        renderProductos();
        return;
      }
      errorFormProducto = null;
      mostrarFormProducto = false;
      mostrarToast('Producto guardado. Para el peso, el tipo de carne, etc., usá el botón "Stock" de la lista.', 'ok');
      renderProductos();
    });
  }

  app.querySelectorAll('button.editar').forEach((btn) => {
    btn.addEventListener('click', () => {
      productoEditandoId = Number(btn.dataset.id);
      mostrarFormProducto = true;
      errorFormProducto = null;
      renderProductos();
    });
  });

  app.querySelectorAll('button.quitar').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fila = btn.closest('tr');
      pedirConfirmacionBaja(fila);
    });
  });
  vincularVolverGenerico();
}

function pedirConfirmacionBaja(fila) {
  const id = Number(fila.dataset.id);
  const nombre = fila.dataset.nombre;

  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Quitar producto</h3>
    <p>¿Seguro que querés quitar <strong>${esc(nombre)}</strong> del catálogo?</p>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, quitar</button>
    </div>
  `);

  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    await window.freska.productos.baja(id);
    cerrarModal();
    mostrarToast('Producto quitado.', 'ok');
    renderProductos();
  });
}
