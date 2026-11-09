'use strict';

const crypto = require('node:crypto');
const Fastify = require('fastify');
const { instalarAutenticacionDeServicio, soloLlamadores } = require('./serviceAuth');

const MEDIOS = ['webpay', 'servipag', 'transferencia'];
const VENTANA_FIRMA_SEG = 300; // un aviso con más de 5 minutos se rechaza (evita reenvíos viejos)

const paramsUuid = (nombre) => ({
  type: 'object',
  required: [nombre],
  properties: { [nombre]: { type: 'string', pattern: '^[0-9a-f-]{36}$' } }
});

// Lo que ve el dueño del pago. Nunca incluye datos del proveedor ni firmas.
function aDto(p, rol) {
  const dto = { id: p.id, pedidoId: p.pedidoId, monto: p.monto, medio: p.medio, estado: p.estado, urlPago: p.urlPago, creadoEn: p.creadoEn };
  if (rol === 'admin') dto.clienteId = p.clienteId;
  return dto;
}

function firmaValida(secreto, timestamp, cuerpo, firma) {
  if (typeof firma !== 'string' || !/^[0-9a-f]{64}$/.test(firma)) return false;
  const esperada = crypto.createHmac('sha256', secreto).update(`${timestamp}.${JSON.stringify(cuerpo)}`).digest();
  return crypto.timingSafeEqual(esperada, Buffer.from(firma, 'hex'));
}

/**
 * Servicio payments: autoridad sobre los pagos. Solo este servicio decide que un
 * pago está aprobado, y solo a partir de un aviso firmado del proveedor. Nada
 * que envíe el navegador (montos, estados) se toma como confirmación.
 *
 * El proveedor real (Webpay/Servipag) no es accesible en este entorno: se usa un
 * adaptador de prueba que conserva el contrato (crear cobro -> URL de pago ->
 * aviso firmado con HMAC-SHA256 y marca de tiempo).
 *
 * @param repo           ver repo.mongo.js
 * @param orders         { pedido(id), marcarPagado(id, pagoId, monto) }
 * @param webhookSecret  secreto compartido con el proveedor (Docker secret)
 * @param serviceTokens  { gateway }
 */
