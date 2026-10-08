// Productos: dar de baja un producto no debería dejar su código ni su nombre "atados" para siempre, porque la
// base los sigue teniendo como únicos aunque esté inactivo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, limpiarDatos } = require('./harness');

let db;
let invocar;
test.before(async () => {
  ({ db, invocar } = await iniciar());
});
test.beforeEach(() => limpiarDatos(db));

test('dar de baja un producto y volver a crear uno con su mismo código lo reactiva, no lo bloquea', async () => {
  const r = await invocar('productos:crear', { nombre: 'Asado', codigo: '6', precio_cliente: 5000, precio_cf: 5500, unidad: 'kg' });
  assert.equal(r.ok, true);
  const id = r.producto.id;
  await invocar('productos:baja', id);
  assert.equal((await invocar('productos:listar')).length, 0, 'dado de baja, no aparece en la lista');

  const r2 = await invocar('productos:crear', { nombre: 'Asado', codigo: '6', precio_cliente: 6000, precio_cf: 6500, unidad: 'kg' });
  assert.equal(r2.ok, true, 'el código 6 tenía que poder volver a usarse');
  assert.equal(r2.producto.id, id, 'reactiva el mismo producto, no crea uno repetido');
  assert.equal(r2.producto.precio_cliente, 6000, 'se actualiza con los datos nuevos');

  const lista = await invocar('productos:listar');
  assert.equal(lista.length, 1);
});

test('lo mismo si lo que coincide es el nombre, no el código', async () => {
  const r = await invocar('productos:crear', { nombre: 'Matambre', codigo: '9', precio_cliente: 5000, precio_cf: 5500, unidad: 'kg' });
  await invocar('productos:baja', r.producto.id);
  const r2 = await invocar('productos:crear', { nombre: 'Matambre', codigo: '12', precio_cliente: 5200, precio_cf: 5700, unidad: 'kg' });
  assert.equal(r2.ok, true);
  assert.equal(r2.producto.id, r.producto.id);
  assert.equal(r2.producto.codigo, '12');
});

test('un código o nombre en uso por un producto activo sigue rechazándose', async () => {
  await invocar('productos:crear', { nombre: 'Vacío', codigo: '3', precio_cliente: 1000, precio_cf: 1100, unidad: 'kg' });
  const r = await invocar('productos:crear', { nombre: 'Otro', codigo: '3', precio_cliente: 1000, precio_cf: 1100, unidad: 'kg' });
  assert.equal(r.ok, false);
});
