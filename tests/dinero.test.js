// Tests de dinero: facturas, cobros, anulaciones, saldo a favor y retención. Cada test arranca con la base vacía.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, limpiarDatos, crearCliente, crearProducto, asegurarMetodo } = require('./harness');

const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.0051, `${msg || 'valor'}: ${a} ≠ ${b}`);

let db;
let invocar;
test.before(async () => {
  ({ db, invocar } = await iniciar());
});
test.beforeEach(() => {
  limpiarDatos(db);
  ['Efectivo', 'Transferencia', 'Mercado Pago', 'Cheque'].forEach((m) => asegurarMetodo(db, m));
});

const saldoDe = (id) => db.prepare('SELECT saldo FROM clientes WHERE id = ?').get(id).saldo;
const factura = (id) => db.prepare('SELECT * FROM facturas WHERE id = ?').get(id);
const pagosDe = (id) => db.prepare('SELECT * FROM pagos WHERE factura_id = ? ORDER BY id').all(id);
const crearFactura = async (clienteId, items, tipo = 'cliente') => invocar('facturas:crear', { cliente_id: clienteId, tipo_precio: tipo, items });

test('una factura suma su total al saldo del cliente y arranca pendiente', async () => {
  const c = crearCliente(db, 'Alma');
  const p = crearProducto(db, { nombre: 'Asado', precio: 8000, unidad: 'kg' });
  const f = await crearFactura(c, [{ producto_id: p, cantidad: 2.5 }]);
  assert.equal(f.total, 20000);
  assert.equal(f.estado, 'pendiente');
  assert.equal(saldoDe(c), 20000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM factura_items WHERE factura_id = ?').get(f.id).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM factura_bultos').get().n, 1);
});

test('el precio de la línea manda; sin precio se usa el del catálogo según el tipo (cliente o CF)', async () => {
  const c = crearCliente(db, 'Bruno');
  const p = crearProducto(db, { nombre: 'Pollo', precio: 3000, precioCf: 3600, unidad: 'kg' });
  assert.equal((await crearFactura(c, [{ producto_id: p, cantidad: 1 }], 'cliente')).total, 3000);
  assert.equal((await crearFactura(c, [{ producto_id: p, cantidad: 1 }], 'cf')).total, 3600);
  assert.equal((await crearFactura(c, [{ producto_id: p, cantidad: 2, precio_unitario: 2500 }])).total, 5000);
});

test('un pago parcial deja la factura en "parcial" y uno que completa la deja "pagada"', async () => {
  const c = crearCliente(db, 'Camila');
  const p = crearProducto(db, { nombre: 'Vacío', precio: 1000 });
  const f = await crearFactura(c, [{ producto_id: p, cantidad: 10 }]);
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 4000, metodo_pago: 'Efectivo' });
  assert.equal(factura(f.id).estado, 'parcial');
  assert.equal(saldoDe(c), 6000);
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 6000, metodo_pago: 'Efectivo' });
  assert.equal(factura(f.id).estado, 'pagada');
  assert.ok(factura(f.id).fecha_pago);
  assert.equal(saldoDe(c), 0);
});

test('un pago mayor a lo que falta se topa en lo que falta (no genera saldo a favor)', async () => {
  const c = crearCliente(db, 'Dani');
  const p = crearProducto(db, { nombre: 'Costilla', precio: 1000 });
  const f = await crearFactura(c, [{ producto_id: p, cantidad: 5 }]);
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 9999, metodo_pago: 'Efectivo' });
  assert.equal(pagosDe(f.id)[0].monto, 5000);
  assert.equal(saldoDe(c), 0);
});

