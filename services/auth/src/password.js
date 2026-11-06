'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

// Hash adaptativo con sal (scrypt). Los parámetros quedan guardados junto al
// hash, así se pueden endurecer en el futuro sin invalidar las claves antiguas.
const N = 16384;
const R = 8;
const P = 1;
const LARGO = 64;

async function hashPassword(password) {
  const sal = crypto.randomBytes(16);
  const hash = await scrypt(password, sal, LARGO, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, guardado) {
  const partes = String(guardado).split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, salB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, 'base64');
  const calculado = await scrypt(password, Buffer.from(salB64, 'base64'), esperado.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p)
  });
  return crypto.timingSafeEqual(calculado, esperado);
}

module.exports = { hashPassword, verifyPassword };
