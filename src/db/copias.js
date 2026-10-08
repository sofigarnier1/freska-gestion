// Copias de seguridad de la base (freska.db). No depende de Electron, para poder probarlo solo.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PREFIJO_AUTOMATICA = 'freska-auto-';
const PREFIJO_PREVIA = 'freska-antes-de-restaurar-';
const MAX_AUTOMATICAS = 30;
const MAX_PREVIAS = 10;
const PREFIJO_EXTERNA = 'freska-ext-';
const MAX_EXTERNAS = 14;
const NOMBRE_VALIDO = /^freska-(auto|antes-de-restaurar)-[0-9-]+\.db$/;

function dos(n) {
  return String(n).padStart(2, '0');
}

function fechaLocal(d = new Date()) {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

function horaLocal(d = new Date()) {
  return `${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;
}

function podar(dirCopias, prefijo, maximo) {
  const archivos = fs
    .readdirSync(dirCopias)
    .filter((n) => n.startsWith(prefijo) && n.endsWith('.db'))
    .sort()
    .reverse();
  archivos.slice(maximo).forEach((n) => fs.unlinkSync(path.join(dirCopias, n)));
}

// Una copia por día, la primera vez que se abre la app ese día. Se llama ANTES de abrir y
// migrar la base, así si una versión nueva migra mal, la copia del día sigue siendo la de antes.
function copiaDelDia({ dbPath, dirCopias, hoy = new Date() }) {
  try {
    if (!fs.existsSync(dbPath)) return null;
    fs.mkdirSync(dirCopias, { recursive: true });
    const destino = path.join(dirCopias, `${PREFIJO_AUTOMATICA}${fechaLocal(hoy)}.db`);
    if (!fs.existsSync(destino)) fs.copyFileSync(dbPath, destino);
    podar(dirCopias, PREFIJO_AUTOMATICA, MAX_AUTOMATICAS);
    return destino;
  } catch (err) {
    // Una copia que falla nunca tiene que impedir que la app abra.
    console.error('No se pudo hacer la copia automática:', err.message);
    return null;
  }
}

// Copia de la base en una carpeta de afuera (la de Drive, un pendrive...). Se hace con la copia en caliente de
// SQLite (`db.backup`), que es consistente aunque se esté usando la app; se escribe a un archivo temporal, se
// comprueba que esté sana y recién ahí reemplaza a la del día. Un archivo por día (el último del día pisa al anterior)
// y se queda con las últimas 14. Solo toca archivos que empiezan con "freska-ext-". Si la carpeta no está (Drive
// cerrado, pendrive sacado) no la crea: avisa, para que no se copie a un lugar que no existe.
async function copiaExterna({ db, carpeta, hoy = new Date() }) {
  let tmp = null;
  try {
    if (!carpeta || !fs.existsSync(carpeta) || !fs.statSync(carpeta).isDirectory()) {
      return { ok: false, error: 'No se encuentra la carpeta elegida. ¿Está abierto Drive o puesto el pendrive?' };
    }
    const destino = path.join(carpeta, `${PREFIJO_EXTERNA}${fechaLocal(hoy)}.db`);
    tmp = `${destino}.tmp`;
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    await db.backup(tmp);
    const validacion = validarBase(tmp);
    if (!validacion.ok) {
      fs.unlinkSync(tmp);
      return { ok: false, error: validacion.error };
    }
    fs.renameSync(tmp, destino);
    tmp = null;
    podar(carpeta, PREFIJO_EXTERNA, MAX_EXTERNAS);
    return { ok: true, archivo: path.basename(destino) };
  } catch (err) {
    try {
      if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // nada que limpiar
    }
    return { ok: false, error: `No se pudo hacer la copia: ${err.message}` };
  }
}

function listar(dirCopias) {
  if (!fs.existsSync(dirCopias)) return [];
  return fs
    .readdirSync(dirCopias)
    .filter((n) => NOMBRE_VALIDO.test(n))
    .map((nombre) => {
      const stat = fs.statSync(path.join(dirCopias, nombre));
      return {
        nombre,
        tipo: nombre.startsWith(PREFIJO_AUTOMATICA) ? 'automatica' : 'previa',
        fecha: stat.mtime.toISOString(),
        tamano: stat.size,
      };
    })
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

function rutaDeCopia(dirCopias, nombre) {
  if (!NOMBRE_VALIDO.test(nombre)) return null;
  const ruta = path.join(dirCopias, nombre);
  return fs.existsSync(ruta) ? ruta : null;
}

// Comprueba que el archivo sea una base de FRESKA legible antes de pisar nada.
function validarBase(ruta) {
  let base;
  try {
    base = new Database(ruta, { readonly: true, fileMustExist: true });
    const tablas = base
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((t) => t.name);
    const faltan = ['clientes', 'facturas', 'productos'].filter((t) => !tablas.includes(t));
    if (faltan.length > 0) {
      return { ok: false, error: 'Ese archivo no parece ser una copia de FRESKA.' };
    }
    const chequeo = base.pragma('quick_check', { simple: true });
    if (chequeo !== 'ok') {
      return { ok: false, error: 'Ese archivo está dañado y no se puede usar.' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'No se pudo leer ese archivo como una copia de FRESKA.' };
  } finally {
    if (base) base.close();
  }
}

// Reemplaza la base por la copia elegida. Antes guarda una copia de lo actual, por si hay
// arrepentimiento. `cerrarBase` tiene que cerrar la conexión abierta a dbPath.
function restaurar({ origen, dbPath, dirCopias, cerrarBase, ahora = new Date() }) {
  const validacion = validarBase(origen);
  if (!validacion.ok) return { ...validacion, cerrada: false };

  cerrarBase();
  try {
    fs.mkdirSync(dirCopias, { recursive: true });
    const previa = path.join(dirCopias, `${PREFIJO_PREVIA}${fechaLocal(ahora)}-${horaLocal(ahora)}.db`);
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, previa);
    ['-wal', '-shm'].forEach((sufijo) => {
      if (fs.existsSync(dbPath + sufijo)) fs.unlinkSync(dbPath + sufijo);
    });
    fs.copyFileSync(origen, dbPath);
    podar(dirCopias, PREFIJO_PREVIA, MAX_PREVIAS);
    return { ok: true, previa: path.basename(previa), cerrada: true };
  } catch (err) {
    return { ok: false, error: `No se pudo restaurar: ${err.message}`, cerrada: true };
  }
}

module.exports = { copiaDelDia, copiaExterna, MAX_EXTERNAS, listar, rutaDeCopia, validarBase, restaurar, fechaLocal, MAX_AUTOMATICAS };
