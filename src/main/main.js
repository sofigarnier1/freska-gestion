const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const copias = require('../db/copias');
const { enlacePermitido } = require('./enlaces');
const servicio_compartido = require('./servicios/compartido');
const servicio_config = require('./servicios/config');
const servicio_clientes = require('./servicios/clientes');
const servicio_facturas = require('./servicios/facturas');
const servicio_productos = require('./servicios/productos');
const servicio_pedidos = require('./servicios/pedidos');
const servicio_caja = require('./servicios/caja');
const servicio_cheques = require('./servicios/cheques');
const servicio_gastos = require('./servicios/gastos');
const servicio_ingresos = require('./servicios/ingresos');
const servicio_stock = require('./servicios/stock');
const servicio_proveedores = require('./servicios/proveedores');
const servicio_estadisticas = require('./servicios/estadisticas');
const servicio_buscador = require('./servicios/buscador');
const servicio_avisos = require('./servicios/avisos');
const servicio_sistema = require('./servicios/sistema');
const servicio_usuarios = require('./servicios/usuarios');
const servicio_vendedores = require('./servicios/vendedores');

let db;
let mainWindow;
// Quién está usando la app ahora mismo (null = nadie entró todavía). La setean/leen los servicios a través de
// `ctx.usuarioActual`; la usa el envoltorio de `ipcMain` de más abajo para saber qué le puede permitir a cada uno.
let usuarioActual = null;

// Una sola FRESKA abierta a la vez: dos ventanas sobre la misma base pueden bloquearse entre sí o mostrar datos viejos.
// Si se intenta abrir otra, esa se cierra y la que ya estaba abierta pasa al frente.
const esLaUnicaInstancia = app.requestSingleInstanceLock();
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

// Registro de errores (userData/errores.log): sirve para saber qué falló cuando alguien cuenta "no hizo nada".
// Nunca tiene que romper nada, y se recorta si crece de más.
function registrarError(origen, detalle) {
  try {
    const ruta = path.join(app.getPath('userData'), 'errores.log');
    if (fs.existsSync(ruta) && fs.statSync(ruta).size > 500 * 1024) fs.writeFileSync(ruta, '');
    const texto = detalle && detalle.stack ? detalle.stack : String(detalle);
    fs.appendFileSync(ruta, `[${new Date().toISOString()}] ${origen}: ${texto}\n`);
  } catch {
    // sin registro, la app sigue igual
  }
}
process.on('uncaughtException', (err) => registrarError('Error en el programa', err));
process.on('unhandledRejection', (err) => registrarError('Promesa rechazada', err));

// La contraseña se guarda con scrypt y una sal propia y aleatoria: "scrypt$N$r$p$sal$hash". Las bases
// viejas la tenían con SHA-256 y una sal fija (64 caracteres hexadecimales): se siguen aceptando y, en
// cuanto la contraseña se ingresa bien, se vuelve a guardar con el formato nuevo.
const SCRYPT = { N: 16384, r: 8, p: 1, largo: 32 };

