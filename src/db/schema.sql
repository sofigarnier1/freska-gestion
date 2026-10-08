CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  apellido TEXT,
  telefono TEXT,
  telefono_fijo TEXT,
  domicilio TEXT,
  nota TEXT,
  saldo REAL NOT NULL DEFAULT 0,
  ultima_consulta TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  codigo TEXT,
  condicion_iva TEXT,
  cuit TEXT,
  UNIQUE(nombre, apellido)
);

CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT UNIQUE,
  nombre TEXT NOT NULL UNIQUE,
  precio_cliente REAL NOT NULL,
  precio_cf REAL NOT NULL,
  unidad TEXT NOT NULL DEFAULT 'unidad' CHECK (unidad IN ('kg', 'unidad')),
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS facturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  tipo_precio TEXT NOT NULL CHECK (tipo_precio IN ('cliente', 'cf')),
  fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  fecha_pago TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'parcial', 'pagada', 'anulada')),
  total REAL NOT NULL DEFAULT 0,
  motivo_anulacion TEXT
);

CREATE TABLE IF NOT EXISTS factura_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factura_id INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  cantidad REAL NOT NULL,
  precio_unitario REAL NOT NULL,
  subtotal REAL NOT NULL
);

-- Bultos de cada línea de factura (para la lista de carga de la camioneta): una fila por línea, con el peso
-- de la línea (los productos por kilo) o sin peso (los productos por unidad). `cargado` es el tilde de
-- "preparado" (arranca tildado; se destilda lo que falte).
CREATE TABLE IF NOT EXISTS factura_bultos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factura_item_id INTEGER NOT NULL REFERENCES factura_items(id) ON DELETE CASCADE,
  orden INTEGER NOT NULL DEFAULT 0,
  peso REAL,
  cargado INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ubicaciones (
  direccion TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lon REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS metodos_pago (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  activo INTEGER NOT NULL DEFAULT 1
);

-- `factura_id` es NULL en un cobro del saldo anterior de un cliente (el saldo inicial cargado a mano, que no tiene
-- factura): en ese caso `cliente_id` dice de quién es.
CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factura_id INTEGER REFERENCES facturas(id) ON DELETE CASCADE,
  cliente_id INTEGER REFERENCES clientes(id),
  monto REAL NOT NULL,
  metodo_pago TEXT NOT NULL DEFAULT 'Efectivo',
  fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Nota de crédito: lo que queda a favor de un cliente al anular una factura que ya tenía pagos (`credito`; lo
-- que se le devolvió en plata (`devuelto`) sale como un pago negativo en `pagos`). Un pago con el método
-- "Saldo a favor" es un crédito aplicado a otra factura: no es plata que entra, y no cuenta en caja ni en
-- estadísticas.
CREATE TABLE IF NOT EXISTS notas_credito (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factura_id INTEGER NOT NULL REFERENCES facturas(id),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  credito REAL NOT NULL DEFAULT 0,
  devuelto REAL NOT NULL DEFAULT 0,
  metodo_devolucion TEXT
);

-- Caja general (cuentas): cada método de pago (menos Cheque) es una cuenta con su saldo. `cuentas_saldos` es lo
-- que había en cada cuenta al comenzar el día `caja_desde` (en `configuracion`); desde ahí, el saldo se mueve
-- con los cobros (por método), los gastos y pagos a proveedores (con la cuenta de la que salen) y los ajustes.
CREATE TABLE IF NOT EXISTS cuentas_saldos (
  cuenta TEXT PRIMARY KEY,
  saldo REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cuentas_ajustes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta TEXT NOT NULL,
  fecha TEXT NOT NULL,
  monto REAL NOT NULL,
  nota TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Las cuotas de un gasto pagado con tarjeta de crédito: una fila por cuota. Al pagar una (`fecha_pago` y `cuenta`),
-- la plata sale de esa cuenta y cuenta como gasto ese día (las estadísticas son "en base caja").
CREATE TABLE IF NOT EXISTS cuotas_gasto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gasto_id INTEGER NOT NULL REFERENCES gastos(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  monto REAL NOT NULL,
  fecha_pago TEXT,
  cuenta TEXT
);

-- Las tarjetas de cada banco o app (un método de pago): de débito o de crédito. Se eligen al cargar un gasto.
CREATE TABLE IF NOT EXISTS tarjetas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta TEXT NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('Débito', 'Crédito')),
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'facturado')),
  factura_id INTEGER REFERENCES facturas(id)
);

