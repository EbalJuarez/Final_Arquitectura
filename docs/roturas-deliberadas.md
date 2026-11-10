# Roturas deliberadas

Pruebas de que las pruebas detectan fallos. Cada rotura se aplicó en el árbol de trabajo **sin commitear**, se corrieron las pruebas relevantes y se revirtió con `git checkout -- .`. Después se comprobó con `git status --porcelain` que el árbol quedó limpio antes de la siguiente.

Se ejecutaron el 2026-11-09 en la rama `test/mockoon-y-roturas` (desde `c9b8fbb`). Las suites usadas fueron:
- **Unitarias de la API:** `vitest run` en `apps/api`, 234 pruebas.
- **Integración:** `--project integracion`, 12 pruebas contra PostgreSQL y Redis reales.
- **Notificaciones contra Mockoon:** `--project mockoon`, 4 pruebas.

Solo se anota lo que se ejecutó.

## Resultados

| # | Rotura | Cómo se aplicó | Prueba(s) que fallaron | Resultado |
|---|---|---|---|---|
| 1 | Quitar la restricción EXCLUDE anti-traslape | Se borró el `ADD CONSTRAINT "Reservation_no_overlap" EXCLUDE USING gist (...)` de `prisma/migrations/20261029015948_reservation_constraints/migration.sql` y la migración se aplicó a una base desechable (detalle abajo). La base quedó solo con `Reservation_endsAt_after_startsAt`. | Integración (`reservation-concurrency.int.test.ts`), 5 de 12:<br>• «dos POST simultáneos para 10:00, 12:00, 14:00 y 16:00: exactamente uno responde 201 y el otro 409» (4 casos; se recibió `[201, 201]`).<br>• «la restricción EXCLUDE rechaza el traslape aunque se salte la validación del servicio» (devolvió `CREATED` en vez de `OVERLAP`).<br>El caso de las 8:00 pasó. Las unitarias pasaron 234 de 234, porque usan repositorios simulados. | **Detectada** (solo por integración) |
| 2 | Quitar el reintento ante deadlock en reservas | `src/repositories/reservation.repository.ts`: `if (isDeadlock(error) && attempt < MAX_CREATE_ATTEMPTS)` → `if (false && isDeadlock(error) && …)` | Unitarias (`reservation.repository.test.ts`), 4 de 234:<br>• «reintenta y devuelve OVERLAP si la otra transacción se confirmó»<br>• «reintenta y devuelve CREATED si la otra transacción no se confirmó»<br>• «se rinde tras 3 intentos con deadlock»<br>• «no confunde otros errores de la base con un traslape»: falla en cascada. Recibe un `mockRejectedValueOnce` que dejó sin consumir una prueba anterior; corrida sola (`-t "no confunde"`) pasa.<br>La integración pasó 12 de 12 en **3 ejecuciones seguidas**: en ellas no ocurrió ningún deadlock. | **Detectada** (unitarias). La integración no la detecta de forma confiable. |
| 3 | Que el middleware de errores devuelva el mensaje original de un error no controlado | `src/middleware/errors.ts`: en el 500, `message: 'Error interno del servidor'` → `message: error instanceof Error ? error.message : 'Error interno del servidor'` | Unitarias (`errors.test.ts`), 1 de 234: «responde 500 genérico sin filtrar el mensaje ni el stack de un error no controlado» | **Detectada** |
| 4 | Que el límite por API key deje pasar todas las solicitudes | `src/services/rate-limit.service.ts`: `allowed: count <= limit` → `allowed: true` | Unitarias (`rate-limit.service.test.ts`), 2 de 234:<br>• «con el contador en 61: allowed=false y quedan 0»<br>• «con el contador en 200: allowed=false y quedan 0»<br>La integración pasó 12 de 12. | **Detectada** |
| 4b | La misma rotura, en el middleware | `src/middleware/rate-limit.ts`: `if (!result.allowed)` → `if (false)` | Unitarias (`rate-limit.test.ts`), 1 de 234: «al superar el límite responde 429 con Retry-After» | **Detectada** |
| 5 | Que la caché no envíe el encabezado `X-Cache` | En los tres controladores que lo envían (`now.controller.ts:6`, `space.controller.ts:16` y `:38`), `res.set('X-Cache', cache).json(data)` → `res.json(data)` | Integración (`cache.int.test.ts`), 3 de 12:<br>• «dos consultas seguidas: MISS y luego HIT con el mismo cuerpo»<br>• «reservar invalida: la consulta siguiente es MISS…»<br>• «dos espacios no se contaminan…»<br>Las unitarias pasaron 234 de 234. | **Detectada** (solo por integración, y solo en disponibilidad) |
| 5b | Quitar `X-Cache` solo de `GET /now` | `now.controller.ts:6`, igual que arriba | Ninguna: unitarias 234 de 234, integración 12 de 12, Mockoon 4 de 4 | **No detectada**: hueco de cobertura. **Tras agregar la prueba:** detectada por «GET /now: MISS en la primera consulta y HIT en la segunda, con el mismo cuerpo» |
| 5c | Quitar `X-Cache` solo de `GET /spaces` (listado) | `space.controller.ts:16`, igual que arriba | Ninguna: unitarias 234 de 234, integración 12 de 12, Mockoon 4 de 4 | **No detectada**: hueco de cobertura. **Tras agregar la prueba:** detectada por «GET /spaces: MISS en la primera consulta y HIT en la segunda, con el mismo cuerpo» |
| 6 | Que el refresh token revocado siga siendo válido | `src/services/auth.service.ts`: `if (!stored \|\| stored.revokedAt \|\| stored.expiresAt <= new Date())` → `if (!stored \|\| stored.expiresAt <= new Date())` | Unitarias (`auth.service.test.ts`), 1 de 234: «refresh › responde 401 con un token revocado» | **Detectada** |

