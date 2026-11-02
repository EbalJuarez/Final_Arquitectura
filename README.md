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
docker compose up -d postgres redis mockoon       # PostgreSQL (host 5433), Redis (6379) y Mockoon (3001)
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

Las pruebas de integración necesitan `docker compose up -d`, las migraciones aplicadas y el `.env` de la raíz. Por seguridad, solo corren si `DATABASE_URL` apunta a `localhost`. Cada ejecución crea su propio usuario y espacio, y los borra al terminar. Hoy comprueban que dos `POST /reservations` simultáneos al mismo horario dan exactamente un 201 y un 409.

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

Todas las rutas están bajo `/api/v1/spaces` y exigen access token.

| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| GET | `/spaces?building=&minCapacity=` | Cualquiera | `200` con la lista. `building` no distingue mayúsculas; ambos filtros son opcionales |
| POST | `/spaces` | ADMIN | `201` con el espacio. Cuerpo `{ name, building, capacity }` |
| PATCH | `/spaces/:id` | ADMIN | `200` con el espacio. Cuerpo con al menos uno de los tres campos · `404` si no existe |
| DELETE | `/spaces/:id` | ADMIN | `204` · `409` si tiene reservas CONFIRMED en curso o futuras · `404` si no existe |
| GET | `/spaces/:id/availability?date=YYYY-MM-DD` | Cualquiera | `200` con los bloques ocupados y libres · `400` si la fecha no es válida · `404` si el espacio no existe |

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
