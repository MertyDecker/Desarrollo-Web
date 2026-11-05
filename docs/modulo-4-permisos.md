# Módulo 4 — Stakeholders y permisos HTTP

## 1. Registro de stakeholders

| Stakeholder | Interés | Rol asociado | Uso de la información |
|---|---|---|---|
| Visitante | Ver el menú y precios | `anonimo` | Consulta el catálogo público (S01, S02); puede registrarse e iniciar sesión |
| Cliente registrado | Comprar y seguir sus pedidos | `cliente` | Sus propios datos, direcciones y pedidos |
| Administrador del local | Mantener la carta y gestionar pedidos | `admin` | Administra productos; en el avance 9, cambia estados de pedidos |
| Dueño de Fukusuke | Ventas y operación del negocio | **sin permisos operativos** | Recibe reportes que prepara el administrador (y la analítica del avance 10); no invoca servicios |
| Repartidor | Saber qué entregar y dónde | **sin permisos operativos** | Recibe del administrador la dirección y el detalle del pedido a despachar; no tiene cuenta en el sistema |
| Proveedor de pagos (Webpay/Servipag) | Informar el resultado del cobro | identidad técnica `proveedor-pagos` *(avance 9)* | Solo puede invocar el aviso de pago, con firma verificable |
| Docente / evaluador | Revisar la solución | **sin permisos operativos** | Usa cuentas de prueba ficticias y el informe |

**Identidades técnicas** (no son personas): `api-gateway` (llama a inventory, clients y auth), `clients`
(llama a auth para crear y activar credenciales). Cada una tiene su propio token de servicio (Módulo 6).

## 2. Matriz de permisos

**Identidad ≠ autorización.** La identidad la prueba el token JWT (lo verifica el gateway). La autorización se
revisa en dos lugares: el gateway decide por **rol y ruta**, y cada servicio decide por **propiedad del recurso**
y vuelve a revisar el rol.

| Rol / identidad | ID | Ruta | Verbo | Decisión | Alcance y condición | Dónde se verifica |
|---|---|---|---|---|---|---|
| Visitante | S01 | `/api/v1/products` | GET | Permitido | Solo campos públicos y productos activos | Gateway (ruta anónima) + inventory (DTO público) |
| Visitante | S02 | `/api/v1/products/{id}` | GET | Permitido | 404 si el producto está dado de baja | inventory |
| Visitante | S03–S05 | `/api/v1/products[/{id}]` | POST, PUT, DELETE | **Denegado (401)** | Requiere sesión de administrador | Gateway |
| Visitante | S08 | `/api/v1/clients` | POST | Permitido | Máx. 5 por minuto por IP; el rol creado es siempre `cliente` | Gateway (límite) + clients + auth |
| Visitante | S09 | `/api/v1/clients/verify-email` | POST | Permitido | Máx. 5 intentos por código; vence en 15 min | clients |
| Visitante | S10 | `/api/v1/auth/login` | POST | Permitido | Máx. 10 por minuto por IP; bloqueo de 15 min tras 5 fallos | Gateway + auth |
| Visitante | S12–S15 | `/api/v1/clients/me...` | GET, PUT, POST | **Denegado (401)** | — | Gateway |
| Cliente | S01, S02 | catálogo | GET | Permitido | Igual que visitante | — |
| Cliente | S03–S05 | `/api/v1/products[/{id}]` | POST, PUT, DELETE | **Denegado (403)** | Consultar el catálogo no otorga administración | Gateway **y** inventory (`x-user-role`) |
| Cliente | S11 | `/api/v1/auth/logout` | POST | Permitido | Revoca solo su propio token | Gateway + auth |
| Cliente | S12 | `/api/v1/clients/me` | GET | Permitido | Solo su perfil: el id sale del token, no de la URL | Gateway (rol) + clients (id verificado) |
| Cliente | S13 | `/api/v1/clients/me` | PUT | Permitido | Solo nombre y teléfono; RUN, correo y estado no se editan | clients |
| Cliente | S14, S15 | `/api/v1/clients/me/addresses` | POST, GET | Permitido | Solo sus direcciones; máximo 5 | clients |
| Cliente | S17, S18 | `/api/v1/orders[/{id}]` | GET | Permitido *(avance 9)* | Solo pedidos propios; un pedido ajeno responde 404 sin datos | orders |
| Cliente | S19 | `/api/v1/orders/{id}/cancel` | POST | Permitido *(avance 9)* | Solo propio y antes de salir a despacho; no borra el registro | orders |
| Cliente | S20 | `/api/v1/orders/{id}/status` | PATCH | **Denegado (403)** *(avance 9)* | — | Gateway + orders |
| Administrador | S03 | `/api/v1/products` | POST | Permitido | Datos validados; campos extra → 400 | Gateway + inventory |
| Administrador | S04 | `/api/v1/products/{id}` | PUT | Permitido | Reemplaza la representación completa | Gateway + inventory |
| Administrador | S05 | `/api/v1/products/{id}` | DELETE | Permitido | Baja lógica: conserva el historial | Gateway + inventory |
| Administrador | S12–S15 | `/api/v1/clients/me...` | todos | **Denegado (403)** | El administrador no tiene perfil de cliente | Gateway |
| Administrador | S20 | `/api/v1/orders/{id}/status` | PATCH | Permitido *(avance 9)* | Solo transiciones válidas del ciclo de vida | orders |
| api-gateway | todas | rutas internas | según tabla | Permitido | Solo con su token por destino | Cada servicio (`x-service-token`) |
| clients | — | `auth /internal/credentials...` | POST, DELETE | Permitido | Solo crear, activar o compensar credenciales | auth |
| Cualquiera | — | rutas internas (`/internal/...`, `/products` directo) | todos | **Denegado** | No están publicadas: el gateway responde 404 y los servicios no tienen puertos expuestos | Red privada + gateway |

## 3. Cómo se comprueba que un usuario no ve datos de otro

- El navegador **no** elige de quién son los datos: las rutas de perfil son `/me`, y el gateway pone `x-user-id`
  a partir del token verificado. Si el navegador envía su propio `x-user-id`, el gateway lo descarta (prueba
  automatizada "Cabeceras falsificadas por el navegador se descartan").
- Los servicios solo aceptan llamadas con el token de servicio del gateway, así nadie puede llamarlos
  directamente fingiendo un `x-user-id`.
- Ocultar un botón en el frontend no cuenta como control: los permisos se aplican en el backend.
