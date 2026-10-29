# ReservaLab

API en TypeScript para reservar laboratorios y salones (Proyecto de Curso, Arquitectura de Sistemas I, UMES Quetzaltenango). Monorepo pnpm + Turborepo.

## Estructura
- apps/api: Express 5 + Prisma 6 + TypeScript. Único lugar con reglas de negocio.
- apps/web: HTML + TypeScript con Vite. Solo 3 pantallas. PROHIBIDO React, Angular, Vue, Tailwind y Bootstrap.
- apps/cli: herramienta de administrador por línea de comandos. Consume la API.
- packages/shared: tipos y esquemas Zod compartidos por api, web y cli.
- packages/mocks: entorno de Mockoon (servicio de notificaciones simulado).
- docs/: documento de arquitectura, diagramas y ADR (docs/adr/NNNN-titulo.md).

## Arquitectura de la API (regla estricta)
Cada solicitud atraviesa 4 capas en orden y ninguna se salta a la siguiente:
1. Rutas + middleware (JWT, API key, roles, límite de solicitudes)
2. Controladores (MVC): solo traducen HTTP a llamadas de servicio. Sin lógica de negocio. NUNCA importan Prisma.
3. Servicios: todas las reglas de negocio.
4. Repositorios: único código que usa Prisma. NUNCA conocen HTTP (req/res).

## Reglas de negocio clave
- Un espacio no puede tener dos reservas con rango de tiempo traslapado. Se valida en el servicio Y se protege en PostgreSQL con una restricción EXCLUDE USING gist (migración SQL manual).
- Endpoints bajo /api/v1, respuestas JSON, documentados con OpenAPI en /docs.
- Contraseñas con bcrypt o argon2. Refresh tokens y API keys se guardan solo como hash.
- Access token 15 min, refresh token 7 días. API keys con prefijo rl_live_, permisos explícitos y límite por minuto en Redis.
- Caché Redis de 60 s en disponibilidad, con invalidación al crear o cancelar reservas y encabezado X-Cache: HIT|MISS.

## Convenciones
- Commits en Conventional Commits, por ejemplo feat(api): agregar endpoint de reservas.
- Todo se levanta con `docker compose up`. Secretos en .env (nunca en Git); mantener .env.example actualizado.
- Cada decisión técnica relevante lleva un ADR corto con alternativas descartadas.
- Pruebas con Vitest; meta de cobertura 70 % o más.
- Código y comentarios en español. Nombres de código (variables, funciones) en inglés.

## Versiones fijadas
Node 22, pnpm 10, Express 5, Prisma 6 (no usar Prisma 7), PostgreSQL 16, Redis 7.-/