'use strict';

// Dobles de prueba con la misma interfaz que repo.mongo.js y upstreams.js.
function repoMemoria() {
  const pedidos = new Map();
  return {
    pedidos,
    async crear(p) {
      for (const x of pedidos.values()) {
        if (x.clienteId === p.clienteId && x.idempotencyKey === p.idempotencyKey) return { duplicado: true, pedido: x };
      }
      pedidos.set(p.id, structuredClone(p));
      return { duplicado: false };
    },
    async buscarPorId(id) { return pedidos.get(id) || null; },
    async buscarPorClave(c, k) { return [...pedidos.values()].find((x) => x.clienteId === c && x.idempotencyKey === k) || null; },
    async listar({ clienteId, estado }) {
      return [...pedidos.values()].filter((p) => (!clienteId || p.clienteId === clienteId) && (!estado || p.estado === estado));
    },
    async actualizarEstado(id, desde, hacia, por, fecha) {
      const p = pedidos.get(id);
      if (!p || p.estado !== desde) return null;
      p.estado = hacia; p.historial.push({ estado: hacia, fecha, por });
      return p;
    },
    async marcarPagado(id, pagoId, fecha) {
      const p = pedidos.get(id);
      if (!p || p.estado !== 'pendiente_pago') return null;
      p.estado = 'pagado'; p.pagoId = pagoId; p.historial.push({ estado: 'pagado', fecha, por: 'payments' });
      return p;
    }
  };
}

const P1 = 'a'.repeat(24);
const P2 = 'b'.repeat(24);

function inventoryFalso({ caido = false } = {}) {
  const stock = new Map([[P1, 5], [P2, 1]]);
  const reservas = new Map();
  const catalogo = { [P1]: { id: P1, nombre: 'Dragon Roll', precio: 8990, activo: true }, [P2]: { id: P2, nombre: 'Unagi Roll', precio: 8490, activo: true } };
  return {
    stock,
    async productos(ids) {
      if (caido) throw Object.assign(new Error('caido'), { code: 'DEPENDENCIA' });
      return ids.map((i) => catalogo[i]).filter(Boolean);
    },
    async reservar(id, ped, c) {
      const k = `${id}:${ped}`;
      if (reservas.has(k)) return { ok: true };
      if ((stock.get(id) || 0) < c) return { ok: false };
      stock.set(id, stock.get(id) - c); reservas.set(k, c);
      return { ok: true };
    },
    async liberar(id, ped) {
      const k = `${id}:${ped}`;
      if (!reservas.has(k)) return;
      stock.set(id, stock.get(id) + reservas.get(k)); reservas.delete(k);
    }
  };
}

const clientsFalso = {
  async direccion(clienteId, dirId) {
    const dirs = { 'cli-1': { id: 'dir-cli-1-a', direccion: 'Av. Providencia 1234', comuna: 'Providencia', region: 'RM' },
      'cli-2': { id: 'dir-cli-2-a', direccion: 'Av. Pajaritos 100', comuna: 'Maipú', region: 'RM' } };
    const d = dirs[clienteId];
    return d && d.id === dirId ? d : null;
  }
};

module.exports = { repoMemoria, inventoryFalso, clientsFalso, P1, P2 };
