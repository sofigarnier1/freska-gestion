// Devolución de mercadería a un proveedor: resta lo que se le debe sin tocar el efectivo; si devolvió la plata, esa plata entra a
// la cuenta (o al cajón) y la deuda no cambia; los kilos devueltos se descuentan de lo comprado en Stock.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, limpiarDatos, asegurarMetodo } = require('./harness');

let db;
let invocar;
test.before(async () => {
  ({ db, invocar } = await iniciar());
});
test.beforeEach(() => {
  limpiarDatos(db);
  db.prepare('DELETE FROM cierres_caja').run();
  db.prepare('DELETE FROM proveedores').run();
  // La semilla trae "MercadoPago": sería la misma cuenta que "Mercado Pago" y la Caja se quedaría con la primera.
  db.prepare("DELETE FROM metodos_pago WHERE nombre IN ('MercadoPago', 'Personal Pay')").run();
  ['Efectivo', 'Mercado Pago', 'Cheque'].forEach((m) => asegurarMetodo(db, m));
});

const hoy = () => db.prepare("SELECT date('now', 'localtime') AS d").get().d;
const saldoDe = async (id) => (await invocar('proveedores:listar')).find((p) => p.id === id).saldo;
// Un proveedor con una compra de 100 kg de Vaca a $1000 el kilo ($100.000).
const conCompra = async () => {
  await invocar('proveedores:crear', { nombre: 'Frigorífico prueba' });
  const prov = db.prepare("SELECT id FROM proveedores WHERE nombre = 'Frigorífico prueba'").get().id;
  const compra = Number(db.prepare('INSERT INTO compras (proveedor_id, fecha, total) VALUES (?, ?, 100000)').run(prov, hoy()).lastInsertRowid);
  db.prepare("INSERT INTO compra_items (compra_id, producto, descripcion, kilos, precio_kg, importe) VALUES (?, 'Vaca', 'Nalga', 100, 1000, 100000)").run(compra);
  return { prov, compra };
};

test('una devolución a favor resta de la deuda y no mueve el efectivo', async () => {
  const { prov, compra } = await conCompra();
  await invocar('caja:guardarCierre', { fecha: hoy(), fondo_inicial: 50000, efectivo_contado: null });
  const r = await invocar('proveedores:devolver', { proveedor_id: prov, fecha: hoy(), compra_id: compra, producto: 'Vaca', descripcion: 'Nalga', unidad: 'kg', kilos: 4.6, monto: 36572, nota: 'mal estado' });
  assert.equal(r.ok, true);
  assert.equal(await saldoDe(prov), 63428);
  const h = await invocar('proveedores:historial', prov);
  assert.equal(h.devoluciones.length, 1);
  assert.equal(h.devoluciones[0].kilos, 4.6);
  const d = await invocar('caja:obtenerDia', hoy());
  assert.equal(d.gastosEfectivo.length, 0, 'no sale efectivo del cajón');
  // Si después se paga todo lo que se debía, no queda nada.
  await invocar('proveedores:pagar', { proveedor_id: prov, fecha: hoy(), transferencia: 63428 });
  assert.equal(await saldoDe(prov), 0);
  // Quitar la devolución vuelve a sumar lo devuelto: 100.000 de la compra − 63.428 pagados.
  await invocar('proveedores:quitarDevolucion', h.devoluciones[0].id);
  assert.equal(await saldoDe(prov), 36572);
});