CREATE TABLE IF NOT EXISTS pedido_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  cantidad REAL NOT NULL
);

-- Cierre de caja: un registro por día (fondo con el que arranca y efectivo contado) y las
-- salidas de efectivo del día. Los retiros se guardan aparte para poder pasarlos más adelante
-- a Proveedores / Gastos sin volver a cargarlos.
CREATE TABLE IF NOT EXISTS cierres_caja (
  fecha TEXT PRIMARY KEY,
  fondo_inicial REAL NOT NULL DEFAULT 0,
  efectivo_contado REAL,
  guardado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS retiros_caja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  monto REAL NOT NULL,
  concepto TEXT NOT NULL
);

-- Motivos de retiro sugeridos en el formulario. Se agregan solos al cargar un retiro con un motivo
-- nuevo y quedan aunque después se quiten los retiros; se sacan a mano. `orden` crece con cada uso.
CREATE TABLE IF NOT EXISTS motivos_retiro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  orden INTEGER NOT NULL DEFAULT 0
);

-- Insumos (bolsas, bandejas, film, ingredientes...): se gastan pero no se venden ni se producen. No se descuentan
-- solos: se cuentan de vez en cuando (cada conteo guarda la cantidad que había ese día).
CREATE TABLE IF NOT EXISTS insumos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  unidad TEXT NOT NULL DEFAULT 'u.',
  minimo REAL,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS conteos_insumo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insumo_id INTEGER NOT NULL REFERENCES insumos(id),
  fecha TEXT NOT NULL,
  cantidad REAL NOT NULL
);

-- Gastos indirectos del negocio (alquiler, servicios, insumos, sueldos, impuestos...). Las categorías
-- y las descripciones sugeridas son listas propias que se editan en la app. Un gasto pagado en
-- efectivo cuenta como retiro del día en el Cierre de caja (no se carga dos veces).
-- El mismo nombre puede estar una vez en Negocio y otra en Personal ("Obra social" en los dos grupos).
CREATE TABLE IF NOT EXISTS categorias_gasto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL COLLATE NOCASE,
  activo INTEGER NOT NULL DEFAULT 1,
  ambito TEXT NOT NULL DEFAULT 'negocio' CHECK (ambito IN ('negocio', 'personal')),
  -- 1 = categoría de Fondos personales (ingresos y gastos de propiedades); 0 = la de Gastos. Siempre de ámbito personal.
  de_fondos INTEGER NOT NULL DEFAULT 0,
  UNIQUE (nombre, ambito, de_fondos)
);

CREATE TABLE IF NOT EXISTS gastos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  categoria_id INTEGER NOT NULL REFERENCES categorias_gasto(id),
  descripcion TEXT NOT NULL,
  monto REAL NOT NULL,
  medio_pago TEXT NOT NULL DEFAULT 'Efectivo',
  cheque_banco TEXT,
  cheque_numero TEXT,
  cheque_fecha TEXT,
  cheque_id INTEGER,
  observacion TEXT,
  cuenta TEXT,
  tarjeta TEXT,
  cuotas INTEGER
);

-- Una descripción puede repetirse en distintas categorías ("Obra social" en Sueldos y en una personal);
-- dentro de una misma categoría, una sola vez.
CREATE TABLE IF NOT EXISTS descripciones_gasto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL COLLATE NOCASE,
  categoria_id INTEGER REFERENCES categorias_gasto(id),
  orden INTEGER NOT NULL DEFAULT 0,
  UNIQUE (nombre, categoria_id)
);

-- Cartera de cheques: los que se reciben de clientes (al cobrar con cheque) y se entregan a proveedores.
-- `estado`: en_cartera | entregado. Un cheque cargado al cobrar guarda el cliente que lo dio.
CREATE TABLE IF NOT EXISTS cheques (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  banco TEXT NOT NULL,
  numero TEXT NOT NULL,
  importe REAL NOT NULL,
  fecha_cobro TEXT,
  librador TEXT,
  cliente_id INTEGER REFERENCES clientes(id),
  fecha_ingreso TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'en_cartera' CHECK (estado IN ('en_cartera', 'entregado')),
  entregado_a TEXT,
  fecha_entrega TEXT,
  pago_proveedor_id INTEGER
);

-- Proveedores de mercadería. Saldo = saldo_inicial + compras - pagos (positivo = se le debe).
CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  telefono TEXT,
  nota TEXT,
  saldo_inicial REAL NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1
);

