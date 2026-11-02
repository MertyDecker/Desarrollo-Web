'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/app');
const { crearRepoMemoria } = require('./helpers/memoryRepo');

const SEMILLA = [
  { nombre: 'Dragon Roll', precio: 8990, stock: 30, categoria: 'rolls' },
  { nombre: 'Salmon Nigiri', precio: 6490, stock: 0, categoria: 'nigiri' },
  { nombre: 'California Roll', precio: 5990, stock: 50, categoria: 'rolls' }
];

function nuevaApp() {
  return buildApp({ repo: crearRepoMemoria(SEMILLA) });
}

const PRODUCTO_VALIDO = {
  nombre: 'Gyozas',
  descripcion: 'Empanaditas japonesas',
  precio: 4500,
  stock: 10,
  categoria: 'entradas'
};

test('GET /health responde ok', async () => {
  const app = nuevaApp();
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok', service: 'inventory' });
});

test('S01: el catálogo solo devuelve campos públicos (sin stock ni estado interno)', async () => {
  const app = nuevaApp();
  const res = await app.inject({ method: 'GET', url: '/products' });
  assert.equal(res.statusCode, 200);
  const lista = res.json();
  assert.equal(lista.length, 3);
  for (const p of lista) {
    assert.deepEqual(
      Object.keys(p).sort(),
      ['categoria', 'descripcion', 'disponible', 'id', 'imagen', 'nombre', 'precio']
    );
  }
});

test('S01: available=true devuelve solo productos con stock', async () => {
  const app = nuevaApp();
  const res = await app.inject({ method: 'GET', url: '/products?available=true' });
  assert.equal(res.statusCode, 200);
  const nombres = res.json().map((p) => p.nombre).sort();
  assert.deepEqual(nombres, ['California Roll', 'Dragon Roll']);
  assert.ok(res.json().every((p) => p.disponible === true));
});

test('S01: filtra por categoría', async () => {
  const app = nuevaApp();
  const res = await app.inject({ method: 'GET', url: '/products?category=nigiri' });
  assert.equal(res.json().length, 1);
  assert.equal(res.json()[0].disponible, false); // stock 0
});

test('S01: filtros inválidos responden 400', async () => {
  const app = nuevaApp();
  const a = await app.inject({ method: 'GET', url: '/products?available=quizas' });
  const b = await app.inject({ method: 'GET', url: '/products?category=pizza' });
  assert.equal(a.statusCode, 400);
  assert.equal(b.statusCode, 400);
});

test('S01: sin resultados devuelve lista vacía', async () => {
  const app = buildApp({ repo: crearRepoMemoria([]) });
  const res = await app.inject({ method: 'GET', url: '/products' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), []);
});

test('S02: producto inexistente responde 404 y id mal formado responde 400', async () => {
  const app = nuevaApp();
  const noExiste = await app.inject({ method: 'GET', url: '/products/' + 'a'.repeat(24) });
  const malId = await app.inject({ method: 'GET', url: '/products/abc' });
  assert.equal(noExiste.statusCode, 404);
  assert.equal(malId.statusCode, 400);
});

test('S03: crear producto válido responde 201 e incluye stock (vista de administración)', async () => {
  const app = nuevaApp();
  const res = await app.inject({ method: 'POST', url: '/products', payload: PRODUCTO_VALIDO });
  assert.equal(res.statusCode, 201);
  const p = res.json();
  assert.equal(p.nombre, 'Gyozas');
  assert.equal(p.stock, 10);
  assert.equal(p.disponible, true);
});

test('S03: datos inválidos responden 400 (precio negativo, campo faltante, campo extra)', async () => {
  const app = nuevaApp();
  const casos = [
    { ...PRODUCTO_VALIDO, precio: -5 },
    { ...PRODUCTO_VALIDO, precio: 99.5 },
    { nombre: 'Sin precio', stock: 1, categoria: 'rolls' },
    { ...PRODUCTO_VALIDO, categoria: 'pizza' },
    { ...PRODUCTO_VALIDO, rol: 'admin' }
  ];
  for (const payload of casos) {
    const res = await app.inject({ method: 'POST', url: '/products', payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
});

test('S04: modificar reemplaza el producto; 404 si no existe', async () => {
  const app = nuevaApp();
  const creado = (await app.inject({ method: 'POST', url: '/products', payload: PRODUCTO_VALIDO })).json();
  const ok = await app.inject({
    method: 'PUT',
    url: `/products/${creado.id}`,
    payload: { ...PRODUCTO_VALIDO, precio: 4900, stock: 0 }
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().precio, 4900);
  assert.equal(ok.json().disponible, false);

  const no = await app.inject({
    method: 'PUT',
    url: '/products/' + 'b'.repeat(24),
    payload: PRODUCTO_VALIDO
  });
  assert.equal(no.statusCode, 404);
});

test('S05: dar de baja oculta el producto del catálogo pero conserva el registro', async () => {
  const repo = crearRepoMemoria(SEMILLA);
  const app = buildApp({ repo });
  const lista = (await app.inject({ method: 'GET', url: '/products' })).json();
  const id = lista[0].id;

  const del = await app.inject({ method: 'DELETE', url: `/products/${id}` });
  assert.equal(del.statusCode, 204);

  const get = await app.inject({ method: 'GET', url: `/products/${id}` });
  assert.equal(get.statusCode, 404);
  const despues = (await app.inject({ method: 'GET', url: '/products' })).json();
  assert.equal(despues.length, lista.length - 1);
  assert.ok(repo._items.has(id), 'el registro sigue existiendo (historial)');

  const otraVez = await app.inject({ method: 'DELETE', url: '/products/' + 'c'.repeat(24) });
  assert.equal(otraVez.statusCode, 404);
});

test('Correlación: se respeta x-request-id y se devuelve en la respuesta', async () => {
  const app = nuevaApp();
  const res = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { 'x-request-id': 'req-prueba-123' }
  });
  assert.equal(res.headers['x-request-id'], 'req-prueba-123');
});

test('Errores inesperados responden 500 sin filtrar detalles internos', async () => {
  const repoRoto = {
    list: async () => {
      throw new Error('mongodb://usuario:clave@host fallo interno');
    }
  };
  const app = buildApp({ repo: repoRoto });
  const res = await app.inject({ method: 'GET', url: '/products' });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), { error: 'Error interno' });
  assert.ok(!res.body.includes('mongodb://'));
});
