# Módulo 8 — Separación privada y agregaciones GraphQL

## 1. Mapa de clasificación de servicios

Después del API Gateway, los servicios se separan por **naturaleza**. Ninguno tiene acceso público directo: en
Docker están en la red `private` (`internal: true`, sin puertos publicados) y en el arranque local escuchan solo
en `127.0.0.1` y exigen su token de servicio (P47). Los secretos están en `./secrets` y cada proceso recibe solo
los suyos.

| Servicio | Naturaleza | Responsabilidad | Datos propios | Contrato | Dependencias | Justificación de la separación |
|---|---|---|---|---|---|---|
| inventory | Transaccional (catálogo) y de **alta demanda de lectura** | Precio oficial, stock, reservas | Producto, Reserva | REST `/products`, `/internal/products`, reservas | — | Es lo más consultado (catálogo). Separado, puede escalar solo; su regla crítica (no sobrevender) está aislada en un descuento atómico |
| clients | Transaccional (datos personales) | Registro, perfil, direcciones | Cliente, Direccion, CodigoVerificacion | REST `/clients...`, `/internal/clients...` | auth | Concentra los datos personales en un solo custodio: menos superficie de exposición y una sola política de acceso |
| auth | Seguridad (identidad) | Credenciales, sesiones, revocación | Credencial, TokenRevocado | REST `/login`, `/logout`, `/internal/...` | — | La clave privada y los hashes quedan en un solo proceso; se puede rotar o reforzar sin tocar el negocio |
| orders | Transaccional (núcleo del negocio) | Pedido, totales, estados, idempotencia | Pedido | REST `/orders`, `/internal/orders...` | inventory, clients | Su ciclo de vida cambia más seguido que el catálogo (nuevos estados de despacho); evoluciona por separado |
| payments | Transaccional (integración externa) | Cobros y avisos del proveedor | Pago, EventoPago | REST `/orders/{id}/payments`, `/payments/{id}`, `/webhook` | orders, proveedor | Aísla al proveedor externo y su secreto. Cambiar de Webpay a otro proveedor no toca orders |
| graphql-gateway | **Agregación** (solo lectura) | Componer vistas para pantallas | **Ninguno** | `POST /graphql` | orders, inventory, clients | Une datos de 3 servicios sin que el frontend llame a cada uno ni conozca sus contratos; no tiene base de datos ni reglas de negocio |
| Analítica | No aplica (ver Módulo 9) | — | — | — | — | La carga medida no lo justifica |

**Propiedad de los datos:** cada servicio modifica solo sus datos. orders no descuenta stock: se lo **pide** a
inventory. payments no cambia el estado del pedido: se lo **pide** a orders. GraphQL no escribe nada y nunca lee
una base de datos: usa los contratos internos.

## 2. GraphQL Gateway (`services/graphql-gateway`)

Implementado con `graphql-js` (sin federación). Componentes, alineados con el C3 del modelo de referencia:

| Componente (C3) | Implementación |
|---|---|
| Endpoint GraphQL | `POST /graphql` en `src/app.js`; solo acepta al API Gateway (`x-service-token`) y exige identidad verificada (`x-user-id`, `x-user-role`) |
| Validador de consultas | `parse` (máx. 1000 tokens, 3000 caracteres) + reglas estándar + `NoSchemaIntrospectionCustomRule` + `reglaLimites` (profundidad ≤ 6, costo ≤ 120 campos, fragmentos incluidos) |
| Política de acceso a campos | Titular del pedido en `resumenPedido`; campo `run` solo admin; `misPedidos` filtra por la identidad, no por un argumento |
| Resolvers de negocio | `crearRaiz()` en `src/app.js` |
| Conectores de subsistemas | `src/upstreams.js` (un token por tramo, plazo de 2 s) + `src/loader.js` (batching) |
| Compositor de respuestas | Errores sin detalles internos, con `path` y `extensions.code`; `extensions.parcial: true` si faltó una dependencia |

### Schema

