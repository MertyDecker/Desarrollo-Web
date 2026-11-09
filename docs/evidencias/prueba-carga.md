# Reporte de prueba de carga

Ejecutado: 2026-11-09T02:51:03.463Z · comando `npm run carga` (backend arrancado con `PRUEBA_CARGA=true npm run local`).

**Entorno:** Linux 6.18.44-fc-v310 (x64); 2 x Intel(R) Xeon(R) Processor @ 2.10GHz; 7.8 GB RAM; Node 22.23.4; arranque local (npm run local), MongoDB 7 con persistencia en disco. Generador de carga y backend en el mismo equipo; la latencia incluye ese costo.

**Tipo de dato:** las cifras de esta tabla son **mediciones**. La demanda contra la que se comparan es una **proyección** (ver Módulo 9).

| Escenario | Concurrencia | Duración (s) | Solicitudes | Throughput (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | Errores | Objetivo | ¿Cumple? |
|---|---|---|---|---|---|---|---|---|---|---|
| catalogo | 20 | 20 | 19190 | 960.1 | 17.8 | 42.8 | 63.9 | 0% | p95 ≤ 300 ms, ≥ 50 req/s, < 1% errores | ✅ |
| pedidoRest | 10 | 15 | 6776 | 451.5 | 20.2 | 38.2 | 54.9 | 0% | p95 ≤ 500 ms, ≥ 20 req/s, < 1% errores | ✅ |
| resumenGraphql | 10 | 15.1 | 3003 | 199.1 | 47.3 | 77.6 | 104 | 0% | p95 ≤ 800 ms, ≥ 10 req/s, < 1% errores | ✅ |
| crearPedido | 5 | 10 | 1307 | 130.4 | 36.7 | 56.1 | 85.5 | 0% | p95 ≤ 1000 ms, ≥ 2 req/s, < 1% errores | ✅ |

## CPU y memoria por proceso (procesos con CPU > 1%)

| Escenario | Consumo |
|---|---|
| catalogo | auth: CPU prom 0.1% / máx 2%, mem máx 132.2 MB<br>inventory: CPU prom 62.4% / máx 88%, mem máx 207.5 MB<br>clients: CPU prom 0.1% / máx 2%, mem máx 87.6 MB<br>orders: CPU prom 0.1% / máx 2%, mem máx 100 MB<br>payments: CPU prom 0.1% / máx 2%, mem máx 82.4 MB<br>api-gateway: CPU prom 53.9% / máx 66%, mem máx 195.5 MB |
| pedidoRest | auth: CPU prom 36.6% / máx 60%, mem máx 171.6 MB<br>inventory: CPU prom 0.8% / máx 21.2%, mem máx 207.5 MB<br>clients: CPU prom 0.1% / máx 2%, mem máx 87.6 MB<br>orders: CPU prom 39.4% / máx 62%, mem máx 142.5 MB<br>payments: CPU prom 0.1% / máx 2%, mem máx 82.7 MB<br>api-gateway: CPU prom 53.1% / máx 66%, mem máx 207.8 MB |
| resumenGraphql | auth: CPU prom 11.4% / máx 18.9%, mem máx 174.2 MB<br>inventory: CPU prom 13.2% / máx 18%, mem máx 207.8 MB<br>clients: CPU prom 21.9% / máx 29.4%, mem máx 113.7 MB<br>orders: CPU prom 13.2% / máx 24.5%, mem máx 142.3 MB<br>payments: CPU prom 0.1% / máx 2%, mem máx 83.1 MB<br>graphql-gateway: CPU prom 50.7% / máx 82.4%, mem máx 193.5 MB<br>api-gateway: CPU prom 33.6% / máx 44%, mem máx 213.7 MB |
| crearPedido | auth: CPU prom 8.3% / máx 12%, mem máx 174.2 MB<br>inventory: CPU prom 33.2% / máx 38%, mem máx 209.2 MB<br>clients: CPU prom 14.1% / máx 41.2%, mem máx 117.1 MB<br>orders: CPU prom 55.1% / máx 68%, mem máx 193.2 MB<br>payments: CPU prom 0.2% / máx 2%, mem máx 83.2 MB<br>graphql-gateway: CPU prom 2.7% / máx 29.4%, mem máx 193.8 MB<br>api-gateway: CPU prom 24.9% / máx 32%, mem máx 214.2 MB |

## Códigos HTTP

- **catalogo:** 200 × 19190
- **pedidoRest:** 200 × 6776
- **resumenGraphql:** 200 × 3003
- **crearPedido:** 201 × 1307
