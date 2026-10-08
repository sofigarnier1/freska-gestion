// Prueba de humo: arma una base con un poco de todo (clientes, facturas, cobros, gastos, cheques, proveedores, stock, pedidos
// por unidad, Fondos personales con ingresos, retiros y pases) y llama a todas las lecturas que usan las pantallas. Si un
// cambio en una parte rompe una pantalla de otra (como pasó con la Caja general y los pases de Fondos personales), acá salta.
// No comprueba cifras (para eso están los otros tests): comprueba que nada falle.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, limpiarDatos, crearCliente, crearProducto, asegurarMetodo } = require('./harness');

let db;
let invocar;
let servicios;
test.before(async () => {
  ({ db, invocar, servicios } = await iniciar());
});

const hoy = () => db.prepare("SELECT date('now', 'localtime') AS d").get().d;

test('todas las pantallas leen sin errores con datos de todo tipo cargados', async () => {
  limpiarDatos(db);
  db.prepare('DELETE FROM operaciones_caja').run();
  db.prepare("DELETE FROM metodos_pago WHERE nombre IN ('MercadoPago', 'Personal Pay')").run();
  ['Efectivo', 'Mercado Pago', 'Personal Pay', 'Cheque'].forEach((m) => asegurarMetodo(db, m));
  const dia = hoy();

  // Ventas: cliente, producto por kilo pedible por unidad, factura, cobro en efectivo y por banco
  const cliente = crearCliente(db, 'Ana');
  const chorizo = crearProducto(db, { nombre: 'Chorizo seco', precio: 9000, unidad: 'kg' });
  db.prepare('UPDATE productos SET pedible_por_unidad = 1, peso_unidad_pedido = 0.2 WHERE id = ?').run(chorizo);
  const asado = crearProducto(db, { nombre: 'Asado', precio: 8000, unidad: 'kg' });
  await invocar('pedidos:crear', { cliente_id: cliente, items: [{ producto_id: chorizo, cantidad: 6, unidad_pedido: 'unidad' }, { producto_id: asado, cantidad: 2 }] });
  const factura = await invocar('facturas:crear', { cliente_id: cliente, tipo_precio: 'cliente', items: [{ producto_id: asado, cantidad: 3 }] });
  await invocar('facturas:registrarPago', { factura_id: factura.id, monto: 10000, metodo_pago: 'Efectivo' });
  await invocar('facturas:registrarPago', { factura_id: factura.id, monto: 5000, metodo_pago: 'Mercado Pago' });

  // Caja: saldos, un pase de la Caja, un gasto del negocio y uno personal
  await invocar('cuentas:guardarSaldos', { desde: dia, saldos: { Efectivo: 50000, 'Mercado Pago': 100000, 'Personal Pay': 20000 } });
  await invocar('operaciones:pase', { fecha: dia, origen: 'Efectivo', destino: 'Mercado Pago', monto: 1000 });
  await invocar('operaciones:interes', { fecha: dia, cuenta: 'Mercado Pago', tipo: 'ganado', monto: 50 });
  await invocar('gastos:crearCategoria', { nombre: 'Sueldos', ambito: 'negocio' });
  const catNegocio = db.prepare("SELECT id FROM categorias_gasto WHERE nombre = 'Sueldos' AND ambito = 'negocio'").get().id;
  await invocar('gastos:crear', { fecha: dia, categoria_id: catNegocio, descripcion: 'Sueldo', monto: 3000, medio_pago: 'Efectivo', cuenta: '', observacion: '', tarjeta: '' });
  await invocar('caja:guardarCierre', { fecha: dia, fondo_inicial: 50000, efectivo_contado: null });

  // Fondos personales: ingreso con retención, retiro, pases en las dos direcciones, ajuste
  db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('retencion_transferencia', '1.2') ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor").run();
  const categoria = (await invocar('ingresos:categorias'))[0].id;
  await invocar('ingresos:crear', { fecha: dia, categoria_id: categoria, descripcion: 'Gabriela', monto: 100000, cuenta: 'Mercado Pago', con_retencion: true });
  await invocar('ingresos:crear', { fecha: dia, categoria_id: categoria, descripcion: 'Efectivo', monto: 5000, cuenta: 'Efectivo personal' });
  await invocar('ingresos:crearRetiro', { fecha: dia, categoria_id: categoria, descripcion: 'Moto', monto: 12000, cuenta: 'Mercado Pago' });
  await invocar('ingresos:crearPase', { fecha: dia, monto: 20000, sentido: 'a_personal', cuenta_negocio: 'Efectivo', cuenta_personal: 'Efectivo personal' });
  await invocar('ingresos:crearPase', { fecha: dia, monto: 7000, sentido: 'al_negocio', cuenta_negocio: 'Mercado Pago', cuenta_personal: 'Mercado Pago' });
  // (más pases que operaciones de la Caja, para que sus ids no coincidan: así se detecta si se mezclan las dos listas)
  await invocar('ingresos:crearPase', { fecha: dia, monto: 3000, sentido: 'a_personal', cuenta_negocio: 'Personal Pay', cuenta_personal: 'Personal Pay' });
  await invocar('ingresos:ajustarSaldo', { cuenta: 'Personal Pay', saldo: 4000 });
  // un ingreso viejo (de antes de Fondos personales) que suma a la caja
  db.prepare("INSERT INTO ingresos (fecha, descripcion, monto, cuenta) VALUES (?, 'Viejo', 7000, 'Personal Pay')").run(dia);

  const anio = Number(dia.slice(0, 4));
  const mes = Number(dia.slice(5, 7));
  const lecturas = [
    ['avisos:obtener'], ['buscar:todo', 'a'], ['buscar:todo', '1000'], ['buscar:todo', 'pase'],
    ['caja:obtenerDia', dia], ['caja:resumenMes', { anio, mes }], ['carga:hoy'],
    ['cheques:listar', {}], ['cheques:listar', { estado: 'en_cartera' }],
    ['clientes:listar'], ['config:obtenerRetencionTransferencia'], ['config:obtenerTema'],
    ['cuentas:resumen'], ['cuentas:movimientos', 'Efectivo'], ['cuentas:movimientos', 'Mercado Pago'], ['cuentas:movimientos', 'Personal Pay'],
    ['estadisticas:resumen', {}], ['estadisticas:resumen', { desde: dia, hasta: dia }], ['estadisticas:pendiente'], ['estadisticas:rankings', {}],
    ['facturas:listar'], ['facturas:items', factura.id],
    ['gastos:categorias'], ['gastos:cuotasPendientes'], ['gastos:descripciones'], ['gastos:listar'],
    ['inflacion:listar'], ['ingresos:categorias'], ['ingresos:descripciones'], ['ingresos:listar'], ['ingresos:comprasDolares'], ['ingresos:resultado', { desde: '2026-01-01', hasta: '2026-12-31' }], ['ingresos:resultadoDetalle', { categoria_id: null, desde: '2026-01-01', hasta: '2026-12-31' }], ['ingresos:pases'], ['ingresos:retiros'], ['ingresos:saldos'], ['ingresos:movimientos', 'Mercado Pago'], ['ingresos:movimientos', 'Efectivo personal'],
    ['insumos:listar'], ['metodosPago:listar'], ['operaciones:listar'],
    ['pedidos:listar'], ['productos:listar'], ['proveedores:listar'],
    ['reportes:cantidadesPedidasPorDia'], ['reportes:cantidadesPedidasPorMes'], ['reportes:saldosPorCliente'],
    ['stock:resumen'], ['stock:movimientos', { desde: '2026-01-01', hasta: '2026-12-31' }], ['stock:producidoPorArticulo', { desde: '2026-01-01', hasta: '2026-12-31' }], ['stock:sinTipo', { desde: '2026-01-01', hasta: '2026-12-31' }], ['tarjetas:listar'], ['usuarios:listar'], ['vendedores:listar'],
  ];
  const fallas = [];
  for (const [canal, ...args] of lecturas) {
    if (!servicios.has(canal)) {
      fallas.push(`${canal}: no existe`);
      continue;
    }
    try {
      const r = await invocar(canal, ...args);
      if (r && r.ok === false && !/inválid|no es válid/i.test(String(r.error))) fallas.push(`${canal}: ${r.error}`);
    } catch (e) {
      fallas.push(`${canal}: ${e.message}`);
    }
  }
  // los pedidos del día con sus líneas
  for (const p of await invocar('pedidos:listar')) {
    try {
      await invocar('pedidos:items', p.id);
    } catch (e) {
      fallas.push(`pedidos:items ${p.id}: ${e.message}`);
    }
  }
  assert.deepEqual(fallas, [], `Lecturas que fallan:\n${fallas.join('\n')}`);
});
