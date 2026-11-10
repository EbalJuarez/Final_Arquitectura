# ReservaLab

Sistema de reserva de laboratorios y salones (Arquitectura de Sistemas I, UMES Quetzaltenango).

> 🚧 En construcción.

## Puesta en marcha

Requisitos:
- **Docker con Docker Compose.** Es lo único necesario para levantar todo.
- **Para desarrollar o correr las pruebas fuera de Docker:** Node 22 (lo fija [`.nvmrc`](.nvmrc); `package.json` declara `"engines": { "node": ">=22" }`) y pnpm 10 (`packageManager: pnpm@10.34.9`, que se activa con `corepack enable`).

```bash
cp .env.example .env          # los valores de ejemplo sirven para probar en local; cambiarlos fuera de la demo
docker compose up --build     # PostgreSQL, Redis, Mockoon, la API (:3000) y la web (:8080); migra y corre el seed
```

### Credenciales del seed (solo desarrollo)

Al arrancar, la API crea estas cuentas si no existen. Todas usan la contraseña de `SEED_USER_PASSWORD` (en `.env.example`: `clave_de_prueba_falsa`):

| Email | Rol |
|---|---|
| `admin@reservalab.test` | ADMIN |
| `docente@reservalab.test` | DOCENTE |
| `estudiante@reservalab.test` | ESTUDIANTE |

También crea tres espacios (Laboratorio de Computación 1, Laboratorio de Redes y Salón 201) y la API key de la pantalla informativa con el valor de `VITE_INFO_API_KEY`, que solo tiene el permiso `read:now`.

La web queda en http://localhost:8080 y la API en http://localhost:3000/api/v1. La web también llega a la API por http://localhost:8080/api, porque nginx la reenvía.

La documentación interactiva queda en http://localhost:3000/docs (Swagger UI) y el documento OpenAPI en http://localhost:3000/docs/openapi.json. Se genera desde los esquemas Zod de `packages/shared` ([ADR 0008](docs/adr/0008-documentacion-openapi-desde-zod.md)). En Swagger UI, **Authorize** acepta un access token (`bearerAuth`) o una API key (`apiKeyAuth`).

- Al arrancar, el contenedor `api` espera a que PostgreSQL y Redis estén sanos, aplica las migraciones pendientes (`prisma migrate deploy`), corre el seed y luego inicia el servidor. Si la migración o el seed fallan, la API no arranca.
- El seed es idempotente: busca usuarios por email, espacios por nombre y edificio y la key por su hash, y solo crea lo que falta. No modifica lo que ya existe, así que correrlo en cada arranque no duplica nada. Si se borra un espacio de ejemplo, vuelve a aparecer en el siguiente arranque.
- Dentro de Docker la API usa los hosts `postgres`, `redis` y `mockoon`. El servicio `api` reemplaza las URL de `.env`, que apuntan a `localhost`.
- `docker compose down -v` borra también la base. La próxima vez que arranque se aplican de nuevo las migraciones y el seed.
- `docker-compose.yml` fija `name: reservalab`, así que dos copias del repo en carpetas distintas comparten contenedores y volumen. Antes de probar en otra carpeta hay que ejecutar `docker compose down -v` en la primera.

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

1. **Base (`base`):** Node 22 Alpine con OpenSSL, que necesitan los motores de Prisma, y pnpm activado con corepack.
2. **Build (`build`):** instala las dependencias con pnpm (solo las de la API y `shared`). Después `esbuild` empaqueta la API y `@reservalab/shared` en `dist/`, `pnpm deploy --prod` prepara las dependencias de producción, se genera el cliente de Prisma y se borran los motores WASM que no se usan.
3. **Imagen final (`runtime`):** Node 22 Alpine con OpenSSL, el bundle, el esquema con las migraciones y las dependencias de producción. Corre como el usuario `node`.

## Pruebas

```bash
pnpm typecheck          # tipos de todos los paquetes
pnpm test               # pruebas unitarias (no usan la base ni la red)
pnpm test:coverage      # las mismas, con cobertura por paquete y umbral
pnpm test:integration   # pruebas de integración contra PostgreSQL y Redis reales
pnpm test:integration:mockoon  # avisos de reservas contra el Mockoon real (docker compose up -d); se omiten si Mockoon no responde
```