test('el cobro general reparte de la factura más vieja a la más nueva y valida el monto', async () => {
  const c = crearCliente(db, 'Eva');
  const p = crearProducto(db, { nombre: 'Chorizo', precio: 1000 });
  const f1 = await crearFactura(c, [{ producto_id: p, cantidad: 3 }]); // 3000
  const f2 = await crearFactura(c, [{ producto_id: p, cantidad: 2 }]); // 2000
  assert.equal((await invocar('clientes:registrarPagoGeneral', { cliente_id: c, monto: 0, metodo_pago: 'Efectivo' })).ok, false);
  assert.equal((await invocar('clientes:registrarPagoGeneral', { cliente_id: c, monto: 5001, metodo_pago: 'Efectivo' })).ok, false, 'más de lo que debe');
  assert.equal((await invocar('clientes:registrarPagoGeneral', { cliente_id: c, monto: 3500, metodo_pago: 'Efectivo' })).ok, true);
  assert.equal(factura(f1.id).estado, 'pagada');
  assert.equal(factura(f2.id).estado, 'parcial');
  assert.equal(pagosDe(f2.id)[0].monto, 500);
  assert.equal(saldoDe(c), 1500);
});

test('el cobro general acepta cobrar saldo inicial + factura juntos (el tope es el saldo, no solo las facturas)', async () => {
  const r = await invocar('clientes:crear', { nombre: 'Marta', apellido: 'Pérez', codigo: '', saldo_inicial: '17100' });
  const c = r.cliente.id;
  const p = crearProducto(db, { nombre: 'Milanesa', precio: 1000 });
  await crearFactura(c, [{ producto_id: p, cantidad: 15.9 }]); // 15900
  assert.equal(saldoDe(c), 33000, 'saldo inicial + factura');
  const resultado = await invocar('clientes:registrarPagoGeneral', { cliente_id: c, monto: 33000, metodo_pago: 'Efectivo' });
  assert.equal(resultado.ok, true, resultado.error);
  assert.equal(saldoDe(c), 0);
});

