# ReservaLab

Sistema de reserva de laboratorios y salones (Arquitectura de Sistemas I, UMES Quetzaltenango).

> 🚧 En construcción.

## Puesta en marcha

Requisitos: Docker. Para desarrollar fuera de Docker también hacen falta Node 22 y pnpm 10.

```bash
cp .env.example .env                        # y reemplazar los valores de ejemplo
docker compose up --build                   # PostgreSQL, Redis, Mockoon y la API en http://localhost:3000/api/v1
docker compose exec api node dist/seed.js   # crea admin@, docente@ y estudiante@reservalab.test
```

- Al arrancar, el contenedor `api` espera a que PostgreSQL y Redis estén sanos, aplica las migraciones pendientes (`prisma migrate deploy`) y luego inicia el servidor.
- El seed no corre solo, porque crea usuarios con una contraseña conocida (`SEED_USER_PASSWORD`). Es idempotente: si los usuarios ya existen no los modifica, así que se puede repetir sin problema.
- Dentro de Docker la API usa los hosts `postgres`, `redis` y `mockoon`. El servicio `api` reemplaza las URL de `.env`, que apuntan a `localhost`.
- `docker compose down -v` borra también la base. La próxima vez que arranque se aplican de nuevo las migraciones, y hay que volver a correr el seed.

### Desarrollo sin el contenedor de la API

Para tener recarga automática, se levantan solo los servicios de apoyo y la API corre con `tsx`. Si el contenedor `api` está corriendo, ocupa el puerto 3000: hay que detenerlo antes con `docker compose stop api`.

```bash
pnpm install
docker compose up -d postgres redis mockoon       # PostgreSQL (host 5433), Redis (6379, sin persistencia) y Mockoon (3001)
pnpm --filter @reservalab/api db:deploy           # aplica las migraciones
pnpm --filter @reservalab/api db:seed             # mismo seed que en Docker
pnpm --filter @reservalab/api dev                 # API en http://localhost:3000/api/v1
```

La imagen se define en [`apps/api/Dockerfile`](apps/api/Dockerfile) y tiene tres etapas:

1. **Instalación:** instala con pnpm.
2. **Build:** `esbuild` empaqueta la API y `@reservalab/shared` en `dist/`.
3. **Imagen final:** solo Node 22 Alpine, el bundle, las migraciones y las dependencias de producción.

## Pruebas

```bash
pnpm typecheck          # tipos de todos los paquetes
pnpm test               # pruebas unitarias con cobertura (no usan la base ni la red)
pnpm test:integration   # pruebas de integración contra PostgreSQL real
```

Las pruebas de integración necesitan `docker compose up -d`, las migraciones aplicadas y el `.env` de la raíz. Por seguridad, solo corren si `DATABASE_URL` apunta a `localhost`. Cada ejecución crea su propio usuario y espacio, y los borra al terminar. Hoy comprueban dos cosas:
- Dos `POST /reservations` simultáneos al mismo horario dan exactamente un 201 y un 409.
- El ciclo de vida de una API key: crearla, llamar a `/now` (200), revocarla y volver a llamar (401). También que una key sin `read:now` recibe 403.

Las utilidades comunes (servidor en un puerto libre, Redis conectado y usuario de prueba con token) están en `apps/api/test/integration/helpers.ts`.

## Autenticación

Todas las rutas están bajo `/api/v1/auth`. El diseño se explica en [ADR 0002](docs/adr/0002-autenticacion-jwt.md).

| Método | Ruta | Requiere access token | Cuerpo | Respuesta |
|---|---|---|---|---|
| POST | `/register` | No | `{ email, name, password }` | `201` con el usuario creado (siempre con rol ESTUDIANTE) · `409` si el correo existe |
| POST | `/login` | No | `{ email, password }` | `200` `{ accessToken, refreshToken }` · `401` si las credenciales son incorrectas |
| POST | `/refresh` | No | `{ refreshToken }` | `200` `{ accessToken }` · `401` si no existe, expiró o fue revocado |
| POST | `/logout` | Sí | `{ refreshToken }` | `204` · `401` si el token no existe, ya fue revocado o es de otro usuario |
| GET | `/me` | Sí | — | `200` con el usuario autenticado |

