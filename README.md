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
