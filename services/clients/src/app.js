'use strict';

const crypto = require('node:crypto');
const Fastify = require('fastify');
const { instalarAutenticacionDeServicio, soloLlamadores } = require('./serviceAuth');
const { normalizarRun } = require('./run');

const CODIGO_TTL_MS = 15 * 60 * 1000;
const MAX_INTENTOS_CODIGO = 5;
const MAX_DIRECCIONES = 5;

const texto = (min, max) => ({ type: 'string', minLength: min, maxLength: max });
const DIRECCION = {
  type: 'object',
  required: ['direccion', 'comuna', 'region'],
  additionalProperties: false,
  properties: { direccion: texto(5, 150), comuna: texto(2, 60), region: texto(2, 60) }
};
const TELEFONO = { type: 'string', pattern: '^\\+?[0-9 ]{8,16}$' };

const sha256 = (v) => crypto.createHash('sha256').update(v).digest();

// Lo que el dueño ve de su propio perfil. Nunca incluye el código de
// verificación ni datos de otros clientes.
function aPerfil(c) {
  return {
    id: c.id,
    run: c.run,
    nombre: c.nombre,
    correo: c.correo,
    telefono: c.telefono,
    estado: c.estado,
    direcciones: c.direcciones || []
  };
}

/**
 * Servicio clients: registro, validación de correo, perfil y direcciones.
 * Es la autoridad sobre los datos personales. La contraseña NO se guarda aquí:
 * se entrega una sola vez a auth, que guarda solo su hash.
 *
 * La identidad del usuario llega en "x-user-id", que solo el gateway puede
 * fijar después de verificar el token (el gateway descarta esa cabecera si la
 * envía el navegador, y este servicio solo acepta llamadas del gateway).
 */
