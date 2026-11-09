# ADR 0001: Express 5, Prisma 6 y monorepo con pnpm y Turborepo

- **Estado:** Aceptada
- **Fecha:** 2026-11-09. La decisión se tomó al iniciar el proyecto (commit `a059867`, 2026-10-28), y este ADR la registra después.

## Contexto

El proyecto tiene tres aplicaciones que hablan el mismo idioma: la API, la web y la CLI de administración. Las tres necesitan los mismos contratos: cuerpos de solicitud, respuestas y errores.

**Condiciones del proyecto de curso (según el enunciado):**
- La API debe estar en TypeScript y organizada en cuatro capas estrictas (rutas y middleware → controladores → servicios → repositorios).
- Solo los repositorios pueden tocar la base.
- La regla de no traslapar reservas debe quedar protegida en PostgreSQL con una restricción `EXCLUDE USING gist`.

Todo debe levantarse con `docker compose up`. El equipo es de tres personas y el tiempo es el de un semestre.

## Decisión

**Express 5 para la API.**
- **Las cuatro capas son visibles.** Cada capa es una carpeta de `apps/api/src/` (`routes/`, `controllers/`, `services/`, `repositories/`) con funciones simples. La capa 1 se arma ruta por ruta con middleware propio (`authenticate`, `requireRole`, `validate`, `rateLimitApiKey`), y los controladores son funciones `async (req, res)` que solo llaman a un servicio.
- **Errores async sin envoltorios.** Express 5 envía a `errorHandler` los errores de los handlers `async`, así que los controladores no llevan `try/catch` ni un `asyncHandler`. Esa era la principal molestia de Express 4.

**Prisma 6 como acceso a datos.**
- **El esquema y las migraciones viven en `apps/api/prisma/`.** El cliente que se genera tipa cada consulta de los repositorios.
- **Lo que Prisma no expresa va en SQL manual.** La restricción `EXCLUDE` y el `CHECK` de fechas están en una migración escrita a mano (`20261029015948_reservation_constraints`), que `prisma migrate deploy` aplica igual que las demás.
- **Dentro del flujo de una solicitud, solo `src/repositories/` usa Prisma.** El cliente se crea en `src/lib/prisma.ts`, y fuera de las capas solo lo importa `src/server.ts`, para desconectarlo al apagar. Por eso las pruebas de servicios reemplazan los repositorios con `vi.mock` y corren sin base.
- **Versión fijada en 6.19.3.** Prisma 7 cambia la configuración: el arranque ya avisa que `package.json#prisma` desaparece en esa versión. Migrar queda fuera del alcance de esta entrega.

**Monorepo con workspaces de pnpm y Turborepo.**
- **Paquetes:** `apps/api`, `apps/web`, `apps/cli`, `packages/shared` y `packages/mocks`.
- **`@reservalab/shared` es la fuente única de los esquemas Zod.**
  - La API valida las solicitudes con ellos y genera OpenAPI a partir de ellos ([ADR 0008](0008-documentacion-openapi-desde-zod.md)).
  - La CLI y la web validan cada respuesta de la API con los mismos esquemas, y la web también valida los formularios de login y registro con ellos.
  - El paquete expone su código TypeScript directamente (`main: src/index.ts`), sin paso de build propio. Cada app lo compila con su herramienta: esbuild en la API y Vite en la web.
- **Turborepo** corre `build`, `typecheck`, `test` y `test:coverage` en todos los paquetes en el orden de sus dependencias: `^build` para el build y las pruebas, y `^typecheck` para typecheck.
- **La imagen de la API instala solo lo que necesita.** Usa `pnpm install --filter @reservalab/api...` y `pnpm deploy --prod`.

## Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| **NestJS** | Trae su propia estructura de módulos, inyección de dependencias y decoradores. El curso pide que las cuatro capas se vean y se puedan revisar. En NestJS parte de ese flujo lo resuelve el framework y no el código del proyecto, y el equipo tendría que aprender el framework además del dominio. |
| **Fastify** | Valida con JSON Schema y su sistema de plugins es otro modelo. Nosotros ya validamos con Zod desde `shared`, así que tendríamos dos fuentes de esquemas o un adaptador más. Express 5 resolvió lo que nos molestaba de Express 4 (los errores async). Su ventaja de rendimiento no fue un criterio, porque no medimos que el framework fuera un cuello de botella. |
| **TypeORM** | Define el modelo con clases y decoradores, y los tipos de sus consultas son menos estrictos que los del cliente generado por Prisma. La restricción `EXCLUDE` habría requerido SQL manual igual. |
| **Knex** | Es un constructor de consultas sin tipos derivados del esquema. Habría que escribir y mantener los tipos de cada tabla a mano, y las migraciones también son código manual. |
| **Repositorios separados** (API, web y CLI) | Los esquemas de `shared` tendrían que publicarse como paquete npm o copiarse en cada repo, y un cambio de contrato exigiría coordinar versiones entre repos. Un solo repo permite cambiar el esquema y sus tres consumidores en el mismo commit, y levantar todo con un solo `docker-compose.yml`. |

## Consecuencias

**Positivas**
- Un cambio en un esquema de `shared` rompe el `typecheck` de cada app que lo use antes de llegar a ejecución.
- Las capas son fáciles de revisar: basta ver qué importa cada carpeta.
- Los servicios se prueban sin PostgreSQL ni Redis, reemplazando repositorios y clientes.
- Las migraciones, incluida la manual, se aplican solas al arrancar el contenedor de la API.

**Negativas y riesgos aceptados**
- **Express no hace cumplir las capas.** Que un controlador no importe Prisma es una convención del equipo: no hay regla de lint ni prueba que lo verifique.
- **Prisma 6 no traduce algunos errores de PostgreSQL.** La violación de la restricción `EXCLUDE` (23P01) llega sin código y se reconoce por el texto del mensaje ([ADR 0004](0004-proteccion-de-traslapes.md)). Hay que volver a probar al actualizar Prisma.
- **Prisma suma peso y configuración a la imagen.** Sus motores necesitan OpenSSL en Alpine, y el Dockerfile borra los motores WASM que no se usan. Además, pnpm 10 bloquea los scripts de instalación, así que `pnpm-workspace.yaml` tiene que permitirlos para Prisma y esbuild (`onlyBuiltDependencies`).
- **Prisma 7 queda pendiente**, con un aviso de deprecación en cada arranque.
- **El monorepo exige pnpm 10 y conocer Turborepo.** Como `shared` se consume como código fuente, cada app debe poder compilar TypeScript de otro paquete del workspace. Por eso el Dockerfile de la API copia `packages/shared` antes de empaquetar.