test('lo que se cobra del saldo inicial queda como cobro sin factura: figura en el historial, en la caja y se puede anular y reactivar', async () => {
  const r = await invocar('clientes:crear', { nombre: 'Marta', apellido: 'Pérez', codigo: '', saldo_inicial: '17100' });
  const c = r.cliente.id;
  const p = crearProducto(db, { nombre: 'Milanesa', precio: 1000 });
  const f = await crearFactura(c, [{ producto_id: p, cantidad: 15.9 }]); // 15900
  assert.equal((await invocar('clientes:registrarPagoGeneral', { cliente_id: c, monto: 33000, metodo_pago: 'Efectivo' })).ok, true);

  const sinFactura = db.prepare('SELECT * FROM pagos WHERE factura_id IS NULL').all();
  assert.equal(sinFactura.length, 1);
  assert.equal(sinFactura[0].monto, 17100, 'lo que sobró de las facturas es del saldo anterior');
  assert.equal(sinFactura[0].cliente_id, c);
  assert.equal(pagosDe(f.id)[0].monto, 15900);
  assert.equal(db.prepare('SELECT SUM(monto) t FROM pagos').get().t, 33000, 'entró todo lo cobrado');

  const historial = await invocar('clientes:historialPagos', c);
  cerca(historial.reduce((a, x) => a + x.monto, 0), 33000, 'el historial del cliente tiene los dos cobros');
  assert.ok(historial.some((x) => x.factura_id === null && x.monto === 17100));

  const dia = db.prepare("SELECT date('now', 'localtime') AS d").get().d;
  const cierre = await invocar('caja:obtenerDia', dia);
  cerca(cierre.cobros.reduce((a, x) => a + x.monto, 0), 33000, 'el cierre del día cuenta los $33.000');
  assert.ok(cierre.cobros.every((x) => /Marta/.test(x.cliente_nombre)), 'la parte sin factura también dice de quién es');

  // Anular el cobro entero: la factura vuelve a deber y el saldo vuelve a ser todo lo que debía.
  const ids = db.prepare('SELECT id FROM pagos').all().map((x) => x.id);
  assert.equal((await invocar('pagos:anular', { ids, motivo: 'prueba' })).ok, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM pagos').get().n, 0);
  assert.equal(factura(f.id).estado, 'pendiente');
  assert.equal(saldoDe(c), 33000);
  const anulado = db.prepare('SELECT * FROM cobros_anulados').get();
  assert.equal(anulado.cliente_id, c);
  assert.equal(anulado.facturas, String(f.id), 'solo lista facturas reales');

  // Reactivar: vuelve a estar todo como antes.
  assert.equal((await invocar('pagos:reactivarCobro', anulado.id)).ok, true);
  assert.equal(saldoDe(c), 0);
  assert.equal(factura(f.id).estado, 'pagada');
  assert.equal(db.prepare('SELECT monto FROM pagos WHERE factura_id IS NULL').get().monto, 17100);
});

test('se puede cobrar el saldo inicial solo (sin ninguna factura) y queda registrado', async () => {
  const r = await invocar('clientes:crear', { nombre: 'Rosa', apellido: '', codigo: '', saldo_inicial: '5000' });
  const c = r.cliente.id;
  assert.equal((await invocar('clientes:registrarPagoGeneral', { cliente_id: c, monto: 2000, metodo_pago: 'Efectivo' })).ok, true);
  assert.equal(saldoDe(c), 3000);
  const pago = db.prepare('SELECT * FROM pagos').get();
  assert.equal(pago.factura_id, null);
  assert.equal(pago.cliente_id, c);
  assert.equal(pago.monto, 2000);
  assert.equal((await invocar('clientes:eliminar', c)).ok, false, 'con cobros registrados no se puede borrar');
});

test('"de dónde sale el total cobrado": un renglón por cliente y método, suma lo mismo que el historial por día e incluye el saldo anterior', async () => {
  const p = crearProducto(db, { nombre: 'Asado', precio: 1000 });
  const pablo = crearCliente(db, 'Pablo');
  const rossi = crearCliente(db, 'Rossi');
  const fo = await crearFactura(pablo, [{ producto_id: p, cantidad: 0.2 }]); // 200
  const fs = await crearFactura(rossi, [{ producto_id: p, cantidad: 0.1 }]); // 100
  await invocar('facturas:registrarPago', { factura_id: fs.id, monto: 100, metodo_pago: 'Efectivo' });
  await invocar('facturas:registrarPago', { factura_id: fo.id, monto: 150, metodo_pago: 'Efectivo' });
  await invocar('facturas:registrarPago', { factura_id: fo.id, monto: 50, metodo_pago: 'Transferencia' });
  const gisela = (await invocar('clientes:crear', { nombre: 'Marta', apellido: 'F', codigo: '', saldo_inicial: '700' })).cliente.id;
  await invocar('clientes:registrarPagoGeneral', { cliente_id: gisela, monto: 700, metodo_pago: 'Efectivo' });

  const dia = db.prepare("SELECT date('now', 'localtime') AS d").get().d;
  const filas = await invocar('reportes:cobrosDelDia', dia);
  const resumen = filas.map((f) => `${f.nombre}|${f.metodo_pago}|${f.monto}`);
  assert.deepEqual(resumen, ['Rossi|Efectivo|100', 'Pablo|Efectivo|150', 'Pablo|Transferencia|50', 'Marta|Efectivo|700'], 'cada cliente junto, con una línea por método');
  const delHistorial = (await invocar('reportes:cobrosPorDia')).filter((x) => x.periodo === dia).reduce((a, x) => a + x.total, 0);
  cerca(filas.reduce((a, f) => a + f.monto, 0), delHistorial, 'la lista suma lo mismo que el total del día');
  assert.deepEqual(await invocar('reportes:cobrosDelDia', 'basura'), []);
});

test('cobrar con cheque exige banco y número, deja el cheque en cartera y no acepta repetidos', async () => {
  const c = crearCliente(db, 'Fabio');
  const p = crearProducto(db, { nombre: 'Matambre', precio: 1000 });
  await crearFactura(c, [{ producto_id: p, cantidad: 10 }]);
  const sin = await invocar('clientes:registrarPagoGeneral', { cliente_id: c, monto: 4000, metodo_pago: 'Cheque', cheque: {} });
  assert.equal(sin.ok, false);
  const con = await invocar('clientes:registrarPagoGeneral', { cliente_id: c, monto: 4000, metodo_pago: 'Cheque', cheque: { banco: 'Nación', numero: '00123' } });
  assert.equal(con.ok, true);
  const ch = db.prepare('SELECT * FROM cheques').all();
  assert.equal(ch.length, 1);
  assert.equal(ch[0].importe, 4000);
  assert.equal(ch[0].estado, 'en_cartera');
  const repetido = await invocar('clientes:registrarPagoGeneral', { cliente_id: c, monto: 1000, metodo_pago: 'Cheque', cheque: { banco: 'nacion', numero: '123' } });
  assert.equal(repetido.ok, false, 'el mismo cheque (sin acentos ni ceros a la izquierda) no se carga dos veces');
});

test('la retención por transferencia se genera como gasto, no aplica a efectivo, y se anula con el cobro', async () => {
  db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('retencion_transferencia', '0.2') ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor").run();
  const c = crearCliente(db, 'Gus');
  const p = crearProducto(db, { nombre: 'Lomo', precio: 1000 });
  const f = await crearFactura(c, [{ producto_id: p, cantidad: 100 }]); // 100.000
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 10000, metodo_pago: 'Efectivo' });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM gastos WHERE descripcion LIKE 'Retención%'").get().n, 0, 'efectivo no retiene');
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 50000, metodo_pago: 'Transferencia' });
  const ret = db.prepare("SELECT * FROM gastos WHERE descripcion LIKE 'Retención%'").all();
  assert.equal(ret.length, 1);
  assert.equal(ret[0].monto, 100); // 0,2 % de 50.000
  const idPago = pagosDe(f.id).find((x) => x.metodo_pago === 'Transferencia').id;
  const r = await invocar('pagos:anular', { ids: [idPago], motivo: 'Se cargó dos veces' });
  assert.equal(r.ok, true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM gastos WHERE descripcion LIKE 'Retención%'").get().n, 0, 'la retención se anula con el cobro');
  assert.equal(saldoDe(c), 90000);
  assert.equal(factura(f.id).estado, 'parcial');
});

