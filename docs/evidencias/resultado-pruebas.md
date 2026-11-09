# Resultado de las pruebas de integración y seguridad

Ejecutado: 2026-11-09T02:48:22.795Z · contra `http://localhost:8080` · comando `npm run seguridad`

**51 de 51** pruebas con el resultado esperado. Datos ficticios generados en la ejecución.
El `x-request-id` permite encontrar cada solicitud en los logs (`local-data/logs/`).

| ID | Módulo | Prueba | Solicitud | Esperado | Obtenido | Resultado | x-request-id | Nota |
|---|---|---|---|---|---|---|---|---|
| P01 | M1/M7 | Visitante anónimo consulta el catálogo | `GET /api/v1/products?available=true` | 200 | 200 | ✅ | req-3 | sin stock exacto en la respuesta |
| P02 | M7 | Inyección NoSQL en filtros del catálogo | `GET /api/v1/products?available[$ne]=x` | 400 | 400 | ✅ | req-4 |  |
| P03 | M1 | Registro de cliente (RUN válido, contraseña con hash) | `POST /api/v1/clients` | 201 | 201 | ✅ | req-5 |  |
| P04 | M1 | Validación de correo con código | `POST /api/v1/clients/verify-email` | 200 | 200 | ✅ | req-6 |  |
| P05 | M4 | Inicio de sesión del cliente (token ES256 con expiración) | `POST /api/v1/auth/login` | 200 | 200 | ✅ | req-7 |  |
| P06 | M1 | Registro con RUN ya existente | `POST /api/v1/clients` | 409 | 409 | ✅ | req-d |  |
| P07 | M1 | Registro con RUN inválido | `POST /api/v1/clients` | 400 | 400 | ✅ | req-e |  |
| P08 | M7 | Login con clave incorrecta: mismo mensaje que cuenta inexistente | `POST /api/v1/auth/login` | 401 | 401 | ✅ | req-f |  |
| P09 | M7 | Inyección NoSQL en el login | `POST /api/v1/auth/login` | 400 | 400 | ✅ | req-h |  |
| P10 | M4 | Inicio de sesión del administrador | `POST /api/v1/auth/login` | 200 | 200 | ✅ | req-i |  |
| P11 | M7 | Operación protegida sin sesión | `GET /api/v1/orders` | 401 | 401 | ✅ | req-j |  |
| P12 | M7 | Token con alg "none" y rol admin inventado | `POST /api/v1/products` | 401 | 401 | ✅ | req-k |  |
| P13 | M7 | Token del cliente con el rol cambiado a admin (firma rota) | `POST /api/v1/products` | 401 | 401 | ✅ | req-l |  |
| P14 | M7 | Token firmado con una clave que no es la de auth | `POST /api/v1/products` | 401 | 401 | ✅ | req-m |  |
| P15 | M4/M7 | Cliente intenta crear un producto (operación de administración) | `POST /api/v1/products` | 403 | 403 | ✅ | req-n |  |
| P16 | M5 | Cliente envía cabeceras x-user-role/x-user-id falsas | `DELETE /api/v1/products/6af133d383e0f93ffe1cfd51` | 403 | 403 | ✅ | req-o |  |
| P17 | M1/M4 | Administrador crea un producto (stock 2) | `POST /api/v1/products` | 201 | 201 | ✅ | req-p |  |
| P18 | M7 | Campos no declarados en el cuerpo (asignación masiva) | `POST /api/v1/products` | 400 | 400 | ✅ | req-q |  |
| P19 | M10 | Cliente confirma pedido: totales calculados por el servidor | `POST /api/v1/orders` | 201 | 201 | ✅ | req-r | total 19180 |
| P20 | M10 | Reintento con la misma Idempotency-Key no duplica el pedido | `POST /api/v1/orders` | 200 | 200 | ✅ | req-s |  |
| P21 | M7 | Pedido con precio/total enviados por el navegador | `POST /api/v1/orders` | 400 | 400 | ✅ | req-u |  |
| P22 | M7 | Pedido usando la dirección de otro cliente | `POST /api/v1/orders` | 400 | 400 | ✅ | req-v |  |
| P23 | M10 | Cliente A consulta su propio pedido | `GET /api/v1/orders/509fb71f-68a8-404d-bcac-f4de5e7d99a9` | 200 | 200 | ✅ | req-w |  |
| P24 | M7/M10 | Cliente B consulta el pedido de A (recurso ajeno) | `GET /api/v1/orders/509fb71f-68a8-404d-bcac-f4de5e7d99a9` | 404 | 404 | ✅ | req-x | sin datos del pedido |
| P25 | M10 | Pedido reserva el stock (producto queda no disponible) | `POST /api/v1/orders` | 201 | 201 | ✅ | req-y | envío cobrado fuera del radio |
| P26 | M10 | Pedido sin stock suficiente | `POST /api/v1/orders` | 409 | 409 | ✅ | req-10 |  |
| P27 | M10 | Cancelar el pedido recupera el stock | `POST /api/v1/orders/e78d1506-e66e-4ba3-aada-575c0f879e73/cancel` | 200 | 200 | ✅ | req-11 |  |
| P28 | M7 | Pago con monto/estado enviados por el navegador | `POST /api/v1/orders/509fb71f-68a8-404d-bcac-f4de5e7d99a9/payments` | 400 | 400 | ✅ | req-13 |  |
| P29 | M7 | Cliente B intenta pagar el pedido de A | `POST /api/v1/orders/509fb71f-68a8-404d-bcac-f4de5e7d99a9/payments` | 404 | 404 | ✅ | req-14 |  |
| P30 | M10 | Cliente inicia el pago: monto fijado por el servidor | `POST /api/v1/orders/509fb71f-68a8-404d-bcac-f4de5e7d99a9/payments` | 201 | 201 | ✅ | req-15 |  |
| P31 | M7 | Confirmar pago con aviso sin firma válida (frontend alterado) | `POST /api/v1/payments/webhook` | 401 | 401 | ✅ | req-16 |  |
| P32 | M7 | Aviso con monto alterado después de firmar | `POST /api/v1/payments/webhook` | 401 | 401 | ✅ | req-17 | pedido sigue pendiente_pago |
| P33 | M10 | Aviso firmado del proveedor aprueba el pago y el pedido | `POST /api/v1/payments/webhook` | 200 | 200 | ✅ | req-19 |  |
| P34 | M10 | El mismo aviso repetido no cambia nada (idempotencia) | `POST /api/v1/payments/webhook` | 200 | 200 | ✅ | req-1b |  |
| P35 | M10 | Segundo cobro de un pedido ya pagado | `POST /api/v1/orders/509fb71f-68a8-404d-bcac-f4de5e7d99a9/payments` | 409 | 409 | ✅ | req-1c |  |
| P36 | M7 | Cliente B consulta el pago de A | `GET /api/v1/payments/a56ef0c8-196c-441c-a139-891d169b7ec7` | 404 | 404 | ✅ | req-1d |  |
| P37 | M10 | Transición de estado no permitida (pagado -> entregado) | `PATCH /api/v1/orders/509fb71f-68a8-404d-bcac-f4de5e7d99a9/status` | 409 | 409 | ✅ | req-1e |  |
| P38 | M10 | Administrador pasa el pedido a en_preparacion | `PATCH /api/v1/orders/509fb71f-68a8-404d-bcac-f4de5e7d99a9/status` | 200 | 200 | ✅ | req-1f |  |
| P39 | M4 | Cliente intenta cambiar el estado del pedido | `PATCH /api/v1/orders/509fb71f-68a8-404d-bcac-f4de5e7d99a9/status` | 403 | 403 | ✅ | req-1g |  |
| P40 | M8 | GraphQL resumenPedido combina orders + inventory + clients | `POST /api/v1/graphql` | 200 | 200 | ✅ | req-1h |  |
| P41 | M8 | GraphQL: cliente B pide el resumen del pedido de A | `POST /api/v1/graphql` | 200 | 200 | ✅ | req-1i | data null, NO_ENCONTRADO |
| P42 | M8 | GraphQL: campo run negado al cliente y permitido al admin | `POST /api/v1/graphql` | 200 | 200 | ✅ | req-1j |  |
| P43 | M8 | GraphQL: consulta que excede el costo máximo | `POST /api/v1/graphql` | 400 | 400 | ✅ | req-1l |  |
| P44 | M8 | GraphQL: introspección deshabilitada | `POST /api/v1/graphql` | 400 | 400 | ✅ | req-1m |  |
| P45 | M8 | GraphQL: paginación por sobre el máximo | `POST /api/v1/graphql` | 200 | 200 | ✅ | req-1n |  |
| P46 | M5/M7 | Rutas internas no se publican en el gateway | `GET /api/v1/internal/tokens/abc` | 404 | 404 | ✅ | req-1o |  |
| P47 | M7 | Acceso directo a orders sin token de servicio | `GET http://127.0.0.1:3004/orders` | 401 | 401 | ✅ | req-a | responde 401 sin datos |
| P48 | M5 | Cuerpo mayor a 100 KB | `POST /api/v1/clients` | 413 | 413 | ✅ | req-1q |  |
| P49 | M5 | JSON mal formado: error controlado sin detalles internos | `POST /api/v1/auth/login` | 400 | 400 | ✅ | req-1r |  |
| P50 | M7 | Token reutilizado después de cerrar sesión | `GET /api/v1/clients/me` | 401 | 401 | ✅ | req-1t |  |
| P51 | M5 | Fuerza bruta en el login: límite de solicitudes | `POST /api/v1/auth/login` | 429 | 429 | ✅ | req-1x |  |
