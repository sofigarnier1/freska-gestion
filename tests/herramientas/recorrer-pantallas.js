// Recorre TODAS las pantallas de la barra lateral y cada una de sus pastillas en la vista previa (mock) y avisa si alguna da
// error o queda vacía. No es parte de `npm test`: se pega en el navegador de vista previa (`javascript_exec`), ya con la sesión
// iniciada (Administrador / 1234). Se corre en tandas cortas porque el panel del navegador corta los scripts largos (~45 s):
//
//   1) pegar este archivo entero (deja `__sweep` y el registro de errores en `window`);
//   2) por cada tanda de 4 o 5 pantallas:  const out = []; for (const v of ['pedidos','facturas','cobros','clientes']) out.push(await __sweep(v)); out
//      (las vistas salen de `[...document.querySelectorAll('#sidebar [data-view]')].map(b => b.dataset.view)`).
//
// Antes conviene cargar algo de todo (saldos de la Caja, un ingreso y un pase de Fondos personales, un pedido por unidad…)
// para que las pantallas tengan qué dibujar. Cada línea dice "ok" o los errores que saltaron.
(() => {
  const w = (ms) => new Promise((r) => setTimeout(r, ms));
  if (window.__sweep) return;
  window.__errs2 = [];
  window.addEventListener('error', (e) => __errs2.push(`error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => __errs2.push(`rej: ${(e.reason && e.reason.message) || e.reason}`));
  const consolaError = console.error;
  console.error = (...a) => {
    __errs2.push(`console: ${a.map((x) => (x && x.message) || String(x)).join(' ').slice(0, 200)}`);
    consolaError(...a);
  };
  window.__sweep = async (vista) => {
    const antes = __errs2.length;
    await irAVista(botonDeVista(vista));
    await w(350);
    const pastillas = [...document.querySelectorAll('#app .toggle')].length;
    for (let i = 0; i < pastillas; i += 1) {
      const t = [...document.querySelectorAll('#app .toggle')][i];
      if (t) {
        t.click();
        await w(350);
      }
    }
    return `${vista}: ${document.querySelector('#app').innerText.length > 30 ? 'ok' : 'VACÍA'} [${pastillas} pastillas]${__errs2.length > antes ? ` ERRORES: ${__errs2.slice(antes).join(' | ')}` : ''}`;
  };
})();
