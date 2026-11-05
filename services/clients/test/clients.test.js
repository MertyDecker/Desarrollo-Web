'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp, MAX_INTENTOS_CODIGO } = require('../src/app');
const { normalizarRun } = require('../src/run');

const { repoMemoria } = require('./helpers/memoryRepo');
const TOKEN = 'token-prueba-gateway-clients-01';

function authFalso({ falla = false, conflicto = false } = {}) {
  const llamadas = { crear: [], activar: [], eliminar: [] };
  return {
    llamadas,
    async crearCredencial(d) {
      llamadas.crear.push(d);
      if (falla) throw new Error('auth caído');
      if (conflicto) return { conflicto: true };
      return { ok: true };
    },
    async activar(id) {
      llamadas.activar.push(id);
    },
    async eliminar(id) {
      llamadas.eliminar.push(id);
    }
  };
}

function nueva({ auth = authFalso(), ahora } = {}) {
  const enviados = [];
  const repo = repoMemoria();
  const app = buildApp({
    repo,
    authClient: auth,
    mailer: { enviarCodigo: async (correo, codigo) => enviados.push({ correo, codigo }) },
    serviceTokens: { gateway: TOKEN },
    ...(ahora ? { ahora } : {})
  });
  const llamar = (opts, usuario) =>
    app.inject({
      ...opts,
      headers: { 'x-service-token': TOKEN, ...(usuario ? { 'x-user-id': usuario } : {}), ...(opts.headers || {}) }
    });
  return { app, repo, auth, enviados, llamar };
}

const REGISTRO = {
  run: '12.345.678-5',
  nombre: 'Sebastián Allende',
  direccion: 'Avenida Vitacura 4120, Apt 304',
  comuna: 'Vitacura',
  region: 'Metropolitana',
  correo: 'S.Allende@Ejemplo.cl',
  telefono: '+56 9 8765 4321',
  password: 'Sushi2026'
};

test('RUN: valida el dígito verificador (módulo 11) y normaliza el formato', () => {
  assert.equal(normalizarRun('12.345.678-5'), '12345678-5');
  assert.equal(normalizarRun('11111111-1'), '11111111-1');
  assert.equal(normalizarRun('12.345.678-9'), null);
  assert.equal(normalizarRun('abc'), null);
});

test('S08: registro crea el cliente pendiente, envía la contraseña solo a auth y manda un código', async () => {
  const s = nueva();
  const res = await s.llamar({ method: 'POST', url: '/clients', payload: REGISTRO });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(Object.keys(res.json()).sort(), ['correo', 'estado', 'id']);
  const guardado = s.repo.items.get(res.json().id);
  assert.equal(guardado.run, '12345678-5');
  assert.equal(guardado.correo, 's.allende@ejemplo.cl');
  assert.ok(!JSON.stringify(guardado).includes('Sushi2026'), 'clients nunca guarda la contraseña');
  assert.equal(s.auth.llamadas.crear[0].password, 'Sushi2026');
  assert.equal(s.enviados.length, 1);
  assert.match(s.enviados[0].codigo, /^\d{6}$/);
  assert.notEqual(guardado.codigoVerificacion.hash, s.enviados[0].codigo, 'se guarda el hash, no el código');
});

test('S08: RUN inválido, campos extra o faltantes responden 400', async () => {
  const s = nueva();
  for (const payload of [
    { ...REGISTRO, run: '12.345.678-9' },
    { ...REGISTRO, rol: 'admin' },
    { ...REGISTRO, sexo: 'M' },
    { ...REGISTRO, correo: 'no-es-correo' }
  ]) {
    const r = await s.llamar({ method: 'POST', url: '/clients', payload });
    assert.equal(r.statusCode, 400, JSON.stringify(payload));
  }
});

test('S08: RUN o correo repetido responde 409 con un mensaje que no revela cuál', async () => {
  const s = nueva();
  await s.llamar({ method: 'POST', url: '/clients', payload: REGISTRO });
  const mismoRun = await s.llamar({ method: 'POST', url: '/clients', payload: { ...REGISTRO, correo: 'otro@ejemplo.cl' } });
  const mismoCorreo = await s.llamar({ method: 'POST', url: '/clients', payload: { ...REGISTRO, run: '11111111-1' } });
  assert.equal(mismoRun.statusCode, 409);
  assert.equal(mismoCorreo.statusCode, 409);
  assert.deepEqual(mismoRun.json(), mismoCorreo.json());
});

test('S08: si auth no responde, el registro se deshace (compensación) y responde 503', async () => {
  const s = nueva({ auth: authFalso({ falla: true }) });
  const res = await s.llamar({ method: 'POST', url: '/clients', payload: REGISTRO });
  assert.equal(res.statusCode, 503);
  assert.equal(s.repo.items.size, 0, 'no queda un cliente a medias');
});

