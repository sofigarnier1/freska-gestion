// Contraseña de acceso, tema, dirección del local y retención por transferencia.
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

// La contraseña única de toda la app (`config:crearPin`/`validarPin`/`cambiarPin`/`tienePin`) se reemplazó por
// usuarios propios, uno por persona: ver `servicios/usuarios.js`. La primera contraseña que hubiera queda migrada
// (ver `database.js`) como la del primer usuario, "Administrador"; este archivo ya no toca nada de eso.
function registrar(ctx) {
  const { db, ipcMain } = ctx;

  // El modo (claro/oscuro) que eligió el usuario. Se guarda en la base y no solo en el navegador de la
  // ventana, porque ahí puede perderse al cerrar la app.
  ipcMain.handle('config:obtenerTema', () => {
    const fila = db.prepare("SELECT valor FROM configuracion WHERE clave = 'tema'").get();
    return fila && (fila.valor === 'light' || fila.valor === 'dark') ? fila.valor : null;
  });

  ipcMain.handle('config:guardarTema', (_event, tema) => {
    if (tema !== 'light' && tema !== 'dark') return false;
    db.prepare(
      "INSERT INTO configuracion (clave, valor) VALUES ('tema', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor"
    ).run(tema);
    return true;
  });

  ipcMain.handle('config:obtenerDireccionLocal', () => {
    const row = db.prepare("SELECT valor FROM configuracion WHERE clave = 'direccion_local'").get();
    return row ? row.valor : '';
  });

  // Ciudad y provincia del local: se suman a las direcciones al buscarlas en el mapa (sin eso, "Díaz Vélez 244" puede
  // dar otra ciudad o nada).
  ipcMain.handle('config:obtenerZonaLocal', () => {
    const row = db.prepare("SELECT valor FROM configuracion WHERE clave = 'zona_local'").get();
    try {
      const z = row ? JSON.parse(row.valor) : {};
      return { ciudad: String(z.ciudad || ''), provincia: String(z.provincia || '') };
    } catch (e) {
      return { ciudad: '', provincia: '' };
    }
  });

  ipcMain.handle('config:guardarZonaLocal', (_event, { ciudad, provincia } = {}) => {
    const valor = JSON.stringify({ ciudad: String(ciudad || '').trim(), provincia: String(provincia || '').trim() });
    db.prepare(
      "INSERT INTO configuracion (clave, valor) VALUES ('zona_local', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor"
    ).run(valor);
    return true;
  });

  ipcMain.handle('config:guardarDireccionLocal', (_event, direccion) => {
    db.prepare(
      "INSERT INTO configuracion (clave, valor) VALUES ('direccion_local', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor"
    ).run(direccion);
    return true;
  });

  // % que bancos y apps descuentan solos de cada cobro por transferencia (retención de Ingresos Brutos u
  // otra), antes de que la plata llegue a la cuenta. Es una sola tasa para todas las transferencias (no
  // hay una por banco); se guarda acá para poder editarla cuando cambie, sin tocar código.
  ipcMain.handle('config:obtenerRetencionTransferencia', () => {
    const row = db.prepare("SELECT valor FROM configuracion WHERE clave = 'retencion_transferencia'").get();
    return row ? Number(row.valor) : 0;
  });

  ipcMain.handle('config:guardarRetencionTransferencia', (_event, porcentaje) => {
    const n = Number(porcentaje);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: 'Poné un porcentaje entre 0 y 100.' };
    db.prepare(
      "INSERT INTO configuracion (clave, valor) VALUES ('retencion_transferencia', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor"
    ).run(String(n));
    return { ok: true };
  });
}

module.exports = { registrar };
