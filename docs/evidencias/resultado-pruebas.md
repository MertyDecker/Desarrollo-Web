# Resultado de las pruebas de integración y seguridad

Ejecutado: 2026-11-09T02:56:27.477Z · contra `http://localhost:8080` · comando `npm run seguridad`

**51 de 51** pruebas con el resultado esperado. Datos ficticios generados en la ejecución.
El `x-request-id` permite encontrar cada solicitud en los logs (`local-data/logs/`).

| ID | Módulo | Prueba | Solicitud | Esperado | Obtenido | Resultado | x-request-id | Nota |
|---|---|---|---|---|---|---|---|---|
| P01 | M1/M7 | Visitante anónimo consulta el catálogo | `GET /api/v1/products?available=true` | 200 | 200 | ✅ | req-2e | sin stock exacto en la respuesta |
| P02 | M7 | Inyección NoSQL en filtros del catálogo | `GET /api/v1/products?available[$ne]=x` | 400 | 400 | ✅ | req-2f |  |
| P03 | M1 | Registro de cliente (RUN válido, contraseña con hash) | `POST /api/v1/clients` | 201 | 201 | ✅ | req-2g |  |
| P04 | M1 | Validación de correo con código | `POST /api/v1/clients/verify-email` | 200 | 200 | ✅ | req-2h |  |
| P05 | M4 | Inicio de sesión del cliente (token ES256 con expiración) | `POST /api/v1/auth/login` | 200 | 200 | ✅ | req-2i |  |
| P06 | M1 | Registro con RUN ya existente | `POST /api/v1/clients` | 409 | 409 | ✅ | req-2o |  |
| P07 | M1 | Registro con RUN inválido | `POST /api/v1/clients` | 400 | 400 | ✅ | req-2p |  |
| P08 | M7 | Login con clave incorrecta: mismo mensaje que cuenta inexistente | `POST /api/v1/auth/login` | 401 | 401 | ✅ | req-2q |  |
| P09 | M7 | Inyección NoSQL en el login | `POST /api/v1/auth/login` | 400 | 400 | ✅ | req-2s |  |
| P10 | M4 | Inicio de sesión del administrador | `POST /api/v1/auth/login` | 200 | 200 | ✅ | req-2t |  |
| P11 | M7 | Operación protegida sin sesión | `GET /api/v1/orders` | 401 | 401 | ✅ | req-2u |  |
| P12 | M7 | Token con alg "none" y rol admin inventado | `POST /api/v1/products` | 401 | 401 | ✅ | req-2v |  |
| P13 | M7 | Token del cliente con el rol cambiado a admin (firma rota) | `POST /api/v1/products` | 401 | 401 | ✅ | req-2w |  |
| P14 | M7 | Token firmado con una clave que no es la de auth | `POST /api/v1/products` | 401 | 401 | ✅ | req-2x |  |
| P15 | M4/M7 | Cliente intenta crear un producto (operación de administración) | `POST /api/v1/products` | 403 | 403 | ✅ | req-2y |  |
| P16 | M5 | Cliente envía cabeceras x-user-role/x-user-id falsas | `DELETE /api/v1/products/6af133d383e0f93ffe1cfd51` | 403 | 403 | ✅ | req-2z |  |
| P17 | M1/M4 | Administrador crea un producto (stock 2) | `POST /api/v1/products` | 201 | 201 | ✅ | req-30 |  |
| P18 | M7 | Campos no declarados en el cuerpo (asignación masiva) | `POST /api/v1/products` | 400 | 400 | ✅ | req-31 |  |
| P19 | M10 | Cliente confirma pedido: totales calculados por el servidor | `POST /api/v1/orders` | 201 | 201 | ✅ | req-32 | total 19180 |
| P20 | M10 | Reintento con la misma Idempotency-Key no duplica el pedido | `POST /api/v1/orders` | 200 | 200 | ✅ | req-33 |  |
| P21 | M7 | Pedido con precio/total enviados por el navegador | `POST /api/v1/orders` | 400 | 400 | ✅ | req-35 |  |
| P22 | M7 | Pedido usando la dirección de otro cliente | `POST /api/v1/orders` | 400 | 400 | ✅ | req-36 |  |
| P23 | M10 | Cliente A consulta su propio pedido | `GET /api/v1/orders/f14971e8-38c1-4a0d-875a-0e988e9bc231` | 200 | 200 | ✅ | req-37 |  |
| P24 | M7/M10 | Cliente B consulta el pedido de A (recurso ajeno) | `GET /api/v1/orders/f14971e8-38c1-4a0d-875a-0e988e9bc231` | 404 | 404 | ✅ | req-38 | sin datos del pedido |
| P25 | M10 | Pedido reserva el stock (producto queda no disponible) | `POST /api/v1/orders` | 201 | 201 | ✅ | req-39 | envío cobrado fuera del radio |
| P26 | M10 | Pedido sin stock suficiente | `POST /api/v1/orders` | 409 | 409 | ✅ | req-3b |  |
| P27 | M10 | Cancelar el pedido recupera el stock | `POST /api/v1/orders/011fe68f-f3fe-4b37-937f-31c959d4ef56/cancel` | 200 | 200 | ✅ | req-3c |  |
| P28 | M7 | Pago con monto/estado enviados por el navegador | `POST /api/v1/orders/f14971e8-38c1-4a0d-875a-0e988e9bc231/payments` | 400 | 400 | ✅ | req-3e |  |
| P29 | M7 | Cliente B intenta pagar el pedido de A | `POST /api/v1/orders/f14971e8-38c1-4a0d-875a-0e988e9bc231/payments` | 404 | 404 | ✅ | req-3f |  |
| P30 | M10 | Cliente inicia el pago: monto fijado por el servidor | `POST /api/v1/orders/f14971e8-38c1-4a0d-875a-0e988e9bc231/payments` | 201 | 201 | ✅ | req-3g |  |
| P31 | M7 | Confirmar pago con aviso sin firma válida (frontend alterado) | `POST /api/v1/payments/webhook` | 401 | 401 | ✅ | req-3h |  |
| P32 | M7 | Aviso con monto alterado después de firmar | `POST /api/v1/payments/webhook` | 401 | 401 | ✅ | req-3i | pedido sigue pendiente_pago |
| P33 | M10 | Aviso firmado del proveedor aprueba el pago y el pedido | `POST /api/v1/payments/webhook` | 200 | 200 | ✅ | req-3k |  |
| P34 | M10 | El mismo aviso repetido no cambia nada (idempotencia) | `POST /api/v1/payments/webhook` | 200 | 200 | ✅ | req-3m |  |
| P35 | M10 | Segundo cobro de un pedido ya pagado | `POST /api/v1/orders/f14971e8-38c1-4a0d-875a-0e988e9bc231/payments` | 409 | 409 | ✅ | req-3n |  |
| P36 | M7 | Cliente B consulta el pago de A | `GET /api/v1/payments/b86069e7-5dc9-4e08-8fe2-1f81414c1e7f` | 404 | 404 | ✅ | req-3o |  |
| P37 | M10 | Transición de estado no permitida (pagado -> entregado) | `PATCH /api/v1/orders/f14971e8-38c1-4a0d-875a-0e988e9bc231/status` | 409 | 409 | ✅ | req-3p |  |
| P38 | M10 | Administrador pasa el pedido a en_preparacion | `PATCH /api/v1/orders/f14971e8-38c1-4a0d-875a-0e988e9bc231/status` | 200 | 200 | ✅ | req-3q |  |
| P39 | M4 | Cliente intenta cambiar el estado del pedido | `PATCH /api/v1/orders/f14971e8-38c1-4a0d-875a-0e988e9bc231/status` | 403 | 403 | ✅ | req-3r |  |
| P40 | M8 | GraphQL resumenPedido combina orders + inventory + clients | `POST /api/v1/graphql` | 200 | 200 | ✅ | req-3s |  |
| P41 | M8 | GraphQL: cliente B pide el resumen del pedido de A | `POST /api/v1/graphql` | 200 | 200 | ✅ | req-3t | data null, NO_ENCONTRADO |
| P42 | M8 | GraphQL: campo run negado al cliente y permitido al admin | `POST /api/v1/graphql` | 200 | 200 | ✅ | req-3u |  |
| P43 | M8 | GraphQL: consulta que excede el costo máximo | `POST /api/v1/graphql` | 400 | 400 | ✅ | req-3w |  |
| P44 | M8 | GraphQL: introspección deshabilitada | `POST /api/v1/graphql` | 400 | 400 | ✅ | req-3x |  |
| P45 | M8 | GraphQL: paginación por sobre el máximo | `POST /api/v1/graphql` | 200 | 200 | ✅ | req-3y |  |
| P46 | M5/M7 | Rutas internas no se publican en el gateway | `GET /api/v1/internal/tokens/abc` | 404 | 404 | ✅ | req-3z |  |
| P47 | M7 | Acceso directo a orders sin token de servicio | `GET http://127.0.0.1:3004/orders` | 401 | 401 | ✅ | req-m | responde 401 sin datos |
| P48 | M5 | Cuerpo mayor a 100 KB | `POST /api/v1/orders` | 413 | 413 | ✅ | req-41 |  |
| P49 | M5 | JSON mal formado: error controlado sin detalles internos | `POST /api/v1/auth/login` | 400 | 400 | ✅ | req-42 |  |
| P50 | M7 | Token reutilizado después de cerrar sesión | `GET /api/v1/clients/me` | 401 | 401 | ✅ | req-44 |  |
| P51 | M5 | Fuerza bruta en el login: límite de solicitudes | `POST /api/v1/auth/login` | 429 | 429 | ✅ | req-48 |  |
