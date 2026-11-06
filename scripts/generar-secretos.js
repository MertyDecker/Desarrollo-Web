'use strict';

/**
 * Genera los secretos locales en la carpeta ./secrets (ignorada por git).
 *
 *   Con Docker (no requiere Node instalado):
 *     docker run --rm -v "${PWD}:/work" -w /work node:22-alpine node scripts/generar-secretos.js
 *   Con Node:
 *     node scripts/generar-secretos.js
 *
 * No sobrescribe secretos existentes. Para rotarlos todos: agregar --rotar
 * (después hay que reiniciar los contenedores; las sesiones abiertas se cierran).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIR = path.join(process.cwd(), 'secrets');
const rotar = process.argv.includes('--rotar');

const token = () => crypto.randomBytes(32).toString('hex');

function escribir(nombre, contenido) {
  const ruta = path.join(DIR, nombre);
  if (fs.existsSync(ruta) && !rotar) {
    console.log(`  = ${nombre} (ya existía, se conserva)`);
    return false;
  }
  // 0644: en Docker Compose (sin Swarm) los secretos se montan con los permisos del
  // archivo, y los servicios corren como usuario "node", no como root.
  fs.writeFileSync(ruta, contenido, { mode: 0o644 });
  console.log(`  + ${nombre}`);
  return true;
}

fs.mkdirSync(DIR, { recursive: true });
console.log(`Secretos en ${DIR}:`);

// Par de claves para firmar (auth) y verificar (gateway) los JWT.
if (rotar || !fs.existsSync(path.join(DIR, 'jwt_private.pem'))) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  escribir('jwt_private.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }));
  escribir('jwt_public.pem', publicKey.export({ type: 'spki', format: 'pem' }));
} else {
  console.log('  = jwt_private.pem / jwt_public.pem (ya existían, se conservan)');
}

// Un token distinto por cada par consumidor -> servicio.
escribir('svc_token_gateway_inventory.txt', token());
escribir('svc_token_gateway_clients.txt', token());
escribir('svc_token_gateway_auth.txt', token());
escribir('svc_token_clients_auth.txt', token());

// Contraseña inicial del administrador (se muestra una sola vez).
const adminPass = `Adm${crypto.randomBytes(9).toString('base64url')}9`;
if (escribir('admin_password.txt', adminPass)) {
  console.log(`\nContraseña del administrador: ${adminPass}`);
  console.log('Guárdala; también queda en secrets/admin_password.txt (no se sube a GitHub).');
}
