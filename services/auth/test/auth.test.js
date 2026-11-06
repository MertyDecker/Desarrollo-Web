'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildApp, MAX_INTENTOS } = require('../src/app');
const { hashPassword, verifyPassword } = require('../src/password');

const { repoMemoria } = require('./helpers/memoryRepo');
const TOK_GW = 'token-prueba-gateway-auth-0001';
const TOK_CL = 'token-prueba-clients-auth-0001';
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' });

function nueva(repo = repoMemoria(), ahora) {
  const app = buildApp({
    repo,
    serviceTokens: { gateway: TOK_GW, clients: TOK_CL },
    privateKeyPem: PRIV,
    ...(ahora ? { ahora } : {})
  });
  const como = (token) => (opts) =>
    app.inject({ ...opts, headers: { 'x-service-token': token, ...(opts.headers || {}) } });
  return { repo, gateway: como(TOK_GW), clients: como(TOK_CL), app };
}

const CRED = { clienteId: 'c-1', correo: 'S.Allende@Ejemplo.cl', password: 'Sushi2026' };

async function crearActiva(s) {
  await s.clients({ method: 'POST', url: '/internal/credentials', payload: CRED });
  await s.clients({ method: 'POST', url: '/internal/credentials/c-1/activate' });
}

function decodificar(token) {
  const [h, p, f] = token.split('.');
  const ok = crypto.verify(
    'sha256',
    Buffer.from(`${h}.${p}`),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(f, 'base64url')
  );
  return { ok, header: JSON.parse(Buffer.from(h, 'base64url')), payload: JSON.parse(Buffer.from(p, 'base64url')) };
}

test('La contraseña se guarda con hash scrypt con sal, nunca en texto plano', async () => {
  const s = nueva();
  await s.clients({ method: 'POST', url: '/internal/credentials', payload: CRED });
  const guardada = s.repo.creds.get('c-1');
  assert.ok(guardada.passwordHash.startsWith('scrypt$'));
  assert.ok(!guardada.passwordHash.includes(CRED.password));
  const otro = await hashPassword(CRED.password);
  assert.notEqual(otro, guardada.passwordHash, 'sal distinta en cada hash');
  assert.equal(await verifyPassword(CRED.password, guardada.passwordHash), true);
  assert.equal(await verifyPassword('otraClave1', guardada.passwordHash), false);
});

test('Alta de credencial: el rol siempre es cliente y el correo se normaliza', async () => {
  const s = nueva();
  const res = await s.clients({ method: 'POST', url: '/internal/credentials', payload: CRED });
  assert.equal(res.statusCode, 201);
  const c = s.repo.creds.get('c-1');
  assert.equal(c.rol, 'cliente');
  assert.equal(c.correo, 's.allende@ejemplo.cl');
  const conRol = await s.clients({
    method: 'POST',
    url: '/internal/credentials',
    payload: { ...CRED, clienteId: 'c-2', correo: 'x@y.cl', rol: 'admin' }
  });
  assert.equal(conRol.statusCode, 400, 'no se acepta un campo "rol" enviado por el cliente');
});

test('Alta de credencial: contraseña débil 400 y correo repetido 409', async () => {
  const s = nueva();
  const debil = await s.clients({
    method: 'POST',
    url: '/internal/credentials',
    payload: { ...CRED, password: 'solotexto' }
  });
  assert.equal(debil.statusCode, 400);
  await s.clients({ method: 'POST', url: '/internal/credentials', payload: CRED });
  const repetida = await s.clients({
    method: 'POST',
    url: '/internal/credentials',
    payload: { ...CRED, clienteId: 'c-9' }
  });
  assert.equal(repetida.statusCode, 409);
});

test('Solo clients puede crear credenciales y solo el gateway puede hacer login', async () => {
  const s = nueva();
  const desdeGateway = await s.gateway({ method: 'POST', url: '/internal/credentials', payload: CRED });
  assert.equal(desdeGateway.statusCode, 403);
  const loginDesdeClients = await s.clients({
    method: 'POST',
    url: '/login',
    payload: { correo: CRED.correo, password: CRED.password }
  });
  assert.equal(loginDesdeClients.statusCode, 403);
  const sinToken = await s.app.inject({ method: 'POST', url: '/login', payload: {} });
  assert.equal(sinToken.statusCode, 401);
});

