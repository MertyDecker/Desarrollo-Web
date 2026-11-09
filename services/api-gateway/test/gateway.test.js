'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { buildApp } = require('../src/app');

// ---- Claves y tokens de prueba ---------------------------------------------
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PUB = publicKey.export({ type: 'spki', format: 'pem' });
const otraClave = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
const b64u = (v) => Buffer.from(v).toString('base64url');

function firmar(payload, { key = privateKey, alg = 'ES256' } = {}) {
  const datos = `${b64u(JSON.stringify({ alg, typ: 'JWT' }))}.${b64u(JSON.stringify(payload))}`;
  if (alg === 'none') return `${datos}.`;
  const firma = crypto.sign('sha256', Buffer.from(datos), { key, dsaEncoding: 'ieee-p1363' });
  return `${datos}.${b64u(firma)}`;
}

function token(rol = 'cliente', extra = {}) {
  const iat = Math.floor(Date.now() / 1000);
  return firmar({
    iss: 'fukusuke-auth',
    aud: 'fukusuke-gateway',
    sub: rol === 'admin' ? 'admin-1' : 'cliente-a',
    rol,
    jti: crypto.randomUUID(),
    iat,
    exp: iat + 900,
    ...extra
  });
}

const TOKENS = { inventory: 'tok-gw-inventory-0001', clients: 'tok-gw-clients-00001', auth: 'tok-gw-auth-000000001', orders: 'tok-gw-orders-0000001', payments: 'tok-gw-payments-00001', graphql: 'tok-gw-graphql-000001' };

// ---- Servicios internos falsos: registran lo que reciben --------------------
function servicioFalso(responder) {
  const recibidas = [];
  const server = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => (cuerpo += c));
    req.on('end', async () => {
      const r = { metodo: req.method, url: req.url, headers: req.headers, cuerpo };
      recibidas.push(r);
      const { status = 200, json, demoraMs = 0 } = (await responder(r)) || {};
      setTimeout(() => {
        res.writeHead(status, { 'content-type': 'application/json', 'x-interno': 'no-debe-salir' });
        res.end(json === undefined ? '' : JSON.stringify(json));
      }, demoraMs);
    });
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, recibidas, server }))
  );
}

async function escenario({ revocados = new Set(), authCaido = false, inventario, timeoutMs = 1000 } = {}) {
  const inv = await servicioFalso(
    inventario || ((r) => ({ json: [{ id: '1', nombre: 'Dragon Roll', ruta: r.url }] }))
  );
  const cli = await servicioFalso(() => ({ json: { id: 'cliente-a' } }));
  const auth = await servicioFalso((r) => {
    if (authCaido) return { status: 500, json: { error: 'stack: mongodb://secreto' } };
    if (r.url.startsWith('/internal/tokens/')) {
      return { json: { revoked: revocados.has(decodeURIComponent(r.url.split('/').pop())) } };
    }
    if (r.url === '/logout') return { status: 204 };
    return { json: { token: 'x', expiraEn: 900 } };
  });
  const ord = await servicioFalso(() => ({ json: { id: 'pedido-1' } }));
  const pay = await servicioFalso((r) => (r.url === '/webhook' && r.headers['x-signature'] !== 'firma-buena' ? { status: 401, json: { error: 'Firma inválida' } } : { json: { ok: true } }));
  const gql = await servicioFalso(() => ({ json: { data: {} } }));
  const app = await buildApp({
    config: {
      publicKeyPem: PUB,
      upstreams: { inventory: inv.url, clients: cli.url, auth: auth.url, orders: ord.url, payments: pay.url, graphql: gql.url },
      serviceTokens: TOKENS,
      corsOrigin: 'http://localhost:5500',
      timeoutMs
    }
  });
  const cerrar = async () => {
    await app.close();
    for (const s of [inv, cli, auth, ord, pay, gql]) s.server.close();
  };
  return { app, inv, cli, auth, ord, pay, gql, cerrar };
}