test('anular un cobro: la factura vuelve a deber, el saldo sube, queda el motivo y no se anulan cheques', async () => {
  const c = crearCliente(db, 'Hernán');
  const p = crearProducto(db, { nombre: 'Bondiola', precio: 1000 });
  const f = await crearFactura(c, [{ producto_id: p, cantidad: 10 }]);
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 10000, metodo_pago: 'Mercado Pago' });
  assert.equal(factura(f.id).estado, 'pagada');
  const id = pagosDe(f.id)[0].id;
  assert.equal((await invocar('pagos:anular', { ids: [id], motivo: 'Error de carga' })).ok, true);
  assert.equal(factura(f.id).estado, 'pendiente');
  assert.equal(factura(f.id).fecha_pago, null);
  assert.equal(saldoDe(c), 10000);
  const anulado = db.prepare('SELECT * FROM cobros_anulados').get();
  assert.equal(anulado.monto, 10000);
  assert.equal(anulado.motivo, 'Error de carga');
  // Un cobro con cheque no se anula desde acá.
  await invocar('clientes:registrarPagoGeneral', { cliente_id: c, monto: 2000, metodo_pago: 'Cheque', cheque: { banco: 'Galicia', numero: '9' } });
  const idCheque = pagosDe(f.id).find((x) => x.metodo_pago === 'Cheque').id;
  assert.equal((await invocar('pagos:anular', { ids: [idCheque] })).ok, false);
});

test('anular una factura sin pagos baja el saldo; con pagos deja saldo a favor (nota de crédito)', async () => {
  const c = crearCliente(db, 'Ines');
  const p = crearProducto(db, { nombre: 'Pechuga', precio: 1000 });
  const f1 = await crearFactura(c, [{ producto_id: p, cantidad: 5 }]);
  assert.equal((await invocar('facturas:anular', { id: f1.id, motivo: 'Error' })).ok, true);
  assert.equal(saldoDe(c), 0);
  assert.equal((await invocar('facturas:anular', { id: f1.id })).ok, false, 'no se anula dos veces');

  const f2 = await crearFactura(c, [{ producto_id: p, cantidad: 10 }]);
  await invocar('facturas:registrarPago', { factura_id: f2.id, monto: 4000, metodo_pago: 'Efectivo' });
  const r = await invocar('facturas:anular', { id: f2.id, motivo: 'Cliente se arrepintió', destino: 'credito' });
  assert.equal(r.ok, true);
  assert.equal(r.credito, 4000);
  assert.equal(saldoDe(c), -4000, 'lo que pagó queda a su favor');
  assert.equal(db.prepare('SELECT credito FROM notas_credito').get().credito, 4000);
});

