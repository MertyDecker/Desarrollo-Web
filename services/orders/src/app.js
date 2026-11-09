'use strict';

const crypto = require('node:crypto');
const Fastify = require('fastify');
const { instalarAutenticacionDeServicio, soloLlamadores } = require('./serviceAuth');

// ---- Reglas de negocio (R05, R06) --------------------------------------------
// El local está en Providencia. Despacho gratis dentro de ~3 km (comunas
// vecinas); fuera de ese radio se cobra una tarifa fija. El navegador nunca
// envía precios ni totales: todo se calcula aquí con los precios de inventory.
const COMUNAS_GRATIS = ['providencia', 'nunoa', 'santiago', 'las condes'];
const TARIFA_ENVIO = 2990;
const EMPAQUE_ECOLOGICO = 1200;
const MAX_ITEMS = 10;
const MAX_CANTIDAD = 20;

// Ciclo de vida del pedido. Cualquier otra transición se rechaza con 409.
const TRANSICIONES_ADMIN = {
  pagado: ['en_preparacion', 'cancelado'],
  en_preparacion: ['en_despacho', 'cancelado'],
  en_despacho: ['entregado'],
  pendiente_pago: ['cancelado'],
  entregado: [],
  cancelado: []
};
const ESTADOS = Object.keys(TRANSICIONES_ADMIN);
// El cliente solo puede cancelar mientras no haya pagado (no hay reembolsos automáticos).
const CANCELABLE_POR_CLIENTE = ['pendiente_pago'];

const normalizarComuna = (c) =>
  c.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function calcularEnvio(comuna) {
  return COMUNAS_GRATIS.includes(normalizarComuna(comuna)) ? 0 : TARIFA_ENVIO;
}

// Huella del contenido del pedido: si la misma clave de idempotencia llega con
// otro contenido, es un error del cliente y no un reintento.
function huella(body) {
  const items = [...body.items]
    .map((i) => `${i.productoId}x${i.cantidad}`)
    .sort()
    .join(',');
  return crypto.createHash('sha256').update(`${items}|${body.direccionId}`).digest('hex');
}

// Vista del pedido que recibe el gateway. No incluye la clave de idempotencia
// ni la huella; el id del cliente solo lo ve el administrador.
function aDto(p, rol) {
  const dto = {
    id: p.id,
    estado: p.estado,
    items: p.items,
    direccion: p.direccion,
    subtotal: p.subtotal,
    envio: p.envio,
    empaque: p.empaque,
    total: p.total,
    pagoId: p.pagoId ?? null,
    creadoEn: p.creadoEn,
    historial: p.historial
  };
  if (rol === 'admin') dto.clienteId = p.clienteId;
  return dto;
}

const errorSchema = { type: 'object', properties: { error: { type: 'string' }, detalle: { type: 'string' } } };
const paramsId = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: '^[0-9a-f-]{36}$' } }
};

/**
 * Servicio orders: autoridad sobre los pedidos y su ciclo de vida.
 *
 * @param repo           ver repo.mongo.js (crear, buscarPorId, buscarPorClave, listar, actualizarEstado, marcarPagado)
 * @param inventory      { productos(ids), reservar(id, pedidoId, cantidad), liberar(id, pedidoId) }
 * @param clients        { direccion(clienteId, direccionId) }
 * @param serviceTokens  { gateway, payments, graphql }
 */
