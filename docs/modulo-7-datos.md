# Módulo 7 — Datos sensibles y secretos del cliente

## 1. Inventario y clasificación de datos

Clasificación usada: **Público** (cualquiera puede verlo), **Interno** (solo sistemas), **Personal** (identifica
o contacta a una persona), **Personal sensible por contexto** (permite suplantar o ubicar a la persona),
**Credencial** (prueba identidad) y **Secreto de integración** (credencial entre sistemas).

| Dato o credencial | Finalidad (por qué se necesita) | Clasificación | Sistema custodio | Roles autorizados | Representación en el frontend | Protección | Retención |
|---|---|---|---|---|---|---|---|
| Nombre, descripción, precio, categoría e imagen del producto | Mostrar la carta (R01) | Público | inventory | Lectura: todos. Escritura: admin | Catálogo (P01) | Validación de esquema; solo admin modifica (gateway + inventory) | Mientras el producto exista; baja lógica para conservar historial |
| Stock exacto | Saber si se puede vender | Interno | inventory | admin (vista de administración), orders (reservas) | Solo `disponible: true/false` | DTO público sin `stock` (P01); reservas atómicas | Permanente |
| RUN | Identificar al cliente (boleta) y evitar cuentas duplicadas | Personal sensible por contexto | clients | Titular (su perfil), admin (GraphQL) | Formulario de registro; perfil propio | Validación módulo 11; único; no editable; campo `run` en GraphQL solo admin (P42) | Mientras la cuenta exista |
| Nombre del cliente | Atender y despachar el pedido | Personal | clients | Titular, admin; repartidor lo recibe del admin | Perfil, resumen de pedido | Solo `/me` (id desde el token) | Mientras la cuenta exista |
| Correo | Inicio de sesión y código de verificación | Personal (identificador de credencial) | clients (contacto) y auth (identificador de login) | Titular, admin | Registro, login, perfil | Normalizado en minúsculas; único; login responde lo mismo si el correo no existe (P08) | Mientras la cuenta exista |
| Teléfono | Contactar por el despacho | Personal | clients | Titular, admin | Perfil | Solo el titular lo edita | Mientras la cuenta exista |
| Dirección de entrega | Despachar y calcular envío (R06) | Personal sensible por contexto (ubica a la persona) | clients (libreta) y orders (copia en el pedido) | Titular; admin solo dentro de un pedido | Checkout (P03), detalle del pedido | Nunca en el catálogo; orders verifica que la dirección sea del titular (P22); pedido ajeno → 404 (P24) | Libreta: mientras la cuenta exista. Copia en el pedido: igual que el pedido |
| Fecha de nacimiento y sexo | — | **No se recolectan** | — | — | Se quitarán del formulario | Minimización: el caso no los necesita | — |
| Contraseña | Probar identidad al iniciar sesión | Credencial | auth (solo el hash) | Nadie la puede leer | Campos de registro y login | **scrypt** con sal aleatoria (N=16384, r=8, p=1), nunca se devuelve ni se registra; clients solo la reenvía a auth | El hash, mientras la cuenta exista |
| Código de verificación de correo | Confirmar que el correo es del cliente | Credencial temporal | clients (solo hash SHA-256) | — | Campo del paso de verificación | 15 min de vigencia, 5 intentos, se borra al activar | Hasta activar o vencer |
| Token de sesión (JWT ES256) | Mantener la sesión | Credencial | Lo emite auth; lo guarda el navegador | El titular | En memoria del navegador (no en el HTML ni en la URL) | Firma ES256, 15 min, `iss`/`aud`/`jti`; revocable (P50); clave privada solo en auth | 15 min; `jti` revocado se borra solo (índice TTL) |
| Pedido (ítems, totales, estado, historial) | Vender, despachar y conservar historial | Personal (transaccional) | orders | Titular y admin | Mis pedidos (P05), checkout | Totales calculados en el servidor (P21); solo propios (P24); no se borra (cancelación lógica) | 6 años (respaldo tributario de ventas) |
| Pago (monto, medio, estado) | Saber si el pedido está pagado | Restringido | payments | Titular y admin | Estado del pago | Monto fijado por el servidor (P28, P30); estado solo cambia con aviso firmado (P31–P33) | 6 años |
| Datos de tarjeta / cuenta bancaria | — | **No se recolectan** | Proveedor de pagos | — | El cliente paga en la página del proveedor (`urlPago`) | Fuera del alcance del sistema | — |
| `eventoId` del proveedor | Evitar procesar dos veces el mismo aviso | Interno | payments | — | — | Índice único | 6 años junto al pago |
| Clave privada JWT, tokens entre servicios, secreto del proveedor, contraseñas de Mongo | Integración entre sistemas | Secreto de integración | `./secrets` (Docker secrets) / `.env` | Solo el proceso que los declara | **Nunca** | Ver Módulo 6 | Hasta rotar |
| Logs | Diagnóstico y correlación | Interno | Cada servicio | Equipo técnico | — | `x-request-id`; se ocultan `authorization`, `x-service-token` y `x-signature`; no se registran cuerpos ni contraseñas | Locales (`local-data/logs`); rotación manual |

