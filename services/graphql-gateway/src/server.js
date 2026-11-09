'use strict';

const { buildApp } = require('./app');
const { leerSecreto } = require('./secrets');
const { crearServicios } = require('./upstreams');

const PORT = Number(process.env.PORT || 3006);
const HOST = process.env.HOST || '0.0.0.0';

function requerida(nombre) {
  if (!process.env[nombre]) throw new Error(`Falta la variable de entorno ${nombre}.`);
  return process.env[nombre];
}

async function main() {
  const app = buildApp({
    servicios: crearServicios({
      ordersUrl: requerida('ORDERS_URL'),
      inventoryUrl: requerida('INVENTORY_URL'),
      clientsUrl: requerida('CLIENTS_URL'),
      tokens: {
        orders: leerSecreto('SVC_TOKEN_GRAPHQL_ORDERS_FILE'),
        inventory: leerSecreto('SVC_TOKEN_GRAPHQL_INVENTORY_FILE'),
        clients: leerSecreto('SVC_TOKEN_GRAPHQL_CLIENTS_FILE')
      }
    }),
    serviceTokens: { gateway: leerSecreto('SVC_TOKEN_GATEWAY_FILE') },
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
  console.error('No se pudo iniciar graphql-gateway:', err.message);
  process.exit(1);
});
