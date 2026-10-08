// Prueba con operaciones al azar: se hacen cientos de facturas, cobros, anulaciones y ediciones mezcladas y, después
// de CADA una, se comprueba que las cuentas cierren. Si alguna vez falla, el mensaje dice la semilla y el paso, y
// con la misma semilla se repite exactamente lo mismo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, limpiarDatos, crearCliente, crearProducto, asegurarMetodo, azar } = require('./harness');

const TOLERANCIA = 0.011; // un centavo de redondeo

// Reglas que tienen que cumplirse siempre:
//  1) saldo del cliente = total de sus facturas no anuladas − lo cobrado (sin contar el saldo a favor aplicado, que no es plata).
//  2) el estado de cada factura no anulada coincide con lo cobrado.
function verificar(db, contexto) {
  db.prepare('SELECT id, nombre, saldo FROM clientes').all().forEach((c) => {
    const facturado = db.prepare("SELECT COALESCE(SUM(total), 0) t FROM facturas WHERE cliente_id = ? AND estado != 'anulada'").get(c.id).t;
    const cobrado = db
      .prepare(
        `SELECT COALESCE(SUM(p.monto), 0) t FROM pagos p JOIN facturas f ON f.id = p.factura_id
         WHERE f.cliente_id = ? AND lower(trim(p.metodo_pago)) != 'saldo a favor'`
      )
      .get(c.id).t;
    const esperado = facturado - cobrado;
    assert.ok(Math.abs(c.saldo - esperado) < TOLERANCIA, `${contexto}: el saldo de ${c.nombre} es ${c.saldo} y las cuentas dan ${esperado.toFixed(4)}`);
  });
  db.prepare("SELECT id, total, estado FROM facturas WHERE estado != 'anulada'").all().forEach((f) => {
    const pagado = db.prepare('SELECT COALESCE(SUM(monto), 0) t FROM pagos WHERE factura_id = ?').get(f.id).t;
    const debido = pagado <= 0.005 ? 'pendiente' : pagado >= f.total - 0.005 ? 'pagada' : 'parcial';
    assert.equal(f.estado, debido, `${contexto}: la factura ${f.id} figura "${f.estado}" pero tiene total ${f.total} y cobrado ${pagado}`);
  });
}

