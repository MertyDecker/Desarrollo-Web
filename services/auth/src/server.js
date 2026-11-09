'use strict';

const mongoose = require('mongoose');
const { buildApp } = require('./app');
const { repoMongo, Credencial, TokenRevocado } = require('./repo.mongo');
const { leerSecreto } = require('./secrets');
const { hashPassword } = require('./password');

const PORT = Number(process.env.PORT || 3003);
const HOST = process.env.HOST || '0.0.0.0';

// Crea la cuenta de administrador una sola vez. La contraseña viene de un
// secreto montado por Docker, nunca del código ni del repositorio.
async function asegurarAdmin() {
  const correo = process.env.ADMIN_EMAIL;
  if (!correo || (await repoMongo.existeAdmin())) return;
  const password = leerSecreto('ADMIN_PASSWORD_FILE');
  await Credencial.create({
    clienteId: 'admin-1',
    correo: correo.toLowerCase(),
    passwordHash: await hashPassword(password),
    rol: 'admin',
    estado: 'activo'
  });
  console.log(`Cuenta de administrador creada para ${correo}.`);
}

async function main() {
  if (!process.env.MONGO_URL) {
    console.error('Falta la variable de entorno MONGO_URL.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 10000 });
  await Promise.all([Credencial.init(), TokenRevocado.init()]);
  await asegurarAdmin();

  const app = buildApp({
    repo: repoMongo,
    serviceTokens: {
      gateway: leerSecreto('SVC_TOKEN_GATEWAY_FILE'),
      clients: leerSecreto('SVC_TOKEN_CLIENTS_FILE')
    },
    privateKeyPem: leerSecreto('JWT_PRIVATE_KEY_FILE'),
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
  console.error('No se pudo iniciar auth:', err.message);
  process.exit(1);
});