const bearer = (t) => ({ authorization: `Bearer ${t}` });

// ---- Pruebas -----------------------------------------------------------------

test('S01 anónimo: llega a inventory con su token de servicio y sin identidad de usuario', async () => {
  const e = await escenario();
  try {
    const res = await e.app.inject({ method: 'GET', url: '/api/v1/products?available=true' });
    assert.equal(res.statusCode, 200);
    const r = e.inv.recibidas[0];
    assert.equal(r.url, '/products?available=true');
    assert.equal(r.headers['x-service-token'], TOKENS.inventory);
    assert.equal(r.headers['x-user-id'], undefined);
    assert.equal(res.headers['x-interno'], undefined, 'no se filtran cabeceras internas');
  } finally {
    await e.cerrar();
  }
});

test('Cabeceras falsificadas por el navegador se descartan', async () => {
  const e = await escenario();
  try {
    await e.app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: { 'x-user-id': 'admin-1', 'x-user-role': 'admin', 'x-service-token': 'robado' }
    });
    const h = e.inv.recibidas[0].headers;
    assert.equal(h['x-user-id'], undefined);
    assert.equal(h['x-user-role'], undefined);
    assert.equal(h['x-service-token'], TOKENS.inventory);

    await e.app.inject({
      method: 'GET',
      url: '/api/v1/clients/me',
      headers: { ...bearer(token('cliente')), 'x-user-id': 'otro-cliente' }
    });
    assert.equal(e.cli.recibidas[0].headers['x-user-id'], 'cliente-a', 'manda la identidad del token, no la del navegador');
  } finally {
    await e.cerrar();
  }
});

test('Ruta protegida sin token: 401 y no llega al servicio', async () => {
  const e = await escenario();
  try {
    const res = await e.app.inject({ method: 'GET', url: '/api/v1/clients/me' });
    assert.equal(res.statusCode, 401);
    assert.equal(e.cli.recibidas.length, 0);
  } finally {
    await e.cerrar();
  }
});

test('Tokens inválidos: firma de otra clave, alg none, vencido, otra audiencia → 401', async () => {
  const e = await escenario();
  try {
    const iat = Math.floor(Date.now() / 1000);
    const base = { iss: 'fukusuke-auth', aud: 'fukusuke-gateway', sub: 'x', rol: 'admin', jti: 'j', iat, exp: iat + 900 };
    const casos = [
      firmar(base, { key: otraClave }),
      firmar(base, { alg: 'none' }),
      firmar({ ...base, iat: iat - 2000, exp: iat - 1000 }),
      firmar({ ...base, aud: 'otro-sistema' }),
      'no.es.un.jwt'
    ];
    for (const t of casos) {
      const res = await e.app.inject({ method: 'POST', url: '/api/v1/products', headers: bearer(t), payload: {} });
      assert.equal(res.statusCode, 401, t.slice(0, 30));
    }
    assert.equal(e.inv.recibidas.length, 0);
  } finally {
    await e.cerrar();
  }
});

test('Rol sin permiso: un cliente no puede crear ni borrar productos (403)', async () => {
  const e = await escenario();
  try {
    const post = await e.app.inject({ method: 'POST', url: '/api/v1/products', headers: bearer(token('cliente')), payload: { nombre: 'x' } });
    const del = await e.app.inject({ method: 'DELETE', url: '/api/v1/products/abc', headers: bearer(token('cliente')) });
    assert.equal(post.statusCode, 403);
    assert.equal(del.statusCode, 403);
    assert.equal(e.inv.recibidas.length, 0);
  } finally {
    await e.cerrar();
  }
});

