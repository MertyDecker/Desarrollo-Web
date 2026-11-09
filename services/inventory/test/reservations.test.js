'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/app');
const { crearRepoMemoria } = require('./helpers/memoryRepo');

const TOK = { gateway: 'token-prueba-gateway-inventory', orders: 'token-prueba-orders-inventory', graphql: 'token-prueba-graphql-inventory' };

function nueva() {
  const repo = crearRepoMemoria([{ nombre: 'Dragon Roll', precio: 8990, stock: 5, categoria: 'rolls' }]);
  const app = buildApp({ repo, serviceTokens: TOK });
  const como = (quien, extra = {}) => (opts) =>
    app.inject({ ...opts, headers: { 'x-service-token': TOK[quien], ...extra, ...(opts.headers || {}) } });
  const id = [...repo._items.keys()][0];
  return { repo, id, gateway: como('gateway', { 'x-user-role': 'admin' }), orders: como('orders'), graphql: como('graphql') };
}

const PED = 'pedido-0000000001';

test('Reserva descuenta stock y es idempotente por pedido', async () => {
  const s = nueva();
  const a = await s.orders({ method: 'POST', url: `/products/${s.id}/reservations`, payload: { pedidoId: PED, cantidad: 2 } });
  assert.equal(a.statusCode, 201);
  const b = await s.orders({ method: 'POST', url: `/products/${s.id}/reservations`, payload: { pedidoId: PED, cantidad: 2 } });
  assert.equal(b.statusCode, 201);
  assert.equal(b.json().repetida, true);
  assert.equal(s.repo._items.get(s.id).stock, 3, 'la repetición no descuenta dos veces');
});

test('Sin stock suficiente responde 409 y no descuenta', async () => {
  const s = nueva();
  const r = await s.orders({ method: 'POST', url: `/products/${s.id}/reservations`, payload: { pedidoId: PED, cantidad: 6 } });
  assert.equal(r.statusCode, 409);
  assert.equal(s.repo._items.get(s.id).stock, 5);
});

test('Liberar devuelve el stock una sola vez', async () => {
  const s = nueva();
  await s.orders({ method: 'POST', url: `/products/${s.id}/reservations`, payload: { pedidoId: PED, cantidad: 4 } });
  await s.orders({ method: 'DELETE', url: `/products/${s.id}/reservations/${PED}` });
  await s.orders({ method: 'DELETE', url: `/products/${s.id}/reservations/${PED}` });
  assert.equal(s.repo._items.get(s.id).stock, 5);
});

test('El gateway y graphql no pueden reservar stock; orders no puede administrar', async () => {
  const s = nueva();
  const g = await s.gateway({ method: 'POST', url: `/products/${s.id}/reservations`, payload: { pedidoId: PED, cantidad: 1 } });
  const q = await s.graphql({ method: 'POST', url: `/products/${s.id}/reservations`, payload: { pedidoId: PED, cantidad: 1 } });
  const o = await s.orders({ method: 'DELETE', url: `/products/${s.id}`, headers: { 'x-user-role': 'admin' } });
  assert.deepEqual([g.statusCode, q.statusCode, o.statusCode], [403, 403, 403]);
});

test('Lectura por lote para graphql, con campos públicos', async () => {
  const s = nueva();
  const r = await s.graphql({ method: 'GET', url: `/internal/products?ids=${s.id}` });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json()[0].nombre, 'Dragon Roll');
  assert.equal(r.json()[0].stock, undefined, 'nunca expone el stock exacto');
});
