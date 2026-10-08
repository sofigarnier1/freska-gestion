// Sección Proveedores: lista con saldo, ficha con compras y pagos, alta de compras (kilos, precio e importe)
// y pagos con cheques de la cartera + efectivo. Se carga después de los archivos de pantallas (utilidades.js … inicio.js, ver index.html) y usa sus funciones.

let pestanaProveedores = null; // 'todos' | 'baja'
let ordenProveedores = 'saldo'; // 'saldo' | 'nombre' | 'ultima'
let mostrarProveedores = 'todos'; // 'todos' | 'deuda'
let mostrarFormProveedor = false;
let errorFormProveedor = null;
// Lo escrito en el formulario de alta (se conserva al volver del editor de tipos o de un error) y los
// productos que vende, todavía sin guardar.
let altaProveedor = { nombre: '', telefono: '', nota: '', saldo: '', productos: [] };
let mostrarDatosProveedor = false;
let limiteHistorialProveedor = 30;
// Formularios abiertos en la ficha (o null). Viven mientras se está en la ficha del proveedor.
let formCompra = null; // { editandoId, fecha, lineas: [{ producto, tipo, kilos, precio, importe }] }
let formDevolucion = null; // { fecha }: devolución de mercadería a un proveedor (el resto vive en el formulario mientras se llena)
let formPago = null; // { fecha, editandoId?, totalOriginal?, lineas? }: el resto (líneas de pago) vive en el formulario mientras se llena
let productosCompradosCache = []; // productos ya comprados a cualquiera (con su última descripción): sugerencia si el proveedor no tiene lista
let productosProveedorCache = []; // lo que vende el proveedor de la ficha: [{ id, producto, descripcion }]

let tiposProductoCache = []; // "Producto": lista fija y propia que se edita (Vaca, Cerdo, Pollo…): [{ id, nombre }]

// Las opciones de un desplegable de Producto. Si el valor actual ya no está en la lista (se sacó después), se
// conserva igual para no perderlo. La última opción abre el editor de la lista.
function opcionesTipoHtml(actual) {
  const nombres = tiposProductoCache.map((t) => t.nombre);
  if (actual && !nombres.some((n) => n.toLowerCase() === String(actual).toLowerCase())) nombres.push(actual);
  return `<option value="">Producto…</option>${nombres
    .map((n) => `<option value="${esc(n)}" ${n === actual ? 'selected' : ''}>${esc(n)}</option>`)
    .join('')}<option value="__editar__">✎ Editar productos…</option>`;
}

// "Producto" para elegir qué vende un proveedor: un buscador donde se puede escribir para filtrar (igual
// que elegir un cliente en Facturas), en vez de un desplegable — más cómodo cuando la lista ya es larga.
// Solo se puede quedar con un producto que ya está en la lista; "Editar productos…" siempre aparece al
// final para agregar uno nuevo sin salir del formulario.
function productoBuscadorHtml(idPrefix, valorInicial = '') {
  return autocompleteBuscadorHtml(idPrefix, 'Elegí un producto…', valorInicial);
}

const OPCION_EDITAR_PRODUCTOS = { nombre: '✎ Editar productos…', esEditar: true };

// `alCambiarLista`: qué hacer después de "✎ Editar productos…" (redibujar para que se vea la lista nueva). Elegir
// un producto NO redibuja: si lo hiciera, el casillero volvería a quedar vacío y el "+" diría "Elegí el producto."
function vincularProductoBuscador(idPrefix, alCambiarLista) {
  let ultimoValido = document.getElementById(`${idPrefix}-buscar`).value;
  return vincularAutocompleteBuscador(idPrefix, [...tiposProductoCache, OPCION_EDITAR_PRODUCTOS], {
    etiquetar: (t) => t.nombre,
    coincide: (t, query) => t.esEditar || normalizarTexto(t.nombre).includes(query),
    onSeleccionar: (t) => {
      if (t.esEditar) {
        document.getElementById(`${idPrefix}-buscar`).value = ultimoValido;
        abrirEditorTipos(alCambiarLista);
        return;
      }
      ultimoValido = t.nombre;
    },
  });
}

// El producto elegido en un buscador de éstos: solo cuenta si coincide con uno de la lista (lo mismo que
// antes exigía el desplegable) — lo que se haya escrito sin elegir una opción no vale.
function productoElegido(idPrefix) {
  const texto = document.getElementById(`${idPrefix}-buscar`).value.trim();
  const tipo = tiposProductoCache.find((t) => t.nombre.toLowerCase() === texto.toLowerCase());
  return tipo ? tipo.nombre : '';
}

// "Se compra" (Kg · Unidad): un desplegable con las mismas opciones y el mismo estilo que "Se vende" en
// Productos, en vez de botones — para no sumar un tercer estilo de selector a la pantalla.
// `corto`: dentro de una línea de compra, pegado a la cantidad, alcanza con "kg" / "u." (como Pedidos y Facturas).
function unidadOpcionesHtml(actual, corto = false) {
  const u = actual === 'unidad' ? 'unidad' : 'kg';
  const [kg, un] = corto ? ['kg', 'u.'] : ['Por kg (peso)', 'Por unidad'];
  return `<option value="kg" ${u === 'kg' ? 'selected' : ''}>${kg}</option><option value="unidad" ${u === 'unidad' ? 'selected' : ''}>${un}</option>`;
}

function unidadSelectHtml(id, actual) {
  return `<select id="${id}" aria-label="Se compra">${unidadOpcionesHtml(actual)}</select>`;
}

// Enlaza un desplegable de tipo: elegir "Editar tipos…" abre el editor (y deja el valor que había).
// Se enlaza antes que cualquier otro "change" del mismo desplegable, porque corta la propagación.
function vincularSelectTipo(select, alCambiarLista) {
  let anterior = select.value;
  select.addEventListener('change', (e) => {
    if (select.value === '__editar__') {
      select.value = anterior;
      e.stopImmediatePropagation();
      abrirEditorTipos(alCambiarLista);
      return;
    }
    anterior = select.value;
  });
}

async function abrirEditorTipos(alCerrar) {
  let cambio = false;
  const pintar = async () => {
    tiposProductoCache = await window.freska.proveedores.tipos();
    mostrarModal(`
      <h3>Productos</h3>
      <p class="pin-subtitulo">Son las opciones de "Producto" al cargar una compra. Sacar uno no cambia lo que ya cargaste.</p>
      <div class="retiro-sugerencias" style="margin:10px 0">
        ${
          tiposProductoCache.length
            ? tiposProductoCache
                .map(
                  (t) => `<span class="chip-retiro-grupo"><span class="chip-retiro chip-texto">${esc(t.nombre)}</span><button type="button" class="chip-retiro-x quitar-tipo" data-id="${t.id}" aria-label="Sacar ${esc(t.nombre)}" title="Sacar">×</button></span>`
                )
                .join('')
            : '<span class="pin-subtitulo">No hay productos.</span>'
        }
      </div>
      <div class="fila-producto-proveedor">
        <input type="text" id="nuevo-tipo" maxlength="40" placeholder="Nuevo producto (ej: Cordero)" autocomplete="off" />
        <button type="button" id="btn-agregar-tipo" class="btn-redondo btn-mas" aria-label="Agregar producto" title="Agregar">+</button>
      </div>
      <p id="error-tipo" class="error-msg" style="display:none"></p>
      <div class="btn-group" style="margin-top:14px">
        <button type="button" id="modal-cerrar-tipos" class="primary">Listo</button>
      </div>
    `);
    const agregar = async () => {
      const resultado = await window.freska.proveedores.agregarTipo(document.getElementById('nuevo-tipo').value);
      if (!resultado.ok) {
        const el = document.getElementById('error-tipo');
        el.textContent = resultado.error;
        el.style.display = 'block';
        return;
      }
      cambio = true;
      await pintar();
      document.getElementById('nuevo-tipo').focus();
    };
    document.getElementById('btn-agregar-tipo').addEventListener('click', agregar);
    document.getElementById('nuevo-tipo').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      agregar();
    });
    document.querySelectorAll('.quitar-tipo').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await window.freska.proveedores.quitarTipo(Number(btn.dataset.id));
        cambio = true;
        pintar();
      });
    });
    document.getElementById('modal-cerrar-tipos').addEventListener('click', () => {
      cerrarModal();
      if (cambio && alCerrar) alCerrar();
    });
    document.getElementById('nuevo-tipo').focus();
  };
  await pintar();
}

// "Lo que vende" en 3 renglones como máximo: si la lista es larga, el resto queda oculto detrás de "Ver todos (N)".
// Se llama después de dibujar la pantalla, con el elemento que contiene los productos.
function limitarListaVende(contenedor) {
  if (!contenedor) return;
  const grupos = contenedor.querySelectorAll('.chip-retiro-grupo').length;
  contenedor.classList.add('lista-limitada');
  if (contenedor.scrollHeight <= contenedor.clientHeight + 2) {
    contenedor.classList.remove('lista-limitada');
    return;
  }
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'enlace-boton ver-todos-lista';
  const texto = (abierto) => (abierto ? 'Ver menos' : `Ver todos (${grupos})`);
  boton.textContent = texto(false);
  boton.addEventListener('click', () => {
    const abierto = contenedor.classList.toggle('lista-limitada') === false;
    boton.textContent = texto(abierto);
  });
  contenedor.after(boton);
}

function proveedorActivo(p) {
  return p.activo !== 0;
}

// "Le debés" (saldo positivo), "A favor" (negativo) o sin deuda.
function textoSaldoProveedor(saldo) {
  if (saldo > 0) return `$${formatearMoneda(saldo)}`;
  if (saldo < 0) return `A favor $${formatearMoneda(-saldo)}`;
  return '$0';
}

// ---------- Lista ----------

// Según "Ordenar"; a igual valor queda el orden alfabético que ya traen.
function ordenarProveedores(lista) {
  const copia = [...lista];
  if (ordenProveedores === 'nombre') return copia.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  if (ordenProveedores === 'ultima') return copia.sort((a, b) => (b.ultima_compra || '').localeCompare(a.ultima_compra || ''));
  return copia.sort((a, b) => b.saldo - a.saldo);
}

