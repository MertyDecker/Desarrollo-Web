# Módulo 6 — Rutas y secretos de integración

## 1. Matriz de rutas del API Gateway

Fuente única: `services/api-gateway/src/routes.js`. Todo verbo o ruta que no esté aquí responde **404** en el
gateway. Controles comunes a todas las filas: límite global de 120 solicitudes/min por IP, cuerpo máximo de
100 KB, tiempo máximo de 5 s hacia el servicio, cabeceras de identidad reconstruidas por el gateway.

| ID | Gateway | Verbo | Ruta externa | Acceso y rol | Sistema y ruta destino | Controles propios | Credencial del tramo gateway→servicio |
|---|---|---|---|---|---|---|---|
| S01 | Externo | GET | `/api/v1/products` | anónimo | inventory `GET /products` | filtros validados (400) | `svc_token_gateway_inventory` |
| S02 | Externo | GET | `/api/v1/products/{id}` | anónimo | inventory `GET /products/{id}` | id de 24 hex (400) | `svc_token_gateway_inventory` |
| S03 | Externo | POST | `/api/v1/products` | admin | inventory `POST /products` | JWT + rol; inventory revisa rol otra vez | `svc_token_gateway_inventory` |
| S04 | Externo | PUT | `/api/v1/products/{id}` | admin | inventory `PUT /products/{id}` | JWT + rol | `svc_token_gateway_inventory` |
| S05 | Externo | DELETE | `/api/v1/products/{id}` | admin | inventory `DELETE /products/{id}` | JWT + rol; baja lógica | `svc_token_gateway_inventory` |
| S08 | Externo | POST | `/api/v1/clients` | anónimo | clients `POST /clients` | 5/min por IP | `svc_token_gateway_clients` |
| S09 | Externo | POST | `/api/v1/clients/verify-email` | anónimo | clients `POST /clients/verify-email` | 10/min por IP; 5 intentos por código | `svc_token_gateway_clients` |
| S10 | Externo | POST | `/api/v1/auth/login` | anónimo | auth `POST /login` | 10/min por IP; bloqueo tras 5 fallos | `svc_token_gateway_auth` |
| S11 | Externo | POST | `/api/v1/auth/logout` | cliente, admin | auth `POST /logout` | JWT; solo viajan `jti` y `exp` | `svc_token_gateway_auth` |
| S12 | Externo | GET | `/api/v1/clients/me` | cliente | clients `GET /clients/me` | JWT; `x-user-id` desde el token | `svc_token_gateway_clients` |
| S13 | Externo | PUT | `/api/v1/clients/me` | cliente | clients `PUT /clients/me` | JWT; solo campos editables | `svc_token_gateway_clients` |
| S14 | Externo | POST | `/api/v1/clients/me/addresses` | cliente | clients `POST /clients/me/addresses` | JWT; máx. 5 direcciones | `svc_token_gateway_clients` |
| S15 | Externo | GET | `/api/v1/clients/me/addresses` | cliente | clients `GET /clients/me/addresses` | JWT | `svc_token_gateway_clients` |
| S16 | Externo | POST | `/api/v1/orders` | cliente | orders `POST /orders` | JWT; reenvía solo `Idempotency-Key`; 20/min | `svc_token_gateway_orders` |
| S17 | Externo | GET | `/api/v1/orders` | cliente, admin | orders `GET /orders` | paginación `limit ≤ 50`; el filtro por dueño lo pone orders | `svc_token_gateway_orders` |
| S18 | Externo | GET | `/api/v1/orders/{id}` | cliente, admin | orders `GET /orders/{id}` | ajeno → 404 sin datos | `svc_token_gateway_orders` |
| S19 | Externo | POST | `/api/v1/orders/{id}/cancel` | cliente | orders `POST /orders/{id}/cancel` | solo `pendiente_pago`; libera stock | `svc_token_gateway_orders` |
| S20 | Externo | PATCH | `/api/v1/orders/{id}/status` | admin | orders `PATCH /orders/{id}/status` | transiciones válidas (409) | `svc_token_gateway_orders` |
| S21 | Externo | POST | `/api/v1/orders/{id}/payments` | cliente | payments `POST /orders/{id}/payments` | monto fijado por el servidor; 20/min | `svc_token_gateway_payments` |
| S22 | Externo | GET | `/api/v1/payments/{id}` | cliente, admin | payments `GET /payments/{id}` | ajeno → 404 | `svc_token_gateway_payments` |
| S23 | Externo | POST | `/api/v1/payments/webhook` | proveedor (sin JWT) | payments `POST /webhook` | firma HMAC + marca de tiempo en payments; reenvía solo `x-signature` y `x-timestamp`; 60/min | `svc_token_gateway_payments` |
| S24 | Externo | POST | `/api/v1/graphql` | cliente, admin | graphql-gateway `POST /graphql` | JWT; 30/min; límites GraphQL en el servicio | `svc_token_gateway_graphql` |
| — | Interno | GET | *(no publicada)* | solo gateway | auth `GET /internal/tokens/{jti}` | consulta de revocación en cada ruta protegida | `svc_token_gateway_auth` |
| — | Interno | POST/DELETE | *(no publicada)* | solo clients | auth `/internal/credentials...` | crear, activar y compensar credenciales | `svc_token_clients_auth` |
| S06/S07 | Interno | POST/DELETE | *(no publicada)* | solo orders | inventory `/products/{id}/reservations[/{pedidoId}]` | idempotente por pedido | `svc_token_orders_inventory` |
| — | Interno | GET | *(no publicada)* | orders, graphql | inventory `GET /internal/products?ids=` | lote de hasta 50 ids | `svc_token_orders_inventory`, `svc_token_graphql_inventory` |
| — | Interno | GET | *(no publicada)* | solo orders | clients `GET /internal/clients/{id}/addresses/{dir}` | confirma dirección del titular | `svc_token_orders_clients` |
| — | Interno | GET | *(no publicada)* | solo graphql | clients `GET /internal/clients/{id}` | contacto; graphql filtra campos por rol | `svc_token_graphql_clients` |
| — | Interno | GET | *(no publicada)* | payments, graphql | orders `GET /internal/orders/{id}`, `GET /internal/orders?clienteId=` | lectura | `svc_token_payments_orders`, `svc_token_graphql_orders` |
| — | Interno | POST | *(no publicada)* | solo payments | orders `POST /internal/orders/{id}/paid` | monto debe coincidir con el total | `svc_token_payments_orders` |

