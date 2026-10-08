// Buscador general (la lupa de la barra de arriba, o Cmd/Ctrl + K). Se carga después de los archivos de pantallas (utilidades.js … inicio.js, ver index.html) y usa sus
// funciones. Busca en clientes, proveedores, productos, insumos, facturas, cheques, gastos y pedidos a la vez, y también
// ofrece "ir a" cada pantalla. Si lo escrito es un número, además busca por importe.

const ICONO_LUPA =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

// Adónde se puede ir directo. `palabras` = otras formas de nombrarlo.
const DESTINOS_BUSCADOR = [
  { nombre: 'Pedidos', vista: 'pedidos', palabras: 'pedido whatsapp' },
  { nombre: 'Facturas', vista: 'facturas', palabras: 'factura ventas' },
  { nombre: 'Cobros', vista: 'cobros', cobrosTab: 'pendientes', palabras: 'cobro pagos pendientes deudas' },
  { nombre: 'Historial de cobros', vista: 'cobros', cobrosTab: 'historial', palabras: 'cobros historial por dia por mes' },
  { nombre: 'Cheques', vista: 'cheques', cheques: true, palabras: 'cheque cartera' },
  { nombre: 'Fondos personales', vista: 'ingresos', palabras: 'ingreso otros ingresos alquileres personal fondos personales retiros gastos de propiedades cuentas' },
  { nombre: 'Gastos', vista: 'gastos', gastosTab: 'gastos', palabras: 'gasto retiros' },
  { nombre: 'Categorías de gasto', vista: 'gastos', gastosTab: 'categorias', palabras: 'categoria categorias negocio personal descripciones' },
  { nombre: 'Cierre del día', vista: 'cierre', cierreTab: 'dia', palabras: 'caja cierre efectivo contado fondo' },
  { nombre: 'Día a día (caja)', vista: 'cierre', cierreTab: 'mes', palabras: 'caja dia a dia mes cierres' },
  { nombre: 'Caja general', vista: 'cierre', cierreTab: 'general', palabras: 'caja general cuentas saldos dinero disponible dolares operaciones' },
  { nombre: 'Clientes', vista: 'clientes', palabras: 'cliente' },
  { nombre: 'Proveedores', vista: 'proveedores', palabras: 'proveedor compras' },
  { nombre: 'Vendedores', vista: 'vendedores', palabras: 'vendedor comision comisiones informe mensual' },
  { nombre: 'Productos', vista: 'productos', palabras: 'producto precios' },
  { nombre: 'Stock', vista: 'stock', stockTab: 'stock', palabras: 'stock existencias articulos kilos hay disponible' },
  { nombre: 'Producción', vista: 'stock', stockTab: 'produccion', palabras: 'produccion producir cargar elaborado' },
  { nombre: 'Rendimiento', vista: 'stock', stockTab: 'rendimiento', palabras: 'rendimiento rinde comprado producido vendido porcentaje carne' },
  { nombre: 'Insumos', vista: 'stock', stockTab: 'insumos', palabras: 'insumos bolsas bandejas film ingredientes conteo contar' },
  { nombre: 'Estadísticas', vista: 'estadisticas', palabras: 'estadistica entradas salidas resultado' },
  { nombre: 'Manual de uso', manual: true, palabras: 'ayuda manual instrucciones' },
];

let buscadorTemporizador = null;
let buscadorSecuencia = 0;

function buscadorAbierto() {
  return Boolean(document.querySelector('.buscador-card'));
}

function cerrarBuscadorGeneral() {
  if (buscadorAbierto()) cerrarModal();
}