test('si el proveedor devolvió la plata, entra a la cuenta o al cajón y la deuda no cambia', async () => {
  const { prov } = await conCompra();
  const dia = hoy();
  await invocar('cuentas:guardarSaldos', { desde: dia, saldos: { Efectivo: 10000, 'Mercado Pago': 5000 } });
  await invocar('caja:guardarCierre', { fecha: dia, fondo_inicial: 10000, efectivo_contado: null });
  await invocar('proveedores:pagar', { proveedor_id: prov, fecha: dia, efectivo: 100000 }); // ya estaba pago
  const efectivoAntes = (await invocar('cuentas:resumen')).cuentas.find((c) => c.nombre === 'Efectivo').saldo;
  assert.equal((await invocar('proveedores:devolver', { proveedor_id: prov, fecha: dia, monto: 30000 })).ok, true);
  assert.equal(await saldoDe(prov), -30000, 'sin la plata, le queda a favor');
  assert.equal((await invocar('proveedores:devolver', { proveedor_id: prov, fecha: dia, monto: 5000, reembolso_cuenta: 'Mercado Pago' })).ok, true);
  assert.equal(await saldoDe(prov), -30000, 'devolvió la plata: la deuda queda igual');
  assert.equal((await invocar('proveedores:devolver', { proveedor_id: prov, fecha: dia, monto: 2000, reembolso_cuenta: 'Efectivo' })).ok, true);
  const cuentas = (await invocar('cuentas:resumen')).cuentas;
  assert.equal(cuentas.find((c) => c.nombre === 'Mercado Pago').saldo, 10000, '5.000 + 5.000 devueltos');
  assert.equal(cuentas.find((c) => c.nombre === 'Efectivo').saldo, efectivoAntes + 2000);
  // El cajón del día cuenta el efectivo que volvió; no figura como una operación de la Caja.
  assert.equal((await invocar('caja:obtenerDia', dia)).otrosEfectivo, 2000);
  assert.equal((await invocar('operaciones:listar')).length, 0);
  assert.equal((await invocar('proveedores:devolver', { proveedor_id: prov, fecha: dia, monto: 100, reembolso_cuenta: 'Cuenta inventada' })).ok, false);
  // Estadísticas: lo pagado a proveedores es neto de lo que devolvieron en plata (100.000 − 5.000 − 2.000).
  const est = await invocar('estadisticas:resumen', { desde: dia, hasta: dia });
  assert.equal(est.salidas.proveedores.total, 93000);
  assert.equal((await invocar('proveedores:totalPagos', { desde: dia, hasta: dia })).total, 93000);
});

test('los kilos devueltos se descuentan de lo comprado en el rendimiento y se validan los datos', async () => {
  const { prov, compra } = await conCompra();
  const dia = hoy();
  await invocar('stock:resumen');
  const antes = (await invocar('stock:rendimiento', { desde: '2000-01-01', hasta: '2999-12-31' })).tipos.find((t) => t.tipo === 'Vaca').comprado;
  await invocar('proveedores:devolver', { proveedor_id: prov, fecha: dia, compra_id: compra, producto: 'Vaca', descripcion: 'Nalga', unidad: 'kg', kilos: 4.6, monto: 4600 });
  const despues = (await invocar('stock:rendimiento', { desde: '2000-01-01', hasta: '2999-12-31' })).tipos.find((t) => t.tipo === 'Vaca').comprado;
  assert.equal(Math.round((antes - despues) * 100) / 100, 4.6);
  assert.equal((await invocar('proveedores:devolver', { proveedor_id: prov, fecha: dia, monto: 0 })).ok, false, 'monto obligatorio');
  assert.equal((await invocar('proveedores:devolver', { proveedor_id: prov, fecha: 'x', monto: 10 })).ok, false);
  assert.equal((await invocar('proveedores:devolver', { proveedor_id: prov, fecha: dia, monto: 10, kilos: -1 })).ok, false);
  assert.equal((await invocar('proveedores:devolver', { proveedor_id: 99999, fecha: dia, monto: 10 })).ok, false);
  // Con la compra elegida no se puede devolver más de lo comprado (100 kg; ya se devolvieron 4,6).
  const devolver = (kilos) => invocar('proveedores:devolver', { proveedor_id: prov, fecha: dia, compra_id: compra, producto: 'Vaca', descripcion: 'Nalga', unidad: 'kg', kilos, monto: 10 });
  assert.equal((await devolver(95.5)).ok, false);
  assert.match((await devolver(95.5)).error, /95,4|95\.4/);
  assert.equal((await devolver(95.4)).ok, true);
  assert.equal((await devolver(0.1)).ok, false, 'ya se devolvió todo');
  // Al eliminar el proveedor se va todo con él.
  await invocar('proveedores:eliminar', prov);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM devoluciones_proveedor').get().n, 0);
});
