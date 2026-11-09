'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp, EMPAQUE_ECOLOGICO, TARIFA_ENVIO } = require('../src/app');
const { repoMemoria, inventoryFalso, clientsFalso, P1, P2 } = require('./helpers/fakes');

const TOK = { gateway: 'token-prueba-gateway-orders-01', payments: 'token-prueba-payments-orders-1', graphql: 'token-prueba-graphql-orders-01' };

function nueva(opts = {}) {
  const repo = repoMemoria();
  const inventory = inventoryFalso(opts);
  const app = buildApp({ repo, inventory, clients: clientsFalso, serviceTokens: TOK });
  const como = (quien, extra) => (o) =>
    app.inject({ ...o, headers: { 'x-service-token': TOK[quien], ...extra, ...(o.headers || {}) } });
  return {
    repo, inventory,
    cli1: como('gateway', { 'x-user-id': 'cli-1', 'x-user-role': 'cliente' }),
    cli2: como('gateway', { 'x-user-id': 'cli-2', 'x-user-role': 'cliente' }),
    admin: como('gateway', { 'x-user-id': 'admin-1', 'x-user-role': 'admin' }),
    payments: como('payments', {})
  };
}

const PEDIDO = { items: [{ productoId: P1, cantidad: 2 }], direccionId: 'dir-cli-1-a' };
const crear = (s, clave = 'clave-0001', body = PEDIDO) =>
  s.cli1({ method: 'POST', url: '/orders', payload: body, headers: { 'idempotency-key': clave } });

test('Crear pedido: el servidor calcula totales y reserva stock', async () => {
  const s = nueva();
  const r = await crear(s);
  assert.equal(r.statusCode, 201);
  const p = r.json();
  assert.equal(p.subtotal, 8990 * 2);
  assert.equal(p.envio, 0, 'Providencia está dentro del radio de despacho gratis');
  assert.equal(p.empaque, EMPAQUE_ECOLOGICO);
  assert.equal(p.total, 8990 * 2 + EMPAQUE_ECOLOGICO);
  assert.equal(p.estado, 'pendiente_pago');
  assert.equal(s.inventory.stock.get(P1), 3);
  assert.equal(p.clienteId, undefined, 'el cliente no recibe ids internos');
});

test('Comuna fuera del radio paga despacho', async () => {
  const s = nueva();
  const r = await s.cli2({ method: 'POST', url: '/orders', payload: { items: [{ productoId: P1, cantidad: 1 }], direccionId: 'dir-cli-2-a' }, headers: { 'idempotency-key': 'clave-maipu-1' } });
  assert.equal(r.json().envio, TARIFA_ENVIO);
});

test('Idempotencia: el mismo pedido con la misma clave no se duplica', async () => {
  const s = nueva();
  const a = await crear(s);
  const b = await crear(s);
  assert.equal(b.statusCode, 200);
  assert.equal(b.headers['idempotent-replay'], 'true');
  assert.equal(b.json().id, a.json().id);
  assert.equal(s.repo.pedidos.size, 1);
  assert.equal(s.inventory.stock.get(P1), 3, 'no reserva dos veces');
});

test('Misma clave con otro contenido -> 422; sin clave -> 400', async () => {
  const s = nueva();
  await crear(s);
  const otro = await crear(s, 'clave-0001', { items: [{ productoId: P1, cantidad: 1 }], direccionId: 'dir-cli-1-a' });
  assert.equal(otro.statusCode, 422);
  const sin = await s.cli1({ method: 'POST', url: '/orders', payload: PEDIDO });
  assert.equal(sin.statusCode, 400);
});

test('Precio o total enviados por el navegador se rechazan', async () => {
  const s = nueva();
  const r = await crear(s, 'clave-precio', { items: [{ productoId: P1, cantidad: 1, precio: 1 }], direccionId: 'dir-cli-1-a', total: 1 });
  assert.equal(r.statusCode, 400);
});

