// Arreglos de la revisión general (2026-10-02): comisión y gasto, aviso de anulaciones con vencimiento, categorías y
// validaciones del servidor en facturas.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, limpiarDatos, crearCliente, crearProducto, asegurarMetodo } = require('./harness');

let db;
let invocar;
test.before(async () => {
  ({ db, invocar } = await iniciar());
});
test.beforeEach(() => {
  limpiarDatos(db);
  db.prepare('DELETE FROM vendedores').run();
  db.prepare('DELETE FROM comisiones_vendedor_pagos').run();
  ['Efectivo', 'Mercado Pago'].forEach((m) => asegurarMetodo(db, m));
});
const hoy = () => db.prepare("SELECT date('now', 'localtime') AS d").get().d;

async function pagarComision(monto) {
  const v = await invocar('vendedores:crear', { numero: 1, nombre: `Vend${Math.random()}`, porcentaje: 5 });
  const r = await invocar('vendedores:pagarComision', { vendedor_id: v.id, fecha: hoy(), monto, medio_pago: 'Efectivo' });
  const gasto = db.prepare('SELECT gasto_id FROM comisiones_vendedor_pagos WHERE id = ?').get(r.id).gasto_id;
  return { v, gasto };
}

test('quitar desde Gastos el gasto de una comisión también la saca de Vendedores', async () => {
  const { v, gasto } = await pagarComision(1000);
  await invocar('gastos:eliminar', gasto);
  const informe = await invocar('vendedores:informe', hoy().slice(0, 7));
  assert.equal(informe.vendedores.find((x) => x.id === v.id).pagado, 0);
});

test('corregir el monto del gasto de una comisión lo corrige también en Vendedores', async () => {
  const { v, gasto } = await pagarComision(1000);
  const g = db.prepare('SELECT * FROM gastos WHERE id = ?').get(gasto);
  const r = await invocar('gastos:actualizar', { id: gasto, fecha: g.fecha, categoria_id: g.categoria_id, descripcion: g.descripcion, monto: 1500, medio_pago: 'Efectivo' });
  assert.equal(r.ok, true);
  const informe = await invocar('vendedores:informe', hoy().slice(0, 7));
  assert.equal(informe.vendedores.find((x) => x.id === v.id).pagado, 1500);
});

test('el aviso de anulaciones de un empleado desaparece a los 14 días y se va al reactivar', async () => {
  await invocar('usuarios:crearPrimero', { nombre: 'Jefa', pin: '1234' });
  await invocar('usuarios:crear', { nombre: 'Emp', pin: '5678', rol: 'empleado' });
  const jefa = db.prepare("SELECT id FROM usuarios WHERE nombre = 'Jefa'").get().id;
  const emp = db.prepare("SELECT id FROM usuarios WHERE nombre = 'Emp'").get().id;
  const c = crearCliente(db, 'Ana');
  const p = crearProducto(db, { nombre: 'ProdAn', precio: 1000 });
  const f = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 1 }] });
  await invocar('usuarios:ingresar', { usuario_id: emp, pin: '5678' });
  assert.equal((await invocar('facturas:anular', { id: f.id, motivo: 'Error' })).ok, true);
  await invocar('usuarios:ingresar', { usuario_id: jefa, pin: '1234' });
  const hay = async () => (await invocar('avisos:obtener')).avisos.some((a) => a.tipo === 'anulaciones_empleado');
  assert.equal(await hay(), true);
  db.prepare("UPDATE facturas SET anulado_en = datetime('now', 'localtime', '-20 days') WHERE id = ?").run(f.id);
  assert.equal(await hay(), false);
  db.prepare("UPDATE facturas SET anulado_en = datetime('now', 'localtime') WHERE id = ?").run(f.id);
  assert.equal(await hay(), true);
  assert.equal((await invocar('facturas:reactivar', f.id)).ok, true);
  assert.equal(db.prepare('SELECT anulado_en FROM facturas WHERE id = ?').get(f.id).anulado_en, null);
  assert.equal(await hay(), false);
  await invocar('usuarios:cerrarSesion');
});

