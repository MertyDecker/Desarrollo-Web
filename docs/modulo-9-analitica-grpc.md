# Módulo 9 — Analítica y comunicación gRPC

## 1. Caracterización de la carga

**Proyección (no es una medición de producción):** Fukusuke es un local de sushi delivery con un solo local y
despacho en un radio cercano. Se proyecta un pico de viernes en la noche de **~50 personas navegando a la vez**,
**~60 pedidos por hora** (1 por minuto) y unos **200 pedidos al día**.

| Necesidad | Volumen proyectado | Concurrencia en el pico | Tamaño de mensaje | Frecuencia | Latencia esperada | ¿Streaming? |
|---|---|---|---|---|---|---|
| Ver catálogo (P01) | ~10 solicitudes/s en el pico (50 personas × 1 cada 5 s) | 50 | ~2 KB (6–30 productos) | Muy alta | p95 ≤ 300 ms | No |
| Consultar un pedido (P05) | ~1 solicitud/s (seguimiento) | 20 | ~1 KB | Media | p95 ≤ 500 ms | No (el estado cambia 4–5 veces por pedido; basta consultar) |
| Resumen GraphQL (P05) | ~1 solicitud/s | 10 | ~1–2 KB | Media | p95 ≤ 800 ms | No |
| Confirmar pedido (P03) | 1 por minuto | 5 | < 1 KB | Baja | p95 ≤ 1000 ms | No |
| Llamadas internas orders → inventory | 2–11 por pedido (1 lectura por lote + 1 reserva por producto) | 5 | < 1 KB | Baja | < 100 ms | No |
| Reportes del dueño | 1 vez al día | 1 | 200 pedidos/día ≈ 6.000 al mes | Diaria | Segundos | No |

Datos: ~200 pedidos/día × ~1 KB ≈ **0,2 MB/día, ~75 MB/año**. Es un volumen pequeño para una base transaccional.

## 2. Medición (prueba de carga reproducible)

`npm run carga` (backend iniciado con `PRUEBA_CARGA=true npm run local`). Reporte completo, con CPU y memoria por
proceso: [`docs/evidencias/prueba-carga.md`](evidencias/prueba-carga.md).

**Entorno de la medición:** Linux x64, 2 vCPU Intel Xeon 2,1 GHz, 7,8 GB RAM, Node 22, MongoDB 7 con persistencia
en disco, los 7 servicios + Mongo + el generador de carga **en el mismo equipo** (es el peor caso: compiten por las
mismas 2 CPU). Todas las solicitudes pasan por el API Gateway con JWT, revocación y límites (estos últimos
multiplicados solo para que una sola IP pueda generar la carga).

| Escenario | Concurrencia | Duración | Solicitudes | Throughput | p95 | p99 | Errores | Objetivo | ¿Cumple? |
|---|---|---|---|---|---|---|---|---|---|
| Catálogo `GET /products` | 20 | 20 s | 19.190 | **960 req/s** | **43 ms** | 64 ms | 0 % | p95 ≤ 300 ms, ≥ 50 req/s | ✅ (19× el throughput, 7× más rápido) |
| Pedido `GET /orders/{id}` | 10 | 15 s | 6.776 | 452 req/s | 38 ms | 55 ms | 0 % | p95 ≤ 500 ms, ≥ 20 req/s | ✅ |
| GraphQL `resumenPedido` (3 servicios) | 10 | 15 s | 3.003 | 199 req/s | 78 ms | 104 ms | 0 % | p95 ≤ 800 ms, ≥ 10 req/s | ✅ |
| Crear pedido (reserva de stock incluida) | 5 | 10 s | 1.307 | 130 pedidos/s | 56 ms | 86 ms | 0 % | p95 ≤ 1000 ms, ≥ 2 req/s | ✅ (≈ 7.800× la demanda de 1/min) |

**Recursos medidos:** el proceso más exigido fue inventory durante el catálogo (CPU promedio 62 %, memoria
máxima 208 MB) y el API Gateway (54 %, 196 MB). Ningún proceso superó los 215 MB. Detalle por proceso y escenario
en el reporte.

**Fallas y desconexiones** (`docs/evidencias/fallas-dependencias.md`): con inventory sin responder, el gateway
corta a los 5 s (504), GraphQL entrega una respuesta parcial identificada en ~2 s, orders no crea pedidos (sin
pedidos a medias) y todo se recupera solo al volver el servicio. Con auth caído, las rutas protegidas fallan
cerradas (503) y el catálogo sigue disponible.

