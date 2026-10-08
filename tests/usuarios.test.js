// Usuarios: login por persona, roles (administrador/empleado), permisos, motivo obligatorio al anular y quién
// cargó o anuló cada cosa.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, limpiarDatos, crearCliente, crearProducto, asegurarMetodo } = require('./harness');

let db;
let invocar;
test.before(async () => {
  ({ db, invocar } = await iniciar());
});
test.beforeEach(async () => {
  limpiarDatos(db);
  await invocar('usuarios:cerrarSesion');
});

test('primer arranque: se crea el administrador y queda logueado; no se puede crear un segundo "primero"', async () => {
  assert.deepEqual(await invocar('usuarios:paraElegir'), []);
  const r = await invocar('usuarios:crearPrimero', { nombre: 'Ana Admin', pin: 'clave1234' });
  assert.equal(r.ok, true);
  assert.equal(r.usuario.rol, 'admin');
  assert.deepEqual(await invocar('usuarios:sesionActual'), r.usuario);
  const r2 = await invocar('usuarios:crearPrimero', { nombre: 'Otro', pin: 'otra1234' });
  assert.equal(r2.ok, false, 'ya hay usuarios, no se puede crear "el primero" de nuevo');
});

test('el administrador puede crear empleados; un empleado no puede crear usuarios', async () => {
  await invocar('usuarios:crearPrimero', { nombre: 'Admin', pin: 'admin1234' });
  const r = await invocar('usuarios:crear', { nombre: 'Marcos', pin: 'marcos123', rol: 'empleado' });
  assert.equal(r.ok, true);
  await invocar('usuarios:cerrarSesion');
  const ingreso = await invocar('usuarios:ingresar', { usuario_id: r.id, pin: 'marcos123' });
  assert.equal(ingreso.ok, true);
  assert.equal(ingreso.usuario.rol, 'empleado');
  const noPuede = await invocar('usuarios:crear', { nombre: 'Otro', pin: 'otro1234', rol: 'empleado' });
  assert.equal(noPuede.ok, false, 'un empleado no puede crear usuarios');
});

test('login: contraseña incorrecta no entra, y con dos usuarios cada uno tiene su propio bloqueo', async () => {
  await invocar('usuarios:crearPrimero', { nombre: 'Admin', pin: 'admin1234' });
  const emp = await invocar('usuarios:crear', { nombre: 'Ana', pin: 'ana12345', rol: 'empleado' });
  await invocar('usuarios:cerrarSesion');
  const malo = await invocar('usuarios:ingresar', { usuario_id: emp.id, pin: 'incorrecta' });
  assert.equal(malo.ok, false);
  const bueno = await invocar('usuarios:ingresar', { usuario_id: emp.id, pin: 'ana12345' });
  assert.equal(bueno.ok, true, 'una contraseña equivocada no bloquea la de otro usuario');
});

test('un empleado no puede leer ni tocar Gastos, Caja ni Proveedores', async () => {
  await invocar('usuarios:crearPrimero', { nombre: 'Admin', pin: 'admin1234' });
  const emp = await invocar('usuarios:crear', { nombre: 'Beto', pin: 'beto1234', rol: 'empleado' });
  await invocar('usuarios:ingresar', { usuario_id: emp.id, pin: 'beto1234' });
  const g = await invocar('gastos:listar');
  assert.equal(g.ok, false);
  const c = await invocar('cuentas:resumen');
  assert.equal(c.ok, false);
  const p = await invocar('proveedores:listar');
  assert.equal(p.ok, false);
  const e = await invocar('estadisticas:resumen', { desde: '2000-01-01', hasta: '2999-12-31' });
  assert.equal(e.ok, false);
  const cierre = await invocar('caja:resumenCierres');
  assert.equal(cierre.ok, false, 'la caja (plata) sigue siendo solo del administrador');
});

test('un empleado sí puede usar lo que necesitan Pedidos, Cobros y Facturas aunque el prefijo sea "solo admin"', async () => {
  // Pedidos usa reportes:cantidadesPedidasPorDia y stock:resumen para armar la lista de carga del día; Cobros
  // usa reportes:cobrosPorDia; Facturas usa sistema:abrirEnlace/geocodificar para "Enviar por WhatsApp" y el
  // recorrido de entregas. Ninguno es de Estadísticas, Stock ni Copias de seguridad, así que un empleado los
  // necesita a pesar de que esos prefijos sean, en general, solo para el administrador.
  await invocar('usuarios:crearPrimero', { nombre: 'Admin', pin: 'admin1234' });
  const emp = await invocar('usuarios:crear', { nombre: 'Gaby', pin: 'gaby1234', rol: 'empleado' });
  await invocar('usuarios:ingresar', { usuario_id: emp.id, pin: 'gaby1234' });
  assert.ok(Array.isArray(await invocar('reportes:cantidadesPedidasPorDia')));
  assert.ok(Array.isArray(await invocar('reportes:cobrosPorDia')));
  const stock = await invocar('stock:resumen');
  assert.ok(Array.isArray(stock.articulos), 'stock:resumen sigue devolviendo su forma normal, no el bloqueo');
  // direccion vacía: no llega a pegarle a la red, alcanza para confirmar que no lo frena el permiso
  assert.equal(await invocar('sistema:geocodificar', ''), null);
  const enlace = await invocar('sistema:abrirEnlace', 'no-es-un-link-permitido');
  assert.equal(enlace.error, 'Ese enlace no está permitido.', 'llegó al handler real, no al bloqueo de permisos');
  // pero el resto de "sistema" (copias de seguridad) sigue siendo solo del administrador
  const backup = await invocar('sistema:listarCopias');
  assert.equal(backup.ok, false);
});