test('S09: el código correcto activa la cuenta en clients y en auth', async () => {
  const s = nueva();
  const { id } = (await s.llamar({ method: 'POST', url: '/clients', payload: REGISTRO })).json();
  const res = await s.llamar({
    method: 'POST',
    url: '/clients/verify-email',
    payload: { correo: REGISTRO.correo, codigo: s.enviados[0].codigo }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(s.repo.items.get(id).estado, 'activo');
  assert.deepEqual(s.auth.llamadas.activar, [id]);
});

test(`S09: código incorrecto 400 y bloqueo tras ${MAX_INTENTOS_CODIGO} intentos`, async () => {
  const s = nueva();
  await s.llamar({ method: 'POST', url: '/clients', payload: REGISTRO });
  const malo = s.enviados[0].codigo === '000000' ? '111111' : '000000';
  for (let i = 0; i < MAX_INTENTOS_CODIGO; i++) {
    const r = await s.llamar({ method: 'POST', url: '/clients/verify-email', payload: { correo: REGISTRO.correo, codigo: malo } });
    assert.equal(r.statusCode, 400);
  }
  const bloqueado = await s.llamar({
    method: 'POST',
    url: '/clients/verify-email',
    payload: { correo: REGISTRO.correo, codigo: s.enviados[0].codigo }
  });
  assert.equal(bloqueado.statusCode, 429);
});

test('S09: un código vencido no sirve', async () => {
  let reloj = 1_000_000;
  const s = nueva({ ahora: () => reloj });
  await s.llamar({ method: 'POST', url: '/clients', payload: REGISTRO });
  reloj += 16 * 60 * 1000;
  const r = await s.llamar({
    method: 'POST',
    url: '/clients/verify-email',
    payload: { correo: REGISTRO.correo, codigo: s.enviados[0].codigo }
  });
  assert.equal(r.statusCode, 400);
});

test('S12/S13: cada cliente ve y edita solo su propio perfil; sin identidad responde 401', async () => {
  const s = nueva();
  const a = (await s.llamar({ method: 'POST', url: '/clients', payload: REGISTRO })).json().id;
  const b = (
    await s.llamar({ method: 'POST', url: '/clients', payload: { ...REGISTRO, run: '11111111-1', correo: 'b@ejemplo.cl' } })
  ).json().id;

  const perfilA = await s.llamar({ method: 'GET', url: '/clients/me' }, a);
  assert.equal(perfilA.statusCode, 200);
  assert.equal(perfilA.json().id, a);
  assert.equal(perfilA.json().codigoVerificacion, undefined);

  const editado = await s.llamar({ method: 'PUT', url: '/clients/me', payload: { nombre: 'Nuevo Nombre', telefono: '+56 9 1111 2222' } }, b);
  assert.equal(editado.json().id, b);
  assert.equal(s.repo.items.get(a).nombre, 'Sebastián Allende', 'el perfil de A no cambió');

  const sinUsuario = await s.llamar({ method: 'GET', url: '/clients/me' });
  assert.equal(sinUsuario.statusCode, 401);

  const cambiarCorreo = await s.llamar({ method: 'PUT', url: '/clients/me', payload: { nombre: 'X Y', telefono: '+56 9 1111 2222', correo: 'z@z.cl' } }, a);
  assert.equal(cambiarCorreo.statusCode, 400, 'correo y RUN no son editables');
});

test('S14/S15: direcciones propias, con un máximo de 5', async () => {
  const s = nueva();
  const id = (await s.llamar({ method: 'POST', url: '/clients', payload: REGISTRO })).json().id;
  const dir = { direccion: 'Los Leones 123', comuna: 'Providencia', region: 'Metropolitana' };
  for (let i = 0; i < 4; i++) {
    const r = await s.llamar({ method: 'POST', url: '/clients/me/addresses', payload: dir }, id);
    assert.equal(r.statusCode, 201);
  }
  const sexta = await s.llamar({ method: 'POST', url: '/clients/me/addresses', payload: dir }, id);
  assert.equal(sexta.statusCode, 409);
  const lista = await s.llamar({ method: 'GET', url: '/clients/me/addresses' }, id);
  assert.equal(lista.json().length, 5);
});

test('Seguridad: sin token de servicio del gateway responde 401', async () => {
  const s = nueva();
  const r = await s.app.inject({ method: 'GET', url: '/clients/me', headers: { 'x-user-id': 'cualquiera' } });
  assert.equal(r.statusCode, 401);
});