`pnpm test:coverage` corre Vitest con cobertura en cada paquete vía Turborepo y al final imprime una tabla por paquete. El umbral está en un solo lugar, [`coverage.thresholds.json`](coverage.thresholds.json):
- **Valor:** 70 % en lines, statements, branches y functions.
- **A quién se exige:** por ahora solo a la API. Si algún paquete exigido queda por debajo, el comando falla.
- **Cómo cambiarlo:** para exigirlo también a la CLI o a la web, se agrega `@reservalab/cli` o `@reservalab/web` a `enforcedPackages`. Las métricas se cambian en `metrics`.

El reporte HTML de cada paquete queda en `apps/<paquete>/coverage/index.html`.

En GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)), cada push y cada pull request corren dos jobs, con Node 22 (de `.nvmrc`):
- **Verificación:** `pnpm typecheck` como lint, porque el repo no tiene ESLint; después `pnpm test` y `pnpm test:coverage`.
- **Integración:** `pnpm test:integration` con PostgreSQL 16 y Redis 7 como servicios, y después `pnpm test:integration:mockoon` con Mockoon levantado por `docker run` en un paso del job.

Las pruebas de integración necesitan `docker compose up -d`, las migraciones aplicadas y el `.env` de la raíz. Por seguridad, solo corren si `DATABASE_URL` apunta a `localhost`. Cada ejecución crea su propio usuario y espacio, y los borra al terminar, junto con sus claves en Redis. Los archivos corren uno a la vez (`fileParallelism: false` en `apps/api/vitest.integration.config.ts`): comparten Redis, y la clave de `/now` es una sola para todos los espacios, así que en paralelo un archivo podría llenarla entre el borrado y la consulta de otro. Hoy comprueban tres cosas:
- Dos `POST /reservations` simultáneos al mismo horario dan exactamente un 201 y un 409.
- El ciclo de vida de una API key: crearla, llamar a `/now` (200), revocarla y volver a llamar (401). También que una key sin `read:now` recibe 403.
- La caché de disponibilidad:
  - Dos consultas seguidas dan `MISS` y luego `HIT`.
  - Después de reservar, la consulta da `MISS` y ya muestra el bloque ocupado. Después de cancelar vuelve a estar libre.
  - Reservar en un espacio no toca la caché de otro.
  - `GET /spaces` y `GET /now` también dan `MISS` y luego `HIT`.
  - Los 404 y 400 no se guardan.

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

### Medición de latencia

`apps/api/scripts/bench-cache.ts` hace 200 solicitudes de disponibilidad con la caché vacía y 200 con la caché caliente, y reporta p50 y p95 de cada caso. Crea sus propios datos y los borra al terminar.

```bash
docker compose up -d
pnpm --filter @reservalab/api bench:cache                                       # contra la API del contenedor
BENCH_BASE_URL=http://localhost:3010 pnpm --filter @reservalab/api bench:cache  # contra otra instancia
```

En el equipo de desarrollo, el p50 bajó de unos 6 ms (MISS) a unos 2,3 ms (HIT). Las condiciones y los resultados completos están en [docs/benchmarks/cache.md](docs/benchmarks/cache.md).

## CLI de administración

`apps/cli` es una herramienta de línea de comandos para el administrador. Solo habla con la API por HTTP y valida entradas y respuestas con los esquemas de `@reservalab/shared`; nunca accede a la base.

```bash
pnpm cli login                                                     # pide correo y contraseña (sin eco)
pnpm cli spaces list --building "Edificio A" --min-capacity 20
pnpm cli spaces create --name "Laboratorio de Redes" --building "Edificio A" --capacity 30
pnpm cli spaces delete <id>
pnpm cli keys create --name "Pantalla del Edificio A" --permissions read:now,read:spaces
pnpm cli keys list
pnpm cli keys revoke <id>
pnpm cli --help                                                    # ayuda; también `pnpm cli keys create --help`
```

- **URL de la API:** `RESERVALAB_API_URL` (por defecto `http://localhost:3000`).
- **Sesión:**
  - `login` guarda el correo y los tokens en `~/.reservalab/config.json`, con permisos `600` y la carpeta con `700`. En Windows esos permisos no aplican, y el archivo queda protegido por los permisos del perfil del usuario.
  - `RESERVALAB_CONFIG_DIR` cambia la carpeta.
  - Si la sesión guardada es de otra URL de la API, hay que volver a iniciar sesión.
