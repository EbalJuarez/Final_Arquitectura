# ADR 0002: Autenticación con access token JWT y refresh token opaco

- **Estado:** Aceptada
- **Fecha:** 2026-10-28
- **Requisitos:** RF-01 (registro), RF-02 (login), RF-03 (refresh), RF-04 (logout)

## Contexto

La API la consumen dos clientes distintos: la web (Vite, sin framework) y la CLI del administrador. Ambos necesitan autenticarse en cada solicitud y conocer el rol del usuario (ESTUDIANTE, DOCENTE o ADMIN) para autorizar acciones. Queremos que verificar una solicitud no requiera consultar la base de datos, pero también poder cerrar sesión de verdad.

## Decisión

Usamos dos tokens con propósitos distintos:

1. **Access token JWT de vida corta (15 min por defecto, `ACCESS_TOKEN_TTL_SECONDS`).**
   - Firmado con HS256 y `JWT_ACCESS_SECRET`; se verifica solo con el secreto, sin ir a la base.
   - Payload mínimo: `sub` (id del usuario) y `role`, más `iat`/`exp`. No lleva correo, nombre ni nada sensible, porque un JWT es legible por cualquiera.
   - Se envía en `Authorization: Bearer <token>`. El middleware `authenticate` valida firma, algoritmo (solo HS256), expiración y forma del payload.

2. **Refresh token opaco de vida larga (7 días por defecto, `REFRESH_TOKEN_TTL_DAYS`).**
   - 32 bytes de `crypto.randomBytes` en base64url; no es un JWT y no se firma.
   - En la tabla `RefreshToken` se guarda **solo su hash SHA-256**, con `expiresAt` y `revokedAt`. Si la base se filtra, los hashes no sirven para pedir access tokens.
   - `/auth/refresh` busca por hash y rechaza (401) si no existe, expiró o está revocado.
   - `/auth/logout` exige access token y marca `revokedAt` del refresh token enviado.

### Por qué SHA-256 y no bcrypt/argon2 para el refresh token

Las contraseñas sí usan argon2id, porque las elige una persona, tienen poca entropía y un hash lento frena los ataques de diccionario. El refresh token es distinto:

- **Tiene 256 bits aleatorios.** Probar todas las combinaciones es inviable aunque el hash sea rápido, así que un hash lento no añade seguridad.
- **Hay que buscarlo por su hash.** SHA-256 es determinista: `hash(token)` siempre da lo mismo y se resuelve con un `findUnique` sobre el índice único `tokenHash`. bcrypt y argon2 usan sal aleatoria, así que habría que recorrer y comparar tokens uno por uno.
- **Costo por solicitud.** Un hash lento en cada `/refresh` gasta CPU sin beneficio.
- **bcrypt además trunca a 72 bytes**, un detalle que conviene no arrastrar a un token.

## Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| **Sesiones en el servidor** (id de sesión guardado en Redis o PostgreSQL) | Cada solicitud tendría que consultar el almacén de sesiones. La revocación sería inmediata, pero la CLI y la web necesitarían manejar cookies o ids de sesión. Además, el enunciado del curso pide JWT. |
| **JWT también para el refresh token** | Para poder revocarlo habría que guardarlo o llevar una lista negra en la base, así que se pierde la ventaja de no tener estado. También exigiría un segundo secreto (`JWT_REFRESH_SECRET`, que se eliminó) y un token más grande que expone su payload. |
| **Cookies httpOnly** para guardar los tokens | Protegen contra robo por XSS, pero obligan a proteger contra CSRF, configurar CORS con credenciales y servir web y API desde un origen compatible. La CLI no usa cookies. Queda como mejora posible solo para la web. |

## Consecuencias

**Positivas**
- Verificar un access token no consulta la base: es barato y no depende de PostgreSQL ni de Redis.
- El logout es real: el refresh token revocado deja de servir de inmediato.
- Un volcado de la tabla `RefreshToken` no permite suplantar a nadie.
- Las vidas de los tokens se configuran por entorno, sin números mágicos.

**Negativas y riesgos aceptados**
- **El access token no se puede revocar.** Sigue siendo válido hasta 15 min después del logout, y un cambio de rol tarda hasta 15 min en reflejarse.
- **El refresh token no rota.** `/auth/refresh` devuelve solo un access token nuevo y el mismo refresh token sigue valiendo hasta que expira o se hace logout. Si lo roban, el atacante puede renovar access tokens durante hasta 7 días, y no hay detección de reutilización. Rotarlo en cada uso, revocando el anterior y devolviendo uno nuevo, es la mejora natural si el riesgo lo justifica.
- **Logout responde 401 si el refresh token no existe, ya está revocado o pertenece a otro usuario.** No revoca tokens ajenos, y como responde igual en los tres casos no revela si un token ajeno existe. A cambio, un cliente que repite el logout recibe 401 en vez de 204.
- **La tabla `RefreshToken` crece** con cada login. Hará falta una tarea que borre los tokens expirados o revocados.
- **El cliente guarda los tokens.** En la web, guardarlos en `localStorage` los expone a XSS; conviene mantener el access token en memoria.
