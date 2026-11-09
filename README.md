# Fukusuke Sushi Delivery — backend de microservicios

Proyecto de la Unidad 2 (Evaluación 2): backend seguro construido a partir de los datos y eventos del frontend
responsivo de Fukusuke Sushi. La conexión de las pantallas con la API corresponde a la Evaluación 3.

## Estructura

```
frontend/                 Páginas del sitio (Evaluación 1)
services/api-gateway/     API Gateway: único punto público (puerto 8080)
services/auth/            Credenciales, sesiones y tokens JWT (ES256)
services/clients/         Registro, validación de correo, perfil y direcciones
services/inventory/       Catálogo, disponibilidad, stock y reservas
services/orders/          Pedidos, totales, estados e idempotencia
services/payments/        Pagos y aviso firmado del proveedor
services/graphql-gateway/ GraphQL Gateway privado (agregaciones de lectura)
infra/                    Inicialización de las bases de datos (Docker)
scripts/                  Arranque local, secretos, pruebas de seguridad y de carga
docs/                     Informe por módulo, modelo C4, evidencias y mockups
docker-compose.yml        Despliegue reproducible con redes pública y privada
```

## Cómo ejecutarlo

Requisito: **Node.js 20 o superior** (https://nodejs.org, versión LTS). Docker es opcional.

### Opción A: sin Docker

```bash
npm run local
```

Genera los secretos en `./secrets` (muestra la clave del administrador `admin@fukusuke.cl`), instala las
dependencias, descarga y arranca MongoDB 7 con datos persistentes en `local-data/` y levanta los 7 servicios.
El backend queda en **http://localhost:8080**. Detener: `Ctrl+C`.

### Opción B: con Docker

```bash
cp .env.example .env        # en PowerShell: Copy-Item .env.example .env  (y cambiar las contraseñas)
docker run --rm -v "${PWD}:/work" -w /work node:22-alpine node scripts/generar-secretos.js
docker compose up --build
```

Solo el API Gateway queda publicado (`127.0.0.1:8080`). Los servicios y las bases están en una red interna.

### Prueba rápida

- http://localhost:8080/health
- http://localhost:8080/api/v1/products?available=true

Los códigos de verificación de correo quedan en `local-data/correos.log` (modo local) o en
`docker compose logs clients` con la marca `[CORREO-SIMULADO]`.

## Pruebas

| Comando | Qué hace |
|---|---|
| `npm run pruebas` | Pruebas automatizadas de los 7 servicios (no necesita el backend en marcha) |
| `npm run seguridad` | 51 pruebas de integración y ataque contra el backend en marcha; deja la evidencia en `docs/evidencias/resultado-pruebas.md` |
| `npm run carga` | Prueba de carga (arrancar antes con `PRUEBA_CARGA=true npm run local`); reporte en `docs/evidencias/prueba-carga.md` |
| `npm run pago -- <pagoId> <monto>` | Simula el aviso firmado del proveedor de pagos |

## Avances

| Avance | Contenido | Rama |
|---|---|---|
| 7 | Diseño base, servicio `inventory`, borrador del Módulo 1 | `avance-7-diseno-base` |
| 8 | Dominio y sistemas (M2, M3), seguridad y API Gateway (M4, M5, M6): `auth`, `clients`, gateway y secretos | `avance-8-seguridad-gateway` |
| 9 | `orders`, `payments`, GraphQL Gateway, arranque sin Docker, pruebas de seguridad y carga, M7–M10 y modelo C4 | `avance-9-pedidos-pagos-local` |

## Documentación

| Módulo | Archivo |
|---|---|
| 1 Servicios derivados del frontend | `docs/modulo-1-servicios.md` |
| 2 Clases y cardinalidades del dominio | `docs/modulo-2-dominio.md` |
| 3 Sistemas e integraciones | `docs/modulo-3-sistemas.md` |
| 4 Stakeholders y permisos HTTP | `docs/modulo-4-permisos.md` |
| 5 Clases del API Gateway | `docs/modulo-5-gateway.md` |
| 6 Rutas y secretos de integración | `docs/modulo-6-rutas-secretos.md` |
| 7 Datos sensibles y secretos del cliente | `docs/modulo-7-datos.md` |
| 8 Separación privada y GraphQL | `docs/modulo-8-graphql.md` |
| 9 Analítica y gRPC (ADR y carga) | `docs/modulo-9-analitica-grpc.md` |
| 10 Backend completo e integración verificable | `docs/modulo-10-integracion.md` |
| Modelo C4 (Structurizr DSL: C1, C2, C3, dinámicas y despliegue) | `docs/c4/fukusuke.dsl` |
| Evidencias de ejecución | `docs/evidencias/` |

## Seguridad (resumen)

- Secretos en `./secrets` y `.env`, ambos ignorados por git. Cada servicio recibe solo los que usa.
- Una base de datos por servicio, con usuario de permisos mínimos y sin puertos públicos.
- El navegador solo habla con el API Gateway. Cada tramo entre servicios usa su propio token.
- Los precios, totales y estados de pago los decide el servidor, nunca el navegador.
