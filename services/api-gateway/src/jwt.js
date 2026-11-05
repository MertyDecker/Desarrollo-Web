'use strict';

const crypto = require('node:crypto');

const ISSUER = 'fukusuke-auth';
const AUDIENCE = 'fukusuke-gateway';
const ROLES = ['cliente', 'admin'];

const json = (b64) => JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));

/**
 * Verifica un JWT ES256 con la clave PÚBLICA de auth.
 * Rechaza: otro algoritmo (incluido "none"), firma inválida, emisor o
 * audiencia distintos, token vencido o emitido en el futuro, rol desconocido.
 * Devuelve el payload o lanza un error.
 */
function verificarJwt(token, publicKeyPem, ahoraMs = Date.now()) {
  const partes = String(token).split('.');
  if (partes.length !== 3) throw new Error('formato inválido');
  const [h, p, f] = partes;

  const header = json(h);
  if (header.alg !== 'ES256' || header.typ !== 'JWT') throw new Error('algoritmo no permitido');

  const firmaOk = crypto.verify(
    'sha256',
    Buffer.from(`${h}.${p}`),
    { key: publicKeyPem, dsaEncoding: 'ieee-p1363' },
    Buffer.from(f, 'base64url')
  );
  if (!firmaOk) throw new Error('firma inválida');

  const payload = json(p);
  const ahora = Math.floor(ahoraMs / 1000);
  if (payload.iss !== ISSUER || payload.aud !== AUDIENCE) throw new Error('emisor o audiencia inválidos');
  if (typeof payload.exp !== 'number' || payload.exp <= ahora) throw new Error('token vencido');
  if (typeof payload.iat !== 'number' || payload.iat > ahora + 60) throw new Error('token emitido en el futuro');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('sujeto inválido');
  if (!ROLES.includes(payload.rol)) throw new Error('rol inválido');
  if (typeof payload.jti !== 'string' || !payload.jti) throw new Error('jti inválido');
  return payload;
}

module.exports = { verificarJwt, ISSUER, AUDIENCE };
