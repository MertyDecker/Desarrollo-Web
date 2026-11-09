'use strict';

const dependencia = (m) => Object.assign(new Error(m), { code: 'DEPENDENCIA' });

// Cada tramo (graphql -> orders, graphql -> inventory, graphql -> clients) usa
// su propio token de servicio y un plazo máximo corto.
function crearCliente(baseUrl, token, timeoutMs) {
  return async (ruta) => {
    let res;
    try {
      res = await fetch(`${baseUrl}${ruta}`, { headers: { 'x-service-token': token }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw dependencia(`${baseUrl}: ${err.name}`);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw dependencia(`${baseUrl} respondió ${res.status}`);
    return res.json();
  };
}

function crearServicios({ ordersUrl, inventoryUrl, clientsUrl, tokens, timeoutMs = 2000 }) {
  const orders = crearCliente(ordersUrl, tokens.orders, timeoutMs);
  const inventory = crearCliente(inventoryUrl, tokens.inventory, timeoutMs);
  const clients = crearCliente(clientsUrl, tokens.clients, timeoutMs);
  return {
    orders: {
      pedido: (id) => orders(`/internal/orders/${encodeURIComponent(id)}`),
      pedidosDe: async (clienteId, limit, offset) =>
        (await orders(`/internal/orders?clienteId=${encodeURIComponent(clienteId)}&limit=${limit}&offset=${offset}`)) || []
    },
    inventory: { productos: async (ids) => (await inventory(`/internal/products?ids=${ids.join(',')}`)) || [] },
    clients: { cliente: (id) => clients(`/internal/clients/${encodeURIComponent(id)}`) }
  };
}

module.exports = { crearServicios };
