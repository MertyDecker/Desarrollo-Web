'use strict';

/**
 * Arranque local SIN Docker: `npm run local` (en la raíz del proyecto).
 *
 * Qué hace:
 *  1. Genera los secretos que falten en ./secrets (no pisa los existentes).
 *  2. Instala las dependencias de cada servicio la primera vez.
 *  3. Levanta un MongoDB real (motor oficial, descargado por mongodb-memory-server
 *     la primera vez) con autenticación y datos PERSISTENTES en ./local-data/mongo.
 *     Cada servicio tiene su propia base y su propio usuario con permiso
 *     readWrite solo sobre esa base (igual que en docker-compose).
 *  4. Levanta los 7 procesos. Los servicios internos escuchan solo en 127.0.0.1
 *     y exigen su token de servicio; el único punto de entrada documentado es el
 *     API Gateway en http://localhost:8080.
 *
 * Detener: Ctrl+C. Los datos se conservan. Para empezar de cero: borrar ./local-data.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const SECRETOS = path.join(RAIZ, 'secrets');
const DATOS = path.join(RAIZ, 'local-data');
const LOGS = path.join(DATOS, 'logs');
const BANDEJA = path.join(DATOS, 'correos.log');
const MONGO_PUERTO = Number(process.env.LOCAL_MONGO_PORT || 27027);
const MONGO_VERSION = process.env.LOCAL_MONGO_VERSION || '7.0.14';

const [mayor] = process.versions.node.split('.').map(Number);
if (mayor < 20) {
  console.error(`Se necesita Node.js 20 o superior (tienes ${process.versions.node}). Descarga la versión LTS en https://nodejs.org`);
  process.exit(1);
}

const sec = (archivo) => path.join(SECRETOS, archivo);
const HOST = '127.0.0.1';
const url = (puerto) => `http://${HOST}:${puerto}`;

// Servicios en orden de arranque, con las variables que cada uno necesita.
// Las variables *_FILE apuntan al ARCHIVO del secreto, nunca contienen el valor.
const SERVICIOS = [
  {
    nombre: 'auth', puerto: 3003, db: 'auth_db',
    env: {
      ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@fukusuke.cl',
      ADMIN_PASSWORD_FILE: sec('admin_password.txt'),
      JWT_PRIVATE_KEY_FILE: sec('jwt_private.pem'),
      SVC_TOKEN_GATEWAY_FILE: sec('svc_token_gateway_auth.txt'),
      SVC_TOKEN_CLIENTS_FILE: sec('svc_token_clients_auth.txt')
    }
  },
  {
    nombre: 'inventory', puerto: 3001, db: 'inventory_db',
    env: {
      SEED_ON_START: 'true',
      SVC_TOKEN_GATEWAY_FILE: sec('svc_token_gateway_inventory.txt'),
      SVC_TOKEN_ORDERS_FILE: sec('svc_token_orders_inventory.txt'),
      SVC_TOKEN_GRAPHQL_FILE: sec('svc_token_graphql_inventory.txt')
    }
  },
  {
    nombre: 'clients', puerto: 3002, db: 'clients_db',
    env: {
      AUTH_URL: url(3003),
      MAIL_ADAPTER: 'dev',
      MAIL_OUTBOX_FILE: BANDEJA,
      SVC_TOKEN_GATEWAY_FILE: sec('svc_token_gateway_clients.txt'),
      SVC_TOKEN_CLIENTS_AUTH_FILE: sec('svc_token_clients_auth.txt'),
      SVC_TOKEN_ORDERS_FILE: sec('svc_token_orders_clients.txt'),
      SVC_TOKEN_GRAPHQL_FILE: sec('svc_token_graphql_clients.txt')
    }
  },
  {
    nombre: 'orders', puerto: 3004, db: 'orders_db',
    env: {
      INVENTORY_URL: url(3001),
      CLIENTS_URL: url(3002),
      SVC_TOKEN_GATEWAY_FILE: sec('svc_token_gateway_orders.txt'),
      SVC_TOKEN_PAYMENTS_FILE: sec('svc_token_payments_orders.txt'),
      SVC_TOKEN_GRAPHQL_FILE: sec('svc_token_graphql_orders.txt'),
      SVC_TOKEN_ORDERS_INVENTORY_FILE: sec('svc_token_orders_inventory.txt'),
      SVC_TOKEN_ORDERS_CLIENTS_FILE: sec('svc_token_orders_clients.txt')
    }
  },
  {
    nombre: 'payments', puerto: 3005, db: 'payments_db',
    env: {
      ORDERS_URL: url(3004),
      PAYMENTS_WEBHOOK_SECRET_FILE: sec('payments_webhook_secret.txt'),
      SVC_TOKEN_GATEWAY_FILE: sec('svc_token_gateway_payments.txt'),
      SVC_TOKEN_PAYMENTS_ORDERS_FILE: sec('svc_token_payments_orders.txt')
    }
  },
  {
    nombre: 'graphql-gateway', puerto: 3006,
    env: {
      ORDERS_URL: url(3004),
      INVENTORY_URL: url(3001),
      CLIENTS_URL: url(3002),
      SVC_TOKEN_GATEWAY_FILE: sec('svc_token_gateway_graphql.txt'),
      SVC_TOKEN_GRAPHQL_ORDERS_FILE: sec('svc_token_graphql_orders.txt'),
      SVC_TOKEN_GRAPHQL_INVENTORY_FILE: sec('svc_token_graphql_inventory.txt'),
      SVC_TOKEN_GRAPHQL_CLIENTS_FILE: sec('svc_token_graphql_clients.txt')
    }
  },
  {
    nombre: 'api-gateway', puerto: Number(process.env.GATEWAY_PORT || 8080),
    env: {
      INVENTORY_URL: url(3001),
      CLIENTS_URL: url(3002),
      AUTH_URL: url(3003),
      ORDERS_URL: url(3004),
      PAYMENTS_URL: url(3005),
      GRAPHQL_URL: url(3006),
      CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5500',
      JWT_PUBLIC_KEY_FILE: sec('jwt_public.pem'),
      SVC_TOKEN_INVENTORY_FILE: sec('svc_token_gateway_inventory.txt'),
      SVC_TOKEN_CLIENTS_FILE: sec('svc_token_gateway_clients.txt'),
      SVC_TOKEN_AUTH_FILE: sec('svc_token_gateway_auth.txt'),
      SVC_TOKEN_ORDERS_FILE: sec('svc_token_gateway_orders.txt'),
      SVC_TOKEN_PAYMENTS_FILE: sec('svc_token_gateway_payments.txt'),
      SVC_TOKEN_GRAPHQL_FILE: sec('svc_token_gateway_graphql.txt')
    }
  }
];

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function paso(msg) {
  console.log(`\n> ${msg}`);
}

function instalarDependencias() {
  const carpetas = [RAIZ, ...SERVICIOS.map((s) => path.join(RAIZ, 'services', s.nombre))];
  for (const dir of carpetas) {
    if (fs.existsSync(path.join(dir, 'node_modules'))) continue;
    console.log(`  instalando dependencias en ${path.relative(RAIZ, dir) || '(raíz)'} ...`);
    const r = spawnSync(npm, ['ci', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) {
      console.error(`Falló "npm ci" en ${dir}. Revisa tu conexión a Internet y vuelve a intentar.`);
      process.exit(1);
    }
  }
}

// Contraseña local de la base de cada servicio (se crea una vez en ./secrets).
function claveMongo(nombre) {
  const archivo = sec(`mongo_local_${nombre}.txt`);
  if (!fs.existsSync(archivo)) fs.writeFileSync(archivo, crypto.randomBytes(18).toString('base64url'), { mode: 0o600 });
  return fs.readFileSync(archivo, 'utf8').trim();
}

async function iniciarMongo() {
  const { MongoMemoryServer } = require('mongodb-memory-server-core');
  const { MongoClient } = require(require.resolve('mongodb', { paths: [path.dirname(require.resolve('mongodb-memory-server-core'))] }));
  const dbPath = path.join(DATOS, 'mongo');
  fs.mkdirSync(dbPath, { recursive: true });
  const raiz = claveMongo('root');

  console.log(`  MongoDB ${MONGO_VERSION} en ${HOST}:${MONGO_PUERTO} (datos en local-data/mongo).`);
  console.log('  La primera vez descarga el motor (~70 MB); puede tardar unos minutos.');
  const servidor = await MongoMemoryServer.create({
    instance: { dbPath, storageEngine: 'wiredTiger', port: MONGO_PUERTO, ip: HOST },
    binary: { version: MONGO_VERSION },
    auth: { enable: true, customRootName: 'root_local', customRootPwd: raiz }
  });

  // Usuario por servicio con permisos solo sobre su propia base (mínimo privilegio).
  const cliente = await MongoClient.connect(`mongodb://root_local:${encodeURIComponent(raiz)}@${HOST}:${MONGO_PUERTO}/admin`);
  for (const s of SERVICIOS.filter((x) => x.db)) {
    const usuario = `app_${s.nombre}`;
    const clave = claveMongo(s.nombre);
    const db = cliente.db(s.db);
    const { users } = await db.command({ usersInfo: usuario });
    if (users.length === 0) {
      await db.command({ createUser: usuario, pwd: clave, roles: [{ role: 'readWrite', db: s.db }] });
    } else {
      await db.command({ updateUser: usuario, pwd: clave });
    }
    s.env.MONGO_URL = `mongodb://${usuario}:${encodeURIComponent(clave)}@${HOST}:${MONGO_PUERTO}/${s.db}?authSource=${s.db}`;
  }
  await cliente.close();
  return servidor;
}

async function esperarSalud(s, proceso) {
  const limite = Date.now() + 30000;
  while (Date.now() < limite) {
    if (proceso.exitCode !== null) return false;
    try {
      const r = await fetch(`${url(s.puerto)}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch {
      // aún no responde
    }
    await new Promise((ok) => setTimeout(ok, 300));
  }
  return false;
}

async function main() {
  console.log('Fukusuke Sushi - arranque local (sin Docker)');

  paso('1/4 Secretos');
  const g = spawnSync(process.execPath, [path.join(__dirname, 'generar-secretos.js')], { cwd: RAIZ, stdio: 'inherit' });
  if (g.status !== 0) process.exit(1);

  paso('2/4 Dependencias');
  instalarDependencias();
  console.log('  listas.');

  paso('3/4 Base de datos');
  fs.mkdirSync(LOGS, { recursive: true });
  const mongo = await iniciarMongo();

  paso('4/4 Servicios');
  const procesos = [];
  let cerrando = false;
  const cerrar = async (codigo = 0) => {
    if (cerrando) return;
    cerrando = true;
    console.log('\nDeteniendo servicios...');
    for (const p of procesos) p.kill('SIGTERM');
    await new Promise((ok) => setTimeout(ok, 800));
    await mongo.stop({ doCleanup: false }); // conserva los datos
    console.log('Listo. Los datos quedaron en local-data/.');
    process.exit(codigo);
  };
  process.on('SIGINT', () => cerrar(0));
  process.on('SIGTERM', () => cerrar(0));

  for (const s of SERVICIOS) {
    const log = fs.createWriteStream(path.join(LOGS, `${s.nombre}.log`), { flags: 'a' });
    const p = spawn(process.execPath, ['src/server.js'], {
      cwd: path.join(RAIZ, 'services', s.nombre),
      env: { ...process.env, ...s.env, PORT: String(s.puerto), HOST, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    procesos.push(p);
    const salida = (chunk) => {
      log.write(chunk);
      // En la consola solo se muestran el correo simulado y los errores.
      for (const linea of chunk.toString().split('\n')) {
        if (linea.includes('[CORREO-SIMULADO]')) console.log(`  [correo] ${linea.slice(linea.indexOf('[CORREO-SIMULADO]'))}`);
        else if (/"level":50|No se pudo iniciar|Error/.test(linea)) console.log(`  [${s.nombre}] ${linea.slice(0, 300)}`);
      }
    };
    p.stdout.on('data', salida);
    p.stderr.on('data', salida);
    p.on('exit', (code) => {
      if (!cerrando) {
        console.error(`\n  El servicio ${s.nombre} se detuvo (código ${code}). Revisa local-data/logs/${s.nombre}.log`);
        cerrar(1);
      }
    });
    const ok = await esperarSalud(s, p);
    if (!ok) {
      console.error(`  ${s.nombre} no respondió. Revisa local-data/logs/${s.nombre}.log`);
      return cerrar(1);
    }
    console.log(`  ok  ${s.nombre.padEnd(16)} ${url(s.puerto)}${s.nombre === 'api-gateway' ? '   <- punto de entrada' : '   (interno)'}`);
  }

  // PIDs para que la prueba de carga pueda medir CPU y memoria de cada proceso.
  fs.writeFileSync(path.join(DATOS, 'pids.json'), JSON.stringify(Object.fromEntries(SERVICIOS.map((s, i) => [s.nombre, procesos[i].pid])), null, 2));

  const gw = SERVICIOS.at(-1);
  console.log(`
==========================================================
 Backend listo:  http://localhost:${gw.puerto}
   Salud:        http://localhost:${gw.puerto}/health
   Catálogo:     http://localhost:${gw.puerto}/api/v1/products?available=true
 Administrador:  ${SERVICIOS[0].env.ADMIN_EMAIL}  (clave en secrets/admin_password.txt)
 Correos simulados: local-data/correos.log
 Logs:              local-data/logs/
 Pruebas de seguridad (otra terminal):  npm run seguridad
 Detener: Ctrl+C
==========================================================`);
}

main().catch((err) => {
  console.error('\nNo se pudo arrancar:', err.message);
  process.exit(1);
});
