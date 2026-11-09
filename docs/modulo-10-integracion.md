# Módulo 10 — Backend completo e integración verificable

## 1. Qué se entrega

| Componente | Ubicación | Estado |
|---|---|---|
| API Gateway (único punto público) | `services/api-gateway` | Implementado y probado |
| Auth Service | `services/auth` | Implementado y probado |
| Administrador de secretos | `./secrets` vía Docker secrets (o archivos con el arranque local) — decisión en el Módulo 6 | Implementado |
| GraphQL Gateway privado | `services/graphql-gateway` | Implementado y probado |
| Microservicios privados | `services/inventory`, `clients`, `orders`, `payments` | Implementados y probados |
| Persistencia | Una base MongoDB 7 por servicio, con usuario de mínimo privilegio | Implementada |
| Despliegue reproducible | `docker-compose.yml` (redes pública y privada) **o** `npm run local` (sin Docker) | Implementado |
| Adaptadores de prueba | Correo (`[CORREO-SIMULADO]` + `local-data/correos.log`) y proveedor de pagos (`scripts/simular-pago.js`) | Implementados |
| Frontend | `frontend/` (Evaluación 1). La conexión de pantallas con la API corresponde a la Evaluación 3, según lo indicado por el docente | — |

## 2. Cómo iniciar, detener y probar