- **Tokens:** cuando el access token (15 min) expira, el CLI lo renueva una sola vez con el refresh token y repite la solicitud. Si el refresh token tampoco sirve, pide volver a ejecutar `pnpm cli login`.
- **API keys:** `keys create` imprime la key completa **una sola vez**, con una advertencia: la API solo guarda su hash. La key va a stdout y los avisos a stderr, así que se puede guardar con `pnpm -s cli keys create ... > key.txt`.
- **Errores:** se muestran como `Error CODIGO (HTTP estado): mensaje`, con los campos inválidos debajo, y el comando termina con código de salida 1. Los datos se validan antes de enviarlos.
- **Salida procesable:** `--json` imprime los datos en JSON por stdout y los errores como `{ "error": { code, message, status } }` por stderr. Con `pnpm -s` se oculta la línea que pnpm agrega al ejecutar el script:

  ```bash
  pnpm -s cli spaces list --json | jq '.[].name'
  ```

- **Sin terminal** (en un script), `login` lee el correo y la contraseña como dos líneas de la entrada estándar:

  ```bash
  printf '%s\n%s\n' "$EMAIL" "$PASSWORD" | pnpm -s cli login
  ```

## Web

`apps/web` es la web: Vite, HTML, TypeScript y CSS propios, sin frameworks ([ADR 0009](docs/adr/0009-web-sin-frameworks.md)). Tiene tres pantallas, con rutas por hash:

| Ruta | Pantalla |
|---|---|
| `#/login` | Iniciar sesión o crear una cuenta. Las cuentas nuevas son `ESTUDIANTE` |
| `#/reservas` | Espacios con filtros, fecha, bloques libres y ocupados del día, formulario de reserva (solo `DOCENTE` y `ADMIN`) y "Mis reservas" con el botón para cancelar. Hoy, lo que ya pasó aparece como "Ya pasó" |
| `#/pantalla` | Pantalla informativa para los edificios. No pide sesión y se actualiza cada 30 s: qué espacios están ocupados, hasta qué hora y la siguiente reserva |

- **Cliente de API:** todas las llamadas pasan por `apps/web/src/api.ts`.
  - Guarda los tokens en `localStorage`.
  - Si el access token expira, lo renueva con el refresh token y repite la solicitud. Si el refresh token tampoco sirve, vuelve al login.
  - "Cerrar sesión" llama a `POST /auth/logout`.
- **Mensajes:** un 409 se muestra como "Ese horario ya está ocupado" y un 403 como "No tienes permiso para hacer esto". Si no hay red o la API está caída, aparece "No se pudo conectar con el servidor".
- **Seguridad del texto:** el texto de la API nunca se inserta con `innerHTML`, solo como nodo de texto, y una prueba lo comprueba.

### Demo

1. `.env.example` trae una key de demo en `VITE_INFO_API_KEY` que funciona tal cual. Fuera de la demo, genera una propia:

   ```bash
   node -e "console.log('rl_live_' + require('crypto').randomBytes(32).toString('base64url'))"
   ```

2. Levanta todo con `docker compose up --build`. El seed corre solo y crea:
   - `admin@reservalab.test`, `docente@reservalab.test` y `estudiante@reservalab.test`, con la contraseña `SEED_USER_PASSWORD`.
   - Tres espacios de ejemplo.
   - La API key **"Pantalla informativa (demo)"**, con el valor de `VITE_INFO_API_KEY` y **solo el permiso `read:now`**. Esa key queda dentro del JavaScript público de la web, así que no sirve para nada más. Si cambia, hay que reconstruir la web y reiniciar la API (`docker compose up --build web api`).
3. Si quieres más espacios, créalos como ADMIN con `pnpm cli spaces create …` o en http://localhost:3000/docs.
4. En http://localhost:8080:
   - Entra como `docente@reservalab.test`.
   - Elige un espacio y una fecha, toca "Reservar en este bloque" y ajusta el horario.
   - Mira "Mis reservas" y cancela.
   - Abre "Pantalla informativa".

### Desarrollo

```bash
pnpm --filter @reservalab/web dev     # http://localhost:5173; Vite reenvía /api a http://localhost:3000
pnpm --filter @reservalab/web build   # archivos estáticos en apps/web/dist
```

Vite lee `VITE_INFO_API_KEY` del `.env` de la raíz. `API_PROXY_TARGET` cambia a dónde reenvía `/api`.

## Documentación

