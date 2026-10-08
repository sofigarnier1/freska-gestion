// Tests de stock: lo que hay = producción + ajustes − lo facturado desde `stock_desde` (las anuladas no cuentan), con
// productos por kilo, por caja, que comparten pila, pedidos pendientes y el rendimiento por tipo de carne.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, limpiarDatos, crearCliente, crearProducto } = require('./harness');

let db;
let invocar;
test.before(async () => {
  ({ db, invocar } = await iniciar());
});
test.beforeEach(() => {
  limpiarDatos(db);
  db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('stock_desde', '2000-01-01') ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor").run();
});

const hoy = () => db.prepare("SELECT date('now', 'localtime') d").get().d;
const facturar = (cliente_id, items) => invocar('facturas:crear', { cliente_id, tipo_precio: 'cliente', items });
const pila = async (nombre) => (await invocar('stock:resumen')).articulos.find((a) => a.nombre === nombre);
const producir = (articulo_id, kilos, extra = {}) => invocar('stock:producir', { fecha: hoy(), articulo_id, kilos, ...extra });
// Las pilas de los productos por kilo se crean al pedir el resumen (como hace la pantalla de Stock).
const idPila = async (nombre) => {
  await invocar('stock:resumen');
  return db.prepare('SELECT id FROM articulos_stock WHERE nombre = ?').get(nombre).id;
};

test('un producto por kilo lleva su propia pila: la producción suma y lo facturado resta', async () => {
  const c = crearCliente(db, 'Ana');
  const p = crearProducto(db, { nombre: 'Asado', unidad: 'kg' });
  const f = await facturar(c, [{ producto_id: p, cantidad: 10 }]);
  assert.equal((await pila('Asado')).stock, -10, 'sin producción, lo vendido deja el stock en negativo');
  await producir(await idPila('Asado'), 50);
  assert.equal((await pila('Asado')).stock, 40);
  await invocar('facturas:anular', { id: f.id, motivo: 'Error' });
  assert.equal((await pila('Asado')).stock, 50, 'una factura anulada no descuenta');
});

test('un producto por caja descuenta los kilos de la caja y muestra cuántas cajas hay', async () => {
  const c = crearCliente(db, 'Beto');
  const caja = crearProducto(db, { nombre: 'Hamburguesas (x32)', unidad: 'unidad' });
  assert.equal((await invocar('stock:vincular', { producto_id: caja, kg_por_unidad: 2.46 })).ok, true);
  const art = await idPila('Hamburguesas');
  await producir(art, 24.6);
  await facturar(c, [{ producto_id: caja, cantidad: 3 }]);
  const a = await pila('Hamburguesas');
  assert.equal(a.stock, 17.22); // 24,6 − 3 × 2,46
  assert.equal(a.cajas, 7);
  const prod = (await invocar('stock:resumen')).productos.find((x) => x.id === caja);
  assert.equal(prod.hay, 7);
});

test('un producto suelto comparte la pila de la caja: cada unidad resta su peso', async () => {
  const c = crearCliente(db, 'Carla');
  const caja = crearProducto(db, { nombre: 'Hamburguesas (x32)', unidad: 'unidad' });
  const suelta = crearProducto(db, { nombre: 'Hamburguesa suelta', unidad: 'unidad' });
  await invocar('stock:vincular', { producto_id: caja, kg_por_unidad: 2.5 });
  await invocar('stock:vincular', { producto_id: suelta, de_producto_id: caja, kg_por_unidad: 0.08 });
  await producir(await idPila('Hamburguesas'), 10);
  await facturar(c, [{ producto_id: suelta, cantidad: 10 }]);
  assert.equal((await pila('Hamburguesas')).stock, 9.2);
  assert.equal((await invocar('stock:vincular', { producto_id: suelta, de_producto_id: suelta, kg_por_unidad: 1 })).ok, false, 'no puede compartir consigo mismo');
});

