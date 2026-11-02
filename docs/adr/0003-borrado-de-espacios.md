# ADR 0003: Borrado de espacios con reservas

- **Estado:** Aceptada
- **Fecha:** 2026-11-02
- **Requisitos:** RF-06 (administración de espacios)

## Contexto

`DELETE /spaces/:id` debe responder 409 si el espacio tiene reservas CONFIRMED futuras. Sin embargo, la llave foránea `Reservation.spaceId` usa `ON DELETE RESTRICT`, así que PostgreSQL impide borrar un espacio que tenga **cualquier** reserva, aunque sea pasada o cancelada. Sin una decisión explícita, borrar un espacio con historial terminaría en un error 500.

## Decisión

- Un espacio **no se puede borrar** si tiene reservas CONFIRMED que todavía no terminan (`endsAt > ahora`, es decir, en curso o futuras). En ese caso responde **409 `SPACE_HAS_RESERVATIONS`**.
- Si no tiene reservas así, se borra **junto con su historial**: en una sola transacción se eliminan sus reservas CANCELLED o ya terminadas y luego el espacio.
- Se mantiene `ON DELETE RESTRICT` como red de seguridad. Si entre la validación y el borrado alguien crea una reserva vigente, la transacción no la borra, la llave foránea frena el borrado del espacio y la API responde 409 en lugar de 500.

## Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| **Borrado lógico** (columna `deletedAt`) | Conserva el historial, pero obliga a filtrar los espacios borrados en todas las consultas (listado, disponibilidad, reservas) y a decidir qué pasa con los nombres repetidos. Es más trabajo del que el curso pide hoy. |
| **`ON DELETE CASCADE`** | Borraría también las reservas vigentes si alguien olvidara la validación en el servicio. La regla de negocio quedaría en una sola capa. |
| **409 si tiene cualquier reserva** | Un espacio que se usó alguna vez no se podría borrar nunca, lo que contradice RF-06 (409 solo con reservas futuras). |

## Consecuencias

- Se pierde el historial de reservas del espacio borrado. Si más adelante se necesitan reportes históricos, hay que migrar a borrado lógico.
- Una reserva **en curso** también bloquea el borrado, aunque no sea estrictamente "futura".
- La regla queda en el servicio (`space.service.ts`) y el repositorio solo ejecuta el borrado transaccional, como exige la arquitectura en capas.
