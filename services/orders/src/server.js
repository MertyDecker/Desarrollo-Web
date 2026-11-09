'use strict';

const mongoose = require('mongoose');
const { buildApp } = require('./app');
const { repoMongo, Pedido } = require('./repo.mongo');
const { leerSecreto } = require('./secrets');
const { crearInventoryClient, crearClientsClient } = require('./upstreams');

const PORT = Number(process.env.PORT || 3004);
const HOST = process.env.HOST || '0.0.0.0';

function requerida(nombre) {
  if (!process.env[nombre]) throw new Error(`Falta la variable de entorno ${nombre}.`);
  return process.env[nombre];
}

async function main() {
  await mongoose.connect(requerida('MONGO_URL'), { serverSelectionTimeoutMS: 10000 });
  await Pedido.init();

  const app = buildApp({
    repo: repoMongo,
    inventory: crearInventoryClient({ baseUrl: requerida('INVENTORY_URL'), token: leerSecreto('SVC_TOKEN_ORDERS_INVENTORY_FILE') }),
    clients: crearClientsClient({ baseUrl: requerida('CLIENTS_URL'), token: leerSecreto('SVC_TOKEN_ORDERS_CLIENTS_FILE') }),
    serviceTokens: {
      gateway: leerSecreto('SVC_TOKEN_GATEWAY_FILE'),
      payments: leerSecreto('SVC_TOKEN_PAYMENTS_FILE'),
      graphql: leerSecreto('SVC_TOKEN_GRAPHQL_FILE')
    },
    logger: true
  });

  const cerrar = async () => {
    await app.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);

  await app.listen({ port: PORT, host: HOST });
}

main().catch((err) => {
  console.error('No se pudo iniciar orders:', err.message);
  process.exit(1);
});
