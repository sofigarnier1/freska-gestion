// Auditoría de paneles flotantes y cuadros de diálogo: abre, en cada pantalla, todo lo que flota (filtros, ayudas "?",
// menús ⋮, calendarios, listas de autocompletar, avisos, menú del usuario) y comprueba que no se salga de la ventana ni
// quede cortado o tapado; también prueba un cuadro de diálogo muy alto. Usa una ventana oculta de Electron con la pantalla
// de prueba (mock), así que no toca ninguna base. NO forma parte de `npm test` (necesita abrir una ventana).
// Uso:  ELECTRON_RUN_AS_NODE= node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/herramientas/auditoria-paneles.js 800x600
// (sin el argumento usa 800x600; conviene probar 640x520, 800x600 y 1000x700). Imprime los problemas encontrados.
// Con un segundo argumento `abajo` cada botón se prueba pegado al borde de abajo de la ventana (los paneles tienen que abrirse
// hacia arriba); sin él, en el medio.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const TAM = process.argv[2] || '800x600';
const BLOQUE = process.argv[3] === 'abajo' ? 'end' : 'center';
const PROY = path.join(__dirname, '..', '..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'freska-auditoria-')));
const AUDITAR = `
(async () => {
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const problemas = []; const vw = innerWidth, vh = innerHeight;
  const set = (id, v) => { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
  set('pin-nuevo', '1234'); set('pin-confirmar', '1234'); set('pin-ingresar', '1234'); document.querySelector('.pin-card button.primary')?.click(); await esperar(700);
  const cats = await window.freska.gastos.categorias();
  await window.freska.gastos.crear({ fecha: '2026-09-21', categoria_id: cats[0].id, descripcion: 'Expensas', monto: 200000, medio_pago: 'Débito', cuenta: '', tarjeta: '', observacion: '' });
  const flot = () => { const s = new Set(); document.body.querySelectorAll('*').forEach((el) => { const cs = getComputedStyle(el); if ((cs.position === 'absolute' || cs.position === 'fixed') && cs.display !== 'none' && cs.visibility !== 'hidden') { const r = el.getBoundingClientRect(); if (r.width > 60 && r.height > 24 && !el.closest('#sidebar') && !el.closest('#toast') && el.id !== 'btn-subir' && el.id !== 'modal-overlay') s.add(el); } }); return s; };
  const revisar = (panel, cual) => { const r = panel.getBoundingClientRect(); const m = [];
    if (r.right > vw + 1) m.push('se sale por la derecha ' + Math.round(r.right - vw) + 'px'); if (r.bottom > vh + 1) m.push('se sale por abajo ' + Math.round(r.bottom - vh) + 'px'); if (r.top < -1) m.push('se sale por arriba ' + Math.round(-r.top) + 'px'); if (r.left < -1) m.push('se sale por la izquierda ' + Math.round(-r.left) + 'px');
    const pts = [[r.left + 5, r.top + 5], [r.right - 5, r.top + 5], [r.left + 5, r.bottom - 5], [r.right - 5, r.bottom - 5], [(r.left + r.right) / 2, r.bottom - 5]];
    let t = 0; pts.forEach(([x, y]) => { if (x < 0 || y < 0 || x >= vw || y >= vh) return; const el = document.elementFromPoint(x, y); if (el && !panel.contains(el) && !el.contains(panel)) t++; });
    if (t) m.push('cortado/tapado en ' + t + ' de 5 puntos');
    if (m.length) problemas.push(cual.vista + ' · ' + cual.disparador + ' → ' + (panel.className || panel.id || panel.tagName) + ' :: ' + m.join('; ')); };
  const cerrar = async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.body.click(); await esperar(60); };
  const vistas = [...document.querySelectorAll('#sidebar [data-view]')].map((b) => b.dataset.view);
  let probados = 0;
  for (const v of vistas) { document.querySelector('#sidebar [data-view="' + v + '"]').click(); await esperar(400);
    const ds = [...document.querySelectorAll('#app .btn-filtros, #app .btn-ayuda-est, #app .btn-menu-fila, #app .selector-fecha-campo button, #app input[id$="-buscar"]')].slice(0, 16);
    for (let i = 0; i < ds.length; i++) { const d = ds[i]; if (!d.isConnected || d.disabled) continue; const antes = flot();
      d.scrollIntoView({ block: '${BLOQUE}' }); await esperar(30); d.click(); if (d.tagName === 'INPUT') { d.focus(); d.dispatchEvent(new Event('input', { bubbles: true })); } await esperar(120); probados++;
      [...flot()].filter((el) => !antes.has(el)).forEach((el) => revisar(el, { vista: v, disparador: (d.className || d.id || d.tagName) + '#' + i }));
      await cerrar(); } }
  for (const id of ['btn-avisos', 'btn-menu-usuario']) { document.getElementById(id).click(); await esperar(300); flot().forEach((el) => revisar(el, { vista: 'encabezado', disparador: id })); await cerrar(); probados++; }
  // cuadros de diálogo: uno muy alto (sintético) y uno real con lista larga
  const modales = [];
  mostrarModal('<h3>Prueba alta</h3><div style="height:1400px;background:#444">contenido</div><div class="btn-group"><button id="m-fin">Fin</button></div>'); await esperar(200);
  let tarjeta = document.querySelector('.modal-card'); let r = tarjeta.getBoundingClientRect();
  modales.push('sintético alto: tarjeta ' + Math.round(r.top) + '→' + Math.round(r.bottom) + ' de ' + vh + (r.top >= 0 && r.bottom <= vh + 1 ? ' OK' : ' SE CORTA') + ', scrollea: ' + (tarjeta.scrollHeight > tarjeta.clientHeight));
  tarjeta.scrollTop = 99999; await esperar(80); const fin = document.getElementById('m-fin').getBoundingClientRect(); modales.push('botón final alcanzable: ' + (fin.bottom <= vh + 1 && fin.top >= 0));
  cerrarModal();
  const clientes = await window.freska.clientes.listar(); abrirSeleccionConsulta(clientes); await esperar(250);
  tarjeta = document.querySelector('.modal-card'); r = tarjeta.getBoundingClientRect(); modales.push('enviar consulta (lista de clientes): ' + Math.round(r.top) + '→' + Math.round(r.bottom) + ' de ' + vh + (r.top >= 0 && r.bottom <= vh + 1 ? ' OK' : ' SE CORTA'));
  cerrarModal();
  return JSON.stringify({ ventana: vw + 'x' + vh, probados, problemas, modales }, null, 1);
})()`;
app.whenReady().then(async () => {
  const [w, h] = TAM.split('x').map(Number);
  const win = new BrowserWindow({ show: false, useContentSize: true, width: w, height: h, webPreferences: { backgroundThrottling: false } });
  await win.loadFile(path.join(PROY, 'src/renderer/index.html'));
  await new Promise((r) => setTimeout(r, 600));
  console.log(await win.webContents.executeJavaScript(AUDITAR));
  app.quit();
});
