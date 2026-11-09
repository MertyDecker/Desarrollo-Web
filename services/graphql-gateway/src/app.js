'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Fastify = require('fastify');
const {
  buildSchema,
  parse,
  validate,
  execute,
  specifiedRules,
  NoSchemaIntrospectionCustomRule,
  GraphQLError,
  Kind
} = require('graphql');
const { instalarAutenticacionDeServicio, soloLlamadores } = require('./serviceAuth');
const { crearLoader } = require('./loader');

const SDL = fs.readFileSync(path.join(__dirname, 'schema.graphql'), 'utf8');
const LIMITES = {
  largoMaximo: 3000, // caracteres de la consulta
  profundidadMaxima: 6, // niveles de selección
  costoMaximo: 120, // cantidad total de campos seleccionados (incluye fragmentos)
  paginaMaxima: 20,
  plazoMs: 5000 // tiempo máximo total de la ejecución
};

// ---- Reglas de validación propias: profundidad y costo ----------------------
// Se aplican ANTES de ejecutar: una consulta excesiva se rechaza sin llamar a
// ningún resolver ni servicio privado.
function reglaLimites({ profundidadMaxima, costoMaximo }) {
  return (context) => {
    const fragmentos = {};
    for (const def of context.getDocument().definitions) {
      if (def.kind === Kind.FRAGMENT_DEFINITION) fragmentos[def.name.value] = def;
    }
    function medir(sel, nivel, visitados) {
      let costo = 0;
      let prof = nivel;
      for (const s of sel.selections) {
        if (s.kind === Kind.FIELD) {
          costo += 1;
          if (s.selectionSet) {
            const r = medir(s.selectionSet, nivel + 1, visitados);
            costo += r.costo;
            prof = Math.max(prof, r.prof);
          }
        } else if (s.kind === Kind.INLINE_FRAGMENT) {
          const r = medir(s.selectionSet, nivel, visitados);
          costo += r.costo;
          prof = Math.max(prof, r.prof);
        } else if (s.kind === Kind.FRAGMENT_SPREAD) {
          const f = fragmentos[s.name.value];
          if (f && !visitados.has(f.name.value)) {
            const r = medir(f.selectionSet, nivel, new Set([...visitados, f.name.value]));
            costo += r.costo;
            prof = Math.max(prof, r.prof);
          }
        }
      }
      return { costo, prof };
    }
    return {
      OperationDefinition(op) {
        const { costo, prof } = medir(op.selectionSet, 1, new Set());
        if (prof > profundidadMaxima) {
          context.reportError(new GraphQLError(`La consulta supera la profundidad máxima (${profundidadMaxima}).`, { extensions: { code: 'LIMITE_PROFUNDIDAD' } }));
        }
        if (costo > costoMaximo) {
          context.reportError(new GraphQLError(`La consulta supera el costo máximo (${costoMaximo} campos).`, { extensions: { code: 'LIMITE_COSTO' } }));
        }
      }
    };
  };
}

const errorDeCampo = (msg, code) => new GraphQLError(msg, { extensions: { code } });

// ---- Resolvers -----------------------------------------------------------------
// Cada resolver usa los contratos internos de los servicios (nunca sus bases de
// datos). La autorización por recurso y por campo se decide aquí con la
// identidad verificada que entrega el API Gateway.
function crearRaiz() {
  const resumen = (pedido, ctx) => ({
    ...pedido,
    items: () =>
      pedido.items.map((it) => ({
        cantidad: it.cantidad,
        precioUnitario: it.precioUnitario,
        subtotal: it.subtotal,
        nombreAlComprar: it.nombre,
        producto: async () => {
          try {
            return await ctx.productos.load(it.productoId);
          } catch {
            ctx.parcial = true;
            throw errorDeCampo('Inventario no disponible: la descripción del producto no se pudo obtener.', 'DEPENDENCIA_NO_DISPONIBLE');
          }
        }
      })),
    cliente: async () => {
      let c;
      try {
        c = await ctx.clientes.load(pedido.clienteId);
      } catch {
        ctx.parcial = true;
        throw errorDeCampo('Clientes no disponible: los datos de contacto no se pudieron obtener.', 'DEPENDENCIA_NO_DISPONIBLE');
      }
      if (!c) return null;
      const esAdmin = ctx.usuario.rol === 'admin';
      return {
        nombre: c.nombre,
        correo: c.correo,
        telefono: () => c.telefono, // el titular o el admin: ya se verificó el acceso al pedido
        run: () => {
          if (!esAdmin) throw errorDeCampo('No autorizado para el campo run.', 'CAMPO_NO_AUTORIZADO');
          return c.run;
        }
      };
    }
  });

  return {
    async resumenPedido({ id }, ctx) {
      if (!/^[0-9a-f-]{36}$/.test(id)) throw errorDeCampo('Identificador inválido.', 'ENTRADA_INVALIDA');
      const pedido = await ctx.servicios.orders.pedido(id);
      // Pedido ajeno o inexistente: misma respuesta, sin datos.
      if (!pedido || (ctx.usuario.rol !== 'admin' && pedido.clienteId !== ctx.usuario.id)) {
        throw errorDeCampo('Pedido no encontrado.', 'NO_ENCONTRADO');
      }
      return resumen(pedido, ctx);
    },
    async misPedidos({ limite, desde }, ctx) {
      if (limite < 1 || limite > LIMITES.paginaMaxima || desde < 0) {
        throw errorDeCampo(`limite debe estar entre 1 y ${LIMITES.paginaMaxima}.`, 'ENTRADA_INVALIDA');
      }
      // El filtro por titular sale de la identidad verificada, no de un argumento.
      const pedidos = await ctx.servicios.orders.pedidosDe(ctx.usuario.id, limite, desde);
      return pedidos.map((p) => resumen(p, ctx));
    }
  };
}

