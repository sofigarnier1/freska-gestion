// Pedidos programados: anotados hoy para un día futuro. Hasta ese día quedan aparte (no cuentan para hoy, ni para el stock
// pendiente); ese día son un pedido más del día; la campanita avisa el día anterior.
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
  db.prepare('DELETE FROM configuracion WHERE clave LIKE ?').run('avisos_%');
});

const suma = (dias) => db.prepare("SELECT date('now', 'localtime', ?) AS d").get(`${dias >= 0 ? '+' : ''}${dias} days`).d;

test('un pedido para un día futuro queda programado; para hoy o un día pasado es un pedido común', async () => {
  const c = crearCliente(db, 'Alma');
  const p = crearProducto(db, { nombre: 'Milanesa', precio: 1000, unidad: 'kg' });
  const items = [{ producto_id: p, cantidad: 3 }];
  const viernes = suma(4);
  const futuro = await invocar('pedidos:crear', { cliente_id: c, items, para_fecha: viernes });
  const hoy = await invocar('pedidos:crear', { cliente_id: c, items, para_fecha: suma(0) });
  const pasado = await invocar('pedidos:crear', { cliente_id: c, items, para_fecha: suma(-2) });
  const roto = await invocar('pedidos:crear', { cliente_id: c, items, para_fecha: 'mañana' });
  const sin = await invocar('pedidos:crear', { cliente_id: c, items });
  const lista = await invocar('pedidos:listar');
  const paraFecha = (id) => lista.find((x) => x.id === id).para_fecha;
  assert.equal(paraFecha(futuro.id), viernes);
  [hoy, pasado, roto, sin].forEach((r) => assert.equal(paraFecha(r.id), null));
  // Se puede cambiar el día, quitar la programación, y editar sin tocarlo.
  await invocar('pedidos:actualizar', { id: futuro.id, items, para_fecha: suma(6) });
  assert.equal((await invocar('pedidos:listar')).find((x) => x.id === futuro.id).para_fecha, suma(6));
  await invocar('pedidos:actualizar', { id: futuro.id, items });
  assert.equal((await invocar('pedidos:listar')).find((x) => x.id === futuro.id).para_fecha, suma(6), 'sin para_fecha no se toca');
  await invocar('pedidos:actualizar', { id: futuro.id, items, para_fecha: '' });
  assert.equal((await invocar('pedidos:listar')).find((x) => x.id === futuro.id).para_fecha, null);
});

test('las cantidades pedidas cuentan el día para el que es el pedido', async () => {
  const c = crearCliente(db, 'Alma');
  const p = crearProducto(db, { nombre: 'Milanesa', precio: 1000, unidad: 'kg' });
  const viernes = suma(4);
  await invocar('pedidos:crear', { cliente_id: c, items: [{ producto_id: p, cantidad: 5 }], para_fecha: viernes });
  await invocar('pedidos:crear', { cliente_id: c, items: [{ producto_id: p, cantidad: 2 }] });
  const porDia = await invocar('reportes:cantidadesPedidasPorDia');
  assert.equal(porDia.find((r) => r.periodo === viernes).total, 5, 'el programado cuenta el viernes');
  assert.equal(porDia.find((r) => r.periodo === suma(0)).total, 2, 'hoy solo lo de hoy');
  // El día llega: pasa a ser un pedido pendiente más (se simula moviendo el día programado a hoy).
  db.prepare('UPDATE pedidos SET para_fecha = ? WHERE para_fecha = ?').run(suma(0), viernes);
  assert.equal((await invocar('reportes:cantidadesPedidasPorDia')).find((r) => r.periodo === suma(0)).total, 7);
});

test('la campanita avisa de los pedidos programados para mañana, y un programado no figura como pedido viejo', async () => {
  const c = crearCliente(db, 'Alma');
  const p = crearProducto(db, { nombre: 'Milanesa', precio: 1000, unidad: 'kg' });
  const items = [{ producto_id: p, cantidad: 1 }];
  await invocar('pedidos:crear', { cliente_id: c, items, para_fecha: suma(1) });
  await invocar('pedidos:crear', { cliente_id: c, items, para_fecha: suma(1) });
  await invocar('pedidos:crear', { cliente_id: c, items, para_fecha: suma(5) });
  const avisos = (await invocar('avisos:obtener')).avisos || [];
  const manana = avisos.find((a) => a.tipo === 'pedidos_programados');
  assert.ok(manana, 'hay un aviso');
  assert.match(manana.titulo, /^2 pedidos programados para mañana/);
  assert.equal(avisos.some((a) => a.tipo === 'pedidos'), false, 'no hay pedidos viejos sin facturar');
  assert.ok((await invocar('avisos:tipos')).some((t) => t.id === 'pedidos_programados'));
  // Un pedido que quedó pendiente de un día anterior sigue avisando (con su fecha efectiva).
  const viejo = (await invocar('pedidos:crear', { cliente_id: c, items })).id;
  db.prepare("UPDATE pedidos SET fecha = datetime('now', 'localtime', '-3 days') WHERE id = ?").run(viejo);
  assert.ok(((await invocar('avisos:obtener')).avisos || []).some((a) => a.tipo === 'pedidos'));
});
