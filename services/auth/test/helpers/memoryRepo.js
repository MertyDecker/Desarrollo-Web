'use strict';

// Repositorio en memoria con la misma interfaz que repo.mongo.js.
// Solo para pruebas: no sustituye a la persistencia real.
function repoMemoria() {
  const creds = new Map(); // clienteId -> credencial
  const revocados = new Set();
  return {
    creds,
    async crearCredencial(d) {
      for (const c of creds.values()) {
        if (c.correo === d.correo) throw Object.assign(new Error('dup'), { code: 'DUPLICADO' });
      }
      if (creds.has(d.clienteId)) throw Object.assign(new Error('dup'), { code: 'DUPLICADO' });
      creds.set(d.clienteId, { intentosFallidos: 0, bloqueadoHasta: null, ...d });
    },
    async buscarPorCorreo(correo) {
      return [...creds.values()].find((c) => c.correo === correo) || null;
    },
    async activar(id) {
      const c = creds.get(id);
      if (!c) return false;
      c.estado = 'activo';
      return true;
    },
    async eliminarPendiente(id) {
      if (creds.get(id)?.estado === 'pendiente') creds.delete(id);
    },
    async registrarFallo(id, { maxIntentos, bloqueoHasta }) {
      const c = creds.get(id);
      c.intentosFallidos += 1;
      if (c.intentosFallidos >= maxIntentos) {
        c.bloqueadoHasta = bloqueoHasta;
        c.intentosFallidos = 0;
      }
    },
    async reiniciarFallos(id) {
      const c = creds.get(id);
      c.intentosFallidos = 0;
      c.bloqueadoHasta = null;
    },
    async revocar(jti) {
      revocados.add(jti);
    },
    async estaRevocado(jti) {
      return revocados.has(jti);
    }
  };
}

module.exports = { repoMemoria };
