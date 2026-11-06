# Módulo 1 — Servicios derivados del frontend (borrador del Avance 7)

Caso: Fukusuke Sushi Delivery. Frontend: mockups en `docs/mockups/` y `frontend/index.html`.
Estado de este documento: actualizado en el avance 8. Las filas marcadas "Implementado" ya funcionan en el
código; el resto está diseñado y se implementa en el avance indicado.

## 1. Pantallas y requisitos

| Pantalla | Archivo / mockup | Requisitos que cubre |
|---|---|---|
| P01 Menú y catálogo | `home-menu-catalog.png` | R01 |
| P02 Crear cuenta | `customer-registration.png` | R02, R03 |
| P03 Carrito y pago | `shopping-cart-checkout.png` | R05, R06, R07 |
| P04 Iniciar sesión | enlace del encabezado (**sin mockup**) | R04 |
| P05 Mis pedidos / seguimiento | **sin mockup** | R08 |
| P06 Administración de catálogo | **sin mockup** | R09 |

| Requisito | Descripción |
|---|---|
| R01 | Ver el menú con precio y si hay stock disponible. |
| R02 | Registrarse con RUN, nombre, dirección, comuna, región, fecha de nacimiento, sexo, correo y teléfono. |
| R03 | Validar el correo con un código enviado por API. |
| R04 | Iniciar sesión y mantener una sesión con expiración. |
| R05 | Armar el carrito y confirmar el pedido; el servidor calcula subtotal, envío y empaque. |
| R06 | Despacho gratis dentro de 3 km y cargo de empaque ecológico ($1.200). |
| R07 | Pagar con Webpay, Servipag o transferencia; solo el servidor decide si un pedido está pagado. |
| R08 | Consultar mis pedidos y su estado; solo los propios. |
| R09 | El administrador agrega, modifica y da de baja productos. |

**Brechas declaradas** (se resuelven antes de la entrega): P04, P05 y P06 no tienen pantalla todavía y se
construirán en los avances 8, 9 y 11. El catálogo antiguo de `frontend/index.html` (Gyozas, Ebi Tempura…)
no coincide con los mockups; la fuente de verdad son los mockups (Dragon Roll, Salmon Nigiri…) y el
catálogo inicial del servicio `inventory` ya los usa.

## 2. Catálogo de servicios

Convención: las rutas son las **externas** (las que publica el API Gateway). El gateway las traduce a las
rutas internas de cada microservicio. Acceso: **A** anónimo, **C** cliente autenticado, **P** cliente
dueño del recurso, **Adm** administrador, **Prov** proveedor de pagos (firmado), **Int** solo interno.

