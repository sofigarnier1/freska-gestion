// Funciones y constantes que usan varios temas (configuración, redondeo, fechas, cuentas, retenciones, cheques de cobro...).
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

function registrar(ctx) {
  const { db } = ctx;

  // Freno a los intentos repetidos: los 4 primeros errores seguidos no cuestan nada; del 5.º en adelante
  // hay que esperar 30 s, y el doble en cada error siguiente (hasta 15 minutos). Se guarda en la base,
  // así que cerrar y volver a abrir la app no lo reinicia. Un acierto lo borra.
  const leerConfig = (clave) => {
    const fila = db.prepare('SELECT valor FROM configuracion WHERE clave = ?').get(clave);
    return fila ? fila.valor : null;
  };
  const guardarConfig = (clave, valor) =>
    db
      .prepare('INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor')
      .run(clave, String(valor));

  // Categoría fija para las retenciones automáticas por transferencia (ver `registrarRetencionTransferencia`
  // más abajo); se crea sola la primera vez que hace falta, así no hay que darla de alta a mano.
  const categoriaRetencionId = () => {
    db.prepare(
      "INSERT INTO categorias_gasto (nombre, ambito) VALUES ('Retenciones', 'negocio') ON CONFLICT(nombre, ambito, de_fondos) DO NOTHING"
    ).run();
    return db.prepare("SELECT id FROM categorias_gasto WHERE nombre = 'Retenciones' AND ambito = 'negocio'").get().id;
  };

  // Cuando cobrás por transferencia (cualquier banco o app, nunca efectivo/cheque/saldo a favor), el banco
  // o la app descuenta solo un % antes de que la plata llegue a la cuenta (retención de Ingresos Brutos,
  // por ejemplo) — la plata que ves en el banco es menos de lo que cobraste. Se registra automáticamente
  // como un gasto en esa misma cuenta, así la Caja general ya refleja lo que realmente entra, sin tener
  // que "Ajustar saldo" a mano por esto cada vez. La tasa es una sola para todas las transferencias
  // (`retencion_transferencia` en `configuracion`, editable en Métodos de pago); si es 0 no se genera nada.
  const registrarRetencionTransferencia = (metodoPago, montoBruto, fecha, ingresoId, pagoIds) => {
    const clave = String(metodoPago || '').trim().toLowerCase();
    if (!metodoPago || clave === 'efectivo' || clave === 'cheque' || clave === 'saldo a favor' || !(montoBruto > 0)) return;
    const tasa = Number(leerConfig('retencion_transferencia') || 0);
    if (!(tasa > 0)) return;
    const monto = Math.round(montoBruto * (tasa / 100) * 100) / 100;
    if (!(monto > 0)) return;
    db.prepare(
      `INSERT INTO gastos (fecha, categoria_id, descripcion, monto, medio_pago, cuenta, ingreso_id, pago_ids)
       VALUES (COALESCE(?, date('now', 'localtime')), ?, ?, ?, 'Transferencia', ?, ?, ?)`
    ).run(fecha || null, categoriaRetencionId(), `Retención por transferencia (${tasa}%)`, monto, metodoPago, ingresoId || null, pagoIds && pagoIds.length ? pagoIds.join(',') : null);
  };

  // ---------- Cheques ----------
  const esMetodoCheque = (metodo) => String(metodo || '').trim().toLowerCase() === 'cheque';
  const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

  // Un cheque se identifica por banco + número (sin mayúsculas, acentos ni ceros a la izquierda). Devuelve el
  // texto de aviso si ya está cargado (en cartera o entregado), o null si es nuevo.
  function errorChequeRepetido(banco, numero) {
    const limpiar = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const numeroLimpio = (n) => limpiar(n).replace(/^0+(?=\d)/, '');
    const igual = db
      .prepare('SELECT banco, numero, importe, estado, entregado_a, fecha_entrega FROM cheques')
      .all()
      .find((c) => limpiar(c.banco) === limpiar(banco) && numeroLimpio(c.numero) === numeroLimpio(numero));
    if (!igual) return null;
    const dondeEsta =
      igual.estado === 'en_cartera'
        ? 'está en la cartera'
        : `ya se entregó a ${igual.entregado_a || 'alguien'}${igual.fecha_entrega ? ` el ${igual.fecha_entrega.split('-').reverse().join('/')}` : ''}`;
    return `Ese cheque ya está cargado (${igual.banco} N° ${igual.numero}, $${Number(igual.importe).toLocaleString('es-AR')}) y ${dondeEsta}.`;
  }

  // Valida los datos del cheque de un cobro: banco y número son obligatorios; la fecha de cobro, opcional.
  function validarChequeDeCobro(cheque) {
    const banco = String((cheque && cheque.banco) || '').trim().slice(0, 60);
    const numero = String((cheque && cheque.numero) || '').trim().slice(0, 30);
    const fechaCobro = cheque && cheque.fecha_cobro ? String(cheque.fecha_cobro) : null;
    if (!banco || !numero) return { error: 'Para cobrar con cheque poné el banco y el número.' };
    if (fechaCobro && !FECHA_ISO.test(fechaCobro)) return { error: 'La fecha de cobro del cheque no es válida.' };
    const repetido = errorChequeRepetido(banco, numero);
    if (repetido) return { error: repetido };
    return { banco, numero, fechaCobro };
  }

  function insertarChequeDeCobro({ datos, importe, clienteId }) {
    const nombreCliente = db
      .prepare(
        `SELECT (nombre || CASE WHEN apellido IS NOT NULL AND apellido != '' THEN ' ' || apellido ELSE '' END) AS n
         FROM clientes WHERE id = ?`
      )
      .get(clienteId);
    db.prepare(
      `INSERT INTO cheques (banco, numero, importe, fecha_cobro, librador, cliente_id, fecha_ingreso)
       VALUES (?, ?, ?, ?, ?, ?, date('now', 'localtime'))`
    ).run(datos.banco, datos.numero, Math.round(importe * 100) / 100, datos.fechaCobro, nombreCliente ? nombreCliente.n : null, clienteId);
  }
  const SQL_NO_CREDITO = "lower(trim(metodo_pago)) != 'saldo a favor'";
  const SQL_NO_CREDITO_P = "lower(trim(p.metodo_pago)) != 'saldo a favor'";

  // ---------- Caja general (cuentas) ----------
  // Cada método de pago activo (menos Cheque y "Saldo a favor") es una cuenta: Efectivo, cada banco o app. Se suman
  // a los dólares (con la cotización cargada a mano) y a los cheques en cartera para dar el dinero disponible.
  // El saldo de una cuenta = lo que había al comenzar el día `caja_desde` + los movimientos desde esa fecha.
  const SIN_ASIGNAR = 'Sin asignar';
  // Sin espacios ni mayúsculas: "MercadoPago" y "Mercado Pago" son la misma cuenta.
  const claveCuenta = (t) => String(t || '').replace(/\s+/g, '').toLowerCase();
  // Las cuentas que hay: Efectivo primero y después los demás métodos, en el orden en que se crearon.
  function listaDeCuentas() {
    const metodos = db
      .prepare("SELECT nombre FROM metodos_pago WHERE activo = 1 AND lower(trim(nombre)) NOT IN ('cheque', 'saldo a favor') ORDER BY id")
      .all()
      .map((m) => m.nombre);
    const efectivo = metodos.filter((n) => claveCuenta(n) === 'efectivo');
    return [...efectivo, ...metodos.filter((n) => claveCuenta(n) !== 'efectivo')];
  }

  // Las operaciones de la Caja general (pases, compra de dólares, canje de cheques e intereses) como movimientos.
  function movimientosDeOperaciones(desde) {
    const cuentas = listaDeCuentas();
    const canonica = (nombre) => cuentas.find((c) => claveCuenta(c) === claveCuenta(nombre)) || SIN_ASIGNAR;
    const esEfectivo = (nombre) => claveCuenta(nombre) === 'efectivo';
    const movs = [];
    const cheque = db.prepare('SELECT banco, numero FROM cheques WHERE id = ?');
    db.prepare('SELECT * FROM operaciones_caja WHERE fecha >= ? ORDER BY fecha, id')
      .all(desde)
      .forEach((o) => {
        if (o.tipo === 'pase') {
          const nombreOrigen = canonica(o.cuenta);
          const nombreDestino = canonica(o.cuenta_destino);
          const deposito = esEfectivo(nombreOrigen) && !esEfectivo(nombreDestino);
          const retiro = !esEfectivo(nombreOrigen) && esEfectivo(nombreDestino);
          movs.push({ id: o.id, cuenta: nombreOrigen, fecha: o.fecha, monto: -o.monto, detalle: deposito ? `Depósito en ${nombreDestino}` : retiro ? 'Retiro en efectivo' : `Pase a ${nombreDestino}`, tipo: 'pase' });
          movs.push({ id: o.id, cuenta: nombreDestino, fecha: o.fecha, monto: o.monto, detalle: deposito ? 'Depósito de efectivo' : retiro ? `Retiro de ${nombreOrigen}` : `Pase desde ${nombreOrigen}`, tipo: 'pase' });
        } else if (o.tipo === 'dolares') {
          movs.push({ id: o.id, cuenta: canonica(o.cuenta), fecha: o.fecha, monto: -o.monto, detalle: `Compra de U$S ${o.usd} a $${o.cotizacion}`, tipo: 'dolares' });
        } else if (o.tipo === 'canje') {
          // Monto positivo: se cambió un cheque de la cartera por plata. Negativo: se recibió un cheque (de un
          // tercero, como Hernán) y se dio efectivo a cambio.
          const ch = cheque.get(o.cheque_id);
          const deCheque = ch ? ` ${ch.banco} N° ${ch.numero}` : '';
          movs.push({ id: o.id, cuenta: canonica(o.cuenta), fecha: o.fecha, monto: o.monto, detalle: o.monto >= 0 ? `Canje del cheque${deCheque}` : `Efectivo a cambio del cheque${deCheque}`, tipo: 'canje' });
        } else if (o.tipo === 'reintegro') {
          movs.push({ id: o.id, cuenta: canonica(o.cuenta), fecha: o.fecha, monto: o.monto, detalle: `Reintegro${o.nota ? `: ${o.nota}` : ''}`, tipo: 'reintegro' });
        } else {
          movs.push({ id: o.id, cuenta: canonica(o.cuenta), fecha: o.fecha, monto: o.monto, detalle: `${o.monto >= 0 ? 'Interés ganado' : 'Interés pagado'}${o.nota ? `: ${o.nota}` : ''}`, tipo: 'interes' });
        }
      });
    // Los pases con Fondos personales: lo que sale del negocio hacia lo personal resta de esa cuenta, y al revés.
    db.prepare('SELECT * FROM pases_personales WHERE fecha >= ? ORDER BY fecha, id')
      .all(desde)
      .forEach((p) =>
        movs.push({
          id: p.id,
          cuenta: canonica(p.cuenta_negocio),
          fecha: p.fecha,
          monto: p.sentido === 'a_personal' ? -p.monto : p.monto,
          detalle: p.sentido === 'a_personal' ? 'Pase a fondos personales' : 'Pase desde fondos personales',
          tipo: 'pase',
          personal: true, // no es una operación de la Caja (no está en `operaciones_caja`): la lista de Operaciones y la lupa lo saltean
        })
      );
    // Lo que un proveedor devolvió en plata (devolución de mercadería): entra a la cuenta donde se recibió.
    db.prepare(
      `SELECT d.id, d.fecha, d.monto, d.reembolso_cuenta, pr.nombre FROM devoluciones_proveedor d
       JOIN proveedores pr ON pr.id = d.proveedor_id WHERE d.reembolso_cuenta IS NOT NULL AND d.fecha >= ? ORDER BY d.fecha, d.id`
    )
      .all(desde)
      .forEach((d) =>
        movs.push({
          id: d.id,
          cuenta: canonica(d.reembolso_cuenta),
          fecha: d.fecha,
          monto: d.monto,
          detalle: `Devolución de ${d.nombre}`,
          tipo: 'devolucion',
          personal: true, // no es una operación de la Caja (no está en `operaciones_caja`): la lista de Operaciones y la lupa lo saltean
        })
      );
    return movs;
  }

  // ---------- Fondos personales ----------
  // La plata personal comparte los bancos y apps del negocio, y además tiene su propio efectivo, que nunca toca el cajón.
  const EFECTIVO_PERSONAL = 'Efectivo personal';
  const cuentasPersonales = () => [EFECTIVO_PERSONAL, ...listaDeCuentas().filter((c) => claveCuenta(c) !== 'efectivo')];
  const cuentaPersonal = (nombre) => cuentasPersonales().find((c) => claveCuenta(c) === claveCuenta(nombre)) || null;

  // ---------- Cuentas personales y saldos ----------
  // Saldo personal de cada cuenta = ingresos nuevos − retiros ± pases con el negocio + ajustes − compras de dólares. Los ingresos viejos (los
  // que ya sumaban a la caja o no tenían cuenta) quedan afuera: no son plata personal que se pueda gastar desde acá.
  function saldosPersonales() {
    const por = (sql) => new Map(db.prepare(sql).all().map((r) => [claveCuenta(r.cuenta), r.t]));
    const ingresos = por("SELECT cuenta, SUM(monto - retencion) AS t FROM ingresos WHERE fondo_personal = 1 AND cuenta IS NOT NULL GROUP BY cuenta");
    const retiros = por('SELECT cuenta, SUM(monto) AS t FROM retiros_personales GROUP BY cuenta');
    const entranPases = por("SELECT cuenta_personal AS cuenta, SUM(monto) AS t FROM pases_personales WHERE sentido = 'a_personal' GROUP BY cuenta_personal");
    const salenPases = por("SELECT cuenta_personal AS cuenta, SUM(monto) AS t FROM pases_personales WHERE sentido = 'al_negocio' GROUP BY cuenta_personal");
    const ajustes = por('SELECT cuenta, SUM(monto) AS t FROM fondos_ajustes GROUP BY cuenta');
    const dolares = por('SELECT cuenta, SUM(monto) AS t FROM compras_dolares_personales GROUP BY cuenta');
    return cuentasPersonales().map((nombre) => {
      const k = claveCuenta(nombre);
      const saldo = (ingresos.get(k) || 0) - (retiros.get(k) || 0) + (entranPases.get(k) || 0) - (salenPases.get(k) || 0) + (ajustes.get(k) || 0) - (dolares.get(k) || 0);
      return { nombre, saldo: redondear2(saldo) };
    });
  }


  // Lo que se deben el negocio y lo personal por los pases: cada pase cuenta como plata prestada. `neto` positivo = el negocio
  // le debe a lo personal (se pasó más al negocio que al revés); negativo = lo personal le debe al negocio. Solo informa.
  // Si hay deuda, `devolver` trae lo que hace falta para devolverla con un pase: el sentido contrario al que la creó, todo el
  // monto y las cuentas del último pase que la generó (para que la plata vuelva por donde salió).
  function saldoDePases() {
    const f = db.prepare("SELECT COALESCE(SUM(CASE WHEN sentido = 'al_negocio' THEN monto ELSE -monto END), 0) AS neto, COUNT(*) AS cantidad FROM pases_personales").get();
    const neto = redondear2(f.neto);
    const saldo = { neto, cantidad: f.cantidad };
    if (neto !== 0) {
      const ultimo = db.prepare('SELECT cuenta_negocio, cuenta_personal FROM pases_personales WHERE sentido = ? ORDER BY fecha DESC, id DESC LIMIT 1').get(neto > 0 ? 'al_negocio' : 'a_personal');
      saldo.devolver = { sentido: neto > 0 ? 'a_personal' : 'al_negocio', monto: Math.abs(neto), cuenta_negocio: ultimo ? ultimo.cuenta_negocio : null, cuenta_personal: ultimo ? ultimo.cuenta_personal : null };
    }
    return saldo;
  }

  // Los dólares personales (ahorro): cuántos son y cuánto valen con la cotización del día, que es la misma de la Caja.
  function dolaresPersonales() {
    const usd = Number(leerConfig('fondos_dolares_usd')) || 0;
    const cotizacion = Number(leerConfig('caja_cotizacion')) || 0;
    return { usd, cotizacion, valor: redondear2(usd * cotizacion) };
  }

  // ---------- Cierre de caja ----------
  const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
  const redondear2 = (n) => Math.round(n * 100) / 100;


  // ---------- Stock ----------
  // Los kilos que representa cada producto por unidad de venta: los de kilo pesan 1 kg por kg; los de unidad (cajas,
  // bolsas) tienen su peso cargado. Sin artículo o sin peso, el producto no cuenta para el stock.
  const KG_DE_PRODUCTO = "CASE WHEN p.articulo_stock_id IS NULL THEN NULL ELSE COALESCE(p.kg_por_unidad, CASE WHEN p.unidad = 'kg' THEN 1 END) END";
  const stockDesde = () => leerConfig('stock_desde') || new Date().toISOString().slice(0, 10);

  // Cada pila de stock (en kilos) se llama como el producto principal. Los productos por kilo tienen la suya sola.
  function pilaDeProducto(nombreProducto) {
    // Se llama como el producto sin el paréntesis: "Hamburguesas (x32)" → "Hamburguesas".
    const nombre = String(nombreProducto).replace(/\s*\(.*\)\s*$/, '').trim() || String(nombreProducto);
    db.prepare('INSERT INTO articulos_stock (nombre) VALUES (?) ON CONFLICT(nombre) DO UPDATE SET activo = 1').run(nombre);
    return db.prepare('SELECT id FROM articulos_stock WHERE nombre = ?').get(nombre).id;
  }
  function asegurarPilas() {
    db.prepare("SELECT id, nombre FROM productos WHERE activo = 1 AND unidad = 'kg' AND articulo_stock_id IS NULL AND stock_de_producto_id IS NULL")
      .all()
      .forEach((p) => db.prepare('UPDATE productos SET articulo_stock_id = ?, kg_por_unidad = 1 WHERE id = ?').run(pilaDeProducto(p.nombre), p.id));
  }

  function resumenDeStock() {
    asegurarPilas();
    const desde = stockDesde();
    const carnesDe = new Map();
    db.prepare('SELECT articulo_id, tipo, porcentaje FROM articulo_carnes ORDER BY porcentaje DESC, tipo COLLATE NOCASE').all().forEach((c) => {
      if (!carnesDe.has(c.articulo_id)) carnesDe.set(c.articulo_id, []);
      carnesDe.get(c.articulo_id).push({ tipo: c.tipo, porcentaje: c.porcentaje });
    });
    const articulos = db.prepare('SELECT id, nombre, kg_por_caja, tipo, porcentaje_carne, minimo FROM articulos_stock WHERE activo = 1 ORDER BY nombre COLLATE NOCASE').all();
    const movs = new Map(db.prepare('SELECT articulo_id AS id, SUM(kilos) AS t, MAX(CASE WHEN tipo = \'produccion\' THEN fecha END) AS ultima FROM movimientos_stock GROUP BY articulo_id').all().map((r) => [r.id, r]));
    // El ajuste de hoy (si ya se contó este artículo hoy), para que "Ajustar stock" lo corrija en vez de sumar otro.
    const hoy = db.prepare("SELECT date('now', 'localtime') AS hoy").get().hoy;
    const ajustesHoy = new Map(
      db.prepare("SELECT id, articulo_id, kilos, nota FROM movimientos_stock WHERE tipo = 'ajuste' AND fecha = ?").all(hoy).map((r) => [r.articulo_id, r])
    );
    const vendidos = new Map(
      db
        .prepare(
          `SELECT p.articulo_stock_id AS id, SUM(fi.cantidad * (${KG_DE_PRODUCTO})) AS t
           FROM factura_items fi JOIN facturas f ON f.id = fi.factura_id JOIN productos p ON p.id = fi.producto_id
           WHERE f.estado != 'anulada' AND substr(f.fecha, 1, 10) >= ? AND p.articulo_stock_id IS NOT NULL GROUP BY p.articulo_stock_id`
        )
        .all(desde)
        .map((r) => [r.id, r.t || 0])
    );
    // Lo pedido por unidad ("6 chorizos") cuenta como esas unidades por su peso aproximado (0 si no se cargó).
    const pendientes = new Map(
      db
        .prepare(
          `SELECT p.articulo_stock_id AS id, SUM(pi.cantidad * (${KG_DE_PRODUCTO}) * CASE WHEN pi.unidad_pedido = 'unidad' THEN COALESCE(p.peso_unidad_pedido, 0) ELSE 1 END) AS t
           FROM pedido_items pi JOIN pedidos pe ON pe.id = pi.pedido_id JOIN productos p ON p.id = pi.producto_id
           WHERE pe.estado = 'pendiente' AND (pe.para_fecha IS NULL OR pe.para_fecha <= date('now', 'localtime')) AND p.articulo_stock_id IS NOT NULL GROUP BY p.articulo_stock_id`
        )
        .all()
        .map((r) => [r.id, r.t || 0])
    );
    const productos = db
      .prepare('SELECT id, nombre, unidad, presentacion, articulo_stock_id, kg_por_unidad, stock_de_producto_id FROM productos WHERE activo = 1 ORDER BY nombre COLLATE NOCASE')
      .all();
    const filas = articulos
      .filter((a) => productos.some((p) => p.articulo_stock_id === a.id))
      .map((a) => {
      const stock = redondear2((movs.get(a.id) ? movs.get(a.id).t : 0) - (vendidos.get(a.id) || 0));
      const pendiente = redondear2(pendientes.get(a.id) || 0);
      // La caja pesa lo cargado a mano o, si no, lo que pesa el producto por unidad principal (la caja de hamburguesas).
      const principal = productos.find((p) => p.articulo_stock_id === a.id && !p.stock_de_producto_id && p.unidad !== 'kg' && p.kg_por_unidad);
      const kgPorCaja = a.kg_por_caja || (principal ? principal.kg_por_unidad : null);
      return {
        id: a.id,
        nombre: a.nombre,
        kg_por_caja: kgPorCaja,
        tipo: a.tipo || null,
        carnes: carnesDe.get(a.id) || [],
        porcentaje_carne: a.porcentaje_carne || null,
        minimo: a.minimo || null,
        cajas: kgPorCaja ? Math.round((stock / kgPorCaja) * 100) / 100 : null,
        stock,
        pendiente,
        disponible: redondear2(stock - pendiente),
        ultimaProduccion: movs.get(a.id) ? movs.get(a.id).ultima : null,
        productos: productos.filter((p) => p.articulo_stock_id === a.id).map((p) => p.nombre),
        ajusteHoy: ajustesHoy.has(a.id) ? { nota: ajustesHoy.get(a.id).nota } : null,
      };
      });
    const porId = new Map(filas.map((f) => [f.id, f]));
    return {
      ok: true,
      desde,
      articulos: filas,
      // Cada producto con cuánto hay, en sus propias unidades (por ejemplo, cajas).
      productos: productos.map((p) => {
        const kg = p.articulo_stock_id ? p.kg_por_unidad || (p.unidad === 'kg' ? 1 : null) : null;
        const art = porId.get(p.articulo_stock_id);
        return {
          id: p.id,
          nombre: p.nombre,
          unidad: p.unidad,
          presentacion: p.presentacion || null,
          articulo_id: p.articulo_stock_id || null,
          articulo: art ? art.nombre : null,
          tipo: art ? art.tipo : null,
          carnes: art ? art.carnes : [],
          carne_pct: art ? art.porcentaje_carne : null,
          minimo: art ? art.minimo : null,
          de_producto_id: p.stock_de_producto_id || null,
          kg_por_unidad: p.kg_por_unidad || (p.unidad === 'kg' && p.articulo_stock_id ? 1 : null),
          hay: kg && art ? Math.round((art.stock / kg) * 100) / 100 : null,
        };
      }),
    };
  }

  // Lo que se le debe a cada proveedor: saldo inicial + compras − pagos (efectivo, transferencia y cheques).
  const SQL_PROVEEDORES = `
    SELECT p.id, p.nombre, p.telefono, p.nota, p.saldo_inicial, p.activo,
           ROUND(p.saldo_inicial
                 + COALESCE((SELECT SUM(total) FROM compras WHERE proveedor_id = p.id), 0)
                 - COALESCE((SELECT SUM(efectivo + transferencia) FROM pagos_proveedor WHERE proveedor_id = p.id), 0)
                 - COALESCE((SELECT SUM(c.importe) FROM cheques c
                             JOIN pagos_proveedor pp ON pp.id = c.pago_proveedor_id
                             WHERE pp.proveedor_id = p.id), 0)
                 - COALESCE((SELECT SUM(monto) FROM devoluciones_proveedor WHERE proveedor_id = p.id), 0)
                 + COALESCE((SELECT SUM(monto) FROM devoluciones_proveedor WHERE proveedor_id = p.id AND reembolso_cuenta IS NOT NULL), 0), 2) AS saldo,
           (SELECT MAX(fecha) FROM compras WHERE proveedor_id = p.id) AS ultima_compra
    FROM proveedores p`;

  // Lo que usan los demás temas.
  Object.assign(ctx, { EFECTIVO_PERSONAL, cuentasPersonales, cuentaPersonal, saldosPersonales, dolaresPersonales, saldoDePases, leerConfig, guardarConfig, registrarRetencionTransferencia, esMetodoCheque, FECHA_ISO, errorChequeRepetido, validarChequeDeCobro, insertarChequeDeCobro, SQL_NO_CREDITO, SQL_NO_CREDITO_P, SIN_ASIGNAR, claveCuenta, listaDeCuentas, movimientosDeOperaciones, FECHA_VALIDA, redondear2, KG_DE_PRODUCTO, pilaDeProducto, resumenDeStock, SQL_PROVEEDORES });
}

module.exports = { registrar };