- **[Documento de arquitectura](docs/arquitectura.md):** contexto, contenedores, capas de la API, modelo de datos, flujos clave, atributos de calidad medidos y limitaciones conocidas.
- **Decisiones de arquitectura (ADR)** en [`docs/adr/`](docs/adr/):
  - [ADR 0001: Express 5, Prisma 6 y monorepo con pnpm y Turborepo](docs/adr/0001-express-prisma-monorepo.md)
  - [ADR 0002: Autenticación con access token JWT y refresh token opaco](docs/adr/0002-autenticacion-jwt.md)
  - [ADR 0003: Borrado de espacios con reservas](docs/adr/0003-borrado-de-espacios.md)
  - [ADR 0004: Protección contra reservas traslapadas en dos niveles](docs/adr/0004-proteccion-de-traslapes.md)
  - [ADR 0005: Notificaciones tolerantes a fallos](docs/adr/0005-notificaciones-tolerantes-a-fallos.md)
  - [ADR 0006: API keys y límite de solicitudes para sistemas externos](docs/adr/0006-api-keys-y-limite-de-solicitudes.md)
  - [ADR 0007: Caché de lecturas con Redis](docs/adr/0007-cache-con-redis.md)
  - [ADR 0008: Documentación OpenAPI generada desde los esquemas Zod](docs/adr/0008-documentacion-openapi-desde-zod.md)
  - [ADR 0009: Web en TypeScript sin frameworks, servida por nginx](docs/adr/0009-web-sin-frameworks.md)
- **Mediciones** en [`docs/benchmarks/`](docs/benchmarks/): [latencia con y sin caché](docs/benchmarks/cache.md).
- **API:** Swagger UI en http://localhost:3000/docs con la pila levantada.

## Reparto por integrante

Según el historial de Git. El repositorio no tiene pull requests ni merges: todo el trabajo entró directo a `main`, salvo el cierre de la entrega, que está en la rama `chore/cierre-entrega`.

| Integrante | Responsabilidad | Evidencia (ramas/PR) |
|---|---|---|
| EbalJuarez `<COMPLETAR: nombre completo y carné>` | Estructura inicial del monorepo y Docker Compose; esquema de Prisma con la migración anti-traslape; autenticación JWT con refresh token; reservas con notificaciones y reintento ante deadlock; caché con Redis y su medición de latencia; ADR 0002, 0004, 0005 y 0007. En la rama de cierre: seed automático, `test:coverage` y CI, ADR 0001, documento de arquitectura y prueba de clon limpio. Otras contribuciones: `<COMPLETAR: otras contribuciones>` | `main`: 39 commits, de `a059867` (2026-10-28) a `3d1e30d` (2026-11-02), sobre todo en `apps/api`, infraestructura y `docs/adr`. `chore/cierre-entrega`: 25 commits, de `9bddd25` a `4ef62ef` (2026-11-09), hechos con Claude Code bajo su usuario de Git. |
| Gorozco710 `<COMPLETAR: nombre completo y carné>` | Espacios (esquemas, CRUD con filtros y disponibilidad diaria); API keys con permisos y límite por minuto en Redis; `GET /now`; CLI de administración; ADR 0003 y 0006. Otras contribuciones: `<COMPLETAR: otras contribuciones>` | `main`: 20 commits, de `d99c23a` a `90d1efc` (2026-11-02), en `apps/api`, `apps/cli`, `packages/shared` y `docs/adr`. |
| Yoshua-G12 `<COMPLETAR: nombre completo y carné>` | Documentación OpenAPI en `/docs` y su prueba; la web (login, reservas y pantalla informativa) y su servicio con nginx; key de la pantalla informativa en el seed; ADR 0008 y 0009. Otras contribuciones: `<COMPLETAR: otras contribuciones>` | `main`: 12 commits, de `5717d59` a `72c4a19` (2026-11-02), principalmente en `apps/web`, y también en `apps/api`, `packages/shared` y `docs/adr`. |

## Uso de inteligencia artificial

En este proyecto usamos dos herramientas de IA de Anthropic:

- **Claude (chat):** para planificar el trabajo y revisar decisiones, código y documentación.
- **Claude Code:** para generar y modificar código, pruebas, configuración y documentación del repositorio.

Lo usamos bajo la dirección de `<COMPLETAR: quién o quiénes>`, que definían cada tarea y sus criterios de aceptación. Todo cambio pasó por revisión humana antes de integrarse. Los commits no llevan línea de coautoría de la IA, así que esta sección es el registro de su uso.

- **Partes en las que se usó:** Claude (chat) para planificar fases, redactar prompts y revisar resultados. Claude Code para generar y modificar código, pruebas, ADR, documentación y configuración de Docker, siguiendo esos prompts.
- **Cómo se verificó:** revisión humana de cada fase, pruebas unitarias y de integración con Vitest, cobertura con umbral de 70 % en la API, y prueba completa desde un clon limpio con `docker compose up`.
- **Partes hechas sin IA:** `<COMPLETAR, o borrar si no aplica>`.
