'use strict';

// Repositorio en memoria con la misma interfaz que repo.mongo.js.
// Solo para pruebas: no sustituye a la persistencia real.
function repoMemoria() {
  const items = new Map();
  let n = 0;
  return {
    items,
    async crear(d) {
      for (const c of items.values()) {
        if (c.run === d.run || c.correo === d.correo) throw Object.assign(new Error('dup'), { code: 'DUPLICADO' });
      }
      const id = (++n).toString(16).padStart(24, '0');
      const c = { id, ...structuredClone(d) };
      items.set(id, c);
      return c;
    },
    async eliminar(id) {
      items.delete(id);
    },
    async buscarPorId(id) {
      return items.get(id) || null;
    },
    async buscarPorCorreo(correo) {
      return [...items.values()].find((c) => c.correo === correo) || null;
    },
    async guardarCodigo(id, cv) {
      items.get(id).codigoVerificacion = { ...cv };
    },
    async sumarIntentoCodigo(id) {
      items.get(id).codigoVerificacion.intentos += 1;
    },
    async activar(id) {
      const c = items.get(id);
      c.estado = 'activo';
      delete c.codigoVerificacion;
    },
    async actualizarPerfil(id, d) {
      const c = items.get(id);
      if (!c) return null;
      Object.assign(c, d);
      return c;
    },
    async agregarDireccion(id, dir) {
      items.get(id).direcciones.push(dir);
    }
  };
}

module.exports = { repoMemoria };
