# Módulo 2 — Clases y cardinalidades del dominio

Diagrama en Mermaid (editable como texto; GitHub lo dibuja automáticamente).
Las entidades marcadas *(avance 9)* están diseñadas y se implementan en ese avance.

## 1. Diagrama de clases del dominio y servicios públicos

```mermaid
classDiagram
    direction LR

    class Cliente {
      +id: ObjectId
      +run: String  «restringido»
      +nombre: String
      +correo: String «restringido»
      +telefono: String «restringido»
      +estado: EstadoCliente
      +createdAt: Date
    }
    class Direccion {
      +id: UUID
      +direccion: String «restringido»
      +comuna: String
      +region: String
    }
    class CodigoVerificacion {
      +hash: String
      +expira: Number
      +intentos: Number
    }
    class Credencial {
      +clienteId: String
      +correo: String
      +passwordHash: String «credencial»
      +rol: Rol
      +estado: EstadoCredencial
      +intentosFallidos: Number
      +bloqueadoHasta: Number
    }
    class TokenRevocado {
      +jti: String
      +expira: Date
    }
    class Producto {
      +id: ObjectId
      +nombre: String
      +descripcion: String
      +precio: Integer (CLP)
      +stock: Integer «interno»
      +categoria: Categoria
      +imagen: String
      +activo: Boolean
    }
    class Pedido {
      +id: ObjectId
      +clienteId: String
      +direccionEntrega: Direccion
      +estado: EstadoPedido
      +subtotal: Integer
      +envio: Integer
      +empaque: Integer
      +total: Integer
      +creadoEn: Date
    }
    class DetallePedido {
      +productoId: String
      +nombreProducto: String
      +precioUnitario: Integer
      +cantidad: Integer
    }
    class Pago {
      +id: ObjectId
      +pedidoId: String
      +medio: MedioPago
      +monto: Integer
      +estado: EstadoPago
      +idTransaccionProveedor: String
    }
    class ReservaStock {
      +productoId: String
      +pedidoId: String
      +cantidad: Integer
      +estado: EstadoReserva
    }

    Cliente "1" *-- "1..5" Direccion : tiene
    Cliente "1" *-- "0..1" CodigoVerificacion : valida correo con
    Cliente "1" -- "1" Credencial : se autentica con
    Credencial "1" -- "0..*" TokenRevocado : cierra sesiones
    Cliente "1" -- "0..*" Pedido : realiza
    Pedido "1" *-- "1..*" DetallePedido : contiene
    DetallePedido "0..*" --> "1" Producto : referencia
    Pedido "1" -- "0..*" Pago : se paga con
    Pedido "1" -- "0..*" ReservaStock : reserva
    ReservaStock "0..*" --> "1" Producto : descuenta de

    class CatalogService {
      <<service>>
      +consultarCatalogo(filtro) ProductoPublicoDTO[]  S01
      +consultarProducto(id) ProductoPublicoDTO  S02
      +agregarProducto(datos) ProductoAdminDTO  S03
      +modificarProducto(id, datos) ProductoAdminDTO  S04
      +darDeBaja(id)  S05
    }
    class ClientService {
      <<service>>
      +registrar(datos) RegistroDTO  S08
      +validarCorreo(correo, codigo)  S09
      +miPerfil() PerfilDTO  S12
      +editarPerfil(datos) PerfilDTO  S13
      +agregarDireccion(dir) Direccion  S14
      +misDirecciones() Direccion[]  S15
    }
    class AuthService {
      <<service>>
      +iniciarSesion(correo, clave) SesionDTO  S10
      +cerrarSesion()  S11
    }
    class OrderService {
      <<service>>
      +crearPedido(items, direccionId) PedidoDTO  S16
      +misPedidos() PedidoDTO[]  S17
      +consultarPedido(id) PedidoDTO  S18
      +cancelar(id)  S19
      +cambiarEstado(id, estado)  S20
    }
    class PaymentService {
      <<service>>
      +iniciarPago(pedidoId, medio) InicioPagoDTO  S21
      +consultarPago(id) PagoDTO  S22
      +recibirAviso(evento)  S23
    }
    class ProductoPublicoDTO {
      <<DTO>>
      id, nombre, descripcion, precio, categoria, imagen, disponible
    }
    class PerfilDTO {
      <<DTO>>
      id, run, nombre, correo, telefono, estado, direcciones
    }
    class SesionDTO {
      <<DTO>>
      token, tipo, expiraEn, rol
    }

    CatalogService ..> Producto : usa
    CatalogService ..> ProductoPublicoDTO : devuelve
    ClientService ..> Cliente : usa
    ClientService ..> PerfilDTO : devuelve
    ClientService ..> AuthService : crea credencial
    AuthService ..> Credencial : usa
    AuthService ..> SesionDTO : devuelve
    OrderService ..> Pedido : usa
    OrderService ..> CatalogService : reserva stock
    PaymentService ..> Pago : usa
    PaymentService ..> OrderService : confirma pago
```

