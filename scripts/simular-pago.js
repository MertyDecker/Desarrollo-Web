'use strict';

/**
 * Simulador del proveedor de pagos (adaptador de prueba de Webpay/Servipag).
 * Envía al API Gateway el aviso firmado que mandaría el proveedor real.
 *
 *   npm run pago -- <pagoId> <monto> [aprobado|rechazado]
 *
 * Firma: HMAC-SHA256 de "<timestamp>.<cuerpo JSON>" con el secreto compartido
 * (secrets/payments_webhook_secret.txt). El secreto nunca sale del backend ni
 * llega al navegador: este script representa al proveedor, no al frontend.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const [pagoId, monto, estado = 'aprobado'] = process.argv.slice(2);
if (!pagoId || !monto || !['aprobado', 'rechazado'].includes(estado)) {
  console.error('Uso: npm run pago -- <pagoId> <monto> [aprobado|rechazado]');
  process.exit(1);
}
const BASE = process.env.GATEWAY_URL || 'http://localhost:8080';
const secreto = fs.readFileSync(path.join(__dirname, '..', 'secrets', 'payments_webhook_secret.txt'), 'utf8').trim();
const evento = { eventoId: `evt-${crypto.randomUUID()}`, pagoId, estado, monto: Number(monto) };
const ts = Math.floor(Date.now() / 1000);
const firma = crypto.createHmac('sha256', secreto).update(`${ts}.${JSON.stringify(evento)}`).digest('hex');

fetch(`${BASE}/api/v1/payments/webhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-signature': firma, 'x-timestamp': String(ts) },
  body: JSON.stringify(evento)
})
  .then(async (r) => console.log(`Aviso ${evento.eventoId} -> ${r.status} ${await r.text()}`))
  .catch((e) => console.error('No se pudo enviar el aviso:', e.message));