function buildApp({ repo, orders, webhookSecret, serviceTokens, urlProveedor = 'https://sandbox-pagos.fukusuke.local/pagar', ahora = () => Date.now(), logger = false }) {
  if (!webhookSecret || webhookSecret.length < 16) throw new Error('Falta el secreto del proveedor de pagos.');
  const app = Fastify({
    logger: logger && { ...(typeof logger === 'object' ? logger : {}), redact: ['req.headers["x-signature"]'] },
    requestIdHeader: 'x-request-id',
    ajv: { customOptions: { removeAdditional: false } }
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  app.setErrorHandler((error, request, reply) => {
    if (error.validation) return reply.code(400).send({ error: 'Solicitud inválida', detalle: error.message });
    if (error.code === 'DEPENDENCIA') {
      request.log.error({ err: error.message }, 'dependencia no disponible');
      return reply.code(503).send({ error: 'Servicio temporalmente no disponible' });
    }
    request.log.error({ err: error }, 'error no controlado');
    return reply.code(500).send({ error: 'Error interno' });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: 'Ruta no encontrada' }));

  instalarAutenticacionDeServicio(app, serviceTokens);
  const soloGateway = soloLlamadores('gateway');
  const requiereRol = (...roles) => async (request, reply) => {
    const id = request.headers['x-user-id'];
    const rol = request.headers['x-user-role'];
    if (typeof id !== 'string' || !id) return reply.code(401).send({ error: 'Autenticación requerida' });
    if (!roles.includes(rol)) return reply.code(403).send({ error: 'Acceso denegado' });
    request.usuario = { id, rol };
  };

  app.get('/health', async () => ({ status: 'ok', service: 'payments' }));

  // ---- S21 Iniciar pago de un pedido ------------------------------------------
  app.post(
    '/orders/:pedidoId/payments',
    {
      preHandler: [soloGateway, requiereRol('cliente')],
      schema: {
        params: paramsUuid('pedidoId'),
        body: {
          type: 'object',
          required: ['medio'],
          additionalProperties: false, // un "monto" o "estado" enviado por el navegador -> 400
          properties: { medio: { type: 'string', enum: MEDIOS } }
        }
      }
    },
    async (request, reply) => {
      const u = request.usuario;
      const pedido = await orders.pedido(request.params.pedidoId);
      // Pedido ajeno o inexistente: misma respuesta.
      if (!pedido || pedido.clienteId !== u.id) return reply.code(404).send({ error: 'Pedido no encontrado' });
      if (pedido.estado !== 'pendiente_pago') return reply.code(409).send({ error: `El pedido está en estado ${pedido.estado}` });

      // Un solo cobro pendiente por pedido: repetir la solicitud devuelve el mismo.
      const abierto = await repo.pendientePorPedido(pedido.id);
      if (abierto) return reply.code(200).send(aDto(abierto, u.rol));

      const id = crypto.randomUUID();
      const pago = {
        id,
        pedidoId: pedido.id,
        clienteId: u.id,
        monto: pedido.total, // el monto lo fija el servidor con el total de orders
        medio: request.body.medio,
        estado: 'pendiente',
        urlPago: `${urlProveedor}/${id}`,
        creadoEn: new Date(ahora()).toISOString()
      };
      const r = await repo.crear(pago);
      if (r.duplicado) return reply.code(200).send(aDto(r.pago, u.rol));
      return reply.code(201).send(aDto(pago, u.rol));
    }
  );

  // ---- S22 Estado del pago -----------------------------------------------------
  app.get(
    '/payments/:id',
    { preHandler: [soloGateway, requiereRol('cliente', 'admin')], schema: { params: paramsUuid('id') } },
    async (request, reply) => {
      const p = await repo.buscarPorId(request.params.id);
      if (!p || (request.usuario.rol !== 'admin' && p.clienteId !== request.usuario.id)) {
        return reply.code(404).send({ error: 'Pago no encontrado' });
      }
      return aDto(p, request.usuario.rol);
    }
  );

  // ---- S23 Aviso del proveedor (webhook firmado) --------------------------------
  // Llega por el gateway sin sesión de usuario: la identidad del proveedor se
  // prueba con la firma HMAC, no con un token de usuario.
  app.post(
    '/webhook',
    {
      preHandler: soloGateway,
      schema: {
        headers: {
          type: 'object',
          required: ['x-signature', 'x-timestamp'],
          properties: { 'x-signature': { type: 'string', maxLength: 128 }, 'x-timestamp': { type: 'string', pattern: '^[0-9]{10}$' } }
        },
        body: {
          type: 'object',
          required: ['eventoId', 'pagoId', 'estado', 'monto'],
          additionalProperties: false,
          properties: {
            eventoId: { type: 'string', minLength: 8, maxLength: 64 },
            pagoId: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
            estado: { type: 'string', enum: ['aprobado', 'rechazado'] },
            monto: { type: 'integer', minimum: 1 }
          }
        }
      }
    },
    async (request, reply) => {
      const ts = Number(request.headers['x-timestamp']);
      if (Math.abs(ahora() / 1000 - ts) > VENTANA_FIRMA_SEG || !firmaValida(webhookSecret, ts, request.body, request.headers['x-signature'])) {
        request.log.warn('aviso de pago con firma inválida o vencida');
        return reply.code(401).send({ error: 'Firma inválida' });
      }
      const ev = request.body;

      // Idempotencia por evento: el mismo aviso dos veces no cambia nada.
      if (await repo.eventoProcesado(ev.eventoId)) return { recibido: true, duplicado: true };

      const pago = await repo.buscarPorId(ev.pagoId);
      if (!pago) return reply.code(404).send({ error: 'Pago no encontrado' });
      if (pago.monto !== ev.monto) {
        request.log.warn({ pagoId: pago.id }, 'aviso con monto distinto al cobrado');
        return reply.code(409).send({ error: 'El monto no coincide con el cobro' });
      }
      if (pago.estado !== 'pendiente') {
        await repo.registrarEvento(ev.eventoId, pago.id);
        return { recibido: true, estado: pago.estado };
      }

      if (ev.estado === 'aprobado') {
        // Primero orders confirma el pedido; si no responde, el proveedor reintenta.
        await orders.marcarPagado(pago.pedidoId, pago.id, pago.monto);
      }
      const final = await repo.cambiarEstado(pago.id, 'pendiente', ev.estado);
      await repo.registrarEvento(ev.eventoId, pago.id);
      return { recibido: true, estado: (final || pago).estado };
    }
  );

  return app;
}

module.exports = { buildApp, firmaValida, MEDIOS };