test('solo cuenta lo facturado desde `stock_desde`', async () => {
  const c = crearCliente(db, 'Dani');
  const p = crearProducto(db, { nombre: 'Pollo', unidad: 'kg' });
  const f = await facturar(c, [{ producto_id: p, cantidad: 8 }]);
  db.prepare("UPDATE facturas SET fecha = datetime('now', 'localtime', '-10 days') WHERE id = ?").run(f.id);
  db.prepare("UPDATE configuracion SET valor = date('now', 'localtime', '-5 days') WHERE clave = 'stock_desde'").run();
  await producir(await idPila('Pollo'), 20);
  assert.equal((await pila('Pollo')).stock, 20, 'la factura de hace 10 días es anterior al inicio del stock');
  await facturar(c, [{ producto_id: p, cantidad: 5 }]);
  assert.equal((await pila('Pollo')).stock, 15);
});

test('producir por cajas multiplica por el peso de la caja y valida los datos', async () => {
  const p = crearProducto(db, { nombre: 'Milanesas', unidad: 'kg' });
  await invocar('stock:resumen');
  const art = await idPila('Milanesas');
  assert.equal((await invocar('stock:producir', { fecha: 'ayer', articulo_id: art, kilos: 5 })).ok, false, 'fecha inválida');
  assert.equal((await producir(art, 0)).ok, false, 'kilos en cero');
  assert.equal((await producir(art, -3)).ok, false, 'kilos negativos');
  assert.equal((await producir(art, null, { cajas: 4 })).ok, false, 'sin peso de caja no se sabe cuántos kilos son');
  assert.equal((await producir(art, null, { cajas: 4, kg_por_caja: 12.5 })).ok, true);
  assert.equal((await pila('Milanesas')).stock, 50);
  assert.ok(p);
});

test('ajustar por conteo deja el stock en lo contado y anota la diferencia', async () => {
  const c = crearCliente(db, 'Eva');
  const p = crearProducto(db, { nombre: 'Chorizo', unidad: 'kg' });
  await facturar(c, [{ producto_id: p, cantidad: 4 }]);
  await producir(await idPila('Chorizo'), 30);
  assert.equal((await pila('Chorizo')).stock, 26);
  await invocar('stock:ajustar', { articulo_id: await idPila('Chorizo'), kilos_reales: 24.5, nota: 'Se cayó una bolsa' });
  assert.equal((await pila('Chorizo')).stock, 24.5);
  const ajuste = db.prepare("SELECT * FROM movimientos_stock WHERE tipo = 'ajuste'").get();
  assert.equal(ajuste.kilos, -1.5);
  await invocar('stock:ajustar', { articulo_id: await idPila('Chorizo'), kilos_reales: 24.5 });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM movimientos_stock WHERE tipo = 'ajuste'").get().n, 1, 'si no hay diferencia no se anota nada');
  assert.equal((await invocar('stock:ajustar', { articulo_id: await idPila('Chorizo'), kilos_reales: -2 })).ok, false);
});