test('Administrador: la operación llega a inventory con identidad y rol verificados', async () => {
  const e = await escenario({ inventario: () => ({ status: 201, json: { id: 'n1' } }) });
  try {
    const res = await e.app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: bearer(token('admin')),
      payload: { nombre: 'Gyozas', precio: 4500 }
    });
    assert.equal(res.statusCode, 201);
    const r = e.inv.recibidas[0];
    assert.equal(r.headers['x-user-role'], 'admin');
    assert.equal(r.headers['x-user-id'], 'admin-1');
    assert.equal(r.headers.authorization, undefined, 'el token del usuario no viaja a los servicios');
    assert.deepEqual(JSON.parse(r.cuerpo), { nombre: 'Gyozas', precio: 4500 });
  } finally {
    await e.cerrar();
  }
});

test('Token revocado (sesión cerrada): 401', async () => {
  const t = token('cliente');
  const jti = JSON.parse(Buffer.from(t.split('.')[1], 'base64url')).jti;
  const e = await escenario({ revocados: new Set([jti]) });
  try {
    const res = await e.app.inject({ method: 'GET', url: '/api/v1/clients/me', headers: bearer(t) });
    assert.equal(res.statusCode, 401);
  } finally {
    await e.cerrar();
  }
});

test('Si auth no responde, las rutas protegidas fallan cerrado (503) sin filtrar detalles', async () => {
  const e = await escenario({ authCaido: true });
  try {
    const res = await e.app.inject({ method: 'GET', url: '/api/v1/clients/me', headers: bearer(token()) });
    assert.equal(res.statusCode, 503);
    assert.ok(!res.body.includes('mongodb'));
    const publico = await e.app.inject({ method: 'GET', url: '/api/v1/products' });
    assert.equal(publico.statusCode, 200, 'el catálogo público sigue funcionando');
  } finally {
    await e.cerrar();
  }
});

test('Logout envía a auth solo el jti y el vencimiento del token', async () => {
  const e = await escenario();
  try {
    const res = await e.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: bearer(token()) });
    assert.equal(res.statusCode, 204);
    const r = e.auth.recibidas.find((x) => x.url === '/logout');
    assert.ok(r.headers['x-token-jti']);
    assert.ok(r.headers['x-token-exp']);
    assert.equal(r.headers['x-service-token'], TOKENS.auth);
  } finally {
    await e.cerrar();
  }
});

test('Servicio interno lento: 504; servicio caído: 502; error 500 interno: 502 sin detalles', async () => {
  const lento = await escenario({ inventario: () => ({ demoraMs: 400, json: [] }), timeoutMs: 100 });
  try {
    const r = await lento.app.inject({ method: 'GET', url: '/api/v1/products' });
    assert.equal(r.statusCode, 504);
  } finally {
    await lento.cerrar();
  }

  const roto = await escenario({ inventario: () => ({ status: 500, json: { error: 'TypeError at /app/src/x.js' } }) });
  try {
    const r = await roto.app.inject({ method: 'GET', url: '/api/v1/products' });
    assert.equal(r.statusCode, 502);
    assert.ok(!r.body.includes('/app/src'));
  } finally {
    await roto.cerrar();
  }

  const caido = await escenario();
  caido.inv.server.close();
  caido.inv.server.closeAllConnections();
  try {
    const r = await caido.app.inject({ method: 'GET', url: '/api/v1/products' });
    assert.equal(r.statusCode, 502);
  } finally {
    await caido.cerrar();
  }
});

test('Rutas y verbos no declarados responden 404 y no llegan a ningún servicio', async () => {
  const e = await escenario();
  try {
    for (const [method, url] of [
      ['GET', '/internal/tokens/x'],
      ['GET', '/products'],
      ['PATCH', '/api/v1/products/1'],
      ['GET', '/api/v1/clients'],
      ['POST', '/api/v1/auth/../../internal/credentials']
    ]) {
      const r = await e.app.inject({ method, url });
      assert.equal(r.statusCode, 404, `${method} ${url}`);
    }
    assert.equal(e.inv.recibidas.length + e.cli.recibidas.length + e.auth.recibidas.length, 0);
  } finally {
    await e.cerrar();
  }
});

