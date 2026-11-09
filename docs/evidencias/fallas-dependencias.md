# Evidencia: fallas de dependencias y recuperación

Ejecutado: 2026-11-09T02:55:16.263Z con el backend en marcha (`npm run local`). Se **congeló** el proceso de un servicio (señal SIGSTOP: el puerto sigue abierto pero no responde, el peor caso para un cliente HTTP) y luego se reanudó (SIGCONT). Datos ficticios.

| Paso | Solicitud | HTTP | Tiempo | Resultado observado | x-request-id |
|---|---|---|---|---|---|
| 1. GraphQL con todo funcionando | `POST /api/v1/graphql resumenPedido` | 200 | 69 ms | Respuesta completa: estado (orders) + descripción de productos (inventory). | req-8 |
| 2. inventory congelado: catálogo | `GET /api/v1/products` | 504 | 5007 ms | El gateway corta a los 5 s y responde error controlado, sin datos falsos ni detalles internos. | req-9 |
| 3. inventory congelado: GraphQL (respuesta parcial) | `POST /api/v1/graphql resumenPedido` | 200 | 2024 ms | Respuesta parcial identificada: datos de orders presentes, `producto: null`, errores con código `DEPENDENCIA_NO_DISPONIBLE` y `extensions.parcial: true`. Plazo de 2 s por dependencia. | req-a |
| 4. inventory congelado: nuevo pedido | `POST /api/v1/orders` | 502 | 3024 ms | orders no crea pedidos sin poder reservar stock (responde 503; el gateway lo entrega como 502 "Servicio no disponible"). No queda pedido a medias. | req-b |
| 5. inventory congelado: mis pedidos (no depende de inventory) | `GET /api/v1/orders` | 200 | 15 ms | Las operaciones que no dependen de inventory siguen funcionando. | req-c |
| 6. inventory restaurado: reintento del catálogo | `GET /api/v1/products` | 200 | 7 ms | Al reintentar tras restaurar inventory, el catálogo vuelve sin intervención. | req-d |
| 7. inventory restaurado: GraphQL completo otra vez | `POST /api/v1/graphql resumenPedido` | 200 | 20 ms | GraphQL vuelve a entregar la respuesta completa. | req-e |
| 8. auth congelado: ruta protegida (falla cerrado) | `GET /api/v1/orders` | 503 | 5003 ms | Falla cerrado: si no se puede comprobar la revocación de la sesión, no se deja pasar (503). | req-f |
| 9. auth congelado: catálogo público sigue disponible | `GET /api/v1/products` | 200 | 6 ms | El catálogo público no depende de auth y sigue disponible. | req-g |
| 10. auth restaurado | `GET /api/v1/orders` | 200 | 11 ms | Recuperación automática al volver auth. | req-h |

## Respuesta parcial de GraphQL (paso 3)

```json
{
  "data": {
    "resumenPedido": {
      "id": "e17fcdc3-a7f6-412b-9383-daadac93b43e",
      "estado": "pendiente_pago",
      "total": 16180,
      "items": [
        {
          "nombreAlComprar": "California Roll",
          "producto": null
        },
        {
          "nombreAlComprar": "Dragon Roll",
          "producto": null
        }
      ]
    }
  },
  "errors": [
    {
      "message": "Inventario no disponible: la descripción del producto no se pudo obtener.",
      "path": [
        "resumenPedido",
        "items",
        0,
        "producto"
      ],
      "extensions": {
        "code": "DEPENDENCIA_NO_DISPONIBLE"
      }
    },
    {
      "message": "Inventario no disponible: la descripción del producto no se pudo obtener.",
      "path": [
        "resumenPedido",
        "items",
        1,
        "producto"
      ],
      "extensions": {
        "code": "DEPENDENCIA_NO_DISPONIBLE"
      }
    }
  ],
  "extensions": {
    "parcial": true
  }
}
```