test('ajustar dos veces el mismo artículo el mismo día corrige el mismo renglón, no suma otro', async () => {
  crearProducto(db, { nombre: 'Milanesas', unidad: 'kg' });
  const art = await idPila('Milanesas');
  await producir(art, 20);
  assert.equal((await pila('Milanesas')).stock, 20);

  await invocar('stock:ajustar', { articulo_id: art, kilos_reales: 18 });
  assert.equal((await pila('Milanesas')).stock, 18);
  let resumen = await invocar('stock:resumen');
  assert.equal(resumen.articulos.find((a) => a.id === art).ajusteHoy?.nota, 'Conteo');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM movimientos_stock WHERE tipo = 'ajuste' AND articulo_id = ?").get(art).n, 1);

  // Se confundió: el conteo real era otro. Ajusta de nuevo el mismo día.
  await invocar('stock:ajustar', { articulo_id: art, kilos_reales: 21, nota: 'Me había confundido' });
  assert.equal((await pila('Milanesas')).stock, 21, 'el segundo conteo del día manda, no se suman los dos');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM movimientos_stock WHERE tipo = 'ajuste' AND articulo_id = ?").get(art).n, 1, 'sigue siendo un solo renglón');
  const ajuste = db.prepare("SELECT kilos, nota FROM movimientos_stock WHERE tipo = 'ajuste' AND articulo_id = ?").get(art);
  assert.equal(ajuste.kilos, 1);
  assert.equal(ajuste.nota, 'Me había confundido');

  // Si el tercer conteo del día coincide con lo que ya había antes de ajustar hoy, el renglón se borra.
  await invocar('stock:ajustar', { articulo_id: art, kilos_reales: 20 });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM movimientos_stock WHERE tipo = 'ajuste' AND articulo_id = ?").get(art).n, 0);
  resumen = await invocar('stock:resumen');
  assert.equal(resumen.articulos.find((a) => a.id === art).ajusteHoy, null);
});

test('los pedidos pendientes bajan lo disponible pero no el stock', async () => {
  const c = crearCliente(db, 'Fede');
  const p = crearProducto(db, { nombre: 'Lomo', unidad: 'kg' });
  await invocar('stock:resumen');
  await producir(await idPila('Lomo'), 20);
  const pedido = Number(db.prepare('INSERT INTO pedidos (cliente_id) VALUES (?)').run(c).lastInsertRowid);
  db.prepare('INSERT INTO pedido_items (pedido_id, producto_id, cantidad) VALUES (?, ?, 6)').run(pedido, p);
  const a = await pila('Lomo');
  assert.equal(a.stock, 20);
  assert.equal(a.pendiente, 6);
  assert.equal(a.disponible, 14);
});

test('el rendimiento compara kilos comprados, producidos y vendidos por tipo, contando solo la carne', async () => {
  const c = crearCliente(db, 'Gus');
  const milanesa = crearProducto(db, { nombre: 'Milanesa', unidad: 'kg' });
  const prov = Number(db.prepare("INSERT INTO proveedores (nombre) VALUES ('Frigorífico')").run().lastInsertRowid);
  const compra = Number(db.prepare('INSERT INTO compras (proveedor_id, fecha, total) VALUES (?, ?, 1000)').run(prov, hoy()).lastInsertRowid);
  db.prepare("INSERT INTO compra_items (compra_id, producto, descripcion, kilos, importe) VALUES (?, 'Vaca', 'Nalga', 100, 1000)").run(compra);
  db.prepare("INSERT INTO compra_items (compra_id, producto, descripcion, kilos, importe) VALUES (?, '', 'Varios', 10, 100)").run(compra);
  await invocar('stock:resumen');
  const art = await idPila('Milanesa');
  assert.equal((await invocar('stock:actualizarTipo', { articulo_id: art, tipo: 'Vaca' })).ok, true);
  assert.equal((await invocar('stock:actualizarCarne', { articulo_id: art, porcentaje: 70 })).ok, true);
  assert.equal((await invocar('stock:actualizarCarne', { articulo_id: art, porcentaje: 150 })).ok, false, 'más de 100 % no vale');
  await producir(art, 100); // 100 kg de milanesa = 70 kg de carne
  await facturar(c, [{ producto_id: milanesa, cantidad: 40 }]); // 40 kg vendidos = 28 kg de carne
  const r = await invocar('stock:rendimiento', { desde: '2000-01-01', hasta: '2999-12-31' });
  assert.equal(r.ok, true);
  const vaca = r.tipos.find((t) => t.tipo === 'Vaca');
  assert.deepEqual([vaca.comprado, vaca.producido, vaca.vendido], [100, 70, 28]);
  assert.equal(r.tipos.find((t) => t.tipo === 'Sin tipo').comprado, 10, 'lo que no tiene tipo va en "Sin tipo"');
  assert.equal((await invocar('stock:rendimiento', { desde: 'x', hasta: 'y' })).ok, false);
});