- **Access token:** JWT de 15 minutos con `sub` (id del usuario) y `role`. Se envía como `Authorization: Bearer <token>`.
- **Refresh token:** cadena aleatoria de 7 días. La base solo guarda su hash SHA-256.
- **Errores:** todos responden `{ "error": { "code", "message" } }`. Los errores de validación (`400 VALIDATION_ERROR`) incluyen además `details` con el campo y el problema.

### Ejemplos con curl

```bash
API=http://localhost:3000/api/v1/auth

# Registro
curl -X POST $API/register -H 'Content-Type: application/json' \
  -d '{"email":"ana@reservalab.test","name":"Ana Pérez","password":"claveSegura123"}'

# Login: guarda los dos tokens que devuelve
curl -X POST $API/login -H 'Content-Type: application/json' \
  -d '{"email":"ana@reservalab.test","password":"claveSegura123"}'
# → {"accessToken":"eyJ...","refreshToken":"nsz2UXHR..."}

ACCESS=eyJ...        # pegar el accessToken
REFRESH=nsz2UXHR...  # pegar el refreshToken

# Usuario autenticado
curl $API/me -H "Authorization: Bearer $ACCESS"

# Nuevo access token cuando el anterior expira
curl -X POST $API/refresh -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$REFRESH\"}"

# Logout: revoca el refresh token (después /refresh responde 401)
curl -X POST $API/logout -H "Authorization: Bearer $ACCESS" \
  -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}"
```

> En Git Bash de Windows, `curl -d` con acentos (`"Ana Pérez"`) envía el texto mal codificado. Para evitarlo, guarda el JSON en un archivo UTF-8 y envíalo con `--data-binary @archivo.json`.

## Espacios y disponibilidad

