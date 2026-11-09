'use strict';

/**
 * Pruebas de integración y seguridad contra el backend EN EJECUCIÓN.
 *
 *   1) En una terminal:  npm run local      (o docker compose up --build)
 *   2) En otra:          npm run seguridad
 *
 * Recorre los flujos principales como lo haría el frontend (visitante, cliente
 * A, cliente B y administrador) e intenta romper el backend: tokens falsos,
 * roles cambiados, cabeceras forjadas, inyección, pedidos ajenos, precios y
 * pagos alterados, reintentos, límites GraphQL, acceso directo a servicios...
 *
 * Deja la evidencia en docs/evidencias/resultado-pruebas.md (y .json), con el
 * x-request-id de cada solicitud para rastrearla en los logs.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BASE = process.env.GATEWAY_URL || 'http://localhost:8080';
const RAIZ = path.join(__dirname, '..');
const BANDEJA = process.env.MAIL_OUTBOX_FILE || path.join(RAIZ, 'local-data', 'correos.log');
const API = `${BASE}/api/v1`;

const resultados = [];
const sufijo = Date.now().toString().slice(-6);

async function pedir(metodo, ruta, { token, body, headers = {}, crudo } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let cuerpo;
  if (crudo !== undefined) {
    cuerpo = crudo;
    h['content-type'] = 'application/json';
  } else if (body !== undefined) {
    cuerpo = JSON.stringify(body);
    h['content-type'] = 'application/json';
  }
  const url = ruta.startsWith('http') ? ruta : `${API}${ruta}`;
  const res = await fetch(url, { method: metodo, headers: h, body: cuerpo });
  const texto = await res.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  return { status: res.status, json, headers: res.headers, rid: res.headers.get('x-request-id'), metodo, ruta: url.replace(BASE, '') };
}

function registrar(id, modulo, descripcion, esperado, r, ok, nota = '') {
  resultados.push({ id, modulo, descripcion, esperado, obtenido: r ? r.status : '-', solicitud: r ? `${r.metodo} ${r.ruta}` : '-', requestId: r?.rid || '-', ok: !!ok, nota });
  const marca = ok ? '\x1b[32mOK  \x1b[0m' : '\x1b[31mFALLA\x1b[0m';
  console.log(`${marca} ${id.padEnd(5)} ${descripcion}  [${r ? r.status : '-'}]${nota ? `  ${nota}` : ''}`);
}

function codigoDesdeBandeja(correo) {
  if (!fs.existsSync(BANDEJA)) return null;
  const lineas = fs.readFileSync(BANDEJA, 'utf8').trim().split('\n').reverse();
  const l = lineas.find((x) => x.split(' ')[1] === correo);
  return l ? l.split(' ')[2] : null;
}

// RUN válido (módulo 11) a partir de un número.
function run(numero) {
  let s = 0;
  let m = 2;
  for (const d of String(numero).split('').reverse()) {
    s += Number(d) * m;
    m = m === 7 ? 2 : m + 1;
  }
  const r = 11 - (s % 11);
  const dv = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  return `${numero}-${dv}`;
}

async function crearCliente(etiqueta, comuna) {
  const correo = `${etiqueta}.${sufijo}@correo-prueba.cl`;
  const password = `Clave${sufijo}x`;
  const datos = {
    run: run(Number(`1${sufijo}${etiqueta === 'cliente.a' ? 1 : 2}`)),
    nombre: etiqueta === 'cliente.a' ? 'Ana Prueba' : 'Bruno Prueba',
    direccion: etiqueta === 'cliente.a' ? 'Av. Providencia 1234' : 'Av. Pajaritos 4500',
    comuna,
    region: 'Metropolitana',
    correo,
    telefono: '+56912345678',
    password
  };
  const reg = await pedir('POST', '/clients', { body: datos });
  await new Promise((ok) => setTimeout(ok, 150));
  const codigo = codigoDesdeBandeja(correo);
  const ver = await pedir('POST', '/clients/verify-email', { body: { correo, codigo } });
  const login = await pedir('POST', '/auth/login', { body: { correo, password } });
  const token = login.json?.token;
  const dirs = await pedir('GET', '/clients/me/addresses', { token });
  return { datos, correo, password, token, reg, ver, login, direccionId: dirs.json?.[0]?.id };
}

const b64u = (v) => Buffer.from(v).toString('base64url');

function firmarAviso(evento) {
  const secreto = fs.readFileSync(path.join(RAIZ, 'secrets', 'payments_webhook_secret.txt'), 'utf8').trim();
  const ts = Math.floor(Date.now() / 1000);
  const firma = crypto.createHmac('sha256', secreto).update(`${ts}.${JSON.stringify(evento)}`).digest('hex');
  return { 'x-signature': firma, 'x-timestamp': String(ts) };
}

async function main() {
  console.log(`Pruebas contra ${BASE}\n`);
  const salud = await pedir('GET', `${BASE}/health`).catch(() => null);
  if (!salud || salud.status !== 200) {
    console.error('El backend no responde. Arráncalo primero con "npm run local" (o docker compose up --build).');
    process.exit(1);
  }

  // ---------------------------------------------------------------- catálogo
  const cat = await pedir('GET', '/products?available=true');
  registrar('P01', 'M1/M7', 'Visitante anónimo consulta el catálogo', 200, cat,
    cat.status === 200 && Array.isArray(cat.json) && cat.json.length > 0 && cat.json.every((p) => p.stock === undefined),
    'sin stock exacto en la respuesta');
  const iny = await pedir('GET', '/products?available[$ne]=x');
  registrar('P02', 'M7', 'Inyección NoSQL en filtros del catálogo', 400, iny, iny.status === 400);

  // ---------------------------------------------------------------- registro y login
  const A = await crearCliente('cliente.a', 'Providencia');
  if (A.reg.status === 429) {
    console.error('El gateway limita los registros a 5 por minuto por IP (protección activa). Espera 1 minuto y vuelve a ejecutar.');
    process.exit(1);
  }
  const B = await crearCliente('cliente.b', 'Maipú');
  registrar('P03', 'M1', 'Registro de cliente (RUN válido, contraseña con hash)', 201, A.reg, A.reg.status === 201 && A.reg.json?.estado === 'pendiente_validacion');
  registrar('P04', 'M1', 'Validación de correo con código', 200, A.ver, A.ver.status === 200);
  registrar('P05', 'M4', 'Inicio de sesión del cliente (token ES256 con expiración)', 200, A.login, A.login.status === 200 && !!A.token);
  const dup = await pedir('POST', '/clients', { body: { ...A.datos, correo: `otro.${sufijo}@correo-prueba.cl` } });
  registrar('P06', 'M1', 'Registro con RUN ya existente', 409, dup, dup.status === 409);
  const runMalo = await pedir('POST', '/clients', { body: { ...A.datos, run: '12.345.678-9', correo: `x.${sufijo}@correo-prueba.cl` } });
  registrar('P07', 'M1', 'Registro con RUN inválido', 400, runMalo, runMalo.status === 400);

  const malaClave = await pedir('POST', '/auth/login', { body: { correo: A.correo, password: 'NoEsLaClave1' } });
  const sinCuenta = await pedir('POST', '/auth/login', { body: { correo: `nadie.${sufijo}@correo-prueba.cl`, password: 'NoEsLaClave1' } });
  registrar('P08', 'M7', 'Login con clave incorrecta: mismo mensaje que cuenta inexistente', 401, malaClave,
    malaClave.status === 401 && sinCuenta.status === 401 && malaClave.json?.error === sinCuenta.json?.error);
  const loginIny = await pedir('POST', '/auth/login', { body: { correo: { $gt: '' }, password: { $gt: '' } } });
  registrar('P09', 'M7', 'Inyección NoSQL en el login', 400, loginIny, loginIny.status === 400);

  const admPass = fs.readFileSync(path.join(RAIZ, 'secrets', 'admin_password.txt'), 'utf8').trim();
  const admLogin = await pedir('POST', '/auth/login', { body: { correo: process.env.ADMIN_EMAIL || 'admin@fukusuke.cl', password: admPass } });
  const ADM = admLogin.json?.token;
  registrar('P10', 'M4', 'Inicio de sesión del administrador', 200, admLogin, admLogin.status === 200 && !!ADM);

  // ---------------------------------------------------------------- tokens y roles
  const sinToken = await pedir('GET', '/orders');
  registrar('P11', 'M7', 'Operación protegida sin sesión', 401, sinToken, sinToken.status === 401);
  const [h, p] = A.token.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url'));
  const tokNone = `${b64u(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64u(JSON.stringify({ ...payload, rol: 'admin' }))}.`;
  const rNone = await pedir('POST', '/products', { token: tokNone, body: { nombre: 'Hack', precio: 1, stock: 1, categoria: 'rolls' } });
  registrar('P12', 'M7', 'Token con alg "none" y rol admin inventado', 401, rNone, rNone.status === 401);
  const tokMod = `${h}.${b64u(JSON.stringify({ ...payload, rol: 'admin' }))}.${A.token.split('.')[2]}`;
  const rMod = await pedir('POST', '/products', { token: tokMod, body: { nombre: 'Hack', precio: 1, stock: 1, categoria: 'rolls' } });
  registrar('P13', 'M7', 'Token del cliente con el rol cambiado a admin (firma rota)', 401, rMod, rMod.status === 401);
  const otra = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  const datosFirma = `${b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT' }))}.${b64u(JSON.stringify({ ...payload, rol: 'admin' }))}`;
  const tokOtra = `${datosFirma}.${b64u(crypto.sign('sha256', Buffer.from(datosFirma), { key: otra, dsaEncoding: 'ieee-p1363' }))}`;
  const rOtra = await pedir('POST', '/products', { token: tokOtra, body: { nombre: 'Hack', precio: 1, stock: 1, categoria: 'rolls' } });
  registrar('P14', 'M7', 'Token firmado con una clave que no es la de auth', 401, rOtra, rOtra.status === 401);

  const cliAdmin = await pedir('POST', '/products', { token: A.token, body: { nombre: 'Hack', precio: 1, stock: 1, categoria: 'rolls' } });
  registrar('P15', 'M4/M7', 'Cliente intenta crear un producto (operación de administración)', 403, cliAdmin, cliAdmin.status === 403);
  const forjada = await pedir('DELETE', `/products/${cat.json[0].id}`, { token: A.token, headers: { 'x-user-role': 'admin', 'x-user-id': 'admin-1' } });
  registrar('P16', 'M5', 'Cliente envía cabeceras x-user-role/x-user-id falsas', 403, forjada, forjada.status === 403);

  // ---------------------------------------------------------------- administración
  const prod = await pedir('POST', '/products', { token: ADM, body: { nombre: `Gyozas ${sufijo}`, descripcion: '5 unidades', precio: 4500, stock: 2, categoria: 'entradas' } });
  registrar('P17', 'M1/M4', 'Administrador crea un producto (stock 2)', 201, prod, prod.status === 201);
  const extra = await pedir('POST', '/products', { token: ADM, body: { nombre: `X ${sufijo}`, precio: 100, stock: 1, categoria: 'rolls', activo: false, rol: 'admin' } });
  registrar('P18', 'M7', 'Campos no declarados en el cuerpo (asignación masiva)', 400, extra, extra.status === 400);
  const GYO = prod.json?.id;
  const DRAGON = cat.json.find((x) => x.nombre === 'Dragon Roll')?.id || cat.json[0].id;

  // ---------------------------------------------------------------- pedidos
  const clave = `pedido-${sufijo}-a`;
  const pedidoBody = { items: [{ productoId: DRAGON, cantidad: 2 }], direccionId: A.direccionId };
  const ped = await pedir('POST', '/orders', { token: A.token, body: pedidoBody, headers: { 'idempotency-key': clave } });
  const precio = cat.json.find((x) => x.id === DRAGON).precio;
  registrar('P19', 'M10', 'Cliente confirma pedido: totales calculados por el servidor', 201, ped,
    ped.status === 201 && ped.json.subtotal === precio * 2 && ped.json.envio === 0 && ped.json.empaque === 1200 && ped.json.total === precio * 2 + 1200,
    `total ${ped.json?.total}`);
  const PED = ped.json?.id;
  const rep = await pedir('POST', '/orders', { token: A.token, body: pedidoBody, headers: { 'idempotency-key': clave } });
  const lista = await pedir('GET', '/orders', { token: A.token });
  registrar('P20', 'M10', 'Reintento con la misma Idempotency-Key no duplica el pedido', 200, rep,
    rep.status === 200 && rep.json?.id === PED && rep.headers.get('idempotent-replay') === 'true' && lista.json?.length === 1);
  const trucho = await pedir('POST', '/orders', { token: A.token, body: { items: [{ productoId: DRAGON, cantidad: 2, precio: 1 }], direccionId: A.direccionId, total: 1 }, headers: { 'idempotency-key': `pedido-${sufijo}-x` } });
  registrar('P21', 'M7', 'Pedido con precio/total enviados por el navegador', 400, trucho, trucho.status === 400);
  const dirAjena = await pedir('POST', '/orders', { token: A.token, body: { items: [{ productoId: DRAGON, cantidad: 1 }], direccionId: B.direccionId }, headers: { 'idempotency-key': `pedido-${sufijo}-d` } });
  registrar('P22', 'M7', 'Pedido usando la dirección de otro cliente', 400, dirAjena, dirAjena.status === 400);

  const propio = await pedir('GET', `/orders/${PED}`, { token: A.token });
  registrar('P23', 'M10', 'Cliente A consulta su propio pedido', 200, propio, propio.status === 200 && propio.json?.id === PED);
  const ajeno = await pedir('GET', `/orders/${PED}`, { token: B.token });
  registrar('P24', 'M7/M10', 'Cliente B consulta el pedido de A (recurso ajeno)', 404, ajeno, ajeno.status === 404 && !ajeno.json?.items, 'sin datos del pedido');

  // ---------------------------------------------------------------- stock
  const pedG = await pedir('POST', '/orders', { token: B.token, body: { items: [{ productoId: GYO, cantidad: 2 }], direccionId: B.direccionId }, headers: { 'idempotency-key': `pedido-${sufijo}-g` } });
  const tras = await pedir('GET', `/products/${GYO}`);
  registrar('P25', 'M10', 'Pedido reserva el stock (producto queda no disponible)', 201, pedG,
    pedG.status === 201 && tras.json?.disponible === false && pedG.json?.envio === 2990, 'envío cobrado fuera del radio');
  const sinStock = await pedir('POST', '/orders', { token: A.token, body: { items: [{ productoId: GYO, cantidad: 1 }], direccionId: A.direccionId }, headers: { 'idempotency-key': `pedido-${sufijo}-s` } });
  registrar('P26', 'M10', 'Pedido sin stock suficiente', 409, sinStock, sinStock.status === 409);
  const cancel = await pedir('POST', `/orders/${pedG.json?.id}/cancel`, { token: B.token });
  const recupera = await pedir('GET', `/products/${GYO}`);
  registrar('P27', 'M10', 'Cancelar el pedido recupera el stock', 200, cancel, cancel.status === 200 && recupera.json?.disponible === true);

  // ---------------------------------------------------------------- pagos
  const pagoTrampa = await pedir('POST', `/orders/${PED}/payments`, { token: A.token, body: { medio: 'webpay', monto: 1, estado: 'aprobado' } });
  registrar('P28', 'M7', 'Pago con monto/estado enviados por el navegador', 400, pagoTrampa, pagoTrampa.status === 400);
  const pagoAjeno = await pedir('POST', `/orders/${PED}/payments`, { token: B.token, body: { medio: 'webpay' } });
  registrar('P29', 'M7', 'Cliente B intenta pagar el pedido de A', 404, pagoAjeno, pagoAjeno.status === 404);
  const pago = await pedir('POST', `/orders/${PED}/payments`, { token: A.token, body: { medio: 'webpay' } });
  registrar('P30', 'M10', 'Cliente inicia el pago: monto fijado por el servidor', 201, pago, pago.status === 201 && pago.json?.monto === ped.json.total);
  const PAGO = pago.json?.id;

  const evento = { eventoId: `evt-${sufijo}-1`, pagoId: PAGO, estado: 'aprobado', monto: pago.json?.monto };
  const sinFirma = await pedir('POST', '/payments/webhook', { body: evento, headers: { 'x-signature': 'f'.repeat(64), 'x-timestamp': String(Math.floor(Date.now() / 1000)) } });
  registrar('P31', 'M7', 'Confirmar pago con aviso sin firma válida (frontend alterado)', 401, sinFirma, sinFirma.status === 401);
  const alterado = { ...evento, monto: 1 };
  const firmaVieja = firmarAviso(evento);
  const rAlt = await pedir('POST', '/payments/webhook', { body: alterado, headers: firmaVieja });
  const sigue = await pedir('GET', `/orders/${PED}`, { token: A.token });
  registrar('P32', 'M7', 'Aviso con monto alterado después de firmar', 401, rAlt, rAlt.status === 401 && sigue.json?.estado === 'pendiente_pago', 'pedido sigue pendiente_pago');
  const okPago = await pedir('POST', '/payments/webhook', { body: evento, headers: firmarAviso(evento) });
  const pagado = await pedir('GET', `/orders/${PED}`, { token: A.token });
  registrar('P33', 'M10', 'Aviso firmado del proveedor aprueba el pago y el pedido', 200, okPago, okPago.status === 200 && pagado.json?.estado === 'pagado');
  const dupAviso = await pedir('POST', '/payments/webhook', { body: evento, headers: firmarAviso(evento) });
  registrar('P34', 'M10', 'El mismo aviso repetido no cambia nada (idempotencia)', 200, dupAviso, dupAviso.status === 200 && dupAviso.json?.duplicado === true);
  const otroPago = await pedir('POST', `/orders/${PED}/payments`, { token: A.token, body: { medio: 'servipag' } });
  registrar('P35', 'M10', 'Segundo cobro de un pedido ya pagado', 409, otroPago, otroPago.status === 409);
  const estPago = await pedir('GET', `/payments/${PAGO}`, { token: B.token });
  registrar('P36', 'M7', 'Cliente B consulta el pago de A', 404, estPago, estPago.status === 404);

  // ---------------------------------------------------------------- estados (admin)
  const salto = await pedir('PATCH', `/orders/${PED}/status`, { token: ADM, body: { estado: 'entregado' } });
  registrar('P37', 'M10', 'Transición de estado no permitida (pagado -> entregado)', 409, salto, salto.status === 409);
  const prep = await pedir('PATCH', `/orders/${PED}/status`, { token: ADM, body: { estado: 'en_preparacion' } });
  registrar('P38', 'M10', 'Administrador pasa el pedido a en_preparacion', 200, prep, prep.status === 200 && prep.json?.estado === 'en_preparacion');
  const cliEstado = await pedir('PATCH', `/orders/${PED}/status`, { token: A.token, body: { estado: 'entregado' } });
  registrar('P39', 'M4', 'Cliente intenta cambiar el estado del pedido', 403, cliEstado, cliEstado.status === 403);

  // ---------------------------------------------------------------- GraphQL
  const Q = `query($id: ID!) { resumenPedido(id: $id) { id estado total items { cantidad nombreAlComprar producto { nombre descripcion disponible } } cliente { nombre correo } } }`;
  const g1 = await pedir('POST', '/graphql', { token: A.token, body: { query: Q, variables: { id: PED } } });
  const d1 = g1.json?.data?.resumenPedido;
  registrar('P40', 'M8', 'GraphQL resumenPedido combina orders + inventory + clients', 200, g1,
    g1.status === 200 && d1?.estado === 'en_preparacion' && !!d1?.items?.[0]?.producto?.descripcion && d1?.cliente?.correo === A.correo && !g1.json.errors);
  const g2 = await pedir('POST', '/graphql', { token: B.token, body: { query: Q, variables: { id: PED } } });
  registrar('P41', 'M8', 'GraphQL: cliente B pide el resumen del pedido de A', 200, g2,
    g2.json?.data?.resumenPedido === null && g2.json?.errors?.[0]?.extensions?.code === 'NO_ENCONTRADO', 'data null, NO_ENCONTRADO');
  const QR = `query($id: ID!) { resumenPedido(id: $id) { cliente { nombre run } } }`;
  const g3 = await pedir('POST', '/graphql', { token: A.token, body: { query: QR, variables: { id: PED } } });
  const g3a = await pedir('POST', '/graphql', { token: ADM, body: { query: QR, variables: { id: PED } } });
  registrar('P42', 'M8', 'GraphQL: campo run negado al cliente y permitido al admin', 200, g3,
    g3.json?.data?.resumenPedido?.cliente?.run === null && g3.json?.errors?.[0]?.extensions?.code === 'CAMPO_NO_AUTORIZADO' && !!g3a.json?.data?.resumenPedido?.cliente?.run);
  const alias = Array.from({ length: 130 }, (_, i) => `e${i}: estado`).join(' ');
  const g4 = await pedir('POST', '/graphql', { token: A.token, body: { query: `{ misPedidos { ${alias} } }` } });
  registrar('P43', 'M8', 'GraphQL: consulta que excede el costo máximo', 400, g4, g4.status === 400 && g4.json?.errors?.some((e) => e.extensions?.code === 'LIMITE_COSTO'));
  const g5 = await pedir('POST', '/graphql', { token: A.token, body: { query: '{ __schema { types { name } } }' } });
  registrar('P44', 'M8', 'GraphQL: introspección deshabilitada', 400, g5, g5.status === 400);
  const g6 = await pedir('POST', '/graphql', { token: A.token, body: { query: '{ misPedidos(limite: 1000) { id } }' } });
  registrar('P45', 'M8', 'GraphQL: paginación por sobre el máximo', 200, g6, g6.json?.errors?.[0]?.extensions?.code === 'ENTRADA_INVALIDA');

  // ---------------------------------------------------------------- acceso directo y bordes
  const interna = await pedir('GET', `/internal/tokens/abc`);
  const interna2 = await pedir('GET', `${BASE}/internal/orders?clienteId=x`);
  registrar('P46', 'M5/M7', 'Rutas internas no se publican en el gateway', 404, interna, interna.status === 404 && interna2.status === 404);
  let directo;
  try {
    directo = await pedir('GET', 'http://127.0.0.1:3004/orders', { headers: { 'x-user-id': 'cualquiera', 'x-user-role': 'admin' } });
  } catch {
    directo = null;
  }
  registrar('P47', 'M7', 'Acceso directo a orders sin token de servicio', 401, directo,
    directo === null || directo.status === 401, directo === null ? 'puerto no expuesto (Docker): conexión rechazada' : 'responde 401 sin datos');
  const grande = await pedir('POST', '/orders', { crudo: JSON.stringify({ nombre: 'x'.repeat(200 * 1024) }) });
  registrar('P48', 'M5', 'Cuerpo mayor a 100 KB', 413, grande, grande.status === 413 || grande.status === 400);
  const malJson = await pedir('POST', '/auth/login', { crudo: '{"correo": "a", ' });
  registrar('P49', 'M5', 'JSON mal formado: error controlado sin detalles internos', 400, malJson, malJson.status === 400 && !JSON.stringify(malJson.json).includes('at '));

  // ---------------------------------------------------------------- sesión
  const salir = await pedir('POST', '/auth/logout', { token: B.token });
  const reuso = await pedir('GET', '/clients/me', { token: B.token });
  registrar('P50', 'M7', 'Token reutilizado después de cerrar sesión', 401, reuso, salir.status === 204 && reuso.status === 401);

  // ---------------------------------------------------------------- límite de intentos (al final: afecta a la IP)
  let ultimo;
  for (let i = 0; i < 12; i += 1) {
    ultimo = await pedir('POST', '/auth/login', { body: { correo: A.correo, password: 'Incorrecta123' } });
    if (ultimo.status === 429) break;
  }
  registrar('P51', 'M5', 'Fuerza bruta en el login: límite de solicitudes', 429, ultimo, ultimo.status === 429);

  // ---------------------------------------------------------------- informe
  const ok = resultados.filter((r) => r.ok).length;
  console.log(`\n${ok}/${resultados.length} pruebas con el resultado esperado.`);
  const dir = path.join(RAIZ, 'docs', 'evidencias');
  fs.mkdirSync(dir, { recursive: true });
  const fecha = new Date().toISOString();
  const md = [
    '# Resultado de las pruebas de integración y seguridad',
    '',
    `Ejecutado: ${fecha} · contra \`${BASE}\` · comando \`npm run seguridad\``,
    '',
    `**${ok} de ${resultados.length}** pruebas con el resultado esperado. Datos ficticios generados en la ejecución.`,
    'El `x-request-id` permite encontrar cada solicitud en los logs (`local-data/logs/`).',
    '',
    '| ID | Módulo | Prueba | Solicitud | Esperado | Obtenido | Resultado | x-request-id | Nota |',
    '|---|---|---|---|---|---|---|---|---|',
    ...resultados.map((r) => `| ${r.id} | ${r.modulo} | ${r.descripcion} | \`${r.solicitud.replace(/\|/g, '\\|')}\` | ${r.esperado} | ${r.obtenido} | ${r.ok ? '✅' : '❌'} | ${r.requestId} | ${r.nota} |`),
    ''
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'resultado-pruebas.md'), md);
  fs.writeFileSync(path.join(dir, 'resultado-pruebas.json'), JSON.stringify({ fecha, base: BASE, resultados }, null, 2));
  console.log('Evidencia guardada en docs/evidencias/resultado-pruebas.md');
  process.exit(ok === resultados.length ? 0 : 1);
}

main().catch((err) => {
  console.error('Error inesperado en las pruebas:', err);
  process.exit(1);
});
