// Usuarios: quién entra a FRESKA. Un superadministrador ve todo; un empleado, solo Pedidos, Facturas, Cobros y
// Clientes (el resto lo filtra centralizado el envoltorio de `ipcMain` en main.js).
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

function registrar(ctx) {
  const { db, hashPin, ipcMain, verificarPin } = ctx;

  // Solo el nombre e id: es lo que ve la pantalla de "¿Quién sos?" antes de entrar, así que no lleva ni el rol.
  ipcMain.handle('usuarios:paraElegir', () => {
    return db.prepare('SELECT id, nombre FROM usuarios WHERE activo = 1 ORDER BY nombre COLLATE NOCASE').all();
  });

  // Solo funciona si todavía no hay nadie cargado (primera vez que se abre la app): crea al primer
  // administrador y lo deja adentro. Es lo mismo que antes era "Crear contraseña de acceso".
  ipcMain.handle('usuarios:crearPrimero', (_event, { nombre, pin }) => {
    if (db.prepare('SELECT 1 FROM usuarios LIMIT 1').get()) return { ok: false, error: 'Ya hay usuarios creados.' };
    const n = String(nombre || '').trim().slice(0, 40) || 'Administrador';
    if (typeof pin !== 'string' || pin.length < 4) {
      return { ok: false, error: 'La contraseña debe tener al menos 4 caracteres.' };
    }
    const info = db.prepare("INSERT INTO usuarios (nombre, pin_hash, rol) VALUES (?, ?, 'admin')").run(n, hashPin(pin));
    const usuario = { id: Number(info.lastInsertRowid), nombre: n, rol: 'admin' };
    ctx.usuarioActual = usuario;
    return { ok: true, usuario };
  });

  const segundosDeBloqueo = (u) => {
    const resta = Number(u.bloqueado_hasta || 0) - Date.now();
    return resta > 0 ? Math.ceil(resta / 1000) : 0;
  };
  const registrarErrorDeIngreso = (id) => {
    const u = db.prepare('SELECT fallos FROM usuarios WHERE id = ?').get(id);
    const fallos = (u ? u.fallos : 0) + 1;
    const bloqueado_hasta = fallos >= 5 ? Date.now() + Math.min(30 * 2 ** (fallos - 5), 900) * 1000 : 0;
    db.prepare('UPDATE usuarios SET fallos = ?, bloqueado_hasta = ? WHERE id = ?').run(fallos, bloqueado_hasta, id);
  };
  const limpiarErroresDeIngreso = (id) => db.prepare('UPDATE usuarios SET fallos = 0, bloqueado_hasta = 0 WHERE id = ?').run(id);

  // Entrar como una persona ya cargada. El bloqueo por intentos fallidos es por persona (antes era uno solo
  // para toda la app).
  ipcMain.handle('usuarios:ingresar', (_event, { usuario_id, pin }) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ? AND activo = 1').get(Number(usuario_id));
    if (!u) return { ok: false, error: 'Ese usuario ya no existe.' };
    const espera = segundosDeBloqueo(u);
    if (espera > 0) return { ok: false, bloqueadoSegundos: espera };
    const { ok, actualizar } = verificarPin(pin, u.pin_hash);
    if (!ok) {
      registrarErrorDeIngreso(u.id);
      const u2 = db.prepare('SELECT bloqueado_hasta FROM usuarios WHERE id = ?').get(u.id);
      return { ok: false, bloqueadoSegundos: segundosDeBloqueo(u2) };
    }
    limpiarErroresDeIngreso(u.id);
    if (actualizar) db.prepare('UPDATE usuarios SET pin_hash = ? WHERE id = ?').run(hashPin(pin), u.id);
    const usuario = { id: u.id, nombre: u.nombre, rol: u.rol };
    ctx.usuarioActual = usuario;
    return { ok: true, usuario };
  });

  ipcMain.handle('usuarios:cerrarSesion', () => {
    ctx.usuarioActual = null;
    return { ok: true };
  });

  // Quién quedó adentro (para que la pantalla, al recargar, sepa si mostrar el candado o no hace falta).
  ipcMain.handle('usuarios:sesionActual', () => ctx.usuarioActual || null);

  // ---------- Administrar usuarios (solo un administrador) ----------
  const esAdmin = () => Boolean(ctx.usuarioActual && ctx.usuarioActual.rol === 'admin');

  ipcMain.handle('usuarios:listar', () => {
    if (!esAdmin()) return [];
    return db.prepare("SELECT id, nombre, rol, activo FROM usuarios ORDER BY (rol = 'admin') DESC, nombre COLLATE NOCASE").all();
  });

  ipcMain.handle('usuarios:crear', (_event, { nombre, pin, rol }) => {
    if (!esAdmin()) return { ok: false, error: 'No tenés permiso para hacer esto.' };
    const n = String(nombre || '').trim().slice(0, 40);
    if (!n) return { ok: false, error: 'Poné un nombre.' };
    if (typeof pin !== 'string' || pin.length < 4) return { ok: false, error: 'La contraseña debe tener al menos 4 caracteres.' };
    if (!['admin', 'empleado'].includes(rol)) return { ok: false, error: 'Elegí si es administrador o empleado.' };
    try {
      const info = db.prepare('INSERT INTO usuarios (nombre, pin_hash, rol) VALUES (?, ?, ?)').run(n, hashPin(pin), rol);
      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch (e) {
      return { ok: false, error: 'Ya hay un usuario con ese nombre.' };
    }
  });

  ipcMain.handle('usuarios:actualizar', (_event, { id, nombre, rol, activo }) => {
    if (!esAdmin()) return { ok: false, error: 'No tenés permiso para hacer esto.' };
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(id));
    if (!u) return { ok: false, error: 'Ese usuario ya no existe.' };
    const n = String(nombre === undefined ? u.nombre : nombre).trim().slice(0, 40);
    if (!n) return { ok: false, error: 'Poné un nombre.' };
    const nuevoRol = ['admin', 'empleado'].includes(rol) ? rol : u.rol;
    const nuevoActivo = activo === undefined ? u.activo : activo ? 1 : 0;
    // Nunca puede quedar la app sin ningún administrador activo (nadie podría volver a entrar como admin).
    const quedariaSinAdmin =
      u.rol === 'admin' &&
      (nuevoRol !== 'admin' || !nuevoActivo) &&
      db.prepare("SELECT COUNT(*) n FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id != ?").get(u.id).n === 0;
    if (quedariaSinAdmin) return { ok: false, error: 'Tiene que quedar al menos un administrador activo.' };
    try {
      db.prepare('UPDATE usuarios SET nombre = ?, rol = ?, activo = ? WHERE id = ?').run(n, nuevoRol, nuevoActivo, u.id);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Ya hay un usuario con ese nombre.' };
    }
  });

  // El administrador le resetea la contraseña a otro usuario (por ejemplo, si se la olvidó) sin necesitar la vieja.
  ipcMain.handle('usuarios:resetearPin', (_event, { id, pin }) => {
    if (!esAdmin()) return { ok: false, error: 'No tenés permiso para hacer esto.' };
    if (typeof pin !== 'string' || pin.length < 4) return { ok: false, error: 'La contraseña debe tener al menos 4 caracteres.' };
    const info = db.prepare('UPDATE usuarios SET pin_hash = ?, fallos = 0, bloqueado_hasta = 0 WHERE id = ?').run(hashPin(pin), Number(id));
    if (info.changes === 0) return { ok: false, error: 'Ese usuario ya no existe.' };
    return { ok: true };
  });

  // Cada uno cambia la suya propia (necesita la actual).
  ipcMain.handle('usuarios:cambiarPin', (_event, { actual, nuevo }) => {
    if (!ctx.usuarioActual) return { ok: false, error: 'No hay una sesión activa.' };
    if (typeof nuevo !== 'string' || nuevo.length < 4) {
      return { ok: false, error: 'La contraseña nueva debe tener al menos 4 caracteres.' };
    }
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(ctx.usuarioActual.id);
    if (!u) return { ok: false, error: 'Ese usuario ya no existe.' };
    const espera = segundosDeBloqueo(u);
    if (espera > 0) return { ok: false, error: `Demasiados intentos. Esperá ${espera} segundos.` };
    const { ok } = verificarPin(actual, u.pin_hash);
    if (!ok) {
      registrarErrorDeIngreso(u.id);
      return { ok: false, error: 'La contraseña actual no es correcta.' };
    }
    limpiarErroresDeIngreso(u.id);
    db.prepare('UPDATE usuarios SET pin_hash = ? WHERE id = ?').run(hashPin(nuevo), u.id);
    return { ok: true };
  });
}

module.exports = { registrar };
