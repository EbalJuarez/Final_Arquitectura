# ADR 0007: Caché de lecturas con Redis

- **Estado:** Aceptada
- **Fecha:** 2026-11-02
- **Actualizada:** 2026-11-02, con el porqué de cada lectura y del TTL, los límites de `/now` y la medición de latencia.

## Contexto

Tres lecturas se repiten mucho y cambian poco: el listado de espacios, la disponibilidad de un espacio en un día y la pantalla informativa `/now`, que consultan varias pantallas a la vez. Cada una cuesta una o dos consultas a PostgreSQL. La caché tiene que mostrar enseguida lo que cambia (una reserva nueva debe verse en la siguiente consulta), no puede mezclar datos de distintos usuarios y no debe convertir a Redis en un punto de falla.

## Decisión

**Dónde vive cada cosa:**
- `lib/cache.ts` encapsula el cliente de Redis con una interfaz pequeña: `get`, `set` con TTL, `del`, grupos de claves, versión de espacio de nombres y `remember`.
- Los **servicios** deciden qué cachear e invalidar. Devuelven `{ data, cache: 'HIT' | 'MISS' }`, y el **controlador** solo pone la cabecera `X-Cache`.
- Los controladores no importan Redis ni la caché, y los repositorios no saben que existe.

**Qué se cachea y por qué.** Solo respuestas 200, con `CACHE_TTL_SECONDS` (60 s por defecto):

| Lectura | Por qué | Clave | Se invalida al… |
|---|---|---|---|
| `GET /spaces` | La consultan todas las pantallas al abrir, y los espacios casi nunca cambian | `spaces:v{versión}:building={filtro}:minCapacity={filtro}` | crear, editar o borrar un espacio: se incrementa `version:spaces` |
| `GET /spaces/:id/availability` | Es la lectura más frecuente: se repite cada vez que alguien elige un espacio y un día para reservar | `availability:{spaceId}:{fecha}` | crear o cancelar una reserva de ese espacio y fecha (en hora de Guatemala); editar o borrar el espacio (todas sus fechas) |
| `GET /now` | Varias pantallas informativas la piden cada pocos segundos, y la respuesta es la misma para todas | `now` | crear o cancelar una reserva; crear, editar o borrar un espacio. Además vence sola en el próximo cambio de estado |

No se cachean las reservas del usuario (`GET /reservations/me`), porque dependen de quién consulta, ni las escrituras.

**Por qué 60 s.** El TTL no es lo que mantiene los datos al día: eso lo hace la invalidación explícita. El TTL es la red de seguridad para cuando invalidar falla, y fija cuánto puede durar un dato viejo en el peor caso.
- 60 s es un minuto, aceptable para una pantalla de consulta. Una reserva confirmada nunca depende de la caché: el servicio y la restricción EXCLUDE consultan PostgreSQL.
- Con varias pantallas consultando cada pocos segundos, 60 s ya convierte casi todas las lecturas en HIT. Un TTL más largo ahorraría poco más y alargaría el peor caso.
- Es configurable (`CACHE_TTL_SECONDS`) por si la carga real pide otro valor.

- **Sin mezclar usuarios:** ninguna clave depende de quién consulta. Las respuestas son iguales para cualquier usuario, así que un JWT y una API key comparten caché.
- **Sin cachear errores:** un 404 lanza dentro del servicio antes de guardar, y un 400 ni siquiera llega al servicio.

**Invalidar sin SCAN:**
- **El listado** tiene muchas combinaciones de filtros. En vez de buscarlas, su clave lleva un número de versión: incrementarlo deja a todas inalcanzables, y las viejas vencen solas.
- **La disponibilidad de un espacio** puede estar cacheada para varias fechas. Cada clave se anota en un SET de Redis (`availability-keys:{spaceId}`), y al editar o borrar el espacio se borran sus miembros.

**Orden de la invalidación.** Ocurre después de confirmar la escritura en PostgreSQL y se espera (con un tope de 500 ms) antes de responder, para que la siguiente consulta ya vea el cambio. Un fallo al invalidar nunca revierte la operación: solo se registra.

**`/now` con TTL dinámico.** La pantalla también cambia con el paso del tiempo: un espacio se libera o empieza una reserva sin que nadie escriba. Por eso su clave vence en el próximo cambio de estado de cualquier espacio, con 60 s como máximo. Los límites que quedan están en *Consecuencias*.

**Fail-open.** Si Redis falla o tarda más de 500 ms, ninguna función lanza: se registra una advertencia y la lectura cuenta como MISS y se resuelve en PostgreSQL. Si no se puede leer la versión del listado, se consulta la base sin usar la caché, para no leer con una versión equivocada.