async function renderProveedores() {
  formCompra = null;
  formPago = null;
  formDevolucion = null;
  const [proveedores, tipos] = await Promise.all([window.freska.proveedores.listar(), window.freska.proveedores.tipos()]);
  tiposProductoCache = tipos;
  const activos = proveedores.filter(proveedorActivo);
  const pestana = pestanaProveedores || 'todos';
  const mostrados =
    pestana === 'baja'
      ? proveedores.filter((p) => !proveedorActivo(p))
      : ordenarProveedores(mostrarProveedores === 'deuda' ? activos.filter((p) => p.saldo > 0) : activos);
  const vacio =
    pestana === 'baja'
      ? 'No hay proveedores dados de baja.'
      : mostrarProveedores === 'deuda'
        ? 'No le debés a ningún proveedor.'
        : 'Todavía no hay proveedores.';
  const totalDeuda = redondearPesos(activos.filter((p) => p.saldo > 0).reduce((acc, p) => acc + p.saldo, 0));

  const toolbarHtml = `
      <div class="busqueda-filtros">
      <input type="text" id="buscar-proveedor" class="buscador" placeholder="Buscar proveedor" autocomplete="off" />
      ${
        pestana === 'baja'
          ? ''
          : filtrosListaHtml('filtros-proveedores', [
              {
                nombre: 'orden',
                titulo: 'Ordenar por',
                opciones: [['saldo', 'Mayor deuda'], ['nombre', 'Nombre A–Z'], ['ultima', 'Última compra']],
                actual: ordenProveedores,
                porDefecto: 'saldo',
              },
              {
                nombre: 'ver',
                titulo: 'Ver',
                opciones: [['todos', 'Todos'], ['deuda', 'Solo con deuda']],
                actual: mostrarProveedores,
                porDefecto: 'todos',
              },
            ])
      }
      </div>`;
  const tabsHtml = `
    <div class="reportes-toggle">
      <button type="button" class="toggle ${pestana === 'todos' ? 'active' : ''}" data-tab-proveedores="todos">Todos</button>
      <button type="button" class="toggle ${pestana === 'baja' ? 'active' : ''}" data-tab-proveedores="baja">Dados de baja</button>
    </div>`;

  const controlesHtml = `${
    !mostrarFormProveedor ? '<div class="lista-agregar"><button id="btn-toggle-form-proveedor" class="primary" type="button">+ Agregar proveedor</button></div>' : ''
  }<div class="toolbar toolbar-lista fila-controles-lista">${tabsHtml}${toolbarHtml}</div>`;
  app.innerHTML = `
    ${mostrarFormProveedor ? '' : controlesHtml}
    ${
      mostrarFormProveedor
        ? `
    <h2>Agregar proveedor</h2>
    <form id="form-proveedor" class="panel gasto-form">
      ${errorFormProveedor ? `<p class="error-msg">${esc(errorFormProveedor)}</p>` : ''}
      <div class="gasto-fila">
        <label class="gasto-campo"><span>Nombre</span><input type="text" id="nombre-proveedor" maxlength="120" required autocomplete="off" value="${esc(altaProveedor.nombre)}" /></label>
        <label class="gasto-campo campo-derecha-proveedor"><span>Teléfono (opcional)</span><input type="tel" id="telefono-proveedor" maxlength="40" autocomplete="off" value="${esc(altaProveedor.telefono)}" /></label>
      </div>
      <div class="gasto-fila">
        <label class="gasto-campo"><span>Nota (opcional)</span><input type="text" id="nota-proveedor" maxlength="200" autocomplete="off" value="${esc(altaProveedor.nota)}" /></label>
        <label class="gasto-campo campo-derecha-proveedor"><span>Saldo inicial (opcional)</span><div class="input-moneda"><span>$</span><input type="text" id="saldo-inicial-proveedor" inputmode="decimal" autocomplete="off" value="${esc(altaProveedor.saldo)}" /></div></label>
      </div>
      <div class="alta-vende">
        <span class="pago-cheques-titulo">Lo que vende (opcional)</span>
        ${
          altaProveedor.productos.length
            ? `<div class="retiro-sugerencias">${altaProveedor.productos
                .map(
                  (p, i) => `<span class="chip-retiro-grupo"><span class="chip-retiro chip-texto">${rotuloProductoHtml(p.producto, p.descripcion, p.unidad)}</span><button type="button" class="chip-retiro-x quitar-producto-alta" data-i="${i}" aria-label="Sacar ${esc(p.producto)}" title="Sacar">×</button></span>`
                )
                .join('')}</div>`
            : ''
        }
        <div class="fila-producto-proveedor">
          ${productoBuscadorHtml('alta-producto', '')}
          <input type="text" id="alta-descripcion" maxlength="120" placeholder="Descripción" autocomplete="off" />
          ${unidadSelectHtml('alta-producto-unidad', 'kg')}
          <button type="button" id="btn-agregar-producto-alta" class="btn-redondo btn-mas" aria-label="Agregar producto" title="Agregar">+</button>
        </div>
      </div>
      <div class="btn-group">
        <button type="submit" class="primary">Guardar</button>
        <button type="button" id="btn-cancelar-form-proveedor">Cancelar</button>
      </div>
    </form>
    ${controlesHtml}`
        : ''
    }
    ${totalDeuda > 0 && pestana !== 'baja' ? `<p class="factura-total">Le debés en total: $${formatearMoneda(totalDeuda)}</p>` : ''}
    <table class="tabla-proveedores">
      <thead><tr><th>Nombre</th><th>${pestana === 'baja' ? 'Última compra' : 'Saldo'}</th>${pestana === 'baja' ? '' : '<th></th>'}</tr></thead>
      <tbody id="proveedores-body">
        ${
          mostrados.length === 0
            ? `<tr><td colspan="3">${vacio}</td></tr>`
            : mostrados
                .map(
                  (p) => `
          <tr class="fila-clickeable" tabindex="0" data-id="${p.id}" data-nombre="${esc(p.nombre)}">
            <td>${esc(p.nombre)}</td>
            <td>${
              pestana === 'baja'
                ? p.ultima_compra
                  ? fechaLargaCierre(p.ultima_compra)
                  : '<span class="texto-suave">Sin compras</span>'
                : `<span class="${p.saldo > 0 ? 'saldo-deuda' : ''}">${textoSaldoProveedor(p.saldo)}</span>`
            }</td>
            ${pestana === 'baja' ? '' : `<td class="acciones-cheque"><button type="button" class="compra-proveedor-fila" data-id="${p.id}" aria-label="Cargar una compra de ${esc(p.nombre)}">Compra</button><button type="button" class="pagar-proveedor-fila ${p.saldo > 0 ? 'con-deuda' : ''}" data-id="${p.id}" aria-label="Pagarle a ${esc(p.nombre)}">Pagar</button></td>`}
          </tr>`
                )
                .join('')
        }
      </tbody>
    </table>
  `;

  document.getElementById(mostrarFormProveedor ? 'nombre-proveedor' : 'buscar-proveedor').focus();

  // Ordenar / filtrar vuelve a dibujar la lista; lo escrito en el buscador se conserva.
  const alCambiarFiltroProveedores = () => {
    const texto = document.getElementById('buscar-proveedor').value;
    renderProveedores().then(() => {
      const buscador = document.getElementById('buscar-proveedor');
      if (texto && buscador) {
        buscador.value = texto;
        buscador.dispatchEvent(new Event('input'));
      }
    });
  };
  vincularFiltrosLista('filtros-proveedores', (grupo, valor) => {
    if (grupo === 'orden') ordenProveedores = valor;
    else mostrarProveedores = valor;
    alCambiarFiltroProveedores();
  });

  app.querySelectorAll('[data-tab-proveedores]').forEach((btn) => {
    btn.addEventListener('click', () => {
      pestanaProveedores = btn.dataset.tabProveedores;
      renderProveedores();
    });
  });

  if (mostrarFormProveedor) {
    vincularFormatoMoneda(document.getElementById('saldo-inicial-proveedor'));
    const leerAlta = () => {
      altaProveedor.nombre = document.getElementById('nombre-proveedor').value;
      altaProveedor.telefono = document.getElementById('telefono-proveedor').value;
      altaProveedor.nota = document.getElementById('nota-proveedor').value;
      altaProveedor.saldo = document.getElementById('saldo-inicial-proveedor').value;
    };
    ['nombre-proveedor', 'telefono-proveedor', 'nota-proveedor', 'saldo-inicial-proveedor'].forEach((idCampo) =>
      document.getElementById(idCampo).addEventListener('input', leerAlta)
    );
    limitarListaVende(document.querySelector('.alta-vende .retiro-sugerencias'));
    vincularProductoBuscador('alta-producto', () => {
      leerAlta();
      renderProveedores();
    });
    const agregarProductoAlta = () => {
      const producto = productoElegido('alta-producto');
      if (!producto) return;
      leerAlta();
      const descripcion = document.getElementById('alta-descripcion').value.trim();
      const unidad = document.getElementById('alta-producto-unidad').value;
      if (!altaProveedor.productos.some((p) => p.producto === producto && p.descripcion.toLowerCase() === descripcion.toLowerCase())) {
        altaProveedor.productos.push({ producto, descripcion, unidad });
      }
      renderProveedores().then(() => document.getElementById('alta-descripcion')?.focus());
    };
    document.getElementById('btn-agregar-producto-alta').addEventListener('click', agregarProductoAlta);
    document.getElementById('alta-descripcion').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      agregarProductoAlta();
    });
    app.querySelectorAll('.quitar-producto-alta').forEach((btn) => {
      btn.addEventListener('click', () => {
        leerAlta();
        altaProveedor.productos.splice(Number(btn.dataset.i), 1);
        renderProveedores();
      });
    });
    document.getElementById('btn-cancelar-form-proveedor').addEventListener('click', () => {
      mostrarFormProveedor = false;
      errorFormProveedor = null;
      altaProveedor = { nombre: '', telefono: '', nota: '', saldo: '', productos: [] };
      renderProveedores();
    });
    document.getElementById('form-proveedor').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = document.getElementById('nombre-proveedor').value.trim();
      if (!nombre) return;
      leerAlta();
      // Un producto elegido y sin agregar con el "+" también cuenta.
      const pendiente = productoElegido('alta-producto');
      if (pendiente) {
        const descripcion = document.getElementById('alta-descripcion').value.trim();
        if (!altaProveedor.productos.some((p) => p.producto === pendiente && p.descripcion.toLowerCase() === descripcion.toLowerCase())) {
          altaProveedor.productos.push({ producto: pendiente, descripcion, unidad: document.getElementById('alta-producto-unidad').value });
        }
      }
      const saldo = limpiarNumeroMoneda(document.getElementById('saldo-inicial-proveedor').value);
      const resultado = await window.freska.proveedores.crear({
        nombre,
        telefono: document.getElementById('telefono-proveedor').value,
        nota: document.getElementById('nota-proveedor').value,
        saldo_inicial: Number.isFinite(saldo) ? saldo : 0,
      });
      if (!resultado.ok) {
        errorFormProveedor = resultado.error;
        renderProveedores();
        return;
      }
      for (const p of altaProveedor.productos) {
        await window.freska.proveedores.agregarProducto({ proveedor_id: resultado.id, producto: p.producto, descripcion: p.descripcion, unidad: p.unidad });
      }
      errorFormProveedor = null;
      mostrarFormProveedor = false;
      altaProveedor = { nombre: '', telefono: '', nota: '', saldo: '', productos: [] };
      mostrarToast('Proveedor guardado.', 'ok');
      renderProveedores();
    });
  } else {
    document.getElementById('btn-toggle-form-proveedor').addEventListener('click', () => {
      mostrarFormProveedor = true;
      errorFormProveedor = null;
      renderProveedores();
    });
  }

  document.getElementById('buscar-proveedor')?.addEventListener('input', (e) => {
    const q = normalizarTexto(e.target.value.trim());
    document.querySelectorAll('#proveedores-body tr[data-nombre]').forEach((fila) => {
      fila.style.display = normalizarTexto(fila.dataset.nombre).includes(q) ? '' : 'none';
    });
  });

  app.querySelectorAll('#proveedores-body tr[data-id]').forEach((fila) => {
    const abrir = () => {
      mostrarDatosProveedor = false;
      limiteHistorialProveedor = 30;
      renderProveedorDetalle(Number(fila.dataset.id));
    };
    fila.addEventListener('click', abrir);
    fila.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === fila) abrir();
    });
  });
  // "Compra" en la fila: abre la ficha con el formulario de compra listo.
  app.querySelectorAll('.compra-proveedor-fila').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      mostrarDatosProveedor = false;
      limiteHistorialProveedor = 30;
      formCompra = { editandoId: null, fecha: fechaHoyISO(), lineas: [], inicial: true };
      renderProveedorDetalle(Number(btn.dataset.id));
    });
  });
  // "Pagar" en la fila: abre la ficha con el pago ya empezado.
  app.querySelectorAll('.pagar-proveedor-fila').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      mostrarDatosProveedor = false;
      limiteHistorialProveedor = 30;
      permitirSinCuentaPago = false;
      formPago = { fecha: fechaHoyISO() };
      renderProveedorDetalle(Number(btn.dataset.id));
    });
  });
}

