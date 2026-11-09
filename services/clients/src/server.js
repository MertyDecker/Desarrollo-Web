'use strict';

const mongoose = require('mongoose');
const { buildApp } = require('./app');
const { repoMongo, Cliente } = require('./repo.mongo');
const { leerSecreto } = require('./secrets');
const { crearAuthClient } = require('./authClient');
const { crearMailer } = require('./mailer');

const PORT = Number(process.env.PORT || 3002);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  if (!process.env.MONGO_URL || !process.env.AUTH_URL) {
    console.error('Faltan variables de entorno MONGO_URL o AUTH_URL.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 10000 });
  await Cliente.init();

  const app = buildApp({
    repo: repoMongo,
    authClient: crearAuthClient({
      baseUrl: process.env.AUTH_URL,
      token: leerSecreto('SVC_TOKEN_CLIENTS_AUTH_FILE')
    }),
    mailer: crearMailer({ adaptador: process.env.MAIL_ADAPTER || 'dev' }),
    serviceTokens: {
      gateway: leerSecreto('SVC_TOKEN_GATEWAY_FILE'),
      orders: leerSecreto('SVC_TOKEN_ORDERS_FILE'),
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
  console.error('No se pudo iniciar clients:', err.message);
  process.exit(1);
});
