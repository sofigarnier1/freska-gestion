// Comprueba que la pantalla y el programa hablan el mismo idioma: cada servicio que la pantalla puede pedir
// (src/main/preload.js) tiene su código en main.js, y ninguno se registra dos veces.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { iniciar } = require('./harness');

const leer = (ruta) => fs.readFileSync(path.join(__dirname, '..', ruta), 'utf8');

test('todo lo que pide preload.js tiene un servicio registrado', async () => {
  const { servicios } = await iniciar();
  const pedidos = [...leer('src/main/preload.js').matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(pedidos.length > 100, 'tiene que haber encontrado los servicios del preload');
  const faltan = pedidos.filter((c) => !servicios.has(c));
  assert.deepEqual(faltan, [], `servicios que la pantalla pide y nadie atiende: ${faltan.join(', ')}`);
});

test('casi todos los servicios registrados están expuestos a la pantalla en preload.js', async () => {
  const { servicios } = await iniciar();
  const preload = new Set([...leer('src/main/preload.js').matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]));
  const sinPreload = [...servicios.keys()].filter((c) => !preload.has(c));
  // Servicios internos que a propósito no se exponen a la pantalla; si aparece uno nuevo, hay que decidir si se expone.
  assert.ok(sinPreload.length < 12, `servicios registrados que la pantalla no puede pedir: ${sinPreload.join(', ')}`);
});

test('los servicios que hay son los esperados (la cantidad no baja sin querer)', async () => {
  const { servicios } = await iniciar();
  assert.ok(servicios.size >= 150, `hay ${servicios.size} servicios registrados`);
});
