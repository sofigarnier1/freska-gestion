// Stock, producción, rendimiento e insumos.
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

function registrar(ctx) {
  const { FECHA_VALIDA, KG_DE_PRODUCTO, db, ipcMain, pilaDeProducto, redondear2, resumenDeStock } = ctx;

  // ---------- Insumos: se cuentan de vez en cuando; cada conteo guarda la cantidad que había ese día ----------
  const UNIDADES_INSUMO = ['u.', 'kg', 'rollos', 'paquetes', 'cajas', 'litros'];
  const datosInsumo = ({ nombre, unidad, minimo }) => {
    const n = String(nombre || '').trim().slice(0, 80);
    if (!n) return { error: 'Poné el nombre del insumo.' };
    const u = UNIDADES_INSUMO.includes(unidad) ? unidad : 'u.';
    let m = null;
    if (minimo !== undefined && minimo !== null && String(minimo).trim() !== '') {
      m = Number(String(minimo).replace(',', '.'));
      if (!Number.isFinite(m) || m < 0) return { error: 'El mínimo no es válido.' };
    }
    return { nombre: n, unidad: u, minimo: m };
  };
  ipcMain.handle('insumos:listar', () => {
    const filas = db.prepare('SELECT id, nombre, unidad, minimo FROM insumos WHERE activo = 1 ORDER BY nombre COLLATE NOCASE').all();
    const ultimos = db.prepare('SELECT fecha, cantidad FROM conteos_insumo WHERE insumo_id = ? ORDER BY fecha DESC, id DESC LIMIT 2');
    return filas.map((i) => {
      const [ultimo, anterior] = ultimos.all(i.id);
      return {
        ...i,
        ultimo: ultimo || null,
        anterior: anterior || null,
        diferencia: ultimo && anterior ? redondear2(ultimo.cantidad - anterior.cantidad) : null,
      };
    });
  });
  ipcMain.handle('insumos:crear', (_event, datos) => {
    const d = datosInsumo(datos || {});
    if (d.error) return { ok: false, error: d.error };
    const existe = db.prepare('SELECT id, activo FROM insumos WHERE nombre = ?').get(d.nombre);
    if (existe && existe.activo) return { ok: false, error: 'Ya hay un insumo con ese nombre.' };
    let id;
    if (existe) {
      db.prepare('UPDATE insumos SET activo = 1, unidad = ?, minimo = ? WHERE id = ?').run(d.unidad, d.minimo, existe.id);
      id = existe.id;
    } else {
      id = db.prepare('INSERT INTO insumos (nombre, unidad, minimo) VALUES (?, ?, ?)').run(d.nombre, d.unidad, d.minimo).lastInsertRowid;
    }
    return { ok: true, id };
  });
  ipcMain.handle('insumos:actualizar', (_event, datos) => {
    const d = datosInsumo(datos || {});
    if (d.error) return { ok: false, error: d.error };
    const id = Number(datos && datos.id);
    if (!db.prepare('SELECT id FROM insumos WHERE id = ? AND activo = 1').get(id)) return { ok: false, error: 'Ese insumo ya no existe.' };
    const otro = db.prepare('SELECT id FROM insumos WHERE nombre = ? AND id != ? AND activo = 1').get(d.nombre, id);
    if (otro) return { ok: false, error: 'Ya hay un insumo con ese nombre.' };
    db.prepare('UPDATE insumos SET nombre = ?, unidad = ?, minimo = ? WHERE id = ?').run(d.nombre, d.unidad, d.minimo, id);
    return { ok: true };
  });
  ipcMain.handle('insumos:quitar', (_event, id) => {
    db.prepare('UPDATE insumos SET activo = 0 WHERE id = ?').run(Number(id));
    return { ok: true };
  });
  // Un conteo: la cantidad que hay de cada insumo en una fecha (los que se dejan vacíos no se cuentan).
  ipcMain.handle('insumos:contar', (_event, { fecha, conteos } = {}) => {
    if (!FECHA_VALIDA.test(String(fecha || ''))) return { ok: false, error: 'La fecha no es válida.' };
    const validos = [];
    for (const c of Array.isArray(conteos) ? conteos : []) {
      if (c.cantidad === '' || c.cantidad === null || c.cantidad === undefined) continue;
      const cantidad = Number(c.cantidad);
      if (!Number.isFinite(cantidad) || cantidad < 0) return { ok: false, error: 'Hay una cantidad que no es válida.' };
      if (!db.prepare('SELECT id FROM insumos WHERE id = ? AND activo = 1').get(Number(c.insumo_id))) continue;
      validos.push({ insumo_id: Number(c.insumo_id), cantidad: Math.round(cantidad * 1000) / 1000 });
    }
    if (!validos.length) return { ok: false, error: 'Cargá la cantidad de al menos un insumo.' };
    db.transaction(() => validos.forEach((c) => db.prepare('INSERT INTO conteos_insumo (insumo_id, fecha, cantidad) VALUES (?, ?, ?)').run(c.insumo_id, fecha, c.cantidad)))();
    return { ok: true, cantidad: validos.length };
  });
  ipcMain.handle('insumos:conteos', (_event, id) =>
    db.prepare('SELECT id, fecha, cantidad FROM conteos_insumo WHERE insumo_id = ? ORDER BY fecha DESC, id DESC').all(Number(id))
  );
  ipcMain.handle('insumos:quitarConteo', (_event, id) => {
    db.prepare('DELETE FROM conteos_insumo WHERE id = ?').run(Number(id));
    return { ok: true };
  });

  ipcMain.handle('stock:resumen', () => resumenDeStock());
  // Rendimiento por tipo de carne en un período: kilos comprados (compras a proveedor), producidos (Producción) y
  // vendidos (facturas), y el rinde = producido ÷ comprado. Lo que no tiene tipo va en "Sin tipo".
  ipcMain.handle('stock:rendimiento', (_event, { desde, hasta } = {}) => {
    if (!FECHA_VALIDA.test(String(desde || '')) || !FECHA_VALIDA.test(String(hasta || ''))) return { ok: false, error: 'El período no es válido.' };
    const SIN_TIPO = 'Sin tipo';
    const filas = new Map();
    const fila = (tipo) => {
      const clave = String(tipo || '').trim() || SIN_TIPO;
      if (!filas.has(clave)) filas.set(clave, { tipo: clave, comprado: 0, producido: 0, vendido: 0 });
      return filas.get(clave);
    };
    // Solo lo comprado por kg entra al rinde: lo comprado por unidad (huevos, etc.) no se mide en kilos.
    db.prepare(
      `SELECT ci.producto AS tipo, SUM(ci.kilos) AS t FROM compra_items ci JOIN compras c ON c.id = ci.compra_id
       WHERE ci.unidad = 'kg' AND substr(c.fecha, 1, 10) BETWEEN ? AND ? GROUP BY ci.producto`
    ).all(desde, hasta).forEach((r) => (fila(r.tipo).comprado += r.t || 0));
    // Lo devuelto a un proveedor (mercadería en mal estado) se descuenta de lo comprado.
    db.prepare(
      `SELECT producto AS tipo, SUM(kilos) AS t FROM devoluciones_proveedor
       WHERE unidad = 'kg' AND kilos IS NOT NULL AND producto != '' AND substr(fecha, 1, 10) BETWEEN ? AND ? GROUP BY producto`
    ).all(desde, hasta).forEach((r) => (fila(r.tipo).comprado -= r.t || 0));
    db.prepare(
      `SELECT COALESCE(ac.tipo, a.tipo) AS tipo, SUM(m.kilos * COALESCE(a.porcentaje_carne, 100) / 100.0 * COALESCE(ac.porcentaje, 100) / 100.0) AS t FROM movimientos_stock m JOIN articulos_stock a ON a.id = m.articulo_id
       LEFT JOIN articulo_carnes ac ON ac.articulo_id = a.id
       WHERE m.tipo = 'produccion' AND substr(m.fecha, 1, 10) BETWEEN ? AND ? GROUP BY COALESCE(ac.tipo, a.tipo)`
    ).all(desde, hasta).forEach((r) => (fila(r.tipo).producido += r.t || 0));
    db.prepare(
      `SELECT COALESCE(ac.tipo, a.tipo) AS tipo, SUM(fi.cantidad * (${KG_DE_PRODUCTO}) * COALESCE(a.porcentaje_carne, 100) / 100.0 * COALESCE(ac.porcentaje, 100) / 100.0) AS t
       FROM factura_items fi JOIN facturas f ON f.id = fi.factura_id JOIN productos p ON p.id = fi.producto_id
       JOIN articulos_stock a ON a.id = p.articulo_stock_id
       LEFT JOIN articulo_carnes ac ON ac.articulo_id = a.id
       WHERE f.estado != 'anulada' AND substr(f.fecha, 1, 10) BETWEEN ? AND ? GROUP BY COALESCE(ac.tipo, a.tipo)`
    ).all(desde, hasta).forEach((r) => (fila(r.tipo).vendido += r.t || 0));
    const lista = [...filas.values()]
      .map((f) => ({ ...f, comprado: redondear2(f.comprado), producido: redondear2(f.producido), vendido: redondear2(f.vendido) }))
      .sort((a, b) => (a.tipo === SIN_TIPO) - (b.tipo === SIN_TIPO) || b.comprado - a.comprado || a.tipo.localeCompare(b.tipo));
    const total = lista.reduce((acc, f) => ({ comprado: acc.comprado + f.comprado, producido: acc.producido + f.producido, vendido: acc.vendido + f.vendido }), { comprado: 0, producido: 0, vendido: 0 });
    return { ok: true, tipos: lista, total: { comprado: redondear2(total.comprado), producido: redondear2(total.producido), vendido: redondear2(total.vendido) } };
  });
  // Qué hay detrás de la fila "Sin tipo" del Rendimiento: los artículos sin tipo de carne que se produjeron o vendieron en el
  // período, con los mismos kilos (solo la parte de carne) que suma esa fila.
  ipcMain.handle('stock:sinTipo', (_event, { desde, hasta } = {}) => {
    if (!FECHA_VALIDA.test(String(desde || '')) || !FECHA_VALIDA.test(String(hasta || ''))) return { ok: false, error: 'El período no es válido.' };
    const sinTipo = "NOT EXISTS (SELECT 1 FROM articulo_carnes ac WHERE ac.articulo_id = a.id) AND (a.tipo IS NULL OR trim(a.tipo) = '')";
    const filas = new Map();
    const fila = (r) => {
      if (!filas.has(r.id)) filas.set(r.id, { id: r.id, nombre: r.nombre, producido: 0, vendido: 0 });
      return filas.get(r.id);
    };
    db.prepare(
      `SELECT a.id, a.nombre, SUM(m.kilos * COALESCE(a.porcentaje_carne, 100) / 100.0) AS t FROM movimientos_stock m JOIN articulos_stock a ON a.id = m.articulo_id
       WHERE m.tipo = 'produccion' AND ${sinTipo} AND substr(m.fecha, 1, 10) BETWEEN ? AND ? GROUP BY a.id`
    ).all(desde, hasta).forEach((r) => (fila(r).producido += r.t || 0));
    db.prepare(
      `SELECT a.id, a.nombre, SUM(fi.cantidad * (${KG_DE_PRODUCTO}) * COALESCE(a.porcentaje_carne, 100) / 100.0) AS t
       FROM factura_items fi JOIN facturas f ON f.id = fi.factura_id JOIN productos p ON p.id = fi.producto_id
       JOIN articulos_stock a ON a.id = p.articulo_stock_id
       WHERE f.estado != 'anulada' AND ${sinTipo} AND substr(f.fecha, 1, 10) BETWEEN ? AND ? GROUP BY a.id`
    ).all(desde, hasta).forEach((r) => (fila(r).vendido += r.t || 0));
    const lista = [...filas.values()]
      .map((f) => ({ ...f, producido: redondear2(f.producido), vendido: redondear2(f.vendido) }))
      .filter((f) => f.producido > 0 || f.vendido > 0)
      .sort((a, b) => b.producido + b.vendido - (a.producido + a.vendido) || a.nombre.localeCompare(b.nombre));
    // Lo comprado "sin tipo" no es de ningún artículo: son líneas de compra sin producto elegido.
    const compradoSinProducto = db
      .prepare(
        `SELECT COALESCE(SUM(ci.kilos), 0) AS t FROM compra_items ci JOIN compras c ON c.id = ci.compra_id
         WHERE ci.unidad = 'kg' AND trim(COALESCE(ci.producto, '')) = '' AND substr(c.fecha, 1, 10) BETWEEN ? AND ?`
      )
      .get(desde, hasta).t;
    return { ok: true, articulos: lista, compradoSinProducto: redondear2(compradoSinProducto) };
  });
  ipcMain.handle('stock:crearArticulo', (_event, nombre) => {
    const texto = String(nombre || '').trim().slice(0, 80);
    if (!texto) return { ok: false, error: 'Poné un nombre para el artículo.' };
    db.prepare('INSERT INTO articulos_stock (nombre) VALUES (?) ON CONFLICT(nombre) DO UPDATE SET activo = 1, nombre = excluded.nombre').run(texto);
    return { ok: true, id: db.prepare('SELECT id FROM articulos_stock WHERE nombre = ?').get(texto).id };
  });
  // Lista de "Tipo de carne" que se elige en Productos → Editar: propia y separada de la de Proveedores
  // (`tipos_producto`, que es para anotar cualquier compra, no solo carne).
  const limpiarTipoCarne = (t) => String(t || '').trim().slice(0, 40);

  ipcMain.handle('stock:tiposCarne', () => {
    return db.prepare('SELECT id, nombre FROM tipos_carne ORDER BY nombre COLLATE NOCASE').all();
  });

  ipcMain.handle('stock:agregarTipoCarne', (_event, nombre) => {
    const texto = limpiarTipoCarne(nombre);
    if (!texto) return { ok: false, error: 'Escribí el nombre del tipo.' };
    db.prepare(
      'INSERT OR IGNORE INTO tipos_carne (nombre, orden) VALUES (?, (SELECT COALESCE(MAX(orden), 0) + 1 FROM tipos_carne))'
    ).run(texto);
    return { ok: true };
  });

  ipcMain.handle('stock:quitarTipoCarne', (_event, id) => {
    db.prepare('DELETE FROM tipos_carne WHERE id = ?').run(Number(id));
    return { ok: true };
  });

  // De qué tipo de carne es esta pila (Vaca/Cerdo/Pollo/Otro, la misma lista de las compras): para más
  // adelante poder comparar cuánto se compró de cada tipo contra cuánto se produjo. Vacío = sin elegir.
  ipcMain.handle('stock:actualizarTipo', (_event, { articulo_id, tipo }) => {
    const articulo = db.prepare('SELECT id FROM articulos_stock WHERE id = ? AND activo = 1').get(Number(articulo_id));
    if (!articulo) return { ok: false, error: 'Ese artículo ya no existe.' };
    const texto = String(tipo || '').trim();
    guardarCarnes(articulo.id, texto ? [{ tipo: texto, porcentaje: 100 }] : []);
    return { ok: true };
  });
  // Qué carnes lleva esta pila y en qué proporción (Vaca 70 %, Cerdo 30 %). Una sola carne = 100 %; con más de una,
  // los porcentajes tienen que sumar 100. Vacío = sin tipo. `tipo` de la pila queda como la carne principal.
  const guardarCarnes = (articuloId, carnes) => {
    db.transaction(() => {
      db.prepare('DELETE FROM articulo_carnes WHERE articulo_id = ?').run(articuloId);
      const insertar = db.prepare('INSERT INTO articulo_carnes (articulo_id, tipo, porcentaje) VALUES (?, ?, ?)');
      carnes.forEach((c) => insertar.run(articuloId, c.tipo, c.porcentaje));
      const principal = [...carnes].sort((a, b) => b.porcentaje - a.porcentaje)[0];
      db.prepare('UPDATE articulos_stock SET tipo = ? WHERE id = ?').run(principal ? principal.tipo : null, articuloId);
    })();
  };
  ipcMain.handle('stock:actualizarCarnes', (_event, { articulo_id, carnes }) => {
    const articulo = db.prepare('SELECT id FROM articulos_stock WHERE id = ? AND activo = 1').get(Number(articulo_id));
    if (!articulo) return { ok: false, error: 'Ese artículo ya no existe.' };
    const limpias = [];
    for (const c of Array.isArray(carnes) ? carnes : []) {
      const tipo = limpiarTipoCarne(c && c.tipo);
      if (!tipo) continue;
      if (limpias.some((x) => x.tipo.toLowerCase() === tipo.toLowerCase())) return { ok: false, error: `${tipo} está repetida.` };
      limpias.push({ tipo, porcentaje: c.porcentaje === undefined || c.porcentaje === '' || c.porcentaje === null ? NaN : Number(c.porcentaje) });
    }
    if (limpias.length === 1 && Number.isNaN(limpias[0].porcentaje)) limpias[0].porcentaje = 100;
    if (limpias.some((c) => !Number.isFinite(c.porcentaje) || c.porcentaje <= 0 || c.porcentaje > 100)) return { ok: false, error: 'Poné el porcentaje de cada carne (entre 1 y 100).' };
    limpias.forEach((c) => (c.porcentaje = redondear2(c.porcentaje)));
    if (limpias.length && Math.abs(limpias.reduce((a, c) => a + c.porcentaje, 0) - 100) > 0.01) return { ok: false, error: 'Los porcentajes de las carnes tienen que sumar 100 %.' };
    guardarCarnes(articulo.id, limpias);
    return { ok: true };
  });
  // Cuánta carne lleva cada kilo de este artículo (1 a 100 %); vacío = 100 % (carne pura). Cuenta para el rendimiento.
  ipcMain.handle('stock:actualizarCarne', (_event, { articulo_id, porcentaje }) => {
    const articulo = db.prepare('SELECT id FROM articulos_stock WHERE id = ? AND activo = 1').get(Number(articulo_id));
    if (!articulo) return { ok: false, error: 'Ese artículo ya no existe.' };
    const texto = String(porcentaje ?? '').trim();
    let valor = null;
    if (texto !== '') {
      valor = Number(texto);
      if (!Number.isFinite(valor) || valor <= 0 || valor > 100) return { ok: false, error: 'El porcentaje de carne tiene que estar entre 1 y 100.' };
      if (valor === 100) valor = null;
    }
    db.prepare('UPDATE articulos_stock SET porcentaje_carne = ? WHERE id = ?').run(valor, articulo.id);
    return { ok: true };
  });
  // Mínimo de kilos de un artículo: por debajo, la campanita avisa. Vacío = sin aviso.
  ipcMain.handle('stock:actualizarMinimo', (_event, { articulo_id, minimo }) => {
    const articulo = db.prepare('SELECT id FROM articulos_stock WHERE id = ? AND activo = 1').get(Number(articulo_id));
    if (!articulo) return { ok: false, error: 'Ese artículo ya no existe.' };
    const texto = String(minimo ?? '').trim();
    let valor = null;
    if (texto !== '') {
      valor = Number(texto.replace(',', '.'));
      if (!Number.isFinite(valor) || valor <= 0) return { ok: false, error: 'El mínimo tiene que ser mayor a cero.' };
    }
    db.prepare('UPDATE articulos_stock SET minimo = ? WHERE id = ?').run(valor, articulo.id);
    return { ok: true };
  });
  ipcMain.handle('stock:quitarArticulo', (_event, id) => {
    db.transaction(() => {
      db.prepare('UPDATE articulos_stock SET activo = 0 WHERE id = ?').run(Number(id));
      db.prepare('UPDATE productos SET articulo_stock_id = NULL, kg_por_unidad = NULL WHERE articulo_stock_id = ?').run(Number(id));
    })();
    return { ok: true };
  });
  // Cada producto lleva su propio stock. Con `de_producto_id` comparte el de otro producto (la hamburguesa suelta sale del
  // stock de la caja): en los dos casos se dice cuántos kilos pesa cada unidad. Un producto por unidad sin peso no lleva stock.
  ipcMain.handle('stock:vincular', (_event, { producto_id, de_producto_id, kg_por_unidad }) => {
    const producto = db.prepare('SELECT id, nombre, unidad FROM productos WHERE id = ?').get(Number(producto_id));
    if (!producto) return { ok: false, error: 'Ese producto ya no existe.' };
    const kg = producto.unidad === 'kg' ? 1 : Number(kg_por_unidad);
    const pesoValido = Number.isFinite(kg) && kg > 0;
    if (!de_producto_id) {
      if (!pesoValido) {
        db.prepare('UPDATE productos SET articulo_stock_id = NULL, kg_por_unidad = NULL, stock_de_producto_id = NULL WHERE id = ?').run(producto.id);
        return { ok: true };
      }
      db.prepare('UPDATE productos SET articulo_stock_id = ?, kg_por_unidad = ?, stock_de_producto_id = NULL WHERE id = ?').run(pilaDeProducto(producto.nombre), kg, producto.id);
      return { ok: true };
    }
    if (Number(de_producto_id) === producto.id) return { ok: false, error: 'Un producto no puede compartir el stock consigo mismo.' };
    const base = db.prepare('SELECT id, nombre, articulo_stock_id FROM productos WHERE id = ? AND activo = 1').get(Number(de_producto_id));
    if (!base) return { ok: false, error: 'Ese producto ya no existe.' };
    if (!pesoValido) return { ok: false, error: 'Poné cuánto pesa cada unidad.' };
    const pila = base.articulo_stock_id || pilaDeProducto(base.nombre);
    if (!base.articulo_stock_id) db.prepare('UPDATE productos SET articulo_stock_id = ? WHERE id = ?').run(pila, base.id);
    db.prepare('UPDATE productos SET articulo_stock_id = ?, kg_por_unidad = ?, stock_de_producto_id = ? WHERE id = ?').run(pila, kg, base.id, producto.id);
    return { ok: true };
  });
  ipcMain.handle('stock:producir', (_event, { fecha, articulo_id, kilos, cajas, kg_por_caja, nota }) => {
    if (!FECHA_VALIDA.test(String(fecha || ''))) return { ok: false, error: 'La fecha no es válida.' };
    const articulo = db.prepare('SELECT id, kg_por_caja FROM articulos_stock WHERE id = ? AND activo = 1').get(Number(articulo_id));
    if (!articulo) return { ok: false, error: 'Elegí qué se produjo.' };
    let k = Number(kilos);
    let notaFinal = String(nota || '').trim().slice(0, 200) || null;
    if (cajas !== undefined && cajas !== null && cajas !== '') {
      const c = Number(cajas);
      if (!Number.isFinite(c) || c <= 0) return { ok: false, error: 'Poné cuántas cajas salieron.' };
      const peso = Number(kg_por_caja) || articulo.kg_por_caja || (resumenDeStock().articulos.find((x) => x.id === articulo.id) || {}).kg_por_caja;
      if (!Number.isFinite(peso) || peso <= 0) return { ok: false, error: 'Poné cuánto pesa cada caja.' };
      if (Number(kg_por_caja) > 0) db.prepare('UPDATE articulos_stock SET kg_por_caja = ? WHERE id = ?').run(Number(kg_por_caja), articulo.id);
      k = c * peso;
      if (!notaFinal) notaFinal = `${c} ${c === 1 ? 'caja' : 'cajas'}`;
    } else if (!Number.isFinite(k) || k <= 0) {
      return { ok: false, error: 'Poné los kilos producidos.' };
    }
    db.prepare("INSERT INTO movimientos_stock (articulo_id, fecha, tipo, kilos, nota) VALUES (?, ?, 'produccion', ?, ?)").run(articulo.id, fecha, Math.round(k * 1000) / 1000, notaFinal);
    return { ok: true };
  });
  // Conteo real: el stock pasa a ser el que se contó y la diferencia queda anotada como un ajuste. Si el
  // artículo ya se había contado hoy, se corrige ese mismo ajuste (se actualiza) en vez de sumar uno nuevo:
  // así un conteo repetido el mismo día (por las dudas, o porque se confundió) no deja varios renglones sueltos.
  ipcMain.handle('stock:ajustar', (_event, { articulo_id, kilos_reales, nota }) => {
    const real = Number(kilos_reales);
    if (!Number.isFinite(real) || real < 0) return { ok: false, error: 'Poné cuántos kilos hay realmente.' };
    const fila = resumenDeStock().articulos.find((a) => a.id === Number(articulo_id));
    if (!fila) return { ok: false, error: 'Ese artículo ya no existe.' };
    const hoy = db.prepare("SELECT date('now', 'localtime') AS hoy").get().hoy;
    const deHoy = db.prepare("SELECT id, kilos FROM movimientos_stock WHERE articulo_id = ? AND tipo = 'ajuste' AND fecha = ?").get(fila.id, hoy);
    const stockSinAjusteDeHoy = fila.stock - (deHoy ? deHoy.kilos : 0);
    const diferencia = Math.round((real - stockSinAjusteDeHoy) * 1000) / 1000;
    const notaFinal = String(nota || '').trim().slice(0, 200) || 'Conteo';
    if (diferencia === 0) {
      if (deHoy) db.prepare('DELETE FROM movimientos_stock WHERE id = ?').run(deHoy.id);
      return { ok: true };
    }
    if (deHoy) {
      db.prepare("UPDATE movimientos_stock SET kilos = ?, nota = ? WHERE id = ?").run(diferencia, notaFinal, deHoy.id);
    } else {
      db.prepare("INSERT INTO movimientos_stock (articulo_id, fecha, tipo, kilos, nota) VALUES (?, ?, 'ajuste', ?, ?)").run(fila.id, hoy, diferencia, notaFinal);
    }
    return { ok: true };
  });
  // Movimientos de stock (producción y ajustes), del más nuevo al más viejo; `desde` / `hasta` (opcionales) acotan por día.
  ipcMain.handle('stock:movimientos', (_event, { limite, desde, hasta } = {}) =>
    db
      .prepare(
        `SELECT m.id, m.fecha, m.tipo, m.kilos, m.nota, a.nombre AS articulo
         FROM movimientos_stock m JOIN articulos_stock a ON a.id = m.articulo_id
         WHERE substr(m.fecha, 1, 10) >= ? AND substr(m.fecha, 1, 10) <= ? ORDER BY m.fecha DESC, m.id DESC LIMIT ?`
      )
      .all(FECHA_VALIDA.test(String(desde || '')) ? desde : '0000-00-00', FECHA_VALIDA.test(String(hasta || '')) ? hasta : '9999-12-31', Math.min(Number(limite) || 60, 500))
  );
  // Kilos producidos de cada artículo en un período (solo Producción, sin ajustes), de más a menos.
  ipcMain.handle('stock:producidoPorArticulo', (_event, { desde, hasta } = {}) => {
    if (!FECHA_VALIDA.test(String(desde || '')) || !FECHA_VALIDA.test(String(hasta || ''))) return { ok: false, error: 'El período no es válido.' };
    const filas = db
      .prepare(
        `SELECT a.id, a.nombre, SUM(m.kilos) AS kilos, COUNT(*) AS tandas, MAX(substr(m.fecha, 1, 10)) AS ultima FROM movimientos_stock m JOIN articulos_stock a ON a.id = m.articulo_id
         WHERE m.tipo = 'produccion' AND substr(m.fecha, 1, 10) BETWEEN ? AND ? GROUP BY a.id`
      )
      .all(desde, hasta)
      .map((f) => ({ ...f, kilos: redondear2(f.kilos), promedio: redondear2(f.kilos / f.tandas) }))
      .sort((a, b) => b.kilos - a.kilos || a.nombre.localeCompare(b.nombre));
    return { ok: true, filas, total: redondear2(filas.reduce((acc, f) => acc + f.kilos, 0)), tandas: filas.reduce((acc, f) => acc + f.tandas, 0) };
  });
  ipcMain.handle('stock:quitarMovimiento', (_event, id) => {
    db.prepare('DELETE FROM movimientos_stock WHERE id = ?').run(Number(id));
    return { ok: true };
  });
}

module.exports = { registrar };
