'use strict';

/**
 * Prueba de carga reproducible (Módulo 9).
 *
 *   1) Arrancar el backend con los límites por IP relajados SOLO para medir:
 *        PowerShell:  $env:PRUEBA_CARGA="true"; npm run local
 *        bash:        PRUEBA_CARGA=true npm run local
 *   2) En otra terminal:  npm run carga
 *
 * Mide latencia (p50/p95/p99), throughput, errores y CPU/memoria de cada
 * proceso en cuatro escenarios y los compara con los objetivos declarados.
 * Deja el reporte en docs/evidencias/prueba-carga.md (y .json).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const BASE = process.env.GATEWAY_URL || 'http://localhost:8080';
const API = `${BASE}/api/v1`;
const RAIZ = path.join(__dirname, '..');
const ESCALA = Number(process.env.CARGA_ESCALA || 1); // multiplica la duración
const sufijo = Date.now().toString().slice(-6);

// Demanda proyectada (no medida en producción): un local de sushi delivery con
// un pico de viernes de ~50 personas navegando a la vez y ~60 pedidos por hora.
const OBJETIVOS = {
  catalogo: { p95: 300, rps: 50 },
  pedidoRest: { p95: 500, rps: 20 },
  resumenGraphql: { p95: 800, rps: 10 },
  crearPedido: { p95: 1000, rps: 2 }
};

async function json(metodo, ruta, { token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body) h['content-type'] = 'application/json';
  const r = await fetch(`${API}${ruta}`, { method: metodo, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : null };
}

function run(n) {
  let s = 0;
  let m = 2;
  for (const d of String(n).split('').reverse()) {
    s += Number(d) * m;
    m = m === 7 ? 2 : m + 1;
  }
  const r = 11 - (s % 11);
  return `${n}-${r === 11 ? '0' : r === 10 ? 'K' : r}`;
}

async function preparar() {
  const correo = `carga.${sufijo}@correo-prueba.cl`;
  const password = `Carga${sufijo}x`;
  const reg = await json('POST', '/clients', {
    body: { run: run(Number(`2${sufijo}7`)), nombre: 'Carga Prueba', direccion: 'Av. Providencia 2000', comuna: 'Providencia', region: 'Metropolitana', correo, telefono: '+56922222222', password }
  });
  if (reg.status !== 201) throw new Error(`No se pudo registrar el cliente de carga (${reg.status}). ¿Arrancaste con PRUEBA_CARGA=true?`);
  await new Promise((ok) => setTimeout(ok, 200));
  const bandeja = fs.readFileSync(path.join(RAIZ, 'local-data', 'correos.log'), 'utf8').trim().split('\n').reverse();
  const codigo = bandeja.find((l) => l.split(' ')[1] === correo).split(' ')[2];
  await json('POST', '/clients/verify-email', { body: { correo, codigo } });
  const token = (await json('POST', '/auth/login', { body: { correo, password } })).json.token;
  const direccionId = (await json('GET', '/clients/me/addresses', { token })).json[0].id;

  const admPass = fs.readFileSync(path.join(RAIZ, 'secrets', 'admin_password.txt'), 'utf8').trim();
  const adm = (await json('POST', '/auth/login', { body: { correo: 'admin@fukusuke.cl', password: admPass } })).json.token;
  const prod = await json('POST', '/products', { token: adm, body: { nombre: `Producto carga ${sufijo}`, precio: 1000, stock: 100000, categoria: 'promociones' } });
  const productoId = prod.json.id;
  const pedido = await json('POST', '/orders', { token, body: { items: [{ productoId, cantidad: 1 }], direccionId }, headers: { 'idempotency-key': `carga-${sufijo}-base` } });
  return { token, direccionId, productoId, pedidoId: pedido.json.id };
}

function percentil(ordenados, p) {
  if (!ordenados.length) return 0;
  return ordenados[Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)];
}

async function muestrearRecursos(pids, detener) {
  let pidusage;
  try {
    pidusage = require('pidusage');
  } catch {
    return null;
  }
  const datos = Object.fromEntries(Object.keys(pids).map((n) => [n, { cpu: [], memMB: [] }]));
  while (!detener.listo) {
    try {
      const stats = await pidusage(Object.values(pids));
      for (const [nombre, pid] of Object.entries(pids)) {
        const s = stats[pid];
        if (s) {
          datos[nombre].cpu.push(s.cpu);
          datos[nombre].memMB.push(s.memory / 1024 / 1024);
        }
      }
    } catch {
      // un proceso puede no estar disponible por un instante
    }
    await new Promise((ok) => setTimeout(ok, 500));
  }
  return datos;
}

async function escenario(nombre, { concurrencia, segundos, solicitud }, pids) {
  const latencias = [];
  const codigos = {};
  let errores = 0;
  const fin = performance.now() + segundos * 1000 * ESCALA;
  const detener = { listo: false };
  const recursos = muestrearRecursos(pids, detener);
  const inicio = performance.now();
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrencia }, async () => {
      while (performance.now() < fin) {
        const n = i++;
        const t0 = performance.now();
        try {
          const r = await solicitud(n);
          await r.arrayBuffer();
          codigos[r.status] = (codigos[r.status] || 0) + 1;
          if (r.status >= 400) errores += 1;
        } catch {
          errores += 1;
          codigos.red = (codigos.red || 0) + 1;
        }
        latencias.push(performance.now() - t0);
      }
    })
  );
  const duracion = (performance.now() - inicio) / 1000;
  detener.listo = true;
  const rec = await recursos;
  latencias.sort((a, b) => a - b);
  const resumenRec = rec
    ? Object.fromEntries(
        Object.entries(rec)
          .filter(([, v]) => v.cpu.length)
          .map(([n, v]) => [n, { cpuProm: +(v.cpu.reduce((a, b) => a + b, 0) / v.cpu.length).toFixed(1), cpuMax: +Math.max(...v.cpu).toFixed(1), memMaxMB: +Math.max(...v.memMB).toFixed(1) }])
      )
    : null;
  const r = {
    nombre,
    concurrencia,
    duracionSeg: +duracion.toFixed(1),
    solicitudes: latencias.length,
    rps: +(latencias.length / duracion).toFixed(1),
    p50: +percentil(latencias, 50).toFixed(1),
    p95: +percentil(latencias, 95).toFixed(1),
    p99: +percentil(latencias, 99).toFixed(1),
    maxMs: +latencias.at(-1).toFixed(1),
    errores,
    tasaError: +((errores / latencias.length) * 100).toFixed(2),
    codigos,
    recursos: resumenRec
  };
  const obj = OBJETIVOS[nombre];
  r.objetivo = obj;
  r.cumple = r.p95 <= obj.p95 && r.rps >= obj.rps && r.tasaError < 1;
  console.log(`${r.cumple ? 'CUMPLE   ' : 'NO CUMPLE'} ${nombre.padEnd(15)} c=${concurrencia} ${r.solicitudes} solicitudes  ${r.rps} req/s  p95 ${r.p95} ms  errores ${r.tasaError}%`);
  return r;
}

async function main() {
  console.log(`Prueba de carga contra ${BASE}\n`);
  const ctx = await preparar();
  const pidsArchivo = path.join(RAIZ, 'local-data', 'pids.json');
  const pids = fs.existsSync(pidsArchivo) ? JSON.parse(fs.readFileSync(pidsArchivo, 'utf8')) : {};
  const auth = { authorization: `Bearer ${ctx.token}` };
  const Q = 'query($id: ID!) { resumenPedido(id: $id) { id estado total items { cantidad producto { nombre disponible } } cliente { nombre } } }';

  const resultados = [];
  resultados.push(await escenario('catalogo', { concurrencia: 20, segundos: 20, solicitud: () => fetch(`${API}/products?available=true`) }, pids));
  resultados.push(await escenario('pedidoRest', { concurrencia: 10, segundos: 15, solicitud: () => fetch(`${API}/orders/${ctx.pedidoId}`, { headers: auth }) }, pids));
  resultados.push(
    await escenario('resumenGraphql', {
      concurrencia: 10,
      segundos: 15,
      solicitud: () => fetch(`${API}/graphql`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ query: Q, variables: { id: ctx.pedidoId } }) })
    }, pids)
  );
  resultados.push(
    await escenario('crearPedido', {
      concurrencia: 5,
      segundos: 10,
      solicitud: (n) =>
        fetch(`${API}/orders`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json', 'idempotency-key': `carga-${sufijo}-${n}` },
          body: JSON.stringify({ items: [{ productoId: ctx.productoId, cantidad: 1 }], direccionId: ctx.direccionId })
        })
    }, pids)
  );

  const entorno = {
    fecha: new Date().toISOString(),
    so: `${os.type()} ${os.release()} (${os.arch()})`,
    cpu: `${os.cpus().length} x ${os.cpus()[0]?.model}`,
    memoriaGB: +(os.totalmem() / 1024 ** 3).toFixed(1),
    node: process.versions.node,
    modo: fs.existsSync(pidsArchivo) ? 'arranque local (npm run local), MongoDB 7 con persistencia en disco' : 'desconocido',
    nota: 'Generador de carga y backend en el mismo equipo; la latencia incluye ese costo.'
  };
  const dir = path.join(RAIZ, 'docs', 'evidencias');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'prueba-carga.json'), JSON.stringify({ entorno, objetivos: OBJETIVOS, resultados }, null, 2));

  const filaRec = (r) =>
    r.recursos
      ? Object.entries(r.recursos)
          .filter(([, v]) => v.cpuMax > 1)
          .map(([n, v]) => `${n}: CPU prom ${v.cpuProm}% / máx ${v.cpuMax}%, mem máx ${v.memMaxMB} MB`)
          .join('<br>')
      : 'no medido';
  const md = [
    '# Reporte de prueba de carga',
    '',
    `Ejecutado: ${entorno.fecha} · comando \`npm run carga\` (backend arrancado con \`PRUEBA_CARGA=true npm run local\`).`,
    '',
    `**Entorno:** ${entorno.so}; ${entorno.cpu}; ${entorno.memoriaGB} GB RAM; Node ${entorno.node}; ${entorno.modo}. ${entorno.nota}`,
    '',
    '**Tipo de dato:** las cifras de esta tabla son **mediciones**. La demanda contra la que se comparan es una **proyección** (ver Módulo 9).',
    '',
    '| Escenario | Concurrencia | Duración (s) | Solicitudes | Throughput (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | Errores | Objetivo | ¿Cumple? |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...resultados.map((r) => `| ${r.nombre} | ${r.concurrencia} | ${r.duracionSeg} | ${r.solicitudes} | ${r.rps} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.tasaError}% | p95 ≤ ${r.objetivo.p95} ms, ≥ ${r.objetivo.rps} req/s, < 1% errores | ${r.cumple ? '✅' : '❌'} |`),
    '',
    '## CPU y memoria por proceso (procesos con CPU > 1%)',
    '',
    '| Escenario | Consumo |',
    '|---|---|',
    ...resultados.map((r) => `| ${r.nombre} | ${filaRec(r)} |`),
    '',
    '## Códigos HTTP',
    '',
    ...resultados.map((r) => `- **${r.nombre}:** ${Object.entries(r.codigos).map(([c, n]) => `${c} × ${n}`).join(', ')}`),
    ''
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'prueba-carga.md'), md);
  console.log('\nReporte guardado en docs/evidencias/prueba-carga.md');
}

main().catch((err) => {
  console.error('Error en la prueba de carga:', err.message);
  process.exit(1);
});
