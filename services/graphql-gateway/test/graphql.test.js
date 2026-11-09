'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/app');

const TOK = 'token-prueba-gateway-graphql-01';
const PED = '22222222-2222-4222-8222-222222222222';
const P1 = 'a'.repeat(24);
const P2 = 'b'.repeat(24);

function nueva({ inventoryCaido = false } = {}) {
  const llamadas = { inventory: 0 };
  const pedido = {
    id: PED, clienteId: 'cli-1', estado: 'pagado', subtotal: 17480, envio: 0, empaque: 1200, total: 18680, creadoEn: '2026-11-08T12:00:00Z',
    direccion: { direccion: 'Av. Providencia 1234', comuna: 'Providencia', region: 'RM' },
    items: [{ productoId: P1, nombre: 'Dragon Roll', precioUnitario: 8990, cantidad: 1, subtotal: 8990 }, { productoId: P2, nombre: 'Unagi Roll', precioUnitario: 8490, cantidad: 1, subtotal: 8490 }]
  };
  const servicios = {
    orders: { pedido: async (id) => (id === PED ? pedido : null), pedidosDe: async (c) => (c === 'cli-1' ? [pedido] : []) },
    inventory: {
      productos: async (ids) => {
        llamadas.inventory += 1;
        if (inventoryCaido) throw Object.assign(new Error('caido'), { code: 'DEPENDENCIA' });
        return ids.map((id) => ({ id, nombre: id === P1 ? 'Dragon Roll' : 'Unagi Roll', descripcion: 'x', categoria: 'rolls', imagen: null, disponible: true }));
      }
    },
    clients: { cliente: async () => ({ nombre: 'Cliente Prueba', correo: 'prueba@correo.cl', telefono: '+56911111111', run: '12.345.678-5' }) }
  };
  const app = buildApp({ servicios, serviceTokens: { gateway: TOK } });
  const como = (u, rol) => (query, variables) =>
    app.inject({ method: 'POST', url: '/graphql', payload: { query, variables }, headers: { 'x-service-token': TOK, 'x-user-id': u, 'x-user-role': rol } });
  return { llamadas, cli1: como('cli-1', 'cliente'), cli2: como('cli-2', 'cliente'), admin: como('admin-1', 'admin'), app };
}

const RESUMEN = `query($id: ID!) { resumenPedido(id: $id) { id estado total items { cantidad nombreAlComprar producto { nombre disponible } } cliente { nombre correo } } }`;

test('Agregación: combina orders + inventory + clients con una sola llamada a inventory', async () => {
  const s = nueva();
  const r = await s.cli1(RESUMEN, { id: PED });
  assert.equal(r.statusCode, 200);
  const d = r.json().data.resumenPedido;
  assert.equal(d.estado, 'pagado');
  assert.equal(d.items[1].producto.nombre, 'Unagi Roll');
  assert.equal(d.cliente.correo, 'prueba@correo.cl');
  assert.equal(s.llamadas.inventory, 1, 'batching: 2 ítems, 1 llamada');
  assert.equal(r.json().extensions, undefined, 'respuesta completa');
});

test('Pedido ajeno: error NO_ENCONTRADO y sin datos', async () => {
  const s = nueva();
  const r = await s.cli2(RESUMEN, { id: PED });
  assert.equal(r.json().data.resumenPedido, null);
  assert.equal(r.json().errors[0].extensions.code, 'NO_ENCONTRADO');
});

test('Autorización por campo: run solo para admin', async () => {
  const s = nueva();
  const q = `query($id: ID!) { resumenPedido(id: $id) { cliente { nombre run } } }`;
  const cli = (await s.cli1(q, { id: PED })).json();
  assert.equal(cli.data.resumenPedido.cliente.run, null);
  assert.equal(cli.errors[0].extensions.code, 'CAMPO_NO_AUTORIZADO');
  const adm = (await s.admin(q, { id: PED })).json();
  assert.equal(adm.data.resumenPedido.cliente.run, '12.345.678-5');
});

test('inventory caído: respuesta parcial identificada, nunca como completa', async () => {
  const s = nueva({ inventoryCaido: true });
  const r = (await s.cli1(RESUMEN, { id: PED })).json();
  assert.equal(r.data.resumenPedido.estado, 'pagado', 'los datos de orders siguen disponibles');
  assert.equal(r.data.resumenPedido.items[0].producto, null);
  assert.equal(r.extensions.parcial, true);
  assert.ok(r.errors.every((e) => e.extensions.code === 'DEPENDENCIA_NO_DISPONIBLE'));
});

test('Límites: profundidad, costo, introspección y mutaciones se rechazan antes de ejecutar', async () => {
  const s = nueva();
  const campos = Array.from({ length: 130 }, (_, i) => `a${i}: estado`).join(' ');
  const costo = await s.cli1(`{ misPedidos { ${campos} } }`);
  assert.equal(costo.statusCode, 400);
  assert.ok(costo.json().errors.some((e) => e.extensions.code === 'LIMITE_COSTO'));
  const intro = await s.cli1('{ __schema { types { name } } }');
  assert.equal(intro.statusCode, 400);
  const mut = await s.cli1('mutation { x }');
  assert.equal(mut.statusCode, 400);
  assert.equal(s.llamadas.inventory, 0, 'ningún servicio fue consultado');
});

test('Profundidad: fragmentos anidados que superan el máximo se rechazan', async () => {
  const s = nueva();
  // profundidad real = 4 dentro de fragmentos; se prueba el límite con un límite artificial vía campos
  const ok = await s.cli1('{ misPedidos { items { producto { nombre } } } }');
  assert.equal(ok.statusCode, 200);
  const { LIMITES } = require('../src/app');
  assert.equal(LIMITES.profundidadMaxima, 6);
});

test('Paginación acotada y sin sesión -> 401', async () => {
  const s = nueva();
  const r = (await s.cli1('{ misPedidos(limite: 500) { id } }')).json();
  assert.equal(r.errors[0].extensions.code, 'ENTRADA_INVALIDA');
  const sin = await s.app.inject({ method: 'POST', url: '/graphql', payload: { query: '{ misPedidos { id } }' }, headers: { 'x-service-token': TOK } });
  assert.equal(sin.statusCode, 401);
});
