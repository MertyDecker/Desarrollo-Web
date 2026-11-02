# Fukusuke Sushi Delivery — backend de microservicios

Proyecto de la Unidad 2: backend seguro integrado con el frontend responsivo de Fukusuke Sushi.

## Estructura

```
frontend/            Páginas del sitio (por ahora index.html)
services/inventory/  Microservicio de inventario (Fastify + MongoDB)
infra/               Scripts de infraestructura (inicialización de bases de datos)
docs/                Informe, matrices y mockups
docker-compose.yml   Entorno local reproducible
```

Los demás microservicios (`clients`, `orders`, `payments`), el servicio de autenticación, el API Gateway y el
GraphQL Gateway se agregan en los siguientes avances.

## Avances

| Avance | Contenido | Rama |
|---|---|---|
| 7 | Diseño base, servicio `inventory`, borrador del Módulo 1 | `avance-7-diseno-base` |
| 8 | Seguridad y gateway (autenticación, permisos, rutas, secretos) | pendiente |
| 9 | Privacidad, pedidos, pagos y agregación GraphQL | pendiente |
| 10 | Analítica y gRPC (ADR y mediciones) | pendiente |
| 11 | Integración final con el frontend, pruebas y entrega | pendiente |

## Cómo ejecutarlo

Requisitos: Docker Desktop. (Node.js solo es necesario para ejecutar las pruebas sin Docker.)

```bash
cp .env.example .env        # en PowerShell: Copy-Item .env.example .env
# Edita .env y cambia las contraseñas de ejemplo.
docker compose up --build
```

Prueba rápida (otra terminal; en Windows usa `curl.exe`):

```bash
curl http://localhost:3001/health
curl "http://localhost:3001/products?available=true"
```

Para detener: `Ctrl+C` y luego `docker compose down`. Para borrar también los datos: `docker compose down -v`.

## Pruebas

```bash
cd services/inventory
npm ci
npm test
```

## Seguridad

- Los secretos viven en `.env` (ignorado por git). Solo `.env.example`, con valores de ejemplo, está en el repositorio.
- La base de datos de cada servicio no publica puertos y solo la usa ese servicio.
- Los servicios internos no se expondrán al navegador: el único punto público será el API Gateway.
