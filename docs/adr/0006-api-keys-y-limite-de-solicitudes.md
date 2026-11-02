# ADR 0006: API keys y límite de solicitudes para sistemas externos

- **Estado:** Aceptada
- **Fecha:** 2026-11-02

## Contexto

Algunos sistemas externos necesitan leer datos de ReservaLab sin intervención de una persona: la pantalla informativa de cada edificio (`GET /now`) o un portal que muestra espacios y disponibilidad. Un sistema no es un usuario. No tiene contraseña ni puede renovar un access token de 15 minutos. Necesita una credencial de larga duración, con permisos acotados, que se pueda revocar al instante. Además, un sistema mal programado puede hacer miles de solicitudes por minuto, así que hay que limitarlo.

## Decisión

### Formato
`rl_live_` + 32 bytes aleatorios de `crypto.randomBytes` en base64url, que da 51 caracteres. El prefijo fijo cumple dos funciones:
- Hace la key reconocible si se filtra en un log, un chat o un repositorio, y los escáneres de secretos pueden buscarla por ese prefijo.
- Permite descartar sin consultar la base cualquier valor que no empiece así.

### Almacenamiento con hash SHA-256
La base guarda solo el **SHA-256 en hexadecimal** de la key, en una columna con índice único, y la autenticación busca por ese hash. Si alguien obtiene una copia de la base, no puede usar las keys.

**Por qué no bcrypt ni argon2**, que sí usamos para las contraseñas:
- **No aportan seguridad aquí.** Un hash lento protege secretos de poca entropía, como las contraseñas que eligen las personas, contra ataques de diccionario. Una key de 256 bits aleatorios no se puede adivinar ni con un hash rápido: no hay diccionario posible.
- **No permiten buscar por hash.** bcrypt y argon2 usan una sal aleatoria, así que la misma key da un hash distinto cada vez. Habría que buscar candidatas por prefijo y verificar cada una con un hash lento.
- **Cuestan en cada solicitud.** Las keys se verifican en cada llamada, no una vez por sesión como el login. Un hash lento sumaría decenas de milisegundos de CPU a cada solicitud.

### Prefijo de identificación
Además del hash se guardan los primeros 16 caracteres, por ejemplo `rl_live_Y32_ykYr`. Sirven para que el ADMIN reconozca cuál key es cuál en el listado y en los logs, por ejemplo al decidir cuál revocar. No sirven para autenticar: 8 caracteres de 43 no permiten reconstruir el resto.

### Mostrar la key una sola vez
La key completa solo aparece en la respuesta de `POST /api-keys`. El listado devuelve prefijo, nombre, permisos, `lastUsedAt` y `revokedAt`, nunca la key ni su hash. Como la base no la tiene, nadie puede recuperarla: si se pierde, se revoca y se crea otra.

### Permisos explícitos
Cada key tiene una lista de permisos tomados de un catálogo cerrado en `@reservalab/shared`:

| Permiso | Da acceso a |
|---|---|
| `read:now` | `GET /now` (pantalla informativa) |
| `read:spaces` | `GET /spaces` y `GET /spaces/:id/availability` |

Ningún permiso da acceso a gestión ni a reservas. Esas rutas solo usan `authenticate` (JWT), así que una key ni siquiera se lee en ellas. `GET /now` solo acepta key. Las lecturas de espacios aceptan un JWT o una key, y si llegan las dos cabeceras se usa la key, para que una key inválida no quede tapada por un token válido.

### Gestión y revocación
Solo un ADMIN con JWT crea, lista y revoca keys. Revocar marca `revokedAt` sin borrar la fila, para conservar el historial. Desde ese momento la key responde 401. `lastUsedAt` se actualiza sin esperar, así que la respuesta no se retrasa, y si la escritura falla solo queda en el log.

### Límite de solicitudes con paso libre si Redis falla (*fail-open*)
- **Ventana fija de 1 minuto por key, en Redis.** Cada minuto tiene su contador (`rate-limit:api-key:<id>:<inicio del minuto>`), y `INCR` + `EXPIRE NX` corren en una sola transacción `MULTI`. El límite viene de `API_KEY_RATE_LIMIT_PER_MINUTE`, que por defecto es 60.
- **Cabeceras:** cada respuesta lleva `X-RateLimit-Limit` y `X-RateLimit-Remaining`. Al superar el límite se responde `429` con `Retry-After`.
- **Fail-open:** si Redis falla o tarda más de 500 ms, la solicitud pasa y se registra una advertencia. El timeout hace falta: al detener Redis, el cliente no detectó la caída de inmediato y el comando se quedó esperando.

## Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| **OAuth2 client credentials** (el sistema canjea `client_id` y `client_secret` por un access token de corta duración) | Es el estándar para comunicación entre máquinas y separa bien la credencial del token. Pero obliga a construir y operar un servidor de autorización (endpoint `/token`, emisión, expiración y alcances) y a que cada cliente implemente el canje y la renovación. Una pantalla informativa necesita una sola cabecera fija. Para el alcance del proyecto, con lectura y pocos sistemas, es demasiado. Si en el futuro hay integraciones de terceros con escritura, sería la evolución natural. |
| **JWT de larga duración** (firmado con el mismo secreto, con vencimiento de meses o sin él) | Un JWT es válido mientras la firma lo sea: revocarlo exige una lista negra consultada en cada solicitud, y con eso se pierde la ventaja de no consultar la base. Si se filtra, sirve hasta que vence, y rotar el secreto invalidaría también los tokens de todos los usuarios. Además, su contenido es legible en base64, y un vencimiento largo choca con la política de 15 minutos del ADR 0002. |
| **bcrypt o argon2 para las keys** | Explicado arriba: no agregan seguridad a un secreto de 256 bits, impiden buscar por hash y cuestan en cada solicitud. |
| **Guardar la key cifrada o en claro** para poder mostrarla de nuevo | Si se filtra la base o la clave de cifrado, se filtran todas las keys. Mostrarla una vez es la práctica habitual de los proveedores de API. |
| **Ventana deslizante o token bucket** (un `ZSET` con marcas de tiempo, o un script Lua) | Es más preciso: la ventana fija permite hasta el doble del límite en el cruce entre dos minutos. Pero exige más código y más trabajo en Redis por solicitud, y para frenar a un cliente desbocado la ventana fija basta. |
| **Límite en memoria del proceso** | No se comparte entre varias instancias de la API y se reinicia con cada despliegue. |
| **Rechazar las solicitudes si Redis falla** (*fail-closed*) | Una falla del componente auxiliar dejaría sin servicio a todas las pantallas e integraciones. Preferimos perder el límite por un rato que la disponibilidad, porque las keys solo leen. |

## Consecuencias

- **Una key filtrada sirve hasta que un ADMIN la revoca**, porque no vence sola. A cambio, el daño se limita a lectura y a 60 solicitudes por minuto, y la revocación es inmediata.
- **Hay ráfagas posibles:** en el cruce entre dos minutos una key puede hacer hasta el doble del límite.
- **Mientras Redis esté caído no hay límite.** Queda una advertencia en el log por cada solicitud.
- **Validar una key cuesta una consulta a PostgreSQL** (búsqueda por el índice único del hash) más una escritura de `lastUsedAt` en segundo plano. Si el tráfico crece, se podría guardar el resultado en Redis por unos segundos.
- **Las solicitudes con JWT no cuentan para este límite.** Limitar a los usuarios queda pendiente.
- **La lógica de `/now` es una función pura** que recibe la hora actual (`buildNowResponse`). Las pruebas fijan cualquier instante, incluidos los bordes exactos y el cambio de día en Guatemala.
