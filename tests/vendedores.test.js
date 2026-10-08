// Vendedores: comisión por lo COBRADO (no lo facturado), con el vendedor que tenía el cliente al facturar y sin
// contar lo anulado.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, limpiarDatos, crearProducto } = require('./harness');

let db;
let invocar;
test.before(async () => {
  ({ db, invocar } = await iniciar());
});
test.beforeEach(async () => {
  limpiarDatos(db);
  db.prepare('DELETE FROM vendedores').run();
  db.prepare('DELETE FROM vendedor_porcentajes').run();
  db.prepare('DELETE FROM comisiones_vendedor_pagos').run();
  await invocar('usuarios:cerrarSesion');
});

const mesActual = () => new Date().toISOString().slice(0, 7);
const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.0051, `${msg || 'valor'}: ${a} ≠ ${b}`);

test('crear vendedores valida nombre, número y porcentaje, y no repite el nombre', async () => {
  assert.equal((await invocar('vendedores:crear', { nombre: '', numero: 5, porcentaje: 3 })).ok, false);
  assert.equal((await invocar('vendedores:crear', { nombre: 'Alma', numero: 0, porcentaje: 3 })).ok, false);
  assert.equal((await invocar('vendedores:crear', { nombre: 'Alma', numero: 5, porcentaje: 101 })).ok, false);
  assert.equal((await invocar('vendedores:crear', { nombre: 'Marina Lara', numero: 5, porcentaje: 3 })).ok, true);
  assert.equal((await invocar('vendedores:crear', { nombre: 'marina lara', numero: 6, porcentaje: 3 })).ok, false);
});

test('el informe suma lo cobrado por vendedor (no lo facturado sin cobrar), calcula la comisión y deja aparte lo anulado con su motivo', async () => {
  const ml = await invocar('vendedores:crear', { nombre: 'Marina Lara', numero: 5, porcentaje: 3 });
  const dv = await invocar('vendedores:crear', { nombre: 'Diego Soria', numero: 4, porcentaje: 5 });
  const p = crearProducto(db, { nombre: 'Vacío', precio: 1000 });
  const a = await invocar('clientes:crear', { nombre: 'Alma', codigo: '', vendedor_id: ml.id });
  const b = await invocar('clientes:crear', { nombre: 'Bruno', codigo: '', vendedor_id: dv.id });
  const c = await invocar('clientes:crear', { nombre: 'Camila', codigo: '' });
  const facturar = (cliente, cantidad) =>
    invocar('facturas:crear', { cliente_id: cliente.cliente.id, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad }] });
  const fa = await facturar(a, 10); // 10.000 de Marina Lara, se cobra este mes
  await invocar('facturas:registrarPago', { factura_id: fa.id, monto: 10000, metodo_pago: 'Efectivo' });
  await facturar(a, 20); // 20.000 facturados este mes pero todavía sin cobrar: no suman
  const anulada = await facturar(a, 4); // 4.000, se anula (sin cobrar)
  await invocar('facturas:anular', { id: anulada.id, motivo: 'Se cargó dos veces' });
  const fb = await facturar(b, 20); // 20.000 de Soria, cobrados
  await invocar('facturas:registrarPago', { factura_id: fb.id, monto: 20000, metodo_pago: 'Efectivo' });
  const fc = await facturar(c, 7); // 7.000 del dueño, sin comisión
  await invocar('facturas:registrarPago', { factura_id: fc.id, monto: 7000, metodo_pago: 'Efectivo' });

  const r = await invocar('vendedores:informe', mesActual());
  assert.equal(r.ok, true);
  const filaMl = r.vendedores.find((v) => v.nombre === 'Marina Lara');
  cerca(filaMl.total, 10000, 'solo lo cobrado, no los 20.000 facturados sin cobrar todavía');
  cerca(filaMl.comision, 300, '3% de 10.000');
  assert.equal(filaMl.clientes.length, 1);
  assert.equal(filaMl.anuladas.length, 1);
  assert.equal(filaMl.anuladas[0].motivo, 'Se cargó dos veces');
  const filaDv = r.vendedores.find((v) => v.nombre === 'Diego Soria');
  cerca(filaDv.comision, 1000, '5% de 20.000');
  cerca(r.sinVendedor.total, 7000, 'lo del dueño va aparte');
  assert.equal(r.sinVendedor.comision, undefined, 'lo del dueño no genera comisión');
});

