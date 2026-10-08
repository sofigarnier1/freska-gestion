// Copias de seguridad y Manual de uso.
// (Antes todo estaba en renderer.js; se dividió por pantalla el 2026-09-24. Los archivos son scripts comunes que
// comparten el mismo espacio global: se cargan en el orden de index.html y no hace falta importar nada.)

function pedirConfirmacionRestaurar({ descripcion, restaurar }) {
  mostrarModal(`${modalXHtml('modal-cancelar')}
    <h3>Restaurar copia</h3>
    <p>Vas a volver a como estaba todo en <strong>${esc(descripcion)}</strong>. <strong>Todo lo que cargaste después de eso se pierde</strong> (facturas, cobros, clientes nuevos...).</p>
    <p>Antes de reemplazar, la app guarda una copia de lo que hay ahora, por si te arrepentís. Después se reinicia sola.</p>
    <div class="btn-group">
      <button type="button" id="modal-confirmar" class="primary" data-destructivo="true">Sí, restaurar</button>
    </div>
  `);
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('modal-confirmar').addEventListener('click', async () => {
    const boton = document.getElementById('modal-confirmar');
    boton.disabled = true;
    boton.textContent = 'Restaurando...';
    const resultado = await restaurar();
    if (resultado.ok === false) {
      cerrarModal();
      if (!resultado.cancelado) mostrarToast(resultado.error || 'No se pudo restaurar la copia.', 'error');
      return;
    }
    cerrarModal();
    mostrarToast('Restaurando... la app se va a reiniciar sola.', 'ok');
  });
}