test('el número de comprobante de una compra se guarda y se puede editar', async () => {
  const prov = Number(db.prepare("INSERT INTO proveedores (nombre) VALUES ('Frigorífico Sur')").run().lastInsertRowid);
  const items = [{ producto: 'Nalga', tipo: 'Vaca', kilos: 10, precio_kg: 5000, importe: 50000 }];
  const r = await invocar('proveedores:crearCompra', { proveedor_id: prov, fecha: hoy(), items, comprobante: '0001-00012345' });
  assert.equal(r.ok, true);
  const compra = db.prepare('SELECT * FROM compras WHERE proveedor_id = ?').get(prov);
  assert.equal(compra.comprobante, '0001-00012345');
  const r2 = await invocar('proveedores:actualizarCompra', { id: compra.id, fecha: hoy(), items, comprobante: '' });
  assert.equal(r2.ok, true);
  assert.equal(db.prepare('SELECT comprobante FROM compras WHERE id = ?').get(compra.id).comprobante, null, 'vacío se guarda como null, no como texto vacío');
});

test('un producto con dos carnes reparte lo producido y vendido según el porcentaje de cada una', async () => {
  const c = crearCliente(db, 'Gus');
  const chorizo = crearProducto(db, { nombre: 'Chorizo fresco', unidad: 'kg' });
  await invocar('stock:resumen');
  const art = await idPila('Chorizo fresco');
  const carnes = (lista) => invocar('stock:actualizarCarnes', { articulo_id: art, carnes: lista });
  assert.equal((await carnes([{ tipo: 'Vaca', porcentaje: 70 }, { tipo: 'Cerdo', porcentaje: 20 }])).ok, false, 'tienen que sumar 100');
  assert.equal((await carnes([{ tipo: 'Vaca', porcentaje: 70 }, { tipo: 'vaca', porcentaje: 30 }])).ok, false, 'sin repetir');
  assert.equal((await carnes([{ tipo: 'Vaca', porcentaje: 70 }, { tipo: 'Cerdo' }])).ok, false, 'cada una lleva su porcentaje');
  assert.equal((await carnes([{ tipo: 'Vaca', porcentaje: 70 }, { tipo: 'Cerdo', porcentaje: 30 }])).ok, true);
  const guardado = (await invocar('stock:resumen')).articulos.find((a) => a.id === art);
  assert.deepEqual(guardado.carnes, [{ tipo: 'Vaca', porcentaje: 70 }, { tipo: 'Cerdo', porcentaje: 30 }]);
  assert.equal(guardado.tipo, 'Vaca', 'el tipo de la pila es la carne principal');
  await invocar('stock:actualizarCarne', { articulo_id: art, porcentaje: 80 }); // el 80 % del chorizo es carne
  await producir(art, 100); // 80 kg de carne: 56 de vaca y 24 de cerdo
  await facturar(c, [{ producto_id: chorizo, cantidad: 50 }]); // 40 kg de carne: 28 y 12
  const r = await invocar('stock:rendimiento', { desde: '2000-01-01', hasta: '2999-12-31' });
  const fila = (t) => r.tipos.find((x) => x.tipo === t);
  assert.deepEqual([fila('Vaca').producido, fila('Vaca').vendido], [56, 28]);
  assert.deepEqual([fila('Cerdo').producido, fila('Cerdo').vendido], [24, 12]);
  assert.equal(r.total.producido, 80, 'el total no se duplica');
  assert.equal((await carnes([])).ok, true, 'se puede dejar sin tipo');
  assert.deepEqual((await invocar('stock:resumen')).articulos.find((a) => a.id === art).carnes, []);
  assert.equal((await invocar('stock:actualizarTipo', { articulo_id: art, tipo: 'Pollo' })).ok, true, 'el viejo "un solo tipo" sigue andando');
  assert.deepEqual((await invocar('stock:resumen')).articulos.find((a) => a.id === art).carnes, [{ tipo: 'Pollo', porcentaje: 100 }]);
});