## 2. ¿Necesitamos custodiar secretos asociados al cliente?

**No.** Fundamento:

- La **contraseña** es una credencial que se guarda como **hash adaptativo con sal** (scrypt). No es un secreto
  que el sistema necesite recuperar: no se puede descifrar, solo comparar.
- El **pago** lo hace el cliente en la página del proveedor (`urlPago`). Fukusuke no recibe ni guarda tarjetas,
  CVV ni claves bancarias. Del proveedor solo llega un aviso firmado con el resultado.
- No existen claves de API por cliente ni integraciones a nombre del cliente.
- Los datos restringidos (RUN, dirección, teléfono) son **datos personales**, no secretos: se protegen con
  autorización por recurso y minimización, no con un gestor de secretos.

Los únicos secretos del sistema son **de integración** (Módulo 6) y viven en el backend.

## 3. Quién consulta o modifica cada dato y qué devuelve cada servicio

| Servicio | Devuelve | No devuelve nunca | Cómo limita a los registros propios |
|---|---|---|---|
| inventory | Producto público: `id, nombre, descripcion, precio, categoria, imagen, disponible`. Admin: + `stock, activo` | Stock al público | — (datos públicos); escritura solo admin |
| clients | Perfil propio: `id, run, nombre, correo, telefono, estado, direcciones` | Hash del código de verificación; datos de otros clientes | El id sale de `x-user-id`, que fija el gateway desde el token verificado. No hay ruta `/clients/{id}` pública |
| auth | `{ token, expiraEn }` | Hash de contraseña, intentos fallidos | Login por correo + contraseña |
| orders | Pedido: ítems, totales, dirección, estado, historial. Admin: + `clienteId` | Clave de idempotencia y huella | Filtro por `clienteId = x-user-id` en la lista; en el detalle, ajeno → 404 idéntico a inexistente |
| payments | `id, pedidoId, monto, medio, estado, urlPago, creadoEn` | Firma del proveedor, `eventoId` | Solo pagos cuyo `clienteId` coincide; ajeno → 404 |
| graphql-gateway | Lo que la consulta pida y el rol permita | `run` a clientes; pedidos ajenos | Resolver verifica titular; autorización por campo |

## 4. Almacenamiento, transporte, retención, eliminación y logs

- **Almacenamiento:** una base MongoDB por servicio, con usuario de mínimo privilegio (`readWrite` solo sobre su
  base). En Docker, las bases no publican puertos; en el arranque local escuchan solo en `127.0.0.1` con
  autenticación.
- **Transporte:** navegador → gateway por HTTP en local; en un despliegue real, HTTPS en el gateway y TLS en los
  tramos internos (limitación del entorno local declarada en el Módulo 6). Entre servicios, token por tramo.
- **Retención:** pedidos y pagos se conservan (6 años, respaldo de ventas); por eso la baja de productos y la
  cancelación de pedidos son lógicas. Códigos de verificación y tokens revocados se eliminan solos al vencer.
- **Eliminación:** si el registro falla a mitad (auth no responde), clients borra el cliente creado
  (compensación). **Brecha declarada:** la eliminación de cuenta a pedido del titular no está implementada en esta
  entrega; el diseño sería anonimizar RUN, nombre, correo y teléfono en clients, borrar la credencial en auth y
  conservar los pedidos con la dirección truncada a la comuna.
- **Exclusión de logs:** el gateway oculta `authorization` y `x-service-token`; payments oculta `x-signature`;
  ningún servicio registra cuerpos de solicitud. El correo simulado (modo local) muestra el código porque
  reemplaza al proveedor de correo; en producción se usa el adaptador real.

## 5. Sesiones y tokens

- auth firma un **JWT ES256** de 15 minutos (`iss=fukusuke-auth`, `aud=fukusuke-gateway`, `sub`, `rol`, `jti`).
  La clave privada está solo en auth; el gateway tiene solo la pública, que no sirve para emitir tokens.
- En cada ruta protegida el gateway verifica firma, algoritmo (solo ES256; `alg: none` se rechaza, P12),
  emisor, audiencia y vencimiento, y consulta a auth si el `jti` fue revocado. Si auth no responde, **rechaza**
  (503, falla cerrado; ver `docs/evidencias/fallas-dependencias.md`).
- **Cerrar sesión** revoca el `jti`; reutilizar el token responde 401 (P50).
- Tras 5 contraseñas incorrectas la cuenta se bloquea 15 minutos, y el gateway limita el login a 10 intentos por
  minuto por IP (P51).
- **El navegador no puede guardar secretos:** el frontend no lleva claves. El secreto del proveedor de pagos está
  solo en payments, y por eso la confirmación de pago nunca viene del navegador (P31).

## 6. Recorrido de un dato restringido: la dirección de entrega

