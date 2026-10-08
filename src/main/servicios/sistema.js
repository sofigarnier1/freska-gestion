// Copias de seguridad (del día, externa y restauración), enlaces y geocodificación.
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

function registrar(ctx) {
  const { app, copias, db, dialog, enlacePermitido, fs, guardarConfig, ipcMain, leerConfig, path, shell } = ctx;

  ipcMain.handle('sistema:geocodificar', async (_event, direccion) => {
    // Cada dirección se consulta afuera (OpenStreetMap) una sola vez: después se recuerda acá.
    const clave = String(direccion || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!clave) return null;
    const guardada = db.prepare('SELECT lat, lon FROM ubicaciones WHERE direccion = ?').get(clave);
    if (guardada) return guardada;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(direccion)}`;
      const respuesta = await fetch(url, {
        headers: { 'User-Agent': 'FRESKA-app-carniceria/1.0' },
      });
      const resultados = await respuesta.json();
      if (!resultados || resultados.length === 0) return null;
      const coords = { lat: Number(resultados[0].lat), lon: Number(resultados[0].lon) };
      db.prepare('INSERT OR REPLACE INTO ubicaciones (direccion, lat, lon) VALUES (?, ?, ?)').run(
        clave,
        coords.lat,
        coords.lon
      );
      return coords;
    } catch (e) {
      return { error: 'conexion' };
    }
  });

  // Actualizaciones: la app mira en el repo público de instaladores si hay una versión más nueva. Solo funciona
  // en la app instalada (con `npm start` no hay nada que actualizar). Solo el administrador (prefijo `sistema`).
  let actualizador = null;
  function obtenerActualizador() {
    if (!actualizador) {
      ({ autoUpdater: actualizador } = require('electron-updater'));
      actualizador.autoDownload = false; // no baja nada hasta que se toque "Actualizar"
      actualizador.autoInstallOnAppQuit = false;
    }
    return actualizador;
  }

  ipcMain.handle('sistema:buscarActualizacion', async () => {
    const actual = app.getVersion();
    if (!app.isPackaged) return { ok: true, disponible: false, actual, enDesarrollo: true };
    try {
      const r = await obtenerActualizador().checkForUpdates();
      const nueva = r && r.updateInfo && r.updateInfo.version;
      return { ok: true, disponible: !!nueva && nueva !== actual && r.isUpdateAvailable !== false, version: nueva, actual };
    } catch (e) {
      return { ok: false, error: 'No se pudo buscar actualizaciones. ¿Hay internet?' };
    }
  });

  ipcMain.handle('sistema:instalarActualizacion', async () => {
    if (!app.isPackaged) return { ok: false, error: 'Solo funciona en la app instalada.' };
    try {
      const a = obtenerActualizador();
      await a.downloadUpdate();
      setImmediate(() => a.quitAndInstall(true, true));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'No se pudo descargar la actualización. Probá de nuevo.' };
    }
  });

  ipcMain.handle('sistema:abrirEnlace', (_event, url) => {
    if (!enlacePermitido(url)) return { ok: false, error: 'Ese enlace no está permitido.' };
    shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('sistema:hacerBackup', async () => {
    const dbPath = path.join(app.getPath('userData'), 'freska.db');
    const fecha = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(ctx.mainWindow, {
      title: 'Guardar copia de seguridad',
      defaultPath: `freska-backup-${fecha}.db`,
      filters: [{ name: 'Base de datos FRESKA', extensions: ['db'] }],
    });
    if (canceled || !filePath) return { ok: false, cancelado: true };
    fs.copyFileSync(dbPath, filePath);
    db.prepare(
      "INSERT INTO configuracion (clave, valor) VALUES ('ultima_copia_manual', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor"
    ).run(copias.fechaLocal());
    return { ok: true, filePath };
  });

  const dirCopias = () => path.join(app.getPath('userData'), 'copias');

  ipcMain.handle('sistema:listarCopias', () => {
    const ultima = db.prepare("SELECT valor FROM configuracion WHERE clave = 'ultima_copia_manual'").get();
    return {
      copias: copias.listar(dirCopias()),
      ultimaManual: ultima ? ultima.valor : null,
      carpeta: dirCopias(),
    };
  });

  // ---- Copia externa automática (Drive, pendrive...). La carpeta se elige en Copias de seguridad.
  // Se hace al abrir la app, cada 30 minutos mientras está abierta y al cerrarla; queda anotado cuándo salió bien
  // ('copia_externa_ultima') o por qué falló ('copia_externa_error'), para el aviso y la pantalla.
  const estadoCopiaExterna = () => ({
    carpeta: leerConfig('copia_externa_carpeta') || null,
    ultima: leerConfig('copia_externa_ultima') || null,
    error: leerConfig('copia_externa_error') || null,
    disponible: Boolean(leerConfig('copia_externa_carpeta')) && fs.existsSync(leerConfig('copia_externa_carpeta')),
    cantidad: copias.MAX_EXTERNAS,
  });

  let copiaExternaEnCurso = null;
  const hacerCopiaExterna = () => {
    const carpeta = leerConfig('copia_externa_carpeta');
    if (!carpeta || !db.open) return Promise.resolve({ ok: false, sinCarpeta: true });
    if (copiaExternaEnCurso) return copiaExternaEnCurso;
    copiaExternaEnCurso = copias
      .copiaExterna({ db, carpeta })
      .then((res) => {
        try {
          if (res.ok) {
            guardarConfig('copia_externa_ultima', new Date().toISOString());
            guardarConfig('copia_externa_error', '');
          } else {
            guardarConfig('copia_externa_error', res.error || 'No se pudo hacer la copia.');
          }
        } catch {
          // la base pudo haberse cerrado (restaurando): no es un problema de la copia
        }
        return res;
      })
      .finally(() => {
        copiaExternaEnCurso = null;
      });
    return copiaExternaEnCurso;
  };

  ipcMain.handle('sistema:copiaExternaEstado', () => estadoCopiaExterna());

  ipcMain.handle('sistema:elegirCarpetaCopiaExterna', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(ctx.mainWindow, {
      title: 'Elegí la carpeta donde se guardan las copias (por ejemplo, una de Google Drive)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths[0]) return { ok: false, cancelado: true };
    // Que no sea la misma carpeta de la base ni la de las copias automáticas: no serviría de nada.
    const elegida = path.resolve(filePaths[0]);
    const propia = path.resolve(app.getPath('userData'));
    if (elegida === propia || elegida.startsWith(propia + path.sep)) {
      return { ok: false, error: 'Esa carpeta está dentro de los datos de la app. Elegí una de afuera, como la de Drive o un pendrive.' };
    }
    guardarConfig('copia_externa_carpeta', elegida);
    guardarConfig('copia_externa_error', '');
    const res = await hacerCopiaExterna();
    return { ok: true, copia: res, estado: estadoCopiaExterna() };
  });

  ipcMain.handle('sistema:copiaExternaAhora', async () => {
    const res = await hacerCopiaExterna();
    return { ...res, estado: estadoCopiaExterna() };
  });

  ipcMain.handle('sistema:quitarCopiaExterna', () => {
    guardarConfig('copia_externa_carpeta', '');
    guardarConfig('copia_externa_error', '');
    return { ok: true, estado: estadoCopiaExterna() };
  });

  hacerCopiaExterna();
  const relojCopiaExterna = setInterval(hacerCopiaExterna, 30 * 60 * 1000);
  relojCopiaExterna.unref();

  // Al cerrar la app se hace una última copia (con un tope de espera, para no dejarla colgada si la carpeta tarda).
  let cerrandoConCopia = false;
  app.on('before-quit', (evento) => {
    if (cerrandoConCopia || !db.open || !leerConfig('copia_externa_carpeta')) return;
    evento.preventDefault();
    cerrandoConCopia = true;
    Promise.race([hacerCopiaExterna(), new Promise((r) => setTimeout(r, 8000))]).finally(() => app.quit());
  });

  ipcMain.handle('sistema:abrirCarpetaCopias', async () => {
    fs.mkdirSync(dirCopias(), { recursive: true });
    await shell.openPath(dirCopias());
  });

  // Cierra la base, reemplaza el archivo y reinicia la app para que arranque con lo restaurado.
  function aplicarRestauracion(origen) {
    const dbPath = path.join(app.getPath('userData'), 'freska.db');
    const resultado = copias.restaurar({
      origen,
      dbPath,
      dirCopias: dirCopias(),
      cerrarBase: () => db.close(),
    });
    // Si falló con la base ya cerrada, también hay que reiniciar: la app no puede seguir sin base.
    if (resultado.ok || resultado.cerrada) {
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 400);
    }
    return { ok: resultado.ok, error: resultado.error };
  }

  ipcMain.handle('sistema:restaurarCopia', (_event, nombre) => {
    const origen = copias.rutaDeCopia(dirCopias(), nombre);
    if (!origen) return { ok: false, error: 'No se encontró esa copia.' };
    return aplicarRestauracion(origen);
  });

  ipcMain.handle('sistema:restaurarDesdeArchivo', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(ctx.mainWindow, {
      title: 'Elegí la copia de seguridad a restaurar',
      properties: ['openFile'],
      filters: [{ name: 'Base de datos FRESKA', extensions: ['db'] }],
    });
    if (canceled || filePaths.length === 0) return { ok: false, cancelado: true };
    return aplicarRestauracion(filePaths[0]);
  });
}

module.exports = { registrar };