**Operaciones GraphQL** (S24, todas de lectura; no hay mutations porque las reglas transaccionales viven en orders
y payments): `resumenPedido(id)` y `misPedidos(limite, desde)`. Autorización por recurso (pedido propio) y por
campo (`run` solo admin). Detalle en el Módulo 8.

**gRPC:** no se usa (decisión y medición en el Módulo 9).

## 2. Credencial del usuario vs. credencial entre sistemas

- **Del usuario:** el JWT que el navegador envía en `Authorization`. Llega solo hasta el gateway; **no se
  reenvía** a los servicios.
- **Entre sistemas:** cada tramo usa su propio token de servicio (`x-service-token`). La identidad verificada del
  usuario viaja como contexto (`x-user-id`, `x-user-role`) que solo el gateway puede fijar, y el servicio confía en
  ese contexto únicamente porque el token de servicio prueba que viene del gateway.

## 3. Inventario de secretos (referencias simbólicas, nunca valores)

| Referencia | Tipo | Emisor | Consumidor | Finalidad | Ubicación segura | Alcance | Rotación y revocación |
|---|---|---|---|---|---|---|---|
| `jwt_private_key` | Clave privada ES256 (P-256) | `generar-secretos.js` | auth | Firmar tokens de sesión | Docker secret, solo en auth | Solo firma | `--rotar` y reiniciar; invalida todas las sesiones abiertas |
| `jwt_public_key` | Clave pública ES256 | `generar-secretos.js` | api-gateway | Verificar tokens | Docker secret, solo en gateway | Solo verificación (no sirve para emitir) | Se rota junto con la privada |
| `svc_token_gateway_inventory` | Token de servicio (256 bits) | `generar-secretos.js` | gateway (envía), inventory (verifica) | Probar que la llamada viene del gateway | Docker secret en ambos | Solo rutas de inventory | `--rotar` y reiniciar ambos |
| `svc_token_gateway_clients` | Token de servicio | `generar-secretos.js` | gateway, clients | Ídem para clients | Docker secret en ambos | Solo rutas de clients | Ídem |
| `svc_token_gateway_auth` | Token de servicio | `generar-secretos.js` | gateway, auth | Login, logout y revocación | Docker secret en ambos | auth acepta al gateway solo en `/login`, `/logout`, `/internal/tokens` | Ídem |
| `svc_token_clients_auth` | Token de servicio | `generar-secretos.js` | clients, auth | Crear y activar credenciales | Docker secret en ambos | auth acepta a clients solo en `/internal/credentials...` | Ídem |
| `admin_password` | Contraseña inicial | `generar-secretos.js` | auth (solo al crear la cuenta) | Primera cuenta de administrador | Docker secret, solo en auth | Se guarda como hash; el archivo solo se lee al crear el admin | Cambiar la contraseña y borrar el archivo |
| `MONGO_*_PASSWORD` | Credencial de base de datos | El equipo, en `.env` | Cada servicio y su Mongo | Acceso de la app a **su** base | `.env` (ignorado por git) | Usuario `readWrite` solo sobre la base de ese servicio | Cambiar en `.env` y recrear el volumen |
| `svc_token_gateway_orders` / `_payments` / `_graphql` | Token de servicio | `generar-secretos.js` | gateway y el servicio destino | Probar que la llamada viene del gateway | Docker secret en ambos | Solo rutas de ese servicio | `--rotar` y reiniciar |
| `svc_token_orders_inventory` | Token de servicio | `generar-secretos.js` | orders, inventory | Precios por lote y reservas | Docker secret en ambos | inventory acepta a orders solo en `/internal/products` y reservas; no administra productos | Ídem |
| `svc_token_orders_clients` | Token de servicio | `generar-secretos.js` | orders, clients | Confirmar dirección del titular | Docker secret en ambos | Solo `/internal/clients/{id}/addresses/{dir}` | Ídem |
| `svc_token_payments_orders` | Token de servicio | `generar-secretos.js` | payments, orders | Leer pedido y marcarlo pagado | Docker secret en ambos | Solo `/internal/orders/{id}` y `/paid` | Ídem |
| `svc_token_graphql_{orders,inventory,clients}` | Token de servicio | `generar-secretos.js` | graphql-gateway y cada servicio | Lecturas para agregaciones | Docker secret en ambos | Solo rutas internas de lectura | Ídem |
| `payments_webhook_secret` | Secreto de integración (HMAC) | `generar-secretos.js` (en producción lo entrega el proveedor) | payments y el proveedor | Verificar que el aviso de pago viene del proveedor | Docker secret, solo en payments | Solo avisos de pago; no permite crear cobros | `--rotar`; avisos firmados con el anterior quedan inválidos |
| `mongo_local_*` *(solo modo local)* | Credencial de base de datos | `scripts/local.js` | Cada servicio | Igual que `MONGO_*_PASSWORD` en el arranque sin Docker | `./secrets` (ignorado por git) | readWrite solo sobre la base del servicio | Borrar el archivo y `local-data/` |