test('Límite de solicitudes: el login acepta 10 intentos por minuto por IP', async () => {
  const e = await escenario();
  try {
    const codigos = [];
    for (let i = 0; i < 11; i++) {
      const r = await e.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { correo: 'a@b.cl', password: 'x' } });
      codigos.push(r.statusCode);
    }
    assert.equal(codigos.slice(0, 10).every((c) => c === 200), true);
    assert.equal(codigos[10], 429);
  } finally {
    await e.cerrar();
  }
});

test('CORS: solo se permite el origen del frontend configurado', async () => {
  const e = await escenario();
  try {
    const ok = await e.app.inject({ method: 'GET', url: '/api/v1/products', headers: { origin: 'http://localhost:5500' } });
    const otro = await e.app.inject({ method: 'GET', url: '/api/v1/products', headers: { origin: 'https://sitio-malicioso.com' } });
    assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:5500');
    assert.equal(otro.headers['access-control-allow-origin'], undefined);
  } finally {
    await e.cerrar();
  }
});

test('El gateway no arranca si falta la configuración de un servicio', async () => {
  await assert.rejects(
    buildApp({ config: { publicKeyPem: PUB, upstreams: { inventory: 'http://x' }, serviceTokens: TOKENS } })
  );
});

test('Pedidos: solo se reenvía Idempotency-Key de la lista blanca, con identidad verificada', async () => {
  const e = await escenario();
  try {
    const r = await e.app.inject({
      method: 'POST', url: '/api/v1/orders', payload: { items: [] },
      headers: { ...bearer(token('cliente')), 'idempotency-key': 'clave-123456', 'x-signature': 'colada', 'x-user-id': 'otro' }
    });
    assert.equal(r.statusCode, 200);
    const h = e.ord.recibidas[0].headers;
    assert.equal(h['idempotency-key'], 'clave-123456');
    assert.equal(h['x-signature'], undefined, 'cabecera fuera de la lista blanca de la ruta');
    assert.equal(h['x-user-id'], 'cliente-a');
    assert.equal(h['x-service-token'], TOKENS.orders);
  } finally { await e.cerrar(); }
});

test('Webhook de pagos: anónimo, reenvía la firma y propaga el 401 de firma inválida', async () => {
  const e = await escenario();
  try {
    const mala = await e.app.inject({ method: 'POST', url: '/api/v1/payments/webhook', payload: { a: 1 }, headers: { 'x-signature': 'falsa', 'x-timestamp': '1700000000' } });
    assert.equal(mala.statusCode, 401);
    const buena = await e.app.inject({ method: 'POST', url: '/api/v1/payments/webhook', payload: { a: 1 }, headers: { 'x-signature': 'firma-buena', 'x-timestamp': '1700000000' } });
    assert.equal(buena.statusCode, 200);
  } finally { await e.cerrar(); }
});

test('GraphQL y cambio de estado: sin sesión 401, cliente no puede cambiar estados (403)', async () => {
  const e = await escenario();
  try {
    assert.equal((await e.app.inject({ method: 'POST', url: '/api/v1/graphql', payload: { query: '{ misPedidos { id } }' } })).statusCode, 401);
    const est = await e.app.inject({ method: 'PATCH', url: '/api/v1/orders/x/status', payload: { estado: 'entregado' }, headers: bearer(token('cliente')) });
    assert.equal(est.statusCode, 403);
    assert.equal(e.ord.recibidas.length, 0);
  } finally { await e.cerrar(); }
});

test('Login con credenciales inválidas: el 401 de auth llega al navegador (no 502)', async () => {
  const e = await escenario();
  try {
    e.auth.server.removeAllListeners('request');
    e.auth.server.on('request', (req, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"Correo o contraseña incorrectos"}'); });
    const r = await e.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { correo: 'a@b.cl', password: 'x' } });
    assert.equal(r.statusCode, 401);
  } finally { await e.cerrar(); }
});