Requisito: **Node.js 20 o superior** (https://nodejs.org, versión LTS). Docker es opcional.

### Opción A: sin Docker (recomendada para revisar)

```bash
npm run local
```

La primera vez instala las dependencias de cada servicio, genera los secretos en `./secrets` (muestra la clave del
administrador) y descarga el motor oficial de MongoDB 7 (~70 MB). Deja el backend en **http://localhost:8080**.
Los datos se guardan en `local-data/mongo` y se conservan entre reinicios. **Detener:** `Ctrl+C`. **Empezar de
cero:** borrar la carpeta `local-data`.

### Opción B: con Docker

```bash
cp .env.example .env            # cambiar las contraseñas de ejemplo
docker run --rm -v "${PWD}:/work" -w /work node:22-alpine node scripts/generar-secretos.js
docker compose up --build
```

Solo el gateway publica un puerto (`127.0.0.1:8080`); los servicios y las 5 bases están en la red `private`
(`internal: true`). **Detener:** `docker compose down` (con `-v` borra los datos).

### Referencias de secretos y configuración

- Secretos: `scripts/generar-secretos.js` crea en `./secrets` las claves JWT, los 13 tokens de servicio, el
  secreto del proveedor de pagos y la clave inicial del administrador (`admin@fukusuke.cl`). Cada servicio recibe
  solo la **ruta** de los archivos que necesita (`*_FILE`). `--rotar` los regenera.
- Configuración sin valores reales: `.env.example`. `secrets/`, `.env` y `local-data/` están en `.gitignore`.

### Datos de prueba

- inventory carga al iniciar 6 productos ficticios de los mockups (Dragon Roll, Salmon Nigiri…), sin pisar los
  existentes (`SEED_ON_START`).
- auth crea la cuenta de administrador la primera vez.
- Los clientes, pedidos y pagos los crea `npm run seguridad` con datos ficticios (RUN válidos generados).

### Pruebas

| Comando | Qué ejecuta | Necesita el backend corriendo | Resultado de esta entrega |
|---|---|---|---|
| `npm run pruebas` | Pruebas automatizadas de los 7 servicios (contratos, reglas, permisos) | No | **87/87** aprobadas |
| `npm run seguridad` | 51 pruebas de integración y ataque contra el backend real | Sí | **51/51** — [`evidencias/resultado-pruebas.md`](evidencias/resultado-pruebas.md) |
| `npm run carga` | Prueba de carga (iniciar con `PRUEBA_CARGA=true`) | Sí | 4/4 escenarios cumplen — [`evidencias/prueba-carga.md`](evidencias/prueba-carga.md) |
| `npm run pago -- <pagoId> <monto>` | Simula el aviso firmado del proveedor de pagos | Sí | — |

## 3. Persistencia

| Servicio | Base | Colecciones | Índices y restricciones | Creación |
|---|---|---|---|---|
| inventory | `inventory_db` | `productos`, `reservas` | nombre único; (productoId, pedidoId) único; `stock ≥ 0`, `precio ≥ 1` | Esquemas Mongoose (`src/repo.mongo.js`) + `Model.init()` al arrancar + seed |
| clients | `clients_db` | `clientes` | RUN único, correo único | Ídem |
| auth | `auth_db` | `credencials`, `tokenrevocados` | clienteId y correo únicos; TTL sobre `expira` | Ídem + admin inicial |
| orders | `orders_db` | `pedidos` | (clienteId, idempotencyKey) único; estado en lista cerrada | Ídem |
| payments | `payments_db` | `pagos`, `eventopagos` | un solo pago `pendiente` por pedido (índice único parcial); `eventoId` único | Ídem |

Usuarios: `infra/mongo/init-app-user.sh` (Docker) o `scripts/local.js` (sin Docker) crean un usuario por base con
rol `readWrite` solo sobre esa base. Ningún servicio comparte base ni credenciales.

## 4. Contratos

- **REST:** catálogo completo S01–S24 con entradas, salidas y errores en el Módulo 1. Rutas, accesos y credenciales
  en el Módulo 6. Fuente de verdad ejecutable: `services/api-gateway/src/routes.js` y los esquemas JSON de cada
  `src/app.js` (Fastify valida entradas y serializa solo los campos declarados).
- **GraphQL:** `services/graphql-gateway/src/schema.graphql` (Módulo 8).
- **gRPC:** no aplica (ADR-001, Módulo 9).

## 5. Operación: health checks y logs

- Cada servicio expone `GET /health`. Docker los usa en `HEALTHCHECK` y `depends_on: service_healthy`;
  `npm run local` espera a que cada uno responda antes de iniciar el siguiente.
- **Correlación:** el gateway asigna `x-request-id` (o respeta el recibido), lo reenvía a cada servicio y lo
  devuelve al navegador. Aparece en los logs de todos los procesos (`local-data/logs/*.log` o
  `docker compose logs`) y en la evidencia de pruebas.
- **Sin credenciales ni datos personales innecesarios en logs:** se ocultan `authorization`, `x-service-token` y
  `x-signature`; no se registran cuerpos de solicitudes.
- Versiones de dependencias: fijadas en cada `package-lock.json`; Node ≥ 20; imágenes `node:22-alpine` y `mongo:7`.

## 6. Matriz requisito | pantalla | servicio | prueba | resultado | evidencia

| Requisito | Pantalla | Servicio(s) | Prueba | Resultado | Evidencia |
|---|---|---|---|---|---|
| R01 Ver menú con precio y disponibilidad | P01 Menú | S01, S02 · inventory | P01, P02; `inventory/test/products.test.js` | ✅ | resultado-pruebas P01 |
| R02 Registrarse con datos validados | P02 Crear cuenta | S08 · clients + auth | P03, P06, P07; `clients/test` | ✅ | P03, P06, P07 |
| R03 Validar correo con código | P02 | S09 · clients + auth | P04 | ✅ | P04 |
| R04 Sesión con expiración y cierre | P04 Iniciar sesión | S10, S11 · auth + gateway | P05, P08, P10, P12–P14, P50, P51 | ✅ | P05–P14, P50, P51 |
| R05 Carrito → pedido con totales del servidor | P03 Carrito | S16 · orders + inventory + clients | P19–P22, P25, P26 | ✅ | P19–P26 |
| R05 Reintento sin duplicar | P03 | S16 (Idempotency-Key) | P20; `orders/test` | ✅ | P20 |
| R05 Recuperación de stock | P03, P05 | S06, S07, S19 | P25–P27; `inventory/test/reservations.test.js` | ✅ | P25–P27 |
| R06 Envío gratis ≤ 3 km y empaque $1.200 | P03 | S16 · orders | P19 (Providencia: envío 0), P25 (Maipú: $2.990) | ✅ | P19, P25 |
| R07 Pago; solo el servidor decide que está pagado | P03 Pagar | S21–S23 · payments + orders | P28–P36; `payments/test` | ✅ | P28–P36 |
| R07 Pagos duplicados | P03 | S21, S23 | P34, P35 | ✅ | P34, P35 |
| R08 Mis pedidos, solo propios | P05 | S17, S18 · orders | P23, P24 | ✅ | P23, P24 |
| R08 Resumen agregado | P05 | S24 · graphql-gateway | P40–P45; fallas paso 3 | ✅ | P40–P45, fallas-dependencias |
| R08 Estados del pedido (cocina/despacho) | P06 Admin | S20 · orders | P37–P39 | ✅ | P37–P39 |
| R09 Administrar productos | P06 Admin | S03–S05 · inventory | P15–P18; `inventory/test` | ✅ | P15–P18 |
| Seguridad: acceso directo y rutas internas | — | Red privada + tokens de servicio | P46, P47 | ✅ | P46, P47 |
| Indisponibilidad de dependencias | — | Gateway, orders, graphql | Ejecución con servicios congelados | ✅ | fallas-dependencias |
| Carga | P01, P03, P05 | Todos | `npm run carga` | ✅ | prueba-carga |

## 7. Demostración de los flujos principales

Guía manual paso a paso con PowerShell (POST/GET reales y resultado esperado de cada uno):
[`docs/guia-demostracion.md`](guia-demostracion.md). Modelo C4 con las vistas dinámicas F01–F04 enlazadas a estas
pruebas: [`docs/c4/fukusuke.dsl`](c4/fukusuke.dsl) (abrir en https://structurizr.com/dsl).

El orden de `npm run seguridad` es la demostración: visitante → registro → validación → login → pedido →
reintento → pago firmado → estados → GraphQL → ataques. Cada fila de la evidencia indica la solicitud, el código
obtenido y su `x-request-id`.

**Ejemplo de la regla de autorización (pedido protegido),** con la misma regla y el mismo servicio:

| Ejecución | Identidad | Solicitud | Resultado | Regla aplicada | Servicio |
|---|---|---|---|---|---|
| Autorizada (P23) | Cliente A, titular | `GET /api/v1/orders/{idDeA}` | 200 con el pedido | `pedido.clienteId === x-user-id` o rol admin | orders (`puedeVer`) |
| Denegada (P24) | Cliente B, otra cuenta | `GET /api/v1/orders/{idDeA}` | 404 sin datos (igual que si no existiera) | la misma | orders (`puedeVer`) |

## 8. Brechas y limitaciones declaradas

- **Frontend sin conectar:** fuera del alcance de esta evaluación según el docente; se hace en la Evaluación 3.
- **Proveedores externos:** Webpay/Servipag y el correo no son accesibles desde el entorno local. Se usan
  adaptadores de prueba que conservan el contrato, la autenticación (firma HMAC) y las transiciones.
- **TLS:** no se usa en local (Módulo 6).
- **Eliminación de cuenta por el titular:** diseñada, no implementada (Módulo 7 §4).
- **Docker Compose:** el archivo incluye los 12 contenedores. La verificación de ejecución de esta entrega se
  hizo con `npm run local`, que usa el mismo código, los mismos secretos y MongoDB 7.
