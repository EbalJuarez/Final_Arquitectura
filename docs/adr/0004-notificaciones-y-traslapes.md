# ADR 0004: Notificaciones de reservas y traslapes concurrentes

- **Estado:** Aceptada
- **Fecha:** 2026-11-02
- **Requisitos:** RF-08 (crear reserva), RF-10 (cancelar reserva)

## Contexto

Al confirmar o cancelar una reserva hay que avisar a un servicio externo de notificaciones (Mockoon en desarrollo). Ese servicio puede estar caído o lento, y no debe impedir que la reserva se guarde. Además, dos solicitudes simultáneas pueden pasar la validación de traslape del servicio antes de que cualquiera de las dos inserte.

## Decisión

**Notificaciones en segundo plano, sin reintentos.**
- El servicio guarda la reserva y después llama a `clients/notifications.client.ts` **sin esperar la respuesta**.
- El cliente aborta a los `NOTIFICATIONS_TIMEOUT_MS` (2 s por defecto) y lanza si la respuesta no es 2xx.
- El servicio captura ese error y lo registra con `console.error`. La reserva nunca se revierte y la respuesta HTTP no espera a la notificación.
- El cliente vive en `clients/` y no en `repositories/`, porque no persiste datos: habla con otro sistema.

**Traslapes: validación en el servicio y restricción EXCLUDE como última defensa.**
- El servicio consulta los traslapes antes de insertar y responde 409 `RESERVATION_OVERLAP`.
- Si dos solicitudes pasan esa consulta al mismo tiempo, PostgreSQL rechaza la segunda con la restricción `Reservation_no_overlap` (código 23P01).
- Comprobamos contra la base real que Prisma 6 **no** traduce ese error: llega como `PrismaClientUnknownRequestError`, sin `code` ni `meta`, y el `23P01` solo aparece dentro del mensaje. El repositorio lo reconoce por el código **y** por el nombre de la restricción, y devuelve `OVERLAP`. El servicio responde entonces el mismo 409.

## Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| **Esperar la notificación dentro de la solicitud** | Con el servicio lento, cada reserva tardaría hasta 2 s más, y un fallo externo parecería un fallo de la reserva. |
| **Outbox transaccional con reintentos** (tabla de eventos y un proceso que los envía) | Garantiza que ninguna notificación se pierda, pero exige otra tabla, un proceso en segundo plano y deduplicación. Es demasiado para el alcance actual del curso. |
| **Mapear el error de la base en el controlador** | Rompe la arquitectura: el controlador conocería detalles de PostgreSQL y Prisma. |
| **Bloqueo explícito** (`SELECT … FOR UPDATE` o advisory lock por espacio) | Serializa las reservas del espacio, pero añade complejidad y latencia, y la restricción EXCLUDE ya garantiza la consistencia. |

## Consecuencias

- **Se pueden perder notificaciones:** si el servicio está caído, la notificación no se reintenta. Queda registrada en el log, pero nadie la reenvía.
- **Una notificación en vuelo se pierde si la API se reinicia.**
- **La detección del 23P01 depende del texto del mensaje de Prisma.** Si una versión futura cambia el formato o empieza a traducir el error a un `code`, el traslape concurrente podría volver como 500. Una prueba unitaria (`reservation.repository.test.ts`) fija el formato actual, y conviene revisarla al actualizar Prisma.
- Los dos caminos de traslape (servicio y base) responden exactamente el mismo 409, así que el cliente no necesita distinguirlos.
