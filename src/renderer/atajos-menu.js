// Atajos del menú lateral: al pasar el mouse sobre una pantalla del menú que tiene vistas adentro (Negocio: Cobros y Gastos;
// Fondos personales: Ingresos, Gastos de propiedades, Cuentas y Categorías…) sale un desplegable al costado para ir directo a una de ellas.
// Y al pasarlo sobre un grupo cerrado (Ventas, Dinero…) sale la lista de las pantallas de adentro, tomada del propio menú.
// Es solo un atajo: el clic sigue yendo adonde iba, y las pastillas de adentro siguen estando.
// (Los archivos son scripts comunes que comparten el mismo espacio global: se cargan en el orden de index.html.)

// Por pantalla (su `data-view`): las opciones del desplegable. `antes` deja elegida la pastilla de esa pantalla (las variables
// de estado de cada archivo) y `vista` es a qué pantalla se navega. Una pantalla nueva con pastillas se suma acá.
const ATAJOS_MENU = {
  cobros: [
    { texto: 'Cobros', vista: 'cobros' },
    { texto: 'Gastos', vista: 'gastos' },
  ],
  cierre: [
    { texto: 'Cierre del día', vista: 'cierre', antes: () => (vistaCierreTab = 'dia') },
    { texto: 'Día a día', vista: 'cierre', antes: () => (vistaCierreTab = 'mes') },
    { texto: 'Caja general', vista: 'cierre', antes: () => (vistaCierreTab = 'general') },
  ],
  cheques: [
    { texto: 'En cartera', vista: 'cheques', antes: () => (vistaChequesTab = 'en_cartera') },
    { texto: 'Entregados', vista: 'cheques', antes: () => (vistaChequesTab = 'entregado') },
    { texto: 'Todos', vista: 'cheques', antes: () => (vistaChequesTab = 'todos') },
  ],
  ingresos: [
    { texto: 'Ingresos', vista: 'ingresos', antes: () => (vistaIngresosTab = 'ingresos') },
    { texto: 'Gastos', vista: 'ingresos', antes: () => (vistaIngresosTab = 'retiros') },
    { texto: 'Resultado', vista: 'ingresos', antes: () => (vistaIngresosTab = 'resultado') },
    { texto: 'Cuentas', vista: 'ingresos', antes: () => (vistaIngresosTab = 'cuentas') },
    { texto: 'Categorías', vista: 'ingresos', antes: () => (vistaIngresosTab = 'categorias') },
  ],
  pedidos: [
    { texto: 'Pendientes', vista: 'pedidos', antes: () => (pestanaPedidos = 'pendientes') },
    { texto: 'Programados', vista: 'pedidos', antes: () => (pestanaPedidos = 'programados') },
    { texto: 'Facturados', vista: 'pedidos', antes: () => (pestanaPedidos = 'todos') },
  ],
  clientes: [
    { texto: 'Todos', vista: 'clientes', antes: () => (pestanaClientes = 'todos') },
    { texto: 'Dados de baja', vista: 'clientes', antes: () => (pestanaClientes = 'baja') },
  ],
  proveedores: [
    { texto: 'Todos', vista: 'proveedores', antes: () => (pestanaProveedores = 'todos') },
    { texto: 'Dados de baja', vista: 'proveedores', antes: () => (pestanaProveedores = 'baja') },
  ],
  stock: [
    { texto: 'Stock', vista: 'stock', antes: () => (vistaStock = 'stock') },
    { texto: 'Producción', vista: 'stock', antes: () => (vistaStock = 'produccion') },
    { texto: 'Rendimiento', vista: 'stock', antes: () => (vistaStock = 'rendimiento') },
    { texto: 'Insumos', vista: 'stock', antes: () => (vistaStock = 'insumos') },
  ],
  estadisticas: [
    { texto: 'Resumen', vista: 'estadisticas', antes: () => (seccionEstadisticas = 'resumen') },
    { texto: 'Ventas', vista: 'estadisticas', antes: () => (seccionEstadisticas = 'ventas') },
    { texto: 'Compras', vista: 'estadisticas', antes: () => (seccionEstadisticas = 'compras') },
    { texto: 'Plata pendiente', vista: 'estadisticas', antes: () => (seccionEstadisticas = 'pendiente') },
    { texto: 'Inflación', vista: 'estadisticas', antes: () => (seccionEstadisticas = 'inflacion') },
  ],
};