```graphql
# Schema del GraphQL Gateway interno de Fukusuke Sushi.
# Solo lectura: las reglas transaccionales (crear, pagar, cancelar) siguen en
# los servicios de negocio y se usan por REST a través del API Gateway.

type Query {
  "Resumen de un pedido: estado (orders) + productos (inventory) + contacto (clients)."
  resumenPedido(id: ID!): ResumenPedido
  "Pedidos del cliente autenticado, paginados (máximo 20 por página)."
  misPedidos(limite: Int = 10, desde: Int = 0): [ResumenPedido!]!
}

type ResumenPedido {
  id: ID!
  estado: String!
  subtotal: Int!
  envio: Int!
  empaque: Int!
  total: Int!
  creadoEn: String!
  direccion: Direccion
  items: [ItemPedido!]!
  "Datos de contacto del titular. Algunos campos dependen del rol."
  cliente: ClientePedido
}

type Direccion {
  direccion: String!
  comuna: String!
  region: String!
}

type ItemPedido {
  cantidad: Int!
  precioUnitario: Int!
  subtotal: Int!
  "Nombre guardado al momento de la compra (lo conserva orders)."
  nombreAlComprar: String!
  "Descripción pública actual desde inventory. Es null si inventory no responde."
  producto: Producto
}

type Producto {
  id: ID!
  nombre: String!
  descripcion: String
  categoria: String
  imagen: String
  disponible: Boolean!
}

type ClientePedido {
  nombre: String!
  correo: String!
  "Solo el titular y el administrador."
  telefono: String
  "Solo el administrador (dato personal identificador)."
  run: String
}
```

**Sin mutations:** crear, pagar o cancelar pedidos son reglas transaccionales que viven en orders y payments y
se usan por REST (S16–S23). Si GraphQL las tuviera, habría dos lugares que validar.

### Resolvers

| Campo | Fuente | Regla |
|---|---|---|
| `Query.resumenPedido(id)` | orders `GET /internal/orders/{id}` | Si el pedido no es del usuario (y no es admin) → error `NO_ENCONTRADO`, `data: null` (igual que si no existiera) |
| `Query.misPedidos(limite, desde)` | orders `GET /internal/orders?clienteId=<de la identidad>` | Paginación: `limite` 1–20, `desde` ≥ 0 |
| `ResumenPedido.*` (estado, totales, dirección) | orders | Autoridad de orders: GraphQL no recalcula |
| `ItemPedido.producto` | inventory `GET /internal/products?ids=…` | **Batching:** todos los ítems de la consulta se piden en **una** llamada. Si inventory falla → `null` + error `DEPENDENCIA_NO_DISPONIBLE` |
| `ResumenPedido.cliente` | clients `GET /internal/clients/{id}` | Una vez por cliente y por solicitud (cache del loader) |
| `ClientePedido.run` | clients | Solo `admin`; a un cliente → `null` + `CAMPO_NO_AUTORIZADO` |

**Por qué batching:** un pedido con 10 ítems haría 10 llamadas a inventory. El loader junta las claves pedidas en
el mismo ciclo y hace una sola llamada por lote, verificado en la prueba unitaria "una sola llamada a inventory".

## 3. Consulta de prueba y respuesta (ejecución real, datos ficticios)

Pantalla P05 "Mis pedidos / seguimiento" → detalle de un pedido. Se envía al API Gateway (S24):

```http
POST http://localhost:8080/api/v1/graphql
Authorization: Bearer <token del cliente>
Content-Type: application/json

{ "query": "query($id: ID!) { resumenPedido(id: $id) { id estado total items { nombreAlComprar producto { nombre descripcion } } } }",
  "variables": { "id": "e17fcdc3-a7f6-412b-9383-daadac93b43e" } }
```

Respuesta `200` (combina **orders**: id, estado, total, nombre al comprar; e **inventory**: descripción actual):