test('anular una factura devolviendo plata: pago negativo, valida método y tope', async () => {
  const c = crearCliente(db, 'Juan');
  const p = crearProducto(db, { nombre: 'Colita', precio: 1000 });
  const f = await crearFactura(c, [{ producto_id: p, cantidad: 10 }]);
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 10000, metodo_pago: 'Efectivo' });
  assert.equal((await invocar('facturas:anular', { id: f.id, destino: 'devolver', metodo: 'Cheque' })).ok, false, 'no se devuelve con cheque');
  assert.equal((await invocar('facturas:anular', { id: f.id, destino: 'devolver', metodo: 'Efectivo', monto: 99999 })).ok, false, 'no más de lo cobrado');
  const r = await invocar('facturas:anular', { id: f.id, destino: 'devolver', metodo: 'Efectivo', monto: 6000 });
  assert.equal(r.ok, true);
  assert.equal(r.devuelto, 6000);
  assert.equal(r.credito, 4000);
  assert.ok(pagosDe(f.id).some((x) => x.monto === -6000 && x.metodo_pago === 'Efectivo'));
  assert.equal(saldoDe(c), -4000);
});

test('el saldo a favor se usa solo en la factura siguiente (pago "Saldo a favor", sin mover el saldo)', async () => {
  const c = crearCliente(db, 'Kari');
  const p = crearProducto(db, { nombre: 'Molida', precio: 1000 });
  const f1 = await crearFactura(c, [{ producto_id: p, cantidad: 10 }]);
  await invocar('facturas:registrarPago', { factura_id: f1.id, monto: 10000, metodo_pago: 'Efectivo' });
  await invocar('facturas:anular', { id: f1.id, destino: 'credito' });
  assert.equal(saldoDe(c), -10000);
  const f2 = await crearFactura(c, [{ producto_id: p, cantidad: 4 }]); // 4000, se paga con el crédito
  assert.equal(factura(f2.id).estado, 'pagada');
  assert.equal(pagosDe(f2.id)[0].metodo_pago, 'Saldo a favor');
  assert.equal(saldoDe(c), -6000);
});

test('editar una factura del día recalcula total, estado y saldo', async () => {
  const c = crearCliente(db, 'Leo');
  const p = crearProducto(db, { nombre: 'Tapa de asado', precio: 1000 });
  const f = await crearFactura(c, [{ producto_id: p, cantidad: 10 }]);
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 6000, metodo_pago: 'Efectivo' });
  const r = await invocar('facturas:actualizar', { id: f.id, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 6 }] });
  assert.equal(r.ok, true);
  assert.equal(factura(f.id).total, 6000);
  assert.equal(factura(f.id).estado, 'pagada');
  assert.equal(saldoDe(c), 0);
  const r2 = await invocar('facturas:actualizar', { id: f.id, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 8 }] });
  assert.equal(factura(f.id).estado, 'parcial');
  assert.equal(saldoDe(c), 2000);
  db.prepare("UPDATE facturas SET fecha = datetime('now', 'localtime', '-2 days') WHERE id = ?").run(f.id);
  assert.equal((await invocar('facturas:actualizar', { id: f.id, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 1 }] })).ok, false, 'solo se edita el mismo día');
  assert.ok(r2.ok);
});

test('los centavos no se pierden: cantidades con decimales y varias facturas dejan el saldo justo', async () => {
  const c = crearCliente(db, 'Mati');
  const p = crearProducto(db, { nombre: 'Peceto', precio: 5499.99 });
  const f1 = await crearFactura(c, [{ producto_id: p, cantidad: 1.234 }]);
  const f2 = await crearFactura(c, [{ producto_id: p, cantidad: 2.345 }]);
  const debe = (id) => {
    const f = factura(id);
    return f.total - pagosDe(id).reduce((a, x) => a + x.monto, 0);
  };
  // Se paga lo que muestra la pantalla (total redondeado al centavo).
  await invocar('facturas:registrarPago', { factura_id: f1.id, monto: Math.round(f1.total * 100) / 100, metodo_pago: 'Efectivo' });
  await invocar('facturas:registrarPago', { factura_id: f2.id, monto: Math.round(f2.total * 100) / 100, metodo_pago: 'Efectivo' });
  assert.equal(factura(f1.id).estado, 'pagada');
  assert.equal(factura(f2.id).estado, 'pagada');
  cerca(debe(f1.id), 0, 'deuda f1');
  cerca(debe(f2.id), 0, 'deuda f2');
  cerca(saldoDe(c), 0, 'saldo del cliente tras pagar todo');
});