test('producido por artículo y movimientos se acotan por período, y los ajustes no cuentan como producción', async () => {
  crearProducto(db, { nombre: 'Chorizo seco', unidad: 'kg' });
  crearProducto(db, { nombre: 'Hamburguesa', unidad: 'kg' });
  await invocar('stock:resumen');
  const seco = await idPila('Chorizo seco');
  const hamb = await idPila('Hamburguesa');
  const mov = (articulo, fecha, tipo, kilos) => db.prepare('INSERT INTO movimientos_stock (articulo_id, fecha, tipo, kilos) VALUES (?, ?, ?, ?)').run(articulo, fecha, tipo, kilos);
  mov(seco, '2026-09-10', 'produccion', 20);
  mov(seco, '2026-09-20', 'produccion', 5);
  mov(hamb, '2026-09-15', 'produccion', 30);
  mov(hamb, '2026-09-16', 'ajuste', -4);
  mov(seco, '2026-10-02', 'produccion', 8);
  const sept = await invocar('stock:producidoPorArticulo', { desde: '2026-09-01', hasta: '2026-09-30' });
  assert.deepEqual(sept.filas.map((f) => [f.nombre, f.kilos]), [['Hamburguesa', 30], ['Chorizo seco', 25]], 'de más a menos, sin el ajuste');
  assert.equal(sept.total, 55);
  assert.deepEqual(sept.filas.map((f) => [f.tandas, f.promedio, f.ultima]), [[1, 30, '2026-09-15'], [2, 12.5, '2026-09-20']]);
  assert.equal(sept.tandas, 3);
  assert.equal((await invocar('stock:producidoPorArticulo', { desde: '2026-11-01', hasta: '2026-11-30' })).filas.length, 0);
  assert.equal((await invocar('stock:producidoPorArticulo', { desde: 'x', hasta: 'y' })).ok, false);
  assert.equal((await invocar('stock:movimientos', { desde: '2026-09-01', hasta: '2026-09-30' })).length, 4, 'los movimientos de septiembre, con el ajuste');
  assert.equal((await invocar('stock:movimientos', {})).length, 5, 'sin fechas, todos');
});

test('"Sin tipo" del rendimiento lista los artículos sin tipo de carne con los mismos kilos que suma esa fila', async () => {
  const c = crearCliente(db, 'Gus');
  const sinTipo = crearProducto(db, { nombre: 'Salchicha', unidad: 'kg' });
  const conTipo = crearProducto(db, { nombre: 'Bife', unidad: 'kg' });
  await invocar('stock:resumen');
  const a1 = await idPila('Salchicha');
  const a2 = await idPila('Bife');
  await invocar('stock:actualizarCarnes', { articulo_id: a2, carnes: [{ tipo: 'Vaca', porcentaje: 100 }] });
  await invocar('stock:actualizarCarne', { articulo_id: a1, porcentaje: 50 });
  await producir(a1, 40); // 20 kg de carne
  await producir(a2, 10);
  await facturar(c, [{ producto_id: sinTipo, cantidad: 10 }, { producto_id: conTipo, cantidad: 5 }]); // 5 kg de carne sin tipo
  const periodo = { desde: '2000-01-01', hasta: '2999-12-31' };
  const r = await invocar('stock:sinTipo', periodo);
  assert.deepEqual(r.articulos.map((a) => [a.nombre, a.producido, a.vendido]), [['Salchicha', 20, 5]], 'solo el artículo sin tipo');
  const fila = (await invocar('stock:rendimiento', periodo)).tipos.find((t) => t.tipo === 'Sin tipo');
  assert.deepEqual([fila.producido, fila.vendido], [20, 5], 'coincide con la fila del rendimiento');
  assert.equal((await invocar('stock:sinTipo', { desde: 'x', hasta: 'y' })).ok, false);
});