test('Login antes de validar el correo responde 403', async () => {
  const s = nueva();
  await s.clients({ method: 'POST', url: '/internal/credentials', payload: CRED });
  const res = await s.gateway({
    method: 'POST',
    url: '/login',
    payload: { correo: CRED.correo, password: CRED.password }
  });
  assert.equal(res.statusCode, 403);
});

test('Login correcto entrega un JWT ES256 válido con rol, jti y vencimiento de 15 minutos', async () => {
  const s = nueva();
  await crearActiva(s);
  const res = await s.gateway({
    method: 'POST',
    url: '/login',
    payload: { correo: 's.allende@ejemplo.cl', password: CRED.password }
  });
  assert.equal(res.statusCode, 200);
  const { token, expiraEn, rol } = res.json();
  assert.equal(rol, 'cliente');
  assert.equal(expiraEn, 900);
  const jwt = decodificar(token);
  assert.equal(jwt.ok, true, 'la firma se verifica con la clave pública');
  assert.equal(jwt.header.alg, 'ES256');
  assert.equal(jwt.payload.sub, 'c-1');
  assert.equal(jwt.payload.rol, 'cliente');
  assert.equal(jwt.payload.exp - jwt.payload.iat, 900);
  assert.ok(jwt.payload.jti);
  assert.ok(!JSON.stringify(jwt.payload).includes('allende'), 'el token no lleva datos personales');
});

test('Credenciales inválidas: mismo mensaje para correo inexistente y clave incorrecta', async () => {
  const s = nueva();
  await crearActiva(s);
  const malaClave = await s.gateway({
    method: 'POST',
    url: '/login',
    payload: { correo: CRED.correo, password: 'Incorrecta1' }
  });
  const noExiste = await s.gateway({
    method: 'POST',
    url: '/login',
    payload: { correo: 'nadie@ejemplo.cl', password: 'Incorrecta1' }
  });
  assert.equal(malaClave.statusCode, 401);
  assert.equal(noExiste.statusCode, 401);
  assert.deepEqual(malaClave.json(), noExiste.json());
});

test(`Tras ${MAX_INTENTOS} intentos fallidos la cuenta se bloquea temporalmente (429)`, async () => {
  let reloj = 1_000_000;
  const s = nueva(repoMemoria(), () => reloj);
  await crearActiva(s);
  for (let i = 0; i < MAX_INTENTOS; i++) {
    await s.gateway({ method: 'POST', url: '/login', payload: { correo: CRED.correo, password: 'Mala12345' } });
  }
  const bloqueado = await s.gateway({
    method: 'POST',
    url: '/login',
    payload: { correo: CRED.correo, password: CRED.password }
  });
  assert.equal(bloqueado.statusCode, 429, 'ni siquiera la clave correcta entra durante el bloqueo');
  reloj += 16 * 60 * 1000;
  const despues = await s.gateway({
    method: 'POST',
    url: '/login',
    payload: { correo: CRED.correo, password: CRED.password }
  });
  assert.equal(despues.statusCode, 200);
});

test('Logout revoca el token y la consulta de revocación lo confirma', async () => {
  const s = nueva();
  const antes = await s.gateway({ method: 'GET', url: '/internal/tokens/abc-123' });
  assert.deepEqual(antes.json(), { revoked: false });
  const out = await s.gateway({
    method: 'POST',
    url: '/logout',
    headers: { 'x-token-jti': 'abc-123', 'x-token-exp': String(Math.floor(Date.now() / 1000) + 600) }
  });
  assert.equal(out.statusCode, 204);
  const despues = await s.gateway({ method: 'GET', url: '/internal/tokens/abc-123' });
  assert.deepEqual(despues.json(), { revoked: true });
});

test('Compensación: solo se elimina una credencial que nunca se activó', async () => {
  const s = nueva();
  await crearActiva(s);
  await s.clients({ method: 'DELETE', url: '/internal/credentials/c-1' });
  assert.ok(s.repo.creds.has('c-1'), 'una cuenta activa no se borra');
});
