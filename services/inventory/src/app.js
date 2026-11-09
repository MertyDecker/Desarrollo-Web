'use strict';

const Fastify = require('fastify');
const { instalarAutenticacionDeServicio, soloLlamadores } = require('./serviceAuth');

const CATEGORIAS = ['rolls', 'nigiri', 'entradas', 'promociones', 'compartir'];
const ID_PATTERN = '^[a-f0-9]{24}$';

// ---- Esquemas de respuesta -------------------------------------------------
// Fastify solo serializa los campos declarados aquí: lo que no está listado
// nunca sale en una respuesta, aunque exista en la base de datos.

// Vista pública: lo que ve cualquier visitante del catálogo (dato público).
const productoPublico = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    nombre: { type: 'string' },
    descripcion: { type: 'string' },
    precio: { type: 'integer' },
    categoria: { type: 'string' },
    imagen: { type: ['string', 'null'] },
    disponible: { type: 'boolean' }
  }
};

// Vista de administración: agrega el stock exacto y el estado interno.
const productoAdmin = {
  type: 'object',
  properties: {
    ...productoPublico.properties,
    stock: { type: 'integer' },
    activo: { type: 'boolean' }
  }
};

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' }, detalle: { type: 'string' } }
};

// ---- Esquema de entrada (cuerpo de POST y PUT) -----------------------------
const cuerpoProducto = {
  type: 'object',
  required: ['nombre', 'precio', 'stock', 'categoria'],
  additionalProperties: false,
  properties: {
    nombre: { type: 'string', minLength: 1, maxLength: 80 },
    descripcion: { type: 'string', maxLength: 300, default: '' },
    precio: { type: 'integer', minimum: 1, maximum: 10000000 }, // CLP, sin decimales
    stock: { type: 'integer', minimum: 0, maximum: 100000 },
    categoria: { type: 'string', enum: CATEGORIAS },
    imagen: { type: ['string', 'null'], maxLength: 300, default: null }
  }
};

const paramsId = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: ID_PATTERN } }
};

// ---- Transformaciones de dominio -> DTO ------------------------------------
// "disponible" lo calcula el servidor: el navegador nunca lo decide.
function aPublico(p) {
  return {
    id: p.id,
    nombre: p.nombre,
    descripcion: p.descripcion,
    precio: p.precio,
    categoria: p.categoria,
    imagen: p.imagen ?? null,
    disponible: p.activo && p.stock > 0
  };
}

function aAdmin(p) {
  return { ...aPublico(p), stock: p.stock, activo: p.activo };
}

// preHandler de las operaciones de administración. El gateway ya exige el rol,
// pero el servicio vuelve a comprobarlo: ocultar un botón o confiar solo en el
// borde no basta (defensa en profundidad).
async function requiereAdmin(request, reply) {
  if (request.headers['x-user-role'] !== 'admin') {
    return reply.code(403).send({ error: 'Acceso denegado' });
  }
}

/**
 * Construye la aplicación Fastify.
 * @param {{repo: object, serviceTokens: object, logger?: boolean|object}} opciones
 *   repo: implementa list, get, create, replace, deactivate (ver repo.mongo.js).
 *   serviceTokens: { gateway: '<token>' } — solo el gateway puede llamar a este servicio.
 */
