# Guía de demostración paso a paso (PowerShell)

Recorre los flujos principales con solicitudes reales al API Gateway, para revisarlos o capturar pantallas.
Funciona en Windows PowerShell 5.1 y en PowerShell 7. Los datos son ficticios.

## 0. Preparar

Terminal 1 (en la carpeta del proyecto), dejarla abierta:

```powershell
npm run local
```

Terminal 2 (en la misma carpeta): pegar esta función una vez. Muestra el verbo, la ruta, el código HTTP y la
respuesta de cada solicitud.

```powershell
function api {
  param([string]$Metodo, [string]$Ruta, $Cuerpo = $null, [string]$Token = $null, [hashtable]$Extra = @{})
  $h = @{} + $Extra
  if ($Token) { $h.Authorization = "Bearer $Token" }
  $p = @{ Method = $Metodo; Uri = "http://localhost:8080$Ruta"; Headers = $h; UseBasicParsing = $true }
  if ($null -ne $Cuerpo) {
    $p.Body = [Text.Encoding]::UTF8.GetBytes(($Cuerpo | ConvertTo-Json -Depth 6))
    $p.ContentType = 'application/json; charset=utf-8'
  }
  try { $r = Invoke-WebRequest @p; $s = [int]$r.StatusCode; $c = $r.Content }
  catch { $s = [int]$_.Exception.Response.StatusCode; $c = $_.ErrorDetails.Message }
  Write-Host "`n$Metodo $Ruta  ->  HTTP $s" -ForegroundColor Cyan
  if ($c) { Write-Host $c }
  if ($c) { try { return ($c | ConvertFrom-Json) } catch { } }
}
```

## 1. Catálogo como visitante (GET público)

```powershell
$catalogo = api GET "/api/v1/products?available=true"
$dragon = ($catalogo | Where-Object nombre -eq "Dragon Roll").id
```

Esperado: `200` con 6 productos, sin el campo `stock`.

## 2. Registro, validación de correo e inicio de sesión (POST)

```powershell
api POST "/api/v1/clients" @{ run="12.345.678-5"; nombre="Ana Prueba"; direccion="Av. Providencia 1234"; comuna="Providencia"; region="Metropolitana"; correo="ana@correo-prueba.cl"; telefono="+56912345678"; password="Clave12345" }
$codigo = ((Get-Content .\local-data\correos.log -Tail 1) -split ' ')[2]
api POST "/api/v1/clients/verify-email" @{ correo="ana@correo-prueba.cl"; codigo=$codigo }
$A = (api POST "/api/v1/auth/login" @{ correo="ana@correo-prueba.cl"; password="Clave12345" }).token
$dirA = (api GET "/api/v1/clients/me/addresses" -Token $A)[0].id
```

Esperado: `201` (pendiente de validación), `200` (activo), `200` con `token` y `expiraEn: 900`.
Repite el registro con el mismo RUN: `409`. Con RUN `12.345.678-9`: `400`.

## 3. Roles: un cliente no puede administrar

```powershell
api POST "/api/v1/products" @{ nombre="Hack"; precio=1; stock=1; categoria="rolls" } -Token $A
api DELETE "/api/v1/products/$dragon" -Token $A -Extra @{ "x-user-role"="admin" }
api GET "/api/v1/orders"
```

Esperado: `403`, `403` (la cabecera falsa se descarta) y `401` sin token.

## 4. Administrador

```powershell
$clave = Get-Content .\secrets\admin_password.txt
$ADM = (api POST "/api/v1/auth/login" @{ correo="admin@fukusuke.cl"; password=$clave }).token
$gyozas = (api POST "/api/v1/products" @{ nombre="Gyozas de Cerdo"; descripcion="5 unidades"; precio=4500; stock=15; categoria="entradas" } -Token $ADM).id
```

Esperado: `201` con `stock` y `activo` (vista de administración).

## 5. Pedido con totales del servidor e idempotencia

```powershell
$cuerpo = @{ items=@(@{ productoId=$dragon; cantidad=2 }); direccionId=$dirA }
$pedido = api POST "/api/v1/orders" $cuerpo -Token $A -Extra @{ "Idempotency-Key"="demo-pedido-001" }
api POST "/api/v1/orders" $cuerpo -Token $A -Extra @{ "Idempotency-Key"="demo-pedido-001" }
api GET "/api/v1/orders" -Token $A
api POST "/api/v1/orders" @{ items=@(@{ productoId=$dragon; cantidad=1; precio=1 }); direccionId=$dirA; total=1 } -Token $A -Extra @{ "Idempotency-Key"="demo-pedido-002" }
```

Esperado: `201` con `subtotal` 17980, `envio` 0, `empaque` 1200 y `total` 19180. La segunda solicitud devuelve
`200` con el **mismo** `id`, y la lista tiene un solo pedido. Si el navegador envía `precio` o `total`: `400`.

## 6. Pago: solo el proveedor firmado lo confirma

```powershell
api POST "/api/v1/orders/$($pedido.id)/payments" @{ medio="webpay"; monto=1 } -Token $A
$pago = api POST "/api/v1/orders/$($pedido.id)/payments" @{ medio="webpay" } -Token $A
api POST "/api/v1/payments/webhook" @{ eventoId="evt-falso-001"; pagoId=$pago.id; estado="aprobado"; monto=$pago.monto } -Extra @{ "x-signature"=("f" * 64); "x-timestamp"=[string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }
npm run pago -- $pago.id $pago.monto
api GET "/api/v1/orders/$($pedido.id)" -Token $A
```

Esperado: `400` (monto del navegador), `201` (monto fijado por el servidor), `401` (firma falsa) y luego el aviso
firmado del simulador `200`. Al final el pedido queda en estado `pagado`.

## 7. Otro cliente no ve datos ajenos

```powershell
api POST "/api/v1/clients" @{ run="11.111.111-1"; nombre="Bruno Prueba"; direccion="Av. Pajaritos 4500"; comuna="Maipú"; region="Metropolitana"; correo="bruno@correo-prueba.cl"; telefono="+56987654321"; password="Clave12345" }
$codigo = ((Get-Content .\local-data\correos.log -Tail 1) -split ' ')[2]
api POST "/api/v1/clients/verify-email" @{ correo="bruno@correo-prueba.cl"; codigo=$codigo }
$B = (api POST "/api/v1/auth/login" @{ correo="bruno@correo-prueba.cl"; password="Clave12345" }).token
api GET "/api/v1/orders/$($pedido.id)" -Token $B
```

Esperado: `404` sin datos del pedido (la misma respuesta que si no existiera).

## 8. GraphQL: agregación, autorización por campo y límites

```powershell
$q = 'query($id: ID!) { resumenPedido(id: $id) { id estado total items { cantidad nombreAlComprar producto { nombre descripcion } } cliente { nombre correo run } } }'
api POST "/api/v1/graphql" @{ query=$q; variables=@{ id=$pedido.id } } -Token $A
api POST "/api/v1/graphql" @{ query=$q; variables=@{ id=$pedido.id } } -Token $ADM
api POST "/api/v1/graphql" @{ query=$q; variables=@{ id=$pedido.id } } -Token $B
api POST "/api/v1/graphql" @{ query='{ __schema { types { name } } }' } -Token $A
```

Esperado: el cliente A recibe el pedido + productos + su nombre, con `run: null` y el error
`CAMPO_NO_AUTORIZADO`. El admin recibe también el `run`. El cliente B recibe `resumenPedido: null` y
`NO_ENCONTRADO`. La introspección responde `400`.

## 9. Estados del pedido y cierre de sesión

```powershell
api PATCH "/api/v1/orders/$($pedido.id)/status" @{ estado="entregado" } -Token $ADM
api PATCH "/api/v1/orders/$($pedido.id)/status" @{ estado="en_preparacion" } -Token $ADM
api POST "/api/v1/auth/logout" -Token $B
api GET "/api/v1/clients/me" -Token $B
```

Esperado: `409` (no se puede saltar de `pagado` a `entregado`), `200`, `204` y `401` (token revocado).

## 10. Batería completa

```powershell
npm run seguridad
```

Ejecuta 51 pruebas y deja la tabla de resultados en `docs/evidencias/resultado-pruebas.md`. Si se ejecuta dos
veces seguidas, hay que esperar 1 minuto: el gateway limita los registros a 5 por minuto por IP.
