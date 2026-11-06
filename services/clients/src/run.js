'use strict';

// Validación del RUN chileno con dígito verificador (módulo 11).
// Devuelve el RUN normalizado "12345678-5" o null si no es válido.
function normalizarRun(entrada) {
  if (typeof entrada !== 'string') return null;
  const limpio = entrada.replace(/[.\s]/g, '').toUpperCase();
  const m = /^(\d{7,8})-?([\dK])$/.exec(limpio);
  if (!m) return null;
  const [, cuerpo, dv] = m;
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === esperado ? `${cuerpo}-${dv}` : null;
}

module.exports = { normalizarRun };
