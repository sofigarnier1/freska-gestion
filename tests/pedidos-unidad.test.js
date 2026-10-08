// Pedir por unidad un producto que se vende por kilo (el chorizo seco: "6 chorizos", se pesan al facturar).
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
  db.prepare('DELETE FROM pedidos').run();
});

const hoy = () => db.prepare("SELECT date('now', 'localtime') AS d").get().d;
const chorizo = (extra = {}) => {
  const id = crearProducto(db, { nombre: 'Chorizo seco', precio: 9000, unidad: 'kg' });
  db.prepare('UPDATE productos SET pedible_por_unidad = ?, peso_unidad_pedido = ? WHERE id = ?').run(extra.pedible === 0 ? 0 : 1, extra.peso === undefined ? 0.2 : extra.peso, id);
  return id;
};
const itemsDe = (pedidoId) => db.prepare('SELECT producto_id, cantidad, unidad_pedido FROM pedido_items WHERE pedido_id = ? ORDER BY id').all(pedidoId);

test('un producto por kilo que se puede pedir por unidad guarda "6 u." y el resumen lo dice', async () => {
  const c = crearCliente(db, 'Alma');
  const p = chorizo();
  const r = await invocar('pedidos:crear', { cliente_id: c, items: [{ producto_id: p, cantidad: 6, unidad_pedido: 'unidad' }] });
  assert.deepEqual(itemsDe(r.id), [{ producto_id: p, cantidad: 6, unidad_pedido: 'unidad' }]);
  const lista = await invocar('pedidos:listar');
  assert.equal(lista[0].resumen, '6u. Chorizo seco');
  const items = await invocar('pedidos:items', r.id);
  assert.equal(items[0].unidad_pedido, 'unidad');
  assert.equal(items[0].peso_unidad_pedido, 0.2);
});

test('si el producto no se puede pedir por unidad, el pedido sigue siendo en kilos', async () => {
  const c = crearCliente(db, 'Alma');
  const p = chorizo({ pedible: 0 });
  const r = await invocar('pedidos:crear', { cliente_id: c, items: [{ producto_id: p, cantidad: 2, unidad_pedido: 'unidad' }] });
  assert.equal(itemsDe(r.id)[0].unidad_pedido, null);
  assert.equal((await invocar('pedidos:listar'))[0].resumen, '2kg Chorizo seco');
});

test('Pedidos de hoy separa lo pedido en kilos de lo pedido por unidad', async () => {
  const c = crearCliente(db, 'Alma');
  const p = chorizo();
  await invocar('pedidos:crear', { cliente_id: c, items: [{ producto_id: p, cantidad: 2, unidad_pedido: null }, { producto_id: p, cantidad: 6, unidad_pedido: 'unidad' }] });
  await invocar('pedidos:crear', { cliente_id: crearCliente(db, 'Bruno'), items: [{ producto_id: p, cantidad: 4, unidad_pedido: 'unidad' }] });
  const filas = (await invocar('reportes:cantidadesPedidasPorDia')).filter((f) => f.periodo === hoy());
  const kg = filas.find((f) => f.producto_unidad === 'kg');
  const u = filas.find((f) => f.producto_unidad === 'unidad');
  assert.equal(kg.total, 2);
  assert.equal(u.total, 10);
  assert.equal(u.unidad_base, 'kg');
  assert.equal(u.peso_unidad_pedido, 0.2);
});

test('al facturar el pedido, lo pedido por unidad se conserva y lo facturado en kilos queda en la factura', async () => {
  const c = crearCliente(db, 'Alma');
  const p = chorizo();
  const otro = crearProducto(db, { nombre: 'Asado', precio: 8000, unidad: 'kg' });
  const r = await invocar('pedidos:crear', { cliente_id: c, items: [{ producto_id: p, cantidad: 6, unidad_pedido: 'unidad' }, { producto_id: otro, cantidad: 3 }] });
  const factura = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 1.3 }, { producto_id: otro, cantidad: 3.1 }] });
  await invocar('pedidos:marcarFacturado', { id: r.id, factura_id: factura.id, items: [{ producto_id: p, cantidad: 1.3 }, { producto_id: otro, cantidad: 3.1 }] });
  const items = itemsDe(r.id);
  assert.deepEqual(items.find((i) => i.producto_id === p), { producto_id: p, cantidad: 6, unidad_pedido: 'unidad' }, 'sigue diciendo 6 u.');
  assert.equal(items.filter((i) => i.producto_id === p).length, 1, 'no se pisa con los kilos');
  assert.deepEqual(items.find((i) => i.producto_id === otro), { producto_id: otro, cantidad: 3.1, unidad_pedido: null }, 'lo pedido en kilos sí toma lo facturado');
  // y la factura tiene los kilos pesados
  assert.equal(db.prepare('SELECT cantidad FROM factura_items WHERE factura_id = ? AND producto_id = ?').get(factura.id, p).cantidad, 1.3);
});

test('editar un pedido conserva si una línea es por unidad', async () => {
  const c = crearCliente(db, 'Alma');
  const p = chorizo();
  const r = await invocar('pedidos:crear', { cliente_id: c, items: [{ producto_id: p, cantidad: 6, unidad_pedido: 'unidad' }] });
  await invocar('pedidos:actualizar', { id: r.id, items: [{ producto_id: p, cantidad: 8, unidad_pedido: 'unidad' }] });
  assert.deepEqual(itemsDe(r.id), [{ producto_id: p, cantidad: 8, unidad_pedido: 'unidad' }]);
});