test('Sin stock: 409 y se liberan las reservas parciales', async () => {
  const s = nueva();
  const r = await crear(s, 'clave-stock', { items: [{ productoId: P1, cantidad: 2 }, { productoId: P2, cantidad: 3 }], direccionId: 'dir-cli-1-a' });
  assert.equal(r.statusCode, 409);
  assert.equal(s.inventory.stock.get(P1), 5, 'el stock reservado del primer producto se recuperó');
  assert.equal(s.repo.pedidos.size, 0);
});

test('Dirección de otro cliente -> 400', async () => {
  const s = nueva();
  const r = await crear(s, 'clave-dir', { items: [{ productoId: P1, cantidad: 1 }], direccionId: 'dir-cli-2-a' });
  assert.equal(r.statusCode, 400);
});

test('Pedido ajeno responde 404 sin datos; admin lo ve', async () => {
  const s = nueva();
  const id = (await crear(s)).json().id;
  const ajeno = await s.cli2({ method: 'GET', url: `/orders/${id}` });
  assert.equal(ajeno.statusCode, 404);
  assert.equal(ajeno.json().items, undefined);
  assert.equal((await s.cli1({ method: 'GET', url: `/orders/${id}` })).statusCode, 200);
  assert.equal((await s.admin({ method: 'GET', url: `/orders/${id}` })).json().clienteId, 'cli-1');
  assert.equal((await s.cli2({ method: 'GET', url: '/orders' })).json().length, 0, 'la lista solo trae los propios');
});

test('Cancelar recupera stock; no se puede cancelar un pedido pagado', async () => {
  const s = nueva();
  const id = (await crear(s)).json().id;
  const c = await s.cli1({ method: 'POST', url: `/orders/${id}/cancel` });
  assert.equal(c.json().estado, 'cancelado');
  assert.equal(s.inventory.stock.get(P1), 5);
  const id2 = (await crear(s, 'clave-0002')).json().id;
  const total = s.repo.pedidos.get(id2).total;
  await s.payments({ method: 'POST', url: `/internal/orders/${id2}/paid`, payload: { pagoId: 'pago-000000001', monto: total } });
  assert.equal((await s.cli1({ method: 'POST', url: `/orders/${id2}/cancel` })).statusCode, 409);
});

test('Pago: monto distinto al total se rechaza; aviso repetido no cambia nada', async () => {
  const s = nueva();
  const id = (await crear(s)).json().id;
  const mal = await s.payments({ method: 'POST', url: `/internal/orders/${id}/paid`, payload: { pagoId: 'pago-000000001', monto: 1 } });
  assert.equal(mal.statusCode, 409);
  const total = s.repo.pedidos.get(id).total;
  const ok = await s.payments({ method: 'POST', url: `/internal/orders/${id}/paid`, payload: { pagoId: 'pago-000000001', monto: total } });
  const rep = await s.payments({ method: 'POST', url: `/internal/orders/${id}/paid`, payload: { pagoId: 'pago-000000001', monto: total } });
  assert.equal(ok.json().estado, 'pagado');
  assert.equal(rep.statusCode, 200);
  assert.equal(s.repo.pedidos.get(id).historial.length, 2);
});

test('Ciclo de estados: solo transiciones válidas y solo admin', async () => {
  const s = nueva();
  const id = (await crear(s)).json().id;
  const salto = await s.admin({ method: 'PATCH', url: `/orders/${id}/status`, payload: { estado: 'entregado' } });
  assert.equal(salto.statusCode, 409);
  const cli = await s.cli1({ method: 'PATCH', url: `/orders/${id}/status`, payload: { estado: 'cancelado' } });
  assert.equal(cli.statusCode, 403);
});

test('El gateway no puede marcar pagos; inventory caído -> 503', async () => {
  const s = nueva();
  const id = (await crear(s)).json().id;
  const g = await s.cli1({ method: 'POST', url: `/internal/orders/${id}/paid`, payload: { pagoId: 'pago-000000001', monto: 1 } });
  assert.equal(g.statusCode, 403);
  const caido = nueva({ caido: true });
  assert.equal((await crear(caido)).statusCode, 503);
});
