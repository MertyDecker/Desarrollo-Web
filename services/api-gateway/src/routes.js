'use strict';

/**
 * Tabla explícita de rutas públicas (lista blanca).
 * Solo estas combinaciones de verbo + ruta existen hacia afuera; cualquier
 * otra responde 404 y nunca llega a un servicio interno.
 *
 * acceso:
 *   'anonimo'          cualquiera, sin token
 *   ['cliente']        token válido con rol cliente
 *   ['admin']          token válido con rol admin
 *   ['cliente','admin'] cualquiera de los dos
 *
 * destino.servicio: nombre del servicio interno (su URL y su token de servicio
 *   están en la configuración, nunca aquí).
 * limite: límite de solicitudes por minuto por IP para rutas sensibles.
 * cabeceras: cabeceras del navegador que SÍ se reenvían (lista blanca explícita).
 * propagar401: el servicio puede responder 401 propio (firma inválida del proveedor).
 */
const ROUTES = [
  // ---- inventory ----------------------------------------------------------
  { id: 'S01', metodo: 'GET', ruta: '/api/v1/products', acceso: 'anonimo', destino: { servicio: 'inventory', ruta: '/products' } },
  { id: 'S02', metodo: 'GET', ruta: '/api/v1/products/:id', acceso: 'anonimo', destino: { servicio: 'inventory', ruta: '/products/:id' } },
  { id: 'S03', metodo: 'POST', ruta: '/api/v1/products', acceso: ['admin'], destino: { servicio: 'inventory', ruta: '/products' } },
  { id: 'S04', metodo: 'PUT', ruta: '/api/v1/products/:id', acceso: ['admin'], destino: { servicio: 'inventory', ruta: '/products/:id' } },
  { id: 'S05', metodo: 'DELETE', ruta: '/api/v1/products/:id', acceso: ['admin'], destino: { servicio: 'inventory', ruta: '/products/:id' } },

  // ---- clients ------------------------------------------------------------
  { id: 'S08', metodo: 'POST', ruta: '/api/v1/clients', acceso: 'anonimo', destino: { servicio: 'clients', ruta: '/clients' }, limite: 5 },
  { id: 'S09', metodo: 'POST', ruta: '/api/v1/clients/verify-email', acceso: 'anonimo', destino: { servicio: 'clients', ruta: '/clients/verify-email' }, limite: 10 },
  { id: 'S12', metodo: 'GET', ruta: '/api/v1/clients/me', acceso: ['cliente'], destino: { servicio: 'clients', ruta: '/clients/me' } },
  { id: 'S13', metodo: 'PUT', ruta: '/api/v1/clients/me', acceso: ['cliente'], destino: { servicio: 'clients', ruta: '/clients/me' } },
  { id: 'S14', metodo: 'POST', ruta: '/api/v1/clients/me/addresses', acceso: ['cliente'], destino: { servicio: 'clients', ruta: '/clients/me/addresses' } },
  { id: 'S15', metodo: 'GET', ruta: '/api/v1/clients/me/addresses', acceso: ['cliente'], destino: { servicio: 'clients', ruta: '/clients/me/addresses' } },

  // ---- auth ---------------------------------------------------------------
  { id: 'S10', metodo: 'POST', ruta: '/api/v1/auth/login', acceso: 'anonimo', destino: { servicio: 'auth', ruta: '/login' }, propagar401: true, limite: 10 },
  { id: 'S11', metodo: 'POST', ruta: '/api/v1/auth/logout', acceso: ['cliente', 'admin'], destino: { servicio: 'auth', ruta: '/logout' }, reenviarToken: true },

  // ---- orders -------------------------------------------------------------
  { id: 'S16', metodo: 'POST', ruta: '/api/v1/orders', acceso: ['cliente'], destino: { servicio: 'orders', ruta: '/orders' }, cabeceras: ['idempotency-key'], limite: 20 },
  { id: 'S17', metodo: 'GET', ruta: '/api/v1/orders', acceso: ['cliente', 'admin'], destino: { servicio: 'orders', ruta: '/orders' } },
  { id: 'S18', metodo: 'GET', ruta: '/api/v1/orders/:id', acceso: ['cliente', 'admin'], destino: { servicio: 'orders', ruta: '/orders/:id' } },
  { id: 'S19', metodo: 'POST', ruta: '/api/v1/orders/:id/cancel', acceso: ['cliente'], destino: { servicio: 'orders', ruta: '/orders/:id/cancel' } },
  { id: 'S20', metodo: 'PATCH', ruta: '/api/v1/orders/:id/status', acceso: ['admin'], destino: { servicio: 'orders', ruta: '/orders/:id/status' } },

  // ---- payments -----------------------------------------------------------
  { id: 'S21', metodo: 'POST', ruta: '/api/v1/orders/:id/payments', acceso: ['cliente'], destino: { servicio: 'payments', ruta: '/orders/:id/payments' }, limite: 20 },
  { id: 'S22', metodo: 'GET', ruta: '/api/v1/payments/:id', acceso: ['cliente', 'admin'], destino: { servicio: 'payments', ruta: '/payments/:id' } },
  // El proveedor no tiene sesión de usuario: payments verifica su firma HMAC.
  { id: 'S23', metodo: 'POST', ruta: '/api/v1/payments/webhook', acceso: 'anonimo', destino: { servicio: 'payments', ruta: '/webhook' }, cabeceras: ['x-signature', 'x-timestamp'], propagar401: true, limite: 60 },

  // ---- GraphQL Gateway interno ---------------------------------------------
  { id: 'S24', metodo: 'POST', ruta: '/api/v1/graphql', acceso: ['cliente', 'admin'], destino: { servicio: 'graphql', ruta: '/graphql' }, limite: 30 }
];

module.exports = { ROUTES };
