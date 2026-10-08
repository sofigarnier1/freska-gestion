// Base de las pruebas: carga la lógica REAL de la app (src/main/main.js) sobre una base temporal, con un Electron de
// mentira que solo junta los "servicios" (ipcMain.handle). Así los tests llaman a los mismos servicios que usa la
// pantalla, con la misma base SQLite, sin abrir ninguna ventana y sin tocar la base real (todo va a una carpeta
// temporal que se borra al terminar). Se corre con Electron como si fuera Node (ver tests/correr.js), porque
// better-sqlite3 está compilado para Electron.
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'freska-test-'));
const manejadores = new Map();

class VentanaFalsa {
  constructor() {
    this.webContents = { on() {}, setWindowOpenHandler() {} };
  }
  loadFile() {}
  isMinimized() {
    return false;
  }
  focus() {}
  restore() {}
  static getAllWindows() {
    return [];
  }
}

const electronFalso = {
  app: {
    getPath: () => carpeta,
    whenReady: () => Promise.resolve(),
    on() {},
    quit() {},
    relaunch() {},
    exit() {},
    requestSingleInstanceLock: () => true,
    dock: null,
  },
  BrowserWindow: VentanaFalsa,
  Menu: { setApplicationMenu() {} },
  ipcMain: { handle: (canal, fn) => manejadores.set(canal, fn) },
  shell: {},
  dialog: {},
};

const cargarOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  if (pedido === 'electron') return electronFalso;
  return cargarOriginal.call(this, pedido, ...resto);
};

process.on('exit', () => {
  try {
    fs.rmSync(carpeta, { recursive: true, force: true });
  } catch {
    // no pasa nada si queda basura en la carpeta temporal
  }
});

let listo = null;

// Arranca la app de mentira (una sola vez por archivo de tests) y devuelve las herramientas para probar.
async function iniciar() {
  if (listo) return listo;
  listo = (async () => {
    require('../src/main/main.js');
    await new Promise((resolver) => setImmediate(resolver)); // deja correr el whenReady().then(...)
    const db = require('../src/db/database');
    const invocar = async (canal, ...args) => {
      const servicio = manejadores.get(canal);
      if (!servicio) throw new Error(`No existe el servicio ${canal}`);
      return servicio({}, ...args);
    };
    return { db, invocar, carpeta, servicios: manejadores };
  })();
  return listo;
}

// Vacía todo lo que cargan los usuarios (clientes, facturas, cobros, stock...) y deja la configuración y los
// métodos de pago como están, para que cada test arranque de cero.
function limpiarDatos(db) {
  const tablas = [
    'pagos', 'notas_credito', 'cobros_anulados', 'factura_bultos', 'factura_items', 'facturas', 'pedido_items', 'pedidos',
    'cheques', 'gastos', 'cuotas_gasto', 'ingresos', 'retiros_personales', 'pases_personales', 'fondos_ajustes', 'compras_dolares_personales', 'operaciones_caja', 'cuentas_ajustes', 'cuentas_saldos',
    'pagos_proveedor_cuentas', 'pagos_proveedor', 'devoluciones_proveedor', 'compra_items', 'compras', 'movimientos_stock', 'conteos_insumo', 'insumos',
    'clientes', 'productos', 'articulo_carnes', 'articulos_stock', 'usuarios',
  ];
  db.pragma('foreign_keys = OFF');
  tablas.forEach((t) => {
    try {
      db.prepare(`DELETE FROM ${t}`).run();
    } catch {
      // una tabla que no exista en esta versión no debería frenar la limpieza
    }
  });
  db.prepare("DELETE FROM configuracion WHERE clave IN ('retencion_transferencia', 'caja_desde', 'caja_dolares_usd', 'caja_cotizacion', 'fondos_dolares_usd')").run();
  db.pragma('foreign_keys = ON');
}

const crearCliente = (db, nombre) => Number(db.prepare('INSERT INTO clientes (nombre) VALUES (?)').run(nombre).lastInsertRowid);
const crearProducto = (db, { nombre, precio = 1000, precioCf = null, unidad = 'kg', codigo = null } = {}) =>
  Number(
    db
      .prepare('INSERT INTO productos (nombre, codigo, precio_cliente, precio_cf, unidad) VALUES (?, ?, ?, ?, ?)')
      .run(nombre, codigo || `C${Math.random().toString(36).slice(2, 8)}`, precio, precioCf === null ? precio : precioCf, unidad).lastInsertRowid
  );
const asegurarMetodo = (db, nombre) => db.prepare('INSERT OR IGNORE INTO metodos_pago (nombre) VALUES (?)').run(nombre);

// Generador de números al azar con semilla: la misma semilla da siempre la misma secuencia (para poder repetir un fallo).
function azar(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { iniciar, limpiarDatos, crearCliente, crearProducto, asegurarMetodo, azar };
