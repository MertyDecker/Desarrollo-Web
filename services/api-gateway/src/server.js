'use strict';

const { buildApp } = require('./app');
const { leerSecreto } = require('./secrets');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

function requerida(nombre) {
  const v = process.env[nombre];
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}.`);
  return v;
}

async function main() {
  const app = await buildApp({
    config: {
      publicKeyPem: leerSecreto('JWT_PUBLIC_KEY_FILE'),
      upstreams: {
        inventory: requerida('INVENTORY_URL'),
        clients: requerida('CLIENTS_URL'),
        auth: requerida('AUTH_URL'),
        orders: requerida('ORDERS_URL'),
        payments: requerida('PAYMENTS_URL'),
        graphql: requerida('GRAPHQL_URL')
      },
      // Cada destino tiene su propia credencial de servicio.
      serviceTokens: {
        inventory: leerSecreto('SVC_TOKEN_INVENTORY_FILE'),
        clients: leerSecreto('SVC_TOKEN_CLIENTS_FILE'),
        auth: leerSecreto('SVC_TOKEN_AUTH_FILE'),
        orders: leerSecreto('SVC_TOKEN_ORDERS_FILE'),
        payments: leerSecreto('SVC_TOKEN_PAYMENTS_FILE'),
        graphql: leerSecreto('SVC_TOKEN_GRAPHQL_FILE')
      },
      corsOrigin: process.env.CORS_ORIGIN || false,
      // PRUEBA_CARGA=true solo para medir rendimiento desde un único equipo: los
      // límites por IP bloquearían la propia prueba. Nunca se usa en operación normal.
      factorLimites: process.env.PRUEBA_CARGA === 'true' ? 10000 : 1,
      timeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS || 5000)
    },
    logger: true
  });

  const cerrar = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);

  await app.listen({ port: PORT, host: HOST });
}

main().catch((err) => {
  console.error('No se pudo iniciar el API Gateway:', err.message);
  process.exit(1);
});
