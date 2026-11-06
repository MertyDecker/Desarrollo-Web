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
| — | Interno | GET | *(no publicada)* | solo gateway | auth `GET /internal/tokens/{jti}` | consulta de revocación en cada ruta protegida | `svc_token_gateway_auth` |
| — | Interno | POST/DELETE | *(no publicada)* | solo clients | auth `/internal/credentials...` | crear, activar y compensar credenciales | `svc_token_clients_auth` |

Las rutas de pedidos, pagos, GraphQL (`POST /graphql`, con autorización por operación y campo) y, si aplica,
gRPC se agregan a esta matriz en los avances 9 y 10.

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
| Clave del proveedor de pagos *(avance 9)* | Secreto de integración | Proveedor | Solo payments | Verificar avisos y crear cobros | Docker secret, solo en payments | Solo la cuenta de comercio de prueba | Según el proveedor |

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
- **auth no responde:** el gateway rechaza las rutas protegidas con 503 (no deja pasar tokens sin revisar la
  revocación); el catálogo público sigue funcionando.

## 5. Reglas aplicadas

- Ningún secreto en rutas, parámetros de consulta, repositorio, capturas ni logs (el gateway oculta
  `authorization` y `x-service-token` en sus logs).
- El mismo secreto nunca se usa en dos tramos distintos.
- TLS: en el entorno local el tráfico interno va por una red privada de Docker sin salida externa. En un despliegue
  real, el gateway se publica detrás de HTTPS (proxy inverso con certificado) y los tramos internos usan TLS.
  Esta limitación del entorno local queda declarada.
