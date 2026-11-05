'use strict';

const crypto = require('node:crypto');

// JWT firmado con ES256 (clave asimétrica P-256).
// - auth tiene la clave PRIVADA y es el único que puede emitir tokens.
// - el API Gateway solo tiene la clave PÚBLICA: puede verificar, pero no emitir.
// Así no se comparte un mismo secreto entre servicios.

const ISSUER = 'fukusuke-auth';
const AUDIENCE = 'fukusuke-gateway';

const b64u = (valor) => Buffer.from(valor).toString('base64url');

function firmarJwt(payload, privateKeyPem) {
  const header = { alg: 'ES256', typ: 'JWT' };
  const datos = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const firma = crypto.sign('sha256', Buffer.from(datos), {
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363'
  });
  return `${datos}.${b64u(firma)}`;
}

module.exports = { firmarJwt, ISSUER, AUDIENCE };
