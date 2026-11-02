# ADR 0004: Protección contra reservas traslapadas en dos niveles

- **Estado:** Aceptada
- **Fecha:** 2026-11-02
- **Requisitos:** RF-08 (crear reserva)

## Contexto

Un espacio no puede tener dos reservas CONFIRMED con horarios traslapados. Las reservas contiguas, donde una termina cuando empieza la otra, sí se permiten. Validar solo en la aplicación no basta: dos solicitudes simultáneas pueden consultar al mismo tiempo, no ver ningún traslape y luego insertar las dos.

## Decisión

Se protege en dos niveles que responden exactamente igual al cliente (**409 `RESERVATION_OVERLAP`**):

1. **Servicio (`reservation.service.ts`):** antes de insertar, consulta las reservas CONFIRMED del espacio que se traslapan con el horario pedido. Cubre el caso normal con un mensaje claro y sin intentar el INSERT.
2. **Base de datos:** una restricción `EXCLUDE USING gist ("spaceId" WITH =, tstzrange("startsAt","endsAt",'[)') WITH &&) WHERE (status = 'CONFIRMED')`, creada en una migración SQL manual. El rango `[)` permite las reservas contiguas, y el `WHERE` hace que las canceladas no bloqueen. Es la última defensa y la única garantía real ante la concurrencia.

Los errores de la base se traducen en el repositorio, nunca en el controlador.

- **23P01 (violación de la restricción):** comprobamos contra la base real que Prisma 6 no lo traduce. Llega como `PrismaClientUnknownRequestError`, sin `code` ni `meta`, y el código solo aparece en el mensaje. El repositorio lo reconoce por el código **y** por el nombre `Reservation_no_overlap`, y devuelve `OVERLAP`.
- **40P01 (deadlock):** la prueba de integración reveló que dos INSERT traslapados *exactamente* simultáneos pueden esperar cada uno la transacción del otro para evaluar la restricción. PostgreSQL lo detecta como deadlock y aborta uno, y sin tratarlo la API respondía 500 en 3 de 4 ejecuciones. El repositorio **reintenta** el INSERT abortado (hasta 3 intentos). Como la otra transacción ya terminó, el reintento obtiene el resultado real: 23P01 → 409 si la otra se confirmó, o la reserva creada si no.

## Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| **Solo validación en la aplicación** | Tiene una condición de carrera: dos solicitudes simultáneas pasan la consulta y ambas insertan. La integridad quedaría a merced del tiempo, y cualquier otro cliente de la base (scripts, la CLI en el futuro) podría saltársela. |
| **Bloqueo pesimista** (`SELECT … FOR UPDATE` sobre el espacio o `pg_advisory_xact_lock(spaceId)`) | Serializa las reservas del mismo espacio y evita la carrera. Pero exige una transacción interactiva alrededor de consulta e inserción, añade latencia y depende de que todos los caminos tomen el lock. Además seguiría haciendo falta una regla en la base para garantizar la integridad. |
| **Transacciones `SERIALIZABLE`** | PostgreSQL detectaría el conflicto entre las dos transacciones, pero lo reporta como error de serialización (40001) y obliga a reintentar toda la transacción. Afecta el rendimiento de todo lo que corra con ese aislamiento y, sin la restricción, no protege contra escrituras fuera de esa transacción. |

## Consecuencias

- La integridad la garantiza PostgreSQL, sin importar cuántas instancias de la API corran ni quién escriba en la tabla.
- En el caso normal, el servicio responde 409 sin intentar el INSERT. En la carrera, la base decide y el cliente recibe el mismo 409.
- **La detección de 23P01 y 40P01 depende del texto del mensaje de Prisma 6.** Si una versión futura cambia ese formato, la carrera podría volver como 500. Lo vigilan dos pruebas: las unitarias de `reservation.repository.test.ts` fijan el formato, y la de integración (`pnpm test:integration`) lanza solicitudes simultáneas reales. Hay que ejecutarlas al actualizar Prisma.
- La restricción depende de la extensión `btree_gist`, que crea la migración manual.