**Conexión lista antes de cada comando.** Antes de enviar cualquier comando se exige `redis.isReady`. Si no, la operación falla al instante. Lo descubrimos verificando la caída de Redis: aunque el cliente usa `disableOfflineQueue`, node-redis encola igual las transacciones `MULTI` y las ejecuta al reconectar. Redis volvía con claves escritas tarde, calculadas durante la caída, que podían pisar una invalidación fallida. Pasaba lo mismo con los contadores del límite por minuto.

**Redis sin persistencia.** Redis solo guarda datos que se pueden reconstruir: caché y contadores de un minuto. Lo comprobamos: con el snapshot que trae la imagen por defecto, al reiniciar Redis volvía una disponibilidad cacheada que no se pudo invalidar mientras estaba caído, y la API respondía HIT con datos viejos.

## Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| **Invalidar el listado con `SCAN` + `DEL` de `spaces:*`** | Recorre todo el keyspace en cada cambio, y una consulta que llegue durante el barrido puede guardar una clave que el barrido ya pasó. Con la versión, invalidar es un solo `INCR`. |
| **Solo TTL, sin invalidar** | Simple, pero una reserva recién creada no aparecería en la disponibilidad hasta 60 s después, y otra persona podría intentar reservar el mismo horario creyendo que está libre. |
| **Caché en memoria del proceso** (un `Map` con vencimiento dentro de Node) | Sería más rápida, porque no hay viaje de red. Pero cada instancia de la API tendría su propia copia, y la invalidación de una no llegaría a las demás: una reserva creada en la instancia A seguiría apareciendo libre en la B hasta el TTL. Además se pierde en cada reinicio o despliegue y usa la memoria del proceso de la API. Redis ya está en el proyecto para el límite de solicitudes. |
| **Write-through** (actualizar la clave cacheada con el dato nuevo en vez de borrarla) | Obliga a recalcular la disponibilidad o el listado dentro de cada escritura y duplica la lógica de lectura. Borrar es más simple y la siguiente lectura reconstruye. |
| **Cachear en el controlador o en un middleware HTTP** | El controlador tendría que conocer Redis, lo que rompe la regla de capas. Además, un middleware genérico no sabe qué escritura invalida qué lectura. |
| **Rechazar la solicitud si Redis falla** (*fail-closed*) | La caché es una optimización: si falla, la base sigue pudiendo responder. |

## Consecuencias

- La siguiente consulta después de una escritura es MISS y muestra el cambio. Las repetidas son HIT y no tocan PostgreSQL.
- **Si invalidar falla** (Redis inalcanzable pero con la clave guardada), una lectura puede mostrar datos viejos hasta que venza el TTL, como máximo 60 s. Se registra en el log.
- **Carrera conocida:** si una lectura consulta la base justo antes de una escritura y guarda su resultado justo después de la invalidación, deja un dato viejo hasta que venza el TTL. Es una ventana de milisegundos, acotada a 60 s. La protección contra traslapes no depende de la caché: el servicio consulta PostgreSQL y la restricción EXCLUDE tiene la última palabra (ADR 0004).
- **Datos de un reinicio:** al reiniciar Redis se pierden la caché y los contadores del límite por minuto. La caché se reconstruye sola, y los contadores empiezan de cero, lo que puede dar a una key hasta un minuto extra de solicitudes.
- **Límite conocido de `/now`:**
  - **Una sola clave para todos los espacios.** Cualquier reserva o cambio de espacio, en cualquier espacio, invalida la pantalla completa. Con muchas escrituras, `/now` daría más MISS. Se aceptó porque reconstruirla son dos consultas, y separar por espacio obligaría a armar la respuesta con N lecturas.
  - **Precisión de un segundo.** El TTL dinámico se redondea hacia arriba a segundos enteros, así que la pantalla puede mostrar el estado anterior hasta un segundo después de un cambio.
  - **Solo cambios de hoy.** La siguiente reserva se busca dentro del día de Guatemala, y un cambio de día no fuerza el vencimiento. Justo después de medianoche, `/now` puede seguir mostrando la respuesta anterior hasta 60 s. Fuera del horario de operación (7:00 a 21:00) no tiene efecto práctico.
  - **El reloj es el del servidor que calculó la respuesta.** El campo `now` indica cuándo se calculó, para que una pantalla sepa la antigüedad de lo que muestra.
- **Medición:** con la caché caliente, una consulta de disponibilidad baja de unos 6 ms a unos 2,3 ms en p50 (unas 2,5 veces menos). El detalle y las condiciones están en [docs/benchmarks/cache.md](../benchmarks/cache.md).
- **Claves huérfanas:** las claves de versiones viejas del listado y los grupos con miembros ya vencidos quedan en Redis hasta que vencen; no se leen nunca.