// ---------- Ficha ----------

function lineaCompraVacia() {
  return { producto: '', descripcion: '', unidad: 'kg', kilos: '', precio: '', importe: '', otro: true };
}

// Cómo se muestra un producto: el producto y, si tiene, la descripción aparte (ej: "Vaca — bife angosto"). Si
// se compra por unidad (no por kg, el caso normal) se agrega una etiqueta "unidad" para que no se confunda.
function rotuloProductoHtml(producto, descripcion, unidad) {
  return `${esc(producto)}${descripcion ? ` — ${esc(descripcion)}` : ''}${unidad === 'unidad' ? ' <span class="etiqueta-gasto">unidad</span>' : ''}`;
}

function textoNumero(n) {
  return n === null || n === undefined ? '' : formatearMoneda(n);
}

function numeroDeTexto(t) {
  const n = limpiarNumeroMoneda(String(t || ''));
  return Number.isFinite(n) ? n : null;
}

// Las descripciones sugeridas para un producto: lo que vende este proveedor (si ya tiene lista; si no, todo
// lo que se compró alguna vez), filtrado al producto elegido en la línea.
function descripcionesOfrecidas(producto) {
  if (!producto) return [];
  const base = productosProveedorCache.length ? productosProveedorCache : productosCompradosCache;
  return base.filter((p) => p.producto === producto && p.descripcion);
}

function opcionesDescripcionHtml(producto) {
  return descripcionesOfrecidas(producto)
    .map((p) => `<option value="${esc(p.descripcion)}"></option>`)
    .join('');
}

// Una línea de la compra: producto, kilos, precio por kilo e importe. Los productos que el proveedor ya vende
// se agregan tocándolos arriba (con su descripción, si tiene, y no se piden de nuevo); uno que no está en la
// lista se arma a mano, eligiendo el producto y, si hace falta, escribiendo una descripción.
function lineaCompraHtml(l, i, total) {
  const producto = String(l.producto || '').trim();
  const descripcionNorm = String(l.descripcion || '').trim().toLowerCase();
  const deLista = !l.otro && Boolean(producto) && productosProveedorCache.some((p) => p.producto === producto && (p.descripcion || '').toLowerCase() === descripcionNorm);
  // La unidad de la línea es la que se eligió para esta compra (por defecto, la del producto): se puede
  // cambiar acá aunque el producto ya venga de "Lo que vende", por si esta vez se compró distinto.
  const unidad = l.unidad === 'unidad' ? 'unidad' : 'kg';
  const esUnidad = unidad === 'unidad';
  const celdaProducto = deLista
    ? `<span class="lc-nombre">${rotuloProductoHtml(l.producto, l.descripcion)}</span>
        <input type="hidden" class="lc-producto" value="${esc(l.producto)}" />
        <input type="hidden" class="lc-descripcion" value="${esc(l.descripcion || '')}" />`
    : `<div class="lc-otro">
          <select class="lc-producto" aria-label="Producto">${opcionesTipoHtml(l.producto)}</select>
          <input type="text" class="lc-descripcion" list="lista-descripciones-${i}" maxlength="120" placeholder="Descripción" autocomplete="off" value="${esc(l.descripcion)}" aria-label="Descripción" />
          <datalist id="lista-descripciones-${i}">${opcionesDescripcionHtml(l.producto)}</datalist>
        </div>`;
  return `
    <tr class="linea-compra" data-i="${i}" data-modo="${deLista ? 'lista' : 'otro'}">
      <td>${celdaProducto}</td>
      <td><div class="input-unidad lc-cantidad">
        <input type="text" class="lc-kilos" inputmode="decimal" placeholder="${esUnidad ? 'Cantidad' : 'Kilos'}" autocomplete="off" value="${esc(l.kilos)}" aria-label="${esUnidad ? 'Cantidad' : 'Kilos'}" />
        <select class="lc-unidad" aria-label="Se compra">${unidadOpcionesHtml(unidad, true)}</select>
      </div></td>
      <td><div class="input-moneda"><span>$</span><input type="text" class="lc-precio" inputmode="decimal" placeholder="${esUnidad ? 'Por unidad' : 'Por kilo'}" autocomplete="off" value="${esc(l.precio)}" aria-label="${esUnidad ? 'Precio por unidad' : 'Precio por kilo'}" /></div></td>
      <td><div class="input-moneda"><span>$</span><input type="text" class="lc-importe" inputmode="decimal" placeholder="Importe" autocomplete="off" value="${esc(l.importe)}" aria-label="Importe" /></div></td>
      <td class="acciones-linea">${accionesLineaHtml('quitar-linea-compra', 'agregar-linea-compra', i, total)}</td>
    </tr>`;
}

// Las filas de la compra; sin ninguna, ya se muestra una en blanco lista para cargar (igual que Facturas y
// Pedidos), en vez de pedir que se toque el + para que aparezca.
function lineasCompraHtml(lineas) {
  const ls = lineas.length ? lineas : [lineaCompraVacia()];
  return ls.map((l, i) => lineaCompraHtml(l, i, ls.length)).join('');
}

function formCompraHtml() {
  const f = formCompra;
  return `
    <h2>${f.editandoId ? 'Editar compra' : 'Nueva compra'}</h2>
    <div class="panel gasto-form" id="form-compra">
      <div class="gasto-fila">
        <div class="gasto-campo">
          <span>Fecha</span>
          ${selectorFechaHtml('compra-fecha', f.fecha)}
        </div>
        <label class="gasto-campo"><span>N° de comprobante (opcional)</span><input type="text" id="compra-comprobante" maxlength="40" autocomplete="off" value="${esc(f.comprobante || '')}" /></label>
      </div>
      ${
        productosProveedorCache.length
          ? `<div class="retiro-sugerencias" id="productos-proveedor">
        <span class="pago-cheques-titulo">Lo que vende:</span>
        ${productosProveedorCache
          .map(
            (p) => `<span class="chip-retiro-grupo"><button type="button" class="chip-retiro" data-producto="${esc(p.producto)}" data-descripcion="${esc(p.descripcion || '')}" data-unidad="${esc(p.unidad || 'kg')}" data-precio="${p.ultimo_precio ? esc(formatearMoneda(p.ultimo_precio)) : ''}" title="Agregar a la compra${p.ultimo_precio ? ` (último precio $${formatearMoneda(p.ultimo_precio)}/${p.unidad === 'unidad' ? 'u' : 'kg'})` : ''}">${rotuloProductoHtml(p.producto, p.descripcion, p.unidad)}</button><button type="button" class="chip-retiro-x quitar-producto-compra" data-id="${p.id}" aria-label="Sacar ${esc(p.producto)} de lo que vende" title="Sacar de lo que vende">×</button></span>`
          )
          .join('')}
      </div>`
          : ''
      }
      <table class="tabla-compra tabla-sin-cajas">
        <tbody id="lineas-compra">${lineasCompraHtml(f.lineas)}</tbody>
        <tfoot><tr class="fila-total-compra"><td colspan="3"></td><td class="celda-total-compra"><span class="factura-total-panel total-compra-numero"><span class="total-compra-prefijo">Total: $</span><span id="total-compra"></span></span></td><td></td></tr></tfoot>
      </table>
      <div class="btn-group">
        <button type="button" id="btn-guardar-compra" class="primary">${f.editandoId ? 'Guardar cambios' : 'Guardar compra'}</button>
        ${f.editandoId ? '' : '<button type="button" id="btn-limpiar-compra" class="btn-limpiar">Limpiar compra</button>'}
        <button type="button" id="btn-cancelar-compra" class="cancelar">Cancelar</button>
      </div>
      <p id="error-compra" class="error-msg" style="display:none"></p>
    </div>`;
}

// Cómo se paga: Efectivo, cada cuenta (banco o app) de la que sale una transferencia, o Cheque. Un pago viejo con una
// transferencia sin cuenta se puede editar con la opción "Transferencia (sin cuenta)".
const TRANSFERENCIA_SIN_CUENTA = 'Transferencia (sin cuenta)';
let cuentasPagoProveedor = []; // los bancos y apps (todas las cuentas menos Efectivo)
let permitirSinCuentaPago = false;

function metodosPagoProveedor() {
  return ['Efectivo', ...cuentasPagoProveedor, ...(permitirSinCuentaPago ? [TRANSFERENCIA_SIN_CUENTA] : []), 'Cheque'];
}

// Una línea del pago, con el mismo estilo que al registrar el pago de un cliente: monto, método y un
// "−" (si hay más de una). Con el método Cheque se elige uno de la cartera y el monto es el del cheque.
// Al editar un pago, `metodo` y `cheque` traen lo que ya tenía la línea y `cargada` evita que otra línea la pise.
function lineaPagoProveedorHtml(cheques, monto, metodo = 'Efectivo', cheque = null, cargada = false) {
  const esCheque = metodo === 'Cheque';
  return `
    <div class="pago-linea"${cargada ? ' data-cargada="1"' : ''}>
      <div class="input-moneda">
        <span>$</span>
        <input type="text" inputmode="decimal" class="monto-pago" value="${esc(monto)}"${esCheque ? ' readonly' : ''} />
      </div>
      <select class="metodo-pago" aria-label="Cómo se paga">
        ${metodosPagoProveedor().map((m) => `<option${m === metodo ? ' selected' : ''}>${esc(m)}</option>`).join('')}
      </select>
      <button class="btn-redondo btn-menos quitar-linea-pago" type="button" aria-label="Quitar método de pago" title="Quitar">−</button>
      <div class="pago-cheque"${esCheque ? '' : ' hidden'}>
        ${
          cheques.length
            ? `<select class="cheque-elegido" aria-label="Cheque de la cartera">${cheque ? `<option value="${cheque.id}" selected>${esc(textoChequeOpcion(cheque))}</option>` : ''}</select>`
            : '<span class="pin-subtitulo">No tenés cheques en cartera. Se cargan en Dinero → Cheques.</span>'
        }
      </div>
    </div>`;
}