-- Tipos de producto (vaca, cerdo, pollo…) que se ofrecen al cargar compras: una lista propia que se edita.
CREATE TABLE IF NOT EXISTS tipos_producto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  orden INTEGER NOT NULL DEFAULT 0
);

-- Tipos de carne (vaca, cerdo, pollo…) para el "Tipo de carne" de un producto, en Productos → Editar. Lista
-- propia y chica, separada de `tipos_producto` (que es para anotar cualquier compra en Proveedores, no solo
-- carne): así el selector de Productos no se llena de cosas como Huevo o Insumos. El cruce de Rendimiento
-- compara por el *nombre* (no hay relación entre las dos tablas), así que para que un tipo se cruce con lo
-- comprado tiene que llamarse igual en las dos listas.
CREATE TABLE IF NOT EXISTS tipos_carne (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  orden INTEGER NOT NULL DEFAULT 0
);

-- Qué carnes lleva cada pila de stock y en qué proporción (Vaca 70 %, Cerdo 30 %): reparto de la parte de carne
-- (`articulos_stock.porcentaje_carne`), por eso suma 100. `articulos_stock.tipo` queda como la carne principal
-- (la de mayor porcentaje) para lo que lea un solo tipo. Sin filas = sin tipo elegido.
CREATE TABLE IF NOT EXISTS articulo_carnes (
  articulo_id INTEGER NOT NULL REFERENCES articulos_stock(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL COLLATE NOCASE,
  porcentaje REAL NOT NULL,
  PRIMARY KEY (articulo_id, tipo)
);

-- Lo que vende cada proveedor: son las opciones al cargar una compra. `producto` sale de la lista fija
-- `tipos_producto` (Vaca, Cerdo, Pollo… o lo que se agregue) y es obligatorio: alcanza solo para identificar
-- la compra. `descripcion` es texto libre y opcional, para cuando hace falta distinguir dos cosas del mismo
-- producto (ej: producto "Pollo", descripción "pata muslo"). `unidad` (kg o unidad) es cómo se compra, ej:
-- la carne por kg, los huevos por unidad.
CREATE TABLE IF NOT EXISTS proveedor_productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  producto TEXT NOT NULL COLLATE NOCASE,
  descripcion TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  unidad TEXT NOT NULL DEFAULT 'kg' CHECK (unidad IN ('kg', 'unidad')),
  UNIQUE(proveedor_id, producto, descripcion)
);

CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  fecha TEXT NOT NULL,
  total REAL NOT NULL,
  nota TEXT,
  creado TEXT
);

-- Una línea por producto comprado. `producto` (de la lista `tipos_producto`) se guarda para calcular el
-- rinde más adelante; `descripcion` es el texto libre opcional. `kilos` y `precio_kg` son cantidad y precio
-- por unidad de medida en general; `unidad` dice si es kg o unidad, ej: la carne por kg, los huevos por unidad.
CREATE TABLE IF NOT EXISTS compra_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compra_id INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  producto TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  unidad TEXT NOT NULL DEFAULT 'kg' CHECK (unidad IN ('kg', 'unidad')),
  kilos REAL,
  precio_kg REAL,
  importe REAL NOT NULL
);

-- Un pago a un proveedor: efectivo + transferencia + cheques de la cartera (cheques.pago_proveedor_id).
CREATE TABLE IF NOT EXISTS pagos_proveedor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  fecha TEXT NOT NULL,
  efectivo REAL NOT NULL DEFAULT 0,
  transferencia REAL NOT NULL DEFAULT 0,
  nota TEXT,
  creado TEXT
);

-- Una devolución de mercadería a un proveedor (por ejemplo, carne en mal estado): resta de lo que se le debe por el monto
-- devuelto. `kilos` y `producto` (opcionales) descuentan lo comprado en Stock y Estadísticas. Si el proveedor devolvió la plata
-- en vez de dejarla a favor, `reembolso_cuenta` dice dónde entró (Efectivo o una cuenta); si no, queda NULL.
CREATE TABLE IF NOT EXISTS devoluciones_proveedor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  fecha TEXT NOT NULL,
  compra_id INTEGER,
  producto TEXT NOT NULL DEFAULT '',
  descripcion TEXT NOT NULL DEFAULT '',
  unidad TEXT NOT NULL DEFAULT 'kg' CHECK (unidad IN ('kg', 'unidad')),
  kilos REAL,
  monto REAL NOT NULL,
  reembolso_cuenta TEXT,
  nota TEXT,
  creado TEXT
);
CREATE INDEX IF NOT EXISTS idx_devoluciones_proveedor ON devoluciones_proveedor(proveedor_id);

