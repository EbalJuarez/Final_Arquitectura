#!/usr/bin/env bash
# Prueba de clon limpio de ReservaLab.
#
# Clona una rama de este repositorio en un directorio temporal, copia .env.example a .env, levanta todo
# con `docker compose up --build` y recorre el flujo principal contra la API y la web:
#   salud, login con el admin del seed, espacios del seed, crear un espacio, disponibilidad (X-Cache
#   MISS → HIT), crear una reserva, invalidación de la caché, reserva traslapada (debe dar 409),
#   /docs, GET /now con la API key de la pantalla informativa (MISS → HIT), /now sin key (401) y la web.
# Imprime una tabla paso / esperado / obtenido / resultado y termina con código 1 si algún paso falla.
# Al final baja los contenedores del clon (con sus volúmenes e imágenes) y borra el directorio temporal.
#
# ADVERTENCIA: ejecuta `docker compose down -v` en ESTA copia del repo antes de empezar. docker-compose.yml
# fija `name: reservalab`, así que el clon usaría los mismos contenedores y el mismo volumen; para que la
# base arranque vacía, primero se borran. Eso BORRA LOS DATOS LOCALES de PostgreSQL de esta copia. Al
# terminar, la pila de esta copia queda abajo: vuelve a levantarla con `docker compose up -d`.
#
# Uso:   scripts/prueba-clon-limpio.sh [--si] [rama]
#   --si   no pide confirmación antes de borrar los datos locales
#   rama   rama a clonar; por defecto, la rama actual
# Requiere: bash, git, docker con compose y curl. Usa los puertos de .env.example (3000, 8080, 5433,
# 6379 y 3001), que deben estar libres.

set -uo pipefail

confirmed=false
if [[ "${1:-}" == "--si" ]]; then
  confirmed=true
  shift
fi

repo=$(git rev-parse --show-toplevel)
branch=${1:-$(git -C "$repo" rev-parse --abbrev-ref HEAD)}

if ! $confirmed; then
  echo "Esto ejecuta 'docker compose down -v' en $repo y BORRA los datos locales de PostgreSQL."
  read -r -p "¿Continuar? Escribe 'si': " answer
  [[ "$answer" == "si" ]] || { echo "Cancelado."; exit 1; }
fi

workdir=$(mktemp -d)
clone="$workdir/reservalab"

cleanup() {
  if [[ -f "$clone/docker-compose.yml" ]]; then
    echo "Bajando los contenedores del clon…"
    (cd "$clone" && docker compose down -v --rmi local >/dev/null 2>&1)
  fi
  rm -rf "$workdir"
}
trap cleanup EXIT

echo "Bajando la pila de esta copia (docker compose down -v)…"
(cd "$repo" && docker compose down -v >/dev/null 2>&1)

echo "Clonando la rama $branch en $clone…"
git clone --quiet --branch "$branch" "$repo" "$clone" || exit 1
cp "$clone/.env.example" "$clone/.env"

echo "Levantando con docker compose (puede tardar unos minutos)…"
if ! (cd "$clone" && docker compose up --build -d --wait >/dev/null 2>&1); then
  echo "docker compose up falló. Logs de la API:"
  (cd "$clone" && docker compose logs --tail 40 api)
  exit 1
fi

# Variables del .env del clon: contraseña del seed, key de la pantalla y puertos
set -a
# shellcheck disable=SC1091
. "$clone/.env"
set +a
api="http://localhost:${API_PORT:-3000}/api/v1"
docs="http://localhost:${API_PORT:-3000}/docs"
web="http://localhost:${WEB_PORT:-8080}"
json='Content-Type: application/json'

# Mañana en hora de Guatemala (UTC-6), dentro de la ventana de 7:00 a 21:00. GNU date o BSD date.
day=$(date -u -d '+1 day -6 hours' +%F 2>/dev/null || date -u -v+1d -v-6H +%F)

failures=0
rows=()
check() { # paso, esperado, obtenido
  local result=OK
  [[ "$3" == "$2" ]] || { result=FALLA; failures=$((failures + 1)); }
  rows+=("| $1 | $2 | $3 | $result |")
}
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
xcache() { curl -s -D - -o /dev/null "$@" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-cache"{print $2}'; }
field() { grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }

check "GET /health" 200 "$(status "$api/health")"

login=$(curl -s -X POST "$api/auth/login" -H "$json" \
  -d "{\"email\":\"admin@reservalab.test\",\"password\":\"$SEED_USER_PASSWORD\"}")
token=$(field accessToken <<<"$login")
check "Login admin@reservalab.test" "token" "$([[ -n "$token" ]] && echo token || echo "sin token")"
auth="Authorization: Bearer $token"

seeded=$(curl -s "$api/spaces" -H "$auth" | grep -o '"building"' | wc -l | tr -d ' ')
check "GET /spaces: espacios del seed" 3 "$seeded"

created=$(curl -s -w '\n%{http_code}' -X POST "$api/spaces" -H "$auth" -H "$json" \
  -d '{"name":"Laboratorio de Prueba Clon","building":"Edificio C","capacity":25}')
check "POST /spaces" 201 "$(tail -n1 <<<"$created")"
space=$(sed '$d' <<<"$created" | field id)

availability="$api/spaces/$space/availability?date=$day"
first=$(xcache "$availability" -H "$auth")
second=$(xcache "$availability" -H "$auth")
check "Disponibilidad dos veces (X-Cache)" "MISS→HIT" "$first→$second"

check "POST /reservations 10:00–11:00" 201 "$(status -X POST "$api/reservations" -H "$auth" -H "$json" \
  -d "{\"spaceId\":\"$space\",\"startsAt\":\"${day}T10:00:00-06:00\",\"endsAt\":\"${day}T11:00:00-06:00\"}")"

check "Disponibilidad tras reservar (X-Cache)" MISS "$(xcache "$availability" -H "$auth")"

overlap=$(curl -s -w '\n%{http_code}' -X POST "$api/reservations" -H "$auth" -H "$json" \
  -d "{\"spaceId\":\"$space\",\"startsAt\":\"${day}T10:30:00-06:00\",\"endsAt\":\"${day}T11:30:00-06:00\"}")
check "Reserva traslapada 10:30–11:30" "409 RESERVATION_OVERLAP" \
  "$(tail -n1 <<<"$overlap") $(sed '$d' <<<"$overlap" | field code)"

check "GET /docs/" 200 "$(status -L "$docs/")"
check "GET /docs/openapi.json" 200 "$(status "$docs/openapi.json")"

key="X-API-Key: $VITE_INFO_API_KEY"
now_first=$(xcache "$api/now" -H "$key")
now_second=$(xcache "$api/now" -H "$key")
check "GET /now con API key read:now" 200 "$(status "$api/now" -H "$key")"
check "GET /now dos veces (X-Cache)" "MISS→HIT" "$now_first→$now_second"
check "GET /now sin key" 401 "$(status "$api/now")"

check "Web" 200 "$(status "$web/")"
check "Web → API por nginx (/api/v1/health)" 200 "$(status "$web/api/v1/health")"

echo
echo "| Paso | Esperado | Obtenido | Resultado |"
echo "|---|---|---|---|"
printf '%s\n' "${rows[@]}"
echo
if ((failures > 0)); then
  echo "$failures paso(s) fallaron."
  exit 1
fi
echo "Todos los pasos pasaron. Vuelve a levantar esta copia con: docker compose up -d"