// Lo que se le debía antes del pago que se está editando (o el saldo de hoy si es un pago nuevo).
function saldoParaPago(proveedor) {
  return redondearPesos(proveedor.saldo + (formPago && formPago.totalOriginal ? formPago.totalOriginal : 0));
}

function formPagoHtml(proveedor, cheques) {
  const f = formPago;
  const saldo = saldoParaPago(proveedor);
  return `
    <h2>${f.editandoId ? 'Editar pago a' : 'Pagar a'} ${esc(proveedor.nombre)}</h2>
    <div class="panel" id="form-pago-proveedor">
      ${
        // Cuánto le debés (o a favor) ya se ve arriba, en el encabezado de la ficha; acá solo se repite si es
        // un dato distinto: al editar un pago (sin contarlo) o cuando no le debe nada (el encabezado no dice eso).
        f.editandoId
          ? `<p style="margin:0 0 12px">Sin contar este pago, le debés <strong>$${formatearMoneda(saldo)}</strong>.</p>`
          : saldo === 0
            ? '<p style="margin:0 0 12px">No le debés nada.</p>'
            : ''
      }
      <div class="gasto-fila">
        <div class="gasto-campo">
          <span>Fecha</span>
          ${selectorFechaHtml('pago-fecha', f.fecha)}
        </div>
      </div>
      <div class="pago-lineas">${
        f.lineas
          ? f.lineas.map((l) => lineaPagoProveedorHtml(cheques, l.monto, l.metodo, l.cheque, true)).join('')
          : lineaPagoProveedorHtml(cheques, saldo > 0 ? formatearMoneda(saldo) : '')
      }</div>
      <div class="pago-agregar">
        <button class="btn-redondo btn-mas btn-agregar-pago" type="button" aria-label="Agregar otro método de pago" title="Agregar otro método de pago">+</button>
      </div>
      <p class="pin-subtitulo">El efectivo sale de la caja: aparece en el Cierre de caja de ese día.</p>
      <p class="factura-total" id="total-pago" style="margin:8px 0"></p>
      <div class="btn-group">
        <button type="button" id="btn-guardar-pago" class="primary">${f.editandoId ? 'Guardar cambios' : 'Guardar pago'}</button>
        <button type="button" id="btn-cancelar-pago" class="cancelar">Cancelar</button>
      </div>
      <p id="error-pago" class="error-msg" style="display:none"></p>
    </div>`;
}

// Detalle de un pago: "Efectivo $X · Transferencia $Y · Cheque Galicia N° 123 $Z".
function detallePagoProveedor(p) {
  const partes = [];
  if (p.efectivo > 0) partes.push(`Efectivo $${formatearMoneda(p.efectivo)}`);
  if (p.transferencia > 0) {
    const conCuenta = (p.transferencias || []).filter((t) => t.cuenta);
    const asignado = conCuenta.reduce((acc, t) => acc + t.monto, 0);
    conCuenta.forEach((t) => partes.push(`Transferencia (${t.cuenta}) $${formatearMoneda(t.monto)}`));
    if (p.transferencia - asignado > 0.005) partes.push(`Transferencia $${formatearMoneda(p.transferencia - asignado)}`);
  }
  p.cheques.forEach((c) => partes.push(`Cheque ${c.banco} N° ${c.numero} $${formatearMoneda(c.importe)}`));
  return partes.map(esc).join(' · ');
}

function textoLineaCompra(i) {
  const partes = [];
  const esUnidad = i.unidad === 'unidad';
  if (i.kilos) partes.push(esUnidad ? `${formatearCantidad(i.kilos)} ${i.kilos === 1 ? 'unidad' : 'unidades'}` : `${formatearCantidad(i.kilos)} kg`);
  if (i.precio_kg) partes.push(`× $${formatearMoneda(i.precio_kg)}`);
  return `${rotuloProductoHtml(i.producto, i.descripcion, i.unidad)}${partes.length ? ` — ${partes.join(' ')}` : ''}`;
}

// Detalle de una devolución: "Vaca — Nalga · 4,6 kg · Queda a favor" (o "Devolvió la plata: Efectivo").
function detalleDevolucionProveedor(d) {
  const partes = [];
  if (d.producto) {
    const cantidad = d.kilos ? ` · ${formatearCantidad(d.kilos)} ${d.unidad === 'unidad' ? (d.kilos === 1 ? 'unidad' : 'unidades') : 'kg'}` : '';
    partes.push(`${esc(d.producto)}${d.descripcion ? ` — ${esc(d.descripcion)}` : ''}${cantidad}`);
  } else if (d.kilos) partes.push(`${formatearCantidad(d.kilos)} ${d.unidad === 'unidad' ? 'unidades' : 'kg'}`);
  partes.push(d.reembolso_cuenta ? `Devolvió la plata: ${esc(d.reembolso_cuenta)}` : 'Queda a favor');
  const lineas = [`<div class="detalle-compra-linea">${partes.join(' · ')}</div>`];
  if (d.nota) lineas.push(`<div class="detalle-compra-linea">${esc(d.nota)}</div>`);
  return lineas.join('');
}

