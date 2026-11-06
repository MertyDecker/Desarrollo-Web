# Módulo 3 — Sistemas e integraciones

## 1. Matriz de sistemas

Cada sistema es un microservicio privado con su **propia base de datos**. Ningún servicio lee la base de otro:
colaboran solo por contratos HTTP en la red privada, autenticados con un token de servicio por cada par.

| Sistema | Responsabilidad | Datos que administra (autoridad) | Servicios | Dependencias | Contrato de integración | Credencial requerida | Respuesta ante fallos |
|---|---|---|---|---|---|---|---|
| **inventory** | Catálogo, disponibilidad y stock | Producto (precio oficial, stock, estado) | S01–S05; S06–S07 internos | — | REST interno `/products` | `svc_token_gateway_inventory` (gateway); en el avance 9 se suma uno para orders | Si cae: el catálogo responde 502 en el gateway; orders no acepta pedidos nuevos |
| **clients** | Registro, perfil y direcciones | Cliente, Direccion, CodigoVerificacion | S08, S09, S12–S15 | auth (crear y activar credencial) | REST interno `/clients/...` | `svc_token_gateway_clients`; usa `svc_token_clients_auth` hacia auth | Si auth no responde durante el registro, se deshace el cliente creado (compensación) y responde 503 |
| **auth** | Credenciales, sesiones y tokens | Credencial (hash, rol, estado), TokenRevocado | S10, S11, internos de credenciales y revocación | — | REST interno `/login`, `/logout`, `/internal/...` | `svc_token_gateway_auth`, `svc_token_clients_auth`; firma con `jwt_private_key` | Si cae: el gateway rechaza rutas protegidas con 503 (falla cerrado); el catálogo público sigue funcionando |
| **orders** *(avance 9)* | Creación y ciclo de vida del pedido | Pedido, DetallePedido (estado oficial del pedido) | S16–S20 | inventory (reservar stock) | REST interno `/orders` | token gateway→orders; token orders→inventory | Si inventory no responde: no confirma el pedido (no se arriesga a vender sin stock) |
| **payments** *(avance 9)* | Inicio de pago y verificación del aviso del proveedor | Pago (estado del pago) | S21–S23 | orders (marcar pagado), proveedor de pagos | REST interno `/payments`; aviso firmado del proveedor | token gateway→payments; clave del proveedor (solo payments) | Aviso duplicado: idempotente por id de transacción; aviso con firma inválida: 401 |
| **api-gateway** | Único punto público; autenticación, autorización, rutas | Ninguno (solo configuración) | Todas las rutas externas | inventory, clients, auth | Tabla de rutas `routes.js` | `jwt_public_key` y un token por cada destino | Servicio lento 504, caído 502, sin detalles internos |
| Correo *(externo)* | Enviar el código de verificación | — | S08 | — | Adaptador `mailer.js` | En local: adaptador de prueba sin credencial | Si falla el envío, el registro queda pendiente y el error se registra |
| Webpay / Servipag *(externo, avance 9)* | Cobro | Transacción en el proveedor | S21, S23 | — | Adaptador de prueba que preserva el contrato | Clave del comercio (solo payments) | Ver payments |

**Quién decide el estado oficial:** precio y stock → inventory; datos personales → clients; rol y validez de
la sesión → auth; estado del pedido → orders; estado del pago → payments (nunca el navegador).

## 2. Mapa de componentes

```mermaid
flowchart LR
    subgraph Internet
      N[Navegador<br/>frontend responsivo]
    end
    subgraph public[Red pública]
      GW[API Gateway<br/>:8080]
    end
    subgraph private[Red privada · sin acceso externo]
      INV[inventory]
      CLI[clients]
      AUTH[auth]
      ORD[orders · avance 9]
      PAY[payments · avance 9]
      MI[(mongo-inventory)]
      MC[(mongo-clients)]
      MA[(mongo-auth)]
    end
    SEC[[Docker secrets<br/>./secrets]]

    N -- HTTPS/JSON + Bearer JWT --> GW
    GW -- token gw→inventory --> INV
    GW -- token gw→clients + x-user-id --> CLI
    GW -- token gw→auth --> AUTH
    CLI -- token clients→auth --> AUTH
    GW -. avance 9 .-> ORD
    GW -. avance 9 .-> PAY
    ORD -. reserva stock .-> INV
    PAY -. confirma pago .-> ORD
    INV --- MI
    CLI --- MC
    AUTH --- MA
    SEC -. solo los archivos que declara cada servicio .-> GW
    SEC -.-> AUTH
    SEC -.-> CLI
    SEC -.-> INV
```

## 3. Secuencia representativa: registro y primer inicio de sesión (implementado)

```mermaid
sequenceDiagram
    autonumber
    actor U as Cliente (navegador)
    participant GW as API Gateway
    participant CL as clients
    participant AU as auth
    participant M as Correo (adaptador)

    U->>GW: POST /api/v1/clients {run, nombre, ..., password}
    GW->>CL: POST /clients (token gw→clients)
    CL->>CL: valida RUN (módulo 11) y crea cliente "pendiente"
    CL->>AU: POST /internal/credentials (token clients→auth)
    alt auth responde 201
        AU-->>CL: credencial creada (hash scrypt, rol cliente)
        CL->>M: enviar código de 6 dígitos (se guarda solo su hash)
        CL-->>GW: 201 {id, correo, estado}
        GW-->>U: 201
    else auth no responde
        CL->>CL: elimina el cliente (compensación)
        CL-->>GW: 503
        GW-->>U: 503 "Servicio temporalmente no disponible"
    end
    U->>GW: POST /api/v1/clients/verify-email {correo, codigo}
    GW->>CL: POST /clients/verify-email
    CL->>AU: POST /internal/credentials/{id}/activate
    CL-->>U: 200 {estado: activo}
    U->>GW: POST /api/v1/auth/login {correo, password}
    GW->>AU: POST /login (token gw→auth)
    AU-->>U: 200 {token JWT ES256, expiraEn: 900}
```

## 4. Secuencia diseñada: pedido y pago (avance 9)

1. `POST /api/v1/orders` con `{items:[{productoId, cantidad}], direccionId}`. El navegador **no** envía precios.
2. orders pide a inventory reservar cada ítem (`POST /products/{id}/reservations`, idempotente por `pedidoId`).
   Si un ítem no tiene stock → 409 y se liberan las reservas ya hechas. Si inventory no responde → 503 sin pedido.
3. orders calcula subtotal con los precios de inventory, envío gratis dentro de 3 km y empaque $1.200; crea el pedido `pendiente_pago`.
4. `POST /api/v1/orders/{id}/payments` → payments crea el pago con el **monto que fija orders**, no el del navegador.
5. El proveedor avisa a `POST /api/v1/payments/webhook`; payments verifica la firma, ignora avisos repetidos
   (mismo id de transacción) y solo entonces pide a orders marcar el pedido como `pagado`.