function abrirBuscadorGeneral() {
  // No se abre con la app bloqueada ni encima de otro cuadro (le taparía lo que está haciendo).
  if (pantallaPin.classList.contains('visible') || modalOverlay.classList.contains('visible')) return;
  cerrarPanelAvisos();
  menuUsuarioLista.classList.remove('visible');
  mostrarModal(`
    <div class="buscador-card">
      <div class="buscador-campo">
        <span class="buscador-lupa">${ICONO_LUPA}</span>
        <input type="text" id="buscador-input" placeholder="Buscar clientes, facturas, productos, cheques…" autocomplete="off" aria-label="Buscar" />
        <kbd>Esc</kbd>
      </div>
      <div id="buscador-resultados" class="buscador-resultados" role="listbox"></div>
      <p class="buscador-pie">↑ ↓ para moverte · Enter para abrir · Esc para cerrar</p>
    </div>
  `);
  const tarjeta = document.querySelector('.modal-card');
  tarjeta.classList.add('buscador-modal');
  const input = document.getElementById('buscador-input');
  const resultados = document.getElementById('buscador-resultados');
  let activo = -1;

  const items = () => Array.from(resultados.querySelectorAll('.buscador-item'));
  const marcar = (indice) => {
    const lista = items();
    if (!lista.length) {
      activo = -1;
      return;
    }
    activo = (indice + lista.length) % lista.length;
    lista.forEach((el, i) => el.classList.toggle('activo', i === activo));
    lista[activo].scrollIntoView({ block: 'nearest' });
  };

  const pintar = (consulta, grupos) => {
    resultados.innerHTML = htmlResultadosBuscador(consulta, grupos);
    items().forEach((el) => {
      el.addEventListener('click', () => elegirResultadoBuscador(el.dataset));
      el.addEventListener('mousemove', () => {
        const i = items().indexOf(el);
        if (i !== activo) marcar(i);
      });
    });
    marcar(0);
  };

  const buscar = async () => {
    const consulta = input.value.trim();
    const secuencia = ++buscadorSecuencia;
    const respuesta = consulta.length >= 2 ? await window.freska.buscar.todo(consulta) : { ok: true, grupos: {} };
    if (secuencia !== buscadorSecuencia || !buscadorAbierto()) return; // llegó una respuesta vieja
    pintar(consulta, respuesta.grupos || {});
  };

  input.addEventListener('input', () => {
    clearTimeout(buscadorTemporizador);
    buscadorTemporizador = setTimeout(buscar, 120);
  });
  // Las flechas y Enter son del buscador: no deben mover el foco por la pantalla de atrás.
  tarjeta.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      marcar(activo + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const lista = items();
      if (lista[activo]) lista[activo].click();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.stopPropagation();
    }
  });
  input.focus();
  buscar();
}

// ---------- Resultados ----------

const NOMBRES_GRUPOS_BUSCADOR = {
  clientes: 'Clientes',
  proveedores: 'Proveedores',
  productos: 'Productos',
  facturas: 'Facturas',
  cheques: 'Cheques',
  gastos: 'Gastos',
  pedidos: 'Pedidos pendientes',
  cobros: 'Cobros de ese importe',
  ingresos: 'Fondos personales',
  operaciones: 'Operaciones de caja',
  insumos: 'Insumos',
};

// Con un número, lo más probable es que se busque un importe: los cobros, facturas, cheques y gastos van primero.
const ORDEN_TEXTO = ['clientes', 'proveedores', 'productos', 'insumos', 'facturas', 'cheques', 'gastos', 'ingresos', 'operaciones', 'pedidos', 'cobros'];
const ORDEN_NUMERO = ['cobros', 'facturas', 'cheques', 'gastos', 'ingresos', 'operaciones', 'clientes', 'proveedores', 'productos', 'insumos', 'pedidos'];

function filaBuscadorHtml(datos, titulo, detalle, monto) {
  const atributos = Object.entries(datos)
    .map(([k, v]) => `data-${k}="${esc(v)}"`)
    .join(' ');
  return `<button type="button" class="buscador-item" role="option" ${atributos}>
    <span class="buscador-item-texto"><span class="buscador-item-titulo">${titulo}</span>${detalle ? `<span class="buscador-item-detalle">${detalle}</span>` : ''}</span>
    ${monto ? `<span class="buscador-item-monto">${monto}</span>` : ''}
  </button>`;
}