function formDevolucionHtml(proveedor, historial, cuentas) {
  const f = formDevolucion;
  const compras = [...historial.compras].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id).slice(0, 30);
  return `
    <h2>Devolución a ${esc(proveedor.nombre)}</h2>
    <div class="panel gasto-form" id="form-devolucion-proveedor">
      <div class="gasto-fila">
        <div class="gasto-campo">
          <span>Fecha</span>
          ${selectorFechaHtml('dev-fecha', f.fecha)}
        </div>
        <label class="gasto-campo">
          <span>De qué compra (opcional)</span>
          <select id="dev-compra">
            <option value="">Sin elegir</option>
            ${compras.map((c) => `<option value="${c.id}">${esc(`${formatearFechaCorta(c.fecha)} · ${c.items.map((i) => i.producto).join(', ') || 'Compra'} · $${formatearMoneda(c.total)}`)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="gasto-fila">
        <label class="gasto-campo">
          <span>Producto</span>
          <select id="dev-producto"></select>
        </label>
        <label class="gasto-campo">
          <span id="dev-cantidad-rotulo">Kilos</span>
          <input type="text" id="dev-kilos" inputmode="decimal" autocomplete="off" />
        </label>
        <label class="gasto-campo">
          <span>Monto</span>
          <div class="input-moneda"><span>$</span><input type="text" id="dev-monto" inputmode="decimal" autocomplete="off" /></div>
        </label>
      </div>
      <div class="gasto-fila">
        <label class="gasto-campo">
          <span>¿Cómo queda?</span>
          <select id="dev-como">
            <option value="favor">Queda a favor mío</option>
            <option value="plata">Me devolvió la plata</option>
          </select>
        </label>
        <label class="gasto-campo" id="dev-cuenta-campo" hidden>
          <span>Entró a</span>
          <select id="dev-cuenta">${cuentas.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select>
        </label>
        <label class="gasto-campo gasto-campo-grande">
          <span>Nota (opcional)</span>
          ${campoLimpiableHtml('<input type="text" id="dev-nota" maxlength="200" placeholder="Ej: carne en mal estado" autocomplete="off" />')}
        </label>
      </div>
      <p class="factura-total" id="total-devolucion" style="margin:8px 0"></p>
      <div class="btn-group">
        <button type="button" id="btn-guardar-devolucion" class="primary">Guardar devolución</button>
        <button type="button" id="btn-cancelar-devolucion" class="cancelar">Cancelar</button>
      </div>
      <p id="error-devolucion" class="error-msg" style="display:none"></p>
    </div>`;
}

function vincularFormDevolucion(proveedor, historial) {
  const id = proveedor.id;
  const el = (x) => document.getElementById(x);
  const errorEl = el('error-devolucion');
  const selCompra = el('dev-compra');
  const selProducto = el('dev-producto');
  const inputKilos = el('dev-kilos');
  const inputMonto = el('dev-monto');
  // Lo que se eligió en "Producto": una línea de la compra (con su precio por kilo) o un tipo de la lista.
  let lineaElegida = null;
  let montoAMano = false;

  const compraElegida = () => historial.compras.find((c) => String(c.id) === selCompra.value) || null;
  const pintarProductos = () => {
    const compra = compraElegida();
    if (compra) {
      selProducto.innerHTML = compra.items
        .map((i, n) => `<option value="${n}">${esc(`${i.producto}${i.descripcion ? ` — ${i.descripcion}` : ''}`)}</option>`)
        .join('');
    } else {
      selProducto.innerHTML = `<option value="">Sin detallar</option>${tiposProductoCache.map((t, n) => `<option value="${n}">${esc(t.nombre)}</option>`).join('')}`;
    }
    elegirProducto();
  };
  const elegirProducto = () => {
    const compra = compraElegida();
    lineaElegida = compra && selProducto.value !== '' ? compra.items[Number(selProducto.value)] : null;
    const unidades = lineaElegida && lineaElegida.unidad === 'unidad';
    const tope = maximoDevolver();
    el('dev-cantidad-rotulo').textContent = `${unidades ? 'Unidades' : 'Kilos'}${tope !== null ? ` (máx. ${formatearCantidad(tope)})` : ''}`;
    limitarKilos();
    sugerirMonto();
  };
  // Con la compra elegida, lo máximo que se puede devolver es lo que se compró de ese producto, menos lo ya devuelto.
  const kilosEscritos = () => {
    const n = limpiarNumeroCantidad(inputKilos.value);
    return Number.isFinite(n) ? n : null;
  };
  const maximoDevolver = () => {
    const compra = compraElegida();
    if (!compra || !lineaElegida || !lineaElegida.kilos) return null;
    const yaDevuelto = (historial.devoluciones || [])
      .filter((d) => d.compra_id === compra.id && d.producto === lineaElegida.producto && (d.descripcion || '') === (lineaElegida.descripcion || '') && d.unidad === lineaElegida.unidad)
      .reduce((a, d) => a + (d.kilos || 0), 0);
    return Math.max(0, Math.round((lineaElegida.kilos - yaDevuelto) * 1000) / 1000);
  };
  // Si se escribe más que el máximo, se deja el máximo.
  const limitarKilos = () => {
    const tope = maximoDevolver();
    const kilos = kilosEscritos();
    if (tope !== null && kilos && kilos > tope) inputKilos.value = formatearCantidad(tope);
  };
  // Con la compra y los kilos, el monto sale solo (kilos × precio de esa compra) hasta que se escribe a mano.
  const sugerirMonto = () => {
    const kilos = kilosEscritos();
    if (montoAMano || !lineaElegida || !lineaElegida.precio_kg || !kilos) return;
    inputMonto.value = formatearMoneda(redondearPesos(kilos * lineaElegida.precio_kg));
    actualizarResumen();
  };
  const actualizarResumen = () => {
    const monto = numeroDeTexto(inputMonto.value) || 0;
    const plata = el('dev-como').value === 'plata';
    const total = el('total-devolucion');
    if (!monto) {
      total.textContent = '';
      return;
    }
    if (plata) {
      total.textContent = `El proveedor devolvió $${formatearMoneda(monto)} en plata: lo que le debés no cambia.`;
      return;
    }
    const queda = redondearPesos(proveedor.saldo - monto);
    total.textContent = `Devolución de $${formatearMoneda(monto)} — ${queda > 0 ? `le quedarías debiendo $${formatearMoneda(queda)}` : queda < 0 ? `quedaría un saldo a favor de $${formatearMoneda(-queda)}` : 'le quedarías debiendo $0'}`;
  };

  vincularSelectorFecha('dev-fecha', formDevolucion.fecha, (nueva) => {
    const fecha = nueva || fechaHoyISO();
    el('dev-fecha').value = formatearFechaCorta(fecha);
    formDevolucion.fecha = fecha;
  });
  vincularFormatoMoneda(inputMonto);
  vincularCampoLimpiable(el('dev-nota'));
  selCompra.addEventListener('change', pintarProductos);
  selProducto.addEventListener('change', elegirProducto);
  vincularFormatoCantidad(inputKilos); // coma o punto decimal, hasta 3 decimales (va antes de limitar y sugerir el monto)
  inputKilos.addEventListener('input', () => {
    limitarKilos();
    sugerirMonto();
  });
  inputMonto.addEventListener('input', () => {
    montoAMano = true;
    actualizarResumen();
  });
  el('dev-como').addEventListener('change', () => {
    el('dev-cuenta-campo').hidden = el('dev-como').value !== 'plata';
    actualizarResumen();
  });
  pintarProductos();

  el('btn-cancelar-devolucion').addEventListener('click', () => {
    formDevolucion = null;
    renderProveedorDetalle(id);
  });
  el('btn-guardar-devolucion').addEventListener('click', async () => {
    const fecha = fechaCortaAIso(el('dev-fecha').value);
    const compra = compraElegida();
    const nombreProducto = lineaElegida ? lineaElegida.producto : selProducto.value !== '' && !compra ? tiposProductoCache[Number(selProducto.value)].nombre : '';
    const resultado = !fecha
      ? { ok: false, error: 'La fecha no es válida.' }
      : await window.freska.proveedores.devolver({
          proveedor_id: id,
          fecha,
          compra_id: compra ? compra.id : null,
          producto: nombreProducto,
          descripcion: lineaElegida ? lineaElegida.descripcion || '' : '',
          unidad: lineaElegida ? lineaElegida.unidad : 'kg',
          kilos: kilosEscritos() || null,
          monto: limpiarNumeroMoneda(inputMonto.value),
          reembolso_cuenta: el('dev-como').value === 'plata' ? el('dev-cuenta').value : null,
          nota: el('dev-nota').value,
        });
    if (!resultado.ok) {
      errorEl.textContent = resultado.error;
      errorEl.style.display = 'block';
      return;
    }
    mostrarToast('Devolución guardada.', 'ok');
    formDevolucion = null;
    renderProveedorDetalle(id);
  });
  inputKilos.focus();
}

async function renderProveedorDetalle(id) {
  const [proveedores, historial, cheques, productosComprados, productosDelProveedor, tipos, resumenCuentas] = await Promise.all([
    window.freska.proveedores.listar(),
    window.freska.proveedores.historial(id),
    formPago ? window.freska.cheques.listar({ estado: 'en_cartera' }) : [],
    formCompra ? window.freska.proveedores.productosComprados() : [],
    formCompra || mostrarDatosProveedor ? window.freska.proveedores.productos(id) : [],
    window.freska.proveedores.tipos(),
    formPago || formDevolucion ? window.freska.cuentas.resumen() : null,
  ]);
  const proveedor = proveedores.find((p) => p.id === id);
  if (!proveedor) return renderProveedores();
  if (resumenCuentas) cuentasPagoProveedor = resumenCuentas.cuentas.filter((c) => !/^efectivo$/i.test(c.nombre.trim())).map((c) => c.nombre);
  const todasLasCuentas = resumenCuentas ? resumenCuentas.cuentas.map((c) => c.nombre) : [];
  // Al editar un pago, sus propios cheques también se pueden elegir (hoy figuran como entregados).
  if (formPago && formPago.editandoId) {
    const pagoEditado = historial.pagos.find((p) => p.id === formPago.editandoId);
    if (pagoEditado) pagoEditado.cheques.forEach((c) => cheques.push(c));
  }
  productosCompradosCache = productosComprados;
  productosProveedorCache = productosDelProveedor;
  // Una compra nueva arranca vacía si el proveedor ya tiene su lista (se agrega tocando); si no tiene, con una línea para escribir.
  if (formCompra && formCompra.inicial) {
    if (!productosProveedorCache.length) formCompra.lineas = [lineaCompraVacia()];
    formCompra.inicial = false;
  }
  tiposProductoCache = tipos;

  const movimientos = [];
  if (proveedor.saldo_inicial) movimientos.push({ tipo: 'inicial', fecha: '0000-00-00', monto: proveedor.saldo_inicial });
  historial.compras.forEach((c) => movimientos.push({ tipo: 'compra', fecha: c.fecha, creado: c.creado || '', id: c.id, monto: c.total, compra: c }));
  historial.pagos.forEach((p) => movimientos.push({ tipo: 'pago', fecha: p.fecha, creado: p.creado || '', id: p.id, monto: p.total, pago: p }));
  (historial.devoluciones || []).forEach((d) => movimientos.push({ tipo: 'devolucion', fecha: d.fecha, creado: d.creado || '', id: d.id, monto: d.monto, devolucion: d }));
  // Por fecha y, dentro del mismo día, por orden de carga (lo último que se cargó queda arriba). Lo cargado
  // antes de que existiera la hora de carga va primero, con las compras antes que los pagos.
  movimientos.sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.creado || '').localeCompare(b.creado || '') || (a.tipo === 'pago') - (b.tipo === 'pago') || (a.id || 0) - (b.id || 0));
  let acumulado = 0;
  movimientos.forEach((m) => {
    // Una devolución resta de lo que se le debe, salvo que el proveedor haya devuelto la plata (entonces la deuda queda igual).
    const efecto = m.tipo === 'pago' ? -m.monto : m.tipo === 'devolucion' ? (m.devolucion.reembolso_cuenta ? 0 : -m.monto) : m.monto;
    acumulado = redondearPesos(acumulado + efecto);
    m.saldo = acumulado;
  });
  movimientos.reverse();
  const visibles = movimientos.slice(0, limiteHistorialProveedor);
  const ocultos = movimientos.length - visibles.length;
  const activo = proveedorActivo(proveedor);
  const hayFormulario = Boolean(formCompra || formPago || formDevolucion);

  app.innerHTML = `
    <button id="btn-volver-proveedores" class="btn-volver" type="button">&larr; Volver a proveedores</button>
    <div class="ficha-cliente-header">
      <h2 id="titulo-ficha-proveedor" class="titulo-colapsable">
        ${esc(proveedor.nombre)}
        <span class="icono-colapsar ${mostrarDatosProveedor ? 'abierto' : ''}">▾</span>
      </h2>
      <div class="ficha-cliente-estado">
        ${proveedor.saldo > 0 ? `<span class="badge badge-pendiente" style="text-transform:none">Le debés $${formatearMoneda(proveedor.saldo)}</span>` : ''}
        ${proveedor.saldo < 0 ? `<span class="badge" style="text-transform:none">A favor $${formatearMoneda(-proveedor.saldo)}</span>` : ''}
        ${!activo ? '<span class="badge badge-baja">Dado de baja</span><button type="button" id="btn-alta-proveedor" class="primary">Dar de alta</button>' : ''}
      </div>
    </div>
    ${mostrarDatosProveedor ? `<div class="panel" id="ficha-proveedor"></div>` : ''}
    ${
      activo && !hayFormulario
        ? `<div class="btn-group" style="margin-bottom:16px">
      <button type="button" id="btn-nueva-compra" class="primary">+ Cargar compra</button>
      <button type="button" id="btn-nuevo-pago">Pagar</button>
      <button type="button" id="btn-nueva-devolucion">Devolución</button>
    </div>`
        : ''
    }
    ${formCompra ? formCompraHtml() : ''}
    ${formPago ? formPagoHtml(proveedor, cheques) : ''}
    ${formDevolucion ? formDevolucionHtml(proveedor, historial, todasLasCuentas) : ''}

    <h2>Historial</h2>
    <table class="tabla-historial-proveedor">
      <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Monto</th><th>Saldo</th><th></th></tr></thead>
      <tbody>
        ${
          movimientos.length === 0
            ? '<tr><td colspan="6">Todavía no hay movimientos.</td></tr>'
            : visibles
                .map((m) => {
                  if (m.tipo === 'inicial') {
                    return `<tr><td>—</td><td>Saldo inicial</td><td></td><td>$${formatearMoneda(m.monto)}</td><td>$${formatearMoneda(m.saldo)}</td><td></td></tr>`;
                  }
                  if (m.tipo === 'compra') {
                    return `<tr>
          <td>${fechaLargaCierre(m.fecha)}</td>
          <td>Compra</td>
          <td>${m.compra.comprobante ? `<div class="detalle-compra-comprobante">N° ${esc(m.compra.comprobante)}</div>` : ''}${m.compra.items.map((i) => `<div class="detalle-compra-linea">${textoLineaCompra(i)} — $${formatearMoneda(i.importe)}</div>`).join('')}</td>
          <td>$${formatearMoneda(m.monto)}</td>
          <td>$${formatearMoneda(m.saldo)}</td>
          <td class="celda-centrada"><div class="menu-fila">
            <button class="btn-menu-fila" type="button" aria-label="Acciones de la compra del ${fechaLargaCierre(m.fecha)}">⋮</button>
            <div class="menu-fila-lista">
              <button type="button" class="item-menu editar-compra" data-id="${m.id}">Editar</button>
              <button type="button" class="item-menu quitar-compra" data-id="${m.id}">Eliminar</button>
            </div>
          </div></td>
        </tr>`;
                  }
                  if (m.tipo === 'devolucion') {
                    return `<tr>
          <td>${fechaLargaCierre(m.fecha)}</td>
          <td>Devolución</td>
          <td>${detalleDevolucionProveedor(m.devolucion)}</td>
          <td><span class="monto-negativo">$${formatearMoneda(m.monto)}</span></td>
          <td>$${formatearMoneda(m.saldo)}</td>
          <td class="celda-centrada"><div class="menu-fila">
            <button class="btn-menu-fila" type="button" aria-label="Acciones de la devolución del ${fechaLargaCierre(m.fecha)}">⋮</button>
            <div class="menu-fila-lista">
              <button type="button" class="item-menu quitar-devolucion-proveedor" data-id="${m.id}">Eliminar</button>
            </div>
          </div></td>
        </tr>`;
                  }
                  return `<tr>
          <td>${fechaLargaCierre(m.fecha)}</td>
          <td>Pago</td>
          <td>${detallePagoProveedor(m.pago)}</td>
          <td><span class="monto-negativo">$${formatearMoneda(m.monto)}</span></td>
          <td>$${formatearMoneda(m.saldo)}</td>
          <td class="celda-centrada"><div class="menu-fila">
            <button class="btn-menu-fila" type="button" aria-label="Acciones del pago del ${fechaLargaCierre(m.fecha)}">⋮</button>
            <div class="menu-fila-lista">
              <button type="button" class="item-menu editar-pago-proveedor" data-id="${m.id}">Editar</button>
              <button type="button" class="item-menu quitar-pago-proveedor" data-id="${m.id}">Eliminar</button>
            </div>
          </div></td>
        </tr>`;
                })
                .join('')
        }
      </tbody>
    </table>
    ${ocultos > 0 ? `<p style="text-align:center; margin-top:16px;"><button type="button" id="btn-ver-mas-proveedor">Ver más antiguos (${ocultos})</button></p>` : ''}
  `;

  document.getElementById('btn-volver-proveedores').addEventListener('click', () => {
    formCompra = null;
    formPago = null;
    formDevolucion = null;
    renderProveedores();
  });
  document.getElementById('btn-ver-mas-proveedor')?.addEventListener('click', () => {
    limiteHistorialProveedor += 30;
    renderProveedorDetalle(id);
  });
  document.getElementById('btn-alta-proveedor')?.addEventListener('click', async () => {
    await window.freska.proveedores.darDeAlta(id);
    mostrarToast('Proveedor dado de alta.', 'ok');
    renderProveedorDetalle(id);
  });
  document.getElementById('titulo-ficha-proveedor').addEventListener('click', () => {
    mostrarDatosProveedor = !mostrarDatosProveedor;
    renderProveedorDetalle(id);
  });
  if (mostrarDatosProveedor) vincularFichaProveedor(proveedor, historial);

  document.getElementById('btn-nueva-compra')?.addEventListener('click', () => {
    formCompra = { editandoId: null, fecha: fechaHoyISO(), lineas: [], inicial: true };
    renderProveedorDetalle(id);
  });
  document.getElementById('btn-nueva-devolucion')?.addEventListener('click', () => {
    formDevolucion = { fecha: fechaHoyISO() };
    renderProveedorDetalle(id);
  });
  document.getElementById('btn-nuevo-pago')?.addEventListener('click', () => {
    permitirSinCuentaPago = false;
    formPago = { fecha: fechaHoyISO() };
    renderProveedorDetalle(id);
  });

  vincularMenuFila();
  app.querySelectorAll('.editar-compra').forEach((btn) => {
    btn.addEventListener('click', () => {
      const compra = historial.compras.find((c) => c.id === Number(btn.dataset.id));
      if (!compra) return;
      formPago = null;
      formDevolucion = null;
      formCompra = {
        editandoId: compra.id,
        fecha: compra.fecha,
        comprobante: compra.comprobante || '',
        lineas: compra.items.map((i) => ({
          producto: i.producto,
          descripcion: i.descripcion || '',
          unidad: i.unidad || 'kg',
          kilos: textoNumero(i.kilos),
          precio: textoNumero(i.precio_kg),
          importe: textoNumero(i.importe),
        })),
      };
      renderProveedorDetalle(id).then(() => window.scrollTo({ top: 0 }));
    });
  });
  app.querySelectorAll('.quitar-compra').forEach((btn) => {
    btn.addEventListener('click', () => {
      const compra = historial.compras.find((c) => c.id === Number(btn.dataset.id));
      if (!compra) return;
      confirmarQuitar('Quitar compra', `La compra del ${fechaLargaCierre(compra.fecha)} por $${formatearMoneda(compra.total)}.`, async () => {
        await window.freska.proveedores.quitarCompra(compra.id);
        mostrarToast('Compra quitada.', 'ok');
        renderProveedorDetalle(id);
      });
    });
  });
  app.querySelectorAll('.editar-pago-proveedor').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pago = historial.pagos.find((p) => p.id === Number(btn.dataset.id));
      if (!pago) return;
      formCompra = null;
      formDevolucion = null;
      const lineas = [];
      if (pago.efectivo > 0) lineas.push({ metodo: 'Efectivo', monto: formatearMoneda(pago.efectivo), cheque: null });
      const partesConCuenta = (pago.transferencias || []).filter((t) => t.cuenta);
      partesConCuenta.forEach((t) => lineas.push({ metodo: t.cuenta, monto: formatearMoneda(t.monto), cheque: null }));
      const sinCuenta = redondearPesos(pago.transferencia - partesConCuenta.reduce((acc, t) => acc + t.monto, 0));
      if (sinCuenta > 0.005) lineas.push({ metodo: TRANSFERENCIA_SIN_CUENTA, monto: formatearMoneda(sinCuenta), cheque: null });
      permitirSinCuentaPago = sinCuenta > 0.005;
      pago.cheques.forEach((c) => lineas.push({ metodo: 'Cheque', monto: formatearMoneda(c.importe), cheque: c }));
      formPago = { fecha: pago.fecha, editandoId: pago.id, totalOriginal: pago.total, lineas };
      renderProveedorDetalle(id).then(() => window.scrollTo({ top: 0 }));
    });
  });
  app.querySelectorAll('.quitar-devolucion-proveedor').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dev = historial.devoluciones.find((d) => d.id === Number(btn.dataset.id));
      if (!dev) return;
      const aviso = dev.reembolso_cuenta ? `La plata que entró a ${dev.reembolso_cuenta} deja de contar.` : 'Vuelve a sumarse a lo que le debés.';
      confirmarQuitar('Quitar devolución', `La devolución del ${fechaLargaCierre(dev.fecha)} por $${formatearMoneda(dev.monto)}.`, async () => {
        await window.freska.proveedores.quitarDevolucion(dev.id);
        mostrarToast('Devolución quitada.', 'ok');
        renderProveedorDetalle(id);
      }, aviso);
    });
  });
  app.querySelectorAll('.quitar-pago-proveedor').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pago = historial.pagos.find((p) => p.id === Number(btn.dataset.id));
      if (!pago) return;
      const avisos = [];
      if (pago.cheques.length) avisos.push(pago.cheques.length === 1 ? 'El cheque vuelve a la cartera.' : 'Los cheques vuelven a la cartera.');
      if (pago.efectivo > 0) avisos.push('El efectivo deja de contar como salida en el Cierre de caja de ese día.');
      confirmarQuitar('Quitar pago', `El pago del ${fechaLargaCierre(pago.fecha)} por $${formatearMoneda(pago.total)}.`, async () => {
        await window.freska.proveedores.quitarPago(pago.id);
        mostrarToast('Pago quitado.', 'ok');
        renderProveedorDetalle(id);
      }, avisos.join(' '));
    });
  });

  if (formCompra) {
    vincularFormCompra(proveedor);
    limitarListaVende(document.getElementById('productos-proveedor'));
  }
  if (formPago) vincularFormPago(proveedor, cheques);
  if (formDevolucion) vincularFormDevolucion(proveedor, historial);
}

function confirmarQuitar(titulo, detalle, alConfirmar, aviso = '') {
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>${esc(titulo)}</h3>
    <p>¿Seguro que querés quitarlo?</p>
    <p><strong>${esc(detalle)}</strong></p>
    ${aviso ? `<p class="pin-subtitulo">${esc(aviso)}</p>` : ''}
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, quitar</button>
    </div>
  `);
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    cerrarModal();
    await alConfirmar();
  });
}

