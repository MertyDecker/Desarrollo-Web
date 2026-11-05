# Fukusuke Sushi Delivery — backend de microservicios

Proyecto de la Unidad 2: backend seguro integrado con el frontend responsivo de Fukusuke Sushi.

## Estructura

```
frontend/              Páginas del sitio (por ahora index.html)
services/api-gateway/  API Gateway: único punto público (puerto 8080)
services/auth/         Autenticación: credenciales, sesiones y tokens JWT
services/clients/      Clientes: registro, validación de correo, perfil y direcciones
services/inventory/    Inventario: catálogo, disponibilidad y stock
infra/                 Inicialización de las bases de datos
scripts/               Generación de secretos locales
docs/                  Informe por módulo, diagramas y mockups
docker-compose.yml     Entorno local reproducible
```

Pendientes: `orders` y `payments` (avance 9), GraphQL Gateway y decisión de gRPC/analítica (avance 10).

## Avances

| Avance | Contenido | Rama |
|---|---|---|
| 7 | Diseño base, servicio `inventory`, borrador del Módulo 1 | `avance-7-diseno-base` |
| 8 | Dominio y sistemas (M2, M3), seguridad y API Gateway (M4, M5, M6): `auth`, `clients`, gateway y secretos | `avance-8-seguridad-gateway` |
| 9 | Pedidos y pagos (`orders`, `payments`), privacidad y pruebas de seguridad (M7) | pendiente |
| 10 | GraphQL Gateway interno (M8), gRPC y analítica (M9) | pendiente |
| 11 | Integración final con el frontend, pruebas y entrega (M10) | pendiente |

## Documentación

| Módulo | Archivo |
|---|---|
| 1 Servicios derivados del frontend | `docs/modulo-1-servicios.md` |
| 2 Clases y cardinalidades del dominio | `docs/modulo-2-dominio.md` |
| 3 Sistemas e integraciones | `docs/modulo-3-sistemas.md` |
| 4 Stakeholders y permisos HTTP | `docs/modulo-4-permisos.md` |
| 5 Clases del API Gateway | `docs/modulo-5-gateway.md` |
| 6 Rutas y secretos de integración | `docs/modulo-6-rutas-secretos.md` |

## Cómo ejecutarlo

Requisitos: Docker Desktop. Node.js solo hace falta para correr las pruebas fuera de Docker.

**1. Configuración** (una sola vez):

```bash
cp .env.example .env        # en PowerShell: Copy-Item .env.example .env
# Edita .env y cambia las contraseñas de ejemplo.
```

**2. Secretos** (una sola vez; quedan en `./secrets`, que no se sube a GitHub):

```bash
docker run --rm -v "${PWD}:/work" -w /work node:22-alpine node scripts/generar-secretos.js
```

Muestra la contraseña del administrador (`admin@fukusuke.cl`); también queda en `secrets/admin_password.txt`.

**3. Arranque:**

```bash
docker compose up --build
```

Solo el API Gateway queda publicado, en `http://localhost:8080`. Los servicios internos y las bases de datos no
tienen puertos abiertos.

**4. Prueba rápida** (otra terminal; en Windows usa `curl.exe`):

```bash
curl http://localhost:8080/health
curl "http://localhost:8080/api/v1/products?available=true"
```

Para registrarse: `POST /api/v1/clients`. El código de verificación aparece en los logs de `clients` con la marca
`[CORREO-SIMULADO]` (`docker compose logs clients`), porque en local no hay proveedor de correo real.

Para detener: `Ctrl+C` y luego `docker compose down`. Para borrar también los datos: `docker compose down -v`.

## Pruebas

Cada servicio tiene sus pruebas automatizadas:

```bash
cd services/<servicio>
npm ci
npm test
```

## Seguridad

- Los secretos viven en `./secrets` y `.env`, ambos ignorados por git. Solo `.env.example`, con valores de ejemplo, está en el repositorio.
- La base de datos de cada servicio no publica puertos y solo la usa ese servicio.
- Los servicios internos no se exponen al navegador: el único punto público es el API Gateway.
- Cada par de servicios usa su propio token; los tokens de sesión se firman con ES256 (clave privada solo en auth).