**Leyenda:** `*--` composición (la parte no existe sin el todo), `--` asociación, `-->` asociación navegable,
`..>` dependencia de uso (un servicio usa una clase o contrato; no es una relación entre registros).
«restringido» = dato personal; «credencial» = secreto del usuario; «interno» = no sale en respuestas públicas.

## 2. Relaciones y la regla que origina cada cardinalidad

| Origen | Destino | Multiplicidad | Tipo | Regla de negocio |
|---|---|---|---|---|
| Cliente | Direccion | 1 — 1..5 | composición | El registro exige una dirección (P02). El mockup indica "guarda múltiples comunas"; se limita a 5 para acotar datos personales. Si se borra el cliente, se borran sus direcciones. |
| Cliente | CodigoVerificacion | 1 — 0..1 | composición | Existe solo mientras la cuenta está pendiente; al validar el correo se elimina. |
| Cliente | Credencial | 1 — 1 | asociación entre sistemas | Cada cliente tiene exactamente una credencial en auth (mismo `clienteId`). El administrador es una credencial **sin** cliente. |
| Credencial | TokenRevocado | 1 — 0..* | asociación | Cada cierre de sesión revoca un token; el registro se borra solo cuando el token habría vencido. |
| Cliente | Pedido | 1 — 0..* | asociación | Un cliente puede no haber comprado nunca; cada pedido pertenece a un solo cliente. |
| Pedido | DetallePedido | 1 — 1..* | composición | Un pedido confirmado tiene al menos un ítem. **No existe pedido vacío**: el carrito vive en el navegador hasta confirmar. |
| DetallePedido | Producto | 0..* — 1 | asociación | Cada línea apunta a un producto, pero copia `nombreProducto` y `precioUnitario` al momento de comprar: si el producto cambia de precio o se da de baja, el historial no cambia. |
| Pedido | Pago | 1 — 0..* | asociación | Un pedido puede tener varios intentos de pago (uno rechazado y otro aprobado); como máximo uno queda aprobado. |
| Pedido | ReservaStock | 1 — 0..* | asociación | Se reserva stock por cada producto del pedido; la reserva se libera si el pago falla o el pedido se cancela. |

## 3. Decisiones del equipo

- **Carrito y pedido son distintos.** El carrito es estado del navegador (el usuario lo arma sin sesión). El
  pedido existe solo en el servidor y se crea al confirmar; el servidor recalcula precios y totales.
- **Historial con productos dados de baja.** La baja es lógica (`activo = false`) y además el detalle guarda una
  copia de nombre y precio, así un pedido antiguo se sigue viendo igual.
- **Modelo interno vs. DTO.** `stock`, `activo`, `passwordHash`, `codigoVerificacion` e `intentosFallidos` nunca
  salen en respuestas públicas. El catálogo expone `disponible` (calculado), no el stock exacto.
- **Fecha de nacimiento y sexo (P02) se eliminan del modelo.** El caso no los necesita para vender ni despachar;
  guardarlos solo aumentaría los datos personales a proteger (ver Módulo 7). El formulario se ajusta en el avance 11.

## 4. Correspondencia operación UML ↔ servicio

| Operación | ID | Estado |
|---|---|---|
| CatalogService.consultarCatalogo / consultarProducto / agregarProducto / modificarProducto / darDeBaja | S01–S05 | Implementado (inventory) |
| ClientService.registrar / validarCorreo | S08, S09 | Implementado (clients + auth) |
| AuthService.iniciarSesion / cerrarSesion | S10, S11 | Implementado (auth) |
| ClientService.miPerfil / editarPerfil / agregarDireccion / misDirecciones | S12–S15 | Implementado (clients) |
| OrderService.* | S16–S20 | Avance 9 |
| PaymentService.* | S21–S23 | Avance 9 |
