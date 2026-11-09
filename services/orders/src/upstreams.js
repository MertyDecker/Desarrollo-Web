'use strict';

// Clientes HTTP hacia inventory y clients. Cada uno presenta el token de
// servicio de ESTE tramo (orders -> inventory, orders -> clients) y tiene un
// tiempo máximo de espera. Si la dependencia falla se lanza un error
// "DEPENDENCIA" que el servicio traduce a 503 sin detalles internos.
function dependencia(msg) {
  return Object.assign(new Error(msg), { code: 'DEPENDENCIA' });
}

async function llamar(url, { token, requestId, timeoutMs, ...opts }) {
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      headers: { 'x-service-token': token, ...(requestId ? { 'x-request-id': requestId } : {}), ...(opts.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    throw dependencia(`${url}: ${err.name}`);
  }
  return res;
}

function crearInventoryClient({ baseUrl, token, timeoutMs = 3000 }) {
  return {
    async productos(ids) {
      const res = await llamar(`${baseUrl}/internal/products?ids=${ids.join(',')}`, { token, timeoutMs });
      if (!res.ok) throw dependencia(`inventory respondió ${res.status}`);
      return res.json();
    },
    async reservar(productoId, pedidoId, cantidad) {
      const res = await llamar(`${baseUrl}/products/${productoId}/reservations`, {
        token,
        timeoutMs,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pedidoId, cantidad })
      });
      if (res.status === 201) return { ok: true };
      if (res.status === 409 || res.status === 404) return { ok: false };
      throw dependencia(`inventory respondió ${res.status}`);
    },
    async liberar(productoId, pedidoId) {
      const res = await llamar(`${baseUrl}/products/${productoId}/reservations/${encodeURIComponent(pedidoId)}`, {
        token,
        timeoutMs,
        method: 'DELETE'
      });
      if (res.status !== 204) throw dependencia(`inventory respondió ${res.status}`);
    }
  };
}

function crearClientsClient({ baseUrl, token, timeoutMs = 3000 }) {
  return {
    async direccion(clienteId, direccionId) {
      const res = await llamar(
        `${baseUrl}/internal/clients/${encodeURIComponent(clienteId)}/addresses/${encodeURIComponent(direccionId)}`,
        { token, timeoutMs }
      );
      if (res.status === 404) return null;
      if (!res.ok) throw dependencia(`clients respondió ${res.status}`);
      return res.json();
    }
  };
}

module.exports = { crearInventoryClient, crearClientsClient };