// ---------- Datos del proveedor (ver / editar / dar de baja) ----------

function vincularFichaProveedor(proveedor, historial) {
  const ficha = document.getElementById('ficha-proveedor');
  const mostrarVista = () => {
    ficha.innerHTML = `
      <p><strong>Teléfono:</strong> ${esc(proveedor.telefono || '—')}</p>
      <p><strong>Nota:</strong> ${esc(proveedor.nota || '—')}</p>
      <p><strong>Saldo inicial:</strong> $${formatearMoneda(proveedor.saldo_inicial)}</p>
      <p><strong>Lo que vende</strong></p>
      ${
        productosProveedorCache.length
          ? `<div class="retiro-sugerencias">${productosProveedorCache
              .map(
                (p) => `<span class="chip-retiro-grupo"><span class="chip-retiro chip-texto">${rotuloProductoHtml(p.producto, p.descripcion, p.unidad)}</span><button type="button" class="chip-retiro-x quitar-producto-proveedor" data-id="${p.id}" aria-label="Sacar ${esc(p.producto)} de lo que vende" title="Sacar">×</button></span>`
              )
              .join('')}</div>`
          : '<p class="pin-subtitulo">Todavía no cargaste nada. Se van sumando solos cuando cargás una compra, y también podés agregarlos acá.</p>'
      }
      <div class="fila-producto-proveedor">
        ${productoBuscadorHtml('nuevo-producto', '')}
        <input type="text" id="nuevo-descripcion-proveedor" maxlength="120" autocomplete="off" placeholder="Descripción (opcional, ej: capón)" />
        ${unidadSelectHtml('nuevo-producto-unidad', 'kg')}
        <button type="button" id="btn-agregar-producto-proveedor" class="btn-redondo btn-mas" aria-label="Agregar a lo que vende" title="Agregar">+</button>
      </div>
      <p id="error-producto-proveedor" class="error-msg" style="display:none"></p>
      <div class="ficha-cliente-acciones">
        <button type="button" id="editar-datos-proveedor">Editar</button>
        ${proveedorActivo(proveedor) ? '<button type="button" id="baja-proveedor">Dar de baja</button>' : ''}
        <button type="button" id="eliminar-proveedor" class="btn-peligro">Eliminar proveedor</button>
      </div>`;
    document.getElementById('editar-datos-proveedor').addEventListener('click', () => mostrarEdicion(null));
    const agregarProducto = async () => {
      const resultado = await window.freska.proveedores.agregarProducto({
        proveedor_id: proveedor.id,
        producto: productoElegido('nuevo-producto'),
        descripcion: document.getElementById('nuevo-descripcion-proveedor').value,
        unidad: document.getElementById('nuevo-producto-unidad').value,
      });
      if (!resultado.ok) {
        const errorEl = document.getElementById('error-producto-proveedor');
        errorEl.textContent = resultado.error;
        errorEl.style.display = 'block';
        return;
      }
      await renderProveedorDetalle(proveedor.id);
      document.getElementById('nuevo-descripcion-proveedor')?.focus();
    };
    limitarListaVende(document.querySelector('#ficha-proveedor .retiro-sugerencias'));
    vincularProductoBuscador('nuevo-producto', () => renderProveedorDetalle(proveedor.id));
    document.getElementById('btn-agregar-producto-proveedor').addEventListener('click', agregarProducto);
    document.getElementById('nuevo-descripcion-proveedor').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      agregarProducto();
    });
    ficha.querySelectorAll('.quitar-producto-proveedor').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await window.freska.proveedores.quitarProducto(Number(btn.dataset.id));
        renderProveedorDetalle(proveedor.id);
      });
    });
    document.getElementById('eliminar-proveedor').addEventListener('click', () => {
      const cantCompras = historial.compras.length;
      const cantPagos = historial.pagos.length;
      const hayCheques = historial.pagos.some((p) => p.cheques.length);
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Eliminar a ${esc(proveedor.nombre)}</h3>
        <p>Se borra para siempre.${
          cantCompras + cantPagos
            ? ` Tiene ${cantCompras} ${cantCompras === 1 ? 'compra' : 'compras'} y ${cantPagos} ${cantPagos === 1 ? 'pago' : 'pagos'}, y se borran con él${hayCheques ? '; los cheques que le entregaste vuelven a la cartera' : ''}.`
            : ''
        }</p>
        <p class="pin-subtitulo">Si solo querés que no aparezca más en la lista, mejor dalo de baja: así conserva su historial.</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, eliminar</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        await window.freska.proveedores.eliminar(proveedor.id);
        cerrarModal();
        mostrarToast('Proveedor eliminado.', 'ok');
        mostrarDatosProveedor = false;
        renderProveedores();
      });
    });
    document.getElementById('baja-proveedor')?.addEventListener('click', () => {
      mostrarModal(`${modalXHtml('modal-cancelar')}
        <h3>Dar de baja a ${esc(proveedor.nombre)}</h3>
        <p>Deja de aparecer en la lista. Su historial se conserva y lo podés dar de alta de nuevo desde "Dados de baja".</p>
        <div class="btn-group">
          <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, dar de baja</button>
        </div>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('modal-confirmar').addEventListener('click', async () => {
        await window.freska.proveedores.darDeBaja(proveedor.id);
        cerrarModal();
        mostrarToast('Proveedor dado de baja.', 'ok');
        mostrarDatosProveedor = false;
        renderProveedores();
      });
    });
  };
  const mostrarEdicion = (error) => {
    ficha.innerHTML = `
      ${error ? `<p class="error-msg">${esc(error)}</p>` : ''}
      <label>Nombre <input type="text" id="edit-nombre-proveedor" maxlength="120" value="${esc(proveedor.nombre)}" autocomplete="off" /></label>
      <label>Teléfono (opcional) <input type="tel" id="edit-telefono-proveedor" maxlength="40" value="${esc(proveedor.telefono || '')}" autocomplete="off" /></label>
      <label>Nota (opcional) <input type="text" id="edit-nota-proveedor" maxlength="200" value="${esc(proveedor.nota || '')}" autocomplete="off" /></label>
      <label>Saldo inicial
        <div class="input-moneda"><span>$</span><input type="text" id="edit-saldo-proveedor" inputmode="decimal" autocomplete="off" value="${esc(proveedor.saldo_inicial ? formatearMoneda(proveedor.saldo_inicial) : '')}" /></div>
      </label>
      <div class="ficha-cliente-acciones">
        <button type="button" id="guardar-datos-proveedor" class="primary">Guardar</button>
        <button type="button" id="cancelar-datos-proveedor" class="cancelar">Cancelar</button>
      </div>`;
    vincularFormatoMoneda(document.getElementById('edit-saldo-proveedor'));
    document.getElementById('cancelar-datos-proveedor').addEventListener('click', mostrarVista);
    document.getElementById('guardar-datos-proveedor').addEventListener('click', async () => {
      const saldo = limpiarNumeroMoneda(document.getElementById('edit-saldo-proveedor').value);
      const resultado = await window.freska.proveedores.actualizar({
        id: proveedor.id,
        nombre: document.getElementById('edit-nombre-proveedor').value,
        telefono: document.getElementById('edit-telefono-proveedor').value,
        nota: document.getElementById('edit-nota-proveedor').value,
        saldo_inicial: Number.isFinite(saldo) ? saldo : 0,
      });
      if (!resultado.ok) {
        mostrarEdicion(resultado.error);
        return;
      }
      mostrarToast('Datos guardados.', 'ok');
      renderProveedorDetalle(proveedor.id);
    });
  };
  mostrarVista();
}

// ---------- Formulario de compra ----------

function leerLineasCompra() {
  return Array.from(document.querySelectorAll('#lineas-compra .linea-compra')).map((fila) => ({
    producto: fila.querySelector('.lc-producto').value,
    descripcion: fila.querySelector('.lc-descripcion').value,
    unidad: fila.querySelector('.lc-unidad').value,
    otro: fila.dataset.modo === 'otro',
    kilos: fila.querySelector('.lc-kilos').value,
    precio: fila.querySelector('.lc-precio').value,
    importe: fila.querySelector('.lc-importe').value,
  }));
}

function vincularFormCompra(proveedor) {
  const id = proveedor.id;
  const contenedor = document.getElementById('lineas-compra');
  const totalEl = document.getElementById('total-compra');
  const errorEl = document.getElementById('error-compra');

  const actualizarTotal = () => {
    const total = redondearPesos(
      leerLineasCompra().reduce((acc, l) => acc + (numeroDeTexto(l.importe) || 0), 0)
    );
    // Igual que en Nueva factura: el Total va adentro de la tabla, bajo el importe, y solo si hay algo cargado.
    totalEl.textContent = formatearMoneda(total);
    const pie = document.querySelector('.fila-total-compra');
    if (pie) pie.style.display = total > 0 ? '' : 'none';
  };

  // Kilos y precio calculan el importe; el importe con kilos calcula el precio. Se puede cargar de
  // cualquiera de los dos lados.
  const vincularFila = (fila) => {
    const kilos = fila.querySelector('.lc-kilos');
    const precio = fila.querySelector('.lc-precio');
    const importe = fila.querySelector('.lc-importe');
    [kilos, precio, importe].forEach(vincularFormatoMoneda);
    vincularFlechasCantidad(kilos);
    // Con dos de los tres datos, se calcula el que falta. Al cambiar los kilos: si hay precio se calcula el
    // importe; si no, pero hay importe, se calcula el precio por kilo (así da igual el orden en que se cargue).
    kilos.addEventListener('input', () => {
      const k = numeroDeTexto(kilos.value);
      const p = numeroDeTexto(precio.value);
      const imp = numeroDeTexto(importe.value);
      if (k && p) importe.value = formatearMoneda(redondearPesos(k * p));
      else if (k && imp) precio.value = formatearMoneda(Math.round((imp / k) * 100) / 100);
      actualizarTotal();
    });
    precio.addEventListener('input', () => {
      const k = numeroDeTexto(kilos.value);
      const p = numeroDeTexto(precio.value);
      if (k && p) importe.value = formatearMoneda(redondearPesos(k * p));
      actualizarTotal();
    });
    importe.addEventListener('input', () => {
      const k = numeroDeTexto(kilos.value);
      const imp = numeroDeTexto(importe.value);
      if (k && imp) precio.value = formatearMoneda(Math.round((imp / k) * 100) / 100);
      actualizarTotal();
    });
    // La unidad (Se compra: Por kg / Por unidad) de la línea: se puede cambiar tanto en un producto nuevo
    // como en uno de "Lo que vende" (por si esta vez se compró distinto). Actualiza los rótulos de Kilos/Precio.
    const cambiarUnidad = (nueva) => {
      fila.querySelector('select.lc-unidad').value = nueva;
      const esUnidad = nueva === 'unidad';
      kilos.placeholder = esUnidad ? 'Cantidad' : 'Kilos';
      kilos.setAttribute('aria-label', esUnidad ? 'Cantidad' : 'Kilos');
      precio.placeholder = esUnidad ? 'Por unidad' : 'Por kilo';
      precio.setAttribute('aria-label', esUnidad ? 'Precio por unidad' : 'Precio por kilo');
    };
    fila.querySelector('select.lc-unidad').addEventListener('change', (e) => cambiarUnidad(e.target.value));
    const productoSelect = fila.querySelector('.lc-producto');
    const descripcionInput = fila.querySelector('.lc-descripcion');
    if (fila.dataset.modo !== 'otro') return; // de la lista: producto y descripción fijos, no hay nada más que enlazar
    // Se enlaza primero (corta la propagación si se eligió "Editar productos…"). Al volver del editor se
    // redibuja la ficha conservando lo cargado.
    vincularSelectTipo(productoSelect, () => {
      formCompra.lineas = leerLineasCompra();
      renderProveedorDetalle(id);
    });
    // Al elegir un producto, las descripciones sugeridas pasan a ser las de ese producto.
    productoSelect.addEventListener('change', () => {
      fila.querySelector('datalist').innerHTML = opcionesDescripcionHtml(productoSelect.value);
    });
    // Al escribir una descripción ya conocida (para el producto elegido), se completa su unidad habitual.
    descripcionInput.addEventListener('change', () => {
      const texto = descripcionInput.value.trim().toLowerCase();
      const conocido =
        productosProveedorCache.find((p) => p.producto === productoSelect.value && (p.descripcion || '').toLowerCase() === texto) ||
        productosCompradosCache.find((p) => p.producto === productoSelect.value && (p.descripcion || '').toLowerCase() === texto);
      if (conocido && conocido.unidad) cambiarUnidad(conocido.unidad);
    });
  };
  const agregarLineaCompra = () => {
    const lineas = leerLineasCompra();
    lineas.push(lineaCompraVacia());
    redibujarLineas(lineas);
    contenedor.querySelector('.linea-compra:last-child .lc-producto').focus();
  };
  const redibujarLineas = (lineas) => {
    formCompra.lineas = lineas;
    contenedor.innerHTML = lineasCompraHtml(lineas);
    enlazarLineas();
    actualizarTotal();
  };
  const enlazarLineas = () => {
    contenedor.querySelectorAll('.linea-compra').forEach(vincularFila);
    contenedor.querySelectorAll('.quitar-linea-compra').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lineas = leerLineasCompra();
        lineas.splice(Number(btn.dataset.idx), 1);
        redibujarLineas(lineas);
      });
    });
    contenedor.querySelectorAll('.agregar-linea-compra').forEach((btn) => btn.addEventListener('click', agregarLineaCompra));
  };
  enlazarLineas();
  actualizarTotal();

  // La × saca el producto de lo que vende ese proveedor (si volvés a comprarlo, vuelve solo).
  document.querySelectorAll('#productos-proveedor .quitar-producto-compra').forEach((btn) => {
    btn.addEventListener('click', async () => {
      formCompra.lineas = leerLineasCompra();
      await window.freska.proveedores.quitarProducto(Number(btn.dataset.id));
      renderProveedorDetalle(id);
    });
  });

  // Tocar un producto de "Lo que vende" agrega su línea, con el último precio por kilo que se le pagó (se puede
  // cambiar) y el cursor en los kilos.
  document.querySelectorAll('#productos-proveedor .chip-retiro').forEach((chip) => {
    chip.addEventListener('click', () => {
      const lineas = leerLineasCompra();
      lineas.push({ ...lineaCompraVacia(), otro: false, producto: chip.dataset.producto, descripcion: chip.dataset.descripcion, unidad: chip.dataset.unidad || 'kg', precio: chip.dataset.precio || '' });
      redibujarLineas(lineas);
      contenedor.querySelector('.linea-compra:last-child .lc-kilos').focus();
    });
  });


  vincularSelectorFecha('compra-fecha', formCompra.fecha, (nueva) => {
    const fecha = nueva || fechaHoyISO();
    document.getElementById('compra-fecha').value = formatearFechaCorta(fecha);
    formCompra.fecha = fecha;
  });

  document.getElementById('btn-cancelar-compra').addEventListener('click', () => {
    formCompra = null;
    renderProveedorDetalle(id);
  });

  // A diferencia de "Cancelar" (cierra el formulario), "Limpiar" solo vacía lo cargado y lo deja abierto
  // para seguir cargando — mismo criterio que "Limpiar pedido"/"Limpiar factura".
  document.getElementById('btn-limpiar-compra')?.addEventListener('click', () => {
    const limpiar = () => {
      formCompra = { editandoId: null, fecha: fechaHoyISO(), lineas: [], inicial: true };
      renderProveedorDetalle(id);
    };
    const algoCargado = leerLineasCompra().some((l) => l.producto.trim() || l.descripcion.trim() || l.kilos || l.precio || l.importe);
    if (!algoCargado) {
      limpiar();
      return;
    }
    mostrarModal(`${modalXHtml('modal-cancelar')}
      <h3>Limpiar compra</h3>
      <p>¿Seguro que querés descartar esta compra? Vas a perder los productos que ya cargaste.</p>
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

  document.getElementById('btn-guardar-compra').addEventListener('click', async () => {
    const fecha = fechaCortaAIso(document.getElementById('compra-fecha').value);
    const items = leerLineasCompra()
      .filter((l) => l.producto.trim() || l.descripcion.trim() || l.kilos || l.precio || l.importe)
      .map((l) => ({
        producto: l.producto,
        descripcion: l.descripcion || null,
        unidad: l.unidad === 'unidad' ? 'unidad' : 'kg',
        kilos: numeroDeTexto(l.kilos),
        precio_kg: numeroDeTexto(l.kilos) ? numeroDeTexto(l.precio) : null, // sin cantidad, el precio no significa nada
        importe: numeroDeTexto(l.importe),
      }));
    const comprobante = document.getElementById('compra-comprobante').value.trim();
    const datos = { proveedor_id: id, fecha, items, comprobante };
    const resultado = !fecha
      ? { ok: false, error: 'La fecha no es válida.' }
      : formCompra.editandoId
        ? await window.freska.proveedores.actualizarCompra({ ...datos, id: formCompra.editandoId })
        : await window.freska.proveedores.crearCompra(datos);
    if (!resultado.ok) {
      errorEl.textContent = resultado.error;
      errorEl.style.display = 'block';
      return;
    }
    mostrarToast(formCompra.editandoId ? 'Compra actualizada.' : 'Compra guardada.', 'ok');
    formCompra = null;
    renderProveedorDetalle(id);
  });

  contenedor.querySelector('select.lc-producto')?.focus();
}

// ---------- Formulario de pago ----------

function vincularFormPago(proveedor, cheques) {
  const id = proveedor.id;
  const saldo = saldoParaPago(proveedor);
  const lineasCont = document.querySelector('#form-pago-proveedor .pago-lineas');
  const totalEl = document.getElementById('total-pago');
  const errorEl = document.getElementById('error-pago');
  const lineas = () => Array.from(lineasCont.querySelectorAll('.pago-linea'));
  const esCheque = (linea) => linea.querySelector('.metodo-pago').value === 'Cheque';
  const chequeDe = (linea) => {
    const sel = linea.querySelector('.cheque-elegido');
    return sel && sel.value ? cheques.find((c) => String(c.id) === sel.value) : null;
  };
  // Lo que vale una línea: el importe del cheque elegido, o lo escrito en el monto.
  const valorLinea = (linea) => (esCheque(linea) ? (chequeDe(linea) ? chequeDe(linea).importe : 0) : numeroDeTexto(linea.querySelector('.monto-pago').value) || 0);

  const actualizarTotal = () => {
    const total = redondearPesos(lineas().reduce((acc, l) => acc + valorLinea(l), 0));
    const quedaria = redondearPesos(saldo - total);
    const texto = quedaria > 0 ? `Le quedarías debiendo $${formatearMoneda(quedaria)}` : quedaria < 0 ? `Quedaría un saldo a favor de $${formatearMoneda(-quedaria)}` : 'Le quedarías debiendo $0';
    totalEl.textContent = `Total del pago: $${formatearMoneda(total)} — ${texto}`;
  };

  // Cada cheque se puede usar en una sola línea: los que ya se eligieron en otra no se ofrecen.
  const refrescarOpcionesCheques = () => {
    const elegidos = lineas().map((l) => l.querySelector('.cheque-elegido')?.value).filter(Boolean);
    lineas().forEach((linea) => {
      const sel = linea.querySelector('.cheque-elegido');
      if (!sel) return;
      const propio = sel.value;
      sel.innerHTML =
        '<option value="">Elegí un cheque…</option>' +
        cheques
          .filter((c) => String(c.id) === propio || !elegidos.includes(String(c.id)))
          .map((c) => `<option value="${c.id}" ${String(c.id) === propio ? 'selected' : ''}>${esc(textoChequeOpcion(c))}</option>`)
          .join('');
    });
  };

  // Con exactamente dos líneas, lo que se completa en una llena la otra con lo que falta (si esa no se
  // escribió a mano y no es un cheque), igual que al cobrarle a un cliente.
  const completarOtra = (editada) => {
    const todas = lineas();
    if (todas.length !== 2) return;
    const otra = todas.find((l) => l !== editada);
    if (otra.dataset.manual === '1' || esCheque(otra)) return;
    const falta = Math.max(0, redondearPesos(saldo - valorLinea(editada)));
    otra.querySelector('.monto-pago').value = falta > 0 ? formatearMoneda(falta) : '';
  };

  const actualizarBotonesQuitar = () => {
    lineasCont.querySelectorAll('.quitar-linea-pago').forEach((btn) => {
      btn.style.display = lineas().length > 1 ? '' : 'none';
    });
    ubicarBotonAgregarPago();
  };

  const vincularLinea = (linea) => {
    const monto = linea.querySelector('.monto-pago');
    const metodo = linea.querySelector('.metodo-pago');
    const bloque = linea.querySelector('.pago-cheque');
    vincularFormatoMoneda(monto);
    if (linea.dataset.cargada) linea.dataset.manual = '1';
    monto.addEventListener('input', () => {
      linea.dataset.manual = '1';
      completarOtra(linea);
      actualizarTotal();
    });
    const alCambiarMetodo = () => {
      const cheque = esCheque(linea);
      bloque.hidden = !cheque;
      monto.readOnly = cheque;
      if (cheque) monto.value = chequeDe(linea) ? formatearMoneda(chequeDe(linea).importe) : '';
      else if (linea.dataset.eraCheque === '1') monto.value = '';
      linea.dataset.eraCheque = cheque ? '1' : '';
      actualizarTotal();
    };
    metodo.addEventListener('change', alCambiarMetodo);
    linea.querySelector('.cheque-elegido')?.addEventListener('change', () => {
      monto.value = chequeDe(linea) ? formatearMoneda(chequeDe(linea).importe) : '';
      refrescarOpcionesCheques();
      completarOtra(linea);
      actualizarTotal();
    });
    linea.querySelector('.quitar-linea-pago').addEventListener('click', () => {
      devolverBotonAgregarPago();
      linea.remove();
      refrescarOpcionesCheques();
      actualizarBotonesQuitar();
      actualizarTotal();
    });
  };

  lineas().forEach(vincularLinea);
  lineas().forEach((l) => {
    if (esCheque(l)) l.dataset.eraCheque = '1';
  });
  refrescarOpcionesCheques();
  actualizarBotonesQuitar();
  actualizarTotal();

  document.querySelector('#form-pago-proveedor .btn-agregar-pago').addEventListener('click', () => {
    const usado = lineas().reduce((acc, l) => acc + valorLinea(l), 0);
    const sinAsignar = Math.max(0, redondearPesos(saldo - usado));
    lineasCont.insertAdjacentHTML('beforeend', lineaPagoProveedorHtml(cheques, sinAsignar > 0 ? formatearMoneda(sinAsignar) : ''));
    vincularLinea(lineas()[lineas().length - 1]);
    refrescarOpcionesCheques();
    actualizarBotonesQuitar();
    actualizarTotal();
    lineas()[lineas().length - 1].querySelector('.monto-pago').focus();
  });

  vincularSelectorFecha('pago-fecha', formPago.fecha, (nueva) => {
    const fecha = nueva || fechaHoyISO();
    document.getElementById('pago-fecha').value = formatearFechaCorta(fecha);
    formPago.fecha = fecha;
  });

  document.getElementById('btn-cancelar-pago').addEventListener('click', () => {
    formPago = null;
    renderProveedorDetalle(id);
  });
  document.getElementById('btn-guardar-pago').addEventListener('click', async () => {
    const fecha = fechaCortaAIso(document.getElementById('pago-fecha').value);
    let efectivo = 0;
    let transferencia = 0;
    const transferencias = []; // de qué cuenta salió cada parte
    const chequeIds = [];
    let chequeSinElegir = false;
    lineas().forEach((linea) => {
      const metodo = linea.querySelector('.metodo-pago').value;
      if (metodo === 'Cheque') {
        const c = chequeDe(linea);
        if (c) chequeIds.push(c.id);
        else chequeSinElegir = true;
      } else if (metodo === 'Efectivo') efectivo += valorLinea(linea);
      else {
        transferencia += valorLinea(linea);
        transferencias.push({ cuenta: metodo === TRANSFERENCIA_SIN_CUENTA ? null : metodo, monto: redondearPesos(valorLinea(linea)) });
      }
    });
    const resultado = !fecha
      ? { ok: false, error: 'La fecha no es válida.' }
      : chequeSinElegir
        ? { ok: false, error: 'Elegí el cheque de la cartera (o sacá esa línea).' }
        : await window.freska.proveedores[formPago.editandoId ? 'actualizarPago' : 'pagar']({
            ...(formPago.editandoId ? { id: formPago.editandoId } : {}),
            proveedor_id: id,
            fecha,
            efectivo: redondearPesos(efectivo),
            transferencia: redondearPesos(transferencia),
            transferencias,
            cheque_ids: chequeIds,
          });
    if (!resultado.ok) {
      errorEl.textContent = resultado.error;
      errorEl.style.display = 'block';
      return;
    }
    mostrarToast(formPago.editandoId ? 'Pago actualizado.' : 'Pago guardado.', 'ok');
    formPago = null;
    renderProveedorDetalle(id);
  });
  if (!formPago.editandoId) lineasCont.querySelector('.monto-pago').focus();
}
