# ADR 0005: Notificaciones tolerantes a fallos

- **Estado:** Aceptada
- **Fecha:** 2026-11-02
- **Requisitos:** RF-08 (crear reserva), RF-10 (cancelar reserva)

## Contexto

Al confirmar o cancelar una reserva hay que avisar a un servicio externo de notificaciones (Mockoon en desarrollo). Ese servicio puede estar caído o lento. La reserva es la operación importante: no debe fallar, revertirse ni tardar más por culpa de la notificación.

## Decisión

- El aviso lo envía un **cliente HTTP** (`clients/notifications.client.ts`), no un repositorio, porque no persiste datos: habla con otro sistema. Hace `POST` a `NOTIFICATIONS_URL` en `/notifications/reservation-confirmed` o `/notifications/reservation-cancelled`.
- El cliente aborta a los **`NOTIFICATIONS_TIMEOUT_MS`** (2 s por defecto) con `AbortSignal.timeout`, y lanza si no puede conectar o si la respuesta no es 2xx.
- El servicio llama al cliente **después de guardar** y **sin esperar la respuesta**. Captura cualquier error y lo registra con `console.error`. La reserva nunca se revierte.
- El aviso lleva lo necesario para notificar sin consultar la API: id de la reserva, espacio, usuario y correo, y horario en hora de Guatemala.

## Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| **Esperar la notificación dentro de la solicitud** | Con el servicio lento, cada reserva tardaría hasta 2 s más, y un fallo externo parecería un fallo de la reserva. |
| **Revertir la reserva si la notificación falla** | Acopla la disponibilidad del sistema principal a la de un servicio secundario: con el servicio caído, nadie podría reservar. |
| **Outbox transaccional con reintentos** (tabla de eventos escrita en la misma transacción y un proceso que los envía) | Garantiza que ninguna notificación se pierda, pero exige otra tabla, un proceso en segundo plano, reintentos con espera y deduplicación en el receptor. Es demasiado para el alcance actual. Es la mejora natural si las notificaciones se vuelven críticas. |
| **Cola de mensajes** (por ejemplo, Redis Streams) | Mismo beneficio que el outbox, pero añade otra pieza de infraestructura que operar. |

## Consecuencias

- La reserva responde rápido y funciona aunque el servicio de notificaciones esté caído. Se verificó con Mockoon detenido: la API respondió 201 en 314 ms y la reserva quedó CONFIRMED.
- **Las notificaciones se pueden perder.** No hay reintentos, así que si el servicio falla el aviso solo queda registrado en el log de la API. Una notificación en vuelo también se pierde si la API se reinicia.
- Como el envío no se espera, el orden de llegada no está garantizado: una cancelación inmediata podría llegar antes que su confirmación.
- Las pruebas unitarias cubren la falla, el timeout y que la respuesta no espere a una notificación que nunca contesta.
