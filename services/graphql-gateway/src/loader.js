'use strict';

/**
 * Agrupador mínimo de solicitudes (patrón DataLoader). Todas las claves pedidas
 * en el mismo ciclo se resuelven con UNA llamada por lote, y cada clave se
 * pide una sola vez por solicitud GraphQL. Así un pedido con 10 ítems hace una
 * llamada a inventory y no diez (evita el problema N+1).
 */
function crearLoader(cargarLote) {
  const cache = new Map();
  let pendientes = null;

  function despachar(lote) {
    const claves = [...lote.keys()];
    cargarLote(claves).then(
      (mapa) => {
        for (const [k, { resolver }] of lote) resolver(mapa.get(k) ?? null);
      },
      (err) => {
        for (const { rechazar } of lote.values()) rechazar(err);
      }
    );
  }

  return {
    load(clave) {
      if (cache.has(clave)) return cache.get(clave);
      if (!pendientes) {
        pendientes = new Map();
        const lote = pendientes;
        process.nextTick(() => {
          pendientes = null;
          despachar(lote);
        });
      }
      const promesa = new Promise((resolver, rechazar) => pendientes.set(clave, { resolver, rechazar }));
      cache.set(clave, promesa);
      return promesa;
    }
  };
}

module.exports = { crearLoader };
