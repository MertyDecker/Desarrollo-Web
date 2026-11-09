'use strict';

/**
 * Ejecuta las pruebas automatizadas de todos los servicios: `npm run pruebas`.
 * No necesita el backend en ejecución (usan repositorios en memoria y servicios
 * falsos). Instala dependencias si faltan.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SERVICIOS = ['inventory', 'auth', 'clients', 'orders', 'payments', 'graphql-gateway', 'api-gateway'];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const opciones = (cwd, extra = {}) => ({ cwd, encoding: 'utf8', shell: process.platform === 'win32', ...extra });

let total = 0;
let fallidas = 0;
for (const s of SERVICIOS) {
  const dir = path.join(__dirname, '..', 'services', s);
  if (!fs.existsSync(path.join(dir, 'node_modules'))) spawnSync(npm, ['ci', '--no-audit', '--no-fund', '--loglevel=error'], opciones(dir, { stdio: 'inherit' }));
  const r = spawnSync(npm, ['test', '--silent'], opciones(dir));
  const salida = `${r.stdout}${r.stderr}`;
  const pass = Number((salida.match(/^# pass (\d+)/m) || [])[1] || 0);
  const fail = Number((salida.match(/^# fail (\d+)/m) || [])[1] || 0);
  total += pass + fail;
  fallidas += fail;
  console.log(`${fail === 0 && r.status === 0 ? 'OK   ' : 'FALLA'} ${s.padEnd(16)} ${pass} aprobadas, ${fail} fallidas`);
  if (fail || r.status !== 0) console.log(salida.split('\n').filter((l) => /not ok|Error|expected|actual/.test(l)).slice(0, 15).join('\n'));
}
console.log(`\nTotal: ${total - fallidas}/${total} pruebas aprobadas.`);
process.exit(fallidas ? 1 : 0);
