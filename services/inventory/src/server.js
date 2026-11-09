'use strict';

const mongoose = require('mongoose');
const { buildApp } = require('./app');
const { repoMongo, Producto, Reserva } = require('./repo.mongo');
const { sembrar } = require('./seed');
const { leerSecreto } = require('./secrets');

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
const MONGO_URL = process.env.MONGO_URL;

async function main() {
  if (!MONGO_URL) {
    // La cadena de conexión incluye credenciales: viene del entorno, nunca del código.
    console.error('Falta la variable de entorno MONGO_URL.');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 10000 });
  await Promise.all([Producto.init(), Reserva.init()]); // asegura índices

  if (process.env.SEED_ON_START === 'true') {
    const creados = await sembrar(Producto);
    console.log(`Seed de desarrollo: ${creados} producto(s) nuevo(s).`);
  }

  const serviceTokens = {
    gateway: leerSecreto('SVC_TOKEN_GATEWAY_FILE'),
    orders: leerSecreto('SVC_TOKEN_ORDERS_FILE'),
    graphql: leerSecreto('SVC_TOKEN_GRAPHQL_FILE')
  };
  const app = buildApp({ repo: repoMongo, serviceTokens, logger: true });

  const cerrar = async (senal) => {
    app.log.info(`Recibida ${senal}, cerrando...`);
    await app.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => cerrar('SIGTERM'));
  process.on('SIGINT', () => cerrar('SIGINT'));

  await app.listen({ port: PORT, host: HOST });
}

main().catch((err) => {
  console.error('No se pudo iniciar inventory:', err.message);
  process.exit(1);
});
