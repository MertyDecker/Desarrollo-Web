'use strict';

const dependencia = (m) => Object.assign(new Error(m), { code: 'DEPENDENCIA' });

// Cliente del tramo payments -> orders, con su propio token de servicio.
function crearOrdersClient({ baseUrl, token, timeoutMs = 3000 }) {
  async function llamar(ruta, opts = {}) {
    try {
      return await fetch(`${baseUrl}${ruta}`, {
        ...opts,
        headers: { 'x-service-token': token, ...(opts.headers || {}) },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      throw dependencia(`orders: ${err.name}`);
    }
  }
  return {
    async pedido(id) {
      const res = await llamar(`/internal/orders/${encodeURIComponent(id)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw dependencia(`orders respondió ${res.status}`);
      return res.json();
    },
    async marcarPagado(id, pagoId, monto) {
      const res = await llamar(`/internal/orders/${encodeURIComponent(id)}/paid`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pagoId, monto })
      });
      if (!res.ok) throw dependencia(`orders respondió ${res.status}`);
      return res.json();
    }
  };
}

module.exports = { crearOrdersClient };