test('la lista de carga separa lo pendiente en kilos de lo pendiente por unidad', async () => {
  const c = crearCliente(db, 'Alma');
  const p = chorizo();
  await invocar('pedidos:crear', { cliente_id: c, items: [{ producto_id: p, cantidad: 2 }, { producto_id: p, cantidad: 6, unidad_pedido: 'unidad' }] });
  const prod = (await invocar('carga:hoy')).productos.find((x) => x.producto_id === p);
  assert.equal(prod.pendiente.cantidad, 2);
  assert.equal(prod.pendiente.unidades, 6);
  assert.equal(prod.pendiente.peso_unidad, 0.2);
});

test('el stock cuenta lo pendiente por unidad como esas unidades por su peso, no como kilos', async () => {
  const c = crearCliente(db, 'Alma');
  const p = chorizo();
  await invocar('pedidos:crear', { cliente_id: c, items: [{ producto_id: p, cantidad: 6, unidad_pedido: 'unidad' }, { producto_id: p, cantidad: 2 }] });
  const stock = await invocar('stock:resumen');
  const fila = (stock.articulos || stock.productos || []).find((x) => /chorizo seco/i.test(x.nombre));
  assert.ok(fila, 'el chorizo seco está en el stock');
  assert.equal(fila.pendiente, 3.2, '2 kg + 6 u. × 0,2 kg');
});

test('productos: se puede pedir por unidad solo si se vende por kilo, y el peso tiene que ser válido', async () => {
  const base = { nombre: 'Chorizo seco', codigo: 'CH1', precio_cliente: 100, precio_cf: 100, unidad: 'kg' };
  const ok = await invocar('productos:crear', { ...base, pedible_por_unidad: 1, peso_unidad_pedido: 0.2 });
  assert.equal(ok.ok, true);
  assert.equal(ok.producto.pedible_por_unidad, 1);
  assert.equal(ok.producto.peso_unidad_pedido, 0.2);
  const mal = await invocar('productos:actualizar', { id: ok.producto.id, ...base, pedible_por_unidad: 1, peso_unidad_pedido: -3 });
  assert.equal(mal.ok, false);
  // un producto por unidad no puede ser "pedible por unidad": no tiene sentido
  const hamb = await invocar('productos:crear', { nombre: 'Hamburguesas', codigo: 'HA1', precio_cliente: 1, precio_cf: 1, unidad: 'unidad', pedible_por_unidad: 1, peso_unidad_pedido: 0.1 });
  assert.equal(hamb.producto.pedible_por_unidad, 0);
  assert.equal(hamb.producto.peso_unidad_pedido, null);
  // sacar la casilla borra el peso
  const sin = await invocar('productos:actualizar', { id: ok.producto.id, ...base, pedible_por_unidad: 0, peso_unidad_pedido: 0.2 });
  assert.equal(sin.producto.pedible_por_unidad, 0);
  assert.equal(sin.producto.peso_unidad_pedido, null);
});

test('si el mismo pedido tiene kilos y unidades del mismo producto, al facturar se conservan las dos líneas pedidas', async () => {
  const c = crearCliente(db, 'Alma');
  const p = chorizo();
  const r = await invocar('pedidos:crear', { cliente_id: c, items: [{ producto_id: p, cantidad: 2 }, { producto_id: p, cantidad: 6, unidad_pedido: 'unidad' }] });
  const factura = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 1.3 }, { producto_id: p, cantidad: 2.1 }] });
  await invocar('pedidos:marcarFacturado', { id: r.id, factura_id: factura.id, items: [{ producto_id: p, cantidad: 1.3 }, { producto_id: p, cantidad: 2.1 }] });
  assert.deepEqual(itemsDe(r.id), [{ producto_id: p, cantidad: 2, unidad_pedido: null }, { producto_id: p, cantidad: 6, unidad_pedido: 'unidad' }]);
});

test('la factura guarda cuántas unidades pidieron de una línea pesada, y las lecturas lo devuelven', async () => {
  const c = crearCliente(db, 'Alma');
  const p = chorizo();
  const factura = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 1.1, pedido_unidades: 5 }] });
  const items = await invocar('facturas:items', factura.id);
  assert.equal(items[0].pedido_unidades, 5);
  // un producto por unidad no lleva ese dato aunque lo manden
  const hamb = crearProducto(db, { nombre: 'Hamburguesas', precio: 100, unidad: 'unidad' });
  const f2 = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: hamb, cantidad: 2, pedido_unidades: 9 }] });
  assert.equal((await invocar('facturas:items', f2.id))[0].pedido_unidades, null);
});

test('productos:listar propone la unidad de la última vez: "unidad" si nunca se pidió, o lo último que se usó', async () => {
  const c = crearCliente(db, 'Alma');
  const p = chorizo();
  const ultima = async () => (await invocar('productos:listar')).find((x) => x.id === p).ultima_unidad_pedido;
  assert.equal(await ultima(), null, 'nunca se pidió: el cliente propone "unidad"');
  await invocar('pedidos:crear', { cliente_id: c, items: [{ producto_id: p, cantidad: 2 }] });
  assert.equal(await ultima(), 'kg');
  await invocar('pedidos:crear', { cliente_id: c, items: [{ producto_id: p, cantidad: 6, unidad_pedido: 'unidad' }] });
  assert.equal(await ultima(), 'unidad');
});