async function renderCopias() {
  const { copias, ultimaManual, carpeta } = await window.freska.sistema.listarCopias();
  const externa = await window.freska.sistema.copiaExternaEstado();

  // Cuándo salió la última copia externa: "hoy a las 14:32", "ayer", "hace 3 días".
  const cuandoExterna = (iso) => {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    const diaDeLaCopia = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const dias = Math.round((new Date(`${fechaHoyISO()}T00:00:00`) - new Date(`${diaDeLaCopia}T00:00:00`)) / 86400000);
    const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return dias <= 0 ? `hoy a las ${hora}` : dias === 1 ? `ayer a las ${hora}` : `hace ${dias} días`;
  };
  const bloqueExterna = !externa.carpeta
    ? `<p class="error-msg">Todavía no hay una carpeta elegida: las copias solo están en esta computadora.</p>
       <button id="btn-elegir-carpeta-externa" class="primary" type="button">Elegir carpeta...</button>`
    : `<p>Carpeta: <strong>${esc(externa.carpeta)}</strong></p>
       ${
         externa.error
           ? `<p class="error-msg">${esc(externa.error)}</p>`
           : ''
       }
       ${
         externa.ultima
           ? `<p class="${externa.error ? 'error-msg' : ''}">Última copia: <strong>${cuandoExterna(externa.ultima)}</strong>.</p>`
           : `<p class="error-msg">Todavía no se pudo hacer ninguna copia.</p>`
       }
       <div class="acciones-panel">
         <button id="btn-copia-externa-ahora" type="button">Copiar ahora</button>
         <button id="btn-elegir-carpeta-externa" type="button">Cambiar carpeta</button>
         <button id="btn-quitar-copia-externa" class="enlace-boton enlace-peligro" type="button">Dejar de usar</button>
       </div>`;

  let estadoManual;
  if (externa.carpeta || !ultimaManual) {
    estadoManual = '';
  } else {
    const dias = Math.floor((new Date(fechaHoyISO()) - new Date(ultimaManual)) / 86400000);
    const hace = dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} días`;
    const claseAviso = dias > 14 ? 'error-msg' : '';
    estadoManual = `<p class="${claseAviso}">Última copia guardada: <strong>${hace}</strong> (${fechaLegible(ultimaManual + 'T12:00:00')}).${dias > 14 ? ' Ya pasó bastante: conviene guardar otra.' : ''}</p>`;
  }

  app.innerHTML = `
    <button id="btn-volver-menu" class="btn-volver" type="button">&larr; Volver</button>
    <h2>Copias de seguridad</h2>
    <p class="pin-subtitulo" style="margin-bottom:20px;">
      Todo lo que cargás (clientes, facturas, cobros...) está guardado en un solo archivo dentro de esta computadora.
      Una copia de seguridad es un duplicado de ese archivo, para poder volver atrás si algo sale mal.
    </p>

    <div class="panel">
      <h3>Copia automática fuera de la computadora</h3>
      <p>Elegí una carpeta de Google Drive (o un pendrive) y la app guarda ahí una copia sola: al abrirla, cada 30 minutos y al cerrarla. Se queda con las últimas ${externa.cantidad}. Si la computadora se rompe o se la llevan, <strong>esta es la copia que te salva</strong>.</p>
      ${bloqueExterna}
    </div>

    <div class="panel">
      <h3>Guardar una copia a mano</h3>
      <p>Para llevarte una copia cuando quieras, por ejemplo en un pendrive.</p>
      ${estadoManual}
      <button id="btn-copia-manual" type="button">Guardar una copia ahora</button>
    </div>

    <div class="panel">
      <h3>Copias automáticas</h3>
      <p>La app hace sola una copia por día, la primera vez que la abrís, y se queda con las últimas 30. Te sirven si te equivocás cargando algo o si una actualización sale mal. Si vas a restaurar una, elegí la del día anterior al problema.</p>
      ${
        copias.length === 0
          ? '<p>Todavía no hay copias automáticas. La primera se hace mañana, cuando abras la app.</p>'
          : `<table class="angosto">
          <thead><tr><th>Copia</th><th>Tamaño</th><th></th></tr></thead>
          <tbody>
            ${copias
              .map(
                (c) => `
            <tr>
              <td>${c.tipo === 'previa' ? `Antes de restaurar (${fechaLegible(c.fecha)})` : `Del ${fechaLegible(c.fecha)}`}</td>
              <td>${tamanoLegible(c.tamano)}</td>
              <td class="acciones-cliente"><button type="button" class="restaurar-copia" data-nombre="${esc(c.nombre)}" data-descripcion="${c.tipo === 'previa' ? `la copia de antes de restaurar del ${fechaLegible(c.fecha)}` : `el ${fechaLegible(c.fecha)}`}">Restaurar</button></td>
            </tr>`
              )
              .join('')}
          </tbody>
        </table>`
      }
      <p style="margin-top:14px;"><button id="btn-abrir-carpeta-copias" type="button">Abrir la carpeta de copias</button></p>
      <p class="pin-subtitulo" style="margin:0;">Carpeta: ${esc(carpeta)}</p>
    </div>

    <div class="panel">
      <h3>Restaurar desde un archivo</h3>
      <p>Si tenés una copia guardada en un pendrive o en Drive, elegila desde acá para volver a ese momento.</p>
      <button id="btn-restaurar-archivo" type="button">Elegir un archivo...</button>
    </div>
  `;

  document.getElementById('btn-volver-menu').addEventListener('click', () => {
    renderFacturas();
  });

  const btnElegirExterna = document.getElementById('btn-elegir-carpeta-externa');
  if (btnElegirExterna) {
    btnElegirExterna.addEventListener('click', async () => {
      const res = await window.freska.sistema.elegirCarpetaCopiaExterna();
      if (res.cancelado) return;
      if (!res.ok) {
        mostrarToast(res.error || 'No se pudo elegir esa carpeta.', 'error');
        return;
      }
      mostrarToast(res.copia && res.copia.ok ? 'Carpeta elegida. La primera copia ya está hecha.' : 'Carpeta elegida, pero la copia no se pudo hacer todavía.', res.copia && res.copia.ok ? 'ok' : 'error');
      renderCopias();
    });
  }
  const btnCopiaAhora = document.getElementById('btn-copia-externa-ahora');
  if (btnCopiaAhora) {
    btnCopiaAhora.addEventListener('click', async () => {
      btnCopiaAhora.disabled = true;
      const res = await window.freska.sistema.copiaExternaAhora();
      mostrarToast(res.ok ? 'Copia hecha.' : res.error || 'No se pudo hacer la copia.', res.ok ? 'ok' : 'error');
      renderCopias();
    });
  }
  const btnQuitarExterna = document.getElementById('btn-quitar-copia-externa');
  if (btnQuitarExterna) {
    btnQuitarExterna.addEventListener('click', async () => {
      await window.freska.sistema.quitarCopiaExterna();
      mostrarToast('Se dejó de hacer la copia automática. Los archivos que ya estaban en la carpeta no se borran.', 'ok');
      renderCopias();
    });
  }

  document.getElementById('btn-copia-manual').addEventListener('click', async () => {
    const resultado = await window.freska.sistema.hacerBackup();
    if (resultado.cancelado) return;
    if (resultado.ok) {
      mostrarToast('Copia de seguridad guardada correctamente.', 'ok');
      renderCopias();
    } else {
      mostrarToast(resultado.error || 'No se pudo hacer la copia de seguridad.', 'error');
    }
  });

  document.getElementById('btn-abrir-carpeta-copias').addEventListener('click', () => {
    window.freska.sistema.abrirCarpetaCopias();
  });

  app.querySelectorAll('.restaurar-copia').forEach((btn) => {
    btn.addEventListener('click', () => {
      pedirConfirmacionRestaurar({
        descripcion: btn.dataset.descripcion,
        restaurar: () => window.freska.sistema.restaurarCopia(btn.dataset.nombre),
      });
    });
  });

  document.getElementById('btn-restaurar-archivo').addEventListener('click', () => {
    pedirConfirmacionRestaurar({
      descripcion: 'la copia que elijas a continuación',
      restaurar: () => window.freska.sistema.restaurarDesdeArchivo(),
    });
  });
}

function renderManual() {
  app.innerHTML = `
    <button id="btn-volver-menu" class="btn-volver" type="button">&larr; Volver</button>
    <h2>Manual de uso</h2>
    <p class="pin-subtitulo" style="margin-bottom:20px;">
      Guía rápida de todo lo que hace FRESKA. Tocá un tema para ir directo, o simplemente andá bajando.
    </p>

    <nav class="manual-indice">
      <a href="#m-entrar">Entrar a la app</a>
      <a href="#m-usuarios">Usuarios (administrador y empleados)</a>
      <a href="#m-pedidos">Pedidos</a>
      <a href="#m-facturas">Facturas</a>
      <a href="#m-cobros">Cobros</a>
      <a href="#m-gastos">Gastos</a>
      <a href="#m-cierre">Caja</a>
      <a href="#m-cheques">Cheques</a>
      <a href="#m-ingresos">Fondos personales</a>
      <a href="#m-clientes">Clientes</a>
      <a href="#m-proveedores">Proveedores</a>
      <a href="#m-productos">Productos</a>
      <a href="#m-stock">Stock</a>
      <a href="#m-estadisticas">Estadísticas</a>
      <a href="#m-buscador">Buscador (la lupa)</a>
      <a href="#m-avisos">Avisos (la campanita)</a>
      <a href="#m-menu">Menú y ajustes</a>
      <a href="#m-copias">Copias de seguridad</a>
      <a href="#m-consejos">Consejos y dudas</a>
      <span class="manual-salto"></span>
      <div class="manual-buscar">
      <span class="buscador-lupa">${typeof ICONO_LUPA === 'string' ? ICONO_LUPA : ''}</span>
      <input type="text" id="manual-buscar" placeholder="Buscar en el manual…" autocomplete="off" aria-label="Buscar en el manual" />
      <span id="manual-buscar-cuenta" class="manual-buscar-cuenta"></span>
    </div>
    </nav>



    <div class="manual-contenido">

      <section id="m-entrar">
        <h3>Entrar a la app</h3>
        <p>FRESKA se protege con una contraseña para que nadie más pueda ver o tocar las facturas.</p>

        <p><strong>La primera vez: crear tu contraseña</strong></p>
        <ol>
          <li>Cuando abrís FRESKA por primera vez, te va a pedir tu nombre y una contraseña de al menos 4 caracteres.</li>
          <li>Escribila y volvé a escribirla en <em>Confirmar contraseña</em> para estar seguros de que no te equivocaste.</li>
          <li>Apretá <em>Crear contraseña</em>. Ya quedaste adentro, con tu nombre cargado como el administrador.</li>
        </ol>

        <p><strong>Las próximas veces: ingresar</strong></p>
        <ol>
          <li>Escribí tu contraseña.</li>
          <li>Apretá <em>Ingresar</em>.</li>
        </ol>
        <p>Si te equivocás varias veces seguidas, FRESKA te pide esperar un rato antes de volver a intentar (30 segundos, y más si seguís errando): es una protección para que nadie pueda probar contraseñas sin parar. Cuando la ponés bien, todo vuelve a la normalidad.</p>
        <p>Si hay más de una persona cargada (ver "Usuarios" más abajo), antes de pedir la contraseña te pregunta quién sos. Recuerda a la última persona que entró, para no tener que elegir siempre; si sos otro, apretá <em>¿No sos vos?</em>.</p>

        <div class="manual-tip">
          <strong>El ojito</strong>
          Si querés ver lo que escribiste en vez de los puntitos, apretá el ojo que está al lado del casillero.
        </div>
        <div class="manual-tip">
          <strong>Se bloquea sola</strong>
          Si pasan 20 minutos sin que toques nada, FRESKA se bloquea y vuelve a pedir la contraseña, para que nadie use la app si te alejás de la computadora. Lo que tenías cargado en pantalla sigue ahí cuando volvés a entrar. También podés bloquearla vos cuando quieras con <em>Menú → Cerrar sesión</em>.
        </div>
        <div class="manual-tip">
          <strong>Cómo moverte por la app</strong>
          A la izquierda está el menú, con 5 grupos: <em>Ventas</em>, <em>Dinero</em>, <em>Clientes y proveedores</em>, <em>Productos y stock</em> y <em>Estadísticas</em>. Al apretar uno se despliegan sus páginas (por ejemplo, <em>Dinero</em> tiene Cobros, Gastos y Caja). FRESKA se acuerda en cuál te quedaste de cada grupo, así que si volvés a <em>Ventas</em> después de estar en <em>Dinero</em>, te lleva de nuevo a la página que tenías abierta; además, abrir un grupo nuevo no cierra el anterior, así podés tener varios desplegados a la vez (tocar de nuevo el título de un grupo abierto lo cierra). El botón <em>☰</em> (arriba a la izquierda, o el atajo Ctrl/Cmd + B) achica el menú a solo iconos para tener más lugar; clickeando un ícono con varias páginas se abre un menú cortito al lado para elegir cuál, sin agrandar todo de nuevo.
        </div>
      </section>

      <section id="m-pedidos">
        <h3>Pedidos</h3>
        <p>Para anotar lo que te piden por WhatsApp sin tener que usar el cuaderno, y facturarlo después sin cargarlo de nuevo.</p>
        <p><strong>Anotar un pedido nuevo</strong></p>
        <ol>
          <li>Si no ves el formulario de carga, apretá el título ("Nuevo pedido") para desplegarlo — apretalo de nuevo para ocultarlo cuando no lo estés usando.</li>
          <li>Elegí el cliente.</li>
          <li>Elegí el producto, poné la cantidad y apretá el <em>+</em> (o Enter). No hace falta poner precio todavía.</li>
          <li>Repetí por cada producto que pidió. Si te equivocaste, apretá el <em>−</em> rojo de esa línea para sacarla.</li>
          <li>Apretá <em>Guardar pedido</em>.</li>
        </ol>
        <p>Si te equivocaste y querés empezar de cero, apretá <em>Limpiar pedido</em>: descarta todo lo cargado (si ya agregaste productos, antes te pide confirmación).</p>
        <p><strong>Pedidos de hoy</strong></p>
        <p>Arriba de todo está la tabla <em>Pedidos de hoy</em>, con una fila por producto: lo que <strong>pidieron</strong>, cada <strong>bolsa o caja</strong> ya facturada con su peso (por ejemplo <em>2,13 kg</em> y <em>2,00 kg</em>) y cuántos <strong>bultos</strong> son. Sirve para saber cuánto se pidió y para controlar que estén todas las bolsas y cajas antes de cargar la camioneta. Si pasás el mouse por una bolsa, ves de qué cliente y factura es. Con la flecha <em>▾</em> del título la escondés, y con el ícono de la impresora <em>🖨️</em> (arriba a la derecha del cuadro) se abre la <em>lista de carga</em>: lo mismo por producto, más lo que se pidió y todavía no se facturó (aviso naranja <em>Todavía sin facturar</em>: es lo pedido, no el peso final). Con <em>Imprimir</em> sacás la lista en papel, con un cuadradito para tildar a mano.</p>

        <p><strong>Corregir o borrar un pedido</strong></p>
        <p>Apretá los tres puntitos (⋮) al final de la fila. <em>Editar</em> te deja cambiar el pedido; <em>Eliminar</em> lo borra (te pide confirmación).</p>

        <p><strong>Facturar un pedido</strong></p>
        <p>También podés hacerlo desde <em>Facturas</em>: arriba, al lado de <em>Nueva factura</em>, el botón <em>Pedidos pendientes</em> (con la cantidad) abre la lista de los pedidos que todavía no se facturaron (los <em>programados</em> para otro día no aparecen hasta su día). Elegí uno con <em>Facturar</em> y se cargan el cliente y sus productos; si ya tenías una factura empezada, te pregunta antes de reemplazarla.</p>
        <p>Cuando lo tengas listo para entregar, apretá <em>Facturar</em> en su fila. Te lleva a Nueva factura con el cliente y los productos ya cargados — solo confirmás el precio y guardás como siempre.</p>
        <p><strong>Pendientes y Todos</strong></p>
        <p><em>Pendientes</em> muestra solo lo que todavía falta facturar. <em>Todos</em> te deja elegir una fecha para repasar los pedidos de ese día, ya facturados o no — como hojear el cuaderno hacia atrás. Si al entrar no hay ningún pedido pendiente pero sí pedidos de hoy, se abre directo en <em>Todos</em>; si no hay ninguno, dice <em>No hay pedidos</em>.</p>
        <p><strong>Pedidos programados.</strong> Si te piden algo para otro día (hoy lo anotás y es para el viernes), en <em>Nuevo pedido</em> cambiá la <em>Fecha</em> (arriba de todo; arranca en hoy) por ese día con el calendario; al guardar, un cartelito dice "Pedido programado para el…". Hasta ese día el pedido queda aparte, en la pastilla <em>Programados</em> (ordenados por fecha, con el día en cada fila y la cantidad entre paréntesis): no figura en <em>Pedidos de hoy</em>, ni en la lista de carga, ni en <em>Pendientes</em>, ni cuenta como stock pedido. Cuando llega el día, <strong>aparece solo</strong> en <em>Pendientes</em> y en <em>Pedidos de hoy</em>, como cualquier pedido del día. Se puede editar (también cambiarle el día, o dejar el casillero vacío para que sea de hoy), eliminar o facturar antes de tiempo. La campanita avisa un día antes (<em>Pedidos programados para mañana</em>, se puede apagar en sus opciones). En las Estadísticas, lo pedido cuenta el día para el que era.

        <p><strong>Mandar una consulta por WhatsApp</strong></p>
        <p>Para preguntarle a varios clientes de una qué necesitan, sin escribirle a cada uno a mano:</p>
        <ol>
          <li>Apretá <em>Enviar consulta</em>, arriba de la lista.</li>
          <li>Tildá a quién le querés escribir (o <em>Seleccionar todos</em>). La pestaña <em>Recientes</em> muestra solo a quien ya le mandaste antes.</li>
          <li>Elegí el mensaje: hoy, mañana, o uno escrito por vos.</li>
          <li>Apretá <em>Enviar consulta</em>. Se va abriendo WhatsApp cliente por cliente, ya con el mensaje y el nombre puestos — solo tenés que apretar enviar y volver a FRESKA para el siguiente.</li>
        </ol>
              <p><strong>Pedir por unidad.</strong> Un producto que se vende por kilo pero te piden en unidades (por ejemplo el <em>chorizo seco</em>: "5 chorizos") muestra, en la cantidad, un desplegable <em>kg / u.</em>. De entrada viene en <em>u.</em> (o en lo último que se pidió de ese producto): cargás las unidades y listo. En <em>Pedidos de hoy</em> la columna <em>Pidieron</em> muestra las unidades (y los kilos, si también pidieron en kilos). Al facturar el pedido, la línea llega <strong>sin kilos</strong>, con las unidades que pidieron a la derecha del producto: la pesás y cargás los kilos, y la factura sale en kilos como siempre. <strong>No se puede guardar la factura sin pesar</strong>: avisa <em>Falta pesar</em>. En la factura del cliente (en pantalla, impresa y por WhatsApp) el producto lleva entre paréntesis lo que pidieron, por ejemplo <em>Chorizos secos (5 u.)</em>. El pedido sigue diciendo <em>5 u.</em> aunque ya esté facturado, y el stock sigue en kilos: lo pedido por unidad cuenta como pendiente por el peso aproximado del producto (si no tiene, no cuenta) y se descuenta recién al facturar.</p>
      </section>

      <section id="m-facturas">
        <h3>Facturas</h3>
        <p>Acá cargás cada venta: quién compró, qué se llevó y si ya pagó. Es la pantalla que se abre apenas entrás a FRESKA. La lista de abajo muestra las facturas de <strong>hoy</strong> por default; cambiá la fecha para ver otro día, o escribí en el buscador para encontrar una por N° o por cliente sin importar el día (arriba aparece la que más se parece a lo que escribiste: si buscás el 3, primero la N° 3, después la 30, la 31…). Con <em>Filtros → Ver → Anuladas</em> ves todas las facturas anuladas, sin importar la fecha. Al apretar una factura se despliega lo que se llevó, en columnas: cantidad, producto, precio por kilo (o por unidad) e importe. Cuando estás mirando las facturas de hoy aparecen también <em>Ver recorrido de hoy</em> y el ícono 🖨️, debajo de la lista.</p>

        <p><strong>Cargar una factura nueva</strong></p>
        <ol>
          <li>Si no ves el formulario de carga, apretá el título ("Nueva factura") para desplegarlo — apretalo de nuevo para ocultarlo cuando no lo estés usando.</li>
          <li>En <em>Nombre del cliente...</em> escribí las primeras letras y elegí de la lista que aparece. Si es un cliente nuevo, primero cargalo en Clientes. Para quien compra una sola vez y no querés anotarlo, usá el cliente "Consumidor Final".</li>
          <li>Elegí si le cobrás <em>Precio Cliente</em> (el habitual) o <em>Precio Consumidor Final</em>.</li>
          <li>Elegí el producto de la lista, o si lo tiene cargado, escribí su <em>Código</em> y apretá Enter — salta directo a ese producto sin tener que buscarlo.</li>
          <li>Poné el peso o la cantidad, y apretá el <em>+</em> (o Enter). El precio se completa solo con el de la lista, pero lo podés cambiar a mano si le hacés un descuento puntual a ese cliente.</li>
          <li>Repetí el paso anterior por cada producto que se lleve. Si te equivocaste en alguno, apretá el <em>−</em> rojo al final de su línea y se saca (podés cambiar la cantidad directo en la línea).</li>
          <li>Cuando esté todo cargado, apretá <em>Guardar factura</em>.</li>
        </ol>

        <p><strong>Registrar un pago de esa factura puntual</strong></p>
        <ol>
          <li>En la fila de esa factura, apretá el ícono "$".</li>
          <li>Ya te aparece cargado lo que falta pagar. Si paga solo una parte, cambiá ese número.</li>
          <li>Elegí el método de pago y apretá <em>Confirmar</em>. Si te paga con cheque, elegí el método <em>Cheque</em> y completá banco, número y fecha de cobro (queda en <em>Dinero → Cheques</em>). Si te paga parte en efectivo y parte por transferencia, apretá el <em>+</em> que está debajo de las líneas para sumar otra (cada línea tiene un <em>−</em> para sacarla). Cuando hay dos líneas, lo que escribís en una completa la otra con lo que falta (por ejemplo, ponés $50.000 en efectivo y la otra línea queda con el resto).</li>
        </ol>
        <p>La factura pasa a decir <em>Pagada</em> si se saldó todo, o <em>Parcial</em> si todavía queda un resto pendiente.</p>

        <div class="manual-tip">
          <strong>Si te va entregando plata de a poco, contra varias facturas juntas</strong>
          No hace falta elegir una factura puntual. Andá a la pestaña <em>Cobros</em> (solo aparecen ahí los clientes que te deben algo). Ahí cargás el monto total que te dio y el sistema solo lo va aplicando a lo más antiguo primero (el saldo inicial, si tiene, y después las facturas, de la más vieja a la más nueva), hasta que se termine la plata.
        </div>

        <p><strong>Mandar la factura por WhatsApp</strong></p>
        <p>Apretá el ícono verde de la fila. Se abre WhatsApp con el detalle de la compra ya escrito — revisalo y apretá enviar ahí adentro. Si el cliente tiene cargado un <em>Segundo WhatsApp</em> (ver Clientes), antes te pregunta a cuál de los dos se lo mandás, o si se lo mandás a los dos.</p>

        <p><strong>Ver qué se llevó en una factura</strong></p>
        <p>Apretá sobre la fila (la flechita indica que se despliega): aparece el detalle debajo. Apretala de nuevo para ocultarlo.</p>

        <p><strong>Editar o anular una factura</strong></p>
        <p>Apretá los tres puntitos (⋮) al final de la fila. <em>Editar</em> solo se puede el mismo día que se cargó (aunque ya se haya cobrado algo) y sirve para corregir un error. <em>Anular</em> es para cuando la venta no va más — se puede cualquier día, y queda tachada en vez de borrarse.</p>
        <p>Al abrir una factura (tocándola) se ve debajo <em>Pagó con</em>: con qué se cobró. Si se cargó mal, <em>Cambiar</em> deja elegir el método correcto, y <em>Anular cobro</em> (en rojo) deshace ese cobro: la factura vuelve a quedar con deuda, el saldo del cliente sube lo mismo y la plata sale de la cuenta donde había entrado (y su retención, si la hubo). Lo mismo se hace en la ficha del cliente, al abrir un cobro del historial. No se anulan los cobros con cheque ni con saldo a favor. Ahí mismo está el botón <em>Anular factura</em>, igual que en el menú ⋮.</p>
        <p><strong>Anular una factura que ya tenía pagos</strong></p>
        <p>Si la factura ya se había cobrado (del todo o en parte), al anularla la app te pregunta qué hacer con esa plata. <em>Dejarla como saldo a favor</em> (lo normal, viene marcado): el cliente queda con saldo a favor, que se descuenta solo de sus próximas facturas; la plata que entró sigue contando en la caja, porque la tenés. <em>Devolver la plata</em>: elegí con qué (efectivo, transferencia…) y cuánto (por defecto todo); ese importe sale de la caja del día y de las estadísticas. Lo que se pagó con cheque no se devuelve en plata: queda como saldo a favor. En la ficha del cliente aparece una <em>Nota de crédito</em> y su saldo dice <em>A favor</em>.</p>

        <div class="manual-tip alerta">
          <strong>Una factura anulada no se puede recuperar</strong>
          Fijate bien antes de confirmar. El historial de pagos que ya tenía se mantiene igual, por las dudas.
        </div>

        <p><strong>Imprimir para repartir</strong></p>
        <p>Apretá el ícono 🖨️ (al lado del buscador, solo aparece si estás mirando las facturas de hoy) y elegí una de las dos opciones:</p>
        <ul>
          <li><em>Imprimir facturas de hoy</em>: tildá cuáles imprimir y te arma una hoja con una factura por cliente, lista para cortar y entregar en mano: arriba el cliente, el número y la fecha; después una línea por producto con la cantidad, lo que es, el precio por kilo (o por unidad) y el importe; y abajo, a la izquierda el saldo total que te debe (vacío si no debe nada) y a la derecha el total de esa factura.</li>
          <li><em>Imprimir hoja de reparto</em>: tildá a quién repartís hoy (sacá a quien pasa a buscar en persona) y te arma una planilla horizontal con una fila por cliente (si tiene más de una factura hoy, las junta), con el pedido, el total, el saldo y una columna en blanco por cada método de pago que elijas, para completar a mano mientras repartís.</li>
        </ul>
        <p><strong>Antes de imprimir podés ver cómo va a quedar.</strong> En "Imprimir facturas de hoy", cada factura tiene un botón <em>Ver</em> que despliega ahí mismo cómo va a salir en papel. En "Imprimir hoja de reparto" está <em>Ver vista previa</em>, que muestra la planilla completa y se va actualizando a medida que tildás o destildás clientes y métodos de pago.</p>
        <p>Al apretar <em>Imprimir</em> se abre el diálogo de impresión de tu computadora, que también muestra una vista previa. Si en vez de imprimir elegís guardar como PDF, el archivo se sugiere con el nombre <em>Facturacion</em> o <em>Reparto</em> más la fecha de hoy.</p>

        <p><strong>Ver el recorrido de reparto en el mapa</strong></p>
        <p>Debajo de la lista de hoy está <em>Ver recorrido de hoy</em>. Tildá a quién se le reparte (solo se pueden elegir los clientes que tienen el domicilio cargado) y apretá <em>Abrir recorrido</em>: la app ordena las paradas por cercanía, partiendo desde tu local, y abre Google Maps con todo el recorrido armado. Necesita internet y que esté cargada la <em>Dirección del local</em> (Menú → Dirección del local) <strong>con su ciudad y provincia</strong>: se suman a cada domicilio al buscarlo en el mapa, y si falta la ciudad el mapa puede ubicar otra calle. Para ubicar cada domicilio en el mapa, la app consulta la dirección en el servicio abierto OpenStreetMap, pero <strong>solo la primera vez</strong>: después se acuerda de esa ubicación y no la vuelve a consultar.</p>
      </section>

      <section id="m-cobros">
        <h3>Cobros</h3>
        <p><strong>Negocio.</strong> Cobros y Gastos están juntos en una sola entrada del menú, <em>Dinero → Negocio</em>: arriba tenés las pastillas <em>Cobros</em> y <em>Gastos</em> para pasar de una a otra, y debajo las de cada una. Acá arriba tenés dos vistas: <em>Pendientes</em> e <em>Historial de cobros</em>. Los <em>Cheques</em> y los <em>Fondos personales</em> tienen su propia entrada en el menú <em>Dinero</em>, con su sección en este manual.</p>
        <p><strong>Pendientes</strong></p>
        <p>Solo los clientes que te deben algo, ordenados de mayor a menor deuda, junto con el total pendiente de cobro. Es el lugar más rápido para cuando alguien te va a pagar y no querés meterte en su ficha.</p>
        <ol>
          <li>Buscalo por nombre si hace falta.</li>
          <li>Apretá <em>Cobrar</em> en su fila.</li>
          <li>Cargá el monto que te dio y el método de pago, y apretá <em>Confirmar</em>.</li>
        </ol>
        <p>Si te va entregando plata de a poco, no hace falta elegir una factura puntual: el sistema aplica el monto a lo más antiguo primero (el saldo inicial, si tiene, y después las facturas, de la más vieja a la más nueva), hasta que se termine la plata. Si te paga parte en efectivo y parte por transferencia, apretá el <em>+</em> que está debajo de las líneas antes de confirmar.</p>
        <p>Si antes de cobrarle querés repasar qué le facturaste, apretá sobre su nombre — te lleva a su historial con todo el detalle.</p>
        <p><strong>Historial de cobros</strong></p>
        <p>Para repasar cuánto cobraste ya, día por día o mes por mes (no cuánto facturaste — para eso andá a <em>Facturas</em>). Elegí <em>Por día</em> para un día puntual, o <em>Por mes</em> para ver los totales de cada mes. En <em>Por mes</em> podés limitar a un período: apretá el calendario, tocá el primer día y después el último (los días de en medio se pintan), o usá <em>Este mes</em> / <em>Mes pasado</em>; también podés escribir las fechas. Los totales suman solo los días que elegiste. Podés destildar los métodos de pago que no te interesan para que el total se recalcule sin ellos. En <em>Por día</em>, la última columna muestra cómo cerró la caja ese día, y tocando la fila se abre su <em>Cierre de caja</em>.</p>
        <p>En <em>Por día</em>, el <em>total</em> de cada día es un botón: al apretarlo se abre la lista de quién pagó ese día, como en el cuaderno. Cada cliente aparece una sola vez y, si pagó con más de un método (por ejemplo efectivo y transferencia), cada método va en su renglón debajo del nombre. Abajo está el total, que es el mismo de la tabla; incluye también lo que se cobró de un saldo anterior. Tocando el nombre abrís la ficha del cliente. (Tocar el resto de la fila te lleva al cierre de caja de ese día.)</p>
</section>

      <section id="m-gastos">
        <h3>Gastos</h3>
        <p>Para anotar lo que gastás en el negocio y no es mercadería: alquiler, servicios, insumos, mantenimiento, impuestos, sueldos, etc. (Lo que le comprás a los proveedores va en la sección <em>Proveedores</em>.) Arriba tenés dos vistas: <em>Gastos</em> y <em>Categorías</em>.</p>
        <p><strong>Cargar un gasto</strong></p>
        <ol>
          <li>Si no ves el formulario, apretá el título <em>Nuevo gasto</em> (la flechita) para desplegarlo, y de nuevo para esconderlo. <em>Limpiar</em>, al lado del <em>+</em>, lo deja vacío.</li>
          <li>La <em>Fecha</em> viene con la de hoy; cambiala si lo estás cargando de otro día.</li>
          <li>Elegí la <em>Categoría</em> (el desplegable tiene dos grupos: <em>Negocio</em> y <em>Personal</em>; un gasto personal que pagás con la plata del negocio, como la nafta o la comida, se carga acá con una categoría personal: sale de la caja del negocio pero queda marcado como <em>personal</em> y no cuenta en el resultado del negocio).</li>
          <li>Escribí la <em>Descripción</em> (por ejemplo "Camión combustible"). Al tocar el casillero (o al elegir una categoría) se abre, justo debajo, una lista con las descripciones sugeridas (también en Ingresos y Gastos de propiedades de Fondos personales; se mueve con ↑ ↓ y Enter, y se cierra con Esc): si elegiste una categoría, las de esa categoría (por ejemplo, en <em>Sueldos</em>, los nombres que ya cargaste); mientras escribís se buscan entre todas. Tocá una y se completan la descripción, su categoría, <strong>el monto de la última vez</strong> y con qué se pagó (Efectivo, o Transferencia / Débito con su cuenta; el crédito y el cheque no se copian): así, lo que se repite todos los meses (expensas, alquiler…) se carga con un toque y solo cambiás el monto si varió. Con Enter pasás al monto. Si te equivocaste al escribir, la <em>×</em> que aparece a la derecha del campo borra todo de una vez. Para lo que no está en la lista (por ejemplo, un gasto <em>Particular</em>), escribí vos de qué se trató: la próxima vez ya te aparece. <strong>Cada categoría tiene su propia lista</strong>: la misma descripción (por ejemplo "Obra social") puede estar en una del negocio y en una personal a la vez; en ese caso el botón dice en chiquito de qué categoría es, y trae el último monto de esa categoría.</li>
          <li>Poné el <em>Monto</em>.</li>
          <li>Elegí <em>Cómo pagó</em>: Efectivo, Transferencia, Débito, Crédito o Cheque. Con Efectivo no hace falta nada más (al lado ves cuánto hay en efectivo). Con Transferencia, Débito o Crédito aparece <em>Pagó con</em>: el banco o app (con Transferencia y Débito ves cuánto hay en esa cuenta). Con Débito o Crédito elegís también la <em>tarjeta</em> (las cargás en <em>Dinero → Caja</em>, con el ⋮ de cada banco o app → <em>Cambiar nombre y tarjetas</em>) y, en Crédito, en <em>cuántas cuotas</em> es; la lista muestra el valor de cada cuota. El crédito no descuenta de ninguna cuenta hasta que se paga cada cuota.</li>
          <li>Si querés dejar una nota (por ejemplo "cuota 3 de 6"), escribila en <em>Observación</em>; es opcional y se ve debajo de la descripción en la lista.</li>
          <li>Apretá el <em>+</em> (o Enter en el monto). El gasto queda en la lista de abajo y los campos se limpian para cargar el siguiente, con la misma fecha y forma de pago.</li>
        </ol>
        <p>Si pagaste con <em>cheque</em>, aparece un desplegable con los cheques que tenés en la <em>cartera</em> (banco, número, importe y fecha de cobro). Elegí el que entregaste: el monto se completa solo con el del cheque, y el cheque pasa a <em>Entregados</em> (a nombre de la descripción del gasto). Si quitás ese gasto, el cheque vuelve a la cartera. Si no tenés cheques en cartera, te avisa dónde cargarlos (Dinero → Cheques).</p>
        <p>Si pagaste en <em>efectivo</em>, ese gasto aparece solo en <em>Caja → Cierre del día</em>, en <em>Gastos en efectivo del día</em> (con su categoría), y se resta del efectivo. No hace falta cargarlo en el cierre: se carga solo acá. Con el botón <em>Filtros</em> de la lista podés ver solo una forma de pago (por ejemplo, los gastos en efectivo). Los gastos en <em>crédito</em> tienen un botón <em>Cuotas</em>: ahí marcás cada cuota que pagás, con la fecha y la cuenta de la que sale; recién entonces sale la plata de esa cuenta y cuenta en las estadísticas.</p>
        <p><strong>Ver lo que gastaste</strong></p>
        <p>Abajo está la lista, del más nuevo al más viejo, con el <strong>total</strong> a la derecha de la barra de arriba. Elegí el período en el calendario (tocá el primer día y el último, o <em>Este mes</em> / <em>Mes pasado</em>) y, si querés, buscá por descripción, categoría, cuenta o tarjeta. <em>Filtros</em> deja ver una sola forma de pago, y <em>Limpiar filtros</em> (dentro del panel) los saca todos. Si son muchos, se ven los últimos 30 y <em>Ver más antiguos</em> muestra el resto. Cuánto le pagaste a los proveedores y el desglose por categoría están en <em>Estadísticas</em>. Para <strong>corregir</strong> uno (fecha, categoría, descripción, monto o forma de pago), apretá el <em>⋮</em> de su fila y elegí <em>Editar</em>: sube al formulario, cambiás lo que haga falta y apretás <em>Guardar cambios</em> (o <em>Cancelar</em>; lo que estabas escribiendo para un gasto nuevo no se pierde). Si se pagó con un cheque de la cartera, la forma de pago y el monto no se cambian (son los del cheque); para eso quitá el gasto y cargalo de nuevo. Para sacar uno, el <em>⋮</em> de su fila → <em>Eliminar</em> (en rojo), y confirmá.</p>
        <p><strong>Descripciones sugeridas</strong></p>
        <p>Si alguna descripción ya no la querés ver, apretá la <em>×</em> que tiene al lado y confirmá. Los gastos ya cargados no se borran, y si volvés a usarla, reaparece.</p>
        <p><strong>Categorías</strong></p>
        <p>En la vista <em>Categorías</em> están las opciones para clasificar los gastos, en dos grupos: <em>Negocio</em> (alquiler, sueldos, insumos…) y <em>Personal</em>, cada uno con su <em>+</em>. El <em>+</em> al lado del título suma una categoría; para sacar una, el <em>tachito</em> (los gastos ya cargados con esa categoría se mantienen). Al tocar una categoría se despliegan sus <em>descripciones</em>: el <em>+</em> de al lado agrega una que te aparecerá como sugerida al elegir esa categoría (escribís y Enter); las que no querés, las sacás con la <em>×</em>. Lo que sacás del negocio para vivir (el supermercado, la nafta…) se carga acá con una categoría <em>Personal</em>. Lo de las casas que alquilás (los alquileres que cobrás y lo que gastás en ellas) no va acá: se carga en <em>Fondos personales</em>, que tiene sus propias categorías, separadas de estas.</p>
        <p>Si te vas a otra pantalla en medio de la carga, al volver sigue todo como lo dejaste (hasta cerrar la app).</p>
      </section>

      <section id="m-cierre">
        <h3>Caja</h3>
        <p>La pestaña <em>Caja</em> tiene tres partes, en este orden: <em>Cierre del día</em>, <em>Día a día</em> y <em>Caja general</em>.</p>

        <p><strong>Cierre del día</strong></p>
        <p>Es para saber, al final del día, si la plata es la que tiene que haber. Arriba está la fecha (hoy por defecto; podés elegir otro día para revisarlo) y, a la derecha, si el cierre ya está guardado y el botón <em>Imprimir / PDF</em>.</p>
        <ul>
          <li>Arriba, tres números: <em>Entró</em> (todo lo cobrado, en efectivo y por transferencia, más los otros ingresos que entraron a una cuenta), <em>Salió</em> (todo lo que se pagó: gastos de cualquier forma, cuotas de tarjeta y pagos a proveedores) y el <em>Resultado del día</em>.</li>
          <li><em>Cuentas del día</em>: una fila por forma de pago (Efectivo y cada banco o app) con lo que había al empezar, lo que entró, lo que salió y lo que tiene que quedar al cerrar, y el <em>Total</em>. En la fila de <em>Efectivo</em> está el <em>fondo inicial</em> (viene completado solo con lo que quedó el día anterior) y lo que <em>contaste</em> en el cajón. Si cambiás uno de los dos, se prende el <em>✓</em> verde de al lado: tocalo (o apretá Enter) para guardarlo; hasta entonces no cambia nada. <em>Dio justo</em> guarda como contado el efectivo esperado, de un toque. Abajo te dice si la caja cierra justo, sobran o faltan. El efectivo esperado ya descuenta los gastos y pagos a proveedores en efectivo, y los depósitos, retiros y cheques cambiados por efectivo. Tocá un banco o app para ver todos sus movimientos; si no coincide con el banco, corregilo con <em>Ajustar saldo</em> en la Caja general. Los bancos y apps aparecen cuando ya cargaste los saldos en la Caja general.</li>
          <li><em>Cobros del día</em> (por método de pago, con el total) y <em>Gastos del día</em> (todo lo que se pagó, con <em>Pagó con</em> y el total). Se cargan en <em>Cobros</em>, <em>Gastos</em> y <em>Proveedores</em>; acá solo se miran.</li>
          <li><em>Detalle de movimientos</em>: cada cobro y cada movimiento de los bancos y apps del día, con buscador y <em>Filtros</em> por cuenta.</li>
        </ul>
        <p>Con <em>Imprimir / PDF</em> sacás la hoja del cierre.</p>

        <p><strong>Día a día</strong></p>
        <p>Una tabla con <strong>todos los días del mes</strong> (hasta hoy): cobrado, pagado, fondo inicial, cobros y pagos en efectivo (gastos y proveedores), depósitos, retiros y cheques (solo si el mes tuvo alguno), lo esperado, lo contado y si cerró justo, sobran o faltan. Los días con movimiento que no cerraste dicen <em>Sin cerrar</em>. La primera fila, <em>Total del mes</em>, suma todo y muestra la diferencia acumulada de los cierres. Con las flechitas cambiás de mes (y de año con las dobles), y con el <strong>calendario</strong> elegís un día: la tabla salta a ese mes y lo marca. Tocá un día para abrir su cierre.</p>

        <p><strong>Caja general</strong></p>
        <p>Arriba muestra el <strong>dinero disponible</strong>: el efectivo, la plata de cada banco o app (cada método de pago es una cuenta), los dólares (con la cotización que cargues a mano) y los cheques en cartera. El monto arranca tapado (solo se ve el ojito) cada vez que entrás a esta pantalla; tocarlo lo muestra, con el número deslizándose al lado (no se acuerda de una entrada a otra, a propósito). La primera vez cargás cuánto hay en cada cuenta al comenzar un día; desde ahí cada cuenta se mueve sola con los cobros (según el método), los gastos, los pagos a proveedores y las operaciones. Tocá una cuenta para ver su detalle: la lista de movimientos con el saldo que fue quedando, que arranca (al final de la lista, lo más antiguo) con el <em>Saldo inicial</em> que cargaste; el <em>⋮</em> de la fila tiene <em>Ajustar saldo</em>, que deja el saldo como el que dice el banco (la diferencia queda anotada). Si se agrega un método de pago nuevo, aparece solo como cuenta; cargale el saldo con el ⋮ de la tarjeta de arriba → <em>Saldos iniciales</em>.</p>
        <p>Si pasaste plata entre el negocio y tus fondos personales, abajo de la tarjeta dice <strong>quién le debe a quién</strong> (por ejemplo <em>El negocio le debe $40.000 a lo personal</em>, con el botón <em>Devolver</em> al lado, igual que en Fondos personales); si están a mano, no dice nada. Con <em>+ Agregar cuenta</em> (a la derecha, afuera de la tarjeta) sumás un banco o app nuevo (con sus tarjetas de débito y crédito, si querés). En el ⋮ de cada cuenta, además de <em>Ajustar saldo</em>, están <em>Cambiar nombre y tarjetas</em> y <em>Quitar cuenta</em>. El mismo ⋮ de la tarjeta tiene <em>Retención por transferencia</em>: el % que el banco descuenta de cada cobro por transferencia y de cada ingreso que entra a una cuenta (vale desde ahora en adelante).</p>
        <p>Lo que mueve plata entre cuentas está repartido: <em>Pasar plata</em> arriba a la izquierda, <em>Comprar</em> en la fila de Dólares, <em>Canjear</em> en cada cheque de <em>Dinero → Cheques</em>, los botones <em>Interés</em> y <em>Reintegro</em> de <em>Negocio → Cobros</em>, al lado de las pastillas (el reintegro es plata que un banco o app te devuelve; en <em>Estadísticas → Negocio</em> cuenta como entrada aparte, y no se mezcla con el de Fondos personales) y <em>Pagar resumen de tarjeta</em> en <em>Gastos</em>. Ninguna cuenta como venta ni como gasto (salvo las cuotas de tarjeta, que cuentan como gasto cuando se pagan):</p>
        <ul>
          <li><em>Pasar plata</em>: depósitos (del efectivo a un banco), retiros o pasar de una cuenta a otra. No deja elegir la misma cuenta en los dos lados; <em>Invertir De y A</em> los da vuelta.</li>
          <li><em>Comprar dólares</em>: elegís con qué cuenta pagó, cuántos U$S y a cuánto compró cada uno. Resta los pesos y suma los dólares.</li>
          <li><em>Canjear cheque</em>: cambia un cheque de la cartera por plata, a su valor completo, en la cuenta que elijas (normalmente Efectivo). El cheque pasa a <em>Entregados</em>.</li>
          <li><em>Interés</em> (botón al lado de <em>+ Agregar cuenta</em>): lo que el banco o la app te <strong>pagó</strong> a vos por tener la plata ahí, con cuenta, monto y fecha. No es la <em>retención</em> que el banco se queda de las transferencias (esa se calcula sola). Lo que el banco te <strong>cobra</strong> (comisiones, intereses por descubierto) se carga en <em>Gastos</em>, con una categoría como <em>Comisiones bancarias</em> y el banco en <em>Pagó con</em>.</li>
          <li><em>Pagar resumen de tarjeta</em>: elegís la tarjeta y aparecen sus cuotas pendientes (todas tildadas); destildás las que no pagás, elegís la cuenta y la fecha, y paga todas juntas.</li>
        </ul>
        <p>Abajo queda la lista de <em>Operaciones</em>, con un rango de fechas (calendario) y un buscador por el texto del detalle para encontrar una vieja sin tener que scrollear todo; el <em>tachito</em> de cada una la deshace (el cheque vuelve a la cartera, los dólares se restan).</p>

        <p>Los gastos en efectivo de un período se ven en <em>Gastos</em>, con el filtro <em>Forma de pago → Efectivo</em>. En <em>Cobros → Historial de cobros → Por día</em> también hay una columna <em>Cierre de caja</em> con cómo cerró cada día.</p>
        <p>Ojo: la app reconoce el efectivo por el nombre del método de pago, <em>Efectivo</em>; por eso ese nombre no se puede cambiar.</p>
      </section>

      <section id="m-cheques">
        <h3>Cheques</h3>
        <p>Está en el menú <em>Dinero → Cheques</em>. Es la <strong>cartera de cheques</strong>: los que te dan los clientes cuando te pagan, y los que después le entregás a un proveedor. Adentro tenés tres vistas: <em>En cartera</em> (los que todavía tenés), <em>Entregados</em> y <em>Todos</em>, y arriba de la lista, cuántos cheques tenés en cartera y por cuánta plata.</p>
        <p><strong>Cómo entra un cheque</strong></p>
        <p>Cuando un cliente te paga con cheque, al registrar el pago (desde <em>Cobros</em> o con el <em>$</em> de una factura) elegí el método <em>Cheque</em>: aparecen tres campos, el <em>banco</em>, el <em>número</em> del cheque y la <em>fecha de cobro</em> (esta última es opcional). Con eso el cheque queda solo en la cartera, con el nombre del cliente que te lo dio. Si el pago cubre varias facturas, el cheque queda igual como uno solo, por el monto completo. El cobro con cheque no cuenta como efectivo en el <em>Cierre de caja</em>. (El método <em>Cheque</em> no se puede renombrar, porque la app lo reconoce por ese nombre.)</p>
        <p>Los cheques que ya tenías antes de usar la app se agregan a mano: apretá <em>+ Agregar cheque</em> y completá banco, número, importe, fecha de cobro y quién te lo dio.</p>
        <p><strong>Cheque a cambio de efectivo</strong></p>
        <p>Si alguien (por ejemplo Hernán) te da un cheque y vos le das la misma plata en efectivo, cargalo con <em>+ Agregar cheque</em> y tildá <em>Le di efectivo a cambio</em>. El cheque entra a la cartera y sale ese importe del efectivo de la caja de hoy; no cuenta como ingreso ni como gasto. Si te equivocaste, borrá el cheque (o el cambio desde las <em>Operaciones</em> de la Caja general) y el efectivo vuelve. Si el cheque ya lo entregaste, no se puede deshacer.</p>
        <p><strong>Entregar un cheque</strong></p>
        <p>Cuando le pagás a un proveedor, lo más práctico es hacerlo desde la ficha del proveedor (<em>Proveedores → Pagar</em>): elegís ahí los cheques y quedan entregados solos. También podés usar el <em>⋮</em> del cheque → <em>Entregar</em>: elegí a qué proveedor se lo das de la lista (se anota como un pago a ese proveedor, así baja lo que le debés) y confirmá; la fecha de entrega viene con la de hoy y la podés cambiar con el calendario. Si es para alguien que no está en la lista, elegí <em>Otro</em> y escribí el nombre. El cheque pasa a <em>Entregados</em>, donde queda anotado a quién y cuándo. Si te equivocaste, <em>Volver a cartera</em> lo devuelve. Para sacar un cheque de la lista, el <em>⋮</em> → <em>Eliminar</em> (en rojo), y confirmá (si vino de un cobro, el cobro queda registrado igual).</p>
        <p><strong>Avisos de fecha</strong></p>
        <p>Los cheques en cartera con fecha de cobro cercana muestran una marca: <em>En 3 días</em> (hasta 7 días antes), <em>Se cobra hoy</em> o <em>Ya se puede cobrar</em>. La lista se ordena por fecha de cobro, primero los que antes se pueden cobrar. Con el buscador podés encontrar uno por banco, número o nombre.</p>
      </section>

      <section id="m-ingresos">
        <h3>Fondos personales</h3>
        <p>Es la plata que <strong>no es del negocio</strong>: los alquileres que cobrás y lo que gastás de eso (arreglos y mantenimiento de las casas). No suma a las ventas ni a las estadísticas del negocio: va a la pestaña <em>Personal</em> de Estadísticas, y la caja y el cierre del día no se enteran. Arriba hay cinco pastillas: <em>Ingresos</em>, <em>Gastos</em>, <em>Resultado</em>, <em>Cuentas</em> y <em>Categorías</em>, y el total de <em>plata personal</em> se ve solo en <em>Cuentas</em>.</p>
        <p><strong>Ingresos.</strong> Cargás la <em>fecha</em>, la <em>categoría</em> (por ejemplo "Alquiler"), una <em>descripción</em> (por ejemplo el inquilino: "Gabriela"), el <em>monto</em> y en qué cuenta <em>entró</em>: un banco o app (la misma del negocio, pero se anota en su parte <em>personal</em>) o <em>Efectivo personal</em>, un sobre aparte que nunca toca el cajón. Si se lo transfirieron a un banco o app, en <em>Cómo entró</em> dejá <em>Transferencia</em>: el banco retiene un porcentaje (el de <em>Caja → ⋮ Retención</em>), se descuenta solo del saldo personal y la lista lo muestra bajo el monto; con <em>Sin retención</em> entra completo. En <em>Efectivo personal</em> no hay retención. Una observación es opcional. Como lo normal es cargar lo mismo todos los meses, <strong>las descripciones que ya usaste para esa categoría aparecen como botones</strong> debajo del formulario: tocás uno y se completan el nombre, el último monto y dónde entró; con la <em>×</em> sacás los que ya no uses. Abajo está la lista, con período, buscador y <em>Filtros</em>, y el total. Los ingresos cargados antes de esta pantalla que entraron a un banco muestran una etiqueta <em>caja</em>: siguen sumando a la caja del negocio, como estaban. Para quitar un ingreso, el <em>tachito</em>. Debajo del formulario hay dos botones: <em>Interés</em> (lo que las apps te dan por tener plata en una cuenta personal; entra sin retención en la categoría <em>Intereses</em>) y <em>Reintegro</em> (plata que te devuelven de una compra). En el Reintegro podés elegir <em>¿De qué compra?</em>: queda ligado a ese gasto de propiedades, entra en su categoría (el Resultado la cuenta ahí), el gasto muestra <em>reintegro $…</em> y no se puede devolver más de lo que costó; si quitás la compra, sus reintegros se quitan con ella (el cuadro te avisa). Si lo dejás vacío, va a la categoría <em>Reintegros</em>.
        <p><strong>Gastos.</strong> Sirve para dos cosas: gastos de tus propiedades y gastos privados. El desplegable de <em>Categoría</em> las separa en <em>Propiedades</em> y <em>Privados</em>, como en <em>Gastos</em> del negocio. Las categorías de <em>Privados</em> (comida, salud, ropa…) son una lista propia, aparte de las de propiedades y de las de <em>Gastos</em> del negocio: arranca vacía y se arma con el <em>+</em> de <em>Gastos privados</em> en la pastilla <em>Categorías</em>; igual que las otras, cada categoría se toca para armar sus <em>descripciones</em> sugeridas, que aparecen al elegirla en un gasto. Los gastos privados no suman al <em>Resultado</em> de las propiedades.</p>
        <p>Para los gastos de propiedades (arreglos, mantenimiento, impuestos de tus casas…) elegís la <em>categoría</em> (la misma lista que en los ingresos; para agregar una, la pastilla <em>Categorías</em>), la <em>descripción</em>, el <em>monto</em> y de qué cuenta personal <em>salió</em>. Se resta de ahí y no toca la caja del negocio. Al elegir la categoría aparecen como sugeridas sus descripciones (las mismas de la pastilla <em>Categorías</em>, que se ordenan de la A a la Z); una misma descripción, como <em>Mano de obra</em>, puede estar en varias categorías.</p>
        <p><strong>Resultado.</strong> Para saber <strong>cuánto te deja cada casa</strong>. Cada propiedad (Casa Norte, el local, el campo…) y la pensión se cargan como una <em>categoría</em> en la pastilla <em>Categorías</em>, y la elegís al anotar un ingreso o un gasto. Acá ves, por cada categoría y para el período que elijas con el calendario, lo que <em>entró</em> (ya sin la retención del banco), lo que <em>gastaste</em> y lo que <em>queda</em> (verde si queda a favor, rojo si perdés), con el total al pie. Solo aparecen las categorías que tuvieron movimientos en ese período. Más abajo hay una tabla aparte, <em>Gastos privados</em>, con lo que gastaste en cada categoría privada en ese período (también se toca una fila para ver el detalle); no se mezcla con las propiedades. <strong>Tocá una fila</strong> para ver el detalle: los ingresos (en verde) y los gastos (en rojo) de esa categoría en el período, con la columna <em>Tipo</em> que lo aclara, su cuenta y lo que queda al final.</p>
        <p><strong>Cuentas.</strong> Arriba está el <em>dinero disponible</em> (la plata personal total), tapado: el <em>ojito</em> lo muestra, como en la Caja (se vuelve a tapar cada vez que entrás). Los bancos y apps son los mismos del negocio, pero la plata de cada una se divide, y acá ves <strong>solo la parte personal</strong> (la del negocio está en la <em>Caja</em>, que en cada cuenta con plata personal agrega una línea chica, por ejemplo <em>+ $50.000 personales</em>, para que el total de esa cuenta en el banco cierre con tu app). <strong>Tocá una cuenta</strong> para ver su historial: cada ingreso (con su retención), gasto, pase y ajuste, con el saldo personal que fue quedando, como en la Caja. La primera vez, con <em>Ajustar</em> dejás la parte personal de cada cuenta en lo que tenés hoy. <em>Pasar plata</em> mueve plata entre el negocio y lo personal (por ejemplo, un retiro tuyo del cajón a <em>Efectivo personal</em>): resta de una parte y suma a la otra, y la plata real de la cuenta no cambia. El cuadro es igual al de <em>Pasar plata</em> de la Caja: elegís <em>De</em> y <em>A</em> (cada cuenta dice si es <em>negocio</em> o <em>personal</em>, y <em>A</em> solo ofrece las del otro lado) y con <em>Invertir De y A</em> los intercambiás. Abajo ves los pases hechos; el <em>tachito</em> los deshace. Arriba de esa lista dice <strong>quién le debe a quién</strong>: cada pase cuenta como plata prestada, así que si pasaste más plata al negocio que al revés, <em>el negocio le debe $X a lo personal</em>; si pasó más del negocio a lo personal, <em>lo personal le debe al negocio</em>; y si dan igual, no dice nada. Al lado de esa línea hay un botón <strong>Devolver</strong>: abre <em>Pasar plata</em> ya completo (toda la deuda, el sentido contrario al que la creó y las cuentas del último pase que la generó; lo podés cambiar, por ejemplo para devolver solo una parte, y deja anotado "Devolución"). Al guardar, la deuda baja sola. Es solo un dato (no cambia ninguna cuenta), y cuenta también lo que sacaste del negocio para vivir aunque no lo vayas a devolver.</p>
        <p><strong>Dólares personales.</strong> En la tabla de <em>Cuentas</em>, la última fila son tus <strong>dólares de ahorro</strong>, aparte de los del negocio, y suman al <em>dinero disponible</em>. Con el <em>⋮</em> de esa fila: <em>Ajustar dólares y cotización</em> carga cuántos dólares tenés (por ejemplo, los que ya tenías al empezar) y a cuánto se valúan hoy; <em>Comprar dólares</em> los compra con plata de una cuenta personal (se resta de esa cuenta y se suman los dólares). La <strong>cotización es la misma que la de la Caja</strong>: si la cambiás acá, cambia allá. Las compras quedan en la lista <em>Compras de dólares</em> (el <em>tachito</em> las deshace) y en el historial de la cuenta. Comprar dólares no es un gasto ni un ingreso.
        <p><strong>Categorías.</strong> Es <strong>una sola lista</strong> para los ingresos y los gastos de propiedades, <strong>propia de Fondos personales</strong> (no se mezcla con las categorías de Gastos): por ejemplo una por cada propiedad (<em>Casa Norte</em>, <em>Local</em>…) y <em>Pensión</em>, con el <em>+</em> para sumar más. Tocá una categoría para ver y armar sus descripciones sugeridas (por ejemplo el inquilino). Al separar las listas, cada categoría que ya tenías quedó en la lista donde la usabas (si la usabas en las dos, quedó una en cada una). El interés que el banco te <strong>pagó</strong> se anota en <em>Caja</em>, con el <em>⋮</em> de la cuenta → <em>Anotar interés del banco</em>.</p>
      </section>

      <section id="m-clientes">
        <h3>Clientes</h3>
        <p>La libreta de todos los que te compran: sus datos, cuánto te deben y todo lo que le compraron antes.</p>

        <p><strong>Agregar un cliente</strong></p>
        <ol>
          <li>Apretá <em>+ Agregar cliente</em>.</li>
          <li>El <em>Código</em> viene solo (el siguiente número) y no puede repetirse con el de otro cliente; se puede cambiar.</li>
          <li>Cargá el Nombre (obligatorio) y el Apellido si tiene. Si es un negocio (un almacén, un kiosco), en <em>Negocio</em> podés poner cómo se llama: así lo encontrás buscando por cualquiera de los dos.</li>
          <li>Si querés, elegí la <em>Condición frente al IVA</em> (consumidor final, monotributista o responsable inscripto) y cargá el <em>CUIT</em>: se controla que sea un CUIT válido. Es solo para tenerlo anotado.</li>
          <li>Si tiene WhatsApp, cargalo en Teléfono WhatsApp. El Teléfono fijo es aparte, solo para tenerlo anotado. Si es un negocio con dos dueños y hablás con los dos, en <em>Segundo WhatsApp</em> podés cargar el otro número con el nombre de quién es (por ejemplo, "Juan (el otro dueño)"): al mandarle una factura por WhatsApp, la app te va a preguntar a cuál de los dos se la mandás, o si se la mandás a los dos.</li>
          <li>Domicilio y nota son opcionales — la nota sirve para recordar algo puntual del cliente.</li>
          <li>En <em>Saldo inicial</em> podés poner lo que ya te debía antes de empezar a usar FRESKA, igual que con los proveedores. Cuando el cliente te paga, lo que se cobra del saldo inicial queda anotado como un cobro más (en el historial figura como <em>Saldo anterior</em>, y entra a la caja del día y a las estadísticas); el saldo inicial aparece al principio del historial para que la columna Saldo coincida con lo que debe.</li>
          <li>Si trabajás con vendedores que cobran comisión (solo lo ve el administrador), elegí en <em>Vendedor</em> quién es el suyo; si lo dejás vacío es un cliente del dueño y no genera comisión. Si más adelante se lo cambiás, las ventas de meses anteriores se quedan con el vendedor de ese momento.</li>
          <li>Apretá <em>Guardar</em>.</li>
        </ol>

        <p><strong>Vendedores y comisiones</strong></p>
        <p>En <em>Clientes y proveedores → Vendedores</em> cargás a cada vendedor con su código, su WhatsApp y su porcentaje de comisión (se agrega con el mismo tipo de formulario que Clientes). Si más adelante le cambiás el porcentaje, el nuevo vale desde ese día: lo cobrado antes se sigue calculando con el anterior. Más abajo, en <em>Informe</em>, elegís el período con el selector de fechas (desde y hasta, como en las demás pantallas; arranca en el mes en curso) y ves cuánto se le cobró a los clientes de cada uno y cuánto le corresponde de comisión, con el detalle por cliente; si el vendedor tiene WhatsApp, el ícono verde le manda el resumen ("en agosto de 2026 cobramos… y te corresponde…"). Se calcula sobre lo <strong>cobrado</strong> (no sobre lo facturado): un pago cuenta el día que se cobró. Las facturas anuladas no suman, se hayan cobrado o no; aparecen aparte, con su motivo. <em>Registrar pago</em> anota en Gastos (categoría "Comisiones de vendedores") lo que le vayas pagando de la comisión, de a partes si hace falta; el mes al que queda imputado cada pago sale de la fecha que le pongas, no del informe que estés mirando (si es de otro mes, avisa antes de guardar). Cada pago se puede deshacer. En <em>Estadísticas → Ventas</em>, si tenés vendedores cargados, aparece "Comisionistas": lo cobrado en el período desglosado por vendedor, aparte de lo cobrado directo (sin vendedor).</p>

        <p><strong>Ver solo quién te debe</strong></p>
        <p>En <em>Todos</em> la lista viene ordenada de mayor a menor deuda: el que más te debe aparece primero, y los que no deben nada quedan al final. Al lado del buscador, <em>Ordenar</em> la cambia (mayor saldo, nombre, última compra o código) y <em>Ver</em> muestra solo los que deben o los que hace más de 30 días que no compran (con la fecha de su última compra). La pestaña <em>Dados de baja</em> muestra a los clientes que ya no compran y sacaste de las listas (ver más abajo cómo se dan de baja y de alta).</p>

        <p><strong>Ver la ficha de un cliente</strong></p>
        <p>Buscalo en la lista (por su nombre o por el del negocio, si le cargaste uno) y apretá sobre su nombre: se abre su ficha con el <em>Historial</em>, cada factura y cada recibo, en orden, con el saldo que iba quedando después de cada uno. Apretá sobre una factura para ver qué se llevó ese día. Si apretás sobre su <em>nombre</em> (arriba, tiene una flechita) se despliegan su teléfono, domicilio y nota, y abajo <em>Editar</em>. <em>Borrar cliente</em> está dentro de Editar (al lado de Guardar y Cancelar, a la derecha) y solo aparece si nunca le hiciste una factura. Si ya tiene facturas, en su lugar aparece <em>Dar de baja</em> (al lado de <em>Editar</em>, apenas desplegás sus datos): deja de aparecer en la lista y en los buscadores de pedidos y facturas, pero conserva todo su historial (solo se puede si no debe nada). Para volver a darlo de alta, andá a Clientes → pestaña <em>Dados de baja</em> (ahí, en vez del saldo, se ve la fecha de su <em>última compra</em>, para decidir si vale la pena), tocá su nombre y apretá <em>Dar de alta</em> (arriba, al lado de la etiqueta "Dado de baja"). Un cobro se ve como <strong>un solo recibo</strong>, aunque haya cubierto varias facturas o se haya pagado con más de un método; viene cerrado, y si lo tocás se despliega a qué factura fue cada parte y con qué método. El historial muestra los últimos 30 movimientos; apretá <em>Ver más antiguos</em> para ver los anteriores.</p>
        <p><strong>Si cargaste mal cómo se pagó</strong> (por ejemplo, efectivo en vez de Mercado Pago): abrí el recibo en la ficha del cliente y, al lado del método, apretá <em>Cambiar</em>; elegí el método correcto. La caja del día, la Caja general y las estadísticas se corrigen solas. Un cobro con cheque, con saldo a favor o una devolución no se puede cambiar.</p>

        <p><strong>Si anulaste un cobro o una factura por error</strong>: se puede deshacer. Un cobro anulado tiene un botón <em>Reactivar</em> al lado, en la ficha del cliente, que lo vuelve a dejar tal cual estaba. Una factura anulada tiene <em>Reactivar</em> en su <em>⋮</em>, en la pestaña Facturas. En los dos casos, si algo cambió después (por ejemplo, la factura se anuló de nuevo, o el saldo a favor que había quedado ya se usó en otra compra), la app te avisa que no se puede deshacer automáticamente en vez de arriesgarse a dejar mal las cuentas.</p>
      </section>

      <section id="m-proveedores">
        <h3>Proveedores</h3>
        <p>Para llevar la cuenta de lo que le comprás a cada proveedor de mercadería: qué compraste, cuántos kilos, cuánto pagaste y cuánto le debés. Viene con los proveedores de la planilla ya cargados.</p>

        <p><strong>La lista</strong></p>
        <p>Muestra cada proveedor con su <em>saldo</em> (lo que le debés, en rojo; si le pagaste de más, dice <em>A favor</em>). Arriba están las pestañas <em>Todos</em> (ordenada de mayor a menor deuda: al que más le debés primero; con <em>Ordenar</em> la cambiás por nombre o última compra, y <em>Ver</em> deja solo a los que les debés) y <em>Dados de baja</em>, y el total que debés. Cada fila tiene dos botones: <em>Compra</em>, que abre la ficha con el formulario de compra listo, y <em>Pagar</em> (rojo si le debés algo), que la abre con el pago ya empezado. Para agregar uno apretá <em>+ Agregar proveedor</em>: el nombre es lo único obligatorio; en <em>Saldo inicial</em> podés poner lo que ya le debías antes de empezar a usar la app, y en <em>Lo que vende</em> podés ir sumando sus productos: elegí el <em>producto</em> (de una lista tuya: Vaca, Cerdo, Pollo, o lo que agregues), opcionalmente una <em>descripción</em> (para distinguir dos cosas del mismo producto, ej: "capón"), si se compra por <em>Kg</em> o por <em>Unidad</em> — por ejemplo los huevos — y apretá el <em>+</em>.</p>

        <p><strong>Cargar una compra</strong></p>
        <ol>
          <li>En la lista, apretá <em>Compra</em> en la fila del proveedor (o abrí su ficha y apretá <em>+ Cargar compra</em>).</li>
          <li>La <em>Fecha</em> viene con la de hoy. Al lado, <em>N° de comprobante</em> es opcional: sirve para encontrar después la factura o el remito de papel.</li>
          <li>Arriba aparece <em>Lo que vende</em>: los productos de ese proveedor. <strong>Tocá uno y se agrega su línea</strong>, con el último precio que le pagaste (lo podés cambiar); si ese producto es "por unidad" (huevos, por ejemplo), la línea pide <em>Cantidad</em> y <em>Por unidad</em> en vez de <em>Kilos</em> y <em>Por kilo</em> — esto también se puede cambiar para esa compra en particular, aunque el producto ya tenga otra unidad habitual. Si hay uno que no tiene nada que ver (por ejemplo, algo que cargaste una vez de pasada), apretá la <em>×</em> que tiene al lado y deja de aparecer en la lista de ese proveedor. Para algo que no está en la lista, apretá el <em>+</em> (<em>Otro producto</em>): elegí el <em>producto</em> (vaca, cerdo, pollo, otro… es una lista tuya: la última opción, <em>Editar productos…</em>, te deja agregar o sacar), escribí una <em>descripción</em> si hace falta distinguirlo (opcional) y si se compra por <em>Kg</em> o por <em>Unidad</em>.</li>
          <li>Cargá los <em>kilos</em> y el <em>importe</em> total: el <em>precio por kilo</em> se calcula solo. Si preferís, cargá los kilos y el precio por kilo y el importe se calcula solo (en el orden que quieras).</li>
          <li>Con el <em>−</em> sacás una línea. Abajo ves el <em>Total de la compra</em>, que es la suma de todos.</li>
          <li>Apretá <em>Guardar compra</em>. Los kilos quedan guardados para poder calcular más adelante el rendimiento.</li>
        </ol>
        <p>Cada compra del historial tiene un <em>⋮</em> con <em>Editar</em> y <em>Eliminar</em> (en rojo; pide confirmación).</p>

        <p><strong>Pagarle a un proveedor</strong></p>
        <p>En la ficha (o con el botón <em>Pagar</em> de la lista) se abre el pago, igual que cuando le registrás un pago a un cliente: arriba ves cuánto le debés, elegís la <em>Fecha</em> y por cada forma de pago hay una línea con el <em>monto</em> y el método (<em>Efectivo</em>, <em>Transferencia</em> o <em>Cheque</em>). El primer monto viene con todo lo que le debés. Con el <em>+</em> agregás otra forma de pago (si son dos, lo que escribís en una completa la otra con lo que falta) y con el <em>−</em> sacás una. Si elegís <em>Cheque</em>, aparece debajo un desplegable con los cheques de tu cartera: elegís uno y el monto es el del cheque (un mismo cheque no se puede usar en dos líneas). Abajo ves el total y cuánto le quedarías debiendo (o si quedaría un saldo a favor). Al guardar, los cheques pasan a <em>Entregados</em> (a ese proveedor) y lo pagado sale de la cuenta que elegiste en la <em>Caja general</em> (el efectivo sale del efectivo general y no resta del cajón del cierre del día). Si te equivocaste, el <em>⋮</em> del pago → <em>Eliminar</em> lo quita: los cheques vuelven a la cartera y la plata vuelve a la cuenta. Un cheque usado en un pago no se puede borrar de la cartera hasta que quites el pago.</p>
        <p><strong>Devolución a un proveedor</strong></p>
        <p>Si le devolvés mercadería (por ejemplo carne en mal estado), en la ficha apretá <em>Devolución</em> (no cargues un pago: sacaría efectivo de la caja). Elegís la <em>fecha</em>, de qué compra viene (opcional), el <em>producto</em>, los <em>kilos</em> devueltos y el <em>monto</em>: si elegiste la compra, el casillero de kilos avisa el <em>máximo</em> (lo que compraste de ese producto menos lo que ya devolviste) y no deja pasarlo, y el monto sale solo (kilos × precio de esa compra) y lo podés corregir. Después elegís <em>¿Cómo queda?</em>: <strong>Queda a favor mío</strong> resta lo devuelto de lo que le debés (o te deja saldo a favor) sin tocar el efectivo, y <strong>Me devolvió la plata</strong> hace entrar ese dinero a la cuenta que elijas (o al cajón, si es <em>Efectivo</em>) y lo que le debés queda igual. Aparece en el historial como <em>Devolución</em>; los kilos devueltos se descuentan de lo comprado en <em>Stock → Rendimiento</em> y lo que te devolvió en plata resta de lo pagado en las Estadísticas. Para deshacerla, <em>⋮ → Eliminar</em>. Si le cargaste como pago una devolución, quitá ese pago desde su <em>⋮ → Eliminar</em> y cargá la devolución.</p>

        <p><strong>Datos del proveedor y lo que vende</strong></p>
        <p>Apretá el nombre arriba de la ficha para ver o cambiar el teléfono, la nota y el saldo inicial. Ahí también está <em>Lo que vende</em>: los productos de ese proveedor (con su descripción, si tiene). Se van sumando solos cada vez que cargás una compra, y también podés agregar uno con el <em>+</em> o sacarlo con la <em>×</em> (las compras ya cargadas no se tocan). Desde ahí también podés <em>darlo de baja</em> o <em>eliminarlo</em> (Eliminar proveedor lo borra para siempre, con sus compras y pagos: te avisa cuántos son, y los cheques que le habías entregado vuelven a la cartera). Darlo de baja (deja de aparecer en la lista pero conserva su historial; lo encontrás en <em>Dados de baja</em> y lo podés dar de alta de nuevo).</p>
      </section>

      <section id="m-productos">
        <h3>Productos</h3>
        <p>La lista de lo que vendés, con sus dos precios (Cliente y Consumidor Final) y si se vende por kilo o por unidad.</p>
        <p><strong>Quitar un producto</strong></p>
        <p>Si dejás de vender algo, apretá el <em>⋮</em> de su fila → <em>Quitar</em> (te pide confirmación). Deja de aparecer para facturar, pero las facturas viejas que lo incluían se mantienen igual.</p>

        <p><strong>Cambiar un precio</strong></p>
        <p>Cuando aumenta la carne, buscá el producto, apretá su <em>⋮</em> → <em>Editar</em> (se abre arriba el formulario con sus datos), cambiá el número y apretá <em>Guardar cambios</em> — se actualiza para todas las facturas nuevas.</p>
        <p><strong>Imprimir la lista de precios</strong></p>
        <p>Apretá <em>Imprimir lista de precios</em>, elegí si querés los dos precios (Cliente y CF) o uno solo, y apretá <em>Imprimir</em> (o guardala como PDF). Si algún producto no tiene código o lo repite, la lista de Productos lo marca en rojo.</p>
        <p><strong>Agregar un producto nuevo</strong></p>
        <p>Apretá <em>+ Agregar producto</em>, completá el código (es obligatorio y no puede repetirse: viene sugerido con el siguiente número), el nombre, los dos precios y si se vende <em>por kg</em>, <em>por caja</em> (hamburguesas, picada) o <em>por unidad</em> (una hamburguesa suelta). Más abajo, si se vende por unidad, poné <em>cuánto pesa cada unidad</em> (para llevar su stock) y, si es algo suelto de una caja, con quién <em>comparte el stock</em>. Lo mismo se cambia con <em>Editar</em>. Si el código o el nombre que pusiste eran de un producto que habías dado de baja, se reactiva ese mismo producto con los datos nuevos, en vez de avisar que ya existe.</p>
        <div class="manual-tip">
          <strong>El código sirve para facturar más rápido</strong>
          Si le ponés un código a un producto (ej: 9 para milanesas de pollo), al cargar una factura podés escribir ese número en el campo <em>Código</em> y apretar Enter en vez de buscarlo en la lista.
        </div>
              <p><strong>Se puede pedir por unidad.</strong> Solo aparece en los productos que se venden <em>por kilo</em>. Con <em>Sí</em>, en Pedidos esa línea se puede cargar en unidades (ver Pedidos), y podés poner cuánto pesa cada una, en gramos (por ejemplo <em>200</em> para el chorizo seco): se usa para calcular lo pendiente en Stock. Con <em>No</em> el producto se pide solo en kilos.</p>
      </section>

      <section id="m-stock">
        <h3>Stock</h3>
        <p>Para saber cuánto hay de lo que vendés y si alcanza para lo que te piden. Todo se lleva <strong>en kilos</strong>, por <em>artículo</em> (hamburguesas, picada, chorizos secos…). Tiene dos vistas: <em>Stock</em> y <em>Producción</em>.</p>
        <p><strong>Cómo se calcula</strong></p>
        <p>El <em>Hay</em> de cada artículo es lo que se <strong>produjo</strong> (más o menos los ajustes que hiciste) menos lo que se <strong>facturó</strong> desde la fecha de arranque. Las facturas descuentan solas: no hace falta cargar nada al vender. Una factura anulada no descuenta. <em>Pedido</em> es lo que se pidió y todavía no se facturó, y <em>Disponible</em> es lo que hay menos lo pedido (en rojo si falta).</p>
        <p><strong>Cargar la producción</strong></p>
        <p>En <em>Producción</em> elegís el día, qué se produjo y la cantidad, en <strong>kilos</strong> o en <strong>cajas</strong> (con cajas, la app usa cuánto pesa cada una: en hamburguesas y picada ya lo sabe por el producto; en lo demás te lo pide la primera vez y lo recuerda), y una nota si querés; apretás el <em>+</em> o Enter. Se carga cuando el empleado va produciendo (por ejemplo, los chorizos los días que se hacen). Debajo del formulario hay un <em>calendario</em> (desde / hasta, arranca en el mes actual) que vale para todo lo de abajo: la tabla <em>Producido por artículo</em> (cuántos kilos se produjeron de cada cosa en ese período, en cuántas <em>tandas</em>, el <em>promedio por tanda</em> y la <em>última vez</em>, con el total; sirve para ver cuánto se produce por mes) y la lista de <em>Movimientos</em>; el <em>tachito</em> quita uno. La tabla cuenta solo producción, sin los ajustes de stock, y se arma por artículo del stock: los productos que comparten stock aparecen juntos.</p>
        <p><strong>Ajustar el stock</strong></p>
        <p>Si contás y no coincide, en <em>Stock</em> apretá <em>Ajustar</em> en la fila y poné cuántos kilos hay realmente.</p>
        <p><strong>Cada producto lleva su propio stock</strong></p>
        <p>No hace falta configurar nada para lo que se vende por kilo (chorizos, milanesas…): cada uno aparece solo en <em>Stock</em>. Para lo que se vende por unidad (una caja de hamburguesas, una bolsa de picada) hay que decir <strong>cuánto pesa cada unidad</strong>: se hace con el botón <em>Stock</em> de ese producto, en <em>Productos</em> (en kilos o en gramos; hay que haber guardado el producto primero para que aparezca ese botón). Por ejemplo, la caja de hamburguesas pesa 2,46 kg y la de picada 2,5 kg (esos dos pesos ya vienen cargados).</p>
        <p>Lo que se vende <strong>suelto</strong> comparte el stock de la caja: con el botón <em>Stock</em> del producto suelto (por ejemplo, la hamburguesa de 78 g), en <em>Productos</em>, elegís <em>Comparte el stock con</em> la caja y ponés cuánto pesa. Así una hamburguesa suelta, media caja o una bolsita de picada descuentan del mismo stock que la caja. Si una bolsita cambia de peso, se puede vender por kilo y compartir el stock con la caja.</p>
        <p>La lista de Productos tiene una columna <em>Hay</em> con lo que queda de cada uno. Un producto por unidad sin peso no lleva stock. En <em>Stock</em>, el <em>⋮</em> de cada fila permite ajustarlo (poner cuánto hay realmente, por conteo): si ese artículo ya se había contado hoy, el ⋮ dice <em>Editar el ajuste de hoy</em> y corrige ese mismo ajuste en vez de sumar otro aparte, así contar dos veces por las dudas (o corregir un conteo mal puesto) no deja varios renglones sueltos en el historial.</p>
        <p>En <em>Pedidos</em>, la tabla <em>Pedidos de hoy</em> muestra una columna <em>Hay</em> con lo que queda de cada producto, en rojo si no alcanza para lo pedido.</p>
        <p><strong>Para que Stock, Rendimiento y los avisos sirvan: primeros pasos</strong></p>
        <p>Todo esto se carga en un solo lugar: el botón <em>Stock</em> de cada producto, en <em>Productos</em> — no hace falta ir a otra pantalla (primero sí hace falta guardar el producto, con su nombre y precio, para que aparezca en la lista y el botón):</p>
        <ol>
          <li>Elegí <em>cuánto pesa cada unidad</em> (si no se vende por kilo) y con quién <em>comparte el stock</em>, si corresponde.</li>
          <li>Elegí el <em>tipo de carne</em> (Vaca, Cerdo, Pollo…). Sin eso, <em>Rendimiento</em> lo pone en <em>Sin tipo</em>. Para saber <strong>cuáles</strong> son, en <em>Rendimiento</em> tocá la fila <em>Sin tipo</em>: se abre una lista con los artículos que se produjeron o vendieron en ese período sin tipo de carne. Si falta un tipo en la lista, el ✎ de al lado lo agrega sin salir de ahí.</li>
          <li>Si el producto lleva <strong>más de una carne</strong> (el chorizo fresco, por ejemplo, vaca y cerdo), tocá las que lleva: aparece un casillero con el <em>porcentaje</em> de cada una (empieza parejo y lo ajustás; tienen que sumar 100 %). <em>Rendimiento</em> reparte lo producido y vendido entre las carnes según esos porcentajes, y la tabla de <em>Stock</em> muestra la mezcla, una carne por renglón (Vaca 70 %, Cerdo 30 %).</li>
          <li>Si el producto <strong>comparte el stock</strong> con otro (la hamburguesa suelta con la caja), el tipo de carne, cuánta lleva y el aviso de mínimo <strong>no se piden acá</strong>: son del stock compartido y se cargan en el otro producto, el que tiene su propio stock.</li>
          <li>Para lo que lleva algo más que carne (milanesas, hamburguesas), cargá <em>Lleva carne</em> con el porcentaje.</li>
          <li>Si querés avisos de poco stock, poné <em>Avisar si queda menos de…</em> (acá y en los insumos).</li>
          <li>Esto se hace una sola vez por producto. Después, día a día, solo cargás lo que producís en <em>Stock → Producción</em> y hacés un conteo inicial con <em>Ajustar</em>.</li>
        </ol>
        <p><strong>Insumos</strong></p>
        <p>La cuarta pastilla de Stock lleva lo que se gasta pero no se vende ni se produce: bolsas, bandejas, film y también ingredientes (huevo, pan rallado…). No se descuentan solos: de vez en cuando los <em>contás</em>. Con <em>+ Agregar insumo</em> cargás el nombre, la unidad (unidades, kg, rollos, paquetes, cajas o litros) , cuánto hay hoy (queda como primer conteo) y, si querés, <em>Avisar si queda menos de…</em>. Para contar, el <em>⋮</em> de cada insumo tiene <em>Contar</em>: ponés cuánto hay hoy y queda guardado. La tabla muestra el último conteo, el anterior y la diferencia entre los dos, y el último conteo sale en rojo si está por debajo del mínimo. El <em>⋮</em> de cada insumo tiene también <em>Ver conteos</em> (para borrar uno cargado por error), <em>Editar</em> y <em>Quitar</em>.</p>
        <p><strong>Rendimiento</strong></p>
        <p>La tercera pastilla de Stock compara, por <em>tipo de carne</em> (Vaca, Cerdo, Pollo…) y para el período que elijas con el calendario, los kilos <em>comprados</em> (las compras a proveedor, solo las cargadas por Kg: lo comprado por unidad no entra acá), los <em>producidos</em> (lo que cargaste en Producción) y los <em>vendidos</em> (lo facturado), y calcula el <em>rinde</em>: cuántos kilos de producto salen por cada kilo comprado. Para que funcione, cada producto tiene que tener su tipo elegido (con el botón <em>Stock</em>, en <em>Productos</em>); lo que no lo tiene aparece en <em>Sin tipo</em>. El <em>?</em> explica cómo se calcula y por qué conviene mirar períodos largos.</p>
      </section>

      <section id="m-estadisticas">
        <h3>Estadísticas</h3>
        <p>Para ver, en un período, cuánta plata entró, cuánta salió y cuánto quedó. Está en la última pestaña.</p>
        <p><strong>Elegir el período</strong></p>
        <p>Arriba están los botones <em>Este mes</em>, <em>Mes pasado</em>, <em>Este año</em> y <em>Todo</em> (todo lo cargado, desde el primer registro; no se compara con un período anterior), y al lado el calendario para elegir cualquier rango (tocá el primer día y el último). Por defecto se abre en el mes actual.</p>
        <p><strong>Qué muestra</strong></p>
        <p>Arriba de todo siempre están los tres números grandes. Debajo hay pestañas para no ver todo junto: <em>Resumen</em> (entradas por forma de pago, salidas y mes a mes), <em>Ventas</em> (lo facturado, facturado y cobrado, día de la semana, productos y clientes), <em>Compras</em> (precio por kilo), <em>Plata pendiente</em> e <em>Inflación</em>. En <em>Personal</em> solo están el resumen y la inflación.</p>
        <ul>
          <li><em>Entradas, Salidas y Resultado</em>: tres números grandes. El resultado es entradas menos salidas (en rojo si es negativo). Abajo de cada uno hay una flecha que lo compara con el período anterior (un mes con el mes anterior, un año con el año anterior): verde si mejoró, roja si empeoró. Pasá el mouse por la flecha para ver qué fechas se compararon.</li>
          <li><em>Plata pendiente</em> (solo en Negocio y Total; es la situación de hoy, no depende del período): cuánto te deben los clientes (con los 5 que más deben, y podés tocar un nombre para abrir su ficha), cuánto les debés a los proveedores y cuántos cheques tenés en cartera, avisando cuáles ya se pueden cobrar o vencen en los próximos 7 días.</li>
          <li><em>Entradas por forma de pago</em>: lo que cobraste, separado en efectivo, transferencia, cheque, etc., con la cantidad de cobros (en <em>Personal</em>, los ingresos separados por origen).</li>
          <li><em>Salidas</em>: lo que pagaste, con una barra por cada categoría de gasto y una para los pagos a proveedores (debajo, cuánto fue en efectivo, transferencia y cheques).</li>
          <li><em>Gastos por forma de pago</em> y <em>Gastos más grandes</em> (solo Negocio y Total, sin los "Particulares"): lo mismo que "Salidas" pero separado por efectivo/transferencia/etc., y los gastos individuales más caros del período (con su categoría y fecha).</li>
          <li><em>Ventas del período</em>: cuánto facturaste y en cuántas facturas, los <em>productos más vendidos</em> (con los kilos o unidades) y los <em>clientes que más compraron</em>. Cuenta lo facturado, no lo cobrado, y no incluye las facturas anuladas.</li>
          <li><em>Facturado y cobrado</em>: cuánto facturaste en el período y cuánto cobraste (con qué porcentaje de lo facturado). Lo cobrado incluye plata de facturas de antes.</li>
          <li><em>Ventas por día de la semana</em>: cuánto facturaste cada día (lunes a domingo), para ver cuáles son los días fuertes.</li>
          <li><em>Comisionistas</em> (solo si tenés vendedores cargados): a diferencia del resto de esta sección, es sobre lo <strong>cobrado</strong> en el período (no lo facturado), desglosado por vendedor, aparte de lo cobrado directo (sin vendedor, "Freska"). Es el mismo criterio que el informe de <em>Vendedores</em>.</li>
          <li><em>Precio por kilo de lo que comprás</em>: por producto y proveedor, el <strong>último</strong> precio por kilo, el de la compra <strong>anterior</strong> y cuánto cambió (▲ rojo si ahora pagás más), más el promedio del período. Sale de los kilos y el importe de cada compra cargada en Proveedores que sea por Kg (lo comprado por unidad no entra en este reporte).</li>
          <li><em>Mes a mes</em>: un gráfico con las entradas y las salidas de los últimos 12 meses (pasá el mouse por un mes para ver los montos).</li>
          <li><em>Inflación</em>: una tabla por mes con las entradas, cuánto cambiaron respecto del mes anterior y un casillero donde cargás <strong>a mano</strong> la inflación de ese mes. La última columna dice si las entradas <em>ganaron</em> o <em>perdieron</em> contra los precios (el cambio real, descontada la inflación).</li>
        </ul>
        <p><strong>Cómo se cuenta</strong></p>
        <p>Se cuenta lo que realmente se cobró y se pagó cada día, igual que en la planilla: un cobro cuenta el día que lo cobraste (también los cheques que te dan) y un gasto o un pago a un proveedor cuenta el día que lo pagaste. Una compra a un proveedor entra en las salidas cuando le pagás, no cuando la cargás. Así una misma plata no se cuenta dos veces.</p>
        <p>Arriba de todo elegís <em>Negocio</em>, <em>Personal</em> o <em>Total</em>. <em>Negocio</em> cuenta las ventas, los gastos de las categorías del negocio, los pagos a proveedores y los intereses. <em>Personal</em> cuenta lo que cargaste en <em>Fondos personales</em> (ingresos y gastos de propiedades) y los gastos de las categorías personales. <em>Total</em> suma todo. En <em>Negocio</em>, si en el período sacaste plata para vivir (gastos de <em>Gastos</em> con una categoría <em>Personal</em>), debajo de las tres tarjetas aparece el <strong>Resultado final</strong>: el resultado del negocio menos eso que sacaste, y tocando <em>Ver cuenta</em> se despliegan los tres renglones (resultado del negocio, lo que sacaste y el resultado final); el <em>?</em> lo explica. Los gastos de tus propiedades no entran ahí. En <em>Personal</em>, los ingresos y las salidas se agrupan por <em>categoría</em> (por ejemplo, cada propiedad), así que una casa aparece del lado de lo que entró y del lado de lo que se gastó. En <em>Gastos → Categorías</em> definís si cada categoría es del negocio o personal, y podés crear las que quieras en cada grupo.</p>
      </section>

      <section id="m-buscador">
        <h3>Buscador (la lupa)</h3>
        <p>Para encontrar cualquier cosa sin acordarte en qué pantalla está. Apretá la <em>lupa</em> de arriba a la derecha (al lado del ícono de usuario) o, desde cualquier pantalla, el atajo <em>Cmd + K</em> en Mac o <em>Ctrl + K</em> en Windows.</p>
        <ol>
          <li>Escribí lo que buscás. Mientras escribís aparecen los resultados, agrupados: <em>Clientes</em>, <em>Proveedores</em>, <em>Productos</em>, <em>Insumos</em>, <em>Facturas</em>, <em>Cheques</em>, <em>Gastos</em>, <em>Fondos personales</em>, <em>Operaciones de caja</em> (depósitos, dólares, canjes, intereses) y <em>Pedidos pendientes</em>. No importan las mayúsculas ni los acentos ("cabana" encuentra "Cabaña") y se pueden escribir varias palabras ("diana caba").</li>
          <li>Movete con las flechas ↑ ↓ y apretá <em>Enter</em> (o tocá el resultado con el mouse) para abrirlo. Te lleva a la ficha del cliente o del proveedor, o a la pantalla que corresponde con la búsqueda ya puesta.</li>
          <li><em>Esc</em> cierra el buscador (también volver a apretar la lupa o el atajo).</li>
        </ol>
        <p><strong>Buscar por importe</strong></p>
        <p>Si escribís un número (por ejemplo <em>150000</em> o <em>150.000</em>), además de buscar por nombre busca por importe: facturas con ese total o que deban justo eso, cheques, gastos, saldos de clientes y de proveedores, y los cobros de ese monto. Sirve para saber de quién es una transferencia: "me depositaron $150.000, ¿de quién es?". Para una factura por su número escribí <em>N° 123</em> o <em>#123</em>.</p>
        <p><strong>Ir a una pantalla</strong></p>
        <p>Abajo de los resultados aparece <em>Ir a</em>: escribí, por ejemplo, "caja general", "cierre", "otros ingresos", "categorías" o "estadísticas" y te ofrece abrir esa pantalla o pestaña (también el Manual). Con el buscador vacío ves todas.</p>
      </section>

      <section id="m-avisos">
        <h3>Avisos (la campanita)</h3>
        <p>La campanita de arriba a la derecha te avisa de cosas que conviene mirar, para que no se te pasen. Si hay avisos, aparece un numerito rojo (o naranja) sobre la campanita; al abrir la app también te sale un cartelito con cuántos hay. Tocá la campanita para ver la lista y tocá un aviso para ir directo a lo que corresponde.</p>
        <p><strong>Qué avisa</strong></p>
        <ul>
          <li><em>Cheques para cobrar</em>: los que ya cumplieron su fecha de cobro o vencen en los próximos 7 días (en rojo si ya se pueden cobrar).</li>
          <li><em>Clientes que deben hace más de 30 días</em>, con cuánto y desde cuándo.</li>
          <li><em>Proveedores sin pagar hace más de 21 días</em> (que todavía les debés plata).</li>
          <li><em>Pedidos de días anteriores sin facturar</em>: los de hoy no avisan, porque es lo normal.</li>
          <li><em>Caja</em>: días de los últimos 7 con movimiento y sin cierre hecho, o cerrados con diferencia en el efectivo. Al tocarlo se abre el cierre de ese día.</li>
          <li><em>Clientes habituales que dejaron de comprar</em> (más de 45 días sin comprar).</li>
          <li><em>Copia de seguridad</em>: si nunca guardaste una copia fuera de la computadora o pasaron más de 14 días.</li>
          <li><em>Productos con precio en $0</em>.</li>
          <li><em>Stock bajo</em>: productos por debajo del mínimo que cargaste con el botón <em>Stock</em> de Productos (<em>Avisar si queda menos de</em>). Un stock en negativo no avisa (suele ser producción sin cargar).</li>
          <li><em>Insumos con poco stock</em>: los que en su último conteo quedaron por debajo del mínimo, y <em>Insumos sin contar</em>: los que hace más de 30 días que no contás. Tocarlos te lleva a Stock → Insumos.</li>
        </ul>
        <p><strong>Marcar como leídos</strong></p>
        <p>Cada aviso tiene una <em>✓</em> a la derecha: si ya lo viste y no querés que te siga molestando, tocala y pasa a <em>leídos</em> (deja de contar en el numerito). Con <em>Marcar todos como leídos</em> (arriba de la lista) los marcás de una vez. Abajo, <em>Ver leídos</em> los muestra opacos, con una flecha <em>↩</em> para volver a marcarlos como no leídos. Un aviso leído <strong>vuelve a aparecer solo si cambia</strong>: por ejemplo, si vence otro cheque o se atrasa otro cliente.</p>
        <p><strong>Elegir qué avisos ver</strong></p>
        <p>Abajo de la lista, apretá <em>Elegir qué avisos ver</em>: cada tipo tiene su casilla. Destildá los que no te sirvan y dejan de aparecer (y de contar en el numerito). Los volvés a tildar cuando quieras.</p>
        <p>Los avisos se calculan solos cada vez que cambiás de pantalla y cada 10 minutos; cuando resolvés lo que avisaba, desaparecen.</p>
      </section>

      <section id="m-menu">
        <h3>Menú y ajustes</h3>
        <p>Arriba a la derecha hay un ícono con una personita — ahí están las opciones generales.</p>
        <table>
          <thead><tr><th>Opción</th><th>Para qué sirve</th></tr></thead>
          <tbody>
            
            <tr><td>Dirección del local</td><td>La dirección de tu negocio. Se usa como punto de partida para armar el recorrido de reparto.</td></tr>
            <tr><td>Buscar actualizaciones</td><td>Solo el administrador. Mira si hay una versión nueva de la app y, si la hay, te deja actualizar con un botón. La app también lo mira sola al abrirla y solo te avisa si hay algo nuevo. Necesita internet. Al actualizar se cierra y se vuelve a abrir sola; tus datos no se tocan.</td></tr>
            <tr><td>Copia de seguridad</td><td>Abre la pantalla de copias: guardar una copia en un pendrive, ver las copias automáticas y volver atrás a una de ellas. Está explicado más abajo, en "Copias de seguridad".</td></tr>
            <tr><td>Cambiar contraseña</td><td>Poner una contraseña nueva (pide la actual primero).</td></tr>
            <tr><td>Manual de uso</td><td>Esta misma guía.</td></tr>
            <tr><td>Modo oscuro / Modo claro</td><td>Cambia la apariencia de la app. Se acuerda de tu elección la próxima vez que la abras.</td></tr>
            <tr><td>Cerrar sesión</td><td>Bloquea la app hasta escribir la contraseña de nuevo.</td></tr>
          </tbody>
        </table>
        <div class="manual-tip">
          <strong>Hacé la copia de seguridad seguido</strong>
          Una vez por semana está bien — es la forma de no perder nada si algún día pasa algo con la computadora.
        </div>
              <p><strong>Atajos del menú.</strong> Al pasar el mouse unos instantes sobre una pantalla del menú que tiene vistas adentro (por ejemplo <em>Negocio</em>, <em>Fondos personales</em> o <em>Caja</em>), sale al costado un desplegable con esas vistas: un clic y vas directo (por ejemplo <em>Negocio → Gastos</em> o <em>Fondos personales → Gastos de propiedades</em>). Lo mismo pasa con los grupos que están cerrados (<em>Ventas</em>, <em>Dinero</em>…): al pasar el mouse sale la lista de las pantallas de adentro. Es solo un atajo: tocar la pantalla del menú sigue yendo a ella.</p>
      </section>

      <section id="m-copias">
        <h3>Copias de seguridad</h3>
        <p>Todo lo que cargás en FRESKA (clientes, productos, facturas, cobros) se guarda en <strong>un solo archivo</strong> dentro de esta computadora. Una copia de seguridad es un duplicado de ese archivo. Sirve para volver atrás si algo sale mal: te equivocás cargando algo, una actualización de la app falla, o se rompe la computadora.</p>

        <p><strong>Hay tres tipos de copias</strong></p>
        <ul>
          <li><strong>Automáticas:</strong> la app hace sola una por día, la primera vez que la abrís, y se queda con las últimas 30. No tenés que hacer nada. Quedan en <em>esta misma computadora</em>, así que te salvan de un error o de una actualización fallida, pero <strong>no</strong> si se rompe el disco o se la llevan.</li>
          <li><strong>Automática fuera de la computadora (la más importante):</strong> en <em>Menú → Copia de seguridad → Elegir carpeta</em> elegís una carpeta de <strong>Google Drive</strong> (o un pendrive) y la app guarda ahí una copia sola: al abrirla, cada 30 minutos mientras está abierta y al cerrarla. Se queda con las últimas 14. Si la computadora se rompe o se la llevan, esta es la copia que te salva. Si deja de funcionar (Drive cerrado, pendrive sacado), la app te avisa.</li>
          <li><strong>Manuales:</strong> las hacés vos desde <em>Menú → Copia de seguridad → Guardar una copia ahora</em>, por ejemplo para llevarte una en un pendrive.</li>
        </ul>

        <p><strong>Cómo volver atrás (restaurar)</strong></p>
        <ol>
          <li>Andá a <em>Menú → Copia de seguridad</em>.</li>
          <li>En "Copias automáticas" elegí la fecha a la que querés volver y apretá <em>Restaurar</em>. Si la copia está en un pendrive, usá <em>Restaurar desde un archivo</em>.</li>
          <li>Leé el aviso y confirmá. La app se reinicia sola con todo como estaba ese día.</li>
        </ol>
        <div class="manual-tip alerta">
          <strong>Ojo: restaurar borra lo que cargaste después</strong>
          Si restaurás la copia del martes, se pierde todo lo que cargaste del miércoles en adelante. Por eso, si vas a restaurar, elegí la copia del día <em>anterior</em> al problema, y no una más vieja de lo necesario. Antes de reemplazar, la app guarda una copia de lo que había, por si te arrepentís: aparece en la lista como "Antes de restaurar".
        </div>
      </section>

      <section id="m-usuarios">
        <h3>Usuarios (administrador y empleados)</h3>
        <p>La primera contraseña que creaste es la del <strong>administrador</strong> (vos o el dueño): ve todo, incluida la plata del negocio. Si sumás empleados, cada uno entra con su propia contraseña y en su menú lateral aparecen sueltos, sin agrupar, solo <em>Pedidos</em>, <em>Facturas</em>, <em>Cobros</em> y <em>Clientes</em> — no ve Gastos, Caja, Cheques, Proveedores ni Estadísticas.</p>

        <p><strong>Agregar un empleado</strong></p>
        <ol>
          <li>Menú → <em>Usuarios</em> (solo lo ve el administrador).</li>
          <li>Apretá <em>+ Agregar usuario</em>, ponele un nombre y una contraseña, y elegí <em>Empleado</em>.</li>
          <li>Guardá. Esa persona ya puede entrar con su nombre y esa contraseña.</li>
        </ol>
        <p>Desde el <em>⋮</em> de cada uno podés <em>Editar</em> (nombre o tipo), <em>Resetear contraseña</em> (si se la olvidó) o <em>Dar de baja</em> (deja de poder entrar, sin borrar nada de lo que cargó). Siempre tiene que quedar al menos un administrador activo.</p>

        <p><strong>Si un empleado anula un cobro o una factura</strong></p>
        <p>Le pide el motivo siempre (al administrador, no). Al administrador le aparece un aviso ("Anulaciones de empleados para revisar") con la campanita; al tocarlo, te lleva directo a Facturas con el filtro <em>Ver: Anuladas</em> puesto, para revisarlas todas juntas (si la anulación fue de un cobro, en cambio, se revisa desde la ficha del cliente). Si al revisarla ves que estuvo mal, desde la ficha del cliente o la pestaña Facturas apretás <em>Reactivar</em>, se deshace y el aviso desaparece; si no hacés nada, se considera aprobada.</p>
      </section>

      <section id="m-consejos">
        <h3>Consejos y dudas frecuentes</h3>

        <p><strong>Se puede usar todo con el teclado</strong></p>
        <ul>
          <li><strong>Flechas ↑ ↓ ← →:</strong> te mueven por toda la pantalla, al campo, botón, fila o pestañita más cercano en esa dirección. En una fila de una lista, → te lleva a sus botones ($, WhatsApp, ⋮). Cuando escribís en un campo, ← y → mueven el cursor del texto, y si el cursor ya está al final (→) o al principio (←), o el campo está vacío, pasan al campo de al lado; ↑ ↓ pasan al campo de arriba o de abajo.</li>
          <li><strong>Enter:</strong> abre o despliega la fila que tengas marcada, aprieta el botón marcado, guarda cuando estás editando (cliente, producto, método de pago) y confirma las ventanas de confirmación. Las confirmaciones que borran o anulan algo (Sí, borrar / Sí, anular / Sí, dar de baja...) no se confirman con Enter a propósito: hay que llegar al botón y apretarlo.</li>
          <li><strong>Cmd + Enter</strong> (Ctrl + Enter en Windows): guarda la factura o el pedido que estás cargando.</li>
          <li>Al escribir el nombre del cliente o del producto, ↑ ↓ te mueven entre las sugerencias y Enter elige una. Con Alt + ↓ se abre la lista completa sin escribir.</li>
          <li>Después de cargar la cantidad de un producto, apretá Enter en vez de hacer clic en el <em>+</em>.</li>
          <li>En un menú de tres puntitos (⋮), ↑ ↓ recorren las opciones.</li>
          <li>Escape cierra cualquier ventana o menú abierto.</li>
          <li>En los casilleros de plata, el <em>punto del teclado numérico</em> escribe la coma de los centavos (ej.: 1500,50). El punto de arriba, el de las letras, no se usa en la plata.</li>
        </ul>

        <p><strong>Si me voy a otra pantalla mientras cargo un pedido o una factura</strong></p>
        <p>No pasa nada: al volver, sigue todo como lo dejaste (el cliente, el tipo de precio, los productos que ya agregaste y lo que estabas escribiendo). Se borra cuando guardás, cuando apretás <em>Limpiar</em> o cuando cerrás la app.</p>

        <p><strong>Los filtros</strong></p>
        <p>En las listas con un botón <em>Filtros</em> (Gastos, Fondos personales, Clientes, el detalle de cobros del cierre), el número que aparece en el botón dice cuántos filtros hay puestos. Adentro del panel, <em>Limpiar filtros</em> los saca todos de una vez.</p>

        <p><strong>Volver arriba en una pantalla larga</strong></p>
        <p>Cuando bajás mucho (en esta guía, o en una lista con muchas filas), aparece una flechita redonda abajo a la derecha. Tocala y volvés al principio de la pantalla.</p>

        <p><strong>Me equivoqué en una factura, ¿qué hago?</strong></p>
        <p>Si fue hoy mismo: editala. Si fue otro día o la venta no va más: anulala, con el motivo si querés — así queda un registro en vez de desaparecer sin explicación.</p>

        <p><strong>Le quiero hacer un descuento a un cliente puntual</strong></p>
        <p>Al cargar la línea del producto, el precio ya viene completado con el de la lista, pero lo podés borrar y escribir el que le vas a cobrar a ese cliente. No cambia el precio del producto para nadie más.</p>

        <p><strong>¿La app funciona sin internet?</strong></p>
        <p>Sí, para cargar facturas, clientes y productos no hace falta internet. Lo único que sí lo necesita es enviar mensajes por WhatsApp.</p>
      </section>

    </div>
  `;

  document.getElementById('btn-volver-menu').addEventListener('click', () => {
    renderFacturas();
  });
  vincularBuscadorManual();
}

// Buscar por palabras dentro del manual: se quedan solo los temas donde aparecen todas las palabras, marcadas.
function vincularBuscadorManual() {
  const contenido = document.querySelector('.manual-contenido');
  const original = contenido.innerHTML;
  const secciones = () => Array.from(contenido.querySelectorAll('section'));
  const enlaces = Array.from(document.querySelectorAll('.manual-indice a'));
  const input = document.getElementById('manual-buscar');
  const cuenta = document.getElementById('manual-buscar-cuenta');
  const acentos = { a: 'aáàäâ', e: 'eéèëê', i: 'iíìïî', o: 'oóòöô', u: 'uúùüû', n: 'nñ' };
  const patron = (palabra) => palabra.split('').map((c) => (acentos[c] ? `[${acentos[c]}]` : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
  const marcar = (nodo, regex) => {
    const hijos = Array.from(nodo.childNodes);
    hijos.forEach((h) => {
      if (h.nodeType === 3) {
        if (!regex.test(h.nodeValue)) return;
        regex.lastIndex = 0;
        const span = document.createElement('span');
        span.innerHTML = esc(h.nodeValue).replace(regex, '<mark class="manual-marca">$1</mark>');
        h.replaceWith(...span.childNodes);
      } else if (h.nodeType === 1 && h.tagName !== 'MARK') {
        marcar(h, regex);
      }
    });
  };
  input.addEventListener('input', () => {
    const palabras = normalizarTexto(input.value.trim()).split(/\s+/).filter(Boolean);
    contenido.innerHTML = original;
    if (!palabras.length) {
      secciones().forEach((sec) => (sec.hidden = false));
      enlaces.forEach((a) => (a.hidden = false));
      cuenta.textContent = '';
      return;
    }
    let visibles = 0;
    secciones().forEach((sec) => {
      const coincide = palabras.every((p) => normalizarTexto(sec.textContent).includes(p));
      sec.hidden = !coincide;
      if (coincide) visibles += 1;
      const enlace = enlaces.find((a) => a.getAttribute('href') === `#${sec.id}`);
      if (enlace) enlace.hidden = !coincide;
    });
    const regex = new RegExp(`(${palabras.map(patron).join('|')})`, 'gi');
    secciones().filter((sec) => !sec.hidden).forEach((sec) => marcar(sec, regex));
    cuenta.textContent = visibles ? `${visibles} ${visibles === 1 ? 'tema' : 'temas'}` : `No encontré nada con «${input.value.trim()}».`;
    contenido.querySelector('.manual-marca')?.scrollIntoView({ block: 'center' });
  });
  input.focus();
}