## 3. Matriz de necesidades

| Necesidad candidata | ¿Hay procesamiento intensivo? | ¿Hay streaming? | ¿Lo justifica la carga? | Decisión |
|---|---|---|---|---|
| Servicio de analítica separado (ventas por día, productos más pedidos) | No: 6.000 pedidos al mes se agregan en milisegundos | No | No | **No aplica**. El administrador usa `GET /api/v1/orders?estado=…` (paginado) |
| gRPC orders → inventory (reservas) | No: < 1 KB, 2–11 llamadas por pedido, 1 pedido por minuto | No | No: creación de pedido p95 56 ms con REST | **No aplica** |
| gRPC streaming para seguimiento de despacho | No | Lo sería si hubiera GPS en vivo; el caso solo tiene 5 estados | No | **No aplica**; el cliente consulta `GET /orders/{id}` o `misPedidos` |
| Big data / colas | No | No | No | **No aplica** |

## 4. ADR-001: Sin servicio de analítica ni gRPC en esta versión

**Estado:** aceptada (8 de noviembre de 2026).

**Contexto.** El caso exige separar la analítica y las cargas de alta demanda **si corresponden**, e implementar
gRPC cuando haya procesamiento intensivo o streaming que lo justifique. Fukusuke tiene un solo local, ~200 pedidos
diarios proyectados, mensajes pequeños, un ciclo de vida de 5 estados sin seguimiento en tiempo real y un reporte
diario para el dueño. Las llamadas internas son pocas y de bajo volumen.

**Alternativas consideradas.**

1. **gRPC unary entre orders e inventory**, con contrato `.proto` (`ReservarStock`, `LiberarReserva`), TLS mutuo y
   deadlines. *A favor:* contrato tipado y binario. *En contra:* otro protocolo, generación de código y
   certificados que mantener, para 1 pedido por minuto; no cambia la regla de negocio (el descuento atómico en
   MongoDB). Con REST la creación ya mide p95 56 ms a 130 pedidos/s.
2. **gRPC server streaming para el estado del despacho.** *A favor:* actualizaciones al instante. *En contra:* el
   navegador no habla gRPC directamente (exigiría gRPC-Web o un adaptador SSE); el pedido cambia de estado 4–5 veces
   en ~45 minutos, así que consultar periódicamente basta.
3. **Servicio de analítica con su propia base** (réplica de pedidos, actualización cada noche). *A favor:* separa
   las consultas pesadas de las transacciones. *En contra:* no hay consultas pesadas; duplicaría datos personales en
   otra base (más superficie que proteger, Módulo 7) sin beneficio medible.
4. **REST/JSON interno con contratos explícitos, batching y tokens por tramo** (implementado).

**Decisión.** Alternativa 4. No se implementa servicio de analítica ni gRPC. Las colaboraciones internas usan REST
con token de servicio por tramo, plazos máximos (2–5 s), idempotencia donde hay efectos (reservas por `pedidoId`,
pedidos por `Idempotency-Key`, avisos de pago por `eventoId`) y batching para evitar llamadas por ítem.

**Evidencia de que la alternativa satisface la carga:** sección 2. Todos los escenarios cumplen su objetivo con
0 % de errores y con margen de 7× a 19× sobre la demanda proyectada, en un equipo de 2 vCPU que además generaba la
carga. Se puede reproducir con `npm run carga`.

**Consecuencias.**

- *Positivas:* menos componentes, protocolos y certificados que asegurar; un solo estilo de contrato en el
  backend; datos personales en un solo custodio.
- *Negativas / riesgos:* si el negocio crece (varios locales, miles de pedidos diarios o seguimiento GPS), REST
  por pedido y los reportes sobre la base transaccional dejarán de bastar.
- *Cuándo revisar esta decisión* (disparadores medibles): p95 de creación de pedido > 500 ms sostenido; más de
  50 pedidos por minuto; requisito de seguimiento en vivo del repartidor; reportes que tarden más de 5 s.
- *Cómo se agregaría sin rehacer el diseño:* orders ya usa un adaptador (`src/upstreams.js`), que se puede
  reemplazar por un cliente gRPC sin tocar las reglas de negocio. Un servicio de analítica leería una réplica o
  eventos de orders (pedidos anonimizados: comuna en vez de dirección, sin RUN) y GraphQL lo consultaría como otro
  conector, igual que hoy consulta orders.