function itemsGrupoBuscador(tipo, items) {
  const pesos = (n) => `$${formatearMoneda(n)}`;
  return items
    .map((x) => {
      if (tipo === 'clientes') {
        const detalle = [!x.activo ? 'Dado de baja' : '', x.saldo > 0 ? `Debe ${pesos(x.saldo)}` : ''].filter(Boolean).join(' · ');
        return filaBuscadorHtml({ tipo, id: x.id }, esc(x.nombre), esc(detalle));
      }
      if (tipo === 'proveedores') {
        const detalle = [!x.activo ? 'Dado de baja' : '', x.saldo > 0 ? `Le debés ${pesos(x.saldo)}` : x.saldo < 0 ? `A favor ${pesos(-x.saldo)}` : ''].filter(Boolean).join(' · ');
        return filaBuscadorHtml({ tipo, id: x.id }, esc(x.nombre), esc(detalle));
      }
      if (tipo === 'productos') {
        const detalle = [x.codigo ? `Cód. ${x.codigo}` : '', !x.activo ? 'Dado de baja' : ''].filter(Boolean).join(' · ');
        return filaBuscadorHtml({ tipo, nombre: x.nombre }, esc(x.nombre), esc(detalle), `${pesos(x.precio)}${x.unidad === 'kg' ? ' /kg' : ''}`);
      }
      if (tipo === 'insumos') {
        return filaBuscadorHtml({ tipo }, esc(x.nombre), esc(x.ultimo ? `Último conteo: ${formatearCantidad(x.ultimo.cantidad)} ${x.unidad} (${fechaLargaCierre(x.ultimo.fecha)})` : `Sin contar · ${x.unidad}`));
      }
      if (tipo === 'facturas') {
        const estado = x.estado === 'anulada' ? 'Anulada' : x.pendiente > 0 ? `Debe ${pesos(x.pendiente)}` : 'Pagada';
        return filaBuscadorHtml({ tipo, id: x.id }, `Factura N° ${x.id} — ${esc(x.cliente)}`, esc(`${fechaLargaCierre(x.fecha)} · ${estado}`), pesos(x.total));
      }
      if (tipo === 'cheques') {
        const estado = x.estado === 'en_cartera' ? 'En cartera' : `Entregado a ${x.entregado_a || '—'}`;
        const cobra = x.fecha_cobro ? ` · cobra ${fechaLargaCierre(x.fecha_cobro)}` : '';
        return filaBuscadorHtml({ tipo, banco: x.banco, numero: x.numero }, `${esc(x.banco)} N° ${esc(x.numero)}`, esc(`${estado}${cobra}${x.librador ? ` · de ${x.librador}` : ''}`), pesos(x.importe));
      }
      if (tipo === 'gastos') {
        return filaBuscadorHtml({ tipo, descripcion: x.descripcion }, esc(x.descripcion), esc(`${x.categoria} · ${fechaLargaCierre(x.fecha)} · ${x.medio_pago}`), pesos(x.monto));
      }
      if (tipo === 'ingresos') {
        return filaBuscadorHtml({ tipo, descripcion: x.descripcion }, esc(x.descripcion), esc(`${fechaLargaCierre(x.fecha)} · ${x.cuenta || 'Fondos personales'}${x.observacion ? ` · ${x.observacion}` : ''}`), pesos(x.monto));
      }
      if (tipo === 'operaciones') {
        return filaBuscadorHtml({ tipo }, esc(x.detalle), esc(fechaLargaCierre(x.fecha)), pesos(x.monto));
      }
      if (tipo === 'pedidos') {
        return filaBuscadorHtml({ tipo }, `Pedido de ${esc(x.cliente)}`, esc(fechaLargaCierre(x.fecha)));
      }
      // cobros
      return filaBuscadorHtml({ tipo, factura: x.factura_id ?? '', cliente: x.cliente_id }, `Cobro de ${esc(x.cliente)}`, esc(`${x.factura_id == null ? 'Saldo anterior' : `Factura N° ${x.factura_id}`} · ${x.metodo} · ${fechaLargaCierre(x.fecha)}`), pesos(x.monto));
    })
    .join('');
}

// Vistas a las que puede "ir" un empleado desde el buscador: las mismas 4 que le quedan sueltas en el
// sidebar (`aplicarPermisosUI` en sistema.js). "Manual de uso" no tiene `vista` (usa `manual: true`) y
// queda afuera de este filtro: no es información del negocio, así que no hay motivo para ocultarlo.
const VISTAS_BUSCADOR_EMPLEADO = new Set(['pedidos', 'facturas', 'cobros', 'clientes']);

function htmlResultadosBuscador(consulta, grupos) {
  const tokens = normalizarTexto(consulta).split(/\s+/).filter(Boolean);
  const esEmpleado = sesionActual && sesionActual.rol === 'empleado';
  const destinos = DESTINOS_BUSCADOR.filter(
    (d) =>
      (!esEmpleado || !d.vista || VISTAS_BUSCADOR_EMPLEADO.has(d.vista)) &&
      (!tokens.length || tokens.every((t) => normalizarTexto(`${d.nombre} ${d.palabras}`).includes(t)))
  );
  const bloqueIr = destinos.length
    ? `<div class="buscador-grupo"><h4>Ir a</h4>${destinos
        .map((d) => filaBuscadorHtml({ tipo: 'ir', vista: d.vista || '', cheques: d.cheques ? '1' : '', manual: d.manual ? '1' : '', cobrostab: d.cobrosTab || '', gastostab: d.gastosTab || '', cierretab: d.cierreTab || '', stocktab: d.stockTab || '' }, esc(d.nombre), ''))
        .join('')}</div>`
    : '';
  // Con un número, lo más probable es que se busque un importe: cobros, facturas, cheques y gastos primero.
  const orden = /^\d[\d.,]*$/.test(consulta) ? ORDEN_NUMERO : ORDEN_TEXTO;
  let bloquesDatos = '';
  orden.forEach((tipo) => {
    const g = grupos[tipo];
    if (!g || !g.total) return;
    bloquesDatos += `<div class="buscador-grupo"><h4>${NOMBRES_GRUPOS_BUSCADOR[tipo]}</h4>${itemsGrupoBuscador(tipo, g.items)}${
      g.total > g.items.length ? `<p class="buscador-mas">y ${g.total - g.items.length} más: escribí un poco más para afinar</p>` : ''
    }</div>`;
  });
  if (!tokens.length) return `<p class="buscador-vacio">Escribí para buscar, o elegí adónde ir.</p>${bloqueIr}`;
  // Lo que se busca va primero y los "Ir a" al final.
  return bloquesDatos || bloqueIr ? bloquesDatos + bloqueIr : `<p class="buscador-vacio">No encontré nada con «${esc(consulta)}».</p>`;
}

