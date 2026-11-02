# ReservaLab

Sistema de reserva de laboratorios y salones (Arquitectura de Sistemas I, UMES Quetzaltenango).

> 🚧 En construcción.

## Puesta en marcha

Requisitos: Node 22, pnpm 10 y Docker.

```bash
cp .env.example .env               # y reemplazar los valores de ejemplo
pnpm install
docker compose up -d               # PostgreSQL (host 5433), Redis (6379) y Mockoon (3001)
pnpm --filter @reservalab/api db:deploy   # aplica las migraciones
pnpm --filter @reservalab/api db:seed     # crea admin@, docente@ y estudiante@reservalab.test
pnpm --filter @reservalab/api dev         # API en http://localhost:3000/api/v1
```

Pruebas y tipos: `pnpm test` y `pnpm typecheck` desde la raíz.

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
