# ADR 0008: Documentación OpenAPI generada desde los esquemas Zod

- **Estado:** Aceptada
- **Fecha:** 2026-11-02

## Contexto

La API debe documentarse con OpenAPI en `/docs`. Los esquemas Zod de `packages/shared` ya definen la forma de cada entrada y salida, y los usan la API para validar y la web y la CLI para sus tipos. Si la documentación se escribiera aparte, cada cambio en un esquema obligaría a editar dos lugares, y la documentación terminaría desactualizada sin que nadie lo notara.

## Decisión

- **Generación:** el documento OpenAPI 3.0.3 se genera en tiempo de ejecución con `@asteasolutions/zod-to-openapi` a partir de los mismos esquemas de `@reservalab/shared`.
  - Los esquemas reciben nombre con `.meta({ id })` de Zod 4 y quedan en `components/schemas`.
  - No se usa `extendZodWithOpenApi`: solo agrega `.openapi()` a los esquemas creados después de llamarlo, y los de shared ya existen cuando la API los importa.
- **Un solo módulo:** todo vive en `apps/api/src/docs/`.
  - `openapi.ts` registra cada ruta con su descripción, la seguridad que exige, sus entradas y salidas, los errores reales con un ejemplo por código y las cabeceras.
  - `docs.router.ts` sirve Swagger UI en `/docs` y el JSON en `/docs/openapi.json`.
  - Las rutas y los controladores no cambian. Solo `routes/index.ts` expone la lista de routers con su prefijo, para la prueba.
- **Seguridad:** se declaran `bearerAuth` (JWT) y `apiKeyAuth` (cabecera `X-API-Key`). Los endpoints que aceptan cualquiera de los dos los listan como alternativas.
- **Prueba de cobertura:** `openapi.test.ts` comprueba lo siguiente:
  - El documento es un OpenAPI 3 válido, según `@apidevtools/swagger-parser`.
  - Cada ruta registrada en Express está documentada, y no se documentan rutas que no existen.
  - Todos los errores usan el esquema común `ErrorResponse`.
  - Una ruta nueva sin documentar hace fallar la prueba.

## Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| **YAML escrito a mano** | Duplica los esquemas de Zod. Un campo nuevo o una validación distinta no se reflejaría en la documentación. |
| **Comentarios JSDoc en las rutas** (`swagger-jsdoc`) | Mete la documentación en las rutas, que la regla de capas quiere limpias, y los comentarios tampoco se validan contra los esquemas. |
| **Decoradores o controladores generados** (`tsoa`, `NestJS`) | Obliga a reescribir rutas y controladores con clases y decoradores, y cambia la arquitectura solo por la documentación. |
| **OpenAPI 3.1** | Swagger UI y la mayoría de las herramientas de validación y generación de clientes todavía soportan mejor 3.0. El proyecto no necesita nada exclusivo de 3.1. |

## Consecuencias

- Un cambio en un esquema de shared aparece solo en la documentación.
- Lo que no sale de Zod se mantiene a mano en `openapi.ts`: descripciones, ejemplos y la lista de errores de cada endpoint. La prueba garantiza que toda ruta esté documentada, pero no que cada mensaje de error esté al día.
- Agregar una ruta exige registrarla en `openapi.ts`, o la prueba falla.
- `/docs` es público. No expone nada que un cliente no vea al usar la API, y los ejemplos usan datos inventados.
