'use strict';

const Fastify = require('fastify');

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

/**
 * Construye la aplicación Fastify.
 * @param {{repo: object, logger?: boolean|object}} opciones
 *   repo: implementa list, get, create, replace, deactivate (ver repo.mongo.js).
 *   Se inyecta para poder probar el servicio sin base de datos.
 */
function buildApp({ repo, logger = false }) {
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
      schema: {
        querystring: {
          type: 'object',
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

  return app;
}

module.exports = { buildApp, CATEGORIAS };