(() => {
  const DEMORA_ABRIR_MS = 250; // para que no salte cada vez que el mouse pasa de largo
  const DEMORA_CERRAR_MS = 220; // da tiempo a cruzar del botón al desplegable
  // Es un <nav>, como el menú lateral y su flyout: las reglas globales de los botones comunes (borde, fondo) no le caen.
  const menu = document.createElement('nav');
  menu.id = 'atajos-menu';
  menu.className = 'atajos-menu';
  menu.setAttribute('aria-label', 'Atajos');
  document.body.appendChild(menu);
  let botonAbierto = null;
  let temporizadorAbrir = null;
  let temporizadorCerrar = null;

  // Para un empleado el menú son ítems sueltos (`.grupo-empleado`) y no tiene Gastos ni las demás vistas: sin atajos.
  const tieneAtajos = (btn) => ATAJOS_MENU[btn.dataset.view] && !btn.closest('.grupo-empleado') && !btn.closest('li[hidden]');

  // Las opciones del desplegable de un botón del menú, o null si no tiene. Una pantalla con vistas adentro usa `ATAJOS_MENU`; un
  // grupo cerrado (ya abierto no hace falta: sus pantallas se ven) lista las pantallas de su sublista, y con la barra achicada
  // no hay nada porque el grupo ya abre su propio menú flotante al tocarlo.
  const opcionesDe = (btn) => {
    if (btn.dataset.view) return tieneAtajos(btn) ? ATAJOS_MENU[btn.dataset.view] : null;
    const grupo = btn.closest('.grupo');
    if (!grupo || grupo.hidden || grupo.classList.contains('abierto') || sidebar.classList.contains('colapsada')) return null;
    const pantallas = [...grupo.querySelectorAll('.sublista li:not([hidden]) button[data-view]')];
    return pantallas.length ? pantallas.map((b) => ({ texto: b.textContent.trim(), vista: b.dataset.view })) : null;
  };

  function cerrar() {
    clearTimeout(temporizadorAbrir);
    clearTimeout(temporizadorCerrar);
    menu.classList.remove('visible');
    menu.innerHTML = '';
    botonAbierto = null;
  }

  function abrir(btn) {
    const opciones = opcionesDe(btn);
    if (!opciones) return;
    // Mismo formato que las subpestañas del menú lateral (`.sublista`): texto liso, resaltado al pasar el mouse.
    menu.innerHTML = `<ul class="sublista">${opciones.map((o, i) => `<li><button type="button" role="menuitem" class="atajo-item" data-idx="${i}">${esc(o.texto)}</button></li>`).join('')}</ul>`;
    const rect = btn.getBoundingClientRect();
    // Pegado al borde derecho del botón (con la barra achicada, al de su ícono) y a su altura, sin salirse de la ventana.
    menu.style.left = `${rect.right + 6}px`;
    menu.style.top = `${rect.top}px`;
    menu.classList.add('visible');
    const alto = menu.getBoundingClientRect().height;
    menu.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - alto - 8))}px`;
    botonAbierto = btn;
    menu.querySelectorAll('.atajo-item').forEach((item) => {
      item.addEventListener('click', () => {
        const opcion = opciones[Number(item.dataset.idx)];
        cerrar();
        if (flyout.classList.contains('visible')) cerrarFlyout();
        if (opcion.antes) opcion.antes();
        irAVista(botonDeVista(opcion.vista));
      });
    });
  }

  const programarCierre = () => {
    clearTimeout(temporizadorAbrir);
    clearTimeout(temporizadorCerrar);
    temporizadorCerrar = setTimeout(cerrar, DEMORA_CERRAR_MS);
  };

  new Set([...navButtons, ...grupoButtons]).forEach((btn) => {
    btn.addEventListener('mouseenter', () => {
      clearTimeout(temporizadorCerrar);
      clearTimeout(temporizadorAbrir);
      if (!opcionesDe(btn)) {
        if (botonAbierto) programarCierre();
        return;
      }
      if (botonAbierto === btn) return;
      temporizadorAbrir = setTimeout(() => abrir(btn), botonAbierto ? 0 : DEMORA_ABRIR_MS);
    });
    btn.addEventListener('mouseleave', programarCierre);
    btn.addEventListener('click', cerrar);
  });
  menu.addEventListener('mouseenter', () => clearTimeout(temporizadorCerrar));
  menu.addEventListener('mouseleave', programarCierre);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrar();
  });
  window.addEventListener('resize', cerrar);
})();
