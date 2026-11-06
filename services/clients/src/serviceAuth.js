'use strict';

const crypto = require('node:crypto');

// Compara dos secretos en tiempo constante (evita ataques de temporización).
function iguales(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Autenticación entre servicios. Cada consumidor interno tiene su propio token
 * (por ejemplo gateway -> inventory es distinto de clients -> auth), así una
 * credencial filtrada no abre todos los servicios.
 *
 * @param app Fastify
 * @param serviceTokens { nombreDelConsumidor: 'secreto', ... }
 */
function instalarAutenticacionDeServicio(app, serviceTokens, { rutasLibres = ['/health'] } = {}) {
  const entradas = Object.entries(serviceTokens || {}).filter(([, v]) => typeof v === 'string' && v.length >= 16);
  if (entradas.length === 0) {
    throw new Error('Se requiere al menos un token de servicio (mínimo 16 caracteres).');
  }
  app.decorateRequest('caller', null);
  app.addHook('onRequest', async (request, reply) => {
    const ruta = request.url.split('?')[0];
    if (rutasLibres.includes(ruta)) return;
    const recibido = request.headers['x-service-token'];
    let caller = null;
    if (typeof recibido === 'string') {
      for (const [nombre, secreto] of entradas) {
        if (iguales(recibido, secreto)) caller = nombre;
      }
    }
    if (!caller) return reply.code(401).send({ error: 'No autorizado' });
    request.caller = caller;
  });
}

// preHandler: la ruta solo acepta ciertos consumidores internos.
function soloLlamadores(...permitidos) {
  return async (request, reply) => {
    if (!permitidos.includes(request.caller)) {
      return reply.code(403).send({ error: 'Acceso denegado' });
    }
  };
}

module.exports = { instalarAutenticacionDeServicio, soloLlamadores, iguales };