test('pasar una categoría a un grupo donde ya existe con ese nombre da un mensaje claro', async () => {
  await invocar('gastos:crearCategoria', { nombre: 'Obra social X', ambito: 'negocio' });
  await invocar('gastos:crearCategoria', { nombre: 'Obra social X', ambito: 'personal' });
  const id = db.prepare("SELECT id FROM categorias_gasto WHERE nombre = 'Obra social X' AND ambito = 'negocio'").get().id;
  const r = await invocar('gastos:cambiarAmbitoCategoria', { id, ambito: 'personal' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Ya hay una categoría/);
});

test('el servidor no deja cargar cobros a una factura anulada ni de monto cero o negativo', async () => {
  const c = crearCliente(db, 'Beto');
  const p = crearProducto(db, { nombre: 'ProdBe', precio: 1000 });
  const f = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 1 }] });
  await assert.rejects(() => invocar('facturas:registrarPago', { factura_id: f.id, monto: -5, metodo_pago: 'Efectivo' }), /mayor a cero/);
  await assert.rejects(() => invocar('facturas:registrarPago', { factura_id: f.id, monto: 0, metodo_pago: 'Efectivo' }), /mayor a cero/);
  await invocar('facturas:anular', { id: f.id, motivo: 'x' });
  await assert.rejects(() => invocar('facturas:registrarPago', { factura_id: f.id, monto: 1000, metodo_pago: 'Efectivo' }), /anulada/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pagos WHERE factura_id = ?').get(f.id).n, 0);
});

test('el servidor no deja crear ni editar facturas sin renglones, con cantidad cero o negativa o con un producto que no existe', async () => {
  const c = crearCliente(db, 'Cami');
  const p = crearProducto(db, { nombre: 'ProdCa', precio: 1000 });
  const nueva = (items) => invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items });
  await assert.rejects(() => nueva([]), /al menos un producto/);
  await assert.rejects(() => nueva([{ producto_id: p, cantidad: -2 }]), /mayor a cero/);
  await assert.rejects(() => nueva([{ producto_id: p, cantidad: 0 }]), /mayor a cero/);
  await assert.rejects(() => nueva([{ producto_id: 999999, cantidad: 1 }]), /ya no existe/);
  await assert.rejects(() => nueva([{ producto_id: p, cantidad: 1, precio_unitario: -1 }]), /precio/);
  assert.equal(db.prepare('SELECT saldo FROM clientes WHERE id = ?').get(c).saldo, 0);
  const f = await nueva([{ producto_id: p, cantidad: 2 }]);
  assert.equal(f.total, 2000);
  const r = await invocar('facturas:actualizar', { id: f.id, tipo_precio: 'cliente', items: [] });
  assert.equal(r.ok, false);
  assert.equal(db.prepare('SELECT total FROM facturas WHERE id = ?').get(f.id).total, 2000);
});

test('el chequeo de saldos no avisa tras facturar, cobrar, anular (con crédito y con devolución) y editar, y sí avisa si un saldo queda mal', async () => {
  const c = crearCliente(db, 'Saldos');
  const p = crearProducto(db, { nombre: 'ProdSa', precio: 1000 });
  const descuadrado = async () => (await invocar('avisos:obtener')).avisos.find((a) => a.tipo === 'saldos_clientes');
  const f1 = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 3 }] });
  const f2 = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 2 }] });
  await invocar('facturas:registrarPago', { factura_id: f1.id, monto: 1200, metodo_pago: 'Efectivo' });
  await invocar('clientes:registrarPagoGeneral', { cliente_id: c, monto: 500, metodo_pago: 'Mercado Pago' });
  assert.equal(await descuadrado(), undefined);
  await invocar('facturas:actualizar', { id: f2.id, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 1 }] });
  assert.equal(await descuadrado(), undefined);
  // anular una factura cobrada: queda crédito, que se usa solo en la otra
  assert.equal((await invocar('facturas:anular', { id: f1.id, motivo: 'x', destino: 'credito' })).ok, true);
  assert.equal(await descuadrado(), undefined);
  // anular otra, con devolución en plata
  const f3 = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 2 }] });
  await invocar('facturas:registrarPago', { factura_id: f3.id, monto: 800, metodo_pago: 'Efectivo' });
  assert.equal((await invocar('facturas:anular', { id: f3.id, motivo: 'y', destino: 'devolver', metodo: 'Efectivo', monto: 300 })).ok, true);
  assert.equal(await descuadrado(), undefined);
  // un saldo que queda mal se nota
  db.prepare('UPDATE clientes SET saldo = saldo + 777 WHERE id = ?').run(c);
  const aviso = await descuadrado();
  assert.ok(aviso);
  assert.match(aviso.detalle, /Saldos/);
});