function hashPin(pin) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), sal, SCRYPT.largo, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${sal.toString('hex')}$${hash.toString('hex')}`;
}

function hashPinViejo(pin) {
  return crypto.createHash('sha256').update(`freska-pin-${pin}`).digest('hex');
}

// Compara en tiempo constante. Devuelve { ok, actualizar }: `actualizar` = está en el formato viejo.
function verificarPin(pin, guardado) {
  if (!guardado) return { ok: false, actualizar: false };
  if (guardado.startsWith('scrypt$')) {
    const [, N, r, p, sal, hash] = guardado.split('$');
    const esperado = Buffer.from(hash, 'hex');
    const calculado = crypto.scryptSync(String(pin), Buffer.from(sal, 'hex'), esperado.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return { ok: crypto.timingSafeEqual(calculado, esperado), actualizar: false };
  }
  const a = Buffer.from(hashPinViejo(String(pin)), 'hex');
  const b = Buffer.from(guardado, 'hex');
  return { ok: a.length === b.length && crypto.timingSafeEqual(a, b), actualizar: true };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon-freska.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Si la pantalla se cae o se cuelga, la app avisa y se recupera en vez de quedar en blanco. Los datos ya
  // guardados no se pierden; solo lo que estaba a medio escribir en un formulario.
  mainWindow.webContents.on('render-process-gone', (_evento, detalle) => {
    registrarError('La pantalla se cerró', `motivo: ${detalle.reason}`);
    if (detalle.reason === 'clean-exit') return;
    dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      title: 'FRESKA',
      message: 'La pantalla tuvo un problema y se va a volver a abrir.',
      detail: 'Lo que ya estaba guardado está a salvo. Si estabas escribiendo algo sin guardar, hay que volver a cargarlo.',
      buttons: ['Aceptar'],
    });
    mainWindow.reload();
  });
  mainWindow.webContents.on('unresponsive', () => registrarError('La pantalla dejó de responder', ''));
  // Lo que la pantalla escribe como error en su consola también queda en el registro.
  mainWindow.webContents.on('console-message', (evento) => {
    if (evento.level === 'error') registrarError('Error en la pantalla', evento.message);
  });

  // La ventana solo muestra los archivos de la app: nunca abre ventanas nuevas ni navega a otra página.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (evento, url) => {
    if (!url.startsWith('file://')) evento.preventDefault();
  });
}

if (!esLaUnicaInstancia) app.quit();

app.whenReady().then(() => {
  // Si ya hay otra FRESKA abierta, esta no toca la base.
  if (!esLaUnicaInstancia) return;
  // En Windows y Linux la ventana traía la barra de menús de Electron (File, Edit, View, Window), que la app no usa y
  // no se podía sacar. En Mac el menú es el de la barra del sistema (y hace falta para copiar y pegar): ahí no se toca.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  db = require('../db/database');

  // Lo que un empleado NO puede pedir: todo lo que es plata del negocio o configuración (Gastos, Otros ingresos,
  // Caja, Cheques, Proveedores, Estadísticas), más algunas acciones puntuales adentro de pantallas que sí puede
  // usar (editar productos y sus precios, deshacer una anulación, borrar un cliente para siempre, la parte de
  // administración de Usuarios). Es la única barrera del lado del programa: la pantalla ya le oculta todo esto,
  // esta es la de repuesto por si algo se llama igual por error. Sin nadie logueado (`rol` null, como en las bases
  // viejas que todavía no tienen usuarios) no se bloquea nada.
  const PREFIJOS_SOLO_ADMIN = new Set([
    'gastos', 'ingresos', 'cuentas', 'caja', 'cheques', 'proveedores', 'estadisticas', 'inflacion', 'reportes', 'sistema', 'stock', 'insumos', 'vendedores', 'operaciones',
  ]);
  const CANALES_SOLO_ADMIN = new Set([
    'config:guardarDireccionLocal', 'config:guardarZonaLocal',
    'config:guardarRetencionTransferencia',
    'productos:crear', 'productos:actualizar', 'productos:baja',
    'metodosPago:crear', 'metodosPago:actualizar', 'metodosPago:baja',
    'tarjetas:crear', 'tarjetas:quitar',
    'facturas:reactivar', 'pagos:reactivarCobro',
    'clientes:eliminar',
    'usuarios:listar', 'usuarios:crear', 'usuarios:actualizar', 'usuarios:resetearPin',
  ]);
  // Lecturas puntuales de `reportes`/`stock`/`sistema` que en realidad las usan las pantallas de Pedidos,
  // Cobros y Facturas (lista de carga del día, resumen de stock, enviar por WhatsApp, abrir el recorrido de
  // entregas) — no son de Estadísticas, Stock ni Copias de seguridad, así que un empleado las necesita aunque
  // esos prefijos sean solo para el administrador.
  const CANALES_PERMITIDOS_EMPLEADO = new Set([
    'reportes:cantidadesPedidasPorDia',
    'reportes:cobrosPorDia',
    'stock:resumen',
    'sistema:abrirEnlace',
    'sistema:geocodificar',
  ]);
  function permitidoParaRol(canal, rol) {
    if (!rol || rol === 'admin') return true;
    if (CANALES_PERMITIDOS_EMPLEADO.has(canal)) return true;
    if (PREFIJOS_SOLO_ADMIN.has(canal.split(':')[0])) return false;
    return !CANALES_SOLO_ADMIN.has(canal);
  }
  const ipcMainConPermisos = {
    handle: (canal, fn) =>
      ipcMain.handle(canal, (event, ...args) => {
        if (!permitidoParaRol(canal, usuarioActual && usuarioActual.rol)) {
          return { ok: false, error: 'No tenés permiso para hacer esto.' };
        }
        return fn(event, ...args);
      }),
  };

  // Los servicios (ipcMain.handle) están divididos por tema en src/main/servicios/. Todos reciben el mismo `ctx`; el primero
  // (compartido) le suma las funciones que usan varios temas.
  const ctx = {
    app,
    copias,
    db,
    dialog,
    enlacePermitido,
    fs,
    hashPin,
    ipcMain: ipcMainConPermisos,
    path,
    shell,
    verificarPin,
    get mainWindow() {
      return mainWindow;
    },
    get usuarioActual() {
      return usuarioActual;
    },
    set usuarioActual(v) {
      usuarioActual = v;
    },
  };
  const temas = [
    servicio_compartido,
    servicio_usuarios,
    servicio_config,
    servicio_clientes,
    servicio_facturas,
    servicio_productos,
    servicio_pedidos,
    servicio_caja,
    servicio_cheques,
    servicio_gastos,
    servicio_ingresos,
    servicio_stock,
    servicio_proveedores,
    servicio_estadisticas,
    servicio_buscador,
    servicio_avisos,
    servicio_sistema,
    servicio_vendedores,
  ];
  temas.forEach((tema) => tema.registrar(ctx));

  // En Mac el ícono de la ventana no cambia el del Dock (eso sale del bundle al empaquetar); en desarrollo
  // (`npm start`) se pone a mano para que no se vea el ícono genérico de Electron.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(__dirname, '..', 'renderer', 'assets', 'icon-freska-dock.png'));
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
