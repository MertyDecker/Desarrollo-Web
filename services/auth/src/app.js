'use strict';

const crypto = require('node:crypto');
const Fastify = require('fastify');
const { instalarAutenticacionDeServicio, soloLlamadores } = require('./serviceAuth');
const { hashPassword, verifyPassword } = require('./password');
const { firmarJwt, ISSUER, AUDIENCE } = require('./jwt');

const TOKEN_TTL_SEG = 15 * 60; // sesiones cortas: 15 minutos
const MAX_INTENTOS = 5; // intentos fallidos antes del bloqueo temporal
const BLOQUEO_MS = 15 * 60 * 1000;

// Política mínima: 8 a 128 caracteres, al menos una letra y un número.
const PASSWORD_SCHEMA = {
  type: 'string',
  minLength: 8,
  maxLength: 128,
  pattern: '^(?=.*[A-Za-z])(?=.*[0-9]).+$'
};
const CORREO_SCHEMA = { type: 'string', format: 'email', maxLength: 120 };

/**
 * Servicio de autenticación. Custodia las credenciales (hash de contraseña,
 * rol y estado) y emite los tokens de sesión. No guarda datos personales:
 * esos pertenecen a clients.
 *
 * @param opciones.repo          credenciales y tokens revocados (ver repo.mongo.js)
 * @param opciones.serviceTokens { gateway: '...', clients: '...' }
 * @param opciones.privateKeyPem clave privada ES256 para firmar los JWT
 * @param opciones.ahora         reloj inyectable (pruebas)
 */
function buildApp({ repo, serviceTokens, privateKeyPem, ahora = () => Date.now(), logger = false }) {
  if (!privateKeyPem) throw new Error('Falta la clave privada para firmar tokens.');

  const app = Fastify({
    logger,
    requestIdHeader: 'x-request-id',
    ajv: { customOptions: { removeAdditional: false } }
  });

  // Hash de referencia: se usa cuando el correo no existe, para que la
  // respuesta tarde lo mismo y no revele qué correos están registrados.
  const hashDeRelleno = hashPassword('relleno-no-es-una-clave-real-1');

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: 'Solicitud inválida', detalle: error.message });
    }
    request.log.error({ err: error }, 'error no controlado');
    return reply.code(500).send({ error: 'Error interno' });
  });

  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: 'Ruta no encontrada' }));

  instalarAutenticacionDeServicio(app, serviceTokens);

  app.get('/health', async () => ({ status: 'ok', service: 'auth' }));

  // ---- Alta de credencial (la pide clients durante el registro) -----------
  app.post(
    '/internal/credentials',
    {
      preHandler: soloLlamadores('clients'),
      schema: {
        body: {
          type: 'object',
          required: ['clienteId', 'correo', 'password'],
          additionalProperties: false,
          properties: {
            clienteId: { type: 'string', minLength: 1, maxLength: 64 },
            correo: CORREO_SCHEMA,
            password: PASSWORD_SCHEMA
          }
        }
      }
    },
    async (request, reply) => {
      const { clienteId, correo, password } = request.body;
      const passwordHash = await hashPassword(password);
      try {
        await repo.crearCredencial({
          clienteId,
          correo: correo.toLowerCase(),
          passwordHash,
          rol: 'cliente', // el rol nunca lo decide quien se registra
          estado: 'pendiente'
        });
      } catch (err) {
        if (err.code === 'DUPLICADO') return reply.code(409).send({ error: 'La credencial ya existe' });
        throw err;
      }
      return reply.code(201).send({ clienteId, estado: 'pendiente' });
    }
  );

  // ---- Activación tras validar el correo ----------------------------------
  app.post(
    '/internal/credentials/:clienteId/activate',
    { preHandler: soloLlamadores('clients') },
    async (request, reply) => {
      const ok = await repo.activar(request.params.clienteId);
      if (!ok) return reply.code(404).send({ error: 'Credencial no encontrada' });
      return reply.code(204).send();
    }
  );

  // ---- Compensación: si el registro falla a mitad de camino ---------------
  app.delete(
    '/internal/credentials/:clienteId',
    { preHandler: soloLlamadores('clients') },
    async (request, reply) => {
      // Solo se pueden eliminar credenciales que nunca se activaron.
      await repo.eliminarPendiente(request.params.clienteId);
      return reply.code(204).send();
    }
  );

  // ---- S10 Iniciar sesión --------------------------------------------------
  app.post(
    '/login',
    {
      preHandler: soloLlamadores('gateway'),
      schema: {
        body: {
          type: 'object',
          required: ['correo', 'password'],
          additionalProperties: false,
          properties: {
            correo: CORREO_SCHEMA,
            password: { type: 'string', minLength: 1, maxLength: 128 }
          }
        }
      }
    },
    async (request, reply) => {
      const correo = request.body.correo.toLowerCase();
      const { password } = request.body;
      const credencial = await repo.buscarPorCorreo(correo);
      const invalidas = { error: 'Correo o contraseña incorrectos' };

      if (!credencial) {
        await verifyPassword(password, await hashDeRelleno);
        return reply.code(401).send(invalidas);
      }
      if (credencial.bloqueadoHasta && credencial.bloqueadoHasta > ahora()) {
        return reply.code(429).send({ error: 'Demasiados intentos. Intenta más tarde.' });
      }
      const ok = await verifyPassword(password, credencial.passwordHash);
      if (!ok) {
        await repo.registrarFallo(credencial.clienteId, {
          maxIntentos: MAX_INTENTOS,
          bloqueoHasta: ahora() + BLOQUEO_MS
        });
        return reply.code(401).send(invalidas);
      }
      // El estado se revela solo a quien ya demostró conocer la contraseña.
      if (credencial.estado !== 'activo') {
        return reply.code(403).send({ error: 'Debes validar tu correo antes de iniciar sesión' });
      }
      await repo.reiniciarFallos(credencial.clienteId);

      const iat = Math.floor(ahora() / 1000);
      const token = firmarJwt(
        {
          iss: ISSUER,
          aud: AUDIENCE,
          sub: credencial.clienteId,
          rol: credencial.rol,
          jti: crypto.randomUUID(),
          iat,
          exp: iat + TOKEN_TTL_SEG
        },
        privateKeyPem
      );
      return { token, tipo: 'Bearer', expiraEn: TOKEN_TTL_SEG, rol: credencial.rol };
    }
  );

  // ---- S11 Cerrar sesión: revoca el token ---------------------------------
  // El gateway ya verificó la firma y envía el identificador (jti) y el
  // vencimiento del token: el token completo no viaja a este endpoint.
  app.post('/logout', { preHandler: soloLlamadores('gateway') }, async (request, reply) => {
    const jti = request.headers['x-token-jti'];
    const exp = Number(request.headers['x-token-exp']);
    if (typeof jti !== 'string' || !jti || !Number.isFinite(exp)) {
      return reply.code(400).send({ error: 'Solicitud inválida' });
    }
    await repo.revocar(jti, new Date(exp * 1000));
    return reply.code(204).send();
  });

  // ---- Consulta de revocación (la hace el gateway en cada ruta protegida) --
  app.get(
    '/internal/tokens/:jti',
    { preHandler: soloLlamadores('gateway') },
    async (request) => ({ revoked: await repo.estaRevocado(request.params.jti) })
  );

  return app;
}

module.exports = { buildApp, TOKEN_TTL_SEG, MAX_INTENTOS };
