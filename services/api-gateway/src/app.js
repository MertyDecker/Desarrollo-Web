'use strict';

const Fastify = require('fastify');
const rateLimit = require('@fastify/rate-limit');
const cors = require('@fastify/cors');
const { ROUTES } = require('./routes');
const { verificarJwt } = require('./jwt');

/**
 * API Gateway: ÚNICO componente expuesto al navegador.
 *
 * Responsabilidades del gateway:
 *  - lista blanca de verbo + ruta (routes.js); el resto responde 404
 *  - autenticación (JWT ES256) y autorización por rol en cada ruta
 *  - límites de solicitudes, tamaño máximo de cuerpo y tiempo de espera
 *  - descartar cabeceras de identidad que envíe el navegador y transmitir
 *    solo contexto verificado (x-user-id, x-user-role)
 *  - presentar ante cada servicio interno su propia credencial de servicio
 *  - errores controlados: nunca reenvía detalles internos
 *
 * Responsabilidades que se quedan en cada servicio: validar los datos de
 * negocio, la propiedad de cada recurso y volver a revisar el rol.
 *
 * @param config.publicKeyPem   clave pública ES256 de auth
 * @param config.upstreams      { inventory: 'http://inventory:3001', ... }
 * @param config.serviceTokens  { inventory: '...', clients: '...', auth: '...' }
 * @param config.corsOrigin     origen permitido del frontend (o false)
 * @param config.timeoutMs      tiempo máximo de espera hacia un servicio
 * @param config.limiteGlobal   solicitudes por minuto por IP (por defecto 120)
 * @param config.factorLimites  multiplicador de todos los límites (1; solo la prueba de carga lo sube)
 */
