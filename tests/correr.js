// Corre todos los tests (tests/*.test.js), cada uno en su propio proceso, con Electron funcionando como Node
// (better-sqlite3 está compilado para Electron). Uso: npm test
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const electron = require('electron');
const archivos = fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js')).sort();
const filtro = process.argv[2];
let fallaron = 0;

for (const archivo of archivos) {
  if (filtro && !archivo.includes(filtro)) continue;
  console.log(`\n=== ${archivo}`);
  const r = spawnSync(electron, [path.join(__dirname, archivo)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  if (r.status !== 0) fallaron += 1;
}

console.log(fallaron === 0 ? '\nTodos los tests pasaron.' : `\nFallaron ${fallaron} archivo(s) de tests.`);
process.exit(fallaron === 0 ? 0 : 1);