test('cambiarle el vendedor a un cliente no mueve los cobros ya hechos', async () => {
  const ml = await invocar('vendedores:crear', { nombre: 'Marina Lara', numero: 5, porcentaje: 3 });
  const dv = await invocar('vendedores:crear', { nombre: 'Diego Soria', numero: 4, porcentaje: 5 });
  const p = crearProducto(db, { nombre: 'Vacío', precio: 1000 });
  const cli = await invocar('clientes:crear', { nombre: 'Alma', codigo: '', vendedor_id: ml.id });
  const f1 = await invocar('facturas:crear', { cliente_id: cli.cliente.id, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 10 }] });
  await invocar('facturas:registrarPago', { factura_id: f1.id, monto: 10000, metodo_pago: 'Efectivo' });
  await invocar('clientes:actualizar', { id: cli.cliente.id, nombre: 'Alma', codigo: cli.cliente.codigo, vendedor_id: dv.id });
  const f2 = await invocar('facturas:crear', { cliente_id: cli.cliente.id, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 2 }] });
  await invocar('facturas:registrarPago', { factura_id: f2.id, monto: 2000, metodo_pago: 'Efectivo' });
  const r = await invocar('vendedores:informe', mesActual());
  cerca(r.vendedores.find((v) => v.nombre === 'Marina Lara').total, 10000, 'lo anterior queda con Marina Lara');
  cerca(r.vendedores.find((v) => v.nombre === 'Diego Soria').total, 2000, 'lo nuevo va con Soria');
});

test('si cambia el porcentaje de un vendedor, lo cobrado antes se sigue calculando con el viejo', async () => {
  const v = await invocar('vendedores:crear', { nombre: 'Marina Lara', numero: 5, porcentaje: 3, telefono: '3511234567' });
  const p = crearProducto(db, { nombre: 'Vacío', precio: 1000 });
  const cli = await invocar('clientes:crear', { nombre: 'Alma', codigo: '', vendedor_id: v.id });
  const f1 = await invocar('facturas:crear', { cliente_id: cli.cliente.id, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 10 }] });
  await invocar('facturas:registrarPago', { factura_id: f1.id, monto: 10000, metodo_pago: 'Efectivo' });
  // El cobro (no la factura) se movió a enero: lo que importa es cuándo se cobró.
  db.prepare("UPDATE pagos SET fecha = '2026-01-15 10:00:00' WHERE factura_id = ?").run(f1.id);
  await invocar('vendedores:actualizar', { id: v.id, nombre: 'Marina Lara', numero: 5, porcentaje: 5, telefono: '3511234567' });
  const f2 = await invocar('facturas:crear', { cliente_id: cli.cliente.id, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 10 }] });
  await invocar('facturas:registrarPago', { factura_id: f2.id, monto: 10000, metodo_pago: 'Efectivo' }); // se cobra hoy
  const enero = (await invocar('vendedores:informe', '2026-01')).vendedores[0];
  cerca(enero.comision, 300, 'enero se calcula con el 3% de entonces');
  assert.deepEqual(enero.porcentajesAplicados, [3]);
  const hoy = (await invocar('vendedores:informe', mesActual())).vendedores[0];
  cerca(hoy.comision, 500, 'este mes ya con el 5%');
  assert.deepEqual(hoy.porcentajesAplicados, [5]);
  assert.equal((await invocar('vendedores:listar'))[0].telefono, '3511234567');
});