| ID | Req. | Pantalla y acción | Verbo y ruta externa | Entrada | Salida | Reglas y errores | Datos | Acceso | Estado |
|---|---|---|---|---|---|---|---|---|---|
| S01 | R01 | P01 → cargar productos | `GET /api/v1/products?available=true&category=rolls` | `available` bool opc., `category` enum opc. | 200 lista de `{id,nombre,descripcion,precio,categoria,imagen,disponible}`; `[]` si no hay | 400 filtro inválido; nunca devuelve stock exacto | Público | A | **Implementado** (inventory) |
| S02 | R01 | P01 → ver un producto | `GET /api/v1/products/{id}` | `id` (24 hex) | 200 producto público | 400 id mal formado; 404 si no existe o está dado de baja | Público | A | **Implementado** |
| S03 | R09 | P06 → crear producto | `POST /api/v1/products` | `{nombre,descripcion?,precio,stock,categoria,imagen?}` | 201 producto con `stock` y `activo` | 400 si precio no es entero ≥ 1, categoría fuera de lista o hay campos extra | Público + stock interno | Adm | **Implementado** (solo admin) |
| S04 | R09 | P06 → editar producto | `PUT /api/v1/products/{id}` | mismo cuerpo que S03 (reemplaza) | 200 producto; | 400 validación; 404 no existe | Público + stock interno | Adm | **Implementado** (solo admin) |
| S05 | R09 | P06 → dar de baja | `DELETE /api/v1/products/{id}` | `id` | 204 sin cuerpo | 404 no existe. No borra el registro: lo marca inactivo para conservar el historial de pedidos | — | Adm | **Implementado** (solo admin) |
| S06 | R05 | (interno) orders reserva stock | `POST /products/{id}/reservations` (interna) | `{cantidad, pedidoId}` | 201 reserva; 409 sin stock | Idempotente por `pedidoId` | Interno | Int | Avance 9 |
| S07 | R05 | (interno) orders libera reserva | `DELETE /products/{id}/reservations/{pedidoId}` (interna) | ids | 204 | Si el pedido se cancela o el pago falla | Interno | Int | Avance 9 |
| S08 | R02 | P02 → Registrarse | `POST /api/v1/clients` | RUN, nombre, dirección, comuna, región, correo, teléfono, contraseña | 201 `{id,correo,estado:"pendiente_validacion"}` | 400 validación (RUN válido, correo); 409 correo o RUN ya registrado; contraseña con hash adaptativo | Restringido | A | **Implementado** |
| S09 | R03 | P02 → validar código | `POST /api/v1/clients/verify-email` | `{correo, codigo}` | 200 cuenta activa | 400 código incorrecto o vencido; límite de intentos | Restringido | A | **Implementado** |
| S10 | R04 | P04 → Iniciar sesión | `POST /api/v1/auth/login` | `{correo, contraseña}` | 200 `{token, expiraEn}` | 401 credenciales inválidas (mismo mensaje para correo o clave erróneos); límite de intentos | Credencial | A | **Implementado** |
| S11 | R04 | Cerrar sesión | `POST /api/v1/auth/logout` | token | 204 | El token queda revocado | — | C | **Implementado** |
| S12 | R02 | Mi perfil | `GET /api/v1/clients/me` | token | 200 datos propios | 401 sin sesión; nunca devuelve la contraseña | Restringido | P | **Implementado** |
| S13 | R02 | Editar mi perfil | `PUT /api/v1/clients/me` | campos editables | 200 perfil | 400 validación | Restringido | P | **Implementado** |
| S14 | R06 | P03 → elegir dirección | `POST /api/v1/clients/me/addresses` | `{direccion, comuna, region}` | 201 dirección | Varias direcciones por cliente | Restringido | P | **Implementado** |
| S15 | R06 | P03 → listar direcciones | `GET /api/v1/clients/me/addresses` | token | 200 lista propia | 401 | Restringido | P | **Implementado** |
| S16 | R05 | P03 → confirmar pedido | `POST /api/v1/orders` | `{items:[{productoId,cantidad}], direccionId}` | 201 pedido con totales calculados por el servidor | 400 validación; 409 sin stock; los precios enviados por el navegador se ignoran | Restringido | C | Avance 9 |
| S17 | R08 | P05 → mis pedidos | `GET /api/v1/orders` | token | 200 solo pedidos propios | 401 | Restringido | P | Avance 9 |
| S18 | R08 | P05 → detalle | `GET /api/v1/orders/{id}` | `id` | 200 pedido | 403/404 si es de otro cliente (sin revelar su existencia) | Restringido | P / Adm | Avance 9 |
| S19 | R08 | P05 → cancelar | `POST /api/v1/orders/{id}/cancel` | `id` | 200 estado `cancelado` | 409 si ya salió a despacho. No se borra el pedido | Restringido | P | Avance 9 |
| S20 | R08 | Cocina/despacho | `PATCH /api/v1/orders/{id}/status` | `{estado}` | 200 pedido | 409 transición no permitida | Restringido | Adm | Avance 9 |
| S21 | R07 | P03 → Pagar | `POST /api/v1/orders/{id}/payments` | `{medio}` (webpay, servipag, transferencia) | 201 `{pagoId, urlPago}` | El monto lo fija el servidor; 409 si el pedido ya está pagado | Restringido | P | Avance 9 |
| S22 | R07 | P03 → estado del pago | `GET /api/v1/payments/{id}` | `id` | 200 estado del pago | Solo el dueño del pedido | Restringido | P | Avance 9 |
| S23 | R07 | (proveedor) aviso de pago | `POST /api/v1/payments/webhook` | evento firmado | 200 | 401 firma inválida; idempotente: el mismo aviso dos veces no cambia nada | Interno | Prov | Avance 9 |
| S24 | R08 | P05 → resumen de pedido | `POST /graphql` · `resumenPedido(id)` | `id` | pedido + estado + descripciones de productos | Autorización por campo; tolera que inventory no responda | Restringido | P | Avance 10 |

## 3. Ejemplos de contrato (datos ficticios)

### S01 · `GET /api/v1/products?available=true`

```json
[
  {
    "id": "665f1c2e8a1b2c3d4e5f6a7b",
    "nombre": "Dragon Roll",
    "descripcion": "Unagi cremoso y pepino crocante cubierto con capas de palta y salsa tare dulce.",
    "precio": 8990,
    "categoria": "rolls",
    "imagen": null,
    "disponible": true
  }
]
```

Error: `GET /api/v1/products?available=quizas` → `400 {"error":"Solicitud inválida","detalle":"querystring/available must be boolean"}`

### S03 · `POST /api/v1/products` (administrador)

Entrada:

```json
{ "nombre": "Gyozas de Cerdo", "descripcion": "5 unidades", "precio": 4500, "stock": 15, "categoria": "entradas" }
```

Salida `201`:

```json
{
  "id": "665f1c2e8a1b2c3d4e5f6a7c", "nombre": "Gyozas de Cerdo", "descripcion": "5 unidades",
  "precio": 4500, "categoria": "entradas", "imagen": null, "disponible": true, "stock": 15, "activo": true
}
```

Error: `precio: -5` → `400`; un campo no declarado (por ejemplo `"rol":"admin"`) → `400`.

### S05 · `DELETE /api/v1/products/{id}`

`204` sin cuerpo. Después, `GET /api/v1/products/{id}` responde `404` y el producto desaparece del catálogo,
pero el registro sigue en la base para que los pedidos antiguos conserven su historial.

## 4. Decisiones

- **Fecha de nacimiento y sexo (P02): eliminados.** El caso no los necesita para vender ni despachar; ver Módulo 2.
- **Autenticación de S03–S05: resuelta en el avance 8.** El API Gateway exige rol administrador y inventory
  vuelve a revisarlo; el puerto de inventory ya no se publica.
- **Precio y pago:** el navegador nunca envía totales ni estados de pago como dato confiable; el servidor los calcula.