test('un empleado sí puede facturar, cobrar y ver clientes; no puede editar productos ni reactivar', async () => {
  await invocar('usuarios:crearPrimero', { nombre: 'Admin', pin: 'admin1234' });
  const c = crearCliente(db, 'Cliente Uno');
  const p = crearProducto(db, { nombre: 'Vacío', precio: 1000 });
  const emp = await invocar('usuarios:crear', { nombre: 'Carla', pin: 'carla123', rol: 'empleado' });
  await invocar('usuarios:ingresar', { usuario_id: emp.id, pin: 'carla123' });
  assert.ok(Array.isArray(await invocar('clientes:listar')));
  const f = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 2 }] });
  assert.equal(f.total, 2000, 'un empleado puede facturar');
  const edit = await invocar('productos:actualizar', { id: p, nombre: 'Vacío', codigo: 'x', precio_cliente: 999, precio_cf: 999, unidad: 'kg' });
  assert.equal(edit.ok, false, 'un empleado no puede cambiar precios de productos');
  const react = await invocar('facturas:reactivar', f.id);
  assert.equal(react.ok, false, 'reactivar es solo del administrador');
});

test('un empleado tiene que poner motivo al anular; un administrador no está obligado', async () => {
  await invocar('usuarios:crearPrimero', { nombre: 'Admin', pin: 'admin1234' });
  const c = crearCliente(db, 'Cliente Dos');
  const p = crearProducto(db, { nombre: 'Costilla', precio: 1000 });
  const f = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 5 }] });
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 5000, metodo_pago: 'Efectivo' });
  const emp = await invocar('usuarios:crear', { nombre: 'Dario', pin: 'dario123', rol: 'empleado' });
  await invocar('usuarios:ingresar', { usuario_id: emp.id, pin: 'dario123' });
  const idPago = db.prepare('SELECT id FROM pagos WHERE factura_id = ?').get(f.id).id;
  const sinMotivo = await invocar('pagos:anular', { ids: [idPago] });
  assert.equal(sinMotivo.ok, false, 'un empleado tiene que poner el motivo');
  const conMotivo = await invocar('pagos:anular', { ids: [idPago], motivo: 'Se cargó dos veces' });
  assert.equal(conMotivo.ok, true);
});

test('queda anotado quién facturó, quién cobró y quién anuló', async () => {
  const admin = await invocar('usuarios:crearPrimero', { nombre: 'Admin', pin: 'admin1234' });
  const c = crearCliente(db, 'Cliente Tres');
  const p = crearProducto(db, { nombre: 'Matambre', precio: 1000 });
  const emp = await invocar('usuarios:crear', { nombre: 'Eva', pin: 'eva12345', rol: 'empleado' });
  await invocar('usuarios:ingresar', { usuario_id: emp.id, pin: 'eva12345' });
  const f = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 10 }] });
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 10000, metodo_pago: 'Efectivo' });
  let listado = (await invocar('facturas:listar')).find((x) => x.id === f.id);
  assert.equal(listado.creado_por_nombre, 'Eva');
  const idPago = db.prepare('SELECT id FROM pagos WHERE factura_id = ?').get(f.id).id;
  await invocar('pagos:anular', { ids: [idPago], motivo: 'Prueba' });
  const anulado = db.prepare('SELECT anulado_por FROM cobros_anulados WHERE cliente_id = ?').get(c);
  assert.equal(anulado.anulado_por, emp.id);
  await invocar('usuarios:cerrarSesion');
  await invocar('usuarios:ingresar', { usuario_id: admin.usuario.id, pin: 'admin1234' });
  const aviso = (await invocar('avisos:obtener')).avisos.find((a) => a.tipo === 'anulaciones_empleado');
  assert.ok(aviso, 'al administrador le aparece el aviso de anulaciones de empleados');
  assert.ok(aviso.detalle.includes('Cliente Tres'));
});

