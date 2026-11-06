'use strict';

// Cliente HTTP hacia el servicio auth (red privada). Usa su propio token de
// servicio "clients -> auth", distinto del que usa el gateway.
function crearAuthClient({ baseUrl, token, timeoutMs = 5000 }) {
  async function llamar(metodo, ruta, cuerpo) {
    const res = await fetch(`${baseUrl}${ruta}`, {
      method: metodo,
      headers: {
        'x-service-token': token,
        ...(cuerpo ? { 'content-type': 'application/json' } : {})
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(timeoutMs)
    });
    return res.status;
  }

  return {
    async crearCredencial({ clienteId, correo, password }) {
      const status = await llamar('POST', '/internal/credentials', { clienteId, correo, password });
      if (status === 201) return { ok: true };
      if (status === 409) return { conflicto: true };
      if (status === 400) return { invalida: true };
      throw new Error(`auth respondió ${status}`);
    },
    async activar(clienteId) {
      const status = await llamar('POST', `/internal/credentials/${encodeURIComponent(clienteId)}/activate`);
      if (status !== 204) throw new Error(`auth respondió ${status}`);
    },
    async eliminar(clienteId) {
      await llamar('DELETE', `/internal/credentials/${encodeURIComponent(clienteId)}`);
    }
  };
}

module.exports = { crearAuthClient };
