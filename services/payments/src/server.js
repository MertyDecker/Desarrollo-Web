'use strict';

const mongoose = require('mongoose');
const { buildApp } = require('./app');
const { repoMongo, Pago, EventoPago } = require('./repo.mongo');
const { leerSecreto } = require('./secrets');
const { crearOrdersClient } = require('./ordersClient');

const PORT = Number(process.env.PORT || 3005);
const HOST = process.env.HOST || '0.0.0.0';

function requerida(nombre) {
  if (!process.env[nombre]) throw new Error(`Falta la variable de entorno ${nombre}.`);
  return process.env[nombre];
}

async function main() {
  await mongoose.connect(requerida('MONGO_URL'), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([Pago.init(), EventoPago.init()]);

  const app = buildApp({
    repo: repoMongo,
    orders: crearOrdersClient({ baseUrl: requerida('ORDERS_URL'), token: leerSecreto('SVC_TOKEN_PAYMENTS_ORDERS_FILE') }),
    webhookSecret: leerSecreto('PAYMENTS_WEBHOOK_SECRET_FILE'),
    serviceTokens: { gateway: leerSecreto('SVC_TOKEN_GATEWAY_FILE') },
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
  console.error('No se pudo iniciar payments:', err.message);
  process.exit(1);
});