function buildApp({ repo, serviceTokens, logger = false }) {
  const app = Fastify({
    logger,
    // Identificador de correlación: se respeta el que envíe el gateway.
    requestIdHeader: 'x-request-id',
    // Un campo no declarado en el cuerpo se rechaza con 400 (no se descarta en
    // silencio): evita que un cliente intente colar campos como "activo" o "rol".
    ajv: { customOptions: { removeAdditional: false } }
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Toda ruta (salvo /health) exige la identidad de un servicio conocido.
  // Cada consumidor tiene su propio token y solo puede usar ciertas rutas:
  //   gateway  -> catálogo público y administración
  //   orders   -> lectura por lote y reservas de stock
  //   graphql  -> lectura por lote (agregaciones)
  instalarAutenticacionDeServicio(app, serviceTokens);
  const soloGateway = soloLlamadores('gateway');
  const lecturaInterna = soloLlamadores('orders', 'graphql');
  const soloOrders = soloLlamadores('orders');

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: 'Solicitud inválida', detalle: error.message });
    }
    // Los errores inesperados se registran, pero no se filtran detalles al cliente.
    request.log.error({ err: error }, 'error no controlado');
    return reply.code(500).send({ error: 'Error interno' });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: 'Ruta no encontrada' });
  });

  // ---- Salud ---------------------------------------------------------------
  app.get('/health', async () => ({ status: 'ok', service: 'inventory' }));

  // ---- S01 Consultar catálogo ---------------------------------------------
  app.get(
    '/products',
    {
      preHandler: soloGateway,
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false, // un parámetro desconocido (p. ej. available[$ne]) -> 400
          properties: {
            available: { type: 'boolean' },
            category: { type: 'string', enum: CATEGORIAS }
          }
        },
        response: { 200: { type: 'array', items: productoPublico } }
      }
    },
    async (request) => {
      const { available, category } = request.query;
      const productos = await repo.list({ available, category });
      return productos.map(aPublico);
    }
  );

  // ---- S02 Consultar un producto ------------------------------------------
  app.get(
    '/products/:id',
    {
      preHandler: soloGateway,
      schema: {
        params: paramsId,
        response: { 200: productoPublico, 404: errorSchema }
      }
    },
    async (request, reply) => {
      const producto = await repo.get(request.params.id);
      // Un producto dado de baja no existe para el catálogo público.
      if (!producto || !producto.activo) {
        return reply.code(404).send({ error: 'Producto no encontrado' });
      }
      return aPublico(producto);
    }
  );

  // ---- S03 Agregar producto (operación de administración) -----------------
  app.post(
    '/products',
    {
      preHandler: [soloGateway, requiereAdmin],
      schema: {
        body: cuerpoProducto,
        response: { 201: productoAdmin }
      }
    },
    async (request, reply) => {
      const creado = await repo.create(request.body);
      return reply.code(201).send(aAdmin(creado));
    }
  );

  // ---- S04 Modificar producto (reemplaza la representación) ---------------
  app.put(
    '/products/:id',
    {
      preHandler: [soloGateway, requiereAdmin],
      schema: {
        params: paramsId,
        body: cuerpoProducto,
        response: { 200: productoAdmin, 404: errorSchema }
      }
    },
    async (request, reply) => {
      const actualizado = await repo.replace(request.params.id, request.body);
      if (!actualizado) return reply.code(404).send({ error: 'Producto no encontrado' });
      return aAdmin(actualizado);
    }
  );

  // ---- S05 Dar de baja un producto ----------------------------------------
  // No se borra el registro: se marca inactivo para conservar el historial
  // de pedidos que ya lo incluyen.
  app.delete(
    '/products/:id',
    {
      preHandler: [soloGateway, requiereAdmin],
      schema: {
        params: paramsId,
        response: { 404: errorSchema }
      }
    },
    async (request, reply) => {
      const ok = await repo.deactivate(request.params.id);
      if (!ok) return reply.code(404).send({ error: 'Producto no encontrado' });
      return reply.code(204).send();
    }
  );

  // ---- Lectura por lote (interna) ------------------------------------------
  // Una sola llamada para varios productos: orders la usa para fijar precios y
  // el GraphQL Gateway para describir los ítems de un pedido (evita N+1).
  // Incluye productos dados de baja para que los pedidos antiguos conserven
  // su descripción.
  app.get(
    '/internal/products',
    {
      preHandler: lecturaInterna,
      schema: {
        querystring: {
          type: 'object',
          required: ['ids'],
          properties: { ids: { type: 'string', pattern: '^[a-f0-9]{24}(,[a-f0-9]{24}){0,49}$' } }
        },
        response: {
          200: {
            type: 'array',
            items: { type: 'object', properties: { ...productoPublico.properties, activo: { type: 'boolean' } } }
          }
        }
      }
    },
    async (request) => {
      const ids = [...new Set(request.query.ids.split(','))];
      const productos = await repo.getMany(ids);
      return productos.map((p) => ({ ...aPublico(p), activo: p.activo }));
    }
  );

  // ---- S06 Reservar stock (interna, solo orders) ---------------------------
  // Idempotente por pedidoId: repetir la misma reserva no descuenta dos veces.
  app.post(
    '/products/:id/reservations',
    {
      preHandler: soloOrders,
      schema: {
        params: paramsId,
        body: {
          type: 'object',
          required: ['pedidoId', 'cantidad'],
          additionalProperties: false,
          properties: {
            pedidoId: { type: 'string', minLength: 8, maxLength: 64 },
            cantidad: { type: 'integer', minimum: 1, maximum: 50 }
          }
        }
      }
    },
    async (request, reply) => {
      const r = await repo.reservar(request.params.id, request.body.pedidoId, request.body.cantidad);
      if (r.ok) return reply.code(201).send({ productoId: request.params.id, pedidoId: request.body.pedidoId, cantidad: r.cantidad, repetida: !!r.repetida });
      if (r.motivo === 'no_existe') return reply.code(404).send({ error: 'Producto no encontrado' });
      return reply.code(409).send({ error: 'Stock insuficiente' });
    }
  );

  // ---- S07 Liberar una reserva (interna, solo orders) ----------------------
  app.delete(
    '/products/:id/reservations/:pedidoId',
    {
      preHandler: soloOrders,
      schema: {
        params: {
          type: 'object',
          required: ['id', 'pedidoId'],
          properties: { id: { type: 'string', pattern: ID_PATTERN }, pedidoId: { type: 'string', minLength: 8, maxLength: 64 } }
        }
      }
    },
    async (request, reply) => {
      await repo.liberar(request.params.id, request.params.pedidoId);
      return reply.code(204).send();
    }
  );

  return app;
}

module.exports = { buildApp, CATEGORIAS };
