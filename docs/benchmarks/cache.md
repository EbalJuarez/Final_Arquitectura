# Medición: caché de disponibilidad

- **Fecha:** 2026-11-02, 16:55 hora de Guatemala.
- **Script:** `apps/api/scripts/bench-cache.ts`. Se ejecuta con `pnpm --filter @reservalab/api bench:cache`.
- **Decisión que respalda:** [ADR 0007](../adr/0007-cache-con-redis.md).

## Qué se mide

La latencia de `GET /api/v1/spaces/:id/availability?date=…` vista por el cliente, desde que se envía la solicitud hasta que llega el último byte de la respuesta. Se miden dos casos:

- **Caché vacía (MISS):** antes de cada solicitud el script borra la clave `availability:{spaceId}:{fecha}` directo en Redis, fuera del tiempo medido. Cada respuesta pasa por PostgreSQL: busca el espacio, busca las reservas del día y arma los bloques. Además intenta leer y escribir en Redis.
- **Caché caliente (HIT):** la clave ya está guardada. La respuesta sale de un `GET` a Redis y nunca toca PostgreSQL.

El script comprueba que cada respuesta sea 200 con el `X-Cache` esperado; si una no lo es, se detiene sin reportar.

## Condiciones

| | |
|---|---|
| Equipo | Laptop Intel Core i7-8550U a 1,80 GHz (4 núcleos, 8 hilos) con 16 GB de RAM, Windows 11 Home 10.0.26200 |
| Servidor | Contenedor `api` del `docker compose`: Node 22 con el bundle de producción. Corre en Docker Desktop 29.9.2 (WSL 2, 8 CPU y 7,7 GB asignados) |
| Base y caché | PostgreSQL 16 y Redis 7 en contenedores de la misma red de Docker, sin persistencia en Redis |
| Cliente | El script, en el host con Node 26.8.1. Usa `node:http` con una conexión keep-alive y envía las solicitudes una a la vez, sin concurrencia |
| Datos | Un espacio con 5 reservas confirmadas en el día consultado. La respuesta tiene 5 bloques ocupados y 5 libres (unos 1,1 kB) |
| Muestras | 20 solicitudes de calentamiento que no se cuentan, luego 200 MISS y 200 HIT |
| Autenticación | JWT. Un JWT no pasa por el límite de solicitudes, que solo aplica a las API keys |
| Percentiles | Rango más cercano: p95 es la muestra número 190 de las 200 ordenadas |

El script crea su propio usuario, espacio y reservas, y los borra al terminar junto con sus claves en Redis.

## Resultados

Tres ejecuciones seguidas contra el contenedor. Los tiempos están en milisegundos.

| Ejecución | MISS p50 | MISS p95 | HIT p50 | HIT p95 | Mejora p50 | Mejora p95 |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 6,13 | 8,39 | 2,63 | 3,91 | 2,3× | 2,1× |
| 2 | 6,07 | 8,11 | 2,27 | 3,24 | 2,7× | 2,5× |
| 3 | 5,86 | 8,44 | 2,23 | 4,38 | 2,6× | 1,9× |

Detalle de la ejecución 2:

| Caso | Solicitudes | p50 | p95 | Media | Mín | Máx |
|---|---:|---:|---:|---:|---:|---:|
| Caché vacía (MISS) | 200 | 6,07 | 8,11 | 6,39 | 5,31 | 22,52 |
| Caché caliente (HIT) | 200 | 2,27 | 3,24 | 2,42 | 1,89 | 5,24 |

Como referencia, la misma medición contra la API corriendo fuera de Docker (`pnpm dev`, con PostgreSQL y Redis en los contenedores) dio MISS p50 7,18 y p95 9,65, y HIT p50 1,88 y p95 2,56: 3,8× en los dos percentiles.

## Lectura

- **Con la caché caliente, una consulta de disponibilidad tarda unas 2,5 veces menos.** El p50 baja de unos 6 ms a unos 2,3 ms, y el p95 de unos 8,3 ms a unos 3,5 ms.
- **La mayor parte de un HIT no es la caché.** Los ~2 ms que quedan son el viaje HTTP por el puerto que publica Docker Desktop, la verificación del JWT y la serialización. Lo que ahorra la caché son las dos consultas a PostgreSQL y el cálculo de los bloques, unos 4 ms.
- **La diferencia absoluta es pequeña porque la base es pequeña y está ociosa.** Los beneficios principales están en otro lado:
  - Un HIT no usa ninguna conexión del pool de Prisma, así que la base queda libre para las escrituras.
  - Con muchas pantallas consultando la misma disponibilidad a la vez, el costo de PostgreSQL crece con la carga y el de Redis casi no cambia.
  - Esta medición es secuencial y no mide carga concurrente.
- **El peor caso de MISS (22 ms) es un valor aislado.** Aparece en una de cada ejecución, probablemente por el recolector de basura o por el planificador de Windows y WSL 2.

## Cómo repetirla

```bash
docker compose up -d                       # la API en el puerto de API_PORT (3000)
pnpm --filter @reservalab/api bench:cache
```

| Variable | Valor por defecto | Uso |
|---|---|---|
| `BENCH_BASE_URL` | `http://localhost:${API_PORT}` | Otra instancia de la API |
| `BENCH_REQUESTS` | 200 | Otra cantidad de solicitudes por caso |

> **Nota sobre el cliente:** la primera versión del script usaba `fetch` (undici) y medía unos 15 ms tanto en MISS como en HIT. En este equipo con Windows, `fetch` sumaba unos 13 ms fijos a cada solicitud contra localhost, mientras que `curl` y `node:http` respondían el mismo `/health` en 2 a 3 ms. Ese retraso del cliente tapaba la diferencia, así que el script usa `node:http`.