-- De qué cuenta salió la parte transferida de un pago a proveedor (puede ser de más de una).
CREATE TABLE IF NOT EXISTS pagos_proveedor_cuentas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pago_proveedor_id INTEGER NOT NULL REFERENCES pagos_proveedor(id) ON DELETE CASCADE,
  cuenta TEXT,
  monto REAL NOT NULL
);

-- (Los productos y métodos de pago iniciales de una base nueva se cargan una sola vez en database.js: acá no, porque
-- este archivo corre en cada arranque y volvería a crear lo que se renombró.)

-- Categorías de ingreso (Alquiler, Otros, ...) y sus descripciones sugeridas (ej: el inquilino), igual que
-- categorias_gasto/descripciones_gasto. Siempre son personales (los ingresos del negocio son los cobros a clientes).
CREATE TABLE IF NOT EXISTS categorias_ingreso (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS descripciones_ingreso (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL COLLATE NOCASE,
  -- Desde 2026-10-02 es una categoría de `categorias_gasto` de ámbito personal (una sola lista para ingresos y retiros).
  categoria_id INTEGER,
  orden INTEGER NOT NULL DEFAULT 0,
  UNIQUE (nombre, categoria_id)
);

-- Ingresos personales (por ejemplo alquileres que cobra el dueño): no son ventas del negocio. Si `cuenta` tiene un banco o
-- app, suman a esa cuenta de la Caja general; si está vacía, queda solo asentado (la plata no queda en la caja).
CREATE TABLE IF NOT EXISTS ingresos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  categoria_id INTEGER, -- de `categorias_gasto` (ámbito personal), igual que los retiros
  descripcion TEXT NOT NULL,
  monto REAL NOT NULL,
  cuenta TEXT,
  observacion TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Fondos personales (2026-10-02): la plata personal comparte las cuentas del negocio (el alquiler puede caer en
-- Mercado Pago), pero se lleva aparte. Cada cuenta tiene una parte del negocio y una personal; "Efectivo personal" es
-- un sobre propio que nunca toca el cajón. `retiros_personales` son las salidas (moto, arreglos de las casas) de una
-- cuenta personal; `pases_personales` mueven plata entre la parte del negocio y la personal; `fondos_ajustes` carga lo
-- que ya había (o corrige) en una cuenta personal.
CREATE TABLE IF NOT EXISTS retiros_personales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  categoria_id INTEGER NOT NULL REFERENCES categorias_gasto(id),
  descripcion TEXT NOT NULL,
  monto REAL NOT NULL,
  cuenta TEXT NOT NULL,
  observacion TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS pases_personales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  monto REAL NOT NULL,
  sentido TEXT NOT NULL CHECK (sentido IN ('a_personal', 'al_negocio')),
  cuenta_negocio TEXT NOT NULL,
  cuenta_personal TEXT NOT NULL,
  nota TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Dólares personales (2026-10-03): el ahorro en dólares del dueño, aparte del de la Caja. La cantidad vive en `configuracion`
-- (`fondos_dolares_usd`) y la cotización es la misma que la del negocio (`caja_cotizacion`). Cada compra sale de una cuenta
-- personal (no es ingreso ni gasto): `monto` son los pesos que costó.
CREATE TABLE IF NOT EXISTS compras_dolares_personales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  cuenta TEXT NOT NULL,
  usd REAL NOT NULL,
  cotizacion REAL NOT NULL,
  monto REAL NOT NULL,
  creado TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS fondos_ajustes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta TEXT NOT NULL,
  fecha TEXT NOT NULL,
  monto REAL NOT NULL,
  nota TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Orígenes de ingresos que se sacaron de las sugeridas (los ingresos ya cargados no se borran; reaparece si se vuelve a cargar).
CREATE TABLE IF NOT EXISTS ingresos_origenes_ocultos (
  nombre TEXT PRIMARY KEY
);

-- Operaciones de la Caja general que mueven plata entre cuentas: `pase` (depósito, retiro o pase de una cuenta a otra),
-- `dolares` (compra de dólares), `canje` (un cheque en cartera se canjea por plata de la caja, a su valor completo) e
-- `interes` (monto con signo: positivo entra, negativo sale). `cuenta` es la de origen (pase, dólares), la de destino
-- (canje) o la del interés; `cuenta_destino` solo en los pases. Ninguna cuenta como gasto ni como venta.
CREATE TABLE IF NOT EXISTS operaciones_caja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('pase', 'dolares', 'canje', 'interes', 'reintegro')),
  cuenta TEXT NOT NULL,
  cuenta_destino TEXT,
  monto REAL NOT NULL,
  usd REAL,
  cotizacion REAL,
  cheque_id INTEGER,
  nota TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Inflación de cada mes (porcentaje cargado a mano, para ver si los números le ganan a los precios).
CREATE TABLE IF NOT EXISTS inflacion (
  mes TEXT PRIMARY KEY,
  porcentaje REAL NOT NULL
);

-- Stock de lo que se vende. Cada producto apunta a un "artículo de stock" (se lleva en kilos) y sabe cuántos kilos pesa
-- por unidad de venta (`productos.articulo_stock_id`, `productos.kg_por_unidad`). Stock = movimientos (producción y
-- ajustes de conteo) − lo facturado desde `stock_desde` (las facturas descuentan solas; las anuladas no cuentan).
CREATE TABLE IF NOT EXISTS articulos_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS movimientos_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  articulo_id INTEGER NOT NULL REFERENCES articulos_stock(id),
  fecha TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('produccion', 'ajuste')),
  kilos REAL NOT NULL,
  nota TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Índices: aceleran las búsquedas por cliente, factura, fecha y estado. No cambian ningún dato; se crean solos al abrir
-- la app (IF NOT EXISTS) y se van manteniendo solos. Con muchos años de facturas la diferencia es enorme (la lista de
-- facturas pasó de decenas de segundos a una fracción de segundo con 30.000 facturas). Los de "substr(fecha, 1, 10)" son
-- para las búsquedas por día (`substr(fecha, 1, 10) = ?`), que con la hora guardada en la misma columna no usan un índice común.
CREATE INDEX IF NOT EXISTS idx_facturas_cliente ON facturas(cliente_id, estado);
CREATE INDEX IF NOT EXISTS idx_facturas_estado ON facturas(estado);
CREATE INDEX IF NOT EXISTS idx_facturas_dia ON facturas(substr(fecha, 1, 10));
CREATE INDEX IF NOT EXISTS idx_factura_items_factura ON factura_items(factura_id);
CREATE INDEX IF NOT EXISTS idx_factura_items_producto ON factura_items(producto_id);
CREATE INDEX IF NOT EXISTS idx_factura_bultos_item ON factura_bultos(factura_item_id);
CREATE INDEX IF NOT EXISTS idx_pagos_factura ON pagos(factura_id);
CREATE INDEX IF NOT EXISTS idx_pagos_dia ON pagos(substr(fecha, 1, 10));
CREATE INDEX IF NOT EXISTS idx_notas_credito_cliente ON notas_credito(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado, fecha);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedido_items_pedido ON pedido_items(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedido_items_producto ON pedido_items(producto_id);
CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos(fecha);
CREATE INDEX IF NOT EXISTS idx_gastos_categoria ON gastos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_cuotas_gasto_gasto ON cuotas_gasto(gasto_id);
CREATE INDEX IF NOT EXISTS idx_cheques_estado ON cheques(estado);
CREATE INDEX IF NOT EXISTS idx_compras_proveedor ON compras(proveedor_id, fecha);
CREATE INDEX IF NOT EXISTS idx_compra_items_compra ON compra_items(compra_id);
CREATE INDEX IF NOT EXISTS idx_pagos_proveedor_proveedor ON pagos_proveedor(proveedor_id, fecha);
CREATE INDEX IF NOT EXISTS idx_pagos_proveedor_cuentas_pago ON pagos_proveedor_cuentas(pago_proveedor_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_stock_articulo ON movimientos_stock(articulo_id);
CREATE INDEX IF NOT EXISTS idx_conteos_insumo_insumo ON conteos_insumo(insumo_id, fecha);
CREATE INDEX IF NOT EXISTS idx_ingresos_fecha ON ingresos(fecha);
CREATE INDEX IF NOT EXISTS idx_operaciones_caja_fecha ON operaciones_caja(fecha);
CREATE INDEX IF NOT EXISTS idx_cuentas_ajustes_fecha ON cuentas_ajustes(fecha);
