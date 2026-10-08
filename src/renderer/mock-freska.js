// Mock de window.freska para previsualizar la UI en un navegador normal
// (sin Electron). Solo se carga si window.freska no existe todavía.
if (!window.freska) {
  // Estado de la copia externa (solo para poder ver la pantalla de copias en el navegador).
  const estadoCopiaExternaMock = { carpeta: null, ultima: null, error: null, disponible: false, cantidad: 14 };

  function redondear2(n) {
    return Math.round(n * 100) / 100;
  }

  function normalizarTexto(texto) {
    return (texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  function nombreCompleto(cliente) {
    if (!cliente) return '';
    return cliente.apellido ? `${cliente.nombre} ${cliente.apellido}` : cliente.nombre;
  }

  let clientes = [
    { id: 1, codigo: '1', nombre: 'Almacén Don Pepe', apellido: '', telefono: '5493511234567', domicilio: 'San Martín 450', saldo: 4500, activo: 1 },
    { id: 2, codigo: '2', nombre: 'Restaurante La Parrilla', apellido: '', telefono: '', domicilio: '', saldo: 0, activo: 1 },
    { id: 3, codigo: '3', nombre: 'Alma', apellido: 'Rodríguez', negocio: 'Kiosco El Sol', telefono: '', domicilio: '', saldo: 1200.5, activo: 1 },
  ];
  let productos = [
    { id: 1, codigo: '1', nombre: 'Milanesas de pollo', precio_cliente: 4200, precio_cf: 4800, unidad: 'kg', activo: 1 },
    { id: 2, codigo: '2', nombre: 'Milanesas de carne', precio_cliente: 5300, precio_cf: 6000, unidad: 'kg', activo: 1 },
    { id: 3, codigo: '3', nombre: 'Chorizos frescos', precio_cliente: 3100, precio_cf: 3500, unidad: 'kg', activo: 1 },
    { id: 4, codigo: '4', nombre: 'Chorizos secos', precio_cliente: 3800, precio_cf: 4300, unidad: 'kg', activo: 1 },
    { id: 5, codigo: '5', nombre: 'Hamburguesas', precio_cliente: 3600, precio_cf: 4100, unidad: 'unidad', activo: 1 },
    { id: 6, codigo: '6', nombre: 'Picada', precio_cliente: 6200, precio_cf: 7000, unidad: 'unidad', activo: 1 },
  ];
  let metodosPago = [
    { id: 1, nombre: 'Efectivo', activo: 1 },
    { id: 2, nombre: 'MercadoPago', activo: 1 },
    { id: 3, nombre: 'Personal Pay', activo: 1 },
    { id: 4, nombre: 'Cheque', activo: 1 },
  ];
  let nextMetodoPagoId = metodosPago.length + 1;
  let nextClienteId = clientes.length + 1;
  let facturas = [];
  let facturaItems = [];
  let pagos = [];
  let pedidos = [];
  let pedidoItems = [];
  let nextFacturaId = 1;
  let nextItemId = 1;
  let nextPagoId = 1;
  let cheques = [];
  let nextChequeId = 1;
  const hoyISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const esMetodoCheque = (m) => String(m || '').trim().toLowerCase() === 'cheque';
  // Valida los datos del cheque de un cobro (banco y número obligatorios).
  // Un cheque es el mismo si coinciden banco y número (sin mayúsculas, acentos ni ceros a la izquierda).
  function errorChequeRepetidoMock(banco, numero) {
    const limpiar = (t) => normalizarTexto(String(t || '')).replace(/\s+/g, ' ').trim();
    const num = (n) => limpiar(n).replace(/^0+(?=\d)/, '');
    const igual = cheques.find((c) => limpiar(c.banco) === limpiar(banco) && num(c.numero) === num(numero));
    if (!igual) return null;
    const donde = igual.estado === 'en_cartera' ? 'está en la cartera' : `ya se entregó a ${igual.entregado_a || 'alguien'}`;
    return `Ese cheque ya está cargado (${igual.banco} N° ${igual.numero}, $${igual.importe.toLocaleString('es-AR')}) y ${donde}.`;
  }
  function datosChequeCobro(cheque) {
    const banco = String((cheque && cheque.banco) || '').trim();
    const numero = String((cheque && cheque.numero) || '').trim();
    if (!banco || !numero) return { error: 'Para cobrar con cheque poné el banco y el número.' };
    if (cheque.fecha_cobro && !/^\d{4}-\d{2}-\d{2}$/.test(cheque.fecha_cobro)) return { error: 'La fecha de cobro del cheque no es válida.' };
    const repetido = errorChequeRepetidoMock(banco, numero);
    if (repetido) return { error: repetido };
    return { banco, numero, fecha_cobro: cheque.fecha_cobro || null };
  }
  function guardarChequeDeCobro(datos, importe, clienteId) {
    const cliente = clientes.find((c) => c.id === clienteId);
    cheques.push({
      id: nextChequeId++, banco: datos.banco, numero: datos.numero, importe: redondear2(importe),
      fecha_cobro: datos.fecha_cobro, librador: cliente ? nombreCompleto(cliente) : null, cliente_id: clienteId,
      fecha_ingreso: hoyISO(), estado: 'en_cartera', entregado_a: null, fecha_entrega: null,
    });
  }
  let cierresCaja = [];
  const limpiarProductoMock = (t) => String(t || '').trim().slice(0, 40);
  const limpiarDescripcionMock = (t) => String(t || '').trim().slice(0, 120);
  let tiposProducto = ['Vaca', 'Cerdo', 'Pollo', 'Otro'].map((nombre, i) => ({ id: i + 1, nombre }));
  let nextTipoProductoId = tiposProducto.length + 1;
  let tiposCarne = ['Vaca', 'Cerdo', 'Pollo', 'Otro'].map((nombre, i) => ({ id: i + 1, nombre }));
  let nextTipoCarneId = tiposCarne.length + 1;
  let proveedores = [
    'Frigorífico Norte', 'Carnes del Litoral', 'Distribuidora Sur', 'Don Carlos', 'Embutidos La Granja', 'Granos y Condimentos', 'Insumos Centro', 'La Chacra', 'Panificados del Río', 'Transporte Rápido', 'Envases Andes', 'Lácteos del Valle', 'Pollos del Este', 'Cerdos Don Raúl', 'Lo de Martín', 'Proveedor 1', 'Proveedor 2',
  ].map((nombre, i) => ({ id: i + 1, nombre, telefono: null, nota: null, saldo_inicial: 0, activo: 1 }));
  let nextProveedorId = proveedores.length + 1;
  let compras = [];
  let insumosMock = [];
  let conteosInsumoMock = [];
  let nextInsumoId = 1;
  let nextConteoInsumoId = 1;
  const UNIDADES_INSUMO_MOCK = ['u.', 'kg', 'rollos', 'paquetes', 'cajas', 'litros'];
  function datosInsumoMock({ nombre, unidad, minimo }) {
    const n = String(nombre || '').trim();
    if (!n) return { error: 'Poné el nombre del insumo.' };
    let m = null;
    if (minimo !== undefined && minimo !== null && String(minimo).trim() !== '') {
      m = Number(String(minimo).replace(',', '.'));
      if (!Number.isFinite(m) || m < 0) return { error: 'El mínimo no es válido.' };
    }
    return { nombre: n, unidad: UNIDADES_INSUMO_MOCK.includes(unidad) ? unidad : 'u.', minimo: m };
  }
  let avisosApagados = [];
  let avisosLeidosMock = {};
  const tiposAviso = [
    { id: 'cheques', nombre: 'Cheques que ya se pueden cobrar o vencen en 7 días' },
    { id: 'clientes_deuda', nombre: 'Clientes que deben hace más de 30 días' },
    { id: 'proveedores_deuda', nombre: 'Proveedores a los que hace más de 21 días que no les pagás' },
    { id: 'pedidos', nombre: 'Pedidos de días anteriores sin facturar' },
    { id: 'pedidos_programados', nombre: 'Pedidos programados para mañana' },
    { id: 'cierre_caja', nombre: 'Cierres de caja sin hacer o con diferencia (últimos 7 días)' },
    { id: 'clientes_inactivos', nombre: 'Clientes que dejaron de comprar (más de 45 días)' },
    { id: 'copia', nombre: 'Copia de seguridad fuera de la computadora (más de 14 días)' },
    { id: 'productos_sin_precio', nombre: 'Productos con precio en $0' },
    { id: 'stock_bajo', nombre: 'Productos con poco stock (por debajo del mínimo que cargaste)' },
    { id: 'insumos_bajos', nombre: 'Insumos por debajo del mínimo' },
    { id: 'insumos_sin_contar', nombre: 'Insumos que hace más de 30 días que no contás' },
  ];
  let productosProveedor = [];
  let nextProductoProveedorId = 1;
  // Código y datos fiscales de un cliente (misma regla que en main.js).
  function datosDeClienteMock(d, idPropio) {
    let codigo = String((d && d.codigo) || '').trim();
    if (!codigo) {
      if (idPropio) return { error: 'Poné un código: es obligatorio.' };
      codigo = String(Math.max(0, ...clientes.map((c) => Number(c.codigo) || 0)) + 1);
    }
    const otro = clientes.find((c) => c.id !== idPropio && String(c.codigo || '').trim().toLowerCase() === codigo.toLowerCase());
    if (otro) return { error: `El código ${codigo} ya lo tiene ${nombreCompleto(otro)}.` };
    const condicion = String((d && d.condicion_iva) || '').trim();
    const digitos = String((d && d.cuit) || '').replace(/\D/g, '');
    let cuit = null;
    if (digitos) {
      const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
      const resto = pesos.reduce((acc, p, i) => acc + p * Number(digitos[i]), 0) % 11;
      const verificador = resto === 0 ? 0 : 11 - resto;
      if (digitos.length !== 11 || verificador === 10 || verificador !== Number(digitos[10])) return { error: 'El CUIT no es válido: revisá los 11 números.' };
      cuit = `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos[10]}`;
    }
    return { codigo, condicion_iva: condicion || null, cuit };
  }

  // La cuenta del efectivo de cada día desde el primer cierre guardado (igual que `cuentaDeCajaPorDia` en main.js):
  // el fondo de un día sin cierre es lo que quedó en la caja el día anterior.
  function sumarDiasMock(iso, n) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function cuentaCajaPorDiaMock(hasta) {
    const primero = cierresCaja.map((c) => c.fecha).sort()[0];
    const desde = primero && primero < hasta ? primero : hasta;
    const dia = (p) => periodoDia(new Date(p.fecha));
    const dias = new Map();
    let quedo = 0;
    for (let d = desde; d <= hasta; d = sumarDiasMock(d, 1)) {
      const cierre = cierresCaja.find((c) => c.fecha === d) || null;
      const fondo = cierre ? cierre.fondo_inicial : quedo;
      const efectivo = redondear2(pagos.filter((p) => dia(p) === d && p.metodo_pago.trim().toLowerCase() === 'efectivo').reduce((a, p) => a + p.monto, 0));
      const retiros = redondear2(
        gastos.filter((g) => g.fecha === d && g.medio_pago === 'Efectivo').reduce((a, g) => a + g.monto, 0) +
          pagosProveedor.filter((p) => p.fecha === d).reduce((a, p) => a + (p.efectivo || 0), 0)
      );
      const pagado = redondear2(
        gastos.filter((g) => g.fecha === d && !['cheque', 'crédito'].includes(String(g.medio_pago).toLowerCase())).reduce((a, g) => a + g.monto, 0) +
          cuotasGasto.filter((c) => c.fecha_pago === d).reduce((a, c) => a + c.monto, 0) +
          pagosProveedor.filter((p) => p.fecha === d).reduce((a, p) => a + p.efectivo + p.transferencia, 0)
      );
      const cobrado = redondear2(pagosQueEntran().filter((p) => dia(p) === d).reduce((a, p) => a + p.monto, 0));
      const otros = redondear2(movimientosOperacionesMock(d).filter((o) => claveCuentaMock(o.cuenta) === 'efectivo' && o.fecha === d).reduce((a, o) => a + o.monto, 0));
      const esperado = redondear2(fondo + efectivo - retiros + otros);
      const contado = cierre && cierre.efectivo_contado !== undefined ? cierre.efectivo_contado : null;
      quedo = contado !== null ? contado : esperado;
      dias.set(d, { fecha: d, cierre: Boolean(cierre), fondo, efectivo, retiros, otros, cobrado, pagado, esperado, contado, quedo });
    }
    return dias;
  }

  function crearCuotasMock(gastoId, monto, cuotas) {
    const cada = Math.floor((monto / cuotas) * 100) / 100;
    for (let n = 1; n <= cuotas; n += 1) cuotasGasto.push({ id: nextCuotaId++, gasto_id: gastoId, numero: n, monto: n === cuotas ? redondear2(monto - cada * (cuotas - 1)) : cada, fecha_pago: null, cuenta: null });
  }

  // Caja general (igual que en main.js): cada método de pago (menos Cheque) es una cuenta.
  let cajaConfig = { desde: null, saldos: {}, usd: 0, cotizacion: 0 };
  let cuentasAjustes = [];
  let ingresos = [];
  // Fondos personales (igual que en main.js): retiros, pases con el negocio y ajustes de saldo de las cuentas personales.
  let retirosPersonales = [];
  let pasesPersonales = [];
  let fondosAjustes = [];
  let comprasDolaresPersonales = [];
  let nextCompraDolarPersonalId = 1;
  let dolaresPersonalesUsd = 0; // la cotización es la de la Caja (`cajaConfig.cotizacion`)
  const dolaresPersonalesMock = () => ({ usd: dolaresPersonalesUsd, cotizacion: cajaConfig.cotizacion, valor: redondear2(dolaresPersonalesUsd * cajaConfig.cotizacion) });
  // Quién le debe a quién por los pases y, si hay deuda, cómo devolverla (igual que `saldoDePases` en compartido.js).
  function saldoDePasesMock() {
    const neto = redondear2(pasesPersonales.reduce((a, p) => a + (p.sentido === 'al_negocio' ? p.monto : -p.monto), 0));
    const saldo = { neto, cantidad: pasesPersonales.length };
    if (neto !== 0) {
      const ultimo = [...pasesPersonales].filter((p) => p.sentido === (neto > 0 ? 'al_negocio' : 'a_personal')).sort((x, y) => (x.fecha < y.fecha ? 1 : x.fecha > y.fecha ? -1 : y.id - x.id))[0];
      saldo.devolver = { sentido: neto > 0 ? 'a_personal' : 'al_negocio', monto: Math.abs(neto), cuenta_negocio: ultimo ? ultimo.cuenta_negocio : null, cuenta_personal: ultimo ? ultimo.cuenta_personal : null };
    }
    return saldo;
  }
  const EFECTIVO_PERSONAL_MOCK = 'Efectivo personal';
  const cuentasPersonalesMock = () => [EFECTIVO_PERSONAL_MOCK, ...listaCuentasMock().filter((c) => claveCuentaMock(c) !== 'efectivo')];
  const cuentaPersonalMock = (nombre) => cuentasPersonalesMock().find((c) => claveCuentaMock(c) === claveCuentaMock(nombre)) || null;
  function saldosPersonalesMock() {
    return cuentasPersonalesMock().map((nombre) => {
      const k = claveCuentaMock(nombre);
      const es = (c) => claveCuentaMock(c) === k;
      const suma = (arr) => arr.reduce((a, x) => a + x, 0);
      const saldo =
        suma(ingresos.filter((i) => i.fondo_personal && i.cuenta && es(i.cuenta)).map((i) => i.monto - (i.retencion || 0))) -
        suma(retirosPersonales.filter((r) => es(r.cuenta)).map((r) => r.monto)) +
        suma(pasesPersonales.filter((p) => p.sentido === 'a_personal' && es(p.cuenta_personal)).map((p) => p.monto)) -
        suma(pasesPersonales.filter((p) => p.sentido === 'al_negocio' && es(p.cuenta_personal)).map((p) => p.monto)) +
        suma(fondosAjustes.filter((a) => es(a.cuenta)).map((a) => a.monto)) -
        suma(comprasDolaresPersonales.filter((c) => es(c.cuenta)).map((c) => c.monto));
      return { nombre, saldo: redondear2(saldo) };
    });
  }
  // "Se puede pedir por unidad" (el chorizo seco): solo para lo que se vende por kilo, con un peso aproximado por unidad en kg.
  function pedidoPorUnidadMock(unidad, pedible, pesoKg) {
    if (unidad !== 'kg' || !pedible) return { pedible: 0, peso: null };
    const peso = pesoKg === '' || pesoKg === null || pesoKg === undefined ? null : Number(pesoKg);
    if (peso !== null && (!Number.isFinite(peso) || peso <= 0 || peso > 50)) return { error: 'El peso de cada unidad no es válido.' };
    return { pedible: 1, peso: peso === null ? null : Math.round(peso * 10000) / 10000 };
  }
  // Una línea de pedido se pide "por unidad" solo si el producto es por kilo y lo permite.
  const unidadPedidoMock = (item) => {
    const p = productos.find((x) => x.id === item.producto_id);
    return item.unidad_pedido === 'unidad' && p && p.unidad === 'kg' && p.pedible_por_unidad ? 'unidad' : null;
  };
  // Para Estadísticas, los retiros cuentan como gastos de una categoría personal (como en estadisticas.js).
  const gastosParaEstadisticas = () => [
    ...gastos,
    ...retirosPersonales.map((r) => ({ id: `r${r.id}`, fecha: r.fecha, categoria_id: r.categoria_id, monto: r.monto, medio_pago: 'Fondos personales', descripcion: r.descripcion })),
  ];
  const inflacionMock = {};
  // Stock (igual que en main.js): artículos en kilos, movimientos de producción y ajustes, y productos que apuntan a un artículo.
  let articulosStock = [];
  let movimientosStock = [];
  let nextArticuloStockId = 1;
  let nextMovimientoStockId = 1;
  let stockDesdeMock = null;
  function pilaMock(nombreProducto) {
    const nombre = String(nombreProducto).replace(/\s*\(.*\)\s*$/, '').trim() || String(nombreProducto);
    let a = articulosStock.find((x) => x.nombre.toLowerCase() === nombre.toLowerCase());
    if (a) a.activo = 1;
    else {
      a = { id: nextArticuloStockId++, nombre, activo: 1 };
      articulosStock.push(a);
    }
    return a.id;
  }
  function sembrarStockMock() {
    if (!stockDesdeMock) stockDesdeMock = hoyISO();
    productos.filter((p) => p.activo && p.unidad === 'kg' && !p.articulo_stock_id && !p.stock_de_producto_id).forEach((p) => {
      p.articulo_stock_id = pilaMock(p.nombre);
      p.kg_por_unidad = 1;
    });
  }
  // Las carnes de una pila (Vaca 70 %, Cerdo 30 %); una pila vieja con solo `tipo` cuenta como esa carne al 100 %.
  const carnesMock = (a) => (a.carnes && a.carnes.length ? a.carnes : a.tipo ? [{ tipo: a.tipo, porcentaje: 100 }] : []);
  const kgDeProductoMock = (p) => (p.articulo_stock_id ? p.kg_por_unidad || (p.unidad === 'kg' ? 1 : null) : null);
  function resumenStockMock() {
    sembrarStockMock();
    const vendido = (a) =>
      facturaItems
        .filter((i) => {
          const f = facturas.find((x) => x.id === i.factura_id);
          const p = productos.find((x) => x.id === i.producto_id);
          return f && f.estado !== 'anulada' && String(f.fecha).slice(0, 10) >= stockDesdeMock && p && p.articulo_stock_id === a.id;
        })
        .reduce((acc, i) => acc + i.cantidad * kgDeProductoMock(productos.find((x) => x.id === i.producto_id)), 0);
    const pendiente = (a) =>
      pedidoItems
        .filter((i) => {
          const pe = pedidos.find((x) => x.id === i.pedido_id);
          const p = productos.find((x) => x.id === i.producto_id);
          return pe && pe.estado === 'pendiente' && p && p.articulo_stock_id === a.id;
        })
        .reduce((acc, i) => { const pr = productos.find((x) => x.id === i.producto_id); return acc + i.cantidad * kgDeProductoMock(pr) * (i.unidad_pedido === 'unidad' ? pr.peso_unidad_pedido || 0 : 1); }, 0);
    const filas = articulosStock
      .filter((a) => a.activo && productos.some((p) => p.activo && p.articulo_stock_id === a.id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .map((a) => {
        const movs = movimientosStock.filter((m) => m.articulo_id === a.id);
        const stock = redondear2(movs.reduce((acc, m) => acc + m.kilos, 0) - vendido(a));
        const pend = redondear2(pendiente(a));
        const ultimas = movs.filter((m) => m.tipo === 'produccion').map((m) => m.fecha).sort();
        const principal = productos.find((p) => p.articulo_stock_id === a.id && !p.stock_de_producto_id && p.unidad !== 'kg' && p.kg_por_unidad);
        const kgPorCaja = a.kg_por_caja || (principal ? principal.kg_por_unidad : null);
        const ajusteHoy = movs.find((m) => m.tipo === 'ajuste' && m.fecha === hoyISO());
        return { id: a.id, nombre: a.nombre, kg_por_caja: kgPorCaja, tipo: a.tipo || null, carnes: carnesMock(a), porcentaje_carne: a.porcentaje_carne || null, minimo: a.minimo || null, cajas: kgPorCaja ? Math.round((stock / kgPorCaja) * 100) / 100 : null, stock, pendiente: pend, disponible: redondear2(stock - pend), ultimaProduccion: ultimas.length ? ultimas[ultimas.length - 1] : null, productos: productos.filter((p) => p.articulo_stock_id === a.id).map((p) => p.nombre), ajusteHoy: ajusteHoy ? { nota: ajusteHoy.nota } : null };
      });
    return {
      ok: true,
      desde: stockDesdeMock,
      articulos: filas,
      productos: productos.filter((p) => p.activo).map((p) => {
        const kg = kgDeProductoMock(p);
        const art = filas.find((f) => f.id === p.articulo_stock_id);
        return { id: p.id, nombre: p.nombre, unidad: p.unidad, presentacion: p.presentacion || null, articulo_id: p.articulo_stock_id || null, articulo: art ? art.nombre : null, tipo: art ? art.tipo : null, carnes: art ? art.carnes : [], carne_pct: art ? art.porcentaje_carne : null, minimo: art ? art.minimo : null, de_producto_id: p.stock_de_producto_id || null, kg_por_unidad: p.kg_por_unidad || (p.unidad === 'kg' && p.articulo_stock_id ? 1 : null), hay: kg && art ? Math.round((art.stock / kg) * 100) / 100 : null };
      }),
    };
  }
  let operaciones = []; // { id, fecha, tipo, cuenta, cuenta_destino, monto, usd, cotizacion, cheque_id, nota }
  let nextOperacionId = 1;
  let descripcionesIngreso = [];
  let nextDescripcionIngresoId = 1;
  let tarjetas = []; // { id, cuenta, nombre, tipo, activo }
  let nextTarjetaId = 1;
  let cuotasGasto = []; // { id, gasto_id, numero, monto, fecha_pago, cuenta }
  let nextCuotaId = 1;
  const claveCuentaMock = (t) => String(t || '').replace(/\s+/g, '').toLowerCase();
  function listaCuentasMock() {
    const nombres = metodosPago.filter((m) => m.activo && !['cheque', 'saldo a favor'].includes(claveCuentaMock(m.nombre))).map((m) => m.nombre);
    return [...nombres.filter((n) => claveCuentaMock(n) === 'efectivo'), ...nombres.filter((n) => claveCuentaMock(n) !== 'efectivo')];
  }
  function cuentaDeGastoMock(g) {
    const medio = claveCuentaMock(g && g.medio_pago);
    if (medio === 'efectivo' || medio === 'cheque') return { cuenta: null };
    const elegida = String((g && g.cuenta) || '').trim();
    const valida = listaCuentasMock().filter((c) => claveCuentaMock(c) !== 'efectivo').find((c) => claveCuentaMock(c) === claveCuentaMock(elegida));
    if (elegida && !valida) return { error: 'Esa cuenta no existe.' };
    if (medio === 'crédito') return { cuenta: valida || null };
    if (!valida && cajaConfig.desde) return { error: 'Elegí de qué cuenta salió la plata.' };
    return { cuenta: valida || null };
  }
  // Cuando cobrás por transferencia (cualquier banco o app, nunca efectivo/cheque/saldo a favor), el banco
  // o la app descuenta solo un % antes de que la plata llegue a la cuenta (retención de Ingresos Brutos, por
  // ejemplo). Se registra automáticamente como un gasto en esa cuenta, igual que en main.js. Si la tasa
  // (`retencionTransferencia`, editable en Métodos de pago) es 0, no se genera nada.
  function registrarRetencionTransferenciaMock(metodoPago, montoBruto, fecha, ingresoId, pagoIds) {
    const clave = claveCuentaMock(metodoPago);
    if (!metodoPago || clave === 'efectivo' || clave === 'cheque' || clave === 'saldoafavor' || !(montoBruto > 0)) return;
    const tasa = Number(retencionTransferencia || 0);
    if (!(tasa > 0)) return;
    const monto = redondear2(montoBruto * (tasa / 100));
    if (!(monto > 0)) return;
    let categoria = categoriasGasto.find((c) => c.nombre === 'Retenciones');
    if (!categoria) {
      categoria = { id: nextCategoriaGastoId++, nombre: 'Retenciones', activo: 1, ambito: 'negocio' };
      categoriasGasto.push(categoria);
    }
    gastos.push({
      id: nextGastoId++,
      fecha: fecha || new Date().toISOString().slice(0, 10),
      categoria_id: categoria.id,
      descripcion: `Retención por transferencia (${tasa}%)`,
      monto,
      medio_pago: 'Transferencia',
      cheque_banco: null,
      cheque_numero: null,
      cheque_fecha: null,
      cheque_id: null,
      observacion: null,
      cuenta: metodoPago,
      tarjeta: null,
      cuotas: null,
      ingreso_id: ingresoId || null,
      pago_ids: pagoIds && pagoIds.length ? pagoIds.join(',') : null,
    });
  }
  // Tarjeta (débito y crédito) y cuotas (solo crédito: obligatorias), como en main.js.
  function datosTarjetaGastoMock(g) {
    const medio = claveCuentaMock(g && g.medio_pago);
    const conTarjeta = medio === 'débito' || medio === 'crédito' || medio === 'débito / tarjeta';
    const tarjeta = conTarjeta ? String((g && g.tarjeta) || '').trim() || null : null;
    if (medio !== 'crédito') return { tarjeta, cuotas: null };
    const cuotas = Number(g && g.cuotas);
    if (!Number.isInteger(cuotas) || cuotas < 1 || cuotas > 60) return { error: 'Poné en cuántas cuotas es (1 si es en un solo pago).' };
    return { tarjeta, cuotas };
  }
  function movimientosOperacionesMock(desde) {
    const cuentas = listaCuentasMock();
    const canonica = (n) => cuentas.find((c) => claveCuentaMock(c) === claveCuentaMock(n)) || 'Sin asignar';
    const esEfectivo = (n) => claveCuentaMock(n) === 'efectivo';
    const movs = [];
    operaciones
      .filter((o) => o.fecha >= desde)
      .forEach((o) => {
        if (o.tipo === 'pase') {
          const de = canonica(o.cuenta);
          const a = canonica(o.cuenta_destino);
          const deposito = esEfectivo(de) && !esEfectivo(a);
          const retiro = !esEfectivo(de) && esEfectivo(a);
          movs.push({ id: o.id, cuenta: de, fecha: o.fecha, monto: -o.monto, detalle: deposito ? `Depósito en ${a}` : retiro ? 'Retiro en efectivo' : `Pase a ${a}`, tipo: 'pase' });
          movs.push({ id: o.id, cuenta: a, fecha: o.fecha, monto: o.monto, detalle: deposito ? 'Depósito de efectivo' : retiro ? `Retiro de ${de}` : `Pase desde ${de}`, tipo: 'pase' });
        } else if (o.tipo === 'dolares') {
          movs.push({ id: o.id, cuenta: canonica(o.cuenta), fecha: o.fecha, monto: -o.monto, detalle: `Compra de U$S ${o.usd} a $${o.cotizacion}`, tipo: 'dolares' });
        } else if (o.tipo === 'canje') {
          const ch = cheques.find((c) => c.id === o.cheque_id);
          const deCheque = ch ? ` ${ch.banco} N° ${ch.numero}` : '';
          movs.push({ id: o.id, cuenta: canonica(o.cuenta), fecha: o.fecha, monto: o.monto, detalle: o.monto >= 0 ? `Canje del cheque${deCheque}` : `Efectivo a cambio del cheque${deCheque}`, tipo: 'canje' });
        } else if (o.tipo === 'reintegro') {
          movs.push({ id: o.id, cuenta: canonica(o.cuenta), fecha: o.fecha, monto: o.monto, detalle: `Reintegro${o.nota ? `: ${o.nota}` : ''}`, tipo: 'reintegro' });
        } else {
          movs.push({ id: o.id, cuenta: canonica(o.cuenta), fecha: o.fecha, monto: o.monto, detalle: `${o.monto >= 0 ? 'Interés ganado' : 'Interés pagado'}${o.nota ? `: ${o.nota}` : ''}`, tipo: 'interes' });
        }
      });
    pasesPersonales
      .filter((p) => p.fecha >= desde)
      .forEach((p) =>
        movs.push({ id: p.id, cuenta: canonica(p.cuenta_negocio), fecha: p.fecha, monto: p.sentido === 'a_personal' ? -p.monto : p.monto, detalle: p.sentido === 'a_personal' ? 'Pase a fondos personales' : 'Pase desde fondos personales', tipo: 'pase', personal: true })
      );
    return movs;
  }

  function movimientosCuentasMock(desde) {
    const cuentas = listaCuentasMock();
    const canonica = (n) => cuentas.find((c) => claveCuentaMock(c) === claveCuentaMock(n)) || 'Sin asignar';
    const movs = [];
    pagosQueEntran().filter((p) => periodoDia(new Date(p.fecha)) >= desde && claveCuentaMock(p.metodo_pago) !== 'cheque').forEach((p) => {
      const f = facturas.find((x) => x.id === p.factura_id);
      const c = clientes.find((x) => x.id === (f ? f.cliente_id : p.cliente_id));
      movs.push({ cuenta: canonica(p.metodo_pago), fecha: periodoDia(new Date(p.fecha)), monto: p.monto, detalle: `${p.monto >= 0 ? 'Cobro de' : 'Devolución a'} ${nombreCompleto(c)} (${p.factura_id == null ? 'saldo anterior' : `factura N° ${p.factura_id}`})`, tipo: 'cobro' });
    });
    gastos.filter((g) => g.fecha >= desde && !['cheque', 'crédito'].includes(claveCuentaMock(g.medio_pago))).forEach((g) =>
      movs.push({ cuenta: claveCuentaMock(g.medio_pago) === 'efectivo' ? canonica('Efectivo') : canonica(g.cuenta), fecha: g.fecha, monto: -g.monto, detalle: `Gasto: ${g.descripcion}`, tipo: 'gasto' })
    );
    devolucionesProveedor.filter((d) => d.reembolso_cuenta && d.fecha >= desde).forEach((d) =>
      movs.push({ cuenta: canonica(d.reembolso_cuenta), fecha: d.fecha, monto: d.monto, detalle: `Devolución de ${(proveedores.find((x) => x.id === d.proveedor_id) || {}).nombre}`, tipo: 'devolucion' })
    );
    pagosProveedor.filter((p) => p.fecha >= desde).forEach((p) => {
      const nombre = (proveedores.find((x) => x.id === p.proveedor_id) || {}).nombre;
      if (p.efectivo > 0) movs.push({ cuenta: canonica('Efectivo'), fecha: p.fecha, monto: -p.efectivo, detalle: `Pago a ${nombre}`, tipo: 'proveedor' });
      if (p.transferencia > 0) {
        const partes = p.transferencias || [];
        const asignado = partes.reduce((a, x) => a + x.monto, 0);
        partes.forEach((x) => movs.push({ cuenta: canonica(x.cuenta), fecha: p.fecha, monto: -x.monto, detalle: `Pago a ${nombre}`, tipo: 'proveedor' }));
        if (p.transferencia - asignado > 0.005) movs.push({ cuenta: 'Sin asignar', fecha: p.fecha, monto: -(p.transferencia - asignado), detalle: `Pago a ${nombre}`, tipo: 'proveedor' });
      }
    });
    cuotasGasto.filter((c) => c.fecha_pago && c.fecha_pago >= desde).forEach((c) => {
      const g = gastos.find((x) => x.id === c.gasto_id) || {};
      movs.push({ cuenta: canonica(c.cuenta), fecha: c.fecha_pago, monto: -c.monto, detalle: `Cuota ${c.numero} de ${g.cuotas}: ${g.descripcion}${g.tarjeta ? ` (${g.tarjeta})` : ''}`, tipo: 'cuota' });
    });
    ingresos.filter((i) => i.cuenta && !i.fondo_personal && i.fecha >= desde).forEach((i) => movs.push({ cuenta: canonica(i.cuenta), fecha: i.fecha, monto: i.monto, detalle: `Ingreso: ${i.descripcion}`, tipo: 'ingreso' }));
    movimientosOperacionesMock(desde).forEach((o) => movs.push(o));
    cuentasAjustes.filter((a) => a.fecha >= desde).forEach((a) => movs.push({ cuenta: canonica(a.cuenta), fecha: a.fecha, monto: a.monto, detalle: a.nota ? `Ajuste: ${a.nota}` : 'Ajuste de saldo', tipo: 'ajuste' }));
    return movs;
  }
  function resumenCuentasMock() {
    const cuentas = listaCuentasMock();
    const enCartera = cheques.filter((c) => c.estado === 'en_cartera');
    const cheq = { cantidad: enCartera.length, total: redondear2(enCartera.reduce((a, c) => a + c.importe, 0)) };
    if (!cajaConfig.desde) return { configurado: false, cuentas: cuentas.map((nombre) => ({ nombre, saldo_inicial: 0 })), cheques: cheq };
    const movs = movimientosCuentasMock(cajaConfig.desde);
    const inicial = (n) => cajaConfig.saldos[claveCuentaMock(n)] || 0;
    // Lo personal que hay en cada banco o app (Fondos personales), para la línea chica de la Caja.
    const personales = new Map(saldosPersonalesMock().map((c) => [claveCuentaMock(c.nombre), c.saldo]));
    const lista = cuentas.map((nombre) => ({
      nombre,
      tipo: claveCuentaMock(nombre) === 'efectivo' ? 'efectivo' : 'banco',
      saldo_inicial: inicial(nombre),
      personal: claveCuentaMock(nombre) === 'efectivo' ? 0 : personales.get(claveCuentaMock(nombre)) || 0,
      saldo: redondear2(inicial(nombre) + movs.filter((m) => m.cuenta === nombre).reduce((a, m) => a + m.monto, 0)),
      movimientos: movs.filter((m) => m.cuenta === nombre).length,
    }));
    const sin = movs.filter((m) => m.cuenta === 'Sin asignar');
    const saldoSin = redondear2(sin.reduce((a, m) => a + m.monto, 0));
    const valorUsd = redondear2(cajaConfig.usd * cajaConfig.cotizacion);
    return {
      configurado: true,
      saldoPases: saldoDePasesMock(),
      desde: cajaConfig.desde,
      cuentas: lista,
      sinAsignar: sin.length ? { saldo: saldoSin, movimientos: sin.length } : null,
      dolares: { usd: cajaConfig.usd, cotizacion: cajaConfig.cotizacion, valor: valorUsd },
      cheques: cheq,
      total: redondear2(lista.reduce((a, c) => a + c.saldo, 0) + saldoSin + valorUsd + cheq.total),
    };
  }

  // Notas de crédito (anulación de facturas con pagos) y crédito aplicado (pagos "Saldo a favor"), como en main.js.
  let notasCredito = [];
  let cobrosAnulados = [];
  const esPagoCredito = (p) => String(p.metodo_pago).trim().toLowerCase() === 'saldo a favor';
  const pagosQueEntran = () => pagos.filter((p) => !esPagoCredito(p));
  function aplicarCreditoMock(clienteId) {
    const cliente = clientes.find((c) => c.id === clienteId);
    let credito = cliente ? -cliente.saldo : 0;
    if (credito <= 0.005) return;
    facturas
      .filter((f) => f.cliente_id === clienteId && (f.estado === 'pendiente' || f.estado === 'parcial'))
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id)
      .forEach((f) => {
        if (credito <= 0.005) return;
        const pagado = pagos.filter((p) => p.factura_id === f.id).reduce((a, p) => a + p.monto, 0);
        const aplicado = redondear2(Math.min(credito, f.total - pagado));
        if (aplicado <= 0) return;
        pagos.push({ id: nextPagoId++, factura_id: f.id, monto: aplicado, metodo_pago: 'Saldo a favor', fecha: new Date().toISOString() });
        f.estado = pagado + aplicado >= f.total - 0.005 ? 'pagada' : 'parcial';
        if (f.estado === 'pagada') f.fecha_pago = new Date().toISOString();
        credito = redondear2(credito - aplicado);
      });
  }

  // Guarda una línea de factura con sus bultos (igual que `guardarItemDeFactura` en main.js); devuelve el subtotal.
  let nextBultoId = 1;
  function guardarItemFacturaMock(facturaId, item, tipoPrecio) {
    const producto = productos.find((p) => p.id === item.producto_id);
    const precioCatalogo = tipoPrecio === 'cf' ? producto.precio_cf : producto.precio_cliente;
    const precioUnitario = item.precio_unitario !== undefined && item.precio_unitario !== null ? item.precio_unitario : precioCatalogo;
    const cantidad = item.cantidad;
    const subtotal = redondear2(precioUnitario * cantidad); // en centavos, igual que main.js
    facturaItems.push({
      id: nextItemId++,
      factura_id: facturaId,
      producto_id: item.producto_id,
      producto_nombre: producto.nombre,
      producto_unidad: producto.unidad,
      cantidad,
      precio_unitario: precioUnitario,
      subtotal,
      // Lo que pidieron por unidad ("6 chorizos"), solo en productos por kilo (igual que guardarItemDeFactura en main.js).
      pedido_unidades: producto.unidad === 'kg' && Number(item.pedido_unidades) > 0 ? Number(item.pedido_unidades) : null,
      bultos: [{ id: nextBultoId++, peso: producto.unidad === 'kg' ? cantidad : null, cargado: false }],
    });
    return subtotal;
  }

  function guardarProductoProveedorMock(proveedorId, producto, descripcion, unidad) {
    const u = unidad === 'unidad' ? 'unidad' : 'kg';
    const desc = descripcion || '';
    const existente = productosProveedor.find(
      (x) => x.proveedor_id === proveedorId && x.producto.toLowerCase() === producto.toLowerCase() && (x.descripcion || '').toLowerCase() === desc.toLowerCase()
    );
    if (existente) existente.unidad = u;
    else productosProveedor.push({ id: nextProductoProveedorId++, proveedor_id: proveedorId, producto, descripcion: desc, unidad: u });
  }
  let nextCompraId = 1;
  let pagosProveedor = [];
  let devolucionesProveedor = [];
  let nextDevolucionProveedorId = 1;
  let nextPagoProveedorId = 1;

  // Alta o edición de un pago a proveedor (`existente` = el pago que se reemplaza).
  const guardarPagoMock = (p, existente) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test((p && p.fecha) || '')) return { ok: false, error: 'La fecha no es válida.' };
    const proveedor = proveedores.find((x) => x.id === Number(p.proveedor_id));
    if (!proveedor) return { ok: false, error: 'Elegí un proveedor.' };
    const numero = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
    const efectivo = numero(p.efectivo);
    const partesTransferencia = Array.isArray(p.transferencias)
      ? p.transferencias.map((x) => ({ cuenta: String((x && x.cuenta) || '').trim() || null, monto: numero(x && x.monto) })).filter((x) => x.monto > 0)
      : null;
    const transferencia = partesTransferencia ? redondear2(partesTransferencia.reduce((a, x) => a + x.monto, 0)) : numero(p.transferencia);
    if (![efectivo, transferencia].every((n) => Number.isFinite(n) && n >= 0)) return { ok: false, error: 'Los montos no son válidos.' };
    const ids = [...new Set((Array.isArray(p.cheque_ids) ? p.cheque_ids : []).map(Number))];
    if (efectivo + transferencia + ids.length === 0) return { ok: false, error: 'Poné cuánto le pagaste.' };
    const disponible = (c) => c && (c.estado === 'en_cartera' || (existente && c.pago_proveedor_id === existente.id));
    const chs = ids.map((id) => cheques.find((c) => c.id === id));
    if (chs.some((c) => !disponible(c))) return { ok: false, error: 'Alguno de los cheques ya no está en la cartera.' };
    if (existente) {
      cheques.filter((c) => c.pago_proveedor_id === existente.id).forEach((c) => Object.assign(c, { estado: 'en_cartera', entregado_a: null, fecha_entrega: null, pago_proveedor_id: null }));
      Object.assign(existente, { fecha: p.fecha, efectivo: redondear2(efectivo), transferencia: redondear2(transferencia) });
    }
    const pago = existente || { id: nextPagoProveedorId++, proveedor_id: proveedor.id, fecha: p.fecha, efectivo: redondear2(efectivo), transferencia: redondear2(transferencia), nota: String(p.nota || '').trim() || null, creado: new Date().toISOString() };
    if (!existente) pagosProveedor.push(pago);
    if (partesTransferencia) pago.transferencias = partesTransferencia.map((x) => ({ ...x, monto: redondear2(x.monto) }));
    chs.forEach((c) => Object.assign(c, { estado: 'entregado', entregado_a: proveedor.nombre, fecha_entrega: p.fecha, pago_proveedor_id: pago.id }));
    return { ok: true };
  };
  function conSaldoProveedor(p) {
    const comprado = compras.filter((c) => c.proveedor_id === p.id).reduce((a, c) => a + c.total, 0);
    const pagado = pagosProveedor
      .filter((x) => x.proveedor_id === p.id)
      .reduce((a, x) => a + x.efectivo + x.transferencia + cheques.filter((c) => c.pago_proveedor_id === x.id).reduce((s, c) => s + c.importe, 0), 0);
    const devs = devolucionesProveedor.filter((d) => d.proveedor_id === p.id);
    const devuelto = devs.reduce((a, d) => a + d.monto, 0) - devs.filter((d) => d.reembolso_cuenta).reduce((a, d) => a + d.monto, 0);
    const fechas = compras.filter((c) => c.proveedor_id === p.id).map((c) => c.fecha).sort();
    return { ...p, saldo: redondear2(p.saldo_inicial + comprado - pagado - devuelto), ultima_compra: fechas.length ? fechas[fechas.length - 1] : null };
  }
  function datosProveedorMock(p) {
    const nombre = String(p.nombre || '').trim();
    if (!nombre) return { error: 'Poné el nombre del proveedor.' };
    const saldoInicial = p.saldo_inicial === undefined || p.saldo_inicial === '' || p.saldo_inicial === null ? 0 : Number(p.saldo_inicial);
    if (!Number.isFinite(saldoInicial)) return { error: 'El saldo inicial no es válido.' };
    return { nombre, telefono: String(p.telefono || '').trim() || null, nota: String(p.nota || '').trim() || null, saldoInicial: redondear2(saldoInicial) };
  }
  function guardarCompraMock(c, existente) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.fecha || '')) return { ok: false, error: 'La fecha no es válida.' };
    const proveedor = proveedores.find((x) => x.id === Number(c.proveedor_id));
    if (!proveedor) return { ok: false, error: 'Elegí un proveedor.' };
    if (!Array.isArray(c.items) || c.items.length === 0) return { ok: false, error: 'Agregá al menos un producto.' };
    const items = [];
    for (const it of c.items) {
      const producto = limpiarProductoMock(it && it.producto);
      const importe = Number(it && it.importe);
      if (!producto) return { ok: false, error: 'Elegí el producto de cada línea.' };
      if (!Number.isFinite(importe) || importe <= 0) return { ok: false, error: `Poné el importe de "${producto}".` };
      const descripcion = limpiarDescripcionMock(it && it.descripcion);
      const unidad = it.unidad === 'unidad' ? 'unidad' : 'kg';
      const kilos = it.kilos === null || it.kilos === undefined || it.kilos === '' ? null : Number(it.kilos);
      if (kilos !== null && (!Number.isFinite(kilos) || kilos <= 0)) {
        return { ok: false, error: unidad === 'unidad' ? `La cantidad de "${producto}" no es válida.` : `Los kilos de "${producto}" no son válidos.` };
      }
      const precio = it.precio_kg === null || it.precio_kg === undefined || it.precio_kg === '' ? null : Number(it.precio_kg);
      if (precio !== null && (!Number.isFinite(precio) || precio <= 0)) {
        return { ok: false, error: unidad === 'unidad' ? `El precio por unidad de "${producto}" no es válido.` : `El precio por kilo de "${producto}" no es válido.` };
      }
      items.push({ producto, descripcion, unidad, kilos, precio_kg: precio, importe: redondear2(importe) });
    }
    const total = redondear2(items.reduce((a, i) => a + i.importe, 0));
    const nota = String(c.nota || '').trim() || null;
    const comprobante = String(c.comprobante || '').trim() || null;
    if (existente) Object.assign(existente, { fecha: c.fecha, total, nota, comprobante, items });
    else compras.push({ id: nextCompraId++, proveedor_id: proveedor.id, fecha: c.fecha, total, nota, comprobante, items, creado: new Date().toISOString() });
    items.forEach((i) => guardarProductoProveedorMock(proveedor.id, i.producto, i.descripcion, i.unidad));
    return { ok: true };
  }
  const nombresCategoriasGasto = [
    'Alquileres', 'Servicios del negocio', 'Insumos de producción', 'Insumos indirectos',
    'Mantenimiento del negocio', 'Mantenimiento de vehículos', 'Impuestos del negocio', 'Sueldos',
    'Gastos fijos', 'Inversiones', 'Préstamos y créditos', 'Particulares', 'Otros', 'Comisiones bancarias',
  ];
  let categoriasGasto = nombresCategoriasGasto.map((nombre, i) => ({ id: i + 1, nombre, activo: 1, ambito: nombre === 'Particulares' ? 'personal' : 'negocio', de_fondos: 0 }));
  let nextCategoriaGastoId = categoriasGasto.length + 1;
  // Fondos personales (ingresos y gastos de propiedades) tiene su propia lista dentro de `categoriasGasto` (`de_fondos: 1`), separada de Gastos → Personal.
  ['Alquiler', 'Otros'].forEach((nombre) => categoriasGasto.push({ id: nextCategoriaGastoId++, nombre, activo: 1, ambito: 'personal', de_fondos: 1 }));
  const categoriaAutomaticaMock = (nombre) => {
    const existente = categoriasGasto.find((c) => c.ambito === 'personal' && c.de_fondos === 1 && c.nombre.toLowerCase() === nombre.toLowerCase());
    if (existente) {
      existente.activo = 1;
      return existente.id;
    }
    categoriasGasto.push({ id: nextCategoriaGastoId++, nombre, activo: 1, ambito: 'personal', de_fondos: 1 });
    return categoriasGasto[categoriasGasto.length - 1].id;
  };
  const ingresoDirectoMock = ({ fecha, cuenta, monto, observacion }, categoria_id, descripcion, retiro_id = null) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return { ok: false, error: 'La fecha no es válida.' };
    const importe = Number(monto);
    if (!Number.isFinite(importe) || importe <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
    const cuentaElegida = cuentaPersonalMock(cuenta);
    if (!cuentaElegida) return { ok: false, error: 'Elegí en qué cuenta entró.' };
    const id = (ingresos.reduce((a, x) => Math.max(a, x.id), 0) || 0) + 1;
    ingresos.push({ id, fecha, categoria_id, descripcion, monto: redondear2(importe), cuenta: cuentaElegida, observacion: String(observacion || '').trim() || null, fondo_personal: 1, retencion: 0, retiro_id });
    return { ok: true };
  };
  const categoriaPersonalMock = (id) => categoriasGasto.find((c) => c.id === Number(id) && c.activo && c.ambito === 'personal' && c.de_fondos === 1);
  const categoriaGastoPersonalMock = (id) => categoriasGasto.find((c) => c.id === Number(id) && c.activo && c.ambito === 'personal' && c.de_fondos === 2);
  let gastos = [];
  let nextGastoId = 1;
  let descripcionesGasto = [
    ['Internet', 2], ['Fletes', 2], ['Bolsas/Separ/Cintas', 3],
    ['Pan rallado 1', 3], ['Camión combustible', 4], ['Limpieza', 4], ['Ferretería', 5], ['Ingresos brutos', 7], ['Refrigerio', 9],
  ].map(([nombre, categoria_id], i) => ({ id: i + 1, nombre, categoria_id, orden: 0 }));
  let nextDescripcionGastoId = descripcionesGasto.length + 1;
  const MEDIOS_GASTO = ['Efectivo', 'Transferencia', 'Cheque', 'Débito', 'Crédito', 'Débito / Tarjeta'];
  const paraFechaValidaMock = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && v > periodoDia(new Date()) ? v : null);
  let nextPedidoId = 1;
  let nextPedidoItemId = 1;
  let direccionLocal = '';
  let zonaLocal = { ciudad: '', provincia: '' };
  let temaMock = null;
  let retencionTransferencia = 0;

  // Usuarios (para probar la pantalla en el navegador): arranca con un administrador ya cargado, contraseña
  // "1234", así se puede entrar directo sin pasar por "Crear contraseña de acceso". Para probar esa pantalla,
  // vaciar `usuariosMock` antes de recargar.
  let usuariosMock = [{ id: 1, nombre: 'Administrador', pin: '1234', rol: 'admin', activo: 1 }];
  let vendedoresMock = [];
  let comisionesPagadasMock = []; // { id, vendedor_id, mes, gasto_id, fecha, monto }
  let nextComisionPagoMockId = 1;
  const fechaLocalHoyMock = () => {
    const h = new Date();
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
  };
  let nextVendedorMockId = 1;
  let nextUsuarioMockId = 2;
  let sesionActualMock = null;

  window.freska = {
    __mock: true,
    config: {
      obtenerTema: async () => temaMock,
      guardarTema: async (tema) => {
        if (tema !== 'light' && tema !== 'dark') return false;
        temaMock = tema;
        return true;
      },
      obtenerZonaLocal: async () => ({ ...zonaLocal }),
      guardarZonaLocal: async ({ ciudad, provincia } = {}) => {
        zonaLocal = { ciudad: String(ciudad || '').trim(), provincia: String(provincia || '').trim() };
        return true;
      },
      obtenerDireccionLocal: async () => direccionLocal,
      guardarDireccionLocal: async (direccion) => {
        direccionLocal = direccion;
        return true;
      },
      obtenerRetencionTransferencia: async () => retencionTransferencia,
      guardarRetencionTransferencia: async (porcentaje) => {
        const n = Number(porcentaje);
        if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: 'Poné un porcentaje entre 0 y 100.' };
        retencionTransferencia = n;
        return { ok: true };
      },
    },
    clientes: {
      listar: async () => clientes,
      crear: async ({ nombre, apellido, telefono, telefono_fijo, telefono2, telefono2_nombre, domicilio, nota, codigo, condicion_iva, cuit, negocio, saldo_inicial, vendedor_id }) => {
        const extra = datosDeClienteMock({ codigo, condicion_iva, cuit }, 0);
        if (extra.error) return { ok: false, error: extra.error };
        const yaExiste = clientes.some(
          (c) =>
            normalizarTexto(c.nombre) === normalizarTexto(nombre) &&
            normalizarTexto(c.apellido || '') === normalizarTexto(apellido || '')
        );
        if (yaExiste) {
          return { ok: false, error: 'Ya existe un cliente con ese nombre y apellido.' };
        }
        const saldoInicial = saldo_inicial === undefined || saldo_inicial === '' || saldo_inicial === null ? 0 : Number(saldo_inicial);
        if (!Number.isFinite(saldoInicial)) return { ok: false, error: 'El saldo inicial no es válido.' };
        const nuevo = {
          id: nextClienteId++,
          nombre,
          apellido: apellido || '',
          telefono: telefono || '',
          telefono_fijo: telefono_fijo || '',
          telefono2: telefono2 || '',
          telefono2_nombre: String(telefono2_nombre || '').trim().slice(0, 40) || null,
          domicilio: domicilio || '',
          nota: nota || '',
          saldo: redondear2(saldoInicial),
          saldo_inicial: redondear2(saldoInicial),
          activo: 1,
          codigo: extra.codigo,
          condicion_iva: extra.condicion_iva,
          cuit: extra.cuit,
          negocio: String(negocio || '').trim().slice(0, 80) || null,
          vendedor_id: sesionActualMock && sesionActualMock.rol === 'empleado' ? null : Number(vendedor_id) || null,
        };
        clientes.push(nuevo);
        return { ok: true, cliente: nuevo };
      },
      actualizar: async ({ id, nombre, apellido, telefono, telefono_fijo, telefono2, telefono2_nombre, domicilio, nota, codigo, condicion_iva, cuit, negocio, saldo_inicial, vendedor_id }) => {
        const extra = datosDeClienteMock({ codigo, condicion_iva, cuit }, id);
        if (extra.error) return { ok: false, error: extra.error };
        const yaExiste = clientes.some(
          (c) =>
            c.id !== id &&
            normalizarTexto(c.nombre) === normalizarTexto(nombre) &&
            normalizarTexto(c.apellido || '') === normalizarTexto(apellido || '')
        );
        if (yaExiste) {
          return { ok: false, error: 'Ya existe un cliente con ese nombre y apellido.' };
        }
        const c = clientes.find((x) => x.id === id);
        const saldoInicial = saldo_inicial === undefined || saldo_inicial === '' || saldo_inicial === null ? 0 : Number(saldo_inicial);
        if (!Number.isFinite(saldoInicial)) return { ok: false, error: 'El saldo inicial no es válido.' };
        const diferencia = redondear2(saldoInicial - (c.saldo_inicial || 0));
        Object.assign(c, {
          nombre,
          apellido: apellido || '',
          telefono: telefono || '',
          telefono_fijo: telefono_fijo || '',
          telefono2: telefono2 || '',
          telefono2_nombre: String(telefono2_nombre || '').trim().slice(0, 40) || null,
          domicilio: domicilio || '',
          nota: nota || '',
          codigo: extra.codigo,
          condicion_iva: extra.condicion_iva,
          cuit: extra.cuit,
          negocio: String(negocio || '').trim().slice(0, 80) || null,
          saldo_inicial: redondear2(saldoInicial),
          saldo: redondear2(c.saldo + diferencia),
          ...(vendedor_id === undefined || (sesionActualMock && sesionActualMock.rol === 'empleado') ? {} : { vendedor_id: Number(vendedor_id) || null }),
        });
        return { ok: true, cliente: c };
      },
      eliminar: async (id) => {
        const tieneFacturas = facturas.some((f) => f.cliente_id === id);
        if (tieneFacturas) {
          return { ok: false, error: 'No se puede eliminar: tiene facturas asociadas.' };
        }
        clientes = clientes.filter((c) => c.id !== id);
        return { ok: true };
      },
      darDeBaja: async (id) => {
        const c = clientes.find((x) => x.id === id);
        if (!c) return { ok: false, error: 'No se encontró el cliente.' };
        if (redondear2(c.saldo) > 0) {
          return {
            ok: false,
            error: `No se puede dar de baja: todavía debe $${c.saldo.toLocaleString('es-AR')}. Primero hay que saldar la cuenta.`,
          };
        }
        c.activo = 0;
        return { ok: true };
      },
      darDeAlta: async (id) => {
        const c = clientes.find((x) => x.id === id);
        if (c) c.activo = 1;
        return { ok: true };
      },
      registrarConsulta: async (id) => {
        const c = clientes.find((x) => x.id === id);
        if (c) c.ultima_consulta = new Date().toISOString();
        return c;
      },
      registrarPagoGeneral: async ({ cliente_id, monto, metodo_pago, cheque }) => {
        if (!(monto > 0)) {
          return { ok: false, error: 'El monto tiene que ser mayor a cero.' };
        }
        const datosCheque = esMetodoCheque(metodo_pago) ? datosChequeCobro(cheque) : null;
        if (datosCheque && datosCheque.error) return { ok: false, error: datosCheque.error };
        // El tope es el saldo del cliente, no la suma de facturas pendientes: el saldo también incluye lo
        // que no tiene factura propia (ej. el saldo inicial cargado a mano).
        const cliente = clientes.find((c) => c.id === cliente_id);
        if (!cliente) return { ok: false, error: 'Ese cliente ya no existe.' };
        if (monto > cliente.saldo + 0.01) {
          return {
            ok: false,
            error: `Ese monto es mayor a lo que debe (le queda pendiente $${cliente.saldo.toLocaleString('es-AR')}).`,
          };
        }
        const facturasPendientes = facturas
          .filter((f) => f.cliente_id === cliente_id && (f.estado === 'pendiente' || f.estado === 'parcial'))
          .map((f) => {
            const pagado = pagos
              .filter((p) => p.factura_id === f.id)
              .reduce((acc, p) => acc + p.monto, 0);
            return { f, pagado };
          })
          .sort((a, b) => new Date(a.f.fecha) - new Date(b.f.fecha) || a.f.id - b.f.id);

        // Un cobro baja primero lo más antiguo: el saldo anterior (sin factura) y después las facturas, de la más vieja a la más nueva.
        const cobradoDelAnterior = pagos.filter((p) => p.factura_id == null && p.cliente_id === cliente_id && p.monto > 0).reduce((acc, p) => acc + p.monto, 0);
        const saldoAnterior = Math.max(0, Math.round(((cliente.saldo_inicial || 0) - cobradoDelAnterior) * 100) / 100);
        let restante = monto;
        const idsPagosNuevos = [];
        const aSaldoAnterior = Math.min(restante, saldoAnterior);
        if (aSaldoAnterior > 0.005) {
          idsPagosNuevos.push(nextPagoId);
          pagos.push({ id: nextPagoId++, factura_id: null, cliente_id, monto: aSaldoAnterior, metodo_pago: metodo_pago || 'Efectivo', fecha: new Date().toISOString(), creado_por: sesionActualMock ? sesionActualMock.id : null });
          restante = Math.round((restante - aSaldoAnterior) * 100) / 100;
        }
        for (const { f, pagado } of facturasPendientes) {
          if (restante <= 0) break;
          const debeFactura = f.total - pagado;
          const aplicado = Math.min(restante, debeFactura);
          if (aplicado <= 0) continue;
          idsPagosNuevos.push(nextPagoId);
          pagos.push({
            id: nextPagoId++,
            factura_id: f.id,
            monto: aplicado,
            metodo_pago: metodo_pago || 'Efectivo',
            fecha: new Date().toISOString(),
            creado_por: sesionActualMock ? sesionActualMock.id : null,
          });
          const nuevoPagado = pagado + aplicado;
          f.estado = nuevoPagado >= f.total ? 'pagada' : 'parcial';
          if (f.estado === 'pagada') f.fecha_pago = new Date().toISOString();
          restante -= aplicado;
        }

        // Lo que sobra después de cubrir las facturas es del saldo anterior (saldo inicial): cobro sin factura.
        if (restante > 0.005) {
          idsPagosNuevos.push(nextPagoId);
          pagos.push({
            id: nextPagoId++,
            factura_id: null,
            cliente_id,
            monto: redondear2(restante),
            metodo_pago: metodo_pago || 'Efectivo',
            fecha: new Date().toISOString(),
            creado_por: sesionActualMock ? sesionActualMock.id : null,
          });
        }
        cliente.saldo = redondear2(cliente.saldo - monto);
        if (datosCheque) guardarChequeDeCobro(datosCheque, monto, cliente_id);
        registrarRetencionTransferenciaMock(metodo_pago, monto, null, null, idsPagosNuevos);
        return { ok: true };
      },
      historial: async (clienteId) =>
        facturas
          .filter((f) => f.cliente_id === clienteId)
          .map((f) => {
            const pagado = pagos
              .filter((p) => p.factura_id === f.id)
              .reduce((acc, p) => acc + p.monto, 0);
            return { ...f, pagado };
          })
          .sort((a, b) => b.id - a.id),
      cobrosAnulados: async (clienteId) =>
        cobrosAnulados
          .filter((c) => c.cliente_id === clienteId)
          .map((c) => {
            const anulador = usuariosMock.find((u) => u.id === c.anulado_por);
            return { ...c, anulado_por_nombre: anulador ? anulador.nombre : null, anulado_por_rol: anulador ? anulador.rol : null };
          })
          .sort((a, b) => b.id - a.id),
      notasCredito: async (clienteId) => notasCredito.filter((n) => n.cliente_id === clienteId).sort((a, b) => b.id - a.id),
      historialPagos: async (clienteId) => {
        const facturaIds = facturas
          .filter((f) => f.cliente_id === clienteId && f.estado !== 'anulada')
          .map((f) => f.id);
        return pagos
          .filter((p) => (facturaIds.includes(p.factura_id) || (p.factura_id == null && p.cliente_id === clienteId)) && !esPagoCredito(p))
          .map((p) => {
            const creador = usuariosMock.find((u) => u.id === p.creado_por);
            return {
              ...p,
              factura_total: facturas.find((f) => f.id === p.factura_id)?.total ?? 0,
              creado_por_nombre: creador ? creador.nombre : null,
              creado_por_rol: creador ? creador.rol : null,
            };
          })
          .sort((a, b) => b.id - a.id);
      },
    },
    productos: {
      // `ultima_unidad_pedido`: cómo se pidió la última vez ('unidad' o 'kg'; vacío si nunca se pidió).
      listar: async () =>
        productos
          .filter((p) => p.activo)
          .map((p) => {
            const ultimo = [...pedidoItems].reverse().find((i) => i.producto_id === p.id);
            return { ...p, ultima_unidad_pedido: ultimo ? (ultimo.unidad_pedido === 'unidad' ? 'unidad' : 'kg') : null };
          }),
      crear: async ({ nombre, codigo, precio_cliente, precio_cf, unidad, presentacion, pedible_por_unidad, peso_unidad_pedido }) => {
        const pedidoUnidad = pedidoPorUnidadMock(unidad || 'unidad', pedible_por_unidad, peso_unidad_pedido);
        if (pedidoUnidad.error) return { ok: false, error: pedidoUnidad.error };
        const codigoLimpio = String(codigo || '').trim();
        if (!codigoLimpio) return { ok: false, error: 'Poné un código: es obligatorio.' };
        const conMismoCodigo = productos.find((p) => p.activo && String(p.codigo || '').trim().toLowerCase() === codigoLimpio.toLowerCase());
        if (conMismoCodigo) return { ok: false, error: `El código ${codigoLimpio} ya lo tiene "${conMismoCodigo.nombre}".` };
        if (productos.some((p) => p.activo && normalizarTexto(p.nombre) === normalizarTexto(nombre))) {
          return { ok: false, error: 'Ya existe un producto con ese nombre o código.' };
        }
        // Si el código o el nombre son de un producto dado de baja, se reactiva ese mismo en vez de
        // bloquear la creación (igual que en la app real: ver productos.js).
        const deBaja = productos.find(
          (p) => !p.activo && (String(p.codigo || '').trim().toLowerCase() === codigoLimpio.toLowerCase() || normalizarTexto(p.nombre) === normalizarTexto(nombre))
        );
        const datos = {
          nombre,
          codigo: codigoLimpio,
          precio_cliente,
          precio_cf,
          unidad: unidad || 'unidad',
          presentacion: (unidad || 'unidad') === 'kg' ? null : presentacion === 'caja' ? 'caja' : 'unidad',
          pedible_por_unidad: pedidoUnidad.pedible,
          peso_unidad_pedido: pedidoUnidad.peso,
          activo: 1,
        };
        if (deBaja) {
          Object.assign(deBaja, datos);
          return { ok: true, producto: deBaja };
        }
        const nuevo = { id: productos.length + 1, ...datos };
        productos.push(nuevo);
        return { ok: true, producto: nuevo };
      },
      actualizar: async ({ id, nombre, codigo, precio_cliente, precio_cf, unidad, presentacion, pedible_por_unidad, peso_unidad_pedido }) => {
        const pedidoUnidad = pedidoPorUnidadMock(unidad, pedible_por_unidad, peso_unidad_pedido);
        if (pedidoUnidad.error) return { ok: false, error: pedidoUnidad.error };
        const codigoLimpio = String(codigo || '').trim();
        if (!codigoLimpio) return { ok: false, error: 'Poné un código: es obligatorio.' };
        const conMismoCodigo = productos.find((p) => p.id !== id && p.activo && String(p.codigo || '').trim().toLowerCase() === codigoLimpio.toLowerCase());
        if (conMismoCodigo) return { ok: false, error: `El código ${codigoLimpio} ya lo tiene "${conMismoCodigo.nombre}".` };
        if (productos.some((p) => p.id !== id && normalizarTexto(p.nombre) === normalizarTexto(nombre))) {
          return { ok: false, error: 'Ya existe un producto con ese nombre o código.' };
        }
        const p = productos.find((x) => x.id === id);
        Object.assign(p, { nombre, codigo: codigoLimpio, precio_cliente, precio_cf, unidad, presentacion: unidad === 'kg' ? null : presentacion === 'caja' ? 'caja' : 'unidad', pedible_por_unidad: pedidoUnidad.pedible, peso_unidad_pedido: pedidoUnidad.peso });
        return { ok: true, producto: p };
      },
      baja: async (id) => {
        const p = productos.find((x) => x.id === id);
        if (p) p.activo = 0;
        return true;
      },
    },
    metodosPago: {
      listar: async () => metodosPago.filter((m) => m.activo),
      crear: async (nombre) => {
        const nuevo = { id: nextMetodoPagoId++, nombre, activo: 1 };
        metodosPago.push(nuevo);
        return nuevo;
      },
      actualizar: async ({ id, nombre }) => {
        const m = metodosPago.find((x) => x.id === id);
        Object.assign(m, { nombre });
        return m;
      },
      baja: async (id) => {
        const m = metodosPago.find((x) => x.id === id);
        if (m) m.activo = 0;
        return { ok: true };
      },
    },
    pedidos: {
      listar: async () =>
        pedidos
          .map((p) => {
            const cliente = clientes.find((c) => c.id === p.cliente_id);
            const resumen = pedidoItems
              .filter((i) => i.pedido_id === p.id)
              .map((i) => {
                const producto = productos.find((pr) => pr.id === i.producto_id);
                return `${i.cantidad}${producto.unidad === 'kg' && i.unidad_pedido !== 'unidad' ? 'kg' : 'u.'} ${producto.nombre}`;
              })
              .join(', ');
            const creador = usuariosMock.find((u) => u.id === p.creado_por);
            return { ...p, cliente_nombre: nombreCompleto(cliente), resumen, creado_por_nombre: creador ? creador.nombre : null, creado_por_rol: creador ? creador.rol : null };
          })
          .sort((a, b) => b.id - a.id),
      items: async (pedidoId) =>
        pedidoItems
          .filter((i) => i.pedido_id === pedidoId)
          .map((i) => {
            const producto = productos.find((pr) => pr.id === i.producto_id);
            return {
              ...i,
              producto_nombre: producto.nombre,
              producto_unidad: producto.unidad,
              peso_unidad_pedido: producto.peso_unidad_pedido || null,
              precio_cliente: producto.precio_cliente,
              precio_cf: producto.precio_cf,
            };
          }),
      crear: async ({ cliente_id, items, para_fecha }) => {
        const pedidoId = nextPedidoId++;
        pedidos.push({
          id: pedidoId,
          cliente_id,
          fecha: new Date().toISOString(),
          estado: 'pendiente',
          factura_id: null,
          para_fecha: paraFechaValidaMock(para_fecha),
          creado_por: sesionActualMock ? sesionActualMock.id : null,
        });
        items.forEach((item) => {
          pedidoItems.push({
            id: nextPedidoItemId++,
            pedido_id: pedidoId,
            producto_id: item.producto_id,
            cantidad: item.cantidad,
            unidad_pedido: unidadPedidoMock(item),
          });
        });
        return { ok: true, id: pedidoId };
      },
      actualizar: async ({ id, items, para_fecha }) => {
        const pedidoActual = pedidos.find((p) => p.id === id);
        if (pedidoActual && para_fecha !== undefined) pedidoActual.para_fecha = paraFechaValidaMock(para_fecha);
        pedidoItems = pedidoItems.filter((i) => i.pedido_id !== id);
        items.forEach((item) => {
          pedidoItems.push({
            id: nextPedidoItemId++,
            pedido_id: id,
            producto_id: item.producto_id,
            cantidad: item.cantidad,
            unidad_pedido: unidadPedidoMock(item),
          });
        });
        return { ok: true };
      },
      marcarFacturado: async ({ id, factura_id, items }) => {
        const p = pedidos.find((x) => x.id === id);
        if (p) {
          p.estado = 'facturado';
          p.factura_id = factura_id;
        }
        if (items) {
          // Lo pedido por unidad ("6 chorizos") se conserva, junto con lo pedido en kilos de ese mismo producto: lo facturado
          // en kilos queda en la factura.
          const productosPorUnidad = new Set(pedidoItems.filter((i) => i.pedido_id === id && i.unidad_pedido === 'unidad').map((i) => i.producto_id));
          const conservadas = pedidoItems.filter((i) => i.pedido_id === id && productosPorUnidad.has(i.producto_id));
          pedidoItems = pedidoItems.filter((i) => i.pedido_id !== id);
          items.forEach((item) => {
            if (productosPorUnidad.has(item.producto_id)) return;
            pedidoItems.push({ id: nextPedidoItemId++, pedido_id: id, producto_id: item.producto_id, cantidad: item.cantidad, unidad_pedido: null });
          });
          conservadas.forEach((i) => pedidoItems.push({ ...i, id: nextPedidoItemId++ }));
        }
        return { ok: true };
      },
      eliminar: async (id) => {
        pedidos = pedidos.filter((p) => p.id !== id);
        pedidoItems = pedidoItems.filter((i) => i.pedido_id !== id);
        return { ok: true };
      },
    },
    tarjetas: {
      listar: async () => tarjetas.filter((t) => t.activo).map(({ id, cuenta, nombre, tipo }) => ({ id, cuenta, nombre, tipo })).sort((a, b) => a.cuenta.localeCompare(b.cuenta) || a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre)),
      crear: async ({ cuenta, nombre, tipo }) => {
        const banco = listaCuentasMock().find((c) => claveCuentaMock(c) === claveCuentaMock(cuenta) && claveCuentaMock(c) !== 'efectivo');
        const texto = String(nombre || '').trim();
        if (!banco) return { ok: false, error: 'Esa cuenta no existe.' };
        if (!texto) return { ok: false, error: 'Poné el nombre de la tarjeta (por ejemplo, Visa).' };
        if (!['Débito', 'Crédito'].includes(tipo)) return { ok: false, error: 'Elegí si es de débito o de crédito.' };
        if (tarjetas.some((t) => t.activo && t.cuenta === banco && t.tipo === tipo && t.nombre.toLowerCase() === texto.toLowerCase())) return { ok: false, error: 'Esa tarjeta ya está cargada.' };
        tarjetas.push({ id: nextTarjetaId++, cuenta: banco, nombre: texto, tipo, activo: 1 });
        return { ok: true };
      },
      quitar: async (id) => {
        const t = tarjetas.find((x) => x.id === Number(id));
        if (t) t.activo = 0;
        return { ok: true };
      },
    },
    pagos: {
      cambiarMetodo: async ({ ids, metodo_pago }) => {
        const lista = (Array.isArray(ids) ? ids : []).map(Number);
        const metodo = metodosPago.find((m) => m.activo && m.nombre.toLowerCase() === String(metodo_pago || '').trim().toLowerCase());
        if (!metodo || ['cheque', 'saldo a favor'].includes(metodo.nombre.trim().toLowerCase())) return { ok: false, error: 'Elegí con qué se pagó.' };
        const ps = lista.map((id) => pagos.find((p) => p.id === id));
        if (ps.some((p) => !p)) return { ok: false, error: 'Ese cobro ya no existe.' };
        if (ps.some((p) => p.monto <= 0 || ['cheque', 'saldo a favor'].includes(String(p.metodo_pago).trim().toLowerCase()))) return { ok: false, error: 'Un cobro con cheque, con saldo a favor o una devolución no se puede cambiar.' };
        ps.forEach((p) => (p.metodo_pago = metodo.nombre));
        return { ok: true };
      },
      anular: async ({ ids, motivo }) => {
        const lista = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
        if (!lista.length) return { ok: false, error: 'No hay nada para anular.' };
        const ps = lista.map((id) => pagos.find((p) => p.id === id));
        if (ps.some((p) => !p)) return { ok: false, error: 'Ese cobro ya no existe.' };
        if (ps.some((p) => p.factura_id != null && (facturas.find((f) => f.id === p.factura_id) || {}).estado === 'anulada')) return { ok: false, error: 'Esa factura ya está anulada.' };
        if (ps.some((p) => p.monto <= 0 || ['cheque', 'saldo a favor'].includes(String(p.metodo_pago).trim().toLowerCase()))) return { ok: false, error: 'Un cobro con cheque, con saldo a favor o una devolución no se puede anular desde acá.' };
        const fac0 = facturas.find((f) => f.id === ps[0].factura_id);
        const clienteDelCobro = fac0 ? fac0.cliente_id : ps[0].cliente_id ?? null;
        // Se guarda tal cual (snapshot) antes de borrarlo, para poder "Reactivar" (deshacer la anulación) más adelante.
        const snapshot = ps.map((p) => ({ factura_id: p.factura_id, monto: p.monto, metodo_pago: p.metodo_pago, fecha: p.fecha }));
        const retencionGasto = gastos.find((g) => g.pago_ids && String(g.pago_ids).split(',').every((x) => lista.includes(Number(x))));
        cobrosAnulados.push({
          id: cobrosAnulados.length + 1,
          cliente_id: clienteDelCobro,
          fecha: new Date().toISOString(),
          fecha_cobro: ps.map((p) => p.fecha).filter(Boolean).sort()[0] || null,
          monto: redondear2(ps.reduce((a, p) => a + p.monto, 0)),
          metodo: [...new Set(ps.map((p) => String(p.metodo_pago).trim()))].join(' y '),
          facturas: [...new Set(ps.map((p) => p.factura_id).filter((n) => n != null))].sort((a, b) => a - b).join(','),
          motivo: String(motivo || '').trim() || null,
          anulado_por: sesionActualMock ? sesionActualMock.id : null,
          reactivable: true,
          reactivado_en: null,
          snapshot,
          retencionSnapshot: retencionGasto ? { categoria_id: retencionGasto.categoria_id, descripcion: retencionGasto.descripcion, monto: retencionGasto.monto, medio_pago: retencionGasto.medio_pago, cuenta: retencionGasto.cuenta, ingreso_id: retencionGasto.ingreso_id } : null,
        });
        pagos = pagos.filter((p) => !lista.includes(p.id));
        new Set(ps.map((p) => p.factura_id).filter((n) => n != null)).forEach((facturaId) => {
          const f = facturas.find((x) => x.id === facturaId);
          const pagado = pagos.filter((p) => p.factura_id === facturaId).reduce((a, p) => a + p.monto, 0);
          f.estado = pagado <= 0.005 ? 'pendiente' : pagado >= f.total - 0.005 ? 'pagada' : 'parcial';
          if (f.estado !== 'pagada') f.fecha_pago = null;
        });
        // Todo lo cobrado (con o sin factura) vuelve a ser deuda del cliente.
        const clienteAnulado = clientes.find((c) => c.id === clienteDelCobro);
        if (clienteAnulado) clienteAnulado.saldo = redondear2(clienteAnulado.saldo + ps.reduce((a, p) => a + p.monto, 0));
        if (retencionGasto) gastos = gastos.filter((g) => g !== retencionGasto);
        return { ok: true };
      },
      reactivarCobro: async (id) => {
        const anulado = cobrosAnulados.find((c) => c.id === Number(id));
        if (!anulado) return { ok: false, error: 'Ese cobro anulado ya no existe.' };
        if (anulado.reactivado_en) return { ok: false, error: 'Ese cobro ya se había reactivado antes.' };
        const snapshot = anulado.snapshot || [];
        if (!snapshot.length) return { ok: false, error: 'Esta anulación es de antes de que se pudiera reactivar: no se puede deshacer.' };
        const facturaIds = [...new Set(snapshot.map((s) => s.factura_id).filter((n) => n != null))];
        const facs = facturaIds.map((fid) => facturas.find((f) => f.id === fid));
        if (facs.some((f) => !f)) return { ok: false, error: 'Una de las facturas de ese cobro ya no existe.' };
        if (facs.some((f) => f.estado === 'anulada')) return { ok: false, error: 'Una de las facturas de ese cobro se anuló después: no se puede reactivar.' };
        const nuevosIds = [];
        snapshot.forEach((s) => {
          const idNuevo = nextPagoId++;
          nuevosIds.push(idNuevo);
          pagos.push({ id: idNuevo, factura_id: s.factura_id ?? null, cliente_id: s.factura_id == null ? anulado.cliente_id : undefined, monto: s.monto, metodo_pago: s.metodo_pago, fecha: s.fecha });
        });
        facturaIds.forEach((facturaId) => {
          const f = facturas.find((x) => x.id === facturaId);
          const pagado = pagos.filter((p) => p.factura_id === facturaId).reduce((a, p) => a + p.monto, 0);
          f.estado = pagado <= 0.005 ? 'pendiente' : pagado >= f.total - 0.005 ? 'pagada' : 'parcial';
          if (f.estado === 'pagada' && !f.fecha_pago) f.fecha_pago = new Date().toISOString();
          if (f.estado !== 'pagada') f.fecha_pago = null;
        });
        const cliente = clientes.find((c) => c.id === anulado.cliente_id);
        if (cliente) cliente.saldo = redondear2(cliente.saldo - anulado.monto);
        if (anulado.retencionSnapshot) {
          const rs = anulado.retencionSnapshot;
          gastos.push({ id: nextGastoId++, fecha: fechaHoyISO(), categoria_id: rs.categoria_id, descripcion: rs.descripcion, monto: rs.monto, medio_pago: rs.medio_pago, cuenta: rs.cuenta, ingreso_id: rs.ingreso_id, pago_ids: nuevosIds.join(',') });
        }
        anulado.reactivado_en = new Date().toISOString();
        return { ok: true };
      },
    },
    cuentas: {
      resumen: async () => resumenCuentasMock(),
      movimientos: async (nombre) => {
        if (!cajaConfig.desde) return [];
        const inicial = cajaConfig.saldos[claveCuentaMock(nombre)] || 0;
        const movs = movimientosCuentasMock(cajaConfig.desde).filter((m) => m.cuenta === nombre).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
        let acumulado = inicial;
        const filas = movs.map((m) => {
          acumulado = redondear2(acumulado + m.monto);
          return { ...m, saldo: acumulado };
        });
        return { inicial, desde: cajaConfig.desde, movimientos: filas.reverse() };
      },
      guardarSaldos: async ({ desde, saldos, dolares_usd, cotizacion }) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(desde || '')) return { ok: false, error: 'La fecha no es válida.' };
        const nuevo = {};
        for (const nombre of listaCuentasMock()) {
          const v = saldos && saldos[nombre] !== undefined && saldos[nombre] !== '' ? Number(saldos[nombre]) : 0;
          if (!Number.isFinite(v)) return { ok: false, error: `El saldo de ${nombre} no es válido.` };
          nuevo[claveCuentaMock(nombre)] = redondear2(v);
        }
        const usd = Number(dolares_usd) || 0;
        const cot = Number(cotizacion) || 0;
        if (usd < 0 || cot < 0) return { ok: false, error: 'Los dólares o la cotización no son válidos.' };
        cajaConfig = { desde, saldos: nuevo, usd, cotizacion: cot };
        return { ok: true };
      },
      guardarDolares: async ({ dolares_usd, cotizacion }) => {
        const usd = Number(dolares_usd);
        const cot = Number(cotizacion);
        if (!Number.isFinite(usd) || usd < 0 || !Number.isFinite(cot) || cot < 0) return { ok: false, error: 'Los dólares o la cotización no son válidos.' };
        cajaConfig.usd = usd;
        cajaConfig.cotizacion = cot;
        return { ok: true };
      },
      ajustar: async ({ cuenta, saldo_real, nota }) => {
        const res = resumenCuentasMock();
        if (!res.configurado) return { ok: false, error: 'Primero cargá los saldos de las cuentas.' };
        const c = res.cuentas.find((x) => claveCuentaMock(x.nombre) === claveCuentaMock(cuenta));
        if (!c) return { ok: false, error: 'Esa cuenta no existe.' };
        const real = Number(saldo_real);
        if (!Number.isFinite(real)) return { ok: false, error: 'Poné el saldo que hay realmente.' };
        const diferencia = redondear2(real - c.saldo);
        if (Math.abs(diferencia) < 0.005) return { ok: true, diferencia: 0 };
        cuentasAjustes.push({ cuenta: c.nombre, fecha: periodoDia(new Date()), monto: diferencia, nota: String(nota || '').trim() || null });
        return { ok: true, diferencia };
      },
    },
    carga: {
      // Lista de carga del día (igual que `carga:hoy` en main.js): bultos de las facturas de hoy + lo pedido y sin facturar.
      hoy: async () => {
        const hoy = new Date().toISOString().slice(0, 10);
        const porProducto = new Map();
        const producto = (id, nombre, unidad) => {
          if (!porProducto.has(id)) porProducto.set(id, { producto_id: id, nombre, unidad, bultos: [], pendiente: null });
          return porProducto.get(id);
        };
        facturaItems.forEach((i) => {
          const f = facturas.find((x) => x.id === i.factura_id);
          if (!f || f.estado === 'anulada' || f.fecha.slice(0, 10) !== hoy) return;
          const cliente = nombreCompleto(clientes.find((c) => c.id === f.cliente_id));
          const p = producto(i.producto_id, i.producto_nombre, i.producto_unidad);
          (i.bultos || []).forEach((b) => p.bultos.push({ id: b.id, peso: b.peso, cargado: b.cargado, cantidad: i.producto_unidad === 'kg' ? null : i.cantidad, cliente, factura_id: f.id }));
        });
        pedidoItems.forEach((i) => {
          const pe = pedidos.find((x) => x.id === i.pedido_id);
          if (!pe || pe.estado !== 'pendiente' || pe.fecha.slice(0, 10) !== hoy) return;
          const pr = productos.find((x) => x.id === i.producto_id);
          const p = producto(pr.id, pr.nombre, pr.unidad);
          p.pendiente = p.pendiente || { cantidad: 0, unidades: 0, clientes: [] };
          if (i.unidad_pedido === 'unidad') {
            p.pendiente.unidades = Math.round((p.pendiente.unidades + i.cantidad) * 1000) / 1000;
            p.pendiente.peso_unidad = pr.peso_unidad_pedido || null;
          } else {
            p.pendiente.cantidad = Math.round((p.pendiente.cantidad + i.cantidad) * 1000) / 1000;
          }
          const cliente = nombreCompleto(clientes.find((c) => c.id === pe.cliente_id));
          if (!p.pendiente.clientes.includes(cliente)) p.pendiente.clientes.push(cliente);
        });
        return { fecha: hoy, productos: [...porProducto.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) };
      },
      marcarTodos: async ({ cargado }) => {
        const hoy = new Date().toISOString().slice(0, 10);
        facturaItems.forEach((i) => {
          const f = facturas.find((x) => x.id === i.factura_id);
          if (f && f.estado !== 'anulada' && f.fecha.slice(0, 10) === hoy) (i.bultos || []).forEach((b) => (b.cargado = Boolean(cargado)));
        });
        return { ok: true };
      },
      marcar: async ({ id, cargado }) => {
        facturaItems.forEach((i) => (i.bultos || []).forEach((b) => {
          if (b.id === Number(id)) b.cargado = Boolean(cargado);
        }));
        return { ok: true };
      },
    },
    facturas: {
      listar: async () =>
        facturas
          .map((f) => {
            const cliente = clientes.find((c) => c.id === f.cliente_id);
            const pagado = pagos
              .filter((p) => p.factura_id === f.id)
              .reduce((acc, p) => acc + p.monto, 0);
            const creador = usuariosMock.find((u) => u.id === f.creado_por);
            const anulador = usuariosMock.find((u) => u.id === f.anulado_por);
            return {
              ...f,
              cliente_nombre: nombreCompleto(cliente),
              cliente_telefono: cliente?.telefono ?? '',
              cliente_telefono2: cliente?.telefono2 ?? '',
              cliente_telefono2_nombre: cliente?.telefono2_nombre ?? '',
              pagado,
              creado_por_nombre: creador ? creador.nombre : null,
              creado_por_rol: creador ? creador.rol : null,
              anulado_por_nombre: anulador ? anulador.nombre : null,
              anulado_por_rol: anulador ? anulador.rol : null,
            };
          })
          .sort((a, b) => b.id - a.id),
      items: async (facturaId) => facturaItems.filter((i) => i.factura_id === facturaId),
      pagos: async (facturaId) =>
        pagos.filter((p) => p.factura_id === facturaId).sort((a, b) => b.id - a.id),
      crear: async ({ cliente_id, tipo_precio, items }) => {
        const facturaId = nextFacturaId++;
        let total = 0;
        for (const item of items) {
          total += guardarItemFacturaMock(facturaId, item, tipo_precio);
        }
        total = redondear2(total);
        const nueva = {
          id: facturaId,
          cliente_id,
          tipo_precio,
          fecha: new Date().toISOString(),
          fecha_pago: null,
          estado: 'pendiente',
          total,
          creado_por: sesionActualMock ? sesionActualMock.id : null,
          vendedor_id: (clientes.find((c) => c.id === cliente_id) || {}).vendedor_id || null,
        };
        facturas.push(nueva);
        const cliente = clientes.find((c) => c.id === cliente_id);
        if (cliente) cliente.saldo = redondear2(cliente.saldo + total);
        aplicarCreditoMock(cliente_id);
        return nueva;
      },
      actualizar: async ({ id, tipo_precio, items }) => {
        const factura = facturas.find((f) => f.id === id);
        if (!factura) return { ok: false, error: 'Factura no encontrada.' };

        const pagado = pagos
          .filter((p) => p.factura_id === id)
          .reduce((acc, p) => acc + p.monto, 0);
        if (factura.estado === 'anulada') {
          return { ok: false, error: 'No se puede editar una factura anulada.' };
        }
        const hoy = new Date().toISOString().slice(0, 10);
        if (factura.fecha.slice(0, 10) !== hoy) {
          return { ok: false, error: 'Solo se puede editar una factura el mismo día que se creó.' };
        }

        facturaItems = facturaItems.filter((i) => i.factura_id !== id);
        let total = 0;
        for (const item of items) {
          total += guardarItemFacturaMock(id, item, tipo_precio);
        }

        const delta = total - factura.total;
        factura.tipo_precio = tipo_precio;
        factura.total = total;
        factura.estado = pagado >= total ? 'pagada' : pagado > 0 ? 'parcial' : 'pendiente';
        if (factura.estado === 'pagada') {
          if (!factura.fecha_pago) factura.fecha_pago = new Date().toISOString();
        } else {
          factura.fecha_pago = null;
        }
        const cliente = clientes.find((c) => c.id === factura.cliente_id);
        if (cliente) cliente.saldo = redondear2(cliente.saldo + delta);

        return { ok: true, factura };
      },
      registrarPago: async ({ factura_id, monto, metodo_pago, cheque }) => {
        const factura = facturas.find((f) => f.id === factura_id);
        if (!factura) return null;
        const datosCheque = esMetodoCheque(metodo_pago) ? datosChequeCobro(cheque) : null;
        if (datosCheque && datosCheque.error) throw new Error(datosCheque.error);
        const pagadoPrevio = pagos
          .filter((p) => p.factura_id === factura_id)
          .reduce((acc, p) => acc + p.monto, 0);
        const restante = factura.total - pagadoPrevio;
        const montoAplicado = Math.max(0, Math.min(monto, restante));

        const idPagoNuevo = nextPagoId;
        pagos.push({
          id: nextPagoId++,
          factura_id,
          monto: montoAplicado,
          metodo_pago: metodo_pago || 'Efectivo',
          fecha: new Date().toISOString(),
          creado_por: sesionActualMock ? sesionActualMock.id : null,
        });

        const nuevoPagado = pagadoPrevio + montoAplicado;
        factura.estado = nuevoPagado >= factura.total ? 'pagada' : nuevoPagado > 0 ? 'parcial' : 'pendiente';
        if (factura.estado === 'pagada') factura.fecha_pago = new Date().toISOString();

        const cliente = clientes.find((c) => c.id === factura.cliente_id);
        if (cliente) cliente.saldo = redondear2(cliente.saldo - montoAplicado);
        if (datosCheque && montoAplicado > 0) guardarChequeDeCobro(datosCheque, montoAplicado, factura.cliente_id);
        registrarRetencionTransferenciaMock(metodo_pago, montoAplicado, null, null, [idPagoNuevo]);

        return factura;
      },
      anular: async ({ id, motivo, destino, metodo, monto }) => {
        const factura = facturas.find((f) => f.id === id);
        if (!factura) return { ok: false, error: 'Factura no encontrada.' };
        if (factura.estado === 'anulada') {
          return { ok: false, error: 'Esta factura ya está anulada.' };
        }
        const susPagos = pagos.filter((p) => p.factura_id === id);
        const pagado = redondear2(susPagos.reduce((acc, p) => acc + p.monto, 0));
        const devolvible = redondear2(susPagos.filter((p) => !esPagoCredito(p) && !esMetodoCheque(p.metodo_pago)).reduce((a, p) => a + p.monto, 0));
        let devuelto = 0;
        let metodoDevolucion = null;
        if (pagado > 0.005 && destino === 'devolver') {
          const valido = metodosPago.find((m) => m.activo && m.nombre.toLowerCase() === String(metodo || '').trim().toLowerCase());
          if (!valido || esMetodoCheque(valido.nombre)) return { ok: false, error: 'Elegí con qué se devuelve la plata.' };
          metodoDevolucion = valido.nombre;
          devuelto = monto === undefined || monto === null || monto === '' ? devolvible : redondear2(Number(monto));
          if (!Number.isFinite(devuelto) || devuelto <= 0) return { ok: false, error: 'Poné cuánto se devuelve.' };
          if (devuelto > devolvible + 0.005) return { ok: false, error: `Se puede devolver hasta $${devolvible} (lo demás fue con cheque o con saldo a favor).` };
        }
        const credito = redondear2(Math.max(0, pagado - devuelto));

        factura.anulado_estado_previo = factura.estado;
        factura.estado = 'anulada';
        factura.motivo_anulacion = motivo || null;
        factura.anulado_por = sesionActualMock ? sesionActualMock.id : null;
        const cliente = clientes.find((c) => c.id === factura.cliente_id);
        if (cliente) cliente.saldo = redondear2(cliente.saldo - (factura.total - devuelto));
        if (devuelto > 0) {
          const idDevolucion = nextPagoId++;
          pagos.push({ id: idDevolucion, factura_id: id, monto: -devuelto, metodo_pago: metodoDevolucion, fecha: new Date().toISOString() });
          factura.anulado_devolucion_pago_id = idDevolucion;
        }
        if (pagado > 0.005) notasCredito.push({ id: notasCredito.length + 1, factura_id: id, cliente_id: factura.cliente_id, fecha: new Date().toISOString(), credito, devuelto, metodo_devolucion: metodoDevolucion });
        if (credito > 0.005) aplicarCreditoMock(factura.cliente_id);
        return { ok: true, credito, devuelto };
      },
      reactivar: async (id) => {
        const factura = facturas.find((f) => f.id === Number(id));
        if (!factura) return { ok: false, error: 'Factura no encontrada.' };
        if (factura.estado !== 'anulada') return { ok: false, error: 'Esa factura no está anulada.' };
        if (!factura.anulado_estado_previo) return { ok: false, error: 'Esta anulación es de antes de que se pudiera reactivar: no se puede deshacer.' };
        const nota = [...notasCredito].reverse().find((n) => n.factura_id === factura.id);
        if (nota && nota.credito > 0.005) {
          const cliente = clientes.find((c) => c.id === factura.cliente_id);
          const disponible = redondear2(Math.max(0, -(cliente ? cliente.saldo : 0)));
          if (disponible + 0.01 < nota.credito) {
            return { ok: false, error: 'El saldo a favor que generó esta anulación ya se usó (al menos en parte) en otra factura: no se puede reactivar automáticamente.' };
          }
        }
        factura.estado = factura.anulado_estado_previo;
        factura.motivo_anulacion = null;
        factura.anulado_estado_previo = null;
        const cliente = clientes.find((c) => c.id === factura.cliente_id);
        if (cliente) cliente.saldo = redondear2(cliente.saldo + (factura.total - (nota ? nota.devuelto : 0)));
        if (factura.anulado_devolucion_pago_id) {
          pagos = pagos.filter((p) => p.id !== factura.anulado_devolucion_pago_id);
          factura.anulado_devolucion_pago_id = null;
        }
        if (nota) notasCredito = notasCredito.filter((n) => n.id !== nota.id);
        return { ok: true };
      },
    },
    cheques: {
      listar: async ({ estado } = {}) =>
        cheques
          .filter((c) => !estado || c.estado === estado)
          .sort((a, b) => {
            if (a.estado !== b.estado) return a.estado === 'en_cartera' ? -1 : 1;
            if (a.estado === 'en_cartera') return (a.fecha_cobro || '9999-12-31').localeCompare(b.fecha_cobro || '9999-12-31') || b.id - a.id;
            return (b.fecha_entrega || '').localeCompare(a.fecha_entrega || '') || b.id - a.id;
          }),
      crear: async (c) => {
        const banco = String((c && c.banco) || '').trim();
        const numero = String((c && c.numero) || '').trim();
        const importe = Number(c && c.importe);
        if (!banco || !numero) return { ok: false, error: 'Poné el banco y el número del cheque.' };
        if (!Number.isFinite(importe) || importe <= 0) return { ok: false, error: 'Poné un importe mayor a cero.' };
        const repetido = errorChequeRepetidoMock(banco, numero);
        if (repetido) return { ok: false, error: repetido };
        cheques.push({
          id: nextChequeId++, banco, numero, importe: redondear2(importe), fecha_cobro: c.fecha_cobro || null,
          librador: String(c.librador || '').trim() || null, cliente_id: null, fecha_ingreso: hoyISO(),
          estado: 'en_cartera', entregado_a: null, fecha_entrega: null,
        });
        // "Le di efectivo a cambio": sale el mismo importe del efectivo (operación de canje con monto negativo).
        if (c.efectivo_a_cambio) {
          operaciones.push({ id: nextOperacionId++, fecha: hoyISO(), tipo: 'canje', cuenta: 'Efectivo', monto: -redondear2(importe), cheque_id: nextChequeId - 1, nota: String(c.librador || '').trim() || null });
        }
        return { ok: true };
      },
      entregar: async ({ id, entregado_a, fecha_entrega }) => {
        const destino = String(entregado_a || '').trim();
        if (!destino) return { ok: false, error: 'Poné a quién se lo entregaste.' };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha_entrega || ''))) return { ok: false, error: 'La fecha de entrega no es válida.' };
        const c = cheques.find((x) => x.id === id && x.estado === 'en_cartera');
        if (!c) return { ok: false, error: 'Ese cheque ya no está en cartera.' };
        Object.assign(c, { estado: 'entregado', entregado_a: destino, fecha_entrega });
        return { ok: true };
      },
      volverACartera: async (id) => {
        const c = cheques.find((x) => x.id === id);
        const pagoId = c && c.pago_proveedor_id;
        if (c) Object.assign(c, { estado: 'en_cartera', entregado_a: null, fecha_entrega: null, pago_proveedor_id: null });
        gastos = gastos.filter((g) => g.cheque_id !== id);
        if (pagoId) pagosProveedor = pagosProveedor.filter((p) => p.id !== pagoId || p.efectivo > 0 || p.transferencia > 0 || cheques.some((x) => x.pago_proveedor_id === pagoId));
        return { ok: true };
      },
      eliminar: async (id) => {
        const usado = cheques.find((c) => c.id === id);
        if (usado && usado.pago_proveedor_id) return { ok: false, error: 'Ese cheque se usó para pagarle a un proveedor. Primero quitá el pago desde la ficha del proveedor.' };
        gastos.forEach((g) => { if (g.cheque_id === id) g.cheque_id = null; });
        operaciones = operaciones.filter((o) => !(o.tipo === 'canje' && o.monto < 0 && o.cheque_id === id));
        cheques = cheques.filter((c) => c.id !== id);
        return { ok: true };
      },
    },
    avisos: {
      tipos: async () => tiposAviso.map((t) => ({ ...t, activo: !avisosApagados.includes(t.id) })),
      activar: async ({ tipo, activo }) => {
        if (!tiposAviso.some((t) => t.id === tipo)) return { ok: false };
        avisosApagados = avisosApagados.filter((t) => t !== tipo);
        if (!activo) avisosApagados.push(tipo);
        return { ok: true };
      },
      obtener: async () => {
        const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
        const pesos = (n) => `$${redondear2(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
        const hoy = periodoDia(new Date());
        const diasDesde = (iso) => Math.floor((new Date(`${hoy}T00:00:00`) - new Date(`${String(iso).slice(0, 10)}T00:00:00`)) / 86400000);
        const sumar = (iso, dias) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + dias); return periodoDia(d); };
        const activo = (t) => !avisosApagados.includes(t);
        const avisos = [];
        if (activo('cheques')) {
          const enCartera = cheques.filter((c) => c.estado === 'en_cartera' && c.fecha_cobro);
          const ya = enCartera.filter((c) => c.fecha_cobro <= hoy);
          const pronto = enCartera.filter((c) => c.fecha_cobro > hoy && c.fecha_cobro <= sumar(hoy, 7));
          if (ya.length + pronto.length) {
            const partes = [];
            if (ya.length) partes.push(plural(ya.length, 'ya se puede cobrar', 'ya se pueden cobrar'));
            if (pronto.length) partes.push(`${plural(pronto.length, 'vence', 'vencen')} en los próximos 7 días`);
            const total = [...ya, ...pronto].reduce((a, c) => a + c.importe, 0);
            avisos.push({ tipo: 'cheques', urgencia: ya.length ? 'alta' : 'media', titulo: 'Cheques para cobrar', detalle: `${partes.join(' y ')} · ${pesos(total)} en total` });
          }
        }
        if (activo('clientes_deuda')) {
          const porCliente = {};
          facturas.filter((f) => (f.estado === 'pendiente' || f.estado === 'parcial') && diasDesde(f.fecha) > 30).forEach((f) => {
            const pendiente = redondear2(f.total - pagos.filter((p) => p.factura_id === f.id).reduce((a, p) => a + p.monto, 0));
            if (pendiente > 0.005) {
              const e = (porCliente[f.cliente_id] = porCliente[f.cliente_id] || { pendiente: 0, desde: f.fecha });
              e.pendiente += pendiente;
              if (f.fecha < e.desde) e.desde = f.fecha;
            }
          });
          const filas = Object.entries(porCliente).map(([id, e]) => ({ nombre: nombreCompleto(clientes.find((c) => c.id === Number(id))), ...e })).sort((a, b) => b.pendiente - a.pendiente);
          if (filas.length) {
            avisos.push({ tipo: 'clientes_deuda', urgencia: Math.max(...filas.map((f) => diasDesde(f.desde))) > 90 ? 'alta' : 'media', titulo: `${plural(filas.length, 'cliente debe', 'clientes deben')} hace más de 30 días`, detalle: filas.slice(0, 3).map((f) => `${f.nombre} (${pesos(f.pendiente)}, hace ${diasDesde(f.desde)} días)`).join(' · ') });
          }
        }
        if (activo('proveedores_deuda')) {
          const filas = proveedores
            .filter((p) => p.activo !== 0)
            .map(conSaldoProveedor)
            .filter((p) => p.saldo > 0)
            .map((p) => {
              const pagosP = pagosProveedor.filter((x) => x.proveedor_id === p.id).map((x) => x.fecha).sort();
              const comprasP = compras.filter((c) => c.proveedor_id === p.id).map((c) => c.fecha).sort();
              const ref = pagosP.length ? pagosP[pagosP.length - 1] : comprasP[0];
              return { nombre: p.nombre, saldo: p.saldo, dias: ref ? diasDesde(ref) : null, nunca: !pagosP.length };
            })
            .filter((p) => p.dias !== null && p.dias > 21)
            .sort((a, b) => b.saldo - a.saldo);
          if (filas.length) avisos.push({ tipo: 'proveedores_deuda', urgencia: 'media', titulo: `${plural(filas.length, 'proveedor', 'proveedores')} sin pagar hace más de 21 días`, detalle: filas.slice(0, 3).map((p) => `${p.nombre} (${pesos(p.saldo)}, ${p.nunca ? 'sin pagos desde la primera compra: ' : ''}hace ${p.dias} días)`).join(' · ') });
        }
        if (activo('pedidos')) {
          const viejos = pedidos.filter((p) => p.estado === 'pendiente' && (p.para_fecha || String(p.fecha).slice(0, 10)) < hoy).length;
          if (viejos) avisos.push({ tipo: 'pedidos', urgencia: 'media', titulo: `${plural(viejos, 'pedido', 'pedidos')} de días anteriores sin facturar`, detalle: 'Quedaron pendientes: revisá si ya se entregaron.' });
        }
        if (activo('pedidos_programados')) {
          const m = new Date(`${hoy}T12:00:00`);
          m.setDate(m.getDate() + 1);
          const manana = periodoDia(m);
          const paraManana = pedidos.filter((p) => p.estado === 'pendiente' && p.para_fecha === manana).length;
          if (paraManana) avisos.push({ tipo: 'pedidos_programados', urgencia: 'baja', titulo: `${plural(paraManana, 'pedido programado', 'pedidos programados')} para mañana`, detalle: 'Mañana aparecen solos en Pedidos pendientes.' });
        }
        if (activo('cierre_caja')) {
          const sinHacer = [];
          const conDif = [];
          for (let i = 1; i <= 7; i += 1) {
            const dia = sumar(hoy, -i);
            const ce = pagos.filter((p) => periodoDia(new Date(p.fecha)) === dia && p.metodo_pago.trim().toLowerCase() === 'efectivo');
            const re = gastos.filter((g) => g.fecha === dia && g.medio_pago === 'Efectivo');
            const rp = pagosProveedor.filter((p) => p.fecha === dia && p.efectivo > 0);
            const cierre = cierresCaja.find((c) => c.fecha === dia);
            if (ce.length + re.length + rp.length > 0 && (!cierre || cierre.efectivo_contado === null)) sinHacer.push(dia);
            else if (cierre && cierre.efectivo_contado !== null) {
              const dif = redondear2(cierre.efectivo_contado - (cierre.fondo_inicial + ce.reduce((a, p) => a + p.monto, 0) - re.reduce((a, g) => a + g.monto, 0) - rp.reduce((a, p) => a + p.efectivo, 0)));
              if (Math.abs(dif) >= 1) conDif.push({ dia, dif });
            }
          }
          if (sinHacer.length || conDif.length) {
            const corta = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
            const partes = [];
            if (sinHacer.length) partes.push(`Sin cerrar: ${sinHacer.map(corta).join(', ')}`);
            if (conDif.length) partes.push(`Con diferencia: ${conDif.map((c) => `${corta(c.dia)} (${c.dif > 0 ? '+' : '−'}${pesos(Math.abs(c.dif))})`).join(', ')}`);
            avisos.push({ tipo: 'cierre_caja', urgencia: 'media', titulo: 'Cierre de caja', detalle: partes.join(' · '), fecha: sinHacer[0] || conDif[0].dia });
          }
        }
        if (activo('clientes_inactivos')) {
          const filas = clientes
            .filter((c) => c.activo !== 0)
            .map((c) => {
              const fs = facturas.filter((f) => f.cliente_id === c.id && f.estado !== 'anulada');
              return { nombre: nombreCompleto(c), n: fs.length, dias: fs.length ? diasDesde(fs.map((f) => f.fecha).sort().pop()) : null };
            })
            .filter((c) => c.n >= 3 && c.dias > 45 && c.dias < 365);
          if (filas.length) avisos.push({ tipo: 'clientes_inactivos', urgencia: 'baja', titulo: `${plural(filas.length, 'cliente habitual dejó', 'clientes habituales dejaron')} de comprar`, detalle: filas.slice(0, 3).map((c) => `${c.nombre} (hace ${c.dias} días)`).join(' · ') });
        }
        if (activo('copia') && facturas.length) {
          avisos.push({ tipo: 'copia', urgencia: 'media', titulo: 'Copia de seguridad', detalle: 'Todavía no guardaste ninguna copia fuera de la computadora.' });
        }
        if (activo('productos_sin_precio')) {
          const filas = productos.filter((p) => p.activo !== 0 && (p.precio_cliente <= 0 || p.precio_cf <= 0));
          if (filas.length) avisos.push({ tipo: 'productos_sin_precio', urgencia: 'media', titulo: `${plural(filas.length, 'producto', 'productos')} sin precio`, detalle: filas.slice(0, 3).map((p) => p.nombre).join(' · ') });
        }
        if (activo('stock_bajo')) {
          const filas = resumenStockMock().articulos.filter((a) => a.minimo > 0 && a.stock > 0 && a.stock < a.minimo);
          if (filas.length) avisos.push({ tipo: 'stock_bajo', urgencia: 'media', firma: filas.map((a) => a.id).join(','), titulo: `Stock bajo: ${plural(filas.length, 'producto', 'productos')}`, detalle: filas.slice(0, 3).map((a) => `${a.nombre}: ${a.stock} kg (mínimo ${a.minimo})`).join(' · ') });
        }
        const insumosConUltimo = insumosMock.filter((i) => i.activo).map((i) => ({ ...i, ultimo: conteosInsumoMock.filter((c) => c.insumo_id === i.id).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id))[0] || null }));
        if (activo('insumos_bajos')) {
          const filas = insumosConUltimo.filter((i) => i.minimo !== null && i.ultimo && i.ultimo.cantidad < i.minimo);
          if (filas.length) avisos.push({ tipo: 'insumos_bajos', urgencia: 'media', firma: filas.map((i) => i.id).join(','), titulo: `Insumos con poco stock: ${filas.length}`, detalle: filas.slice(0, 3).map((i) => `${i.nombre}: ${i.ultimo.cantidad} ${i.unidad} (mínimo ${i.minimo})`).join(' · ') });
        }
        if (activo('insumos_sin_contar')) {
          const filas = insumosConUltimo.filter((i) => i.ultimo && diasDesde(i.ultimo.fecha) > 30);
          if (filas.length) avisos.push({ tipo: 'insumos_sin_contar', urgencia: 'baja', firma: filas.map((i) => i.id).join(','), titulo: `Hace tiempo que no contás: ${filas.length} ${filas.length === 1 ? 'insumo' : 'insumos'}`, detalle: filas.slice(0, 3).map((i) => `${i.nombre}: hace ${diasDesde(i.ultimo.fecha)} días`).join(' · ') });
        }
        avisos.forEach((a) => {
          a.firma = a.firma || `${a.titulo}|${a.detalle}`; // en la app real es la lista de ids que lo componen
          a.leido = avisosLeidosMock[a.tipo] === a.firma;
        });
        const peso = { alta: 0, media: 1, baja: 2 };
        avisos.sort((a, b) => peso[a.urgencia] - peso[b.urgencia]);
        return { ok: true, avisos };
      },
      marcar: async ({ avisos, leido }) => {
        if (!Array.isArray(avisos)) return { ok: false };
        avisos.forEach(({ tipo, firma }) => {
          if (leido) avisosLeidosMock[tipo] = String(firma ?? '');
          else delete avisosLeidosMock[tipo];
        });
        return { ok: true };
      },
    },
    buscar: {
      todo: async (consulta) => {
        const q = String(consulta || '').trim().slice(0, 80);
        if (q.length < 2) return { ok: true, grupos: {} };
        const sinAcentos = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const tokens = sinAcentos(q).split(/\s+/).filter(Boolean);
        const esNumero = /^\d[\d.,]*$/.test(q);
        const importe = esNumero ? Number(q.replace(/\./g, '').replace(',', '.')) : null;
        const coincideImporte = (v) => importe !== null && Number.isFinite(importe) && Math.abs(v - importe) < 0.005;
        const coincideTexto = (t) => tokens.every((tk) => sinAcentos(t).includes(tk));
        const porNumeroFactura = /^(?:n°?|nro\.?|#)\s*(\d+)$/i.exec(q);
        const numeroFactura = porNumeroFactura ? Number(porNumeroFactura[1]) : esNumero && Number.isInteger(importe) ? importe : null;
        const grupo = (filas) => ({ total: filas.length, items: filas.slice(0, 6) });
        const fechaCorta = (f) => { const [a, m, d] = String(f).slice(0, 10).split('-'); return d ? `${d}/${m}/${a}` : ''; };
        const empiezaCon = (n) => (sinAcentos(n).startsWith(tokens[0]) ? 0 : 1);
        const orden = (a, b) => Number(b.activo) - Number(a.activo) || empiezaCon(a.nombre) - empiezaCon(b.nombre) || a.nombre.localeCompare(b.nombre, 'es');
        const grupos = {};
        grupos.clientes = grupo(
          clientes
            .filter((c) => coincideTexto(`${c.nombre} ${c.apellido || ''} ${c.negocio || ''} ${c.telefono || ''}`) || (c.saldo > 0 && coincideImporte(c.saldo)))
            .map((c) => ({ id: c.id, nombre: nombreConNegocio(c), saldo: redondear2(c.saldo), activo: c.activo !== 0 }))
            .sort(orden)
        );
        grupos.proveedores = grupo(
          proveedores
            .map(conSaldoProveedor)
            .filter((p) => coincideTexto(`${p.nombre} ${p.telefono || ''}`) || (p.saldo > 0 && coincideImporte(p.saldo)))
            .map((p) => ({ id: p.id, nombre: p.nombre, saldo: p.saldo, activo: p.activo !== 0 }))
            .sort(orden)
        );
        grupos.productos = grupo(
          productos
            .filter((p) => coincideTexto(`${p.codigo || ''} ${p.nombre}`))
            .map((p) => ({ id: p.id, nombre: p.nombre, codigo: p.codigo || null, precio: p.precio_cliente, unidad: p.unidad, activo: p.activo !== 0 }))
            .sort(orden)
        );
        grupos.insumos = grupo(
          insumosMock
            .filter((i) => i.activo && !esNumero && coincideTexto(i.nombre))
            .map((i) => ({ id: i.id, nombre: i.nombre, unidad: i.unidad, ultimo: conteosInsumoMock.filter((c) => c.insumo_id === i.id).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id))[0] || null }))
        );
        const pagadoDe = (f) => pagos.filter((p) => p.factura_id === f.id).reduce((a, p) => a + p.monto, 0);
        grupos.facturas = grupo(
          [...facturas]
            .sort((a, b) => (a.fecha < b.fecha ? 1 : -1) || b.id - a.id)
            .map((f) => ({ f, c: clientes.find((x) => x.id === f.cliente_id), pendiente: redondear2(f.total - pagadoDe(f)) }))
            .filter(({ f, c, pendiente }) => {
              if (numeroFactura !== null && f.id === numeroFactura) return true;
              if (porNumeroFactura) return false;
              if (esNumero) return f.estado !== 'anulada' && (coincideImporte(f.total) || (pendiente > 0 && coincideImporte(pendiente)));
              return coincideTexto(`${nombreCompleto(c)} ${fechaCorta(f.fecha)}`);
            })
            .map(({ f, c, pendiente }) => ({ id: f.id, cliente: nombreCompleto(c), fecha: String(f.fecha).slice(0, 10), total: redondear2(f.total), pendiente: f.estado === 'anulada' ? 0 : pendiente, estado: f.estado }))
        );
        grupos.cheques = grupo(
          cheques
            .filter((c) => (esNumero ? coincideImporte(c.importe) || String(c.numero).includes(q.replace(/[.,]/g, '')) : coincideTexto(`${c.banco} ${c.numero} ${c.librador || ''} ${c.entregado_a || ''}`)))
            .map((c) => ({ ...c }))
        );
        grupos.gastos = grupo(
          [...gastos]
            .sort((a, b) => (a.fecha < b.fecha ? 1 : -1) || b.id - a.id)
            .map((g) => ({ ...g, categoria: (categoriasGasto.find((c) => c.id === g.categoria_id) || {}).nombre }))
            .filter((g) => (esNumero ? coincideImporte(g.monto) : coincideTexto(`${g.descripcion} ${g.categoria} ${g.medio_pago} ${g.cuenta || ''} ${g.tarjeta || ''}`)))
        );
        grupos.ingresos = grupo(
          [...ingresos]
            .sort((a, b) => (a.fecha < b.fecha ? 1 : -1) || b.id - a.id)
            .filter((i) => (esNumero ? coincideImporte(i.monto) : coincideTexto(`${i.descripcion} ${i.observacion || ''} ${i.cuenta || 'fondos personales'}`)))
        );
        grupos.operaciones = grupo(
          cajaConfig.desde
            ? (() => {
                const vistas = new Set();
                return movimientosOperacionesMock(cajaConfig.desde)
                  .filter((o) => !o.personal)
                  .filter((o) => (vistas.has(o.id) ? false : vistas.add(o.id)))
                  .map((o) => ({ id: o.id, fecha: o.fecha, detalle: o.detalle, monto: Math.abs(o.monto) }))
                  .filter((o) => (esNumero ? coincideImporte(o.monto) : coincideTexto(o.detalle)))
                  .sort((a, b) => (a.fecha < b.fecha ? 1 : -1) || b.id - a.id);
              })()
            : []
        );
        grupos.pedidos = grupo(
          pedidos
            .filter((p) => p.estado === 'pendiente' && !esNumero)
            .map((p) => ({ p, c: clientes.find((x) => x.id === p.cliente_id) }))
            .filter(({ c }) => coincideTexto(nombreCompleto(c)))
            .map(({ p, c }) => ({ id: p.id, cliente: nombreCompleto(c), fecha: String(p.fecha).slice(0, 10) }))
        );
        grupos.cobros = grupo(
          esNumero
            ? pagos
                .filter((p) => coincideImporte(p.monto))
                .map((p) => {
                  const f = facturas.find((x) => x.id === p.factura_id);
                  return { id: p.id, factura_id: p.factura_id, cliente_id: f ? f.cliente_id : p.cliente_id, cliente: nombreCompleto(clientes.find((x) => x.id === (f ? f.cliente_id : p.cliente_id))), monto: redondear2(p.monto), metodo: p.metodo_pago, fecha: String(p.fecha).slice(0, 10) };
                })
            : []
        );
        if (sesionActualMock && sesionActualMock.rol === 'empleado') {
          const permitidosEmpleado = new Set(['clientes', 'facturas', 'pedidos', 'cobros']);
          Object.keys(grupos).forEach((clave) => {
            if (!permitidosEmpleado.has(clave)) delete grupos[clave];
          });
        }
        return { ok: true, grupos };
      },
    },
    estadisticas: {
      resumen: async ({ desde, hasta } = {}) => {
        const dentro = (f) => (!desde || f >= desde) && (!hasta || f <= hasta);
        const suma = (arr) => redondear2(arr.reduce((acc, x) => acc + x, 0));
        // Entradas
        const cobrosPeriodo = pagosQueEntran().filter((p) => dentro(periodoDia(new Date(p.fecha))));
        const porMetodoMapa = {};
        cobrosPeriodo.forEach((p) => {
          const m = (porMetodoMapa[p.metodo_pago] = porMetodoMapa[p.metodo_pago] || { metodo: p.metodo_pago, total: 0, cantidad: 0 });
          m.total = redondear2(m.total + p.monto);
          m.cantidad += 1;
        });
        const porMetodo = Object.values(porMetodoMapa).sort((a, b) => b.total - a.total);
        // Gastos
        const nombreCategoria = (id) => (categoriasGasto.find((c) => c.id === id) || {}).nombre;
        const esPersonalMock = (id) => ((categoriasGasto.find((c) => c.id === id) || {}).ambito) === 'personal';
        const porCatMapa = {};
        gastosParaEstadisticas().filter((g) => dentro(g.fecha)).forEach((g) => {
          const nombre = nombreCategoria(g.categoria_id);
          const c = (porCatMapa[nombre] = porCatMapa[nombre] || { categoria: nombre, ambito: esPersonalMock(g.categoria_id) ? 'personal' : 'negocio', total: 0, cantidad: 0 });
          c.total = redondear2(c.total + g.monto);
          c.cantidad += 1;
        });
        const porCategoria = Object.values(porCatMapa).sort((a, b) => b.total - a.total);
        const totalGastos = suma(porCategoria.map((c) => c.total));
        // Lo que se sacó del negocio para vivir: gastos de Gastos con categoría personal (no los gastos de propiedades).
        const paraVivir = suma(gastosParaEstadisticas().filter((g) => dentro(g.fecha) && esPersonalMock(g.categoria_id) && g.medio_pago !== 'Fondos personales').map((g) => g.monto));
        const gastosPeriodo = gastosParaEstadisticas().filter((g) => dentro(g.fecha) && !esPersonalMock(g.categoria_id));
        const porMetodoGastoMapa = {};
        gastosPeriodo.forEach((g) => {
          const m = (porMetodoGastoMapa[g.medio_pago] = porMetodoGastoMapa[g.medio_pago] || { metodo: g.medio_pago, total: 0, cantidad: 0 });
          m.total = redondear2(m.total + g.monto);
          m.cantidad += 1;
        });
        const gastosPorMetodo = Object.values(porMetodoGastoMapa).sort((a, b) => b.total - a.total);
        const topGastos = [...gastosPeriodo]
          .sort((a, b) => b.monto - a.monto)
          .slice(0, 8)
          .map((g) => ({ id: g.id, fecha: g.fecha, descripcion: g.descripcion, monto: g.monto, categoria: nombreCategoria(g.categoria_id) }));
        // Pagos a proveedores
        const totalPago = (p) => p.efectivo + p.transferencia + cheques.filter((c) => c.pago_proveedor_id === p.id).reduce((a, c) => a + c.importe, 0);
        const pagosPeriodo = pagosProveedor.filter((p) => dentro(p.fecha));
        const proveedoresRes = {
          cantidad: pagosPeriodo.length,
          efectivo: suma(pagosPeriodo.map((p) => p.efectivo)),
          transferencia: suma(pagosPeriodo.map((p) => p.transferencia)),
          cheques: suma(pagosPeriodo.map((p) => cheques.filter((c) => c.pago_proveedor_id === p.id).reduce((a, c) => a + c.importe, 0))),
          total: suma(pagosPeriodo.map(totalPago)),
        };
        // Mes a mes
        const fin = hasta ? new Date(`${hasta}T00:00:00`) : new Date();
        const serie = [];
        for (let i = 11; i >= 0; i -= 1) {
          const d = new Date(fin.getFullYear(), fin.getMonth() - i, 1);
          const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          const gm = gastosParaEstadisticas().filter((g) => g.fecha.slice(0, 7) === mes);
          serie.push({
            mes,
            entradas: suma(pagosQueEntran().filter((p) => periodoDia(new Date(p.fecha)).slice(0, 7) === mes).map((p) => p.monto)),
            gastos: suma(gm.map((g) => g.monto)),
            particulares: suma(gm.filter((g) => esPersonalMock(g.categoria_id)).map((g) => g.monto)),
            proveedores: suma(pagosProveedor.filter((p) => p.fecha.slice(0, 7) === mes).map(totalPago)),
            ingresos: suma(ingresos.filter((i) => i.fecha.slice(0, 7) === mes).map((i) => i.monto)),
            interesesGanados: suma(operaciones.filter((o) => o.tipo === 'interes' && o.monto > 0 && o.fecha.slice(0, 7) === mes).map((o) => o.monto)),
            interesesPagados: suma(operaciones.filter((o) => o.tipo === 'interes' && o.monto < 0 && o.fecha.slice(0, 7) === mes).map((o) => -o.monto)),
            reintegros: suma(operaciones.filter((o) => o.tipo === 'reintegro' && o.fecha.slice(0, 7) === mes).map((o) => o.monto)),
          });
        }
        // Período anterior (mismo largo, hasta hoy si el período termina en el futuro).
        let anterior = null;
        if (desde && hasta) {
          const aFecha = (iso) => new Date(`${iso}T00:00:00`);
          const hoy = periodoDia(new Date());
          const fin = hasta > hoy ? hoy : hasta;
          if (fin >= desde) {
            const dias = Math.round((aFecha(fin) - aFecha(desde)) / 86400000) + 1;
            const d0 = aFecha(desde);
            const esMes = d0.getDate() === 1 && periodoDia(new Date(d0.getFullYear(), d0.getMonth() + 1, 0)) === hasta;
            const esAnio = desde.endsWith('-01-01') && hasta === `${d0.getFullYear()}-12-31`;
            let antDesde;
            let antHasta;
            if (esMes || esAnio) {
              antDesde = esMes ? new Date(d0.getFullYear(), d0.getMonth() - 1, 1) : new Date(d0.getFullYear() - 1, 0, 1);
              antHasta = new Date(antDesde);
              antHasta.setDate(antHasta.getDate() + dias - 1);
              const tope = esMes ? new Date(antDesde.getFullYear(), antDesde.getMonth() + 1, 0) : new Date(antDesde.getFullYear(), 11, 31);
              if (antHasta > tope) antHasta = tope;
            } else {
              antHasta = new Date(d0);
              antHasta.setDate(antHasta.getDate() - 1);
              antDesde = new Date(antHasta);
              antDesde.setDate(antDesde.getDate() - (dias - 1));
            }
            const d1 = periodoDia(antDesde);
            const d2 = periodoDia(antHasta);
            const en = (f) => f >= d1 && f <= d2;
            const gPrev = gastosParaEstadisticas().filter((g) => en(g.fecha));
            anterior = {
              desde: d1,
              hasta: d2,
              comparadoHasta: fin,
              entradas: suma(pagosQueEntran().filter((p) => en(periodoDia(new Date(p.fecha)))).map((p) => p.monto)),
              gastos: suma(gPrev.map((g) => g.monto)),
              particulares: suma(gPrev.filter((g) => esPersonalMock(g.categoria_id)).map((g) => g.monto)),
              paraVivir: suma(gPrev.filter((g) => esPersonalMock(g.categoria_id) && g.medio_pago !== 'Fondos personales').map((g) => g.monto)),
              proveedores: suma(pagosProveedor.filter((p) => en(p.fecha)).map(totalPago)),
              ingresos: suma(ingresos.filter((i) => en(i.fecha)).map((i) => i.monto)),
              interesesGanados: suma(operaciones.filter((o) => o.tipo === 'interes' && o.monto > 0 && en(o.fecha)).map((o) => o.monto)),
              interesesPagados: suma(operaciones.filter((o) => o.tipo === 'interes' && o.monto < 0 && en(o.fecha)).map((o) => -o.monto)),
              reintegros: suma(operaciones.filter((o) => o.tipo === 'reintegro' && en(o.fecha)).map((o) => o.monto)),
            };
          }
        }
        return {
          ok: true,
          entradas: { total: suma(porMetodo.map((m) => m.total)), porMetodo },
          salidas: { gastos: { total: totalGastos, paraVivir, porCategoria, porMetodo: gastosPorMetodo, top: topGastos }, proveedores: proveedoresRes, total: redondear2(totalGastos + proveedoresRes.total) },
          personal: (() => {
            const propios = ingresos.filter((i) => dentro(i.fecha));
            const mapaOrigen = {};
            propios.forEach((i) => {
              // Por categoría (cada propiedad es una), igual que las salidas; sin categoría, por la descripción.
              const nombre = (categoriasGasto.find((c) => c.id === i.categoria_id) || {}).nombre || i.descripcion;
              const o = (mapaOrigen[nombre] = mapaOrigen[nombre] || { origen: nombre, total: 0, cantidad: 0 });
              o.total = redondear2(o.total + i.monto - (i.retencion || 0));
              o.cantidad += 1;
            });
            return { ingresos: { total: suma(propios.map((i) => i.monto - (i.retencion || 0))), porOrigen: Object.values(mapaOrigen).sort((a, b) => b.total - a.total) } };
          })(),
          intereses: {
            ganados: suma(operaciones.filter((o) => o.tipo === 'interes' && o.monto > 0 && dentro(o.fecha)).map((o) => o.monto)),
            pagados: suma(operaciones.filter((o) => o.tipo === 'interes' && o.monto < 0 && dentro(o.fecha)).map((o) => -o.monto)),
            reintegros: suma(operaciones.filter((o) => o.tipo === 'reintegro' && dentro(o.fecha)).map((o) => o.monto)),
          },
          serie,
          anterior,
        };
      },
      pendiente: async () => {
        const conSaldo = clientes.filter((c) => c.saldo > 0).sort((a, b) => b.saldo - a.saldo);
        const provs = proveedores.map(conSaldoProveedor).filter((p) => p.saldo > 0);
        const enCartera = cheques.filter((c) => c.estado === 'en_cartera');
        const limite = new Date();
        limite.setDate(limite.getDate() + 7);
        const limiteIso = periodoDia(limite);
        const pronto = enCartera.filter((c) => c.fecha_cobro && c.fecha_cobro <= limiteIso);
        const suma2 = (arr) => redondear2(arr.reduce((a, x) => a + x, 0));
        return {
          clientes: {
            cantidad: conSaldo.length,
            total: suma2(conSaldo.map((c) => c.saldo)),
            mayores: conSaldo.slice(0, 5).map((c) => ({ id: c.id, nombre: nombreCompleto(c), saldo: redondear2(c.saldo) })),
          },
          proveedores: {
            cantidad: provs.length,
            total: suma2(provs.map((p) => p.saldo)),
            mayores: [...provs].sort((a, b) => b.saldo - a.saldo).slice(0, 5).map((p) => ({ id: p.id, nombre: p.nombre, saldo: redondear2(p.saldo) })),
          },
          cheques: {
            cantidad: enCartera.length,
            total: suma2(enCartera.map((c) => c.importe)),
            porVencer: { cantidad: pronto.length, total: suma2(pronto.map((c) => c.importe)) },
          },
        };
      },
      rankings: async ({ desde, hasta } = {}) => {
        const dentro = (f) => (!desde || f >= desde) && (!hasta || f <= hasta);
        const validas = facturas.filter((f) => f.estado !== 'anulada' && dentro(periodoDia(new Date(f.fecha))));
        const ids = new Set(validas.map((f) => f.id));
        const porProducto = {};
        facturaItems.filter((i) => ids.has(i.factura_id)).forEach((i) => {
          const p = (porProducto[i.producto_id] = porProducto[i.producto_id] || { id: i.producto_id, nombre: i.producto_nombre, unidad: i.producto_unidad, cantidad: 0, importe: 0 });
          p.cantidad = Math.round((p.cantidad + i.cantidad) * 1000) / 1000;
          p.importe = redondear2(p.importe + i.subtotal);
        });
        const porCliente = {};
        validas.forEach((f) => {
          const c = clientes.find((x) => x.id === f.cliente_id);
          const e = (porCliente[f.cliente_id] = porCliente[f.cliente_id] || { id: f.cliente_id, nombre: nombreCompleto(c), facturas: 0, importe: 0 });
          e.facturas += 1;
          e.importe = redondear2(e.importe + f.total);
        });
        // Lo cobrado en el período por vendedor, aparte de lo "de Freska" (sin vendedor): sobre lo COBRADO, no
        // lo facturado, como el informe de Vendedores.
        const facturasPorIdRk = new Map(facturas.map((f) => [f.id, f]));
        const cobrosValidos = pagos.filter((p) => {
          const f = facturasPorIdRk.get(p.factura_id);
          return f && f.estado !== 'anulada' && String(p.metodo_pago || '').trim().toLowerCase() !== 'saldo a favor' && dentro(periodoDia(new Date(p.fecha)));
        });
        const conocidosRk = new Set(vendedoresMock.map((v) => v.id));
        const comisionistas = {
          vendedores: [...vendedoresMock]
            .map((v) => ({
              id: v.id,
              numero: v.numero,
              nombre: v.nombre,
              total: redondear2(cobrosValidos.filter((p) => facturasPorIdRk.get(p.factura_id).vendedor_id === v.id).reduce((acc, p) => acc + p.monto, 0)),
            }))
            .filter((v) => v.total > 0)
            .sort((a, b) => b.total - a.total),
          directo: redondear2(
            cobrosValidos
              .filter((p) => {
                const vid = facturasPorIdRk.get(p.factura_id).vendedor_id;
                return !vid || !conocidosRk.has(vid);
              })
              .reduce((acc, p) => acc + p.monto, 0)
          ),
        };
        return {
          ok: true,
          productos: Object.values(porProducto).sort((a, b) => b.importe - a.importe).slice(0, 10),
          clientes: Object.values(porCliente).sort((a, b) => b.importe - a.importe).slice(0, 10),
          ventas: { facturas: validas.length, importe: redondear2(validas.reduce((a, f) => a + f.total, 0)) },
          porDiaSemana: (() => {
            const nombres = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
            return [1, 2, 3, 4, 5, 6, 0].map((d) => {
              const delDia = validas.filter((f) => new Date(f.fecha).getDay() === d);
              return { dia: nombres[d], facturas: delDia.length, importe: redondear2(delDia.reduce((a, f) => a + f.total, 0)) };
            });
          })(),
          comisionistas,
        };
      },
      preciosCompras: async ({ desde, hasta } = {}) => {
        const grupos = new Map();
        [...compras]
          .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id))
          .forEach((c) => {
            const prov = (proveedores.find((p) => p.id === c.proveedor_id) || {}).nombre;
            c.items.filter((i) => i.unidad !== 'unidad' && i.kilos > 0).forEach((i) => {
              const k = `${c.proveedor_id}|${String(i.producto).trim().toLowerCase()}|${String(i.descripcion || '').trim().toLowerCase()}`;
              if (!grupos.has(k)) grupos.set(k, []);
              const nombre = i.descripcion ? `${i.producto} — ${i.descripcion}` : i.producto;
              grupos.get(k).push({ producto: nombre, proveedor: prov, fecha: c.fecha, kilos: i.kilos, importe: i.importe });
            });
          });
        const filas = [];
        grupos.forEach((lista) => {
          const enPeriodo = lista.filter((f) => (!desde || f.fecha >= desde) && (!hasta || f.fecha <= hasta));
          if (!enPeriodo.length) return;
          const ultima = enPeriodo[enPeriodo.length - 1];
          const indice = lista.indexOf(ultima);
          const previa = indice > 0 ? lista[indice - 1] : null;
          const kilos = enPeriodo.reduce((a, f) => a + f.kilos, 0);
          const importe = enPeriodo.reduce((a, f) => a + f.importe, 0);
          filas.push({
            producto: ultima.producto, proveedor: ultima.proveedor, kilos: redondear2(kilos), promedio: redondear2(importe / kilos),
            ultimo: redondear2(ultima.importe / ultima.kilos), fechaUltimo: ultima.fecha,
            previo: previa ? redondear2(previa.importe / previa.kilos) : null, fechaPrevio: previa ? previa.fecha : null,
          });
        });
        return { ok: true, filas: filas.sort((a, b) => b.kilos - a.kilos).slice(0, 20) };
      },
    },
    insumos: {
      listar: async () =>
        insumosMock
          .filter((i) => i.activo)
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
          .map((i) => {
            const cs = conteosInsumoMock.filter((c) => c.insumo_id === i.id).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id));
            return { id: i.id, nombre: i.nombre, unidad: i.unidad, minimo: i.minimo, ultimo: cs[0] ? { fecha: cs[0].fecha, cantidad: cs[0].cantidad } : null, anterior: cs[1] ? { fecha: cs[1].fecha, cantidad: cs[1].cantidad } : null, diferencia: cs[0] && cs[1] ? redondear2(cs[0].cantidad - cs[1].cantidad) : null };
          }),
      crear: async (d) => {
        const r = datosInsumoMock(d || {});
        if (r.error) return { ok: false, error: r.error };
        const ex = insumosMock.find((i) => i.nombre.toLowerCase() === r.nombre.toLowerCase());
        if (ex && ex.activo) return { ok: false, error: 'Ya hay un insumo con ese nombre.' };
        let id;
        if (ex) {
          Object.assign(ex, { activo: 1, unidad: r.unidad, minimo: r.minimo });
          id = ex.id;
        } else {
          id = nextInsumoId++;
          insumosMock.push({ id, nombre: r.nombre, unidad: r.unidad, minimo: r.minimo, activo: 1 });
        }
        return { ok: true, id };
      },
      actualizar: async (d) => {
        const r = datosInsumoMock(d || {});
        if (r.error) return { ok: false, error: r.error };
        const i = insumosMock.find((x) => x.id === Number(d.id) && x.activo);
        if (!i) return { ok: false, error: 'Ese insumo ya no existe.' };
        if (insumosMock.some((x) => x.activo && x.id !== i.id && x.nombre.toLowerCase() === r.nombre.toLowerCase())) return { ok: false, error: 'Ya hay un insumo con ese nombre.' };
        Object.assign(i, { nombre: r.nombre, unidad: r.unidad, minimo: r.minimo });
        return { ok: true };
      },
      quitar: async (id) => {
        const i = insumosMock.find((x) => x.id === Number(id));
        if (i) i.activo = 0;
        return { ok: true };
      },
      contar: async ({ fecha, conteos } = {}) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) return { ok: false, error: 'La fecha no es válida.' };
        const validos = [];
        for (const c of Array.isArray(conteos) ? conteos : []) {
          if (c.cantidad === '' || c.cantidad === null || c.cantidad === undefined) continue;
          const cantidad = Number(c.cantidad);
          if (!Number.isFinite(cantidad) || cantidad < 0) return { ok: false, error: 'Hay una cantidad que no es válida.' };
          if (!insumosMock.some((i) => i.id === Number(c.insumo_id) && i.activo)) continue;
          validos.push({ insumo_id: Number(c.insumo_id), cantidad });
        }
        if (!validos.length) return { ok: false, error: 'Cargá la cantidad de al menos un insumo.' };
        validos.forEach((c) => conteosInsumoMock.push({ id: nextConteoInsumoId++, insumo_id: c.insumo_id, fecha, cantidad: c.cantidad }));
        return { ok: true, cantidad: validos.length };
      },
      conteos: async (id) => conteosInsumoMock.filter((c) => c.insumo_id === Number(id)).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id)),
      quitarConteo: async (id) => {
        conteosInsumoMock = conteosInsumoMock.filter((c) => c.id !== Number(id));
        return { ok: true };
      },
    },
    stock: {
      resumen: async () => resumenStockMock(),
      actualizarMinimo: async ({ articulo_id, minimo }) => {
        const a = articulosStock.find((x) => x.id === Number(articulo_id) && x.activo);
        if (!a) return { ok: false, error: 'Ese artículo ya no existe.' };
        const texto = String(minimo ?? '').trim();
        let valor = null;
        if (texto !== '') {
          valor = Number(texto.replace(',', '.'));
          if (!Number.isFinite(valor) || valor <= 0) return { ok: false, error: 'El mínimo tiene que ser mayor a cero.' };
        }
        a.minimo = valor;
        return { ok: true };
      },
      actualizarCarne: async ({ articulo_id, porcentaje }) => {
        const a = articulosStock.find((x) => x.id === Number(articulo_id) && x.activo);
        if (!a) return { ok: false, error: 'Ese artículo ya no existe.' };
        const texto = String(porcentaje ?? '').trim();
        let valor = null;
        if (texto !== '') {
          valor = Number(texto);
          if (!Number.isFinite(valor) || valor <= 0 || valor > 100) return { ok: false, error: 'El porcentaje de carne tiene que estar entre 1 y 100.' };
          if (valor === 100) valor = null;
        }
        a.porcentaje_carne = valor;
        return { ok: true };
      },
      rendimiento: async ({ desde, hasta } = {}) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(desde || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(hasta || ''))) return { ok: false, error: 'El período no es válido.' };
        sembrarStockMock();
        const SIN_TIPO = 'Sin tipo';
        const filas = new Map();
        const fila = (tipo) => {
          const clave = String(tipo || '').trim() || SIN_TIPO;
          if (!filas.has(clave)) filas.set(clave, { tipo: clave, comprado: 0, producido: 0, vendido: 0 });
          return filas.get(clave);
        };
        const dentro = (f) => String(f).slice(0, 10) >= desde && String(f).slice(0, 10) <= hasta;
        compras.filter((c) => dentro(c.fecha)).forEach((c) => c.items.filter((i) => i.unidad !== 'unidad').forEach((i) => (fila(i.producto).comprado += Number(i.kilos) || 0)));
        movimientosStock.filter((m) => m.tipo === 'produccion' && dentro(m.fecha)).forEach((m) => {
          const a = articulosStock.find((x) => x.id === m.articulo_id);
          const mezcla = a ? carnesMock(a) : [];
          (mezcla.length ? mezcla : [{ tipo: null, porcentaje: 100 }]).forEach((c) => (fila(c.tipo).producido += m.kilos * ((a && a.porcentaje_carne) || 100) / 100 * c.porcentaje / 100));
        });
        facturaItems.forEach((i) => {
          const f = facturas.find((x) => x.id === i.factura_id);
          const p = productos.find((x) => x.id === i.producto_id);
          if (!f || f.estado === 'anulada' || !dentro(f.fecha) || !p || !p.articulo_stock_id) return;
          const a = articulosStock.find((x) => x.id === p.articulo_stock_id);
          const mezcla = a ? carnesMock(a) : [];
          (mezcla.length ? mezcla : [{ tipo: null, porcentaje: 100 }]).forEach((c) => (fila(c.tipo).vendido += i.cantidad * (kgDeProductoMock(p) || 0) * ((a && a.porcentaje_carne) || 100) / 100 * c.porcentaje / 100));
        });
        const lista = [...filas.values()]
          .map((f) => ({ ...f, comprado: redondear2(f.comprado), producido: redondear2(f.producido), vendido: redondear2(f.vendido) }))
          .sort((a, b) => (a.tipo === SIN_TIPO) - (b.tipo === SIN_TIPO) || b.comprado - a.comprado || a.tipo.localeCompare(b.tipo));
        const total = lista.reduce((acc, f) => ({ comprado: acc.comprado + f.comprado, producido: acc.producido + f.producido, vendido: acc.vendido + f.vendido }), { comprado: 0, producido: 0, vendido: 0 });
        return { ok: true, tipos: lista, total: { comprado: redondear2(total.comprado), producido: redondear2(total.producido), vendido: redondear2(total.vendido) } };
      },
      crearArticulo: async (nombre) => {
        sembrarStockMock();
        const texto = String(nombre || '').trim();
        if (!texto) return { ok: false, error: 'Poné un nombre para el artículo.' };
        let a = articulosStock.find((x) => x.nombre.toLowerCase() === texto.toLowerCase());
        if (a) Object.assign(a, { activo: 1, nombre: texto });
        else {
          a = { id: nextArticuloStockId++, nombre: texto, activo: 1 };
          articulosStock.push(a);
        }
        return { ok: true, id: a.id };
      },
      quitarArticulo: async (id) => {
        const a = articulosStock.find((x) => x.id === Number(id));
        if (a) a.activo = 0;
        productos.filter((p) => p.articulo_stock_id === Number(id)).forEach((p) => Object.assign(p, { articulo_stock_id: null, kg_por_unidad: null }));
        return { ok: true };
      },
      actualizarTipo: async ({ articulo_id, tipo }) => {
        const a = articulosStock.find((x) => x.id === Number(articulo_id) && x.activo);
        if (!a) return { ok: false, error: 'Ese artículo ya no existe.' };
        a.tipo = String(tipo || '').trim() || null;
        a.carnes = a.tipo ? [{ tipo: a.tipo, porcentaje: 100 }] : [];
        return { ok: true };
      },
      // Varias carnes por producto, cada una con su porcentaje (suman 100). Misma validación que el servicio real.
      actualizarCarnes: async ({ articulo_id, carnes }) => {
        const a = articulosStock.find((x) => x.id === Number(articulo_id) && x.activo);
        if (!a) return { ok: false, error: 'Ese artículo ya no existe.' };
        const limpias = [];
        for (const c of Array.isArray(carnes) ? carnes : []) {
          const tipo = String((c && c.tipo) || '').trim().slice(0, 40);
          if (!tipo) continue;
          if (limpias.some((x) => x.tipo.toLowerCase() === tipo.toLowerCase())) return { ok: false, error: `${tipo} está repetida.` };
          limpias.push({ tipo, porcentaje: c.porcentaje === undefined || c.porcentaje === '' || c.porcentaje === null ? NaN : Number(c.porcentaje) });
        }
        if (limpias.length === 1 && Number.isNaN(limpias[0].porcentaje)) limpias[0].porcentaje = 100;
        if (limpias.some((c) => !Number.isFinite(c.porcentaje) || c.porcentaje <= 0 || c.porcentaje > 100)) return { ok: false, error: 'Poné el porcentaje de cada carne (entre 1 y 100).' };
        limpias.forEach((c) => (c.porcentaje = redondear2(c.porcentaje)));
        if (limpias.length && Math.abs(limpias.reduce((acc, c) => acc + c.porcentaje, 0) - 100) > 0.01) return { ok: false, error: 'Los porcentajes de las carnes tienen que sumar 100 %.' };
        a.carnes = limpias.sort((x, y) => y.porcentaje - x.porcentaje);
        a.tipo = a.carnes.length ? a.carnes[0].tipo : null;
        return { ok: true };
      },
      tiposCarne: async () => tiposCarne.map((t) => ({ ...t })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      agregarTipoCarne: async (nombre) => {
        const texto = limpiarProductoMock(nombre);
        if (!texto) return { ok: false, error: 'Escribí el nombre del tipo.' };
        if (!tiposCarne.some((t) => t.nombre.toLowerCase() === texto.toLowerCase())) tiposCarne.push({ id: nextTipoCarneId++, nombre: texto });
        return { ok: true };
      },
      quitarTipoCarne: async (id) => {
        tiposCarne = tiposCarne.filter((t) => t.id !== Number(id));
        return { ok: true };
      },
      vincular: async ({ producto_id, de_producto_id, kg_por_unidad }) => {
        sembrarStockMock();
        const p = productos.find((x) => x.id === Number(producto_id));
        if (!p) return { ok: false, error: 'Ese producto ya no existe.' };
        const kg = p.unidad === 'kg' ? 1 : Number(kg_por_unidad);
        const pesoValido = Number.isFinite(kg) && kg > 0;
        if (!de_producto_id) {
          if (!pesoValido) {
            Object.assign(p, { articulo_stock_id: null, kg_por_unidad: null, stock_de_producto_id: null });
            return { ok: true };
          }
          Object.assign(p, { articulo_stock_id: pilaMock(p.nombre), kg_por_unidad: kg, stock_de_producto_id: null });
          return { ok: true };
        }
        if (Number(de_producto_id) === p.id) return { ok: false, error: 'Un producto no puede compartir el stock consigo mismo.' };
        const base = productos.find((x) => x.id === Number(de_producto_id) && x.activo);
        if (!base) return { ok: false, error: 'Ese producto ya no existe.' };
        if (!pesoValido) return { ok: false, error: 'Poné cuánto pesa cada unidad.' };
        if (!base.articulo_stock_id) base.articulo_stock_id = pilaMock(base.nombre);
        Object.assign(p, { articulo_stock_id: base.articulo_stock_id, kg_por_unidad: kg, stock_de_producto_id: base.id });
        return { ok: true };
      },
      producir: async ({ fecha, articulo_id, kilos, cajas, kg_por_caja, nota }) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return { ok: false, error: 'La fecha no es válida.' };
        const art = articulosStock.find((x) => x.id === Number(articulo_id) && x.activo);
        if (!art) return { ok: false, error: 'Elegí qué se produjo.' };
        let k = Number(kilos);
        let notaFinal = String(nota || '').trim() || null;
        if (cajas !== undefined && cajas !== null && cajas !== '') {
          const c = Number(cajas);
          if (!Number.isFinite(c) || c <= 0) return { ok: false, error: 'Poné cuántas cajas salieron.' };
          const peso = Number(kg_por_caja) || art.kg_por_caja || (resumenStockMock().articulos.find((x) => x.id === art.id) || {}).kg_por_caja;
          if (!Number.isFinite(peso) || peso <= 0) return { ok: false, error: 'Poné cuánto pesa cada caja.' };
          if (Number(kg_por_caja) > 0) art.kg_por_caja = Number(kg_por_caja);
          k = c * peso;
          if (!notaFinal) notaFinal = `${c} ${c === 1 ? 'caja' : 'cajas'}`;
        } else if (!Number.isFinite(k) || k <= 0) return { ok: false, error: 'Poné los kilos producidos.' };
        movimientosStock.push({ id: nextMovimientoStockId++, articulo_id: art.id, fecha, tipo: 'produccion', kilos: Math.round(k * 1000) / 1000, nota: notaFinal });
        return { ok: true };
      },
      ajustar: async ({ articulo_id, kilos_reales, nota }) => {
        const real = Number(kilos_reales);
        if (!Number.isFinite(real) || real < 0) return { ok: false, error: 'Poné cuántos kilos hay realmente.' };
        const fila = resumenStockMock().articulos.find((a) => a.id === Number(articulo_id));
        if (!fila) return { ok: false, error: 'Ese artículo ya no existe.' };
        const hoy = hoyISO();
        const deHoy = movimientosStock.find((m) => m.articulo_id === fila.id && m.tipo === 'ajuste' && m.fecha === hoy);
        const stockSinAjusteDeHoy = fila.stock - (deHoy ? deHoy.kilos : 0);
        const dif = Math.round((real - stockSinAjusteDeHoy) * 1000) / 1000;
        const notaFinal = String(nota || '').trim() || 'Conteo';
        if (dif === 0) {
          if (deHoy) movimientosStock = movimientosStock.filter((m) => m !== deHoy);
          return { ok: true };
        }
        if (deHoy) Object.assign(deHoy, { kilos: dif, nota: notaFinal });
        else movimientosStock.push({ id: nextMovimientoStockId++, articulo_id: fila.id, fecha: hoy, tipo: 'ajuste', kilos: dif, nota: notaFinal });
        return { ok: true };
      },
      sinTipo: async ({ desde, hasta } = {}) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(desde || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(hasta || ''))) return { ok: false, error: 'El período no es válido.' };
        sembrarStockMock();
        const dentro = (f) => String(f).slice(0, 10) >= desde && String(f).slice(0, 10) <= hasta;
        const filas = new Map();
        const fila = (a) => {
          if (!filas.has(a.id)) filas.set(a.id, { id: a.id, nombre: a.nombre, producido: 0, vendido: 0 });
          return filas.get(a.id);
        };
        const sinCarne = (a) => !carnesMock(a).length;
        movimientosStock.filter((m) => m.tipo === 'produccion' && dentro(m.fecha)).forEach((m) => {
          const a = articulosStock.find((x) => x.id === m.articulo_id);
          if (a && sinCarne(a)) fila(a).producido += m.kilos * (a.porcentaje_carne || 100) / 100;
        });
        facturaItems.forEach((i) => {
          const f = facturas.find((x) => x.id === i.factura_id);
          const p = productos.find((x) => x.id === i.producto_id);
          if (!f || f.estado === 'anulada' || !dentro(f.fecha) || !p || !p.articulo_stock_id) return;
          const a = articulosStock.find((x) => x.id === p.articulo_stock_id);
          if (a && sinCarne(a)) fila(a).vendido += i.cantidad * (kgDeProductoMock(p) || 0) * (a.porcentaje_carne || 100) / 100;
        });
        const lista = [...filas.values()].map((f) => ({ ...f, producido: redondear2(f.producido), vendido: redondear2(f.vendido) })).filter((f) => f.producido > 0 || f.vendido > 0).sort((a, b) => b.producido + b.vendido - (a.producido + a.vendido) || a.nombre.localeCompare(b.nombre));
        const compradoSinProducto = redondear2(compras.filter((c) => dentro(c.fecha)).reduce((acc, c) => acc + c.items.filter((i) => i.unidad !== 'unidad' && !String(i.producto || '').trim()).reduce((s, i) => s + (Number(i.kilos) || 0), 0), 0));
        return { ok: true, articulos: lista, compradoSinProducto };
      },
      producidoPorArticulo: async ({ desde, hasta } = {}) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(desde || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(hasta || ''))) return { ok: false, error: 'El período no es válido.' };
        const porArticulo = new Map();
        movimientosStock.filter((m) => m.tipo === 'produccion' && String(m.fecha).slice(0, 10) >= desde && String(m.fecha).slice(0, 10) <= hasta).forEach((m) => {
          const f = porArticulo.get(m.articulo_id) || { kilos: 0, tandas: 0, ultima: '' };
          f.kilos += m.kilos;
          f.tandas += 1;
          if (String(m.fecha).slice(0, 10) > f.ultima) f.ultima = String(m.fecha).slice(0, 10);
          porArticulo.set(m.articulo_id, f);
        });
        const filas = [...porArticulo]
          .map(([id, f]) => ({ id, nombre: (articulosStock.find((a) => a.id === id) || {}).nombre || '', kilos: redondear2(f.kilos), tandas: f.tandas, ultima: f.ultima, promedio: redondear2(f.kilos / f.tandas) }))
          .sort((a, b) => b.kilos - a.kilos || a.nombre.localeCompare(b.nombre));
        return { ok: true, filas, total: redondear2(filas.reduce((acc, f) => acc + f.kilos, 0)), tandas: filas.reduce((acc, f) => acc + f.tandas, 0) };
      },
      movimientos: async ({ limite, desde, hasta } = {}) =>
        [...movimientosStock]
          .filter((m) => (!desde || String(m.fecha).slice(0, 10) >= desde) && (!hasta || String(m.fecha).slice(0, 10) <= hasta))
          .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id))
          .slice(0, Math.min(Number(limite) || 60, 500))
          .map((m) => ({ ...m, articulo: (articulosStock.find((a) => a.id === m.articulo_id) || {}).nombre })),
      quitarMovimiento: async (id) => {
        movimientosStock = movimientosStock.filter((m) => m.id !== Number(id));
        return { ok: true };
      },
    },
    inflacion: {
      listar: async () => Object.entries(inflacionMock).map(([mes, porcentaje]) => ({ mes, porcentaje })).sort((a, b) => (a.mes < b.mes ? -1 : 1)),
      guardar: async ({ mes, porcentaje }) => {
        if (!/^\d{4}-\d{2}$/.test(String(mes || ''))) return { ok: false, error: 'El mes no es válido.' };
        if (porcentaje === null || porcentaje === '' || porcentaje === undefined) {
          delete inflacionMock[mes];
          return { ok: true };
        }
        const n = Number(porcentaje);
        if (!Number.isFinite(n) || n < -50 || n > 500) return { ok: false, error: 'El porcentaje no es válido.' };
        inflacionMock[mes] = n;
        return { ok: true };
      },
    },
    proveedores: {
      listar: async () => proveedores.map(conSaldoProveedor).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })),
      crear: async (p) => {
        const d = datosProveedorMock(p || {});
        if (d.error) return { ok: false, error: d.error };
        if (proveedores.some((x) => x.nombre.toLowerCase() === d.nombre.toLowerCase())) {
          return { ok: false, error: 'Ya hay un proveedor con ese nombre (si lo diste de baja, buscalo en "Dados de baja").' };
        }
        const nuevo = { id: nextProveedorId++, nombre: d.nombre, telefono: d.telefono, nota: d.nota, saldo_inicial: d.saldoInicial, activo: 1 };
        proveedores.push(nuevo);
        return { ok: true, id: nuevo.id };
      },
      actualizar: async (p) => {
        const d = datosProveedorMock(p || {});
        if (d.error) return { ok: false, error: d.error };
        const actual = proveedores.find((x) => x.id === Number(p.id));
        if (!actual) return { ok: false, error: 'Ese proveedor ya no existe.' };
        if (proveedores.some((x) => x.id !== actual.id && x.nombre.toLowerCase() === d.nombre.toLowerCase())) {
          return { ok: false, error: 'Ya hay otro proveedor con ese nombre.' };
        }
        Object.assign(actual, { nombre: d.nombre, telefono: d.telefono, nota: d.nota, saldo_inicial: d.saldoInicial });
        return { ok: true };
      },
      darDeBaja: async (id) => {
        const p = proveedores.find((x) => x.id === id);
        if (p) p.activo = 0;
        return { ok: true };
      },
      eliminar: async (id) => {
        const pagosIds = pagosProveedor.filter((p) => p.proveedor_id === id).map((p) => p.id);
        cheques.filter((c) => pagosIds.includes(c.pago_proveedor_id)).forEach((c) => Object.assign(c, { estado: 'en_cartera', entregado_a: null, fecha_entrega: null, pago_proveedor_id: null }));
        pagosProveedor = pagosProveedor.filter((p) => p.proveedor_id !== id);
        devolucionesProveedor = devolucionesProveedor.filter((d) => d.proveedor_id !== id);
        compras = compras.filter((c) => c.proveedor_id !== id);
        productosProveedor = productosProveedor.filter((x) => x.proveedor_id !== id);
        proveedores = proveedores.filter((p) => p.id !== id);
        return { ok: true };
      },
      darDeAlta: async (id) => {
        const p = proveedores.find((x) => x.id === id);
        if (p) p.activo = 1;
        return { ok: true };
      },
      historial: async (id) => ({
        compras: compras.filter((c) => c.proveedor_id === id).map((c) => ({ ...c, items: c.items.map((i) => ({ ...i })) })).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id),
        pagos: pagosProveedor
          .filter((p) => p.proveedor_id === id)
          .map((p) => {
            const chs = cheques.filter((c) => c.pago_proveedor_id === p.id).map(({ id: cid, banco, numero, importe, fecha_cobro }) => ({ id: cid, banco, numero, importe, fecha_cobro }));
            return { ...p, cheques: chs, total: redondear2(p.efectivo + p.transferencia + chs.reduce((a, c) => a + c.importe, 0)) };
          })
          .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id),
        devoluciones: devolucionesProveedor.filter((d) => d.proveedor_id === id).map((d) => ({ ...d })).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id),
      }),
      devolver: async (d) => {
        d = d || {};
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '')) return { ok: false, error: 'La fecha no es válida.' };
        const proveedor = proveedores.find((x) => x.id === Number(d.proveedor_id));
        if (!proveedor) return { ok: false, error: 'Elegí un proveedor.' };
        const monto = redondear2(Number(d.monto));
        if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Poné el monto de lo devuelto.' };
        const kilos = d.kilos === undefined || d.kilos === null || d.kilos === '' ? null : Number(d.kilos);
        if (kilos !== null && (!Number.isFinite(kilos) || kilos <= 0)) return { ok: false, error: 'Los kilos no son válidos.' };
        const compraId = d.compra_id ? Number(d.compra_id) : null;
        if (compraId && !compras.some((c) => c.id === compraId && c.proveedor_id === proveedor.id)) return { ok: false, error: 'Esa compra no es de este proveedor.' };
        if (compraId && kilos !== null && d.producto) {
          const unidad = d.unidad === 'unidad' ? 'unidad' : 'kg';
          const comprado = compras.find((c) => c.id === compraId).items.filter((i) => i.producto === d.producto && (i.descripcion || '') === (d.descripcion || '') && (i.unidad || 'kg') === unidad).reduce((a, i) => a + (i.kilos || 0), 0);
          const yaDevuelto = devolucionesProveedor.filter((x) => x.compra_id === compraId && x.producto === d.producto && x.descripcion === (d.descripcion || '') && x.unidad === unidad).reduce((a, x) => a + (x.kilos || 0), 0);
          if (comprado > 0 && redondear2(yaDevuelto + kilos) > redondear2(comprado) + 0.005) return { ok: false, error: `De esa compra solo podés devolver hasta ${Math.max(0, redondear2(comprado - yaDevuelto))} ${unidad === 'unidad' ? 'unidades' : 'kg'}.` };
        }
        let reembolso = null;
        if (d.reembolso_cuenta) {
          reembolso = listaCuentasMock().find((n) => claveCuentaMock(n) === claveCuentaMock(d.reembolso_cuenta)) || null;
          if (!reembolso) return { ok: false, error: 'Elegí dónde entró la plata.' };
        }
        devolucionesProveedor.push({
          id: nextDevolucionProveedorId++, proveedor_id: proveedor.id, fecha: d.fecha, compra_id: compraId,
          producto: String(d.producto || '').trim(), descripcion: String(d.descripcion || '').trim(), unidad: d.unidad === 'unidad' ? 'unidad' : 'kg',
          kilos, monto, reembolso_cuenta: reembolso, nota: String(d.nota || '').trim() || null, creado: new Date().toISOString(),
        });
        return { ok: true };
      },
      quitarDevolucion: async (id) => {
        devolucionesProveedor = devolucionesProveedor.filter((d) => d.id !== Number(id));
        return { ok: true };
      },
      productosComprados: async () => {
        const ultimo = {};
        compras.forEach((c) => c.items.forEach((i) => {
          const k = `${i.producto.toLowerCase()}|${(i.descripcion || '').toLowerCase()}`;
          ultimo[k] = { producto: i.producto, descripcion: i.descripcion, unidad: i.unidad, precio_kg: i.precio_kg };
        }));
        return Object.values(ultimo).sort((a, b) => a.producto.localeCompare(b.producto, 'es', { sensitivity: 'base' }));
      },
      tipos: async () => tiposProducto.map((t) => ({ ...t })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      agregarTipo: async (nombre) => {
        const texto = limpiarProductoMock(nombre);
        if (!texto) return { ok: false, error: 'Escribí el nombre del producto.' };
        if (!tiposProducto.some((t) => t.nombre.toLowerCase() === texto.toLowerCase())) tiposProducto.push({ id: nextTipoProductoId++, nombre: texto });
        return { ok: true };
      },
      quitarTipo: async (id) => {
        tiposProducto = tiposProducto.filter((t) => t.id !== Number(id));
        return { ok: true };
      },
      productos: async (proveedorId) =>
        productosProveedor
          .filter((x) => x.proveedor_id === Number(proveedorId))
          .map(({ id, producto, descripcion, unidad }) => {
            const compradas = compras
              .filter((c) => c.proveedor_id === Number(proveedorId))
              .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
            let ultimo = null;
            for (const c of compradas) {
              const item = c.items.find(
                (i) => String(i.producto).toLowerCase() === producto.toLowerCase() && (i.descripcion || '').toLowerCase() === (descripcion || '').toLowerCase() && i.precio_kg
              );
              if (item) {
                ultimo = item.precio_kg;
                break;
              }
            }
            return { id, producto, descripcion, unidad: unidad || 'kg', ultimo_precio: ultimo };
          })
          .sort((a, b) => a.producto.localeCompare(b.producto, 'es', { sensitivity: 'base' }) || (a.descripcion || '').localeCompare(b.descripcion || '', 'es', { sensitivity: 'base' })),
      agregarProducto: async ({ proveedor_id, producto, descripcion, unidad }) => {
        const nombre = limpiarProductoMock(producto);
        if (!nombre) return { ok: false, error: 'Elegí el producto.' };
        if (!proveedores.some((x) => x.id === Number(proveedor_id))) return { ok: false, error: 'Ese proveedor ya no existe.' };
        guardarProductoProveedorMock(Number(proveedor_id), nombre, limpiarDescripcionMock(descripcion), unidad);
        return { ok: true };
      },
      quitarProducto: async (id) => {
        productosProveedor = productosProveedor.filter((x) => x.id !== Number(id));
        return { ok: true };
      },
      crearCompra: async (c) => guardarCompraMock(c || {}, null),
      actualizarCompra: async (c) => {
        const existente = compras.find((x) => x.id === Number(c && c.id));
        if (!existente) return { ok: false, error: 'Esa compra ya no existe.' };
        return guardarCompraMock({ ...c, proveedor_id: existente.proveedor_id }, existente);
      },
      quitarCompra: async (id) => {
        compras = compras.filter((c) => c.id !== id);
        return { ok: true };
      },
      pagar: async (p) => guardarPagoMock(p, null),
      actualizarPago: async (p) => {
        const existe = pagosProveedor.find((x) => x.id === Number(p && p.id));
        if (!existe) return { ok: false, error: 'Ese pago ya no existe.' };
        return guardarPagoMock({ ...p, proveedor_id: existe.proveedor_id }, existe);
      },
      quitarPago: async (id) => {
        cheques.filter((c) => c.pago_proveedor_id === id).forEach((c) => Object.assign(c, { estado: 'en_cartera', entregado_a: null, fecha_entrega: null, pago_proveedor_id: null }));
        pagosProveedor = pagosProveedor.filter((p) => p.id !== id);
        return { ok: true };
      },
      totalPagos: async ({ desde, hasta } = {}) => {
        const enPeriodo = pagosProveedor.filter((p) => (!desde || p.fecha >= desde) && (!hasta || p.fecha <= hasta));
        const total = enPeriodo.reduce(
          (acc, p) => acc + p.efectivo + p.transferencia + cheques.filter((c) => c.pago_proveedor_id === p.id).reduce((s, c) => s + c.importe, 0),
          0
        );
        return { total: redondear2(total), cantidad: enPeriodo.length };
      },
    },
    operaciones: {
      listar: async () => {
        if (!cajaConfig.desde) return [];
        const vistas = new Set();
        const movs = movimientosOperacionesMock(cajaConfig.desde).filter((o) => !o.personal);
        const cuentasDe = new Map();
        movs.forEach((o) => {
          const l = cuentasDe.get(o.id) || [];
          if (!l.includes(o.cuenta)) l.push(o.cuenta);
          cuentasDe.set(o.id, l);
        });
        return movs
          .filter((o) => (vistas.has(o.id) ? false : vistas.add(o.id)))
          .map((o) => ({ id: o.id, fecha: o.fecha, tipo: o.tipo, detalle: o.detalle, cuenta: cuentasDe.get(o.id).join(' → '), monto: Math.abs(operaciones.find((x) => x.id === o.id).monto), entra: o.monto >= 0 }))
          .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id));
      },
      pase: async ({ fecha, origen, destino, monto, nota }) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return { ok: false, error: 'La fecha no es válida.' };
        const de = listaCuentasMock().find((c) => claveCuentaMock(c) === claveCuentaMock(origen));
        const a = listaCuentasMock().find((c) => claveCuentaMock(c) === claveCuentaMock(destino));
        if (!de || !a) return { ok: false, error: 'Elegí las dos cuentas.' };
        if (de === a) return { ok: false, error: 'Elegí dos cuentas distintas.' };
        const importe = Number(monto);
        if (!Number.isFinite(importe) || importe <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
        operaciones.push({ id: nextOperacionId++, fecha, tipo: 'pase', cuenta: de, cuenta_destino: a, monto: redondear2(importe), nota: nota || null });
        return { ok: true };
      },
      comprarDolares: async ({ fecha, cuenta, usd, cotizacion }) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return { ok: false, error: 'La fecha no es válida.' };
        const de = listaCuentasMock().find((c) => claveCuentaMock(c) === claveCuentaMock(cuenta));
        if (!de) return { ok: false, error: 'Elegí con qué cuenta se pagó.' };
        const d = Number(usd);
        const cot = Number(cotizacion);
        if (!Number.isFinite(d) || d <= 0) return { ok: false, error: 'Poné cuántos dólares compró.' };
        if (!Number.isFinite(cot) || cot <= 0) return { ok: false, error: 'Poné a cuánto compró cada dólar.' };
        operaciones.push({ id: nextOperacionId++, fecha, tipo: 'dolares', cuenta: de, monto: redondear2(d * cot), usd: d, cotizacion: cot });
        cajaConfig.usd = redondear2(cajaConfig.usd + d);
        return { ok: true };
      },
      canjearCheque: async ({ fecha, cheque_id, cuenta }) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return { ok: false, error: 'La fecha no es válida.' };
        const a = listaCuentasMock().find((c) => claveCuentaMock(c) === claveCuentaMock(cuenta));
        if (!a) return { ok: false, error: 'Elegí de dónde sale la plata.' };
        const ch = cheques.find((c) => c.id === Number(cheque_id) && c.estado === 'en_cartera');
        if (!ch) return { ok: false, error: 'Elegí un cheque de la cartera.' };
        operaciones.push({ id: nextOperacionId++, fecha, tipo: 'canje', cuenta: a, monto: ch.importe, cheque_id: ch.id });
        Object.assign(ch, { estado: 'entregado', entregado_a: 'Canje por efectivo', fecha_entrega: fecha });
        return { ok: true };
      },
      interes: async ({ fecha, cuenta, monto, tipo, nota }) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return { ok: false, error: 'La fecha no es válida.' };
        const c = listaCuentasMock().find((x) => claveCuentaMock(x) === claveCuentaMock(cuenta));
        if (!c) return { ok: false, error: 'Elegí la cuenta.' };
        const importe = Number(monto);
        if (!Number.isFinite(importe) || importe <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
        operaciones.push({ id: nextOperacionId++, fecha, tipo: 'interes', cuenta: c, monto: tipo === 'pagado' ? -redondear2(importe) : redondear2(importe), nota: nota || null });
        return { ok: true };
      },
      reintegro: async ({ fecha, cuenta, monto, nota }) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return { ok: false, error: 'La fecha no es válida.' };
        const c = listaCuentasMock().find((x) => claveCuentaMock(x) === claveCuentaMock(cuenta));
        if (!c) return { ok: false, error: 'Elegí la cuenta.' };
        const importe = Number(monto);
        if (!Number.isFinite(importe) || importe <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
        operaciones.push({ id: nextOperacionId++, fecha, tipo: 'reintegro', cuenta: c, monto: redondear2(importe), nota: nota || null });
        return { ok: true };
      },
      eliminar: async (id) => {
        const op = operaciones.find((o) => o.id === Number(id));
        if (!op) return { ok: true };
        if (op.tipo === 'canje' && op.monto < 0) {
          const ch = cheques.find((c) => c.id === op.cheque_id);
          if (ch && ch.estado !== 'en_cartera') return { ok: false, error: 'Ese cheque ya se entregó: no se puede deshacer el cambio.' };
          cheques = cheques.filter((c) => c.id !== op.cheque_id);
          operaciones = operaciones.filter((o) => o.id !== op.id);
          return { ok: true };
        }
        if (op.tipo === 'dolares') cajaConfig.usd = Math.max(0, redondear2(cajaConfig.usd - (op.usd || 0)));
        if (op.tipo === 'canje') {
          const ch = cheques.find((c) => c.id === op.cheque_id);
          if (ch && ch.estado === 'entregado' && !ch.pago_proveedor_id) Object.assign(ch, { estado: 'en_cartera', entregado_a: null, fecha_entrega: null });
        }
        operaciones = operaciones.filter((o) => o.id !== op.id);
        return { ok: true };
      },
    },
    ingresos: {
      listar: async () =>
        [...ingresos]
          .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id))
          .map((i) => ({ ...i, categoria: (categoriasGasto.find((c) => c.id === i.categoria_id) || {}).nombre || null })),
      // Los movimientos detrás de una fila del Resultado (igual que en main.js).
      resultadoDetalle: async ({ categoria_id, desde, hasta } = {}) => {
        const dentro = (f) => (!desde || f >= desde) && (!hasta || f <= hasta);
        const cat = categoria_id === undefined || categoria_id === '' ? null : categoria_id;
        const mismaCat = (x) => (x.categoria_id ?? null) === (cat === null ? null : Number(cat));
        const entran = ingresos.filter((i) => dentro(i.fecha) && mismaCat(i)).map((i) => ({ tipo: 'ingreso', id: i.id, fecha: i.fecha, descripcion: i.descripcion, observacion: i.observacion || null, cuenta: i.cuenta || null, monto: redondear2(i.monto - (i.retencion || 0)), retencion: i.retencion || 0 }));
        const salen = retirosPersonales.filter((r) => dentro(r.fecha) && mismaCat(r)).map((r) => ({ tipo: 'retiro', id: r.id, fecha: r.fecha, descripcion: r.descripcion, observacion: r.observacion || null, cuenta: r.cuenta, monto: -r.monto, retencion: 0 }));
        return [...entran, ...salen].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id));
      },
      // Cuánto dejó cada categoría (cada propiedad es una) en un período: entró (neto de retención) − gastó, igual que en main.js.
      resultado: async ({ desde, hasta } = {}) => {
        const retirosPropiedadesMock = () => retirosPersonales.filter((r) => (categoriasGasto.find((c) => c.id === r.categoria_id) || {}).de_fondos !== 2);
        const dentro = (f) => (!desde || f >= desde) && (!hasta || f <= hasta);
        const ids = [...new Set([...ingresos.filter((i) => dentro(i.fecha)).map((i) => i.categoria_id ?? null), ...retirosPropiedadesMock().filter((r) => dentro(r.fecha)).map((r) => r.categoria_id ?? null)])];
        const filas = ids
          .map((id) => {
            const entro = redondear2(ingresos.filter((i) => dentro(i.fecha) && (i.categoria_id ?? null) === id).reduce((a, i) => a + i.monto - (i.retencion || 0), 0));
            const gasto = redondear2(retirosPropiedadesMock().filter((r) => dentro(r.fecha) && (r.categoria_id ?? null) === id).reduce((a, r) => a + r.monto, 0));
            return { id, nombre: (categoriasGasto.find((c) => c.id === id) || {}).nombre || 'Sin categoría', entro, gasto, deja: redondear2(entro - gasto) };
          })
          .sort((a, b) => a.nombre.localeCompare(b.nombre));
        return {
          filas,
          total: { entro: redondear2(filas.reduce((a, f) => a + f.entro, 0)), gasto: redondear2(filas.reduce((a, f) => a + f.gasto, 0)), deja: redondear2(filas.reduce((a, f) => a + f.deja, 0)) },
          personales: (() => {
            const filasP = [...new Set(retirosPersonales.filter((r) => dentro(r.fecha) && (categoriasGasto.find((c) => c.id === r.categoria_id) || {}).de_fondos === 2).map((r) => r.categoria_id))]
              .map((id) => ({ id, nombre: (categoriasGasto.find((c) => c.id === id) || {}).nombre || 'Sin categoría', gasto: redondear2(retirosPersonales.filter((r) => dentro(r.fecha) && r.categoria_id === id).reduce((a, r) => a + r.monto, 0)) }))
              .sort((a, b) => a.nombre.localeCompare(b.nombre));
            return { filas: filasP, total: redondear2(filasP.reduce((a, f) => a + f.gasto, 0)) };
          })(),
        };
      },
      categorias: async () => categoriasGasto.filter((c) => c.activo && c.ambito === 'personal' && c.de_fondos === 1).map(({ id, nombre }) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
      crearCategoria: async (nombre) => {
        const texto = String(nombre || '').trim();
        if (!texto) return { ok: false, error: 'Poné un nombre para la categoría.' };
        const existente = categoriasGasto.find((c) => c.ambito === 'personal' && c.de_fondos === 1 && c.nombre.toLowerCase() === texto.toLowerCase());
        if (existente) Object.assign(existente, { nombre: texto, activo: 1 });
        else categoriasGasto.push({ id: nextCategoriaGastoId++, nombre: texto, activo: 1, ambito: 'personal', de_fondos: 1 });
        return { ok: true };
      },
      quitarCategoria: async (id) => {
        const c = categoriasGasto.find((x) => x.id === Number(id) && x.ambito === 'personal' && x.de_fondos === 1);
        if (c) c.activo = 0;
        return { ok: true };
      },
      // Lista aparte de categorías para los gastos personales de Fondos personales (`de_fondos: 2`); arranca vacía.
      categoriasGastosPersonales: async () => categoriasGasto.filter((c) => c.activo && c.ambito === 'personal' && c.de_fondos === 2).map(({ id, nombre }) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
      crearCategoriaGastoPersonal: async (nombre) => {
        const texto = String(nombre || '').trim();
        if (!texto) return { ok: false, error: 'Poné un nombre para la categoría.' };
        const existente = categoriasGasto.find((c) => c.ambito === 'personal' && c.de_fondos === 2 && c.nombre.toLowerCase() === texto.toLowerCase());
        if (existente) Object.assign(existente, { nombre: texto, activo: 1 });
        else categoriasGasto.push({ id: nextCategoriaGastoId++, nombre: texto, activo: 1, ambito: 'personal', de_fondos: 2 });
        return { ok: true };
      },
      quitarCategoriaGastoPersonal: async (id) => {
        const c = categoriasGasto.find((x) => x.id === Number(id) && x.ambito === 'personal' && x.de_fondos === 2);
        if (c) c.activo = 0;
        return { ok: true };
      },
      descripciones: async () =>
        [...descripcionesIngreso]
          .sort((a, b) => b.orden - a.orden || a.nombre.localeCompare(b.nombre))
          .map((d) => {
            const ultimo = ingresos.filter((i) => String(i.descripcion).toLowerCase() === d.nombre.toLowerCase()).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id))[0];
            return { ...d, ultimo_monto: ultimo ? ultimo.monto : null, ultima_cuenta: ultimo ? ultimo.cuenta || null : null };
          }),
      crearDescripcion: async ({ nombre, categoria_id }) => {
        const texto = String(nombre || '').trim();
        if (!texto) return { ok: false, error: 'Escribí la descripción.' };
        const categoria = categoriaPersonalMock(categoria_id) || categoriaGastoPersonalMock(categoria_id);
        if (!categoria) return { ok: false, error: 'Elegí una categoría.' };
        const existente = descripcionesIngreso.find((d) => d.nombre.toLowerCase() === texto.toLowerCase() && d.categoria_id === categoria.id);
        if (existente) existente.nombre = texto;
        else descripcionesIngreso.push({ id: nextDescripcionIngresoId++, nombre: texto, categoria_id: categoria.id, orden: 0 });
        return { ok: true };
      },
      quitarDescripcion: async (id) => {
        descripcionesIngreso = descripcionesIngreso.filter((d) => d.id !== id);
        return { ok: true };
      },
      crear: async (i) => {
        if (!i || !/^\d{4}-\d{2}-\d{2}$/.test(i.fecha)) return { ok: false, error: 'La fecha no es válida.' };
        const descripcion = String(i.descripcion || '').trim();
        if (!descripcion) return { ok: false, error: 'Escribí una descripción.' };
        const monto = Number(i.monto);
        if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
        const categoria = categoriaPersonalMock(i.categoria_id);
        if (!categoria) return { ok: false, error: 'Elegí una categoría.' };
        const cuenta = cuentaPersonalMock(i.cuenta);
        if (!cuenta) return { ok: false, error: 'Elegí en qué cuenta entró.' };
        const tasaIngreso = Number(retencionTransferencia || 0);
        const retencionIngreso = i.con_retencion && cuenta !== EFECTIVO_PERSONAL_MOCK && tasaIngreso > 0 ? redondear2(redondear2(monto) * (tasaIngreso / 100)) : 0;
        const idIngreso = (ingresos.reduce((a, x) => Math.max(a, x.id), 0) || 0) + 1;
        ingresos.push({ id: idIngreso, fecha: i.fecha, categoria_id: categoria.id, descripcion, monto, cuenta, observacion: String(i.observacion || '').trim() || null, fondo_personal: 1, retencion: retencionIngreso });
        const existente = descripcionesIngreso.find((d) => d.nombre.toLowerCase() === descripcion.toLowerCase() && d.categoria_id === categoria.id);
        const ordenSiguiente = Math.max(0, ...descripcionesIngreso.map((d) => d.orden)) + 1;
        if (existente) Object.assign(existente, { nombre: descripcion, orden: ordenSiguiente });
        else descripcionesIngreso.push({ id: nextDescripcionIngresoId++, nombre: descripcion, categoria_id: categoria.id, orden: ordenSiguiente });
        return { ok: true };
      },
      rendimiento: async (datos) => ingresoDirectoMock(datos || {}, categoriaAutomaticaMock('Intereses'), 'Interés'),
      reintegro: async (datos) => {
        const d = datos || {};
        const retiro = d.retiro_id ? retirosPersonales.find((r) => r.id === Number(d.retiro_id)) : null;
        if (d.retiro_id && !retiro) return { ok: false, error: 'Esa compra ya no existe.' };
        if (!retiro) return ingresoDirectoMock(d, categoriaAutomaticaMock('Reintegros'), 'Reintegro');
        const ya = ingresos.filter((i) => i.retiro_id === retiro.id).reduce((a, i) => a + i.monto, 0);
        if (redondear2(ya + Number(d.monto || 0)) > redondear2(retiro.monto) + 0.005) return { ok: false, error: 'Con este reintegro se devolvería más de lo que costó la compra.' };
        return ingresoDirectoMock(d, retiro.categoria_id, `Reintegro: ${retiro.descripcion}`.slice(0, 200), retiro.id);
      },
      eliminar: async (id) => {
        ingresos = ingresos.filter((x) => x.id !== id);
        gastos = gastos.filter((g) => g.ingreso_id !== id);
        return { ok: true };
      },
      saldos: async () => {
        const cuentas = saldosPersonalesMock();
        const dolares = dolaresPersonalesMock();
        const saldoPases = saldoDePasesMock();
        return { cuentas, dolares, saldoPases, total: redondear2(cuentas.reduce((a, c) => a + c.saldo, 0) + dolares.valor), retencion: Number(retencionTransferencia) || 0 };
      },
      guardarDolares: async ({ dolares_usd, cotizacion } = {}) => {
        const usd = Number(dolares_usd);
        const cot = Number(cotizacion);
        if (!Number.isFinite(usd) || usd < 0 || !Number.isFinite(cot) || cot < 0) return { ok: false, error: 'Los dólares o la cotización no son válidos.' };
        dolaresPersonalesUsd = usd;
        cajaConfig.cotizacion = cot;
        return { ok: true };
      },
      comprarDolares: async ({ fecha, cuenta, usd, cotizacion } = {}) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, error: 'La fecha no es válida.' };
        const nombre = cuentaPersonalMock(cuenta);
        if (!nombre) return { ok: false, error: 'Elegí con qué cuenta pagó.' };
        const d = Number(usd);
        const cot = Number(cotizacion);
        if (!Number.isFinite(d) || d <= 0) return { ok: false, error: 'Poné cuántos dólares compró.' };
        if (!Number.isFinite(cot) || cot <= 0) return { ok: false, error: 'Poné a cuánto compró cada dólar.' };
        comprasDolaresPersonales.push({ id: nextCompraDolarPersonalId++, fecha, cuenta: nombre, usd: d, cotizacion: cot, monto: redondear2(d * cot) });
        dolaresPersonalesUsd = redondear2(dolaresPersonalesUsd + d);
        return { ok: true };
      },
      comprasDolares: async () => [...comprasDolaresPersonales].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id)),
      eliminarCompraDolares: async (id) => {
        const c = comprasDolaresPersonales.find((x) => x.id === Number(id));
        if (c) {
          comprasDolaresPersonales = comprasDolaresPersonales.filter((x) => x.id !== c.id);
          dolaresPersonalesUsd = Math.max(0, redondear2(dolaresPersonalesUsd - c.usd));
        }
        return { ok: true };
      },
      // El historial de una cuenta personal, del más nuevo al más viejo, con el saldo personal que fue quedando (igual que en main.js).
      movimientos: async (nombre) => {
        const cuenta = cuentaPersonalMock(nombre);
        if (!cuenta) return [];
        const es = (c) => claveCuentaMock(c) === claveCuentaMock(cuenta);
        const movs = [];
        ingresos.filter((i) => i.fondo_personal && i.cuenta && es(i.cuenta)).forEach((i) => {
          movs.push({ fecha: i.fecha, id: i.id, orden: 0, detalle: `Ingreso: ${i.descripcion}`, monto: i.monto });
          if (i.retencion > 0) movs.push({ fecha: i.fecha, id: i.id, orden: 1, detalle: 'Retención por transferencia', monto: -i.retencion });
        });
        retirosPersonales.filter((r) => es(r.cuenta)).forEach((r) => movs.push({ fecha: r.fecha, id: r.id, orden: 2, detalle: `Gasto: ${r.descripcion}`, monto: -r.monto }));
        pasesPersonales.filter((p) => es(p.cuenta_personal)).forEach((p) =>
          movs.push({ fecha: p.fecha, id: p.id, orden: 3, detalle: `${p.sentido === 'a_personal' ? `Pase desde ${p.cuenta_negocio} (negocio)` : `Pase a ${p.cuenta_negocio} (negocio)`}${p.nota ? ` · ${p.nota}` : ''}`, monto: p.sentido === 'a_personal' ? p.monto : -p.monto })
        );
        comprasDolaresPersonales.filter((c) => es(c.cuenta)).forEach((c) => movs.push({ fecha: c.fecha, id: c.id, orden: 3, detalle: `Compra de U$S ${c.usd} a $${c.cotizacion}`, monto: -c.monto }));
        fondosAjustes.filter((a) => es(a.cuenta)).forEach((a) => movs.push({ fecha: a.fecha, id: a.id, orden: 4, detalle: a.nota || 'Ajuste de saldo', monto: a.monto }));
        movs.sort((x, y) => (x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : x.orden - y.orden || x.id - y.id));
        let saldo = 0;
        return movs.map((m) => ({ fecha: m.fecha, detalle: m.detalle, monto: m.monto, saldo: (saldo = redondear2(saldo + m.monto)) })).reverse();
      },
      ajustarSaldo: async ({ cuenta, saldo } = {}) => {
        const nombre = cuentaPersonalMock(cuenta);
        if (!nombre) return { ok: false, error: 'Elegí una cuenta válida.' };
        const nuevo = Number(saldo);
        if (!Number.isFinite(nuevo)) return { ok: false, error: 'El monto no es válido.' };
        const diferencia = redondear2(nuevo - saldosPersonalesMock().find((c) => c.nombre === nombre).saldo);
        if (diferencia !== 0) fondosAjustes.push({ id: fondosAjustes.length + 1, cuenta: nombre, fecha: fechaHoyISO(), monto: diferencia, nota: 'Ajuste de saldo' });
        return { ok: true };
      },
      retiros: async () =>
        [...retirosPersonales]
          .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id))
          .map((r) => ({ ...r, categoria: (categoriasGasto.find((c) => c.id === r.categoria_id) || {}).nombre || null, clase: (categoriasGasto.find((c) => c.id === r.categoria_id) || {}).de_fondos === 2 ? 'personal' : 'propiedad', reintegrado: redondear2(ingresos.filter((i) => i.retiro_id === r.id).reduce((a, i) => a + i.monto, 0)) })),
      crearRetiro: async (r) => {
        if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.fecha)) return { ok: false, error: 'La fecha no es válida.' };
        const categoria = categoriaPersonalMock(r.categoria_id) || categoriaGastoPersonalMock(r.categoria_id);
        if (!categoria) return { ok: false, error: 'Elegí una categoría.' };
        const descripcion = String(r.descripcion || '').trim();
        if (!descripcion) return { ok: false, error: 'Escribí una descripción.' };
        const monto = Number(r.monto);
        if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
        const cuenta = cuentaPersonalMock(r.cuenta);
        if (!cuenta) return { ok: false, error: 'Elegí de qué cuenta salió.' };
        const id = (retirosPersonales.reduce((a, x) => Math.max(a, x.id), 0) || 0) + 1;
        retirosPersonales.push({ id, fecha: r.fecha, categoria_id: categoria.id, descripcion, monto: redondear2(monto), cuenta, observacion: String(r.observacion || '').trim() || null });
        const existente = descripcionesIngreso.find((d) => d.nombre.toLowerCase() === descripcion.toLowerCase() && d.categoria_id === categoria.id);
        const ordenSiguiente = Math.max(0, ...descripcionesIngreso.map((d) => d.orden)) + 1;
        if (existente) Object.assign(existente, { nombre: descripcion, orden: ordenSiguiente });
        else descripcionesIngreso.push({ id: nextDescripcionIngresoId++, nombre: descripcion, categoria_id: categoria.id, orden: ordenSiguiente });
        return { ok: true };
      },
      eliminarRetiro: async (id) => {
        retirosPersonales = retirosPersonales.filter((x) => x.id !== Number(id));
        ingresos = ingresos.filter((i) => i.retiro_id !== Number(id));
        return { ok: true };
      },
      pases: async () => [...pasesPersonales].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id)),
      crearPase: async (p) => {
        if (!p || !/^\d{4}-\d{2}-\d{2}$/.test(p.fecha)) return { ok: false, error: 'La fecha no es válida.' };
        if (p.sentido !== 'a_personal' && p.sentido !== 'al_negocio') return { ok: false, error: 'Elegí el sentido del pase.' };
        const monto = Number(p.monto);
        if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
        const cuentaNegocio = listaCuentasMock().find((c) => claveCuentaMock(c) === claveCuentaMock(p.cuenta_negocio));
        if (!cuentaNegocio) return { ok: false, error: 'Elegí la cuenta del negocio.' };
        const cuentaPers = cuentaPersonalMock(p.cuenta_personal);
        if (!cuentaPers) return { ok: false, error: 'Elegí la cuenta personal.' };
        const id = (pasesPersonales.reduce((a, x) => Math.max(a, x.id), 0) || 0) + 1;
        pasesPersonales.push({ id, fecha: p.fecha, monto: redondear2(monto), sentido: p.sentido, cuenta_negocio: cuentaNegocio, cuenta_personal: cuentaPers, nota: String(p.nota || '').trim() || null });
        return { ok: true };
      },
      eliminarPase: async (id) => {
        pasesPersonales = pasesPersonales.filter((x) => x.id !== Number(id));
        return { ok: true };
      },
    },
    gastos: {
      categorias: async () => categoriasGasto.filter((c) => c.activo && !c.de_fondos).map(({ id, nombre, ambito }) => ({ id, nombre, ambito })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      crearCategoria: async (datos) => {
        const nombre = datos && typeof datos === 'object' ? datos.nombre : datos;
        const ambito = datos && typeof datos === 'object' && datos.ambito === 'personal' ? 'personal' : 'negocio';
        const texto = String(nombre || '').trim();
        if (!texto) return { ok: false, error: 'Poné un nombre para la categoría.' };
        const existente = categoriasGasto.find((c) => c.nombre.toLowerCase() === texto.toLowerCase() && (c.ambito || 'negocio') === ambito && !c.de_fondos);
        if (existente) Object.assign(existente, { nombre: texto, activo: 1 });
        else categoriasGasto.push({ id: nextCategoriaGastoId++, nombre: texto, activo: 1, ambito, de_fondos: 0 });
        return { ok: true };
      },
      cambiarAmbitoCategoria: async ({ id, ambito }) => {
        if (ambito !== 'negocio' && ambito !== 'personal') return { ok: false, error: 'Elegí Negocio o Personal.' };
        const c = categoriasGasto.find((x) => x.id === Number(id) && !x.de_fondos);
        if (c) c.ambito = ambito;
        return { ok: true };
      },
      quitarCategoria: async (id) => {
        const c = categoriasGasto.find((x) => x.id === id);
        if (c) c.activo = 0;
        return { ok: true };
      },
      descripciones: async () =>
        [...descripcionesGasto]
          .sort((a, b) => b.orden - a.orden || a.nombre.localeCompare(b.nombre))
          .map((d) => {
            const ultimo = gastos.filter((g) => String(g.descripcion).toLowerCase() === d.nombre.toLowerCase() && g.categoria_id === d.categoria_id).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id))[0];
            const cat = categoriasGasto.find((c) => c.id === d.categoria_id);
            return { ...d, categoria_nombre: cat ? cat.nombre : null, ultimo_monto: ultimo ? ultimo.monto : null, ultimo_medio: ultimo ? ultimo.medio_pago : null, ultima_cuenta: ultimo ? ultimo.cuenta || null : null };
          }),
      crearDescripcion: async ({ nombre, categoria_id }) => {
        const texto = String(nombre || '').trim();
        if (!texto) return { ok: false, error: 'Escribí la descripción.' };
        const categoria = categoriasGasto.find((c) => c.id === Number(categoria_id) && c.activo);
        if (!categoria) return { ok: false, error: 'Elegí una categoría.' };
        const existente = descripcionesGasto.find((d) => d.nombre.toLowerCase() === texto.toLowerCase() && d.categoria_id === categoria.id);
        if (existente) existente.nombre = texto;
        else descripcionesGasto.push({ id: nextDescripcionGastoId++, nombre: texto, categoria_id: categoria.id, orden: 0 });
        return { ok: true };
      },
      quitarDescripcion: async (id) => {
        descripcionesGasto = descripcionesGasto.filter((d) => d.id !== id);
        return { ok: true };
      },
      crear: async (g) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(g.fecha)) return { ok: false, error: 'La fecha no es válida.' };
        const monto = Number(g.monto);
        if (g.medio_pago !== 'Cheque' && (!Number.isFinite(monto) || monto <= 0)) return { ok: false, error: 'Poné un monto mayor a cero.' };
        const descripcion = String(g.descripcion || '').trim();
        if (!descripcion) return { ok: false, error: 'Poné una descripción.' };
        const observacion = String(g.observacion || '').trim() || null;
        const cuentaGasto = cuentaDeGastoMock(g);
        if (cuentaGasto.error) return { ok: false, error: cuentaGasto.error };
        const tarjetaGasto = datosTarjetaGastoMock(g);
        if (tarjetaGasto.error) return { ok: false, error: tarjetaGasto.error };
        const categoria = categoriasGasto.find((c) => c.id === Number(g.categoria_id) && c.activo);
        if (!categoria) return { ok: false, error: 'Elegí una categoría.' };
        if (!MEDIOS_GASTO.includes(g.medio_pago)) return { ok: false, error: 'Elegí cómo se pagó.' };
        const cheque = g.medio_pago === 'Cheque' ? cheques.find((c) => c.id === Number(g.cheque_id) && c.estado === 'en_cartera') : null;
        if (g.medio_pago === 'Cheque' && !cheque) return { ok: false, error: 'Elegí un cheque de la cartera.' };
        const nuevoId = nextGastoId++;
        gastos.push({
          id: nuevoId,
          fecha: g.fecha,
          categoria_id: categoria.id,
          descripcion,
          monto: cheque ? cheque.importe : monto,
          medio_pago: g.medio_pago,
          cheque_banco: cheque ? cheque.banco : null,
          cheque_numero: cheque ? cheque.numero : null,
          cheque_fecha: cheque ? cheque.fecha_cobro : null,
          cheque_id: cheque ? cheque.id : null,
          observacion,
          cuenta: cuentaGasto.cuenta,
          tarjeta: tarjetaGasto.tarjeta,
          cuotas: tarjetaGasto.cuotas,
        });
        if (g.medio_pago === 'Crédito') crearCuotasMock(nuevoId, cheque ? cheque.importe : monto, tarjetaGasto.cuotas);
        if (cheque) Object.assign(cheque, { estado: 'entregado', entregado_a: descripcion, fecha_entrega: g.fecha });
        const orden = Math.max(0, ...descripcionesGasto.map((d) => d.orden)) + 1;
        const existente = descripcionesGasto.find((d) => d.nombre.toLowerCase() === descripcion.toLowerCase() && d.categoria_id === categoria.id);
        if (existente) Object.assign(existente, { nombre: descripcion, orden });
        else descripcionesGasto.push({ id: nextDescripcionGastoId++, nombre: descripcion, categoria_id: categoria.id, orden });
        return { ok: true, id: nuevoId };
      },
      actualizar: async (g) => {
        const actual = gastos.find((x) => x.id === Number(g && g.id));
        if (!actual) return { ok: false, error: 'Ese gasto ya no existe.' };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(g.fecha)) return { ok: false, error: 'La fecha no es válida.' };
        const descripcion = String(g.descripcion || '').trim();
        if (!descripcion) return { ok: false, error: 'Poné una descripción.' };
        const observacion = String(g.observacion || '').trim() || null;
        const categoria = categoriasGasto.find((c) => c.id === Number(g.categoria_id) && (c.activo || c.id === actual.categoria_id));
        if (!categoria) return { ok: false, error: 'Elegí una categoría.' };
        const conCheque = actual.medio_pago === 'Cheque';
        const medio = conCheque ? 'Cheque' : g.medio_pago;
        if (!MEDIOS_GASTO.includes(medio)) return { ok: false, error: 'Elegí cómo se pagó.' };
        if (medio === 'Cheque' && !conCheque) return { ok: false, error: 'Para pagar con cheque, quitá el gasto y cargalo de nuevo eligiendo el cheque.' };
        let monto = actual.monto;
        if (!actual.cheque_id) {
          monto = Number(g.monto);
          if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
        }
        const tarjetaAct = datosTarjetaGastoMock({ ...g, medio_pago: medio });
        if (tarjetaAct.error) return { ok: false, error: tarjetaAct.error };
        Object.assign(actual, { fecha: g.fecha, categoria_id: categoria.id, descripcion, monto, medio_pago: medio, observacion, cuenta: cuentaDeGastoMock({ ...g, medio_pago: medio }).cuenta, tarjeta: tarjetaAct.tarjeta, cuotas: tarjetaAct.cuotas });
        const cheque = actual.cheque_id && cheques.find((c) => c.id === actual.cheque_id);
        if (cheque) Object.assign(cheque, { entregado_a: descripcion, fecha_entrega: g.fecha });
        const existente = descripcionesGasto.find((d) => d.nombre.toLowerCase() === descripcion.toLowerCase() && d.categoria_id === categoria.id);
        if (!existente) descripcionesGasto.push({ id: nextDescripcionGastoId++, nombre: descripcion, categoria_id: categoria.id, orden: Math.max(0, ...descripcionesGasto.map((d) => d.orden)) + 1 });
        return { ok: true };
      },
      eliminar: async (id) => {
        const gasto = gastos.find((g) => g.id === id);
        const cheque = gasto && cheques.find((c) => c.id === gasto.cheque_id);
        if (cheque) Object.assign(cheque, { estado: 'en_cartera', entregado_a: null, fecha_entrega: null });
        gastos = gastos.filter((g) => g.id !== id);
        cuotasGasto = cuotasGasto.filter((c) => c.gasto_id !== id);
        return { ok: true };
      },
      listar: async ({ desde, hasta, medio } = {}) =>
        gastos
          .filter((g) => (!desde || g.fecha >= desde) && (!hasta || g.fecha <= hasta) && (!medio || g.medio_pago.toLowerCase() === medio.toLowerCase()))
          .map((g) => ({ ...g, categoria: (categoriasGasto.find((c) => c.id === g.categoria_id) || {}).nombre, categoria_ambito: (categoriasGasto.find((c) => c.id === g.categoria_id) || {}).ambito || 'negocio', cuotas_pagadas: cuotasGasto.filter((c) => c.gasto_id === g.id && c.fecha_pago).length }))
          .sort((a, b) => (a.fecha !== b.fecha ? (a.fecha < b.fecha ? 1 : -1) : b.id - a.id)),
      cuotas: async (gastoId) => cuotasGasto.filter((c) => c.gasto_id === Number(gastoId)).sort((a, b) => a.numero - b.numero),
      cuotasPendientes: async () =>
        cuotasGasto
          .filter((c) => !c.fecha_pago)
          .map((c) => {
            const g = gastos.find((x) => x.id === c.gasto_id) || {};
            return { id: c.id, numero: c.numero, monto: c.monto, cuotas: g.cuotas, descripcion: g.descripcion, tarjeta: g.tarjeta, cuenta: g.cuenta, fecha: g.fecha };
          }),
      pagarCuota: async ({ id, fecha, cuenta }) => {
        const c = cuotasGasto.find((x) => x.id === Number(id));
        if (!c) return { ok: false, error: 'Esa cuota ya no existe.' };
        if (c.fecha_pago) return { ok: false, error: 'Esa cuota ya está pagada.' };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return { ok: false, error: 'La fecha no es válida.' };
        const valida = listaCuentasMock().filter((n) => claveCuentaMock(n) !== 'efectivo').find((n) => claveCuentaMock(n) === claveCuentaMock(cuenta));
        if (!valida) return { ok: false, error: 'Elegí de qué cuenta se pagó la cuota.' };
        Object.assign(c, { fecha_pago: fecha, cuenta: valida });
        return { ok: true };
      },
      deshacerCuota: async (id) => {
        const c = cuotasGasto.find((x) => x.id === Number(id));
        if (c) Object.assign(c, { fecha_pago: null, cuenta: null });
        return { ok: true };
      },
    },
    caja: {
      obtenerDia: async (fecha) => {
        const cierre = cierresCaja.find((c) => c.fecha === fecha) || null;
        const primerCierre = cierresCaja.map((c) => c.fecha).sort()[0];
        const ayer = sumarDiasMock(fecha, -1);
        const fondoAuto = primerCierre && primerCierre <= ayer ? Math.max(0, cuentaCajaPorDiaMock(ayer).get(ayer).quedo) : 0;
        const cobros = pagosQueEntran()
          .filter((p) => periodoDia(new Date(p.fecha)) === fecha)
          .map((p) => {
            const factura = facturas.find((f) => f.id === p.factura_id);
            const cliente = clientes.find((c) => c.id === (factura ? factura.cliente_id : p.cliente_id));
            return { ...p, cliente_nombre: nombreCompleto(cliente) };
          });
        const catNombre = (id) => (categoriasGasto.find((c) => c.id === id) || {}).nombre;
        const nombreProv = (id) => (proveedores.find((x) => x.id === id) || {}).nombre;
        // Bancos y apps: lo que había al empezar, lo que entró y salió y el saldo al cerrar (como en main.js).
        let cuentasCierre = [];
        if (cajaConfig.desde && fecha >= cajaConfig.desde) {
          const movs = movimientosCuentasMock(cajaConfig.desde).filter((m) => m.fecha <= fecha);
          cuentasCierre = listaCuentasMock().filter((n) => claveCuentaMock(n) !== 'efectivo').map((nombre) => {
            const propios = movs.filter((m) => m.cuenta === nombre);
            const antes = propios.filter((m) => m.fecha < fecha).reduce((a, m) => a + m.monto, 0);
            const delDia = propios.filter((m) => m.fecha === fecha);
            const entro = redondear2(delDia.filter((m) => m.monto > 0).reduce((a, m) => a + m.monto, 0));
            const salio = redondear2(-delDia.filter((m) => m.monto < 0).reduce((a, m) => a + m.monto, 0));
            const alEmpezar = redondear2((cajaConfig.saldos[claveCuentaMock(nombre)] || 0) + antes);
            return { nombre, alEmpezar, entro, salio, deberia: redondear2(alEmpezar + entro - salio) };
          });
        }
        return {
          ok: true,
          cierre,
          fondoSugerido: fondoAuto,
          gastosEfectivo: [
            ...gastos
              .filter((g) => g.fecha === fecha && g.medio_pago === 'Efectivo')
              .map((g) => ({ id: g.id, monto: g.monto, descripcion: g.descripcion, categoria_id: g.categoria_id, categoria: catNombre(g.categoria_id), origen: 'gasto' })),
            ...pagosProveedor
              .filter((p) => p.fecha === fecha && p.efectivo > 0)
              .map((p) => ({ id: p.id, monto: p.efectivo, descripcion: `Pago a ${nombreProv(p.proveedor_id)}`, categoria: 'Proveedores', origen: 'proveedor' })),
          ],
          ingresosDelDia: redondear2(ingresos.filter((x) => x.fecha === fecha && x.cuenta && !x.fondo_personal).reduce((a, x) => a + x.monto, 0)),
          salidasDelDia: [
            ...gastos
              .filter((g) => g.fecha === fecha && !['cheque', 'crédito'].includes(String(g.medio_pago).toLowerCase()))
              .map((g) => {
                const cat = categoriasGasto.find((c) => c.id === g.categoria_id) || {};
                const efectivo = g.medio_pago === 'Efectivo';
                return { detalle: g.descripcion, categoria: cat.nombre, ambito: cat.ambito || 'negocio', pagoCon: efectivo ? 'Efectivo' : g.cuenta ? `${g.medio_pago} · ${g.cuenta}` : g.medio_pago, efectivo, monto: g.monto };
              }),
            ...cuotasGasto
              .filter((c) => c.fecha_pago === fecha)
              .map((c) => {
                const g = gastos.find((x) => x.id === c.gasto_id) || {};
                const cat = categoriasGasto.find((x) => x.id === g.categoria_id) || {};
                return { detalle: `Cuota ${c.numero} de ${g.cuotas}: ${g.descripcion}`, categoria: cat.nombre, ambito: cat.ambito || 'negocio', pagoCon: c.cuenta || '', efectivo: false, monto: c.monto };
              }),
            ...pagosProveedor
              .filter((p) => p.fecha === fecha)
              .flatMap((p) => [
                ...(p.efectivo > 0 ? [{ detalle: `Pago a ${nombreProv(p.proveedor_id)}`, categoria: 'Proveedores', ambito: 'negocio', pagoCon: 'Efectivo', efectivo: true, monto: p.efectivo }] : []),
                ...(p.transferencia > 0 ? [{ detalle: `Pago a ${nombreProv(p.proveedor_id)}`, categoria: 'Proveedores', ambito: 'negocio', pagoCon: 'Transferencia', efectivo: false, monto: p.transferencia }] : []),
              ]),
          ],
          ...(() => {
            const ops = movimientosOperacionesMock(fecha).filter((o) => claveCuentaMock(o.cuenta) === 'efectivo' && o.fecha === fecha);
            const entro = redondear2(ops.filter((o) => o.monto > 0).reduce((a, o) => a + o.monto, 0));
            const salio = redondear2(-ops.filter((o) => o.monto < 0).reduce((a, o) => a + o.monto, 0));
            return { otrosEfectivo: redondear2(entro - salio), otrosEfectivoEntro: entro, otrosEfectivoSalio: salio };
          })(),
          cajaConfigurada: Boolean(cajaConfig.desde),
          cuentas: cuentasCierre,
          cobros,
        };
      },
      resumenMes: async ({ anio, mes }) => {
        const primero = `${anio}-${String(mes + 1).padStart(2, '0')}-01`;
        const ultimo = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(new Date(anio, mes + 1, 0).getDate()).padStart(2, '0')}`;
        const hoy = periodoDia(new Date());
        const hasta = ultimo < hoy ? ultimo : hoy;
        if (hasta < primero) return { ok: true, dias: [] };
        const porDia = cuentaCajaPorDiaMock(hasta);
        const dias = [];
        for (let d = primero; d <= hasta; d = sumarDiasMock(d, 1)) {
          const c = porDia.get(d) || { fecha: d, cierre: false, fondo: 0, efectivo: 0, retiros: 0, otros: 0, cobrado: 0, pagado: 0, esperado: 0, contado: null };
          const diferencia = c.contado === null ? null : redondear2(c.contado - c.esperado);
          let estado;
          if (c.cierre) estado = diferencia === null ? 'sin_contar' : Math.abs(diferencia) < 0.005 ? 'justo' : diferencia > 0 ? 'sobra' : 'falta';
          else estado = c.efectivo !== 0 || c.retiros !== 0 || c.otros !== 0 || c.cobrado !== 0 || c.pagado !== 0 ? 'sin_cerrar' : 'sin_movimiento';
          dias.push({ fecha: d, estado, fondo: c.fondo, efectivo: c.efectivo, retiros: c.retiros, otros: c.otros || 0, cobrado: c.cobrado, pagado: c.pagado, esperado: c.esperado, contado: c.contado, diferencia });
        }
        return { ok: true, dias };
      },
      resumenCierres: async () =>
        cierresCaja.map((c) => {
          const efectivo = pagos
            .filter((p) => periodoDia(new Date(p.fecha)) === c.fecha && p.metodo_pago.trim().toLowerCase() === 'efectivo')
            .reduce((acc, p) => acc + p.monto, 0);
          const retiros =
            gastos.filter((g) => g.fecha === c.fecha && g.medio_pago === 'Efectivo').reduce((acc, g) => acc + g.monto, 0) +
            pagosProveedor.filter((p) => p.fecha === c.fecha).reduce((acc, p) => acc + p.efectivo, 0);
          return {
            fecha: c.fecha,
            diferencia: c.efectivo_contado === null ? null : redondear2(c.efectivo_contado - (c.fondo_inicial + efectivo - retiros)),
          };
        }),
      guardarCierre: async ({ fecha, fondo_inicial, efectivo_contado }) => {
        const fondo = Number(fondo_inicial);
        if (!Number.isFinite(fondo) || fondo < 0) return { ok: false, error: 'El fondo inicial no es válido.' };
        const contado = efectivo_contado === null || efectivo_contado === undefined ? null : Number(efectivo_contado);
        if (contado !== null && (!Number.isFinite(contado) || contado < 0)) {
          return { ok: false, error: 'El efectivo contado no es válido.' };
        }
        const existente = cierresCaja.find((c) => c.fecha === fecha);
        const guardado_en = new Date().toISOString();
        if (existente) Object.assign(existente, { fondo_inicial: fondo, efectivo_contado: contado, guardado_en });
        else cierresCaja.push({ fecha, fondo_inicial: fondo, efectivo_contado: contado, guardado_en });
        return { ok: true };
      },
    },
    reportes: {
      cobrosPorDia: async () => agruparCobros((d) => periodoDia(d)),
      cobrosPorMes: async () => agruparCobros((d) => periodoMes(d)),
      cobrosDelDia: async (fecha) => {
        const filas = [];
        pagos
          .filter((p) => !esPagoCredito(p) && periodoDia(new Date(p.fecha)) === fecha)
          .forEach((p) => {
            const f = facturas.find((x) => x.id === p.factura_id);
            const c = clientes.find((x) => x.id === (f ? f.cliente_id : p.cliente_id));
            const clave = `${c ? c.id : ''}|${p.metodo_pago}`;
            let fila = filas.find((x) => x.clave === clave);
            if (!fila) {
              fila = { clave, cliente_id: c ? c.id : null, nombre: c ? c.nombre : null, apellido: c ? c.apellido : null, negocio: c ? c.negocio : null, metodo_pago: p.metodo_pago, monto: 0, desde: p.fecha };
              filas.push(fila);
            }
            fila.monto = redondear2(fila.monto + p.monto);
          });
        const orden = [];
        filas.forEach((f) => { if (!orden.includes(f.cliente_id)) orden.push(f.cliente_id); });
        return orden.flatMap((id) => filas.filter((f) => f.cliente_id === id)).map(({ clave, ...resto }) => resto);
      },
      cantidadesPedidasPorDia: async () => agruparCantidadesPedidas((d) => periodoDia(d)),
      cantidadesPedidasPorMes: async () => agruparCantidadesPedidas((d) => periodoMes(d)),
      saldosPorCliente: async () =>
        clientes
          .filter((c) => redondear2(c.saldo) > 0)
          .sort((a, b) => b.saldo - a.saldo)
          .map((c) => ({ id: c.id, nombre: c.nombre, apellido: c.apellido, saldo: c.saldo })),
    },
    sistema: {
      abrirEnlace: async (url) => window.open(url, '_blank'),
      buscarActualizacion: async () => ({ ok: true, disponible: !!window.__mockActualizacion, version: '9.9.9', actual: '0.3.0', enDesarrollo: !window.__mockActualizacion }),
      instalarActualizacion: async () => ({ ok: true }),
      hacerBackup: async () => ({
        ok: false,
        error: 'La copia de seguridad solo está disponible en la app de escritorio.',
      }),
      // Datos de mentira, solo para poder ver la pantalla de copias en el navegador.
      listarCopias: async () => {
        const dia = (n) => new Date(Date.now() - n * 86400000).toISOString();
        return {
          copias: [
            { nombre: 'freska-auto-2026-09-18.db', tipo: 'automatica', fecha: dia(0), tamano: 1843200 },
            { nombre: 'freska-auto-2026-09-17.db', tipo: 'automatica', fecha: dia(1), tamano: 1830912 },
            { nombre: 'freska-antes-de-restaurar-2026-09-16-153005.db', tipo: 'previa', fecha: dia(2), tamano: 1822720 },
            { nombre: 'freska-auto-2026-09-15.db', tipo: 'automatica', fecha: dia(3), tamano: 1810432 },
          ],
          ultimaManual: null,
          carpeta: 'C:\\Users\\...\\AppData\\Roaming\\freska-app\\copias',
        };
      },
      abrirCarpetaCopias: async () => {},
      // Copia externa de mentira: solo guarda el estado en memoria para poder ver la pantalla.
      copiaExternaEstado: async () => ({ ...estadoCopiaExternaMock }),
      elegirCarpetaCopiaExterna: async () => {
        Object.assign(estadoCopiaExternaMock, { carpeta: 'G:\\Mi unidad\\FRESKA copias', ultima: new Date().toISOString(), error: null, disponible: true });
        return { ok: true, copia: { ok: true }, estado: { ...estadoCopiaExternaMock } };
      },
      copiaExternaAhora: async () => {
        estadoCopiaExternaMock.ultima = new Date().toISOString();
        return { ok: true, estado: { ...estadoCopiaExternaMock } };
      },
      quitarCopiaExterna: async () => {
        Object.assign(estadoCopiaExternaMock, { carpeta: null, ultima: null, error: null, disponible: false });
        return { ok: true, estado: { ...estadoCopiaExternaMock } };
      },
      restaurarCopia: async () => ({ ok: true }),
      restaurarDesdeArchivo: async () => ({ ok: false, cancelado: true }),
      geocodificar: async (direccion) => {
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(direccion)}`;
          const respuesta = await fetch(url);
          const resultados = await respuesta.json();
          if (!resultados || resultados.length === 0) return null;
          return { lat: Number(resultados[0].lat), lon: Number(resultados[0].lon) };
        } catch (e) {
          return null;
        }
      },
    },
    usuarios: {
      paraElegir: async () => usuariosMock.filter((u) => u.activo).map((u) => ({ id: u.id, nombre: u.nombre })),
      crearPrimero: async ({ nombre, pin } = {}) => {
        if (usuariosMock.length) return { ok: false, error: 'Ya hay usuarios creados.' };
        if (typeof pin !== 'string' || pin.length < 4) return { ok: false, error: 'La contraseña debe tener al menos 4 caracteres.' };
        const n = String(nombre || '').trim().slice(0, 40) || 'Administrador';
        const u = { id: nextUsuarioMockId++, nombre: n, pin, rol: 'admin', activo: 1 };
        usuariosMock.push(u);
        sesionActualMock = { id: u.id, nombre: u.nombre, rol: u.rol };
        return { ok: true, usuario: sesionActualMock };
      },
      ingresar: async ({ usuario_id, pin }) => {
        const u = usuariosMock.find((x) => x.id === Number(usuario_id) && x.activo);
        if (!u) return { ok: false, error: 'Ese usuario ya no existe.' };
        if (u.pin !== pin) return { ok: false, bloqueadoSegundos: 0 };
        sesionActualMock = { id: u.id, nombre: u.nombre, rol: u.rol };
        return { ok: true, usuario: sesionActualMock };
      },
      cerrarSesion: async () => {
        sesionActualMock = null;
        return { ok: true };
      },
      sesionActual: async () => sesionActualMock,
      listar: async () =>
        sesionActualMock && sesionActualMock.rol === 'admin'
          ? usuariosMock.map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol, activo: u.activo }))
          : [],
      crear: async ({ nombre, pin, rol }) => {
        if (!sesionActualMock || sesionActualMock.rol !== 'admin') return { ok: false, error: 'No tenés permiso para hacer esto.' };
        const n = String(nombre || '').trim().slice(0, 40);
        if (!n) return { ok: false, error: 'Poné un nombre.' };
        if (typeof pin !== 'string' || pin.length < 4) return { ok: false, error: 'La contraseña debe tener al menos 4 caracteres.' };
        if (!['admin', 'empleado'].includes(rol)) return { ok: false, error: 'Elegí si es administrador o empleado.' };
        if (usuariosMock.some((u) => u.nombre.toLowerCase() === n.toLowerCase())) return { ok: false, error: 'Ya hay un usuario con ese nombre.' };
        const u = { id: nextUsuarioMockId++, nombre: n, pin, rol, activo: 1 };
        usuariosMock.push(u);
        return { ok: true, id: u.id };
      },
      actualizar: async ({ id, nombre, rol, activo }) => {
        if (!sesionActualMock || sesionActualMock.rol !== 'admin') return { ok: false, error: 'No tenés permiso para hacer esto.' };
        const u = usuariosMock.find((x) => x.id === Number(id));
        if (!u) return { ok: false, error: 'Ese usuario ya no existe.' };
        const n = String(nombre === undefined ? u.nombre : nombre).trim().slice(0, 40);
        if (!n) return { ok: false, error: 'Poné un nombre.' };
        const nuevoRol = ['admin', 'empleado'].includes(rol) ? rol : u.rol;
        const nuevoActivo = activo === undefined ? u.activo : activo ? 1 : 0;
        const quedariaSinAdmin =
          u.rol === 'admin' &&
          (nuevoRol !== 'admin' || !nuevoActivo) &&
          usuariosMock.filter((x) => x.rol === 'admin' && x.activo && x.id !== u.id).length === 0;
        if (quedariaSinAdmin) return { ok: false, error: 'Tiene que quedar al menos un administrador activo.' };
        if (usuariosMock.some((x) => x.id !== u.id && x.nombre.toLowerCase() === n.toLowerCase())) return { ok: false, error: 'Ya hay un usuario con ese nombre.' };
        Object.assign(u, { nombre: n, rol: nuevoRol, activo: nuevoActivo });
        return { ok: true };
      },
      resetearPin: async ({ id, pin }) => {
        if (!sesionActualMock || sesionActualMock.rol !== 'admin') return { ok: false, error: 'No tenés permiso para hacer esto.' };
        if (typeof pin !== 'string' || pin.length < 4) return { ok: false, error: 'La contraseña debe tener al menos 4 caracteres.' };
        const u = usuariosMock.find((x) => x.id === Number(id));
        if (!u) return { ok: false, error: 'Ese usuario ya no existe.' };
        u.pin = pin;
        return { ok: true };
      },
      cambiarPin: async ({ actual, nuevo }) => {
        if (!sesionActualMock) return { ok: false, error: 'No hay una sesión activa.' };
        if (typeof nuevo !== 'string' || nuevo.length < 4) return { ok: false, error: 'La contraseña nueva debe tener al menos 4 caracteres.' };
        const u = usuariosMock.find((x) => x.id === sesionActualMock.id);
        if (!u) return { ok: false, error: 'Ese usuario ya no existe.' };
        if (u.pin !== actual) return { ok: false, error: 'La contraseña actual no es correcta.' };
        u.pin = nuevo;
        return { ok: true };
      },
    },
    // Solo el administrador (igual que el servicio real: un empleado recibe "No tenés permiso").
    vendedores: {
      listar: async () => (sesionActualMock && sesionActualMock.rol === 'empleado' ? { ok: false, error: 'No tenés permiso para hacer esto.' } : [...vendedoresMock].sort((a, b) => a.numero - b.numero)),
      crear: async (d) => {
        const nombre = String((d && d.nombre) || '').trim();
        const numero = Number(d && d.numero);
        const porcentaje = Number(d && d.porcentaje);
        if (!nombre) return { ok: false, error: 'Poné el nombre del vendedor.' };
        if (!Number.isInteger(numero) || numero <= 0) return { ok: false, error: 'El número del vendedor tiene que ser un entero mayor a cero.' };
        if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100) return { ok: false, error: 'El porcentaje tiene que estar entre 0 y 100.' };
        if (vendedoresMock.some((v) => v.nombre.toLowerCase() === nombre.toLowerCase())) return { ok: false, error: 'Ya hay un vendedor con ese nombre.' };
        const v = { id: nextVendedorMockId++, numero, nombre, porcentaje: redondear2(porcentaje), telefono: String(d.telefono || '').trim() || null, activo: 1, historial: [{ desde: '0000-00-00', porcentaje: redondear2(porcentaje) }] };
        vendedoresMock.push(v);
        return { ok: true, id: v.id };
      },
      actualizar: async (d) => {
        const v = vendedoresMock.find((x) => x.id === Number(d.id));
        if (!v) return { ok: false, error: 'Ese vendedor ya no existe.' };
        const nombre = String(d.nombre || '').trim();
        const numero = Number(d.numero);
        const porcentaje = Number(d.porcentaje);
        if (!nombre) return { ok: false, error: 'Poné el nombre del vendedor.' };
        if (!Number.isInteger(numero) || numero <= 0) return { ok: false, error: 'El número del vendedor tiene que ser un entero mayor a cero.' };
        if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100) return { ok: false, error: 'El porcentaje tiene que estar entre 0 y 100.' };
        if (vendedoresMock.some((x) => x.id !== v.id && x.nombre.toLowerCase() === nombre.toLowerCase())) return { ok: false, error: 'Ya hay un vendedor con ese nombre.' };
        // El porcentaje nuevo vale desde hoy; lo vendido antes se sigue calculando con el anterior.
        if (Math.abs(redondear2(porcentaje) - v.porcentaje) > 0.0001) {
          const hoy = fechaLocalHoyMock();
          v.historial = v.historial.filter((h) => h.desde !== hoy).concat({ desde: hoy, porcentaje: redondear2(porcentaje) });
        }
        Object.assign(v, { nombre, numero, porcentaje: redondear2(porcentaje), telefono: String(d.telefono || '').trim() || null, activo: d.activo === undefined ? v.activo : d.activo ? 1 : 0 });
        return { ok: true };
      },
      informe: async (arg) => {
        if (sesionActualMock && sesionActualMock.rol === 'empleado') return { ok: false, error: 'No tenés permiso para hacer esto.' };
        // Un mes ('AAAA-MM') o un período ({ desde, hasta }), como el servicio real.
        let desde;
        let hasta;
        let mes;
        if (arg && typeof arg === 'object') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(arg.desde || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(arg.hasta || '')) || arg.desde > arg.hasta) return { ok: false, error: 'Elegí un período válido.' };
          desde = arg.desde;
          hasta = arg.hasta;
          const m = desde.slice(0, 7);
          const ultimo = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
          mes = desde === `${m}-01` && hasta === `${m}-${String(ultimo).padStart(2, '0')}` ? m : undefined;
        } else {
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(arg || ''))) return { ok: false, error: 'Elegí un período válido.' };
          const ultimo = new Date(Number(String(arg).slice(0, 4)), Number(String(arg).slice(5, 7)), 0).getDate();
          desde = `${arg}-01`;
          hasta = `${arg}-${String(ultimo).padStart(2, '0')}`;
          mes = String(arg);
        }
        const enPeriodo = (f) => String(f).slice(0, 10) >= desde && String(f).slice(0, 10) <= hasta;
        // La comisión va sobre lo cobrado (no lo facturado): un cobro cuenta el mes en que se cobró, con el
        // porcentaje que tenía el vendedor ese día. Las anuladas se listan aparte, por el mes en que se facturaron.
        const facturasPorId = new Map(facturas.map((f) => [f.id, f]));
        const cobrosDelMes = pagos.filter((p) => {
          const f = facturasPorId.get(p.factura_id);
          return f && f.estado !== 'anulada' && String(p.metodo_pago || '').trim().toLowerCase() !== 'saldo a favor' && enPeriodo(p.fecha);
        });
        const anuladasDelMes = facturas.filter((f) => f.estado === 'anulada' && enPeriodo(f.fecha));
        const armar = (vendedor, cobrosPropios, anuladasPropias) => {
          const porCliente = new Map();
          cobrosPropios.forEach((p) => {
            const f = facturasPorId.get(p.factura_id);
            const c = clientes.find((x) => x.id === f.cliente_id);
            const previo = porCliente.get(f.cliente_id) || { cliente_id: f.cliente_id, cliente: nombreCompleto(c), facturas: new Set(), total: 0 };
            previo.facturas.add(p.factura_id);
            previo.total = redondear2(previo.total + p.monto);
            porCliente.set(f.cliente_id, previo);
          });
          const total = redondear2(cobrosPropios.reduce((acc, p) => acc + p.monto, 0));
          const aplicados = new Set();
          const comision = vendedor
            ? redondear2(
                cobrosPropios.reduce((acc, p) => {
                  const dia = String(p.fecha).slice(0, 10);
                  let pct = 0;
                  [...vendedor.historial].sort((a, b) => (a.desde < b.desde ? -1 : 1)).forEach((h) => {
                    if (h.desde <= dia) pct = h.porcentaje;
                  });
                  aplicados.add(pct);
                  return acc + (p.monto * pct) / 100;
                }, 0)
              )
            : undefined;
          return {
            total,
            cantidad: new Set(cobrosPropios.map((p) => p.factura_id)).size,
            clientes: [...porCliente.values()]
              .map((c) => ({ cliente_id: c.cliente_id, cliente: c.cliente, facturas: c.facturas.size, total: c.total }))
              .sort((a, b) => b.total - a.total),
            anuladas: anuladasPropias.map((f) => ({ id: f.id, fecha: String(f.fecha).slice(0, 10), cliente: nombreCompleto(clientes.find((x) => x.id === f.cliente_id)), total: f.total, motivo: f.motivo_anulacion || '' })),
            ...(vendedor ? { comision, porcentajesAplicados: [...aplicados].sort((a, b) => a - b) } : {}),
          };
        };
        const filas = [...vendedoresMock]
          .sort((a, b) => a.numero - b.numero)
          .map((v) => {
            const base = {
              ...v,
              ...armar(
                v,
                cobrosDelMes.filter((p) => facturasPorId.get(p.factura_id).vendedor_id === v.id),
                anuladasDelMes.filter((f) => f.vendedor_id === v.id)
              ),
            };
            const pagos = comisionesPagadasMock.filter((p) => p.vendedor_id === v.id && enPeriodo(p.fecha));
            const pagado = redondear2(pagos.reduce((acc, p) => acc + p.monto, 0));
            return { ...base, pagos, pagado, pendiente: redondear2(base.comision - pagado) };
          })
          .filter((v) => v.activo || v.cantidad > 0 || v.anuladas.length > 0);
        const conocidos = new Set(vendedoresMock.map((v) => v.id));
        return {
          ok: true,
          desde,
          hasta,
          mes,
          vendedores: filas,
          sinVendedor: armar(
            null,
            cobrosDelMes.filter((p) => {
              const vid = facturasPorId.get(p.factura_id).vendedor_id;
              return !vid || !conocidos.has(vid);
            }),
            anuladasDelMes.filter((f) => !f.vendedor_id || !conocidos.has(f.vendedor_id))
          ),
        };
      },
      pagarComision: async (d) => {
        if (sesionActualMock && sesionActualMock.rol === 'empleado') return { ok: false, error: 'No tenés permiso para hacer esto.' };
        const vendedorId = Number(d && d.vendedor_id);
        const vendedor = vendedoresMock.find((v) => v.id === vendedorId);
        if (!vendedor) return { ok: false, error: 'Ese vendedor ya no existe.' };
        const fecha = d && d.fecha;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return { ok: false, error: 'La fecha no es válida.' };
        const monto = redondear2(Number(d && d.monto));
        if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Poné un monto mayor a cero.' };
        const mes = fecha.slice(0, 7);
        const [anio, m] = mes.split('-');
        const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        const nombreMes = `${MESES[Number(m) - 1]} de ${anio}`;
        let categoria = categoriasGasto.find((c) => c.nombre === 'Comisiones de vendedores');
        if (!categoria) {
          categoria = { id: nextCategoriaGastoId++, nombre: 'Comisiones de vendedores', activo: 1, ambito: 'negocio' };
          categoriasGasto.push(categoria);
        }
        const resultado = await window.freska.gastos.crear({
          fecha,
          categoria_id: categoria.id,
          descripcion: `Comisión ${vendedor.nombre} - ${nombreMes}`,
          monto,
          medio_pago: d.medio_pago,
          cuenta: d.cuenta,
        });
        if (resultado.ok === false) return resultado;
        const id = nextComisionPagoMockId++;
        comisionesPagadasMock.push({ id, vendedor_id: vendedorId, mes, gasto_id: resultado.id, fecha, monto });
        return { ok: true, id, mes };
      },
      deshacerPagoComision: async ({ id }) => {
        const pago = comisionesPagadasMock.find((p) => p.id === Number(id));
        if (!pago) return { ok: false, error: 'Ese pago ya no existe.' };
        await window.freska.gastos.eliminar(pago.gasto_id);
        comisionesPagadasMock = comisionesPagadasMock.filter((p) => p !== pago);
        return { ok: true };
      },
    },
  };

  function agruparCobros(formatearPeriodo) {
    const totales = {};
    pagos.forEach((p) => {
      const periodo = formatearPeriodo(new Date(p.fecha));
      const clave = `${periodo}|${p.metodo_pago}`;
      totales[clave] = (totales[clave] || 0) + p.monto;
    });
    return Object.entries(totales)
      .map(([clave, total]) => {
        const [periodo, metodo_pago] = clave.split('|');
        return { periodo, metodo_pago, total };
      })
      .sort((a, b) => (a.periodo < b.periodo ? 1 : -1));
  }

  function agruparCantidadesPedidas(formatearPeriodo) {
    const totales = {};
    pedidoItems.forEach((i) => {
      const pedido = pedidos.find((p) => p.id === i.pedido_id);
      if (!pedido) return;
      const producto = productos.find((pr) => pr.id === i.producto_id);
      const periodo = formatearPeriodo(new Date(pedido.para_fecha ? `${pedido.para_fecha}T12:00:00` : pedido.fecha)); // cuenta el día para el que es el pedido
      // Lo pedido por unidad ("6 chorizos") se separa de lo pedido en kilos.
      const unidadPedida = i.unidad_pedido === 'unidad' ? 'unidad' : producto.unidad;
      const clave = `${periodo}|${producto.id}|${unidadPedida}`;
      if (!totales[clave]) {
        totales[clave] = {
          periodo,
          producto_nombre: producto.nombre,
          producto_unidad: unidadPedida,
          unidad_base: producto.unidad,
          peso_unidad_pedido: producto.peso_unidad_pedido || null,
          total: 0,
        };
      }
      totales[clave].total += i.cantidad;
    });
    return Object.values(totales).sort((a, b) => (a.periodo < b.periodo ? 1 : -1));
  }

  function periodoMes(fecha) {
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
  }

  function periodoDia(fecha) {
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
  }
}