for (const semilla of [1, 2, 3, 42, 2026, 7, 99, 12345]) {
  test(`operaciones al azar (semilla ${semilla}): las cuentas siempre cierran`, async () => {
    const { db, invocar } = await iniciar();
    limpiarDatos(db);
    ['Efectivo', 'Transferencia', 'Mercado Pago'].forEach((m) => asegurarMetodo(db, m));
    db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('retencion_transferencia', '0.2') ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor").run();
    const r = azar(semilla);
    const entre = (a, b) => a + r() * (b - a);
    const elegir = (lista) => lista[Math.floor(r() * lista.length)];
    const centavos = (n) => Math.round(n * 100) / 100;

    const clientes = ['Alma', 'Bruno', 'Camila', 'Dani'].map((n) => crearCliente(db, n));
    const productos = [
      crearProducto(db, { nombre: 'Asado', precio: 8499.99, unidad: 'kg' }),
      crearProducto(db, { nombre: 'Pollo', precio: 3199.5, unidad: 'kg' }),
      crearProducto(db, { nombre: 'Hamburguesas', precio: 12750.33, unidad: 'unidad' }),
      crearProducto(db, { nombre: 'Chorizo', precio: 5600, unidad: 'kg' }),
    ];
    const metodos = ['Efectivo', 'Transferencia', 'Mercado Pago'];
    const bitacora = [];
    const paso = async (descripcion, accion) => {
      bitacora.push(descripcion);
      await accion();
      verificar(db, `semilla ${semilla}, paso ${bitacora.length} (${descripcion})`);
    };
    const itemsAlAzar = () =>
      Array.from({ length: 1 + Math.floor(r() * 3) }, () => {
        const producto_id = elegir(productos);
        const unidad = db.prepare('SELECT unidad FROM productos WHERE id = ?').get(producto_id).unidad;
        const item = { producto_id, cantidad: unidad === 'kg' ? Math.round(entre(0.1, 40) * 1000) / 1000 : Math.ceil(entre(1, 6)) };
        if (r() < 0.3) item.precio_unitario = centavos(entre(1000, 9000));
        return item;
      });

    for (let i = 0; i < 250; i++) {
      const dado = r();
      const abiertas = db.prepare("SELECT id, cliente_id, total FROM facturas WHERE estado IN ('pendiente', 'parcial')").all();
      const todas = db.prepare("SELECT id FROM facturas WHERE estado != 'anulada'").all();
      if (dado < 0.25 || todas.length === 0) {
        const cliente_id = elegir(clientes);
        await paso(`factura nueva de cliente ${cliente_id}`, () => invocar('facturas:crear', { cliente_id, tipo_precio: r() < 0.7 ? 'cliente' : 'cf', items: itemsAlAzar() }));
      } else if (dado < 0.5 && abiertas.length) {
        const f = elegir(abiertas);
        const debe = f.total - db.prepare('SELECT COALESCE(SUM(monto), 0) t FROM pagos WHERE factura_id = ?').get(f.id).t;
        const monto = r() < 0.4 ? centavos(debe) : centavos(entre(1, Math.max(2, debe * 1.1)));
        await paso(`pago de $${monto} a la factura ${f.id}`, () => invocar('facturas:registrarPago', { factura_id: f.id, monto, metodo_pago: elegir(metodos) }));
      } else if (dado < 0.62) {
        const cliente_id = elegir(clientes);
        const debe = db.prepare("SELECT COALESCE(SUM(f.total - COALESCE((SELECT SUM(monto) FROM pagos WHERE factura_id = f.id), 0)), 0) t FROM facturas f WHERE f.cliente_id = ? AND f.estado IN ('pendiente', 'parcial')").get(cliente_id).t;
        if (debe > 1) {
          const monto = r() < 0.4 ? centavos(debe) : centavos(entre(1, debe));
          await paso(`cobro general de $${monto} al cliente ${cliente_id}`, () => invocar('clientes:registrarPagoGeneral', { cliente_id, monto, metodo_pago: elegir(metodos) }));
        }
      } else if (dado < 0.72) {
        const cobros = db
          .prepare("SELECT p.id FROM pagos p JOIN facturas f ON f.id = p.factura_id WHERE f.estado != 'anulada' AND p.monto > 0 AND lower(trim(p.metodo_pago)) NOT IN ('saldo a favor', 'cheque')")
          .all();
        if (cobros.length) {
          const id = elegir(cobros).id;
          await paso(`anular el cobro ${id}`, () => invocar('pagos:anular', { ids: [id], motivo: 'prueba' }));
        }
      } else if (dado < 0.82 && todas.length) {
        const f = elegir(todas);
        const devolver = r() < 0.4;
        await paso(`anular la factura ${f.id}${devolver ? ' devolviendo plata' : ''}`, () =>
          invocar('facturas:anular', devolver ? { id: f.id, motivo: 'prueba', destino: 'devolver', metodo: 'Efectivo' } : { id: f.id, motivo: 'prueba', destino: 'credito' })
        );
      } else if (dado < 0.9) {
        // Reactivar una factura anulada: puede que no se pueda (si su crédito ya se usó); en los dos casos las cuentas tienen que cerrar.
        const anuladas = db.prepare("SELECT id FROM facturas WHERE estado = 'anulada' AND anulado_estado_previo IS NOT NULL").all();
        if (anuladas.length) {
          const f = elegir(anuladas);
          await paso(`reactivar la factura ${f.id}`, () => invocar('facturas:reactivar', f.id));
        }
      } else if (todas.length) {
        const f = elegir(todas);
        const tipo = db.prepare('SELECT tipo_precio FROM facturas WHERE id = ?').get(f.id).tipo_precio;
        await paso(`editar la factura ${f.id}`, () => invocar('facturas:actualizar', { id: f.id, tipo_precio: tipo, items: itemsAlAzar() }));
      }
    }
    assert.ok(bitacora.length > 100, 'la prueba tiene que haber hecho bastantes operaciones');
  });
}