async function buildApp({ config, logger = false, ahora = () => Date.now() }) {
  const { publicKeyPem, upstreams, serviceTokens } = config;
  const timeoutMs = config.timeoutMs ?? 5000;

  for (const r of ROUTES) {
    if (!upstreams[r.destino.servicio] || !serviceTokens[r.destino.servicio]) {
      throw new Error(`Falta URL o token de servicio para ${r.destino.servicio}`);
    }
  }
  if (!publicKeyPem) throw new Error('Falta la clave pública para verificar tokens.');

  const app = Fastify({
    logger: logger && {
      ...(typeof logger === 'object' ? logger : {}),
      redact: ['req.headers.authorization', 'req.headers["x-service-token"]']
    },
    requestIdHeader: 'x-request-id',
    bodyLimit: 100 * 1024 // 100 KB es más que suficiente para estos contratos
  });

  await app.register(cors, {
    // Lista con un solo origen: la cabecera solo se envía si el origen coincide.
    origin: config.corsOrigin ? [config.corsOrigin] : false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['content-type', 'authorization', 'x-request-id', 'idempotency-key'],
    exposedHeaders: ['x-request-id', 'idempotent-replay']
  });

  await app.register(rateLimit, {
    max: (config.limiteGlobal ?? 120) * (config.factorLimites ?? 1),
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ statusCode: 429, error: 'Demasiadas solicitudes. Intenta en un momento.' })
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('cache-control', 'no-store');
    reply.header('referrer-policy', 'no-referrer');
  });

  app.setErrorHandler((error, request, reply) => {
    if (error.statusCode === 429) return reply.code(429).send({ error: 'Demasiadas solicitudes. Intenta en un momento.' });
    if (error.statusCode && error.statusCode < 500) {
      // Errores de forma de la solicitud (JSON mal formado, cuerpo muy grande, etc.).
      return reply.code(error.statusCode).send({ error: 'Solicitud inválida' });
    }
    request.log.error({ err: error }, 'error no controlado en el gateway');
    return reply.code(500).send({ error: 'Error interno' });
  });

  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: 'Ruta no encontrada' }));

  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok', service: 'api-gateway' }));

  // ---- Autenticación y autorización -----------------------------------------
  async function revocado(jti) {
    const res = await fetch(`${upstreams.auth}/internal/tokens/${encodeURIComponent(jti)}`, {
      headers: { 'x-service-token': serviceTokens.auth },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) throw new Error(`auth respondió ${res.status}`);
    return (await res.json()).revoked === true;
  }

  function autorizar(ruta) {
    return async (request, reply) => {
      const cabecera = request.headers.authorization || '';
      const [tipo, token] = cabecera.split(' ');
      if (tipo !== 'Bearer' || !token) {
        reply.header('www-authenticate', 'Bearer');
        return reply.code(401).send({ error: 'Autenticación requerida' });
      }
      let payload;
      try {
        payload = verificarJwt(token, publicKeyPem, ahora());
      } catch {
        reply.header('www-authenticate', 'Bearer error="invalid_token"');
        return reply.code(401).send({ error: 'Token inválido o vencido' });
      }
      // Si no se puede confirmar la revocación, se rechaza (falla cerrado).
      try {
        if (await revocado(payload.jti)) return reply.code(401).send({ error: 'Sesión cerrada' });
      } catch (err) {
        request.log.error({ err }, 'no se pudo consultar la revocación');
        return reply.code(503).send({ error: 'Servicio temporalmente no disponible' });
      }
      if (!ruta.acceso.includes(payload.rol)) {
        return reply.code(403).send({ error: 'Acceso denegado' });
      }
      request.usuario = { id: payload.sub, rol: payload.rol, jti: payload.jti, exp: payload.exp };
    };
  }

  // ---- Reenvío controlado hacia el servicio interno ---------------------------
  function reenviar(ruta) {
    return async (request, reply) => {
      const { servicio } = ruta.destino;
      let destino = ruta.destino.ruta.replace(/:(\w+)/g, (_, p) => encodeURIComponent(request.params[p]));
      const query = request.raw.url.split('?')[1];
      if (query) destino += `?${query}`;

      // Las cabeceras se construyen desde cero: nada de lo que mande el
      // navegador (x-user-id, x-user-role, x-service-token...) pasa tal cual.
      const headers = { 'x-request-id': request.id, 'x-service-token': serviceTokens[servicio] };
      if (request.usuario) {
        headers['x-user-id'] = request.usuario.id;
        headers['x-user-role'] = request.usuario.rol;
        if (ruta.reenviarToken) {
          headers['x-token-jti'] = request.usuario.jti;
          headers['x-token-exp'] = String(request.usuario.exp);
        }
      }
      for (const nombre of ruta.cabeceras || []) {
        const v = request.headers[nombre];
        if (typeof v === 'string' && v.length <= 256) headers[nombre] = v;
      }
      let body;
      if (request.body !== undefined && request.body !== null) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(request.body);
      }

      let res;
      try {
        res = await fetch(`${upstreams[servicio]}${destino}`, {
          method: ruta.metodo,
          headers,
          body,
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (err) {
        const vencido = err.name === 'TimeoutError' || err.name === 'AbortError';
        request.log.error({ servicio, motivo: err.name }, 'fallo al llamar a un servicio interno');
        return vencido
          ? reply.code(504).send({ error: 'El servicio tardó demasiado en responder' })
          : reply.code(502).send({ error: 'Servicio no disponible' });
      }

      // Un 401 del servicio significa que la credencial ENTRE servicios no
      // calza: es un problema de integración, no del usuario.
      if (res.status >= 500 || (res.status === 401 && !ruta.propagar401)) {
        request.log.error({ servicio, status: res.status }, 'respuesta de error de un servicio interno');
        return reply.code(502).send({ error: 'Servicio no disponible' });
      }
      const replay = res.headers.get('idempotent-replay');
      if (replay) reply.header('idempotent-replay', replay);
      if (res.status === 204) return reply.code(204).send();
      const texto = await res.text();
      reply.code(res.status).type('application/json; charset=utf-8');
      return reply.send(texto);
    };
  }

  for (const ruta of ROUTES) {
    app.route({
      method: ruta.metodo,
      url: ruta.ruta,
      config: ruta.limite ? { rateLimit: { max: ruta.limite * (config.factorLimites ?? 1), timeWindow: '1 minute' } } : {},
      preHandler: ruta.acceso === 'anonimo' ? undefined : autorizar(ruta),
      handler: reenviar(ruta)
    });
  }

  return app;
}

module.exports = { buildApp };