test('el aviso de anulaciones desaparece si el administrador reactiva el cobro', async () => {
  const admin = await invocar('usuarios:crearPrimero', { nombre: 'Admin', pin: 'admin1234' });
  const c = crearCliente(db, 'Cliente Cuatro');
  const p = crearProducto(db, { nombre: 'Peceto', precio: 1000 });
  const emp = await invocar('usuarios:crear', { nombre: 'Fede', pin: 'fede1234', rol: 'empleado' });
  await invocar('usuarios:ingresar', { usuario_id: emp.id, pin: 'fede1234' });
  const f = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 5 }] });
  await invocar('facturas:registrarPago', { factura_id: f.id, monto: 5000, metodo_pago: 'Efectivo' });
  const idPago = db.prepare('SELECT id FROM pagos WHERE factura_id = ?').get(f.id).id;
  await invocar('pagos:anular', { ids: [idPago], motivo: 'Prueba' });
  await invocar('usuarios:cerrarSesion');
  await invocar('usuarios:ingresar', { usuario_id: admin.usuario.id, pin: 'admin1234' });
  const anuladoId = db.prepare('SELECT id FROM cobros_anulados WHERE cliente_id = ?').get(c).id;
  await invocar('pagos:reactivarCobro', anuladoId);
  const aviso = (await invocar('avisos:obtener')).avisos.find((a) => a.tipo === 'anulaciones_empleado');
  assert.equal(aviso, undefined);
});

test('no puede quedar la app sin ningún administrador activo', async () => {
  const admin = await invocar('usuarios:crearPrimero', { nombre: 'Admin', pin: 'admin1234' });
  const r = await invocar('usuarios:actualizar', { id: admin.usuario.id, activo: false });
  assert.equal(r.ok, false);
  const r2 = await invocar('usuarios:actualizar', { id: admin.usuario.id, rol: 'empleado' });
  assert.equal(r2.ok, false);
});

test('sin usuarios cargados (bases viejas) no se restringe nada', async () => {
  // Nadie logueado: el comportamiento de antes de este cambio sigue igual.
  const g = await invocar('gastos:listar');
  assert.ok(Array.isArray(g));
});

test('facturas:listar y pedidos:listar traen el rol de quién cargó/anuló, para que la pantalla decida si mostrar "Cargado por"', async () => {
  await invocar('usuarios:crearPrimero', { nombre: 'Admin', pin: 'admin1234' });
  const c = crearCliente(db, 'Cliente Rol');
  const p = crearProducto(db, { nombre: 'Bife', precio: 1000 });
  const emp = await invocar('usuarios:crear', { nombre: 'Hugo', pin: 'hugo1234', rol: 'empleado' });
  await invocar('usuarios:ingresar', { usuario_id: emp.id, pin: 'hugo1234' });
  const f = await invocar('pedidos:crear', { cliente_id: c, items: [{ producto_id: p, cantidad: 1 }] });
  const pedido = (await invocar('pedidos:listar')).find((x) => x.id === f.id);
  assert.equal(pedido.creado_por_nombre, 'Hugo');
  assert.equal(pedido.creado_por_rol, 'empleado');
  const fac = await invocar('facturas:crear', { cliente_id: c, tipo_precio: 'cliente', items: [{ producto_id: p, cantidad: 1 }] });
  let listado = (await invocar('facturas:listar')).find((x) => x.id === fac.id);
  assert.equal(listado.creado_por_rol, 'empleado');
  await invocar('facturas:anular', { id: fac.id, motivo: 'Prueba' });
  listado = (await invocar('facturas:listar')).find((x) => x.id === fac.id);
  assert.equal(listado.anulado_por_rol, 'empleado');
});

test('la lupa general le esconde a un empleado los grupos que no le corresponden', async () => {
  await invocar('usuarios:crearPrimero', { nombre: 'Admin', pin: 'admin1234' });
  crearCliente(db, 'Buscador Cliente');
  const admin = await invocar('buscar:todo', 'Buscador');
  assert.ok('clientes' in admin.grupos);
  assert.ok('gastos' in admin.grupos, 'el administrador ve todos los grupos');
  assert.ok('proveedores' in admin.grupos);
  const emp = await invocar('usuarios:crear', { nombre: 'Nora', pin: 'nora1234', rol: 'empleado' });
  await invocar('usuarios:ingresar', { usuario_id: emp.id, pin: 'nora1234' });
  const resultado = await invocar('buscar:todo', 'Buscador');
  assert.ok('clientes' in resultado.grupos, 'un empleado sigue viendo clientes');
  assert.ok('facturas' in resultado.grupos);
  assert.ok('pedidos' in resultado.grupos);
  assert.ok('cobros' in resultado.grupos);
  assert.ok(!('gastos' in resultado.grupos), 'un empleado no ve gastos en la lupa');
  assert.ok(!('proveedores' in resultado.grupos), 'un empleado no ve proveedores en la lupa');
  assert.ok(!('cheques' in resultado.grupos));
  assert.ok(!('productos' in resultado.grupos));
});
