'use strict';

// Repositorio en memoria con la misma interfaz que repo.mongo.js.
// Solo se usa en las pruebas del servicio (no sustituye a la persistencia real).
function crearRepoMemoria(semilla = []) {
  const items = new Map();
  let contador = 0;
  const nuevoId = () => (++contador).toString(16).padStart(24, '0');

  for (const s of semilla) {
    const id = nuevoId();
    items.set(id, { id, activo: true, imagen: null, descripcion: '', ...s });
  }

  return {
    async list({ available, category } = {}) {
      return [...items.values()].filter((p) => {
        if (!p.activo) return false;
        if (category && p.categoria !== category) return false;
        if (available === true && !(p.stock > 0)) return false;
        if (available === false && p.stock !== 0) return false;
        return true;
      });
    },
    async get(id) {
      return items.get(id) || null;
    },
    async create(datos) {
      const id = nuevoId();
      const p = { id, activo: true, ...datos };
      items.set(id, p);
      return p;
    },
    async replace(id, datos) {
      const actual = items.get(id);
      if (!actual) return null;
      const p = { ...actual, ...datos, id };
      items.set(id, p);
      return p;
    },
    async deactivate(id) {
      const actual = items.get(id);
      if (!actual) return false;
      actual.activo = false;
      return true;
    },
    _items: items
  };
}

module.exports = { crearRepoMemoria };