test('el negocio del cliente se guarda, se puede editar, y la búsqueda por código/CUIT sigue igual', async () => {
  const r = await invocar('clientes:crear', { nombre: 'Alma', apellido: 'Rodríguez', negocio: 'Kiosco El Sol', codigo: '' });
  assert.equal(r.ok, true);
  assert.equal(r.cliente.negocio, 'Kiosco El Sol');
  // Sin negocio: queda null, no ''.
  const r2 = await invocar('clientes:crear', { nombre: 'Bruno', codigo: '' });
  assert.equal(r2.cliente.negocio, null);
  // Se puede editar.
  const upd = await invocar('clientes:actualizar', { id: r.cliente.id, nombre: 'Alma', apellido: 'Rodríguez', negocio: 'Almacén Don Pepe', codigo: r.cliente.codigo });
  assert.equal(upd.ok, true);
  assert.equal(upd.cliente.negocio, 'Almacén Don Pepe');
  // Se puede sacar (queda en null).
  const upd2 = await invocar('clientes:actualizar', { id: r.cliente.id, nombre: 'Alma', apellido: 'Rodríguez', negocio: '', codigo: r.cliente.codigo });
  assert.equal(upd2.cliente.negocio, null);
});

test('saldo inicial de un cliente: se suma al saldo, y si se edita después se ajusta por la diferencia (no lo pisa)', async () => {
  const r = await invocar('clientes:crear', { nombre: 'Eva', apellido: 'Ríos', codigo: '', saldo_inicial: '5000' });
  assert.equal(r.ok, true);
  assert.equal(r.cliente.saldo_inicial, 5000);
  assert.equal(r.cliente.saldo, 5000, 'el saldo inicial ya cuenta como saldo, sin necesidad de facturar nada');
  const p = crearProducto(db, { nombre: 'Vacío', precio: 1000 });
  const factura = await invocar('facturas:crear', {
    cliente_id: r.cliente.id,
    tipo_precio: 'cliente',
    items: [{ producto_id: p, cantidad: 1 }],
  });
  const clienteConFactura = (await invocar('clientes:listar')).find((x) => x.id === r.cliente.id);
  cerca(clienteConFactura.saldo, 5000 + factura.total, 'el saldo inicial sigue sumado después de facturar');
  // Editar el saldo inicial más tarde ajusta el saldo por la diferencia, no lo reemplaza (ya puede haber actividad real).
  const upd = await invocar('clientes:actualizar', { id: r.cliente.id, nombre: 'Eva', apellido: 'Ríos', codigo: r.cliente.codigo, saldo_inicial: '2000' });
  assert.equal(upd.ok, true);
  assert.equal(upd.cliente.saldo_inicial, 2000);
  const clienteEditado = (await invocar('clientes:listar')).find((x) => x.id === r.cliente.id);
  cerca(clienteEditado.saldo, 2000 + factura.total, 'bajó el saldo inicial en 3000 y el saldo bajó lo mismo, sin tocar lo facturado');
});

test('segundo WhatsApp de un cliente: se guarda con su nombre y aparece en facturas:listar', async () => {
  const r = await invocar('clientes:crear', {
    nombre: 'Fabio',
    apellido: 'Ibarra',
    codigo: '',
    telefono: '3511111111',
    telefono2: '3512222222',
    telefono2_nombre: 'Marisa (la socia)',
  });
  assert.equal(r.ok, true);
  assert.equal(r.cliente.telefono2, '3512222222');
  assert.equal(r.cliente.telefono2_nombre, 'Marisa (la socia)');
  const p = crearProducto(db, { nombre: 'Vacío', precio: 1000 });
  const factura = await invocar('facturas:crear', {
    cliente_id: r.cliente.id,
    tipo_precio: 'cliente',
    items: [{ producto_id: p, cantidad: 1 }],
  });
  const listado = (await invocar('facturas:listar')).find((f) => f.id === factura.id);
  assert.equal(listado.cliente_telefono, '3511111111');
  assert.equal(listado.cliente_telefono2, '3512222222');
  assert.equal(listado.cliente_telefono2_nombre, 'Marisa (la socia)');
});

