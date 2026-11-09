workspace "Fukusuke" "Fukusuke Sushi Delivery - backend de microservicios (Evaluacion 2)" {

    !identifiers hierarchical

    model {
        visitante = person "Visitante" "Consulta el menu sin iniciar sesion."
        cliente = person "Cliente" "Cliente registrado: compra, paga y sigue sus pedidos."
        operador = person "Administrador del local" "Mantiene la carta y cambia el estado de los pedidos."

        proveedorPagos = softwareSystem "Proveedor de pagos" "Webpay / Servipag. En local: adaptador de prueba (scripts/simular-pago.js) que firma avisos con HMAC." {
            tags "SistemaExterno"
        }
        correo = softwareSystem "Proveedor de correo" "Envia el codigo de verificacion. En local: adaptador [CORREO-SIMULADO]." {
            tags "SistemaExterno"
        }

        sistema = softwareSystem "Fukusuke Sushi Delivery" "Catalogo, clientes, pedidos y pagos de un local de sushi delivery." {
            tags "SistemaEvaluado"

            frontend = container "Frontend responsivo" "Paginas HTML/CSS/JS (Evaluacion 1). Su conexion con la API es la Evaluacion 3." "Aplicacion web" {
                tags "Frontend"
            }

            apiGateway = container "API Gateway" "Unico punto publico (8080): lista blanca de rutas, JWT ES256, revocacion, roles, limites, timeouts." "Node.js 22 + Fastify" {
                tags "Gateway"
                httpEntry = component "Adaptador HTTP" "Recibe solicitudes, CORS, limite de cuerpo 100 KB, x-request-id." "Fastify" {
                    tags "EntradaC3"
                }
                identityFilter = component "Filtro de acceso" "Verifica el JWT, consulta revocacion en auth (falla cerrado) y el rol de la ruta." "autorizar() + jwt.js" {
                    tags "ControlC3"
                }
                routeDispatcher = component "Despachador de rutas" "Tabla S01-S24; arma cabeceras desde cero con el token de servicio del destino." "routes.js + reenviar()" {
                    tags "AplicacionC3"
                }
                errorMapper = component "Traductor de errores" "502/503/504 controlados, sin detalles internos." "setErrorHandler" {
                    tags "ErrorC3"
                }
            }

            authService = container "auth" "Credenciales (hash scrypt), login, bloqueo por intentos, emision y revocacion de tokens." "Node.js 22 + Fastify" {
                tags "Seguridad"
                identityApi = component "API de identidad" "POST /login, /logout, /internal/credentials, GET /internal/tokens/{jti}." "Fastify" {
                    tags "EntradaC3"
                }
                sessionManager = component "Gestor de sesiones" "Firma JWT ES256 de 15 min con jti; registra revocaciones con TTL." "jwt.js" {
                    tags "AplicacionC3"
                }
                credentialsVerifier = component "Verificador de credenciales" "scrypt con sal y comparacion en tiempo constante; mismo mensaje si el correo no existe." "password.js" {
                    tags "ControlC3"
                }
                identityRepo = component "Repositorio de identidades" "Credencial y TokenRevocado." "Mongoose" {
                    tags "PersistenciaC3"
                }
                secretsClient = component "Lector de secretos" "Lee la clave privada JWT y los tokens desde archivos montados." "secrets.js" {
                    tags "IntegracionC3"
                }
            }

            secretManager = container "Administrador de secretos" "Docker secrets: archivos en ./secrets montados solo en el contenedor que los declara." "Docker secrets" {
                tags "Seguridad"
            }

            inventory = container "inventory" "Catalogo, precio oficial, stock y reservas idempotentes." "Node.js 22 + Fastify" {
                tags "Privado"
            }

            orders = container "orders" "Pedidos: totales del servidor, Idempotency-Key, reservas, estados, propiedad." "Node.js 22 + Fastify" {
                tags "Privado"
                ordersApi = component "API de pedidos" "POST/GET /orders, cancel, status; /internal/orders para payments y graphql." "Fastify" {
                    tags "EntradaC3"
                }
                accessPolicy = component "Politica de acceso a pedidos" "Rol desde x-user-role; titular o admin (puedeVer); ajeno = 404." "requiereRol + puedeVer" {
                    tags "ControlC3"
                }
                idempotency = component "Control de idempotencia" "Busca (clienteId, Idempotency-Key); misma huella = mismo pedido, otra huella = 422." "huella() + indice unico" {
                    tags "ControlC3"
                }
                orderWorkflow = component "Servicio de pedidos" "Agrupa items, calcula subtotal, envio y empaque; transiciones de estado." "app.js" {
                    tags "AplicacionC3"
                }
                inventoryAdapter = component "Adaptador de inventario" "Precios por lote, reservar y liberar stock (token orders->inventory)." "upstreams.js" {
                    tags "IntegracionC3"
                }
                clientsAdapter = component "Adaptador de clientes" "Confirma que la direccion es del titular (token orders->clients)." "upstreams.js" {
                    tags "IntegracionC3"
                }
                ordersRepo = component "Repositorio de pedidos" "Pedido con historial; cambios de estado condicionados al estado actual." "Mongoose" {
                    tags "PersistenciaC3"
                }
            }

            clients = container "clients" "Registro con RUN, validacion de correo, perfil y direcciones." "Node.js 22 + Fastify" {
                tags "Privado"
            }

            payments = container "payments" "Cobros con monto del servidor; aviso del proveedor firmado (HMAC) e idempotente." "Node.js 22 + Fastify" {
                tags "Privado"
            }

            dbInventory = container "mongo-inventory" "productos, reservas." "MongoDB 7" {
                tags "BaseDatos"
            }
            dbOrders = container "mongo-orders" "pedidos." "MongoDB 7" {
                tags "BaseDatos"
            }
            dbClients = container "mongo-clients" "clientes." "MongoDB 7" {
                tags "BaseDatos"
            }
            dbPayments = container "mongo-payments" "pagos, eventopagos." "MongoDB 7" {
                tags "BaseDatos"
            }
            dbIdentity = container "mongo-auth" "credencials, tokenrevocados." "MongoDB 7" {
                tags "BaseDatos"
            }

            graphqlGateway = container "GraphQL Gateway" "Privado. resumenPedido y misPedidos: une orders, inventory y clients. Solo lectura." "Node.js 22 + graphql-js" {
                tags "Gateway"
                graphqlEndpoint = component "Endpoint GraphQL" "POST /graphql; solo acepta al API Gateway." "Fastify" {
                    tags "EntradaC3"
                }
                queryValidator = component "Validador de consultas" "Esquema, sin introspeccion, profundidad <= 6, costo <= 120, 3000 caracteres." "validate + reglaLimites" {
                    tags "ControlC3"
                }
                fieldAccess = component "Politica de acceso a campos" "Pedido del titular; campo run solo admin." "Resolvers" {
                    tags "ControlC3"
                }
                resolvers = component "Resolvers de negocio" "resumenPedido, misPedidos (paginado)." "crearRaiz()" {
                    tags "AplicacionC3"
                }
                serviceConnectors = component "Conectores de subsistemas" "Un token por tramo, plazo 2 s, batching hacia inventory." "upstreams.js + loader.js" {
                    tags "IntegracionC3"
                }
                responseComposer = component "Compositor de respuestas" "Errores con codigo; extensions.parcial si falto una dependencia." "app.js" {
                    tags "ErrorC3"
                }
            }
        }

        // ---- C1
        visitante -> sistema "Consulta el menu"
        cliente -> sistema "Compra, paga y sigue sus pedidos"
        operador -> sistema "Administra la carta y los estados de pedidos"
        sistema -> proveedorPagos "Redirige al cliente a pagar"
        proveedorPagos -> sistema "Avisa el resultado del pago (firmado)" "HTTPS/JSON + HMAC"
        sistema -> correo "Envia el codigo de verificacion"

        // ---- C2
        visitante -> sistema.frontend "Consulta el catalogo" "Navegador web"
        cliente -> sistema.frontend "Compra y sigue sus pedidos" "Navegador web"
        operador -> sistema.frontend "Gestiona la carta y los pedidos" "Navegador web"
        sistema.frontend -> sistema.apiGateway "Invoca la API /api/v1" "HTTP(S)/JSON + Bearer JWT"
        proveedorPagos -> sistema.apiGateway "POST /api/v1/payments/webhook" "HTTPS/JSON + HMAC"
        sistema.apiGateway -> sistema.authService "Login, logout y revocacion" "HTTP/JSON + token de servicio"
        sistema.apiGateway -> sistema.inventory "S01-S05" "HTTP/JSON + token de servicio"
        sistema.apiGateway -> sistema.clients "S08, S09, S12-S15" "HTTP/JSON + token de servicio"
        sistema.apiGateway -> sistema.orders "S16-S20" "HTTP/JSON + token de servicio"
        sistema.apiGateway -> sistema.payments "S21-S23" "HTTP/JSON + token de servicio"
        sistema.apiGateway -> sistema.graphqlGateway "S24" "HTTP/GraphQL + token de servicio"
        sistema.clients -> sistema.authService "Crea y activa credenciales" "HTTP/JSON + token clients->auth"
        sistema.clients -> correo "Codigo de verificacion" "Adaptador"
        sistema.orders -> sistema.inventory "Precios por lote, reservar y liberar stock" "HTTP/JSON + token orders->inventory"
        sistema.orders -> sistema.clients "Direccion del titular" "HTTP/JSON + token orders->clients"
        sistema.payments -> sistema.orders "Lee el pedido y lo marca pagado" "HTTP/JSON + token payments->orders"
        sistema.graphqlGateway -> sistema.orders "Pedidos" "HTTP/JSON + token graphql->orders"
        sistema.graphqlGateway -> sistema.inventory "Productos por lote" "HTTP/JSON + token graphql->inventory"
        sistema.graphqlGateway -> sistema.clients "Contacto del titular" "HTTP/JSON + token graphql->clients"
        sistema.secretManager -> sistema.apiGateway "Clave publica JWT y tokens" "Archivo montado"
        sistema.secretManager -> sistema.authService "Clave privada JWT, clave admin, tokens" "Archivo montado"
        sistema.secretManager -> sistema.payments "Secreto del proveedor y tokens" "Archivo montado"
        sistema.inventory -> sistema.dbInventory "Lee y escribe" "MongoDB (usuario readWrite propio)"
        sistema.orders -> sistema.dbOrders "Lee y escribe" "MongoDB (usuario readWrite propio)"
        sistema.clients -> sistema.dbClients "Lee y escribe" "MongoDB (usuario readWrite propio)"
        sistema.payments -> sistema.dbPayments "Lee y escribe" "MongoDB (usuario readWrite propio)"
        sistema.authService -> sistema.dbIdentity "Lee y escribe" "MongoDB (usuario readWrite propio)"

        // ---- C3 API Gateway
        sistema.frontend -> sistema.apiGateway.httpEntry "Invoca la API" "HTTP(S)"
        sistema.apiGateway.httpEntry -> sistema.apiGateway.identityFilter "Ruta protegida"
        sistema.apiGateway.httpEntry -> sistema.apiGateway.routeDispatcher "Ruta anonima"
        sistema.apiGateway.identityFilter -> sistema.authService "GET /internal/tokens/{jti}" "HTTP/JSON"
        sistema.apiGateway.identityFilter -> sistema.apiGateway.routeDispatcher "Solicitud autorizada"
        sistema.apiGateway.routeDispatcher -> sistema.inventory "Reenvia" "HTTP/JSON"
        sistema.apiGateway.routeDispatcher -> sistema.clients "Reenvia" "HTTP/JSON"
        sistema.apiGateway.routeDispatcher -> sistema.orders "Reenvia" "HTTP/JSON"
        sistema.apiGateway.routeDispatcher -> sistema.payments "Reenvia" "HTTP/JSON"
        sistema.apiGateway.routeDispatcher -> sistema.graphqlGateway "Reenvia" "HTTP/GraphQL"
        sistema.apiGateway.routeDispatcher -> sistema.apiGateway.errorMapper "Timeout o falla del servicio"

        // ---- C3 GraphQL
        sistema.apiGateway -> sistema.graphqlGateway.graphqlEndpoint "POST /graphql" "HTTP/GraphQL"
        sistema.graphqlGateway.graphqlEndpoint -> sistema.graphqlGateway.queryValidator "Valida"
        sistema.graphqlGateway.queryValidator -> sistema.graphqlGateway.graphqlEndpoint "Rechaza consulta excesiva (400)"
        sistema.graphqlGateway.queryValidator -> sistema.graphqlGateway.resolvers "Consulta valida"
        sistema.graphqlGateway.resolvers -> sistema.graphqlGateway.fieldAccess "Comprueba titular y campos"
        sistema.graphqlGateway.resolvers -> sistema.graphqlGateway.serviceConnectors "Pide datos"
        sistema.graphqlGateway.serviceConnectors -> sistema.orders "Pedidos" "HTTP/JSON"
        sistema.graphqlGateway.serviceConnectors -> sistema.inventory "Productos por lote" "HTTP/JSON"
        sistema.graphqlGateway.serviceConnectors -> sistema.clients "Contacto" "HTTP/JSON"
        sistema.graphqlGateway.resolvers -> sistema.graphqlGateway.responseComposer "Datos y errores"
        sistema.graphqlGateway.graphqlEndpoint -> sistema.apiGateway "Resultado o error" "HTTP/GraphQL"

        // ---- C3 auth
        sistema.apiGateway -> sistema.authService.identityApi "Login, logout, revocacion" "HTTP/JSON"
        sistema.clients -> sistema.authService.identityApi "Credenciales" "HTTP/JSON"
        sistema.authService.identityApi -> sistema.authService.credentialsVerifier "Verifica contrasena"
        sistema.authService.identityApi -> sistema.authService.sessionManager "Emite o revoca token"
        sistema.authService.credentialsVerifier -> sistema.authService.identityRepo "Busca credencial"
        sistema.authService.sessionManager -> sistema.authService.identityRepo "Guarda revocacion"
        sistema.authService.identityRepo -> sistema.dbIdentity "Lee y escribe" "MongoDB"
        sistema.authService.sessionManager -> sistema.authService.secretsClient "Clave privada"
        sistema.authService.secretsClient -> sistema.secretManager "Lee archivo montado" "Archivo"

        // ---- C3 orders
        sistema.apiGateway -> sistema.orders.ordersApi "S16-S20" "HTTP/JSON"
        sistema.payments -> sistema.orders.ordersApi "/internal/orders" "HTTP/JSON"
        sistema.graphqlGateway -> sistema.orders.ordersApi "/internal/orders" "HTTP/JSON"
        sistema.orders.ordersApi -> sistema.orders.accessPolicy "Rol y titular"
        sistema.orders.accessPolicy -> sistema.orders.idempotency "Escritura autorizada"
        sistema.orders.accessPolicy -> sistema.orders.orderWorkflow "Lectura autorizada"
        sistema.orders.idempotency -> sistema.orders.ordersRepo "Busca clave previa"
        sistema.orders.ordersRepo -> sistema.orders.idempotency "Pedido existente"
        sistema.orders.idempotency -> sistema.orders.ordersApi "Devuelve el mismo pedido (200)"
        sistema.orders.idempotency -> sistema.orders.orderWorkflow "Clave nueva"
        sistema.orders.orderWorkflow -> sistema.orders.clientsAdapter "Direccion"
        sistema.orders.orderWorkflow -> sistema.orders.inventoryAdapter "Precios y reservas"
        sistema.orders.orderWorkflow -> sistema.orders.ordersRepo "Guarda pedido y estados"
        sistema.orders.inventoryAdapter -> sistema.inventory "Contrato interno" "HTTP/JSON"
        sistema.orders.clientsAdapter -> sistema.clients "Contrato interno" "HTTP/JSON"
        sistema.orders.ordersRepo -> sistema.dbOrders "Lee y escribe" "MongoDB"

        // ---- Respuestas para vistas dinamicas
        sistema.dbInventory -> sistema.inventory "Resultados" "MongoDB"
        sistema.inventory -> sistema.apiGateway "Respuesta" "HTTP/JSON"
        sistema.apiGateway -> sistema.frontend "Respuesta o error controlado" "HTTP(S)"
        sistema.frontend -> visitante "Presenta resultados" "Interfaz web"
        sistema.frontend -> cliente "Presenta resultados" "Interfaz web"
        sistema.dbOrders -> sistema.orders "Resultados" "MongoDB"
        sistema.orders -> sistema.apiGateway "Respuesta" "HTTP/JSON"
        sistema.authService -> sistema.apiGateway "Respuesta" "HTTP/JSON"
        sistema.inventory -> sistema.orders "Respuesta" "HTTP/JSON"
        sistema.clients -> sistema.orders "Respuesta" "HTTP/JSON"
        sistema.orders -> sistema.payments "Respuesta" "HTTP/JSON"
        sistema.payments -> sistema.apiGateway "Respuesta" "HTTP/JSON"
        sistema.graphqlGateway -> sistema.apiGateway "Resultado agregado o parcial" "HTTP/GraphQL"
        sistema.inventory -> sistema.graphqlGateway "Productos" "HTTP/JSON"
        sistema.orders -> sistema.graphqlGateway "Pedidos" "HTTP/JSON"
        sistema.clients -> sistema.graphqlGateway "Contacto" "HTTP/JSON"
        sistema.dbPayments -> sistema.payments "Resultados" "MongoDB"

        // ---- Despliegue con Docker Compose (docker-compose.yml)
        docker = deploymentEnvironment "Docker_Compose" {
            deploymentNode "Equipo del usuario" "Navegador." "Equipo cliente" {
                tags "ZonaCliente"
                deploymentNode "Navegador web" "Ejecuta el frontend." "Navegador" {
                    containerInstance sistema.frontend
                }
            }
            deploymentNode "Docker Engine" "docker compose up --build" "Docker" {
                tags "ZonaEntorno"
                deploymentNode "Red public" "Unico puerto publicado: 127.0.0.1:8080." "Red bridge" {
                    tags "ZonaPublica"
                    deploymentNode "api-gateway" "Contenedor node:22-alpine, usuario no root." "Contenedor" {
                        containerInstance sistema.apiGateway
                    }
                }
                deploymentNode "Red private" "internal: true; sin salida a Internet ni puertos publicados." "Red bridge interna" {
                    tags "ZonaPrivada"
                    deploymentNode "Servicios privados" "Un contenedor por servicio, healthcheck /health." "Contenedores" {
                        containerInstance sistema.authService
                        containerInstance sistema.graphqlGateway
                        containerInstance sistema.inventory
                        containerInstance sistema.orders
                        containerInstance sistema.clients
                        containerInstance sistema.payments
                    }
                    deploymentNode "Bases de datos" "Un contenedor mongo:7 por servicio, volumen propio, usuario readWrite." "Contenedores" {
                        tags "ZonaDatos"
                        containerInstance sistema.dbInventory
                        containerInstance sistema.dbOrders
                        containerInstance sistema.dbClients
                        containerInstance sistema.dbPayments
                        containerInstance sistema.dbIdentity
                    }
                }
                deploymentNode "Docker secrets" "./secrets montado en /run/secrets solo donde se declara." "Secretos" {
                    tags "ZonaSecretos"
                    containerInstance sistema.secretManager
                }
            }
        }

        // ---- Despliegue local sin Docker (npm run local)
        local = deploymentEnvironment "Desarrollo_Local" {
            deploymentNode "Equipo de desarrollo" "Windows/Linux/macOS con Node.js 20+." "Estacion de trabajo" {
                tags "ZonaLocal"
                deploymentNode "Navegador local" "Frontend." "Navegador" {
                    containerInstance sistema.frontend
                }
                deploymentNode "Proceso de entrada" "localhost:8080." "Proceso Node.js" {
                    containerInstance sistema.apiGateway
                }
                deploymentNode "Procesos privados" "Escuchan solo en 127.0.0.1 (3001-3006) y exigen token de servicio." "Procesos Node.js" {
                    containerInstance sistema.authService
                    containerInstance sistema.graphqlGateway
                    containerInstance sistema.inventory
                    containerInstance sistema.orders
                    containerInstance sistema.clients
                    containerInstance sistema.payments
                }
                deploymentNode "MongoDB 7 local" "127.0.0.1:27027, autenticacion, datos en local-data/mongo, un usuario por base." "mongod" {
                    containerInstance sistema.dbInventory
                    containerInstance sistema.dbOrders
                    containerInstance sistema.dbClients
                    containerInstance sistema.dbPayments
                    containerInstance sistema.dbIdentity
                }
                deploymentNode "Archivos de secretos" "./secrets (ignorado por git); cada proceso recibe solo las rutas que usa." "Sistema de archivos" {
                    containerInstance sistema.secretManager
                }
            }
        }
    }

    views {
        systemContext sistema "C1_Contexto" {
            title "C1 - Contexto de Fukusuke Sushi Delivery"
            include *
            autoLayout lr
        }
        container sistema "C2_Contenedores" {
            title "C2 - Contenedores"
            include *
            autoLayout lr
        }
        container sistema "C2_Catalogo" {
            include visitante cliente sistema.frontend sistema.apiGateway sistema.authService sistema.inventory sistema.dbInventory
            autoLayout lr
        }
        container sistema "C2_Pedidos" {
            include cliente proveedorPagos sistema.frontend sistema.apiGateway sistema.authService sistema.orders sistema.inventory sistema.clients sistema.payments sistema.dbOrders sistema.dbInventory sistema.dbPayments
            autoLayout lr
        }
        component sistema.apiGateway "C3_API_Gateway" {
            title "C3 - API Gateway"
            include *
            autoLayout lr
        }
        component sistema.graphqlGateway "C3_GraphQL" {
            title "C3 - GraphQL Gateway"
            include *
            autoLayout lr
        }
        component sistema.authService "C3_Auth" {
            title "C3 - auth"
            include *
            autoLayout lr
        }
        component sistema.orders "C3_Orders" {
            title "C3 - orders"
            include *
            autoLayout lr
        }

        // Vistas dinamicas: cada una corresponde a pruebas ejecutadas (docs/evidencias).
        dynamic sistema "D_F01_Exito" "Prueba P01." {
            title "F01 - Catalogo: exito"
            1: visitante -> sistema.frontend "Abre el menu"
            2: sistema.frontend -> sistema.apiGateway "GET /api/v1/products?available=true" "HTTP"
            3: sistema.apiGateway -> sistema.inventory "GET /products + token de servicio" "HTTP/JSON"
            4: sistema.inventory -> sistema.dbInventory "Productos activos" "MongoDB"
            5: sistema.dbInventory -> sistema.inventory "Registros" "MongoDB"
            6: sistema.inventory -> sistema.apiGateway "Productos publicos (sin stock exacto)" "HTTP/JSON"
            7: sistema.apiGateway -> sistema.frontend "200 + x-request-id" "HTTP"
            8: sistema.frontend -> visitante "Muestra la carta"
            autoLayout lr
        }
        dynamic sistema "D_F01_Recuperacion" "evidencias/fallas-dependencias.md pasos 2 y 6." {
            title "F01 - Inventory no responde y se recupera"
            1: visitante -> sistema.frontend "Abre el menu"
            2: sistema.frontend -> sistema.apiGateway "GET /api/v1/products" "HTTP"
            3: sistema.apiGateway -> sistema.inventory "Sin respuesta en 5 s" "HTTP/JSON"
            4: sistema.apiGateway -> sistema.frontend "504 sin datos falsos" "HTTP"
            5: sistema.frontend -> visitante "Muestra el error"
            6: visitante -> sistema.frontend "Reintenta"
            7: sistema.frontend -> sistema.apiGateway "GET /api/v1/products" "HTTP"
            8: sistema.apiGateway -> sistema.inventory "Consulta" "HTTP/JSON"
            9: sistema.inventory -> sistema.apiGateway "Productos" "HTTP/JSON"
            10: sistema.apiGateway -> sistema.frontend "200" "HTTP"
            11: sistema.frontend -> visitante "Muestra la carta"
            autoLayout lr
        }
        dynamic sistema "D_F02_Exito" "Pruebas P19, P30, P33." {
            title "F02 - Pedido y pago: exito"
            1: cliente -> sistema.frontend "Confirma el carrito"
            2: sistema.frontend -> sistema.apiGateway "POST /api/v1/orders + Idempotency-Key" "HTTP"
            3: sistema.apiGateway -> sistema.authService "Revocacion del jti" "HTTP/JSON"
            4: sistema.authService -> sistema.apiGateway "No revocado" "HTTP/JSON"
            5: sistema.apiGateway -> sistema.orders "POST /orders + x-user-id verificado" "HTTP/JSON"
            6: sistema.orders -> sistema.clients "Direccion del titular" "HTTP/JSON"
            7: sistema.clients -> sistema.orders "Direccion" "HTTP/JSON"
            8: sistema.orders -> sistema.inventory "Precios por lote y reservas" "HTTP/JSON"
            9: sistema.inventory -> sistema.orders "Reservado" "HTTP/JSON"
            10: sistema.orders -> sistema.dbOrders "Pedido pendiente_pago con totales del servidor" "MongoDB"
            11: sistema.orders -> sistema.apiGateway "201" "HTTP/JSON"
            12: sistema.apiGateway -> sistema.frontend "201" "HTTP"
            13: sistema.frontend -> sistema.apiGateway "POST /api/v1/orders/{id}/payments" "HTTP"
            14: sistema.apiGateway -> sistema.payments "Inicia cobro" "HTTP/JSON"
            15: sistema.payments -> sistema.orders "Lee titular y total" "HTTP/JSON"
            16: proveedorPagos -> sistema.apiGateway "POST /api/v1/payments/webhook firmado" "HTTPS + HMAC"
            17: sistema.apiGateway -> sistema.payments "Aviso" "HTTP/JSON"
            18: sistema.payments -> sistema.orders "POST /internal/orders/{id}/paid" "HTTP/JSON"
            autoLayout lr
        }
        dynamic sistema "D_F02_Reintento" "Prueba P20." {
            title "F02 - Reintento con la misma clave: sin duplicar"
            1: cliente -> sistema.frontend "Reintenta tras respuesta incierta"
            2: sistema.frontend -> sistema.apiGateway "POST /api/v1/orders con la misma Idempotency-Key" "HTTP"
            3: sistema.apiGateway -> sistema.orders "Solicitud repetida" "HTTP/JSON"
            4: sistema.orders -> sistema.dbOrders "Busca (clienteId, clave)" "MongoDB"
            5: sistema.dbOrders -> sistema.orders "Pedido existente" "MongoDB"
            6: sistema.orders -> sistema.apiGateway "200 + idempotent-replay: true" "HTTP/JSON"
            7: sistema.apiGateway -> sistema.frontend "Mismo pedido" "HTTP"
            autoLayout lr
        }
        dynamic sistema.orders "D_F02_Idempotencia_C3" "Prueba P20 a nivel de componentes." {
            title "F02 - Idempotencia dentro de orders"
            1: sistema.apiGateway -> sistema.orders.ordersApi "POST repetido" "HTTP/JSON"
            2: sistema.orders.ordersApi -> sistema.orders.accessPolicy "Rol cliente"
            3: sistema.orders.accessPolicy -> sistema.orders.idempotency "Escritura autorizada"
            4: sistema.orders.idempotency -> sistema.orders.ordersRepo "Busca clave"
            5: sistema.orders.ordersRepo -> sistema.dbOrders "findOne" "MongoDB"
            6: sistema.orders.ordersRepo -> sistema.orders.idempotency "Pedido previo, misma huella"
            7: sistema.orders.idempotency -> sistema.orders.ordersApi "Sin ejecutar el workflow"
            8: sistema.orders.ordersApi -> sistema.apiGateway "200 mismo pedido" "HTTP/JSON"
            autoLayout lr
        }
        dynamic sistema "D_F03_Propio" "Prueba P23." {
            title "F03 - Pedido propio"
            1: cliente -> sistema.frontend "Abre su pedido"
            2: sistema.frontend -> sistema.apiGateway "GET /api/v1/orders/{id}" "HTTP"
            3: sistema.apiGateway -> sistema.authService "Revocacion" "HTTP/JSON"
            4: sistema.authService -> sistema.apiGateway "Sesion valida" "HTTP/JSON"
            5: sistema.apiGateway -> sistema.orders "GET /orders/{id} + x-user-id" "HTTP/JSON"
            6: sistema.orders -> sistema.dbOrders "Busca pedido" "MongoDB"
            7: sistema.dbOrders -> sistema.orders "Pedido del titular" "MongoDB"
            8: sistema.orders -> sistema.apiGateway "200" "HTTP/JSON"
            9: sistema.apiGateway -> sistema.frontend "Pedido" "HTTP"
            autoLayout lr
        }
        dynamic sistema "D_F03_Ajeno" "Prueba P24." {
            title "F03 - Pedido ajeno"
            1: cliente -> sistema.frontend "Intenta abrir el pedido de otro cliente"
            2: sistema.frontend -> sistema.apiGateway "GET /api/v1/orders/{idAjeno}" "HTTP"
            3: sistema.apiGateway -> sistema.authService "Revocacion" "HTTP/JSON"
            4: sistema.authService -> sistema.apiGateway "Sesion valida (no implica acceso)" "HTTP/JSON"
            5: sistema.apiGateway -> sistema.orders "GET /orders/{idAjeno} + x-user-id" "HTTP/JSON"
            6: sistema.orders -> sistema.dbOrders "Busca pedido" "MongoDB"
            7: sistema.dbOrders -> sistema.orders "Pedido de otro titular" "MongoDB"
            8: sistema.orders -> sistema.apiGateway "404 igual que inexistente" "HTTP/JSON"
            9: sistema.apiGateway -> sistema.frontend "404 sin datos" "HTTP"
            autoLayout lr
        }
        dynamic sistema "D_F03_Revocada" "Pruebas P11-P14 y P50." {
            title "F03 - Token invalido o sesion cerrada: rechazo temprano"
            1: cliente -> sistema.frontend "Consulta con sesion cerrada"
            2: sistema.frontend -> sistema.apiGateway "GET /api/v1/clients/me" "HTTP"
            3: sistema.apiGateway -> sistema.authService "Revocacion del jti" "HTTP/JSON"
            4: sistema.authService -> sistema.apiGateway "Revocado" "HTTP/JSON"
            5: sistema.apiGateway -> sistema.frontend "401; la solicitud nunca llega a clients" "HTTP"
            autoLayout lr
        }
        dynamic sistema "D_F04_GraphQL_Exito" "Prueba P40." {
            title "F04 - GraphQL: resumenPedido"
            1: cliente -> sistema.frontend "Abre el resumen del pedido"
            2: sistema.frontend -> sistema.apiGateway "POST /api/v1/graphql" "HTTP"
            3: sistema.apiGateway -> sistema.graphqlGateway "Consulta + identidad verificada" "HTTP/GraphQL"
            4: sistema.graphqlGateway -> sistema.orders "Pedido" "HTTP/JSON"
            5: sistema.orders -> sistema.graphqlGateway "Pedido del titular" "HTTP/JSON"
            6: sistema.graphqlGateway -> sistema.inventory "Productos (1 llamada por lote)" "HTTP/JSON"
            6: sistema.graphqlGateway -> sistema.clients "Contacto" "HTTP/JSON"
            7: sistema.inventory -> sistema.graphqlGateway "Descripciones" "HTTP/JSON"
            7: sistema.clients -> sistema.graphqlGateway "Nombre y correo" "HTTP/JSON"
            8: sistema.graphqlGateway -> sistema.apiGateway "Respuesta agregada" "HTTP/GraphQL"
            9: sistema.apiGateway -> sistema.frontend "200" "HTTP"
            autoLayout lr
        }
        dynamic sistema "D_F04_GraphQL_Parcial" "evidencias/fallas-dependencias.md paso 3." {
            title "F04 - GraphQL: inventory no responde"
            1: cliente -> sistema.frontend "Abre el resumen"
            2: sistema.frontend -> sistema.apiGateway "POST /api/v1/graphql" "HTTP"
            3: sistema.apiGateway -> sistema.graphqlGateway "Consulta" "HTTP/GraphQL"
            4: sistema.graphqlGateway -> sistema.orders "Pedido" "HTTP/JSON"
            5: sistema.orders -> sistema.graphqlGateway "Pedido" "HTTP/JSON"
            6: sistema.graphqlGateway -> sistema.inventory "Productos: sin respuesta en 2 s" "HTTP/JSON"
            7: sistema.graphqlGateway -> sistema.apiGateway "producto null + DEPENDENCIA_NO_DISPONIBLE + parcial" "HTTP/GraphQL"
            8: sistema.apiGateway -> sistema.frontend "Respuesta marcada como incompleta" "HTTP"
            autoLayout lr
        }
        dynamic sistema.graphqlGateway "D_F04_GraphQL_Limite_C3" "Prueba P43." {
            title "F04 - GraphQL: consulta excede el costo"
            1: sistema.apiGateway -> sistema.graphqlGateway.graphqlEndpoint "Consulta con 130 alias" "HTTP/GraphQL"
            2: sistema.graphqlGateway.graphqlEndpoint -> sistema.graphqlGateway.queryValidator "Mide profundidad y costo"
            3: sistema.graphqlGateway.queryValidator -> sistema.graphqlGateway.graphqlEndpoint "LIMITE_COSTO"
            4: sistema.graphqlGateway.graphqlEndpoint -> sistema.apiGateway "400 sin ejecutar resolvers" "HTTP/GraphQL"
            autoLayout lr
        }

        deployment sistema docker "DEP_Docker" {
            title "Despliegue - Docker Compose"
            include *
            autoLayout lr
        }
        deployment sistema local "DEP_Local" {
            title "Despliegue - npm run local (sin Docker)"
            include *
            autoLayout lr
        }
        styles {
            // PASO 5 - ESTILOS DE DESPLIEGUE.
            element "Deployment Node" {
                background #E9EFF5
                color #213F56
                stroke #8FA5B7
            }
            element "Infrastructure Node" {
                shape roundedbox
                background #EDF0F3
                color #334454
            }
            element "ZonaCliente" {
                background #F1F5F9
                color #173B5D
            }
            element "ZonaEntorno" {
                background #F4F6F8
                color #213F56
            }
            element "ZonaPublica" {
                background #DCEAF7
                color #173B5D
            }
            element "ZonaPrivada" {
                background #E5EEE8
                color #20513D
            }
            element "ZonaDatos" {
                background #ECEAF2
                color #463D64
            }
            element "ZonaSecretos" {
                background #EEE5E1
                color #68483C
            }
            element "ZonaLocal" {
                background #F0F3F6
                color #243F56
            }
            element "Person" {
                shape person
                background #56718A
                color #FFFFFF
            }
            element "Software System" {
                shape roundedbox
                background #0C527A
                color #FFFFFF
            }
            element "SistemaEvaluado" {
                background #173B5D
                color #FFFFFF
            }
            element "Container" {
                shape roundedbox
                background #E3ECF5
                color #173B5D
            }
            element "Frontend" {
                shape webbrowser
                background #CDE5F7
                color #153E5B
            }
            element "Gateway" {
                background #2B6289
                color #FFFFFF
            }
            element "Seguridad" {
                background #3F6171
                color #FFFFFF
            }
            element "Privado" {
                background #D5E8EF
                color #173B5D
            }
            element "BaseDatos" {
                shape cylinder
                background #E5EAF0
                color #243F56
            }
            element "SistemaExterno" {
                background #F1EDE7
                color #544633
                stroke #A89D8A
            }
            element "Analitica" {
                background #E7E0F2
                color #453166
            }

            // C3: colores funcionales para componentes internos.
            element "Component" {
                shape roundedbox
                background #EDF3F7
                color #173B5D
            }
            element "EntradaC3" {
                background #D3E9F7
                color #153F62
            }
            element "ControlC3" {
                background #DBE4EC
                color #213F56
            }
            element "AplicacionC3" {
                background #D7E9DE
                color #20533E
            }
            element "IntegracionC3" {
                background #E9E2F2
                color #4A3666
            }
            element "PersistenciaC3" {
                background #E9EBEE
                color #334454
            }
            element "ErrorC3" {
                background #F2E6DB
                color #70462C
            }
            relationship "Relationship" {
                color #60758A
                thickness 2
            }
        }
    }
}
