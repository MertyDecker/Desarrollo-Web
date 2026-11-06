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
  { id: 'S10', metodo: 'POST', ruta: '/api/v1/auth/login', acceso: 'anonimo', destino: { servicio: 'auth', ruta: '/login' }, limite: 10 },
  { id: 'S11', metodo: 'POST', ruta: '/api/v1/auth/logout', acceso: ['cliente', 'admin'], destino: { servicio: 'auth', ruta: '/logout' }, reenviarToken: true }
];

module.exports = { ROUTES };