/**
 * @param servicios      { orders: {pedido, pedidosDe}, inventory: {productos(ids)}, clients: {cliente(id)} }
 * @param serviceTokens  { gateway } — solo el API Gateway puede invocar este servicio
 */
function buildApp({ servicios, serviceTokens, logger = false }) {
  const schema = buildSchema(SDL);
  const raiz = crearRaiz();
  const reglas = [...specifiedRules, NoSchemaIntrospectionCustomRule, reglaLimites(LIMITES)];

  const app = Fastify({ logger, requestIdHeader: 'x-request-id', ajv: { customOptions: { removeAdditional: false } } });
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  app.setErrorHandler((error, request, reply) => {
    if (error.validation) return reply.code(400).send({ errors: [{ message: 'Solicitud inválida', extensions: { code: 'ENTRADA_INVALIDA' } }] });
    request.log.error({ err: error }, 'error no controlado');
    return reply.code(500).send({ errors: [{ message: 'Error interno' }] });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: 'Ruta no encontrada' }));
  instalarAutenticacionDeServicio(app, serviceTokens);

  app.get('/health', async () => ({ status: 'ok', service: 'graphql-gateway' }));

  app.post(
    '/graphql',
    {
      preHandler: soloLlamadores('gateway'),
      schema: {
        body: {
          type: 'object',
          required: ['query'],
          additionalProperties: false,
          properties: {
            query: { type: 'string', minLength: 1, maxLength: LIMITES.largoMaximo },
            variables: { type: ['object', 'null'] },
            operationName: { type: ['string', 'null'], maxLength: 100 }
          }
        }
      }
    },
    async (request, reply) => {
      const id = request.headers['x-user-id'];
      const rol = request.headers['x-user-role'];
      if (typeof id !== 'string' || !id || !['cliente', 'admin'].includes(rol)) {
        return reply.code(401).send({ errors: [{ message: 'Autenticación requerida', extensions: { code: 'NO_AUTENTICADO' } }] });
      }

      let documento;
      try {
        documento = parse(request.body.query, { maxTokens: 1000 });
      } catch (err) {
        return reply.code(400).send({ errors: [{ message: err.message, extensions: { code: 'SINTAXIS' } }] });
      }
      const errores = validate(schema, documento, reglas, { maxErrors: 10 });
      if (errores.length) {
        return reply.code(400).send({ errors: errores.map((e) => ({ message: e.message, extensions: e.extensions?.code ? e.extensions : { code: 'VALIDACION' } })) });
      }
      const op = documento.definitions.find((d) => d.kind === Kind.OPERATION_DEFINITION);
      if (op && op.operation !== 'query') {
        return reply.code(400).send({ errors: [{ message: 'Solo se admiten consultas.', extensions: { code: 'OPERACION_NO_PERMITIDA' } }] });
      }

      // Contexto por solicitud: identidad verificada y lotes de carga propios.
      const ctx = {
        usuario: { id, rol },
        servicios,
        parcial: false,
        productos: crearLoader(async (ids) => new Map((await servicios.inventory.productos(ids)).map((p) => [p.id, p]))),
        clientes: crearLoader(async (ids) => new Map(await Promise.all(ids.map(async (cid) => [cid, await servicios.clients.cliente(cid)]))))
      };

      const plazo = new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('plazo')), LIMITES.plazoMs).unref());
      let resultado;
      try {
        resultado = await Promise.race([
          execute({ schema, document: documento, rootValue: raiz, contextValue: ctx, variableValues: request.body.variables, operationName: request.body.operationName }),
          plazo
        ]);
      } catch {
        return reply.code(504).send({ errors: [{ message: 'La consulta superó el plazo máximo.', extensions: { code: 'PLAZO_EXCEDIDO' } }] });
      }

      // Errores sin detalles internos (solo mensaje, ruta y código).
      const cuerpo = { data: resultado.data ?? null };
      if (resultado.errors?.length) {
        cuerpo.errors = resultado.errors.map((e) => ({
          message: e.originalError instanceof GraphQLError || !e.originalError ? e.message : 'Error al resolver el campo.',
          path: e.path,
          extensions: { code: e.extensions?.code || (e.originalError?.code === 'DEPENDENCIA' ? 'DEPENDENCIA_NO_DISPONIBLE' : 'ERROR_INTERNO') }
        }));
        for (const e of resultado.errors) if (!(e.originalError instanceof GraphQLError) && e.originalError) request.log.error({ err: e.originalError.message }, 'error en resolver');
      }
      // Una respuesta incompleta nunca se presenta como completa.
      if (ctx.parcial || cuerpo.errors?.some((e) => e.extensions.code === 'DEPENDENCIA_NO_DISPONIBLE')) {
        cuerpo.extensions = { parcial: true };
      }
      return cuerpo;
    }
  );

  return app;
}

module.exports = { buildApp, LIMITES, SDL };
