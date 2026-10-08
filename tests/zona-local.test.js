// Ciudad y provincia del local: se guardan aparte de la dirección y se leen de vuelta (el recorrido de reparto las suma al
// buscar cada dirección en el mapa).
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./harness');

let db;
let invocar;
test.before(async () => {
  ({ db, invocar } = await iniciar());
});

test('la zona del local arranca vacía, se guarda sin espacios sobrantes y no pisa la dirección', async () => {
  db.prepare("DELETE FROM configuracion WHERE clave IN ('zona_local', 'direccion_local')").run();
  assert.deepEqual(await invocar('config:obtenerZonaLocal'), { ciudad: '', provincia: '' });
  await invocar('config:guardarDireccionLocal', 'Calle Falsa 123');
  await invocar('config:guardarZonaLocal', { ciudad: '  Mi Ciudad ', provincia: 'Mi Provincia' });
  assert.deepEqual(await invocar('config:obtenerZonaLocal'), { ciudad: 'Mi Ciudad', provincia: 'Mi Provincia' });
  assert.equal(await invocar('config:obtenerDireccionLocal'), 'Calle Falsa 123');
});