test('reactivar una factura anulada deshace el crédito que se había gastado solo en otra factura pendiente', async () => {
  const c = crearCliente(db, 'Reac');
  const p = crearProducto(db, { nombre: 'ProdRe', precio: 1000 });
  const nueva = (cant) => invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: cant }] });
  const a = await nueva(10); // 10.000, la que se va a anular
  const b = await nueva(6); // 6.000, queda pendiente
  await invocar('facturas:registrarPago', { factura_id: a.id, monto: 10000, metodo_pago: 'Efectivo' });
  const saldoAntes = db.prepare('SELECT saldo FROM clientes WHERE id = ?').get(c).saldo; // 6.000
  const estadoB = () => db.prepare('SELECT estado FROM facturas WHERE id = ?').get(b.id).estado;

  assert.equal((await invocar('facturas:anular', { id: a.id, motivo: 'por error', destino: 'credito' })).ok, true);
  assert.equal(estadoB(), 'pagada', 'el crédito pagó la otra factura solo');
  assert.equal(db.prepare('SELECT saldo FROM clientes WHERE id = ?').get(c).saldo, -4000);

  const r = await invocar('facturas:reactivar', a.id);
  assert.equal(r.ok, true);
  assert.equal(estadoB(), 'pendiente', 'la otra factura vuelve a deber');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pagos WHERE lower(metodo_pago) = 'saldo a favor'").get().n, 0);
  assert.equal(db.prepare('SELECT saldo FROM clientes WHERE id = ?').get(c).saldo, saldoAntes);
  assert.equal(db.prepare('SELECT estado FROM facturas WHERE id = ?').get(a.id).estado, 'pagada');
  const aviso = (await invocar('avisos:obtener')).avisos.find((x) => x.tipo === 'saldos_clientes');
  assert.equal(aviso, undefined, 'el saldo sigue cerrando');
});

test('no se reactiva si el crédito de la anulación ya se usó después en otra factura', async () => {
  const c = crearCliente(db, 'Reac2');
  const p = crearProducto(db, { nombre: 'ProdRe2', precio: 1000 });
  const nueva = (cant) => invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: cant }] });
  const a = await nueva(10);
  await invocar('facturas:registrarPago', { factura_id: a.id, monto: 10000, metodo_pago: 'Efectivo' });
  await invocar('facturas:anular', { id: a.id, motivo: 'x', destino: 'credito' }); // queda crédito de 10.000
  await nueva(4); // se paga sola con ese crédito
  const r = await invocar('facturas:reactivar', a.id);
  assert.equal(r.ok, false);
  assert.match(r.error, /ya se usó/);
});

test('un cobro baja primero lo más antiguo: el saldo anterior y después las facturas, de la más vieja a la más nueva', async () => {
  const r = await invocar('clientes:crear', { nombre: 'Orden', apellido: '', codigo: '', saldo_inicial: '17100' });
  const c = r.cliente.id;
  const p = crearProducto(db, { nombre: 'ProdOr', precio: 1000 });
  const f1 = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 15.9 }] }); // 15.900
  const f2 = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 5 }] }); // 5.000
  const estado = (id) => db.prepare('SELECT estado FROM facturas WHERE id = ?').get(id).estado;

  // $10.000: todo al saldo anterior; las facturas no se tocan.
  assert.equal((await invocar('clientes:registrarPagoGeneral', { cliente_id: c, monto: 10000, metodo_pago: 'Efectivo' })).ok, true);
  assert.equal(db.prepare('SELECT SUM(monto) AS t FROM pagos WHERE factura_id IS NULL').get().t, 10000);
  assert.equal(estado(f1.id), 'pendiente');

  // $10.000 más: terminan el saldo anterior ($7.100) y el resto ($2.900) va a la factura más vieja.
  assert.equal((await invocar('clientes:registrarPagoGeneral', { cliente_id: c, monto: 10000, metodo_pago: 'Efectivo' })).ok, true);
  assert.equal(db.prepare('SELECT SUM(monto) AS t FROM pagos WHERE factura_id IS NULL').get().t, 17100);
  assert.equal(db.prepare('SELECT SUM(monto) AS t FROM pagos WHERE factura_id = ?').get(f1.id).t, 2900);
  assert.equal(estado(f1.id), 'parcial');
  assert.equal(estado(f2.id), 'pendiente');

  // El resto: la factura vieja, después la nueva. Todo saldado.
  assert.equal((await invocar('clientes:registrarPagoGeneral', { cliente_id: c, monto: 18000, metodo_pago: 'Efectivo' })).ok, true);
  assert.equal(estado(f1.id), 'pagada');
  assert.equal(estado(f2.id), 'pagada');
  assert.equal(db.prepare('SELECT saldo FROM clientes WHERE id = ?').get(c).saldo, 0);
});

test('un cliente sin saldo anterior (o con saldo a favor) cobra como siempre: a las facturas, de la más vieja a la más nueva', async () => {
  const c = crearCliente(db, 'SinAnterior');
  const p = crearProducto(db, { nombre: 'ProdSA', precio: 1000 });
  const f1 = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 3 }] });
  await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 2 }] });
  assert.equal((await invocar('clientes:registrarPagoGeneral', { cliente_id: c, monto: 3500, metodo_pago: 'Efectivo' })).ok, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pagos WHERE factura_id IS NULL').get().n, 0);
  assert.equal(db.prepare('SELECT estado FROM facturas WHERE id = ?').get(f1.id).estado, 'pagada');
});