**Por qué Docker secrets y no HashiCorp Vault:** el entorno es local y reproducible con Docker Compose. Docker
secrets cumple lo que se exige: los valores no están en el código, ni en el repositorio, ni en variables de entorno
visibles con `docker inspect`, y cada contenedor recibe **solo** los secretos que declara. Vault agregaría un
servicio más (y su propio secreto de arranque) sin cambiar el diseño: `SecretProvider` es una interfaz y se puede
reemplazar por un proveedor de Vault sin tocar las políticas.

## 4. Qué pasa si…

- **Se filtra un token de servicio:** solo abre el tramo para el que fue creado (por ejemplo, clients→auth no
  permite hacer login ni leer inventory). Se ejecuta `generar-secretos.js --rotar` y se reinician los contenedores.
- **Se filtra la clave privada JWT:** se rota el par de claves; todas las sesiones existentes dejan de ser válidas
  porque su firma ya no se verifica con la nueva clave pública.
- **El almacén de secretos no está disponible** (falta un archivo en `./secrets`): el servicio **no arranca**
  (`leerSecreto` lanza un error) en vez de funcionar sin autenticación.
- **Se filtra `payments_webhook_secret`:** alguien podría fabricar avisos de pago. Mitigación: el aviso debe
  coincidir con un cobro existente y con su monto exacto, y orders exige que el monto sea el total del pedido;
  igual se rota el secreto de inmediato (`--rotar`) y se revisan los pagos aprobados en la ventana expuesta.
- **auth no responde:** el gateway rechaza las rutas protegidas con 503 (no deja pasar tokens sin revisar la
  revocación); el catálogo público sigue funcionando.

## 5. Reglas aplicadas

- Ningún secreto en rutas, parámetros de consulta, repositorio, capturas ni logs (el gateway oculta
  `authorization` y `x-service-token` en sus logs).
- El mismo secreto nunca se usa en dos tramos distintos.
- **Arranque sin Docker (`npm run local`):** se usan los mismos archivos de `./secrets`; cada proceso recibe por
  variable de entorno solo la **ruta** de los archivos que necesita. Los servicios internos escuchan solo en
  `127.0.0.1` y, aunque alguien en el mismo equipo llegue a su puerto, sin su token de servicio responden 401
  (prueba P47).
- TLS: en el entorno local el tráfico interno va por una red privada de Docker sin salida externa. En un despliegue
  real, el gateway se publica detrás de HTTPS (proxy inverso con certificado) y los tramos internos usan TLS.
  Esta limitación del entorno local queda declarada.