function buildApp({ repo, authClient, mailer, serviceTokens, ahora = () => Date.now(), logger = false }) {
  const app = Fastify({
    logger,
    requestIdHeader: 'x-request-id',
    ajv: { customOptions: { removeAdditional: false } }
  });

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
  const soloGateway = soloLlamadores('gateway');

  async function requiereUsuario(request, reply) {
    const id = request.headers['x-user-id'];
    if (typeof id !== 'string' || !id) return reply.code(401).send({ error: 'Autenticación requerida' });
    request.usuarioId = id;
  }

  app.get('/health', async () => ({ status: 'ok', service: 'clients' }));

  // ---- S08 Registrarse -----------------------------------------------------
  app.post(
    '/clients',
    {
      preHandler: soloGateway,
      schema: {
        body: {
          type: 'object',
          required: ['run', 'nombre', 'direccion', 'comuna', 'region', 'correo', 'telefono', 'password'],
          additionalProperties: false,
          properties: {
            run: texto(8, 12),
            nombre: texto(2, 100),
            direccion: texto(5, 150),
            comuna: texto(2, 60),
            region: texto(2, 60),
            correo: { type: 'string', format: 'email', maxLength: 120 },
            telefono: TELEFONO,
            password: texto(8, 128)
          }
        }
      }
    },
    async (request, reply) => {
      const b = request.body;
      const run = normalizarRun(b.run);
      if (!run) return reply.code(400).send({ error: 'Solicitud inválida', detalle: 'RUN inválido' });
      const correo = b.correo.toLowerCase();
      const conflicto = { error: 'Ya existe una cuenta con esos datos' };

      let cliente;
      try {
        cliente = await repo.crear({
          run,
          nombre: b.nombre.trim(),
          correo,
          telefono: b.telefono.trim(),
          estado: 'pendiente_validacion',
          direcciones: [
            { id: crypto.randomUUID(), direccion: b.direccion, comuna: b.comuna, region: b.region }
          ]
        });
      } catch (err) {
        if (err.code === 'DUPLICADO') return reply.code(409).send(conflicto);
        throw err;
      }

      // La credencial vive en auth. Si falla, se deshace el registro
      // (compensación) para no dejar clientes sin forma de iniciar sesión.
      let resultado;
      try {
        resultado = await authClient.crearCredencial({ clienteId: cliente.id, correo, password: b.password });
      } catch (err) {
        request.log.error({ err }, 'auth no disponible durante el registro');
        await repo.eliminar(cliente.id);
        return reply.code(503).send({ error: 'Servicio temporalmente no disponible' });
      }
      if (!resultado.ok) {
        await repo.eliminar(cliente.id);
        if (resultado.invalida) {
          return reply.code(400).send({
            error: 'Solicitud inválida',
            detalle: 'La contraseña debe tener entre 8 y 128 caracteres, con letras y números'
          });
        }
        return reply.code(409).send(conflicto);
      }

      const codigo = String(crypto.randomInt(100000, 1000000));
      await repo.guardarCodigo(cliente.id, {
        hash: sha256(codigo).toString('hex'),
        expira: ahora() + CODIGO_TTL_MS,
        intentos: 0
      });
      try {
        await mailer.enviarCodigo(correo, codigo);
      } catch (err) {
        request.log.error({ err }, 'no se pudo enviar el código de verificación');
      }
      return reply.code(201).send({ id: cliente.id, correo, estado: 'pendiente_validacion' });
    }
  );

  // ---- S09 Validar correo --------------------------------------------------
  app.post(
    '/clients/verify-email',
    {
      preHandler: soloGateway,
      schema: {
        body: {
          type: 'object',
          required: ['correo', 'codigo'],
          additionalProperties: false,
          properties: {
            correo: { type: 'string', format: 'email', maxLength: 120 },
            codigo: { type: 'string', pattern: '^[0-9]{6}$' }
          }
        }
      }
    },
    async (request, reply) => {
      const invalido = { error: 'Código inválido o vencido' };
      const cliente = await repo.buscarPorCorreo(request.body.correo.toLowerCase());
      if (!cliente || cliente.estado !== 'pendiente_validacion' || !cliente.codigoVerificacion) {
        return reply.code(400).send(invalido);
      }
      const cv = cliente.codigoVerificacion;
      if (cv.intentos >= MAX_INTENTOS_CODIGO) {
        return reply.code(429).send({ error: 'Demasiados intentos. Regístrate de nuevo o contacta soporte.' });
      }
      const correcto =
        cv.expira > ahora() &&
        crypto.timingSafeEqual(sha256(request.body.codigo), Buffer.from(cv.hash, 'hex'));
      if (!correcto) {
        await repo.sumarIntentoCodigo(cliente.id);
        return reply.code(400).send(invalido);
      }
      try {
        await authClient.activar(cliente.id); // idempotente: se puede reintentar
      } catch (err) {
        request.log.error({ err }, 'auth no disponible al activar la cuenta');
        return reply.code(503).send({ error: 'Servicio temporalmente no disponible' });
      }
      await repo.activar(cliente.id);
      return { id: cliente.id, estado: 'activo' };
    }
  );

  // ---- S12 Mi perfil -------------------------------------------------------
  app.get('/clients/me', { preHandler: [soloGateway, requiereUsuario] }, async (request, reply) => {
    const c = await repo.buscarPorId(request.usuarioId);
    if (!c) return reply.code(404).send({ error: 'Perfil no encontrado' });
    return aPerfil(c);
  });

  // ---- S13 Editar mi perfil (solo campos editables) -------------------------
  app.put(
    '/clients/me',
    {
      preHandler: [soloGateway, requiereUsuario],
      schema: {
        body: {
          type: 'object',
          required: ['nombre', 'telefono'],
          additionalProperties: false, // RUN, correo y estado no se cambian desde aquí
          properties: { nombre: texto(2, 100), telefono: TELEFONO }
        }
      }
    },
    async (request, reply) => {
      const c = await repo.actualizarPerfil(request.usuarioId, {
        nombre: request.body.nombre.trim(),
        telefono: request.body.telefono.trim()
      });
      if (!c) return reply.code(404).send({ error: 'Perfil no encontrado' });
      return aPerfil(c);
    }
  );

  // ---- S14 Agregar dirección -----------------------------------------------
  app.post(
    '/clients/me/addresses',
    { preHandler: [soloGateway, requiereUsuario], schema: { body: DIRECCION } },
    async (request, reply) => {
      const c = await repo.buscarPorId(request.usuarioId);
      if (!c) return reply.code(404).send({ error: 'Perfil no encontrado' });
      if ((c.direcciones || []).length >= MAX_DIRECCIONES) {
        return reply.code(409).send({ error: `Máximo ${MAX_DIRECCIONES} direcciones por cliente` });
      }
      const dir = { id: crypto.randomUUID(), ...request.body };
      await repo.agregarDireccion(request.usuarioId, dir);
      return reply.code(201).send(dir);
    }
  );

  // ---- S15 Listar mis direcciones -------------------------------------------
  app.get('/clients/me/addresses', { preHandler: [soloGateway, requiereUsuario] }, async (request, reply) => {
    const c = await repo.buscarPorId(request.usuarioId);
    if (!c) return reply.code(404).send({ error: 'Perfil no encontrado' });
    return c.direcciones || [];
  });

  return app;
}

module.exports = { buildApp, MAX_INTENTOS_CODIGO, MAX_DIRECCIONES };