1. **Captura:** el cliente la escribe en el registro (P02) o en el checkout (P03). Viaja al gateway con su token.
2. **Validación y custodia:** el gateway reemplaza cualquier `x-user-id` del navegador por el del token. clients
   valida el formato y la guarda en **su** base, en la libreta del titular (máximo 5).
3. **Uso:** al confirmar un pedido, orders consulta a clients si `direccionId` es del titular (si no, 400, P22).
   Guarda una **copia** en el pedido, porque el despacho y el historial no deben cambiar si después el cliente
   edita su libreta. Con la comuna calcula el envío.
4. **Consulta:** el titular la ve en su pedido; el administrador la ve para despachar; otro cliente recibe 404
   (P24, P41). Nunca aparece en el catálogo ni en logs.
5. **Conservación:** la copia del pedido se conserva con el pedido (respaldo de ventas). La libreta se elimina al
   eliminar la cuenta (diseño declarado en §4).

## 7. Casos de validación ejecutados

Ejecutados con `npm run seguridad` contra el backend en marcha. Resultados completos y `x-request-id` de cada
solicitud: [`docs/evidencias/resultado-pruebas.md`](evidencias/resultado-pruebas.md).

| Caso | Entrada | Identidad | Esperado | Componente que lo verifica | Resultado |
|---|---|---|---|---|---|
| Acceso anónimo al catálogo | `GET /api/v1/products?available=true` | Anónimo | 200, sin `stock` | Gateway (ruta anónima) + inventory (DTO público) | ✅ P01 |
| Operación protegida sin sesión | `GET /api/v1/orders` sin `Authorization` | Anónimo | 401 | API Gateway | ✅ P11 |
| Token manipulado | JWT con `alg: none`, con el rol cambiado o firmado con otra clave | Atacante | 401 | API Gateway (`verificarJwt`) | ✅ P12–P14 |
| Administración desde un rol sin permiso | `POST /api/v1/products` | Cliente | 403 | API Gateway, y otra vez inventory | ✅ P15 |
| Cabeceras de identidad falsas | `DELETE /api/v1/products/{id}` con `x-user-role: admin` | Cliente | 403 | API Gateway (descarta cabeceras) | ✅ P16 |
| Consulta de un pedido ajeno | `GET /api/v1/orders/{idDeA}` | Cliente B | 404 sin datos | orders | ✅ P24 |
| Pedido ajeno por GraphQL | `resumenPedido(id: idDeA)` | Cliente B | `data: null`, `NO_ENCONTRADO` | graphql-gateway | ✅ P41 |
| Acceso directo al backend sin identidad autorizada | `GET http://127.0.0.1:3004/orders` con `x-user-role: admin` | Sin token de servicio | 401 (local) / sin conexión (Docker) | orders (`x-service-token`) y red privada | ✅ P47 |
| Rutas internas a través del gateway | `GET /api/v1/internal/tokens/abc` | Cualquiera | 404 | API Gateway (lista blanca) | ✅ P46 |
| Precio alterado en el frontend | `POST /api/v1/orders` con `precio` y `total` | Cliente | 400 | orders (esquema estricto) | ✅ P21 |
| Pago con datos alterados del frontend | `POST /api/v1/orders/{id}/payments` con `monto` y `estado` | Cliente | 400 | payments | ✅ P28 |
| Confirmar pago sin firma del proveedor | `POST /api/v1/payments/webhook` con firma falsa | Atacante | 401; pedido sigue `pendiente_pago` | payments (HMAC) | ✅ P31 |
| Aviso firmado con monto alterado | Cambiar `monto` después de firmar | Atacante | 401 | payments | ✅ P32 |
| Inyección NoSQL | `available[$ne]=x`; `{"correo":{"$gt":""}}` | Anónimo | 400 | inventory, auth (esquemas) | ✅ P02, P09 |
| Asignación masiva | `POST /products` con `activo` y `rol` | Admin | 400 | inventory | ✅ P18 |
| Reutilizar token tras cerrar sesión | `GET /api/v1/clients/me` | Token revocado | 401 | Gateway + auth | ✅ P50 |
| Fuerza bruta en el login | 12 intentos seguidos | Anónimo | 429 | API Gateway | ✅ P51 |

## 8. Control antes de entregar

- **¿Hay secretos en JavaScript, HTML, capturas o ejemplos?** No. `frontend/` no contiene claves. Los ejemplos
  usan datos ficticios. `secrets/`, `.env` y `local-data/` están en `.gitignore`. Las capturas de pruebas muestran
  tokens de sesión de cuentas ficticias que vencen en 15 minutos.
- **¿Los datos devueltos son los mínimos?** Sí: los DTO están declarados con esquemas de respuesta (Fastify solo
  serializa los campos listados); fecha de nacimiento y sexo se eliminaron.
- **¿Se protege la información aunque la pantalla sea accesible por Internet?** Sí: todas las decisiones se toman
  en el backend. Ocultar un botón no otorga ni quita permisos.