test('el buscador general encuentra al cliente tanto por su nombre como por el del negocio', async () => {
  await invocar('clientes:crear', { nombre: 'Camila', apellido: 'Núñez', negocio: 'Despensa La Esquina', codigo: '' });
  const porPersona = await invocar('buscar:todo', 'Camila Nuñez');
  assert.ok(porPersona.grupos.clientes.items.some((c) => c.nombre.includes('Camila Núñez')));
  const porNegocio = await invocar('buscar:todo', 'despensa esquina');
  assert.ok(porNegocio.grupos.clientes.items.some((c) => c.nombre.includes('Camila Núñez')), 'tiene que encontrarla buscando por el negocio');
  assert.ok(porNegocio.grupos.clientes.items.some((c) => c.nombre.includes('Despensa La Esquina')), 'el negocio se muestra entre paréntesis');
});

test('el código del cliente también se busca (buscador general)', async () => {
  const c = await invocar('clientes:crear', { nombre: 'Damián', apellido: 'Molina', codigo: 'D99' });
  assert.equal(c.ok, true);
  const r = await invocar('buscar:todo', 'D99');
  assert.ok(r.grupos.clientes.items.some((x) => x.nombre.includes('Damián Molina')));
});

test('reactivar un cobro anulado lo recrea tal cual, con su fecha, y no se puede reactivar dos veces', async () => {
  const c = crearCliente(db, 'Nina');
  const p = crearProducto(db, { nombre: 'Vacío', precio: 1000 });
  const f = await crearFactura(c, [{ producto_id: p, cantidad: 10 }]);
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 4000, metodo_pago: 'Efectivo' });
  const idPago = pagosDe(f.id)[0].id;
  const fechaOriginal = pagosDe(f.id)[0].fecha;
  await invocar('pagos:anular', { ids: [idPago], motivo: 'Error de carga' });
  assert.equal(pagosDe(f.id).length, 0);
  assert.equal(saldoDe(c), 10000);
  const anulado = db.prepare('SELECT * FROM cobros_anulados WHERE cliente_id = ?').get(c);
  assert.equal(anulado.reactivado_en, null);
  const r = await invocar('pagos:reactivarCobro', anulado.id);
  assert.equal(r.ok, true);
  assert.equal(factura(f.id).estado, 'parcial');
  assert.equal(saldoDe(c), 6000);
  assert.equal(pagosDe(f.id).length, 1);
  assert.equal(pagosDe(f.id)[0].monto, 4000);
  assert.equal(pagosDe(f.id)[0].fecha, fechaOriginal, 'vuelve con la fecha original, no con la de hoy');
  const r2 = await invocar('pagos:reactivarCobro', anulado.id);
  assert.equal(r2.ok, false, 'no se puede reactivar dos veces');
});

test('reactivar un cobro con retención vuelve a generar el gasto de la retención', async () => {
  db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('retencion_transferencia', '0.2') ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor").run();
  const c = crearCliente(db, 'Pablo');
  const p = crearProducto(db, { nombre: 'Osobuco', precio: 1000 });
  const f = await crearFactura(c, [{ producto_id: p, cantidad: 100 }]);
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 50000, metodo_pago: 'Transferencia' });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM gastos WHERE descripcion LIKE 'Retención%'").get().n, 1);
  const idPago = pagosDe(f.id)[0].id;
  const anuladoId = await invocar('pagos:anular', { ids: [idPago] }).then(() => db.prepare('SELECT id FROM cobros_anulados WHERE cliente_id = ?').get(c).id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM gastos WHERE descripcion LIKE 'Retención%'").get().n, 0);
  await invocar('pagos:reactivarCobro', anuladoId);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM gastos WHERE descripcion LIKE 'Retención%'").get().n, 1, 'la retención se recrea');
  assert.equal(db.prepare("SELECT monto FROM gastos WHERE descripcion LIKE 'Retención%'").get().monto, 100);
});

