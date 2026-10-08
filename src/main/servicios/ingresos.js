// Fondos personales: ingresos (alquileres), retiros, pases con el negocio y saldos por cuenta.
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

function registrar(ctx) {
  const { EFECTIVO_PERSONAL, FECHA_VALIDA, claveCuenta, cuentaPersonal, db, dolaresPersonales, guardarConfig, saldoDePases, ipcMain, leerConfig, listaDeCuentas, redondear2, saldosPersonales } = ctx;

  const textoOpcional = (t, max) => String(t || '').trim().slice(0, max) || null;

  // ---------- Ingresos personales (alquileres que cobra el dueño) ----------
  ipcMain.handle('ingresos:listar', () =>
    db
      .prepare(
        `SELECT i.id, i.fecha, i.categoria_id, c.nombre AS categoria, i.descripcion, i.monto, i.cuenta, i.observacion, i.fondo_personal, i.retencion, i.retiro_id
         FROM ingresos i LEFT JOIN categorias_gasto c ON c.id = i.categoria_id
         ORDER BY i.fecha DESC, i.id DESC`
      )
      .all()
  );

  // ---------- Resultado por categoría (cuánto le deja cada propiedad, la pensión, etc.) ----------
  // Cada propiedad es una categoría: lo que entró (neto de la retención del banco) menos lo que se gastó, por categoría
  // y en un período. Solo salen las categorías con movimientos en ese período.
  ipcMain.handle('ingresos:resultado', (_event, { desde, hasta } = {}) => {
    const d = FECHA_VALIDA.test(desde) ? desde : '0000-00-00';
    const h = FECHA_VALIDA.test(hasta) ? hasta : '9999-12-31';
    const suma = (tabla, expr, extra = '') =>
      Object.fromEntries(
        db.prepare(`SELECT categoria_id AS id, SUM(${expr}) AS total FROM ${tabla} WHERE fecha >= ? AND fecha <= ? ${extra} GROUP BY categoria_id`).all(d, h).map((f) => [f.id === null ? 'sin' : f.id, f.total])
      );
    const entro = suma('ingresos', 'monto - retencion');
    const gasto = suma('retiros_personales', 'monto', 'AND categoria_id NOT IN (SELECT id FROM categorias_gasto WHERE de_fondos = 2)');
    const nombres = Object.fromEntries(db.prepare('SELECT id, nombre FROM categorias_gasto').all().map((c) => [c.id, c.nombre]));
    const filas = [...new Set([...Object.keys(entro), ...Object.keys(gasto)])]
      .map((id) => {
        const e = redondear2(entro[id] || 0);
        const g = redondear2(gasto[id] || 0);
        return { id: id === 'sin' ? null : Number(id), nombre: id === 'sin' ? 'Sin categoría' : nombres[id] || 'Sin categoría', entro: e, gasto: g, deja: redondear2(e - g) };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    // Aparte, los gastos personales por categoría (no son de ninguna propiedad: no entran a la tabla de arriba).
    const gastoPersonal = suma('retiros_personales', 'monto', 'AND categoria_id IN (SELECT id FROM categorias_gasto WHERE de_fondos = 2)');
    const personales = Object.keys(gastoPersonal)
      .map((id) => ({ id: Number(id), nombre: nombres[id] || 'Sin categoría', gasto: redondear2(gastoPersonal[id]) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    return {
      filas,
      total: { entro: redondear2(filas.reduce((a, f) => a + f.entro, 0)), gasto: redondear2(filas.reduce((a, f) => a + f.gasto, 0)), deja: redondear2(filas.reduce((a, f) => a + f.deja, 0)) },
      personales: { filas: personales, total: redondear2(personales.reduce((a, f) => a + f.gasto, 0)) },
    };
  });

  // Los movimientos que hay detrás de una fila del Resultado: los ingresos (netos de retención) y los retiros de esa
  // categoría en el período, del más nuevo al más viejo. `categoria_id` null = los que no tienen categoría.
  ipcMain.handle('ingresos:resultadoDetalle', (_event, { categoria_id, desde, hasta } = {}) => {
    const d = FECHA_VALIDA.test(desde) ? desde : '0000-00-00';
    const h = FECHA_VALIDA.test(hasta) ? hasta : '9999-12-31';
    const sinCategoria = categoria_id === null || categoria_id === undefined || categoria_id === '';
    const filtro = sinCategoria ? 'categoria_id IS NULL' : 'categoria_id = ?';
    const args = sinCategoria ? [d, h] : [Number(categoria_id), d, h];
    const ingresos = db
      .prepare(`SELECT id, fecha, descripcion, observacion, cuenta, monto, retencion, creado FROM ingresos WHERE ${filtro} AND fecha >= ? AND fecha <= ?`)
      .all(...args)
      .map((i) => ({ tipo: 'ingreso', id: i.id, fecha: i.fecha, descripcion: i.descripcion, observacion: i.observacion, cuenta: i.cuenta, monto: redondear2(i.monto - i.retencion), retencion: i.retencion, creado: i.creado }));
    const retiros = db
      .prepare(`SELECT id, fecha, descripcion, observacion, cuenta, monto, creado FROM retiros_personales WHERE ${filtro} AND fecha >= ? AND fecha <= ?`)
      .all(...args)
      .map((r) => ({ tipo: 'retiro', id: r.id, fecha: r.fecha, descripcion: r.descripcion, observacion: r.observacion, cuenta: r.cuenta, monto: -r.monto, retencion: 0, creado: r.creado }));
    return [...ingresos, ...retiros]
      .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.creado < b.creado ? 1 : a.creado > b.creado ? -1 : b.id - a.id))
      .map(({ creado, ...resto }) => resto);
  });

  // ---------- Categorías (una sola lista para ingresos y gastos de propiedades) y descripciones sugeridas ----------
  // Son las categorías de `categorias_gasto` con `de_fondos = 1` (ámbito personal): lista propia de Fondos personales,
  // separada de la de Gastos → Personal.
  const categoriaPersonalActiva = (id) => db.prepare("SELECT id FROM categorias_gasto WHERE id = ? AND ambito = 'personal' AND de_fondos = 1 AND activo = 1").get(Number(id));
  ipcMain.handle('ingresos:categorias', () => db.prepare("SELECT id, nombre FROM categorias_gasto WHERE ambito = 'personal' AND de_fondos = 1 AND activo = 1 ORDER BY nombre COLLATE NOCASE").all());

  ipcMain.handle('ingresos:crearCategoria', (_event, nombre) => {
    const texto = String(nombre || '').trim().slice(0, 80);
    if (!texto) return { ok: false, error: 'Poné un nombre para la categoría.' };
    db.prepare(
      `INSERT INTO categorias_gasto (nombre, ambito, de_fondos) VALUES (?, 'personal', 1)
       ON CONFLICT(nombre, ambito, de_fondos) DO UPDATE SET activo = 1, nombre = excluded.nombre`
    ).run(texto);
    return { ok: true };
  });

  // Los ingresos y retiros ya cargados con esa categoría la siguen mostrando; solo deja de ofrecerse.
  ipcMain.handle('ingresos:quitarCategoria', (_event, id) => {
    db.prepare("UPDATE categorias_gasto SET activo = 0 WHERE id = ? AND ambito = 'personal' AND de_fondos = 1").run(Number(id));
    return { ok: true };
  });

  // Lista aparte para los gastos personales de Fondos personales (`de_fondos = 2`): no se mezcla con la de ingresos y
  // propiedades. Arranca vacía; se completa desde la pastilla Categorías.
  const categoriaGastoPersonalActiva = (id) => db.prepare("SELECT id FROM categorias_gasto WHERE id = ? AND ambito = 'personal' AND de_fondos = 2 AND activo = 1").get(Number(id));
  ipcMain.handle('ingresos:categoriasGastosPersonales', () => db.prepare("SELECT id, nombre FROM categorias_gasto WHERE ambito = 'personal' AND de_fondos = 2 AND activo = 1 ORDER BY nombre COLLATE NOCASE").all());

  ipcMain.handle('ingresos:crearCategoriaGastoPersonal', (_event, nombre) => {
    const texto = String(nombre || '').trim().slice(0, 80);
    if (!texto) return { ok: false, error: 'Poné un nombre para la categoría.' };
    db.prepare(
      `INSERT INTO categorias_gasto (nombre, ambito, de_fondos) VALUES (?, 'personal', 2)
       ON CONFLICT(nombre, ambito, de_fondos) DO UPDATE SET activo = 1, nombre = excluded.nombre`
    ).run(texto);
    return { ok: true };
  });

  ipcMain.handle('ingresos:quitarCategoriaGastoPersonal', (_event, id) => {
    db.prepare("UPDATE categorias_gasto SET activo = 0 WHERE id = ? AND ambito = 'personal' AND de_fondos = 2").run(Number(id));
    return { ok: true };
  });

  ipcMain.handle('ingresos:descripciones', () =>
    db
      .prepare(
        `SELECT d.id, d.nombre, d.categoria_id, d.orden,
                (SELECT i.monto FROM ingresos i WHERE lower(i.descripcion) = lower(d.nombre) ORDER BY i.fecha DESC, i.id DESC LIMIT 1) AS ultimo_monto,
                (SELECT i.cuenta FROM ingresos i WHERE lower(i.descripcion) = lower(d.nombre) ORDER BY i.fecha DESC, i.id DESC LIMIT 1) AS ultima_cuenta
         FROM descripciones_ingreso d ORDER BY d.orden DESC, d.nombre LIMIT 1000`
      )
      .all()
  );

  // Agrega una descripción sugerida a una categoría sin cargar un ingreso (queda sin uso: orden 0). Si ya
  // existía con ese nombre, pasa a esa categoría.
  ipcMain.handle('ingresos:crearDescripcion', (_event, { nombre, categoria_id }) => {
    const texto = String(nombre || '').trim().slice(0, 200);
    if (!texto) return { ok: false, error: 'Escribí la descripción.' };
    // Sirve para las categorías de las dos listas (ingresos y propiedades, y gastos privados).
    const categoria = categoriaPersonalActiva(categoria_id) || categoriaGastoPersonalActiva(categoria_id);
    if (!categoria) return { ok: false, error: 'Elegí una categoría.' };
    db.prepare(
      `INSERT INTO descripciones_ingreso (nombre, categoria_id, orden) VALUES (?, ?, 0)
       ON CONFLICT(nombre, categoria_id) DO UPDATE SET nombre = excluded.nombre`
    ).run(texto, categoria.id);
    return { ok: true };
  });

  ipcMain.handle('ingresos:quitarDescripcion', (_event, id) => {
    db.prepare('DELETE FROM descripciones_ingreso WHERE id = ?').run(Number(id));
    return { ok: true };
  });

  ipcMain.handle('ingresos:crear', (_event, i) => {
    if (!i || !FECHA_VALIDA.test(i.fecha)) return { ok: false, error: 'La fecha no es válida.' };
    const descripcion = String(i.descripcion || '').trim().slice(0, 200);
    if (!descripcion) return { ok: false, error: 'Escribí una descripción.' };
    const monto = Number(i.monto);
    if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
    const categoria = categoriaPersonalActiva(i.categoria_id);
    if (!categoria) return { ok: false, error: 'Elegí una categoría.' };
    // Un ingreso nuevo siempre entra a una cuenta personal (un banco o app, o Efectivo personal) y no suma a la caja.
    const cuenta = cuentaPersonal(i.cuenta);
    if (!cuenta) return { ok: false, error: 'Elegí en qué cuenta entró.' };
    // Si se lo transfirieron a un banco o app, el banco retiene un % antes de que llegue (la misma tasa que en Métodos de
    // pago). Queda guardado en el ingreso y se resta del saldo personal; no es un gasto del negocio.
    const tasa = Number(leerConfig('retencion_transferencia') || 0);
    const retencion = i.con_retencion && cuenta !== EFECTIVO_PERSONAL && tasa > 0 ? redondear2(redondear2(monto) * (tasa / 100)) : 0;
    db.prepare('INSERT INTO ingresos (fecha, categoria_id, descripcion, monto, cuenta, observacion, fondo_personal, retencion) VALUES (?, ?, ?, ?, ?, ?, 1, ?)').run(
      i.fecha, categoria.id, descripcion, redondear2(monto), cuenta, textoOpcional(i.observacion, 300), retencion
    );
    // La descripción queda en las sugeridas (sube al principio si ya estaba) con su categoría.
    db.prepare(
      `INSERT INTO descripciones_ingreso (nombre, categoria_id, orden)
       VALUES (?, ?, (SELECT COALESCE(MAX(orden), 0) + 1 FROM descripciones_ingreso))
       ON CONFLICT(nombre, categoria_id) DO UPDATE SET nombre = excluded.nombre, orden = excluded.orden`
    ).run(descripcion, categoria.id);
    return { ok: true };
  });
  // Una categoría propia de Fondos personales que se crea sola (Intereses, Reintegros); si se la quitó, vuelve a usarse.
  const categoriaAutomatica = (nombre) => {
    db.prepare(
      `INSERT INTO categorias_gasto (nombre, ambito, de_fondos) VALUES (?, 'personal', 1)
       ON CONFLICT(nombre, ambito, de_fondos) DO UPDATE SET activo = 1`
    ).run(nombre);
    return db.prepare("SELECT id FROM categorias_gasto WHERE nombre = ? AND ambito = 'personal' AND de_fondos = 1").get(nombre).id;
  };
  // Lo que las apps o el banco te dan por tener la plata en una cuenta personal. Sin retención.
  const ingresoDirecto = ({ fecha, cuenta, monto, observacion }, categoria_id, descripcion, retiro_id = null) => {
    if (!FECHA_VALIDA.test(fecha)) return { ok: false, error: 'La fecha no es válida.' };
    const importe = Number(monto);
    if (!Number.isFinite(importe) || importe <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
    const cuentaElegida = cuentaPersonal(cuenta);
    if (!cuentaElegida) return { ok: false, error: 'Elegí en qué cuenta entró.' };
    db.prepare('INSERT INTO ingresos (fecha, categoria_id, descripcion, monto, cuenta, observacion, fondo_personal, retencion, retiro_id) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)').run(
      fecha, categoria_id, descripcion, redondear2(importe), cuentaElegida, textoOpcional(observacion, 300), retiro_id
    );
    return { ok: true };
  };
  ipcMain.handle('ingresos:rendimiento', (_event, datos) => {
    if (!datos) return { ok: false, error: 'La fecha no es válida.' };
    return db.transaction(() => ingresoDirecto(datos, categoriaAutomatica('Intereses'), 'Interés'))();
  });
  // Plata que te devuelven de una compra personal. Si se la liga a un gasto de propiedades, entra en la categoría de ese
  // gasto (el Resultado la cuenta ahí) y no puede pasar de lo que costó; si no, va a "Reintegros".
  ipcMain.handle('ingresos:reintegro', (_event, datos) => {
    if (!datos) return { ok: false, error: 'La fecha no es válida.' };
    return db.transaction(() => {
      const retiroId = datos.retiro_id ? Number(datos.retiro_id) : null;
      if (!retiroId) return ingresoDirecto(datos, categoriaAutomatica('Reintegros'), 'Reintegro');
      const retiro = db.prepare('SELECT id, categoria_id, descripcion, monto FROM retiros_personales WHERE id = ?').get(retiroId);
      if (!retiro) return { ok: false, error: 'Esa compra ya no existe.' };
      const yaReintegrado = db.prepare('SELECT COALESCE(SUM(monto), 0) AS t FROM ingresos WHERE retiro_id = ?').get(retiro.id).t;
      if (redondear2(yaReintegrado + Number(datos.monto || 0)) > redondear2(retiro.monto) + 0.005) {
        return { ok: false, error: 'Con este reintegro se devolvería más de lo que costó la compra.' };
      }
      return ingresoDirecto(datos, retiro.categoria_id, `Reintegro: ${retiro.descripcion}`.slice(0, 200), retiro.id);
    })();
  });

  ipcMain.handle('ingresos:eliminar', (_event, id) => {
    db.transaction(() => {
      // Su retención automática (si la tuvo) se va con él.
      db.prepare('DELETE FROM gastos WHERE ingreso_id = ?').run(id);
      db.prepare('DELETE FROM ingresos WHERE id = ?').run(id);
    })();
    return { ok: true };
  });
  // ---------- Cuentas personales y saldos ----------
  // (Los saldos personales se calculan en compartido.js: la Caja general también los usa.)
  ipcMain.handle('ingresos:saldos', () => {
    const cuentas = saldosPersonales();
    const dolares = dolaresPersonales();
    // El dinero disponible suma las cuentas y los dólares (con la cotización de hoy).
    return { cuentas, dolares, saldoPases: saldoDePases(), total: redondear2(cuentas.reduce((a, c) => a + c.saldo, 0) + dolares.valor), retencion: Number(leerConfig('retencion_transferencia') || 0) };
  });

  // ---------- Dólares personales (ahorro) ----------
  // La cotización es la misma que la de la Caja: cambiarla acá la cambia allá.
  ipcMain.handle('ingresos:guardarDolares', (_event, { dolares_usd, cotizacion } = {}) => {
    const usd = Number(dolares_usd);
    const cot = Number(cotizacion);
    if (!Number.isFinite(usd) || usd < 0 || !Number.isFinite(cot) || cot < 0) return { ok: false, error: 'Los dólares o la cotización no son válidos.' };
    guardarConfig('fondos_dolares_usd', usd);
    guardarConfig('caja_cotizacion', cot);
    return { ok: true };
  });
  // Comprar dólares con plata de una cuenta personal: resta los pesos de esa cuenta y suma los dólares. No es ingreso ni gasto.
  ipcMain.handle('ingresos:comprarDolares', (_event, { fecha, cuenta, usd, cotizacion } = {}) => {
    if (!FECHA_VALIDA.test(fecha)) return { ok: false, error: 'La fecha no es válida.' };
    const nombre = cuentaPersonal(cuenta);
    if (!nombre) return { ok: false, error: 'Elegí con qué cuenta pagó.' };
    const dolares = Number(usd);
    const cot = Number(cotizacion);
    if (!Number.isFinite(dolares) || dolares <= 0) return { ok: false, error: 'Poné cuántos dólares compró.' };
    if (!Number.isFinite(cot) || cot <= 0) return { ok: false, error: 'Poné a cuánto compró cada dólar.' };
    db.transaction(() => {
      db.prepare('INSERT INTO compras_dolares_personales (fecha, cuenta, usd, cotizacion, monto) VALUES (?, ?, ?, ?, ?)').run(fecha, nombre, dolares, cot, redondear2(dolares * cot));
      guardarConfig('fondos_dolares_usd', redondear2((Number(leerConfig('fondos_dolares_usd')) || 0) + dolares));
    })();
    return { ok: true };
  });
  ipcMain.handle('ingresos:comprasDolares', () => db.prepare('SELECT id, fecha, cuenta, usd, cotizacion, monto FROM compras_dolares_personales ORDER BY fecha DESC, id DESC').all());
  // Quitar una compra devuelve los pesos a la cuenta y saca esos dólares.
  ipcMain.handle('ingresos:eliminarCompraDolares', (_event, id) => {
    const compra = db.prepare('SELECT usd FROM compras_dolares_personales WHERE id = ?').get(Number(id));
    if (!compra) return { ok: true };
    db.transaction(() => {
      db.prepare('DELETE FROM compras_dolares_personales WHERE id = ?').run(Number(id));
      guardarConfig('fondos_dolares_usd', Math.max(0, redondear2((Number(leerConfig('fondos_dolares_usd')) || 0) - compra.usd)));
    })();
    return { ok: true };
  });

  // El historial de una cuenta personal (como el de la Caja): cada movimiento con el saldo personal que fue quedando, del más
  // nuevo al más viejo. Son los mismos cuatro orígenes que suman en `saldosPersonales`: ingresos nuevos (y su retención),
  // retiros, pases con el negocio y ajustes.
  ipcMain.handle('ingresos:movimientos', (_event, nombre) => {
    const cuenta = cuentaPersonal(nombre);
    if (!cuenta) return [];
    const es = (c) => claveCuenta(c) === claveCuenta(cuenta);
    const movs = [];
    db.prepare('SELECT fecha, descripcion, monto, retencion, cuenta, creado FROM ingresos WHERE fondo_personal = 1').all().filter((i) => es(i.cuenta)).forEach((i) => {
      movs.push({ fecha: i.fecha, creado: i.creado, orden: 0, detalle: `Ingreso: ${i.descripcion}`, monto: i.monto });
      if (i.retencion > 0) movs.push({ fecha: i.fecha, creado: i.creado, orden: 1, detalle: 'Retención por transferencia', monto: -i.retencion });
    });
    db.prepare('SELECT fecha, descripcion, monto, cuenta, creado FROM retiros_personales').all().filter((r) => es(r.cuenta)).forEach((r) => movs.push({ fecha: r.fecha, creado: r.creado, orden: 2, detalle: `Gasto: ${r.descripcion}`, monto: -r.monto }));
    db.prepare('SELECT fecha, monto, sentido, cuenta_negocio, cuenta_personal, nota, creado FROM pases_personales').all().filter((p) => es(p.cuenta_personal)).forEach((p) =>
      movs.push({
        fecha: p.fecha,
        creado: p.creado,
        orden: 3,
        detalle: `${p.sentido === 'a_personal' ? `Pase desde ${p.cuenta_negocio} (negocio)` : `Pase a ${p.cuenta_negocio} (negocio)`}${p.nota ? ` · ${p.nota}` : ''}`,
        monto: p.sentido === 'a_personal' ? p.monto : -p.monto,
      })
    );
    db.prepare('SELECT fecha, usd, cotizacion, monto, cuenta, creado FROM compras_dolares_personales').all().filter((c) => es(c.cuenta)).forEach((c) =>
      movs.push({ fecha: c.fecha, creado: c.creado, orden: 3, detalle: `Compra de U$S ${c.usd} a $${c.cotizacion}`, monto: -c.monto })
    );
    db.prepare('SELECT fecha, monto, nota, cuenta, creado FROM fondos_ajustes').all().filter((a) => es(a.cuenta)).forEach((a) => movs.push({ fecha: a.fecha, creado: a.creado, orden: 4, detalle: a.nota || 'Ajuste de saldo', monto: a.monto }));
    movs.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.creado < b.creado ? -1 : a.creado > b.creado ? 1 : a.orden - b.orden));
    let saldo = 0;
    return movs
      .map((m) => {
        saldo = redondear2(saldo + m.monto);
        return { fecha: m.fecha, detalle: m.detalle, monto: m.monto, saldo };
      })
      .reverse();
  });

  // Deja la parte personal de una cuenta en lo que se tiene hoy: guarda la diferencia como un ajuste.
  ipcMain.handle('ingresos:ajustarSaldo', (_event, { cuenta, saldo } = {}) => {
    const nombre = cuentaPersonal(cuenta);
    if (!nombre) return { ok: false, error: 'Elegí una cuenta válida.' };
    const nuevo = Number(saldo);
    if (!Number.isFinite(nuevo)) return { ok: false, error: 'El monto no es válido.' };
    const actual = saldosPersonales().find((c) => c.nombre === nombre).saldo;
    const diferencia = redondear2(nuevo - actual);
    if (diferencia !== 0) {
      db.prepare("INSERT INTO fondos_ajustes (cuenta, fecha, monto, nota) VALUES (?, date('now', 'localtime'), ?, 'Ajuste de saldo')").run(nombre, diferencia);
    }
    return { ok: true };
  });

  // ---------- Retiros (lo que sale de los fondos personales: la moto, arreglos de las casas…) ----------
  ipcMain.handle('ingresos:retiros', () =>
    db
      .prepare(
        `SELECT r.id, r.fecha, r.categoria_id, c.nombre AS categoria, CASE WHEN c.de_fondos = 2 THEN 'personal' ELSE 'propiedad' END AS clase, r.descripcion, r.monto, r.cuenta, r.observacion,
                (SELECT COALESCE(SUM(i.monto), 0) FROM ingresos i WHERE i.retiro_id = r.id) AS reintegrado
         FROM retiros_personales r LEFT JOIN categorias_gasto c ON c.id = r.categoria_id
         ORDER BY r.fecha DESC, r.id DESC`
      )
      .all()
  );

  ipcMain.handle('ingresos:crearRetiro', (_event, r) => {
    if (!r || !FECHA_VALIDA.test(r.fecha)) return { ok: false, error: 'La fecha no es válida.' };
    // La categoría dice si es un gasto de propiedades (`de_fondos = 1`) o personal (`de_fondos = 2`).
    const categoria = categoriaPersonalActiva(r.categoria_id) || categoriaGastoPersonalActiva(r.categoria_id);
    if (!categoria) return { ok: false, error: 'Elegí una categoría.' };
    const descripcion = textoOpcional(r.descripcion, 200);
    if (!descripcion) return { ok: false, error: 'Escribí una descripción.' };
    const monto = Number(r.monto);
    if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
    const cuenta = cuentaPersonal(r.cuenta);
    if (!cuenta) return { ok: false, error: 'Elegí de qué cuenta salió.' };
    db.prepare('INSERT INTO retiros_personales (fecha, categoria_id, descripcion, monto, cuenta, observacion) VALUES (?, ?, ?, ?, ?, ?)').run(
      r.fecha, categoria.id, descripcion, redondear2(monto), cuenta, textoOpcional(r.observacion, 300)
    );
    // La descripción queda en las sugeridas de esa categoría (la misma lista que usan los ingresos).
    db.prepare(
      `INSERT INTO descripciones_ingreso (nombre, categoria_id, orden)
       VALUES (?, ?, (SELECT COALESCE(MAX(orden), 0) + 1 FROM descripciones_ingreso))
       ON CONFLICT(nombre, categoria_id) DO UPDATE SET nombre = excluded.nombre, orden = excluded.orden`
    ).run(descripcion, categoria.id);
    return { ok: true };
  });

  ipcMain.handle('ingresos:eliminarRetiro', (_event, id) => {
    // Sus reintegros se van con ella: la plata vuelve a la cuenta y los reintegros dejan de entrar.
    db.prepare('DELETE FROM ingresos WHERE retiro_id = ?').run(Number(id));
    db.prepare('DELETE FROM retiros_personales WHERE id = ?').run(Number(id));
    return { ok: true };
  });

  // ---------- Pases entre el negocio y lo personal ----------
  ipcMain.handle('ingresos:pases', () => db.prepare('SELECT id, fecha, monto, sentido, cuenta_negocio, cuenta_personal, nota FROM pases_personales ORDER BY fecha DESC, id DESC').all());

  ipcMain.handle('ingresos:crearPase', (_event, p) => {
    if (!p || !FECHA_VALIDA.test(p.fecha)) return { ok: false, error: 'La fecha no es válida.' };
    if (p.sentido !== 'a_personal' && p.sentido !== 'al_negocio') return { ok: false, error: 'Elegí el sentido del pase.' };
    const monto = Number(p.monto);
    if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
    const cuentaNegocio = listaDeCuentas().find((c) => claveCuenta(c) === claveCuenta(p.cuenta_negocio));
    if (!cuentaNegocio) return { ok: false, error: 'Elegí la cuenta del negocio.' };
    const cuentaPers = cuentaPersonal(p.cuenta_personal);
    if (!cuentaPers) return { ok: false, error: 'Elegí la cuenta personal.' };
    db.prepare('INSERT INTO pases_personales (fecha, monto, sentido, cuenta_negocio, cuenta_personal, nota) VALUES (?, ?, ?, ?, ?, ?)').run(
      p.fecha, redondear2(monto), p.sentido, cuentaNegocio, cuentaPers, textoOpcional(p.nota, 200)
    );
    return { ok: true };
  });

  ipcMain.handle('ingresos:eliminarPase', (_event, id) => {
    db.prepare('DELETE FROM pases_personales WHERE id = ?').run(Number(id));
    return { ok: true };
  });
}

module.exports = { registrar };
