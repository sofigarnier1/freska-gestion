// Buscador general (la lupa).
// Parte de lo que antes estaba todo en main.js (dividido por tema el 2026-09-24). Cada archivo exporta `registrar(ctx)`,
// que main.js llama al arrancar: `ctx` trae la base (db), Electron y las funciones compartidas de compartido.js.

function registrar(ctx) {
  const { SQL_NO_CREDITO_P, SQL_PROVEEDORES, db, ipcMain, leerConfig, movimientosDeOperaciones, redondear2 } = ctx;

  // ---------- Buscador general (lupa) ----------
  // Busca en todo a la vez. Ignora mayúsculas y acentos y exige que estén todas las palabras escritas. Si lo
  // escrito es un número también se busca por importe (y el número de factura o de cheque): sirve para saber de
  // quién es una transferencia. Devuelve, por tipo, los primeros resultados y cuántos hay en total.
  const LIMITE_BUSQUEDA = 6;
  const sinAcentos = (t) =>
    String(t ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  const fechaCorta = (f) => {
    const [a, m, d] = String(f).slice(0, 10).split('-');
    return d ? `${d}/${m}/${a}` : '';
  };
  const nombreDe = (nombre, apellido) => `${nombre}${apellido ? ` ${apellido}` : ''}`;

  ipcMain.handle('buscar:todo', (_event, consulta) => {
    const q = String(consulta || '').trim().slice(0, 80);
    if (q.length < 2) return { ok: true, grupos: {} };
    const tokens = sinAcentos(q).split(/\s+/).filter(Boolean);
    const esNumero = /^\d[\d.,]*$/.test(q);
    const importe = esNumero ? Number(q.replace(/\./g, '').replace(',', '.')) : null;
    const coincideImporte = (valor) => importe !== null && Number.isFinite(importe) && Math.abs(valor - importe) < 0.005;
    const coincideTexto = (texto) => {
      const h = sinAcentos(texto);
      return tokens.every((t) => h.includes(t));
    };
    // "N° 123", "n 123" o "#123": número de factura.
    const porNumeroFactura = /^(?:n°?|nro\.?|nº|#)\s*(\d+)$/i.exec(q);
    const numeroFactura = porNumeroFactura ? Number(porNumeroFactura[1]) : esNumero && Number.isInteger(importe) ? importe : null;
    const grupo = (filas, limite = LIMITE_BUSQUEDA) => ({ total: filas.length, items: filas.slice(0, limite) });
    const empiezaCon = (nombre) => (sinAcentos(nombre).startsWith(tokens[0]) ? 0 : 1);
    const grupos = {};

    grupos.clientes = grupo(
      db
        .prepare('SELECT id, nombre, apellido, telefono, telefono_fijo, saldo, activo, codigo, cuit, negocio FROM clientes')
        .all()
        .filter((c) => coincideTexto(`${c.nombre} ${c.apellido || ''} ${c.negocio || ''} ${c.telefono || ''} ${c.telefono_fijo || ''} ${c.codigo || ''} ${c.cuit || ''}`) || (c.saldo > 0 && coincideImporte(c.saldo)))
        // El nombre del negocio, si tiene, va entre paréntesis (así se ve por qué encontró al cliente al buscarlo por el negocio).
        .map((c) => ({ id: c.id, nombre: `${nombreDe(c.nombre, c.apellido)}${c.negocio ? ` (${c.negocio})` : ''}`, saldo: redondear2(c.saldo), activo: c.activo !== 0 }))
        .sort((a, b) => Number(b.activo) - Number(a.activo) || empiezaCon(a.nombre) - empiezaCon(b.nombre) || a.nombre.localeCompare(b.nombre, 'es'))
    );

    grupos.proveedores = grupo(
      db
        .prepare(`${SQL_PROVEEDORES}`)
        .all()
        .filter((p) => coincideTexto(`${p.nombre} ${p.telefono || ''}`) || (p.saldo > 0 && coincideImporte(p.saldo)))
        .map((p) => ({ id: p.id, nombre: p.nombre, saldo: p.saldo, activo: p.activo !== 0 }))
        .sort((a, b) => Number(b.activo) - Number(a.activo) || empiezaCon(a.nombre) - empiezaCon(b.nombre) || a.nombre.localeCompare(b.nombre, 'es'))
    );

    grupos.productos = grupo(
      db
        .prepare('SELECT id, codigo, nombre, precio_cliente, precio_cf, unidad, activo FROM productos')
        .all()
        .filter((p) => coincideTexto(`${p.codigo || ''} ${p.nombre}`))
        .map((p) => ({ id: p.id, nombre: p.nombre, codigo: p.codigo, precio: p.precio_cliente, unidad: p.unidad, activo: p.activo !== 0 }))
        .sort((a, b) => Number(b.activo) - Number(a.activo) || empiezaCon(a.nombre) - empiezaCon(b.nombre) || a.nombre.localeCompare(b.nombre, 'es'))
    );

    grupos.insumos = grupo(
      db
        .prepare('SELECT id, nombre, unidad FROM insumos WHERE activo = 1 ORDER BY nombre COLLATE NOCASE')
        .all()
        .filter((i) => !esNumero && coincideTexto(i.nombre))
        .map((i) => ({
          ...i,
          ultimo: db.prepare('SELECT fecha, cantidad FROM conteos_insumo WHERE insumo_id = ? ORDER BY fecha DESC, id DESC LIMIT 1').get(i.id) || null,
        }))
    );

    grupos.facturas = grupo(
      db
        .prepare(
          `SELECT f.id, f.fecha, f.total, f.estado, c.nombre, c.apellido,
                  ROUND(f.total - COALESCE((SELECT SUM(monto) FROM pagos WHERE factura_id = f.id), 0), 2) AS pendiente
           FROM facturas f JOIN clientes c ON c.id = f.cliente_id ORDER BY f.fecha DESC, f.id DESC`
        )
        .all()
        .filter((f) => {
          if (numeroFactura !== null && f.id === numeroFactura) return true;
          if (porNumeroFactura) return false;
          if (esNumero) return f.estado !== 'anulada' && (coincideImporte(f.total) || (f.pendiente > 0 && coincideImporte(f.pendiente)));
          return coincideTexto(`${f.nombre} ${f.apellido || ''} ${fechaCorta(f.fecha)}`);
        })
        .map((f) => ({
          id: f.id,
          cliente: nombreDe(f.nombre, f.apellido),
          fecha: String(f.fecha).slice(0, 10),
          total: redondear2(f.total),
          pendiente: f.estado === 'anulada' ? 0 : f.pendiente,
          estado: f.estado,
        }))
    );

    grupos.cheques = grupo(
      db
        .prepare('SELECT id, banco, numero, importe, fecha_cobro, librador, estado, entregado_a FROM cheques ORDER BY (estado = \'en_cartera\') DESC, COALESCE(fecha_cobro, \'9999-12-31\'), id DESC')
        .all()
        .filter((c) => {
          if (esNumero) return coincideImporte(c.importe) || String(c.numero).includes(q.replace(/[.,]/g, ''));
          return coincideTexto(`${c.banco} ${c.numero} ${c.librador || ''} ${c.entregado_a || ''}`);
        })
    );

    grupos.gastos = grupo(
      db
        .prepare(
          `SELECT g.id, g.fecha, g.descripcion, g.monto, g.medio_pago, g.observacion, g.cuenta, g.tarjeta, c.nombre AS categoria
           FROM gastos g JOIN categorias_gasto c ON c.id = g.categoria_id ORDER BY g.fecha DESC, g.id DESC`
        )
        .all()
        .filter((g) => (esNumero ? coincideImporte(g.monto) : coincideTexto(`${g.descripcion} ${g.categoria} ${g.medio_pago} ${g.observacion || ''} ${g.cuenta || ''} ${g.tarjeta || ''}`)))
    );

    // Ingresos personales (Cobros → Otros ingresos) y operaciones de la Caja general (pases, dólares, canjes, intereses).
    grupos.ingresos = grupo(
      db
        .prepare('SELECT id, fecha, descripcion, monto, cuenta, observacion FROM ingresos ORDER BY fecha DESC, id DESC')
        .all()
        .filter((i) => (esNumero ? coincideImporte(i.monto) : coincideTexto(`${i.descripcion} ${i.observacion || ''} ${i.cuenta || 'fondos personales'}`)))
    );
    const desdeCaja = leerConfig('caja_desde');
    const vistasOp = new Set();
    grupos.operaciones = grupo(
      desdeCaja
        ? movimientosDeOperaciones(desdeCaja)
            .filter((o) => !o.personal)
            .filter((o) => (vistasOp.has(o.id) ? false : vistasOp.add(o.id)))
            .map((o) => ({ id: o.id, fecha: o.fecha, detalle: o.detalle, monto: Math.abs(o.monto) }))
            .filter((o) => (esNumero ? coincideImporte(o.monto) : coincideTexto(o.detalle)))
            .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id))
        : []
    );

    grupos.pedidos = grupo(
      db
        .prepare(
          `SELECT p.id, p.fecha, c.nombre, c.apellido FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
           WHERE p.estado = 'pendiente' ORDER BY p.fecha DESC`
        )
        .all()
        .filter((p) => !esNumero && coincideTexto(`${p.nombre} ${p.apellido || ''}`))
        .map((p) => ({ id: p.id, cliente: nombreDe(p.nombre, p.apellido), fecha: String(p.fecha).slice(0, 10) }))
    );

    // Solo con un número: los cobros de ese importe ("me depositaron $150.000, ¿de quién es?").
    grupos.cobros = grupo(
      esNumero
        ? db
            .prepare(
              `SELECT p.id, p.factura_id, p.monto, p.metodo_pago, p.fecha, c.id AS cliente_id, c.nombre, c.apellido
               FROM pagos p LEFT JOIN facturas f ON f.id = p.factura_id JOIN clientes c ON c.id = COALESCE(f.cliente_id, p.cliente_id) WHERE ${SQL_NO_CREDITO_P} ORDER BY p.fecha DESC`
            )
            .all()
            .filter((p) => coincideImporte(p.monto))
            .map((p) => ({ id: p.id, factura_id: p.factura_id, cliente_id: p.cliente_id, cliente: nombreDe(p.nombre, p.apellido), monto: redondear2(p.monto), metodo: p.metodo_pago, fecha: String(p.fecha).slice(0, 10) }))
        : []
    );

    // Un empleado solo ve Pedidos, Facturas, Cobros y Clientes en el sidebar: la lupa no le tiene que mostrar
    // de más (Gastos, Proveedores, Cheques, etc.) aunque la búsqueda en sí no esté bloqueada por el envoltorio
    // de permisos de main.js (el canal `buscar:*` no tiene prefijo restringido).
    if (ctx.usuarioActual && ctx.usuarioActual.rol === 'empleado') {
      const permitidosEmpleado = new Set(['clientes', 'facturas', 'pedidos', 'cobros']);
      Object.keys(grupos).forEach((clave) => {
        if (!permitidosEmpleado.has(clave)) delete grupos[clave];
      });
    }

    return { ok: true, grupos };
  });
}

module.exports = { registrar };