test('no se puede reactivar un cobro si la factura se anuló después', async () => {
  const c = crearCliente(db, 'Pia');
  const p = crearProducto(db, { nombre: 'Falda', precio: 1000 });
  const f = await crearFactura(c, [{ producto_id: p, cantidad: 5 }]);
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 2000, metodo_pago: 'Efectivo' });
  const idPago = pagosDe(f.id)[0].id;
  await invocar('pagos:anular', { ids: [idPago] });
  const anuladoId = db.prepare('SELECT id FROM cobros_anulados WHERE cliente_id = ?').get(c).id;
  await invocar('facturas:anular', { id: f.id, motivo: 'ya no va' });
  const r = await invocar('pagos:reactivarCobro', anuladoId);
  assert.equal(r.ok, false);
});

test('reactivar una factura anulada la devuelve al estado anterior', async () => {
  const c = crearCliente(db, 'Quique');
  const p = crearProducto(db, { nombre: 'Roast beef', precio: 1000 });
  const f = await crearFactura(c, [{ producto_id: p, cantidad: 10 }]);
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 4000, metodo_pago: 'Efectivo' });
  assert.equal(factura(f.id).estado, 'parcial');
  const r0 = await invocar('facturas:anular', { id: f.id, motivo: 'x', destino: 'credito' });
  assert.equal(r0.ok, true);
  assert.equal(factura(f.id).estado, 'anulada');
  assert.equal(saldoDe(c), -4000);
  const r1 = await invocar('facturas:reactivar', f.id);
  assert.equal(r1.ok, true);
  assert.equal(factura(f.id).estado, 'parcial', 'vuelve al estado que tenía antes de anularla');
  assert.equal(saldoDe(c), 6000, 'vuelve a deber lo que debía');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notas_credito WHERE factura_id = ?').get(f.id).n, 0);
  const r2 = await invocar('facturas:reactivar', f.id);
  assert.equal(r2.ok, false, 'no está anulada, no hay nada que reactivar');
});

test('reactivar una factura anulada con devolución saca el pago de la devolución', async () => {
  const c = crearCliente(db, 'Rosa');
  const p = crearProducto(db, { nombre: 'Cuadril', precio: 1000 });
  const f = await crearFactura(c, [{ producto_id: p, cantidad: 10 }]);
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 10000, metodo_pago: 'Efectivo' });
  await invocar('facturas:anular', { id: f.id, motivo: 'x', destino: 'devolver', metodo: 'Efectivo', monto: 6000 });
  assert.equal(saldoDe(c), -4000);
  const r = await invocar('facturas:reactivar', f.id);
  assert.equal(r.ok, true);
  assert.equal(factura(f.id).estado, 'pagada');
  assert.equal(saldoDe(c), 0);
  assert.ok(!pagosDe(f.id).some((x) => x.monto < 0), 'el pago de la devolución se sacó');
});

test('no se puede reactivar una factura si su saldo a favor ya se gastó en otra', async () => {
  const c = crearCliente(db, 'Susi');
  const p = crearProducto(db, { nombre: 'Entraña', precio: 1000 });
  const f1 = await crearFactura(c, [{ producto_id: p, cantidad: 10 }]);
  await invocar('facturas:registrarPago', { factura_id: f1.id, monto: 10000, metodo_pago: 'Efectivo' });
  await invocar('facturas:anular', { id: f1.id, motivo: 'x', destino: 'credito' });
  assert.equal(saldoDe(c), -10000);
  const f2 = await crearFactura(c, [{ producto_id: p, cantidad: 4 }]); // se paga sola con el crédito
  assert.equal(factura(f2.id).estado, 'pagada');
  assert.equal(saldoDe(c), -6000, 'quedan 6000 de crédito sin usar');
  const r = await invocar('facturas:reactivar', f1.id);
  assert.equal(r.ok, false, 'ya se gastaron 4000 del crédito en la factura 2');
});