test('registrar un pago de comisión: se puede pagar de a partes, el monto lo elige quien carga, y se puede deshacer', async () => {
  const ml = await invocar('vendedores:crear', { nombre: 'Marina Lara', numero: 5, porcentaje: 3 });
  const p = crearProducto(db, { nombre: 'Vacío', precio: 1000 });
  const cli = await invocar('clientes:crear', { nombre: 'Alma', codigo: '', vendedor_id: ml.id });
  const f = await invocar('facturas:crear', { cliente_id: cli.cliente.id, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 10 }] });
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 10000, metodo_pago: 'Efectivo' }); // comisión: 300

  const mes = mesActual();
  const r1 = await invocar('vendedores:pagarComision', { vendedor_id: ml.id, fecha: `${mes}-10`, monto: 100, medio_pago: 'Efectivo' });
  assert.equal(r1.ok, true);
  assert.equal(r1.mes, mes, 'el mes sale de la fecha del pago');
  const informeParcial = (await invocar('vendedores:informe', mes)).vendedores[0];
  cerca(informeParcial.pagado, 100, 'lleva pagado lo primero');
  cerca(informeParcial.pendiente, 200, 'falta el resto');
  assert.equal(informeParcial.pagos.length, 1);

  const r2 = await invocar('vendedores:pagarComision', { vendedor_id: ml.id, fecha: `${mes}-20`, monto: 200, medio_pago: 'Efectivo' });
  assert.equal(r2.ok, true, 'se puede cargar un segundo pago el mismo mes');
  const informeCompleto = (await invocar('vendedores:informe', mes)).vendedores[0];
  cerca(informeCompleto.pagado, 300, 'entre los dos suman la comisión');
  cerca(informeCompleto.pendiente, 0);
  assert.equal(informeCompleto.pagos.length, 2);

  const gastos = await invocar('gastos:listar', {});
  assert.equal(gastos.filter((g) => g.descripcion.includes('Marina Lara')).length, 2, 'cada pago es un gasto aparte');
  assert.equal(gastos[0].categoria, 'Comisiones de vendedores');

  const deshacer = await invocar('vendedores:deshacerPagoComision', { id: informeCompleto.pagos[0].id });
  assert.equal(deshacer.ok, true);
  const despues = (await invocar('vendedores:informe', mes)).vendedores[0];
  cerca(despues.pagado, 200, 'deshacer el primero deja solo el segundo');
  assert.equal((await invocar('gastos:listar', {})).length, 1);
});

test('un pago de comisión queda en el informe del mes de su fecha, no del mes que se estaba mirando', async () => {
  const ml = await invocar('vendedores:crear', { nombre: 'Marina Lara', numero: 5, porcentaje: 3 });
  const p = crearProducto(db, { nombre: 'Vacío', precio: 1000 });
  const cli = await invocar('clientes:crear', { nombre: 'Alma', codigo: '', vendedor_id: ml.id });
  const f = await invocar('facturas:crear', { cliente_id: cli.cliente.id, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 10 }] });
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 10000, metodo_pago: 'Efectivo' });
  // Se carga con fecha de enero, aunque el informe que se está mirando sea el mes actual.
  const r = await invocar('vendedores:pagarComision', { vendedor_id: ml.id, fecha: '2026-01-15', monto: 300, medio_pago: 'Efectivo' });
  assert.equal(r.ok, true);
  assert.equal(r.mes, '2026-01');
  const enero = (await invocar('vendedores:informe', '2026-01')).vendedores.find((v) => v.nombre === 'Marina Lara');
  cerca(enero.pagado, 300, 'el pago va al informe de enero, por su fecha');
  const actual = (await invocar('vendedores:informe', mesActual())).vendedores.find((v) => v.nombre === 'Marina Lara');
  assert.equal(actual.pagado, 0, 'no aparece en el mes que se estaba mirando al cargarlo');
});