function buildApp({ repo, inventory, clients, serviceTokens, ahora = () => new Date(), logger = false }) {
  const app = Fastify({
    logger,
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

  // Identidad verificada por el gateway (x-user-id / x-user-role). Este servicio
  // vuelve a revisar el rol: no confía solo en la configuración del borde.
  const requiereRol = (...roles) => async (request, reply) => {
    const id = request.headers['x-user-id'];
    const rol = request.headers['x-user-role'];
    if (typeof id !== 'string' || !id) return reply.code(401).send({ error: 'Autenticación requerida' });
    if (!roles.includes(rol)) return reply.code(403).send({ error: 'Acceso denegado' });
    request.usuario = { id, rol };
  };

  const noEncontrado = (reply) => reply.code(404).send({ error: 'Pedido no encontrado' });
  // Un pedido ajeno responde exactamente igual que uno inexistente (no revela que existe).
  const puedeVer = (p, u) => p && (u.rol === 'admin' || p.clienteId === u.id);

  app.get('/health', async () => ({ status: 'ok', service: 'orders' }));

  // ---- S16 Confirmar pedido --------------------------------------------------
  app.post(
    '/orders',
    {
      preHandler: [soloGateway, requiereRol('cliente')],
      schema: {
        headers: {
          type: 'object',
          required: ['idempotency-key'],
          properties: { 'idempotency-key': { type: 'string', pattern: '^[A-Za-z0-9_-]{8,64}$' } }
        },
        body: {
          type: 'object',
          required: ['items', 'direccionId'],
          additionalProperties: false, // precio, total o estado enviados por el navegador -> 400
          properties: {
            items: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_ITEMS,
              items: {
                type: 'object',
                required: ['productoId', 'cantidad'],
                additionalProperties: false,
                properties: {
                  productoId: { type: 'string', pattern: '^[a-f0-9]{24}$' },
                  cantidad: { type: 'integer', minimum: 1, maximum: MAX_CANTIDAD }
                }
              }
            },
            direccionId: { type: 'string', minLength: 8, maxLength: 64 }
          }
        }
      }
    },
    async (request, reply) => {
      const u = request.usuario;
      const clave = request.headers['idempotency-key'];
      const firma = huella(request.body);

      // 1) Idempotencia: si la clave ya se usó, se devuelve el mismo pedido.
      const previo = await repo.buscarPorClave(u.id, clave);
      if (previo) {
        if (previo.huella !== firma) {
          return reply.code(422).send({ error: 'La clave de idempotencia ya se usó con otro contenido' });
        }
        reply.header('idempotent-replay', 'true');
        return reply.code(200).send(aDto(previo, u.rol));
      }

      // Un producto repetido en el carrito se agrupa en una sola línea.
      const cantidades = new Map();
      for (const i of request.body.items) cantidades.set(i.productoId, (cantidades.get(i.productoId) || 0) + i.cantidad);
      for (const c of cantidades.values()) {
        if (c > MAX_CANTIDAD) return reply.code(400).send({ error: 'Solicitud inválida', detalle: `Máximo ${MAX_CANTIDAD} unidades por producto` });
      }

      // 2) La dirección debe pertenecer al cliente (clients es la autoridad).
      const direccion = await clients.direccion(u.id, request.body.direccionId);
      if (!direccion) return reply.code(400).send({ error: 'Solicitud inválida', detalle: 'La dirección no pertenece al cliente' });

      // 3) Precios vigentes desde inventory (una sola llamada por lote).
      const productos = await inventory.productos([...cantidades.keys()]);
      const porId = new Map(productos.map((p) => [p.id, p]));
      const items = [];
      for (const [productoId, cantidad] of cantidades) {
        const p = porId.get(productoId);
        if (!p || !p.activo) return reply.code(400).send({ error: 'Solicitud inválida', detalle: `Producto no disponible: ${productoId}` });
        items.push({ productoId, nombre: p.nombre, precioUnitario: p.precio, cantidad, subtotal: p.precio * cantidad });
      }

      // 4) Reserva de stock. Si un producto falla, se liberan las reservas hechas.
      const pedidoId = crypto.randomUUID();
      const reservados = [];
      for (const it of items) {
        const r = await inventory.reservar(it.productoId, pedidoId, it.cantidad);
        if (!r.ok) {
          await Promise.allSettled(reservados.map((id) => inventory.liberar(id, pedidoId)));
          return reply.code(409).send({ error: `Stock insuficiente para ${it.nombre}` });
        }
        reservados.push(it.productoId);
      }

      // 5) Totales calculados en el servidor.
      const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
      const envio = calcularEnvio(direccion.comuna);
      const fecha = ahora().toISOString();
      const pedido = {
        id: pedidoId,
        clienteId: u.id,
        items,
        direccion: { id: direccion.id, direccion: direccion.direccion, comuna: direccion.comuna, region: direccion.region },
        subtotal,
        envio,
        empaque: EMPAQUE_ECOLOGICO,
        total: subtotal + envio + EMPAQUE_ECOLOGICO,
        estado: 'pendiente_pago',
        historial: [{ estado: 'pendiente_pago', fecha, por: 'cliente' }],
        idempotencyKey: clave,
        huella: firma,
        creadoEn: fecha
      };

      const guardado = await repo.crear(pedido);
      if (guardado.duplicado) {
        // Dos solicitudes simultáneas con la misma clave: gana la primera y
        // esta devuelve las reservas que alcanzó a tomar.
        await Promise.allSettled(reservados.map((id) => inventory.liberar(id, pedidoId)));
        reply.header('idempotent-replay', 'true');
        return reply.code(200).send(aDto(guardado.pedido, u.rol));
      }
      return reply.code(201).send(aDto(pedido, u.rol));
    }
  );

  // ---- S17 Mis pedidos (admin: todos) ---------------------------------------
  app.get(
    '/orders',
    {
      preHandler: [soloGateway, requiereRol('cliente', 'admin')],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            offset: { type: 'integer', minimum: 0, maximum: 10000, default: 0 },
            estado: { type: 'string', enum: ESTADOS }
          }
        }
      }
    },
    async (request) => {
      const u = request.usuario;
      const filtro = { estado: request.query.estado };
      if (u.rol !== 'admin') filtro.clienteId = u.id; // el filtro por dueño lo pone el servidor
      const pedidos = await repo.listar(filtro, request.query);
      return pedidos.map((p) => aDto(p, u.rol));
    }
  );

  // ---- S18 Detalle ------------------------------------------------------------
  app.get(
    '/orders/:id',
    { preHandler: [soloGateway, requiereRol('cliente', 'admin')], schema: { params: paramsId, response: { 404: errorSchema } } },
    async (request, reply) => {
      const p = await repo.buscarPorId(request.params.id);
      if (!puedeVer(p, request.usuario)) return noEncontrado(reply);
      return aDto(p, request.usuario.rol);
    }
  );

  // ---- S19 Cancelar (cliente dueño) -------------------------------------------
  app.post(
    '/orders/:id/cancel',
    { preHandler: [soloGateway, requiereRol('cliente')], schema: { params: paramsId } },
    async (request, reply) => {
      const p = await repo.buscarPorId(request.params.id);
      if (!puedeVer(p, request.usuario)) return noEncontrado(reply);
      if (!CANCELABLE_POR_CLIENTE.includes(p.estado)) {
        return reply.code(409).send({ error: `No se puede cancelar un pedido en estado ${p.estado}` });
      }
      const act = await repo.actualizarEstado(p.id, p.estado, 'cancelado', 'cliente', ahora().toISOString());
      if (!act) return reply.code(409).send({ error: 'El pedido cambió de estado; intenta de nuevo' });
      await Promise.allSettled(p.items.map((i) => inventory.liberar(i.productoId, p.id))); // recupera stock
      return aDto(act, request.usuario.rol);
    }
  );

  // ---- S20 Cambiar estado (administrador) --------------------------------------
  app.patch(
    '/orders/:id/status',
    {
      preHandler: [soloGateway, requiereRol('admin')],
      schema: {
        params: paramsId,
        body: {
          type: 'object',
          required: ['estado'],
          additionalProperties: false,
          properties: { estado: { type: 'string', enum: ESTADOS } }
        }
      }
    },
    async (request, reply) => {
      const p = await repo.buscarPorId(request.params.id);
      if (!p) return noEncontrado(reply);
      const nuevo = request.body.estado;
      if (!TRANSICIONES_ADMIN[p.estado].includes(nuevo)) {
        return reply.code(409).send({ error: `Transición no permitida: ${p.estado} -> ${nuevo}` });
      }
      const act = await repo.actualizarEstado(p.id, p.estado, nuevo, 'admin', ahora().toISOString());
      if (!act) return reply.code(409).send({ error: 'El pedido cambió de estado; intenta de nuevo' });
      if (nuevo === 'cancelado') await Promise.allSettled(p.items.map((i) => inventory.liberar(i.productoId, p.id)));
      return aDto(act, 'admin');
    }
  );

  // ---- Contratos internos ------------------------------------------------------
  // payments y graphql leen el pedido completo (incluye clienteId para que
  // ellos comprueben la propiedad con la identidad que les entrega el gateway).
  app.get(
    '/internal/orders/:id',
    { preHandler: soloLlamadores('payments', 'graphql'), schema: { params: paramsId } },
    async (request, reply) => {
      const p = await repo.buscarPorId(request.params.id);
      if (!p) return noEncontrado(reply);
      return aDto(p, 'admin');
    }
  );

  app.get(
    '/internal/orders',
    {
      preHandler: soloLlamadores('graphql'),
      schema: {
        querystring: {
          type: 'object',
          required: ['clienteId'],
          properties: {
            clienteId: { type: 'string', minLength: 1, maxLength: 64 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
            offset: { type: 'integer', minimum: 0, default: 0 }
          }
        }
      }
    },
    async (request) => {
      const { clienteId, limit, offset } = request.query;
      return (await repo.listar({ clienteId }, { limit, offset })).map((p) => aDto(p, 'admin'));
    }
  );

  // payments informa que el cobro fue aprobado por el proveedor (webhook firmado).
  app.post(
    '/internal/orders/:id/paid',
    {
      preHandler: soloLlamadores('payments'),
      schema: {
        params: paramsId,
        body: {
          type: 'object',
          required: ['pagoId', 'monto'],
          additionalProperties: false,
          properties: { pagoId: { type: 'string', minLength: 8, maxLength: 64 }, monto: { type: 'integer', minimum: 1 } }
        }
      }
    },
    async (request, reply) => {
      const p = await repo.buscarPorId(request.params.id);
      if (!p) return noEncontrado(reply);
      if (p.estado === 'pagado' && p.pagoId === request.body.pagoId) return aDto(p, 'admin'); // repetido: sin efecto
      if (p.estado !== 'pendiente_pago') return reply.code(409).send({ error: `El pedido está en estado ${p.estado}` });
      if (p.total !== request.body.monto) return reply.code(409).send({ error: 'El monto no coincide con el total del pedido' });
      const act = await repo.marcarPagado(p.id, request.body.pagoId, ahora().toISOString());
      if (!act) return reply.code(409).send({ error: 'El pedido cambió de estado' });
      return aDto(act, 'admin');
    }
  );

  return app;
}

module.exports = { buildApp, calcularEnvio, EMPAQUE_ECOLOGICO, TARIFA_ENVIO, TRANSICIONES_ADMIN };