Todas las rutas están bajo `/api/v1/spaces`. Las de lectura aceptan un access token o una [API key](#api-keys-para-sistemas-externos) con `read:spaces`; las de escritura exigen access token de ADMIN.

| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| GET | `/spaces?building=&minCapacity=` | Cualquiera o API key | `200` con la lista. `building` no distingue mayúsculas; ambos filtros son opcionales |
| POST | `/spaces` | ADMIN | `201` con el espacio. Cuerpo `{ name, building, capacity }` |
| PATCH | `/spaces/:id` | ADMIN | `200` con el espacio. Cuerpo con al menos uno de los tres campos · `404` si no existe |
| DELETE | `/spaces/:id` | ADMIN | `204` · `409` si tiene reservas CONFIRMED en curso o futuras · `404` si no existe |
| GET | `/spaces/:id/availability?date=YYYY-MM-DD` | Cualquiera o API key | `200` con los bloques ocupados y libres · `400` si la fecha no es válida · `404` si el espacio no existe |

- **Disponibilidad:** el día de `date` se interpreta en hora de Guatemala (UTC-6, sin horario de verano). Solo se consideran las reservas CONFIRMED dentro de la ventana de operación `OPENING_HOUR`–`CLOSING_HOUR` (7 a 21 por defecto). Los bloques libres son el complemento de los ocupados y todas las horas se devuelven con desfase `-06:00`.
- **Borrado:** al borrar un espacio también se borra su historial de reservas pasadas o canceladas ([ADR 0003](docs/adr/0003-borrado-de-espacios.md)).

```bash
API=http://localhost:3000/api/v1

# Listado filtrado
curl "$API/spaces?building=Edificio%20A&minCapacity=25" -H "Authorization: Bearer $ACCESS"

# Crear (ADMIN)
curl -X POST $API/spaces -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"name":"Laboratorio de Redes","building":"Edificio A","capacity":30}'

# Disponibilidad de un día
curl "$API/spaces/<id>/availability?date=2026-11-03" -H "Authorization: Bearer $ACCESS"
# → {"date":"2026-11-03","timezone":"America/Guatemala",
#    "window":{"startsAt":"2026-11-03T07:00:00-06:00","endsAt":"2026-11-03T21:00:00-06:00"},
#    "occupied":[{"startsAt":"2026-11-03T09:00:00-06:00","endsAt":"2026-11-03T11:00:00-06:00"}],
#    "free":[{"startsAt":"2026-11-03T07:00:00-06:00","endsAt":"2026-11-03T09:00:00-06:00"},
#            {"startsAt":"2026-11-03T11:00:00-06:00","endsAt":"2026-11-03T21:00:00-06:00"}], ...}
```

## Reservas

Todas las rutas están bajo `/api/v1/reservations` y exigen access token.

| Método | Ruta | Quién | Respuesta |
|---|---|---|---|
| POST | `/reservations` | DOCENTE o ADMIN | `201` con la reserva · `400` horario inválido, en el pasado o fuera de la ventana · `404` espacio inexistente · `409` traslape |
| GET | `/reservations/me` | Cualquiera | `200` con las reservas del usuario (confirmadas y canceladas) |
| DELETE | `/reservations/:id` | El dueño o un ADMIN | `200` con la reserva en `CANCELLED` (la fila no se borra) · `403` si no es suya · `404` si no existe · `409` si ya estaba cancelada |

- **Horas:** `startsAt` y `endsAt` van en ISO 8601 con desfase (`2026-11-04T09:00:00-06:00`) o en UTC (`…Z`). La reserva debe quedar dentro de un mismo día y de la ventana de operación en hora de Guatemala.
- **Traslapes:** dos reservas CONFIRMED del mismo espacio no pueden traslaparse. Las contiguas (una termina cuando empieza la otra) sí se permiten, y las canceladas no bloquean. Se valida en el servicio y lo garantiza una restricción EXCLUDE de PostgreSQL, también ante solicitudes simultáneas ([ADR 0004](docs/adr/0004-proteccion-de-traslapes.md)).
- **Notificaciones:** al confirmar o cancelar se avisa a `NOTIFICATIONS_URL` en segundo plano. Si el servicio falla o tarda más de 2 s, el error queda en el log y la reserva se mantiene ([ADR 0005](docs/adr/0005-notificaciones-tolerantes-a-fallos.md)). En desarrollo se pueden ver con `docker compose logs mockoon`.

```bash
API=http://localhost:3000/api/v1

# Reservar (DOCENTE o ADMIN)
curl -X POST $API/reservations -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"spaceId":"<id>","startsAt":"2026-11-04T09:00:00-06:00","endsAt":"2026-11-04T11:00:00-06:00"}'

# Mis reservas
curl $API/reservations/me -H "Authorization: Bearer $ACCESS"

# Cancelar
curl -X DELETE $API/reservations/<id> -H "Authorization: Bearer $ACCESS"
```

## API keys para sistemas externos

Los sistemas externos, como una pantalla en el lobby, leen los espacios con una API key en la cabecera `X-API-Key` en lugar de un JWT. El diseño se explica en [ADR 0006](docs/adr/0006-api-keys-y-limite-de-solicitudes.md).

La key se muestra **una sola vez**, al crearla. La base guarda solo su hash SHA-256 y un prefijo para identificarla.

**Gestión.** Las rutas están bajo `/api/v1/api-keys` y son solo para ADMIN con access token. Una API key nunca puede usarlas.

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| POST | `/api-keys` | `{ name, permissions }` | `201` con la key **completa**, que no se vuelve a mostrar |
| GET | `/api-keys` | — | `200` con prefijo, nombre, permisos, `lastUsedAt` y `revokedAt` (nunca la key ni su hash) |
| DELETE | `/api-keys/:id` | — | `200` con la key revocada · `404` si no existe · `409` si ya estaba revocada |

- **Permisos:** `read:now` da acceso a [`GET /now`](#pantalla-informativa-get-now). `read:spaces` da acceso a `GET /spaces` y `GET /spaces/:id/availability`.
- **Errores:** una key inexistente, con otro formato o revocada responde `401 INVALID_API_KEY`. Una key sin el permiso necesario responde `403 FORBIDDEN`. Con una key, las reservas, la gestión y la escritura de espacios responden `401`.
- **Ambas cabeceras:** si la solicitud trae `X-API-Key` y también `Authorization`, se usa la key.

**Límite de solicitudes.** Cada key puede hacer `API_KEY_RATE_LIMIT_PER_MINUTE` solicitudes por minuto (60 por defecto), con una ventana fija que se reinicia al empezar cada minuto.
- Las respuestas incluyen `X-RateLimit-Limit` y `X-RateLimit-Remaining`.
- Al superar el límite se responde `429 RATE_LIMIT_EXCEEDED` con `Retry-After`, en segundos.
- Si Redis no está disponible, la solicitud pasa sin límite y la API registra una advertencia.
- Las solicitudes con JWT no cuentan.

```bash
API=http://localhost:3000/api/v1

# Crear (ADMIN): guarda el campo "key" de la respuesta, no se vuelve a mostrar
curl -X POST $API/api-keys -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json'   -d '{"name":"Pantalla del lobby","permissions":["read:spaces"]}'
# → {"id":"…","prefix":"rl_live_Y32_ykYr","permissions":["read:spaces"],…,"key":"rl_live_Y32_ykYr1EBh…"}

KEY=rl_live_...

# Usarla
curl -i "$API/spaces/<id>/availability?date=2026-11-10" -H "X-API-Key: $KEY"
# → X-RateLimit-Limit: 60
#   X-RateLimit-Remaining: 59

# Listar y revocar (ADMIN)
curl $API/api-keys -H "Authorization: Bearer $ACCESS"
curl -X DELETE $API/api-keys/<id> -H "Authorization: Bearer $ACCESS"
```

## Pantalla informativa: `GET /now`

Muestra el estado de todos los espacios en este momento. **Solo acepta una API key con `read:now`**: con un JWT responde 401, y con una key sin ese permiso, 403. Tiene el mismo límite por minuto que las demás rutas con key.

- **Hora actual:** la toma del reloj del servidor y la expresa en hora de Guatemala (`-06:00`). El "día" es el de Guatemala, de 00:00 a 24:00.
- **`status`:** `OCCUPIED` si hay una reserva CONFIRMED en curso, `FREE` si no. En el minuto exacto de inicio de una reserva el espacio ya está ocupado, y en el minuto exacto de fin ya está libre.
- **`occupiedUntil`:** la hora en que se libera. Si hay reservas seguidas sin hueco (9:00–10:00 y 10:00–11:00), es el fin de la última.
- **`nextReservation`:** la siguiente reserva del día que empieza cuando el espacio ya está libre, o `null` si no hay. No incluye quién reservó.

```bash
curl http://localhost:3000/api/v1/now -H "X-API-Key: $KEY"
# → {"now":"2026-11-02T15:09:48-06:00","timezone":"America/Guatemala","spaces":[
#     {"id":"…","name":"Lab Ocupado","building":"Edificio N","capacity":20,"status":"OCCUPIED",
#      "occupiedUntil":"2026-11-02T15:59:48-06:00",
#      "nextReservation":{"startsAt":"2026-11-02T16:19:48-06:00","endsAt":"2026-11-02T16:49:48-06:00"}},
#     {"id":"…","name":"Lab Libre","building":"Edificio N","capacity":20,"status":"FREE",
#      "occupiedUntil":null,"nextReservation":null}]}
```

## Caché

`GET /spaces`, `GET /spaces/:id/availability` y `GET /now` se cachean en Redis por `CACHE_TTL_SECONDS` (60 s por defecto). El diseño se explica en [ADR 0007](docs/adr/0007-cache-con-redis.md).

- **Cabecera `X-Cache`:** las respuestas 200 de estas rutas la llevan, con `MISS` si se calculó en la base y `HIT` si vino de la caché. Los errores (400, 404) no se cachean y no llevan la cabecera.
- **Caché compartida:** las respuestas no dependen del usuario, así que un JWT y una API key comparten caché.
- **Invalidación inmediata:** crear o cancelar una reserva invalida la disponibilidad de ese espacio y día, y `/now`. Crear, editar o borrar un espacio invalida el listado, su disponibilidad y `/now`. La siguiente consulta da `MISS` y ya muestra el cambio.
- **`/now` vence sola** cuando se libera un espacio o empieza una reserva, aunque no hayan pasado 60 s.
- **Si Redis no está disponible**, la API sigue respondiendo desde PostgreSQL, siempre con `X-Cache: MISS`, y registra una advertencia. Redis corre sin persistencia: solo guarda datos que se pueden reconstruir.

```bash
curl -i "$API/spaces/<id>/availability?date=2026-11-10" -H "Authorization: Bearer $ACCESS"   # X-Cache: MISS
curl -i "$API/spaces/<id>/availability?date=2026-11-10" -H "Authorization: Bearer $ACCESS"   # X-Cache: HIT
```