test('Estadísticas desglosa lo cobrado por vendedor, aparte de lo cobrado directo (sin vendedor)', async () => {
  const ml = await invocar('vendedores:crear', { nombre: 'Marina Lara', numero: 5, porcentaje: 3 });
  const p = crearProducto(db, { nombre: 'Vacío', precio: 1000 });
  const a = await invocar('clientes:crear', { nombre: 'Alma', codigo: '', vendedor_id: ml.id });
  const c = await invocar('clientes:crear', { nombre: 'Camila', codigo: '' });
  const fa = await invocar('facturas:crear', { cliente_id: a.cliente.id, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 10 }] });
  await invocar('facturas:registrarPago', { factura_id: fa.id, monto: 10000, metodo_pago: 'Efectivo' });
  const fc = await invocar('facturas:crear', { cliente_id: c.cliente.id, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 7 }] });
  await invocar('facturas:registrarPago', { factura_id: fc.id, monto: 7000, metodo_pago: 'Efectivo' });

  const r = await invocar('estadisticas:rankings', {});
  assert.equal(r.ok, true);
  cerca(r.comisionistas.vendedores.find((v) => v.nombre === 'Marina Lara').total, 10000);
  cerca(r.comisionistas.directo, 7000);
});

test('un empleado no ve el informe ni puede cambiar el vendedor de un cliente', async () => {
  await invocar('usuarios:crearPrimero', { nombre: 'Admin', pin: 'admin1234' });
  const ml = await invocar('vendedores:crear', { nombre: 'Marina Lara', numero: 5, porcentaje: 3 });
  const cli = await invocar('clientes:crear', { nombre: 'Alma', codigo: '', vendedor_id: ml.id });
  const emp = await invocar('usuarios:crear', { nombre: 'Hernán', pin: 'hugo1234', rol: 'empleado' });
  await invocar('usuarios:ingresar', { usuario_id: emp.id, pin: 'hugo1234' });
  assert.equal((await invocar('vendedores:informe', mesActual())).ok, false);
  assert.equal((await invocar('vendedores:listar')).ok, false);
  await invocar('clientes:actualizar', { id: cli.cliente.id, nombre: 'Alma', codigo: cli.cliente.codigo, vendedor_id: null });
  const despues = (await invocar('clientes:listar')).find((x) => x.id === cli.cliente.id);
  assert.equal(despues.vendedor_id, ml.id, 'el empleado no le sacó el vendedor');
});

test('el informe acepta un período (desde y hasta) además de un mes, y los pagos de comisión se cuentan por su fecha', async () => {
  const ml = await invocar('vendedores:crear', { nombre: 'Marina Lara', numero: 5, porcentaje: 10 });
  const p = crearProducto(db, { nombre: 'Vacío', precio: 1000 });
  const a = await invocar('clientes:crear', { nombre: 'Alma', codigo: '', vendedor_id: ml.id });
  const f = await invocar('facturas:crear', { cliente_id: a.cliente.id, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 10 }] });
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 10000, metodo_pago: 'Efectivo' });
  const hoy = db.prepare("SELECT date('now', 'localtime') AS d").get().d;
  // Un período que incluye el día del cobro: suma; uno anterior: no.
  const dentro = await invocar('vendedores:informe', { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy });
  assert.equal(dentro.ok, true);
  assert.equal(dentro.hasta, hoy);
  cerca(dentro.vendedores[0].comision, 1000, '10% de 10.000');
  const antes = await invocar('vendedores:informe', { desde: '2000-01-01', hasta: '2000-01-31' });
  assert.equal(antes.mes, '2000-01', 'un mes entero devuelve su mes');
  cerca(antes.vendedores.find((v) => v.nombre === 'Marina Lara').comision, 0, 'nada cobrado en ese período');
  assert.equal((await invocar('vendedores:informe', { desde: hoy, hasta: '2000-01-01' })).ok, false, 'desde después de hasta');
  assert.equal((await invocar('vendedores:informe', { desde: 'x', hasta: hoy })).ok, false);
  // El pago de comisión aparece en el período que contiene su fecha.
  assert.equal((await invocar('vendedores:pagarComision', { vendedor_id: ml.id, fecha: hoy, monto: 400, medio_pago: 'Efectivo' })).ok, true);
  const conPago = (await invocar('vendedores:informe', { desde: hoy, hasta: hoy })).vendedores[0];
  cerca(conPago.pagado, 400, 'pagado dentro del período');
  cerca(conPago.pendiente, 600, 'comisión 1.000 − 400 pagados');
  cerca((await invocar('vendedores:informe', { desde: '2000-01-01', hasta: '2000-01-31' })).vendedores[0].pagado, 0, 'fuera del período no figura');
});