```json
{
  "data": {
    "resumenPedido": {
      "id": "e17fcdc3-a7f6-412b-9383-daadac93b43e",
      "estado": "pendiente_pago",
      "total": 16180,
      "items": [
        { "nombreAlComprar": "California Roll", "producto": { "nombre": "California Roll", "descripcion": "Auténtica ensalada de cangrejo, pepino fresco y palta envuelta en alga tostada premium." } },
        { "nombreAlComprar": "Dragon Roll", "producto": { "nombre": "Dragon Roll", "descripcion": "Unagi cremoso y pepino crocante cubierto con capas de palta y salsa tare dulce." } }
      ]
    }
  }
}
```

**Si inventory no responde** (ejecución real con inventory congelado, `docs/evidencias/fallas-dependencias.md`),
la respuesta conserva lo que orders sí entregó y declara que está incompleta:

```json
{
  "data": { "resumenPedido": { "id": "e17f…", "estado": "pendiente_pago", "total": 16180,
            "items": [ { "nombreAlComprar": "California Roll", "producto": null }, { "nombreAlComprar": "Dragon Roll", "producto": null } ] } },
  "errors": [ { "message": "Inventario no disponible: la descripción del producto no se pudo obtener.", "path": ["resumenPedido","items",0,"producto"], "extensions": { "code": "DEPENDENCIA_NO_DISPONIBLE" } }, "…" ],
  "extensions": { "parcial": true }
}
```

## 4. Matriz de autorización GraphQL

| Operación / campo | Anónimo | Cliente titular | Otro cliente | Admin | Dónde se decide |
|---|---|---|---|---|---|
| `POST /api/v1/graphql` | 401 (gateway) | ✔ | ✔ | ✔ | API Gateway (S24) |
| `resumenPedido(id)` | — | ✔ | `null` + `NO_ENCONTRADO` | ✔ | Resolver |
| `misPedidos` | — | Solo los propios | Solo los propios | Lista vacía (no compra) | Resolver (filtro por identidad) |
| `cliente { nombre correo telefono }` | — | ✔ | — | ✔ | Acceso al pedido |
| `cliente { run }` | — | `null` + `CAMPO_NO_AUTORIZADO` | — | ✔ | Política por campo |
| `__schema`, `__type` (introspección) | — | 400 | 400 | 400 | Validador |
| `mutation` | — | 400 | 400 | 400 | Validador |

## 5. Límites y tratamiento de errores

| Control | Valor | Qué pasa si se excede | Prueba |
|---|---|---|---|
| Largo de la consulta | 3000 caracteres / 1000 tokens | 400 | unitaria |
| Profundidad | 6 niveles | 400 `LIMITE_PROFUNDIDAD`, sin ejecutar resolvers | unitaria |
| Costo (campos totales, alias incluidos) | 120 | 400 `LIMITE_COSTO`, ningún servicio consultado | P43 |
| Paginación | `limite` ≤ 20 | error `ENTRADA_INVALIDA` | P45 |
| Plazo por dependencia | 2 s | campo en `null` + `DEPENDENCIA_NO_DISPONIBLE` | fallas-dependencias paso 3 |
| Plazo total | 5 s | 504 `PLAZO_EXCEDIDO` | — |
| Frecuencia | 30 solicitudes/min por IP | 429 (gateway) | — |

## 6. Evidencia

- Automatizada: `services/graphql-gateway/test/graphql.test.js` (7 pruebas) y `npm run seguridad` P40–P45.
- Ejecución contra el backend real: `docs/evidencias/resultado-pruebas.md` y `docs/evidencias/fallas-dependencias.md`.
- **El navegador no puede invocar los subsistemas privados:** el gateway no publica `/internal/...` (P46) y un
  acceso directo a un servicio sin su token responde 401 (P47).
- **Integración con la pantalla:** según lo indicado por el docente, en esta entrega el frontend no se conecta;
  la consulta corresponde a la pantalla P05 y se ejecuta por el mismo camino que usará el frontend
  (`POST /api/v1/graphql` en el API Gateway con el token del usuario).
