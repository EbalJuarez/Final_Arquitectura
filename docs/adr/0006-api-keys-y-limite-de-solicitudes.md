# ADR 0006: API keys y límite de solicitudes para sistemas externos

- **Estado:** Aceptada
- **Fecha:** 2026-11-02

## Contexto

Algunos sistemas externos, como una pantalla en el lobby o un portal de la universidad, necesitan leer los espacios y su disponibilidad. Un sistema no es una persona: no tiene usuario ni puede renovar un access token de 15 minutos. Necesita una credencial de larga duración, con permisos acotados y que se pueda revocar. Además, un sistema mal programado puede hacer miles de solicitudes por minuto, así que hay que limitarlo.

## Decisión

**Las keys:**
- **Formato:** `rl_live_` + 32 bytes aleatorios en base64url. El prefijo permite reconocer una key filtrada en un log o en un repositorio.
- **Almacenamiento:** solo se guarda el hash SHA-256 y un prefijo de 16 caracteres para identificarla en los listados. La key completa se devuelve una única vez, al crearla. Si se pierde, se revoca y se crea otra.
- **Permisos:** son explícitos y el catálogo vive en `@reservalab/shared` (`read:spaces`, `read:now`). Hoy solo `GET /spaces` y `GET /spaces/:id/availability` aceptan key, con `read:spaces`.
- **Gestión y revocación:** solo un ADMIN con JWT puede gestionarlas. Revocar marca `revokedAt` y conserva la fila, para que quede el historial.
- **Lo que una key no alcanza:** los endpoints de gestión, de reservas y de escritura de espacios usan solo `authenticate` (JWT). Una key ni siquiera se lee en esas rutas.
- **Ambas cabeceras a la vez:** si una solicitud trae `X-API-Key`, se autentica con la key aunque también traiga un JWT. Así una key inválida nunca queda tapada por un token válido.
- **`lastUsedAt`:** se actualiza sin esperar. Un fallo al escribirlo solo se registra en el log.

**El límite de solicitudes:**
- **Ventana fija de 1 minuto por key, en Redis.** Cada minuto tiene su contador (`rate-limit:api-key:<id>:<inicio del minuto>`), y `INCR` + `EXPIRE NX` corren en una sola transacción `MULTI`. El límite viene de `API_KEY_RATE_LIMIT_PER_MINUTE`, que por defecto es 60.
- **Cabeceras:** cada respuesta con key lleva `X-RateLimit-Limit` y `X-RateLimit-Remaining`. Al superar el límite se responde `429` con `Retry-After`, que son los segundos hasta el siguiente minuto.
- **Si Redis falla o tarda más de 500 ms, la solicitud pasa** y se registra una advertencia. Comprobamos que el timeout hace falta: al detener Redis, el cliente no detectó la caída de inmediato y el comando se quedó esperando.

## Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| **Usar JWT también para los sistemas externos** | Exigiría una cuenta de usuario por sistema y renovar el token cada 15 minutos. Tampoco hay permisos más finos que el rol, y revocarlo antes de que expire no es inmediato. |
| **Hash lento (argon2 o bcrypt) para las keys** | Sirve para contraseñas, que tienen poca entropía. Una key de 256 bits aleatorios no se puede adivinar por fuerza bruta, así que un hash lento solo agregaría decenas de milisegundos a cada solicitud. Además, como argon2 usa sal, no se podría buscar la key por su hash: habría que buscar por prefijo y verificar cada candidata. |
| **Ventana deslizante o token bucket** (un `ZSET` con marcas de tiempo, o un script Lua) | Es más preciso: la ventana fija permite hasta el doble del límite en el cruce entre dos minutos. Pero exige más código y más trabajo en Redis por solicitud, y para proteger la API de un cliente desbocado la ventana fija basta. |
| **Límite en memoria del proceso** | No se comparte entre varias instancias de la API y se reinicia con cada despliegue. |
| **Rechazar las solicitudes si Redis falla** (*fail-closed*) | Una falla de un componente auxiliar dejaría sin servicio a todos los sistemas externos. Preferimos perder el límite por un rato que la disponibilidad. |

## Consecuencias

- **Una key filtrada sirve hasta que un ADMIN la revoca**, porque no vence sola. A cambio, el daño se limita a lectura y a 60 solicitudes por minuto.
- **Hay ráfagas posibles:** en el cruce entre dos minutos una key puede hacer hasta el doble del límite.
- **Mientras Redis esté caído no hay límite.** Queda una advertencia en el log por cada solicitud.
- **Validar una key cuesta una consulta a PostgreSQL** (búsqueda por el índice único del hash) más una escritura de `lastUsedAt` en segundo plano. Si el tráfico crece, se podría guardar el resultado en Redis por unos segundos.
- **Las solicitudes con JWT no cuentan para este límite.** Limitar a los usuarios queda pendiente.