// ---------- Ir al resultado ----------

async function elegirResultadoBuscador(d) {
  const consulta = (document.getElementById('buscador-input')?.value || '').trim();
  cerrarBuscadorGeneral();
  const botonVista = (vista) => botonDeVista(vista);
  const tipo = d.tipo;
  if (tipo === 'ir') {
    if (d.manual) return document.getElementById('btn-manual').click();
    if (d.cheques) {
      vistaChequesTab = 'en_cartera';
      busquedaCheques = '';
    } else if (d.cobrostab) vistaCobrosTab = d.cobrostab;
    if (d.stocktab) vistaStock = d.stocktab;
    if (d.gastostab) vistaGastosTab = d.gastostab;
    if (d.cierretab) vistaCierreTab = d.cierretab;
    return irAVista(botonVista(d.vista));
  }
  if (tipo === 'clientes') {
    await irAVista(botonVista('clientes'));
    mostrarDatosFichaCliente = false;
    limiteHistorialFicha = MOVIMIENTOS_POR_PAGINA;
    origenFichaCliente = 'clientes';
    return renderClienteDetalle(Number(d.id));
  }
  if (tipo === 'proveedores') {
    await irAVista(botonVista('proveedores'));
    mostrarDatosProveedor = false;
    limiteHistorialProveedor = 30;
    return renderProveedorDetalle(Number(d.id));
  }
  if (tipo === 'productos') {
    await irAVista(botonVista('productos'));
    const campo = document.getElementById('buscar-producto');
    if (campo) {
      campo.value = d.nombre;
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return;
  }
  if (tipo === 'insumos') {
    vistaStock = 'insumos';
    return irAVista(botonVista('stock'));
  }
  if (tipo === 'cobros' && !d.factura) {
    // Un cobro del saldo anterior no tiene factura: se abre la ficha del cliente.
    await irAVista(botonVista('clientes'));
    mostrarDatosFichaCliente = false;
    limiteHistorialFicha = MOVIMIENTOS_POR_PAGINA;
    origenFichaCliente = 'clientes';
    return renderClienteDetalle(Number(d.cliente));
  }
  if (tipo === 'facturas' || tipo === 'cobros') {
    busquedaFacturasTab = String(tipo === 'facturas' ? d.id : d.factura);
    return irAVista(botonVista('facturas'));
  }
  if (tipo === 'cheques') {
    vistaChequesTab = 'todos';
    busquedaCheques = `${d.banco} ${d.numero}`;
    limiteCheques = CHEQUES_POR_PAGINA;
    return irAVista(botonVista('cheques'));
  }
  if (tipo === 'gastos') {
    vistaGastosTab = 'gastos';
    busquedaGastos = d.descripcion;
    limiteGastos = GASTOS_POR_PAGINA;
    // Sin límite de fechas, para que el gasto aparezca aunque sea de otro mes.
    rangoGastosIniciado = true;
    filtroGastosDesde = '';
    filtroGastosHasta = '';
    return irAVista(botonVista('gastos'));
  }
  if (tipo === 'ingresos') {
    busquedaIngresos = d.descripcion;
    filtroOrigenIngresos = 'todos';
    filtroCuentaIngresos = 'todos';
    // Sin límite de fechas, para que aparezca aunque sea de otro mes.
    rangoIngresosIniciado = true;
    filtroIngresosDesde = '';
    filtroIngresosHasta = '';
    return irAVista(botonVista('ingresos'));
  }
  if (tipo === 'operaciones') {
    vistaCierreTab = 'general';
    return irAVista(botonVista('cierre'));
  }
  if (tipo === 'pedidos') {
    pestanaPedidos = 'pendientes';
    return irAVista(botonVista('pedidos'));
  }
  return consulta;
}

// ---------- Botón de la barra y atajo ----------

document.getElementById('btn-buscador')?.addEventListener('click', () => (buscadorAbierto() ? cerrarBuscadorGeneral() : abrirBuscadorGeneral()));

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key?.toLowerCase() === 'k') {
    e.preventDefault();
    if (buscadorAbierto()) cerrarBuscadorGeneral();
    else abrirBuscadorGeneral();
  }
});