## Roturas 5b y 5c tras agregar la prueba

El commit `0e916f3` agregó a `test/integration/cache.int.test.ts` el bloque «cabecera X-Cache en GET /spaces y GET /now», con dos pruebas. Las dos roturas se volvieron a aplicar, una por vez y sin commitear, con el mismo cambio de la tabla. En cada una se corrió `--project integracion`, que ya tenía 14 pruebas, y se revirtió con `git checkout -- .`; `git status` quedó vacío las dos veces.

| # | Rotura | Prueba(s) que fallaron | Resultado |
|---|---|---|---|
| 5b | Sin `X-Cache` en `GET /now` | «GET /now: MISS en la primera consulta y HIT en la segunda, con el mismo cuerpo» (`expected null to be 'MISS'`). 1 de 14. | **Detectada** por esa prueba |
| 5c | Sin `X-Cache` en `GET /spaces` | «GET /spaces: MISS en la primera consulta y HIT en la segunda, con el mismo cuerpo». 1 de 14. | **Detectada** por esa prueba |

En la primera ejecución de 5b también falló «crear una key, llamar a /now (200), revocarla…» de `api-keys-now.int.test.ts`. Esa falla no la causa la rotura, porque esa prueba no revisa `X-Cache`:
- **Qué falló:** su espacio no aparecía en la respuesta de `/now`.
- **Por qué:** recibió la clave `now` que había dejado en Redis una corrida anterior.
- **Cómo se comprobó:** al repetir 5b solo falló la prueba nueva, y la corrida sin rotura que vino justo después dio 14 de 14.

**Corregido.** Las pruebas de integración dependían del estado que dejaban otras pruebas y del orden. Con el código original, correr dos veces seguidas `api-keys-now.int.test.ts` fallaba la segunda vez, y con `--sequence.shuffle` las pruebas de disponibilidad fallaban en 5 de 5 corridas. Se corrigió en tres commits, solo de pruebas:

| Commit | Qué cambió |
|---|---|
| `d99baf9` | `api-keys-now.int.test.ts` borra la clave `now` de Redis en `beforeAll` y en `afterAll`. Antes dejaba guardado un `/now` con su espacio (hasta 60 s) y la ejecución siguiente lo recibía. |
| `f0ec297` | `cache.int.test.ts` borra las claves de disponibilidad de sus espacios en un `beforeEach`. |
| `60f3f2b` | Ese `beforeEach` también borra las reservas de la ejecución. Borrar las claves no bastaba: «dos espacios no se contaminan» deja una reserva de 9:00 a 11:00, y si corría antes, «reservar invalida…» recibía 409. |

Verificación posterior:
- **Tres corridas seguidas** de `pnpm test:integration`, sin pausa: 14 de 14 las tres.
- **Nueve corridas con `--sequence.shuffle`** (semillas 11, 22, 33, 44, 55, 1, 2, 3 y 4): 14 de 14 en todas.

## Entorno aislado de la rotura 1

La base de uso diario (`reservalab`, en el contenedor `postgres` de docker compose) no se tocó:
- **Contenedor desechable:** `postgres:16-alpine` llamado `reservalab-pg-rotura`, en el puerto 5434, con los datos en `tmpfs`.
- **Config de Vitest temporal y sin seguimiento:** `apps/api/vitest.rotura.config.ts`. Era la misma config de integración, cambiando solo `DATABASE_URL`.
- **Al terminar** se borraron el contenedor y el archivo, y se comprobó que la base diaria seguía teniendo `Reservation_no_overlap`.

Controles previos, en el mismo contenedor:
1. **Base sin migraciones:** las pruebas fallan con «The table `public.User` does not exist». Esto confirma que la config apuntaba a la base desechable y no a la diaria.
2. **Base con las migraciones originales:** 12 de 12. Esto confirma que el entorno sirve y que las fallas de la rotura se deben a la falta de la restricción.

## Huecos de cobertura y pruebas propuestas

- **`X-Cache` en `GET /now` y en `GET /spaces` (roturas 5b y 5c). Cubierto en `0e916f3`** (ver «Roturas 5b y 5c tras agregar la prueba»). Lo que sigue es el registro original. Ninguna prueba automatizada revisa ese encabezado en esas dos rutas: `cache.int.test.ts` solo lo comprueba en disponibilidad. `scripts/prueba-clon-limpio.sh` sí revisa `X-Cache` en `/now`, pero se corre a mano.
  - **Prueba propuesta**, en `test/integration/cache.int.test.ts`, sin cambiar código de producción:
    - Dos `GET /spaces?building=<edificio de la ejecución>` seguidos dan `MISS` y luego `HIT`, y crear un espacio en ese edificio vuelve a dar `MISS`.
    - Dos `GET /now` con una API key `read:now` creada en la prueba dan `MISS` y luego `HIT`.
  - **Pendiente:** no está escrita; espera visto bueno. *(Se escribió después en `0e916f3`, con el visto bueno.)*
- **Reintento ante deadlock en integración (rotura 2).** Lo detectan las unitarias, que simulan el error 40P01. La prueba de concurrencia real no produjo ningún deadlock en 3 ejecuciones, así que no garantiza detectarla. El ADR 0004 registra que antes del reintento la API respondía 500 en 3 de 4 ejecuciones. Hoy la carrera depende del momento en que llega cada solicitud.
  - **No se propone una prueba nueva:** forzar el deadlock de forma determinista exigiría controlar las transacciones desde la prueba o cambiar el repositorio.
  - **Efecto lateral observado:** en `reservation.repository.test.ts` las respuestas simuladas de una prueba se filtran a la siguiente.
  - **Mejora posible, sin cambiar producción:** un `create.mockReset()` en un `beforeEach` de ese archivo.
