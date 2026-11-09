'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildApp } = require('../src/app');

const TOK = 'token-prueba-gateway-payments-1';
const SECRETO = 'secreto-de-prueba-del-proveedor-0001';
const PED = '11111111-1111-4111-8111-111111111111';

function repoMemoria() {
  const pagos = new Map();
  const eventos = new Set();
  return {
    pagos,
    async crear(p) { pagos.set(p.id, { ...p }); return { duplicado: false }; },
    async buscarPorId(id) { return pagos.get(id) || null; },
    async pendientePorPedido(pid) { return [...pagos.values()].find((p) => p.pedidoId === pid && p.estado === 'pendiente') || null; },
    async cambiarEstado(id, d, h) { const p = pagos.get(id); if (!p || p.estado !== d) return null; p.estado = h; return p; },
    async eventoProcesado(e) { return eventos.has(e); },
    async registrarEvento(e) { eventos.add(e); }
  };
}

function nueva({ ordersCaido = false } = {}) {
  const repo = repoMemoria();
  const pedido = { id: PED, clienteId: 'cli-1', estado: 'pendiente_pago', total: 19180 };
  const llamadas = [];
  const orders = {
    async pedido(id) { return id === PED ? pedido : null; },
    async marcarPagado(id, pagoId, monto) {
      if (ordersCaido) throw Object.assign(new Error('x'), { code: 'DEPENDENCIA' });
      llamadas.push({ id, pagoId, monto }); pedido.estado = 'pagado';
    }
  };
  const app = buildApp({ repo, orders, webhookSecret: SECRETO, serviceTokens: { gateway: TOK } });
  const como = (extra) => (o) => app.inject({ ...o, headers: { 'x-service-token': TOK, ...extra, ...(o.headers || {}) } });
  return { repo, pedido, llamadas, cli1: como({ 'x-user-id': 'cli-1', 'x-user-role': 'cliente' }), cli2: como({ 'x-user-id': 'cli-2', 'x-user-role': 'cliente' }), proveedor: como({}) };
}

function firmar(cuerpo, secreto = SECRETO, ts = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secreto).update(`${ts}.${JSON.stringify(cuerpo)}`).digest('hex');
  return { 'x-signature': sig, 'x-timestamp': String(ts) };
}

const iniciar = (s) => s.cli1({ method: 'POST', url: `/orders/${PED}/payments`, payload: { medio: 'webpay' } });

test('El monto del cobro lo fija el servidor; no se aceptan montos del navegador', async () => {
  const s = nueva();
  const r = await iniciar(s);
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().monto, 19180);
  const trampa = await s.cli1({ method: 'POST', url: `/orders/${PED}/payments`, payload: { medio: 'webpay', monto: 1 } });
  assert.equal(trampa.statusCode, 400);
});

test('Un solo cobro pendiente por pedido; pedido ajeno 404', async () => {
  const s = nueva();
  const a = await iniciar(s);
  const b = await iniciar(s);
  assert.equal(b.statusCode, 200);
  assert.equal(b.json().id, a.json().id);
  assert.equal((await s.cli2({ method: 'POST', url: `/orders/${PED}/payments`, payload: { medio: 'webpay' } })).statusCode, 404);
});

test('Webhook con firma válida aprueba el pago y confirma el pedido', async () => {
  const s = nueva();
  const pago = (await iniciar(s)).json();
  const ev = { eventoId: 'evt-000000001', pagoId: pago.id, estado: 'aprobado', monto: pago.monto };
  const r = await s.proveedor({ method: 'POST', url: '/webhook', payload: ev, headers: firmar(ev) });
  assert.equal(r.statusCode, 200);
  assert.equal(s.repo.pagos.get(pago.id).estado, 'aprobado');
  assert.equal(s.pedido.estado, 'pagado');
});

test('Webhook con firma falsa, secreto distinto o vencido -> 401', async () => {
  const s = nueva();
  const pago = (await iniciar(s)).json();
  const ev = { eventoId: 'evt-000000002', pagoId: pago.id, estado: 'aprobado', monto: pago.monto };
  const falsa = await s.proveedor({ method: 'POST', url: '/webhook', payload: ev, headers: { 'x-signature': 'a'.repeat(64), 'x-timestamp': String(Math.floor(Date.now() / 1000)) } });
  const otro = await s.proveedor({ method: 'POST', url: '/webhook', payload: ev, headers: firmar(ev, 'otro-secreto-que-no-es-el-real') });
  const viejo = await s.proveedor({ method: 'POST', url: '/webhook', payload: ev, headers: firmar(ev, SECRETO, Math.floor(Date.now() / 1000) - 3600) });
  assert.deepEqual([falsa.statusCode, otro.statusCode, viejo.statusCode], [401, 401, 401]);
  assert.equal(s.repo.pagos.get(pago.id).estado, 'pendiente');
});

test('Datos alterados: cambiar el monto invalida la firma; monto distinto firmado -> 409', async () => {
  const s = nueva();
  const pago = (await iniciar(s)).json();
  const ev = { eventoId: 'evt-000000003', pagoId: pago.id, estado: 'aprobado', monto: pago.monto };
  const alterado = { ...ev, monto: 1 };
  assert.equal((await s.proveedor({ method: 'POST', url: '/webhook', payload: alterado, headers: firmar(ev) })).statusCode, 401);
  assert.equal((await s.proveedor({ method: 'POST', url: '/webhook', payload: alterado, headers: firmar(alterado) })).statusCode, 409);
  assert.equal(s.pedido.estado, 'pendiente_pago');
});

test('Aviso repetido es idempotente: orders se llama una sola vez', async () => {
  const s = nueva();
  const pago = (await iniciar(s)).json();
  const ev = { eventoId: 'evt-000000004', pagoId: pago.id, estado: 'aprobado', monto: pago.monto };
  await s.proveedor({ method: 'POST', url: '/webhook', payload: ev, headers: firmar(ev) });
  const rep = await s.proveedor({ method: 'POST', url: '/webhook', payload: ev, headers: firmar(ev) });
  assert.equal(rep.json().duplicado, true);
  assert.equal(s.llamadas.length, 1);
});

test('Si orders no responde, el aviso no se da por procesado (503, el proveedor reintenta)', async () => {
  const s = nueva({ ordersCaido: true });
  const pago = (await iniciar(s)).json();
  const ev = { eventoId: 'evt-000000005', pagoId: pago.id, estado: 'aprobado', monto: pago.monto };
  assert.equal((await s.proveedor({ method: 'POST', url: '/webhook', payload: ev, headers: firmar(ev) })).statusCode, 503);
  assert.equal(s.repo.pagos.get(pago.id).estado, 'pendiente');
  assert.equal(await s.repo.eventoProcesado(ev.eventoId), false);
});

test('Estado del pago: solo el dueño', async () => {
  const s = nueva();
  const pago = (await iniciar(s)).json();
  assert.equal((await s.cli1({ method: 'GET', url: `/payments/${pago.id}` })).statusCode, 200);
  assert.equal((await s.cli2({ method: 'GET', url: `/payments/${pago.id}` })).statusCode, 404);
});
