import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  type ResponseConfig,
  type RouteConfig,
} from '@asteasolutions/zod-to-openapi';
import {
  ApiKeySchema,
  AvailabilityQuerySchema,
  AvailabilityResponseSchema,
  CreateApiKeySchema,
  CreateReservationSchema,
  CreateSpaceSchema,
  CreatedApiKeySchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  IdParamsSchema,
  LoginResponseSchema,
  LoginSchema,
  NowResponseSchema,
  PublicUserSchema,
  RefreshResponseSchema,
  RefreshTokenSchema,
  RegisterSchema,
  ReservationSchema,
  SpaceFiltersSchema,
  SpaceSchema,
  UpdateSpaceSchema,
  type ErrorResponse,
} from '@reservalab/shared';
import { z } from 'zod';
import { env } from '../config/env';
import { CLOSING_HOUR, OPENING_HOUR } from '../config/schedule';

// Documento OpenAPI de /api/v1, generado desde los esquemas Zod de @reservalab/shared. Es el único
// lugar donde se describen las rutas para la documentación: ni las rutas ni los controladores saben
// que existe. Si se agrega una ruta en Express hay que registrarla aquí; la prueba openapi.test.ts
// falla si alguna queda sin documentar.

export const API_V1_BASE_PATH = '/api/v1';

// ---------- Ejemplos ----------

const USER_ID = '3f2b8c1e-6a4d-4e2f-9b7a-1c5d8e9f0a12';
const SPACE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const OTHER_SPACE_ID = '9b2d4f6a-1e3c-4a5b-8c7d-2e4f6a8b0c1d';
const RESERVATION_ID = 'b6a1e2f3-4c5d-4e6f-8a9b-0c1d2e3f4a5b';
const API_KEY_ID = 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70';

const userExample = {
  id: USER_ID,
  email: 'ana.lopez@umes.edu.gt',
  name: 'Ana López',
  role: 'DOCENTE',
  createdAt: '2026-11-01T15:30:00.000Z',
};

const spaceExample = {
  id: SPACE_ID,
  name: 'Laboratorio de Redes',
  building: 'Edificio A',
  capacity: 30,
  createdAt: '2026-11-01T15:30:00.000Z',
};

const reservationExample = {
  id: RESERVATION_ID,
  space: { id: SPACE_ID, name: 'Laboratorio de Redes', building: 'Edificio A' },
  userId: USER_ID,
  startsAt: '2026-11-10T09:00:00-06:00',
  endsAt: '2026-11-10T11:00:00-06:00',
  status: 'CONFIRMED',
  createdAt: '2026-11-02T18:00:00.000Z',
};

const apiKeyExample = {
  id: API_KEY_ID,
  name: 'Pantalla del Edificio A',
  prefix: 'rl_live_Xk3v9QpL',
  permissions: ['read:now'],
  lastUsedAt: '2026-11-10T10:15:02.000Z',
  revokedAt: null,
  createdAt: '2026-11-02T18:00:00.000Z',
};

// ---------- Errores ----------

type ErrorBody = ErrorResponse['error'];

const errors = {
  validation: {
    code: 'VALIDATION_ERROR',
    message: 'Los datos enviados no son válidos',
    details: [{ field: 'capacity', message: 'Too small: expected number to be >0' }],
  },
  invalidJson: { code: 'INVALID_JSON', message: 'El cuerpo de la solicitud no es JSON válido' },
  missingToken: { code: 'UNAUTHORIZED', message: 'Falta el token de acceso' },
  invalidToken: { code: 'UNAUTHORIZED', message: 'Token de acceso inválido o expirado' },
  forbiddenRole: { code: 'FORBIDDEN', message: 'No tienes permiso para realizar esta acción' },
  missingApiKey: { code: 'UNAUTHORIZED', message: 'Falta la API key' },
  invalidApiKey: { code: 'INVALID_API_KEY', message: 'API key inválida o revocada' },
  apiKeyWithout: (permission: string) => ({
    code: 'FORBIDDEN',
    message: `La API key no tiene el permiso ${permission}`,
  }),
  rateLimit: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: `Se superó el límite de ${env.API_KEY_RATE_LIMIT_PER_MINUTE} solicitudes por minuto de esta API key`,
  },
  spaceNotFound: { code: 'SPACE_NOT_FOUND', message: 'El espacio no existe' },
} satisfies Record<string, ErrorBody | ((permission: string) => ErrorBody)>;

// ---------- Componentes ----------

// Esquemas de shared con nombre: el generador los pone en components/schemas y los referencia con $ref.
// Se usa .meta({ id }) de Zod 4 y no extendZodWithOpenApi: ese agrega .openapi() solo a los esquemas
// creados después de llamarlo, y los de shared ya existen. .meta() los registra en el registro global
// de Zod, que no admite ids repetidos, así que se crean una sola vez al cargar el módulo.
const ErrorResponse = ErrorResponseSchema.meta({ id: 'ErrorResponse' });
const Health = HealthResponseSchema.meta({ id: 'HealthResponse' });
const PublicUser = PublicUserSchema.meta({ id: 'PublicUser' });
const LoginResponse = LoginResponseSchema.meta({ id: 'LoginResponse' });
const RefreshResponse = RefreshResponseSchema.meta({ id: 'RefreshResponse' });
const Space = SpaceSchema.meta({ id: 'Space' });
const Availability = AvailabilityResponseSchema.meta({ id: 'AvailabilityResponse' });
const Reservation = ReservationSchema.meta({ id: 'Reservation' });
const ApiKey = ApiKeySchema.meta({ id: 'ApiKey' });
const CreatedApiKey = CreatedApiKeySchema.meta({ id: 'CreatedApiKey' });
const NowResponse = NowResponseSchema.meta({ id: 'NowResponse' });

// ---------- Registro ----------

export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();

  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'Access token de `POST /auth/login` (vence en 15 minutos). Se renueva con `POST /auth/refresh`.',
  });
  registry.registerComponent('securitySchemes', 'apiKeyAuth', {
    type: 'apiKey',
    in: 'header',
    name: 'X-API-Key',
    description:
      'API key de un sistema externo (`rl_live_…`), creada por un ADMIN en `POST /api-keys`. Solo sirve en los ' +
      `endpoints de lectura que lo indican, según sus permisos, y tiene un límite de ${env.API_KEY_RATE_LIMIT_PER_MINUTE} solicitudes por minuto.`,
  });

  registry.registerComponent('headers', 'X-Cache', {
    description: `\`MISS\` si la respuesta se calculó en la base, \`HIT\` si vino de la caché de Redis (${env.CACHE_TTL_SECONDS} s como máximo; se invalida al cambiar los datos).`,
    schema: { type: 'string', enum: ['HIT', 'MISS'] },
  });
  registry.registerComponent('headers', 'X-RateLimit-Limit', {
    description: 'Solicitudes por minuto permitidas para la API key. Solo con API key.',
    schema: { type: 'integer', example: env.API_KEY_RATE_LIMIT_PER_MINUTE },
  });
  registry.registerComponent('headers', 'X-RateLimit-Remaining', {
    description: 'Solicitudes que le quedan a la API key en el minuto actual. Solo con API key.',
    schema: { type: 'integer', example: 57 },
  });
  registry.registerComponent('headers', 'Retry-After', {
    description: 'Segundos hasta que empieza el siguiente minuto y la API key puede volver a consultar.',
    schema: { type: 'integer', example: 23 },
  });

  const header = (name: string) => ({ $ref: `#/components/headers/${name}` });
  const rateLimitHeaders = {
    'X-RateLimit-Limit': header('X-RateLimit-Limit'),
    'X-RateLimit-Remaining': header('X-RateLimit-Remaining'),
  };

  // Cada elemento es una alternativa: jwtOrApiKey acepta cualquiera de los dos esquemas.
  const security: Record<string, Record<string, string[]>[]> = {
    none: [],
    jwt: [{ bearerAuth: [] }],
    apiKey: [{ apiKeyAuth: [] }],
    jwtOrApiKey: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
  };

  // ---------- Ayudas para las respuestas ----------

  function json(schema: z.ZodType, description: string, example: unknown, headers?: ResponseConfig['headers']): ResponseConfig {
    return { description, headers, content: { 'application/json': { schema, example } } };
  }

  function body(schema: z.ZodType, example: unknown) {
    return { body: { required: true, content: { 'application/json': { schema, example } } } };
  }

  // Respuesta de error con un ejemplo por cada caso real que puede devolver el endpoint
  function error(description: string, cases: ErrorBody[], headers?: ResponseConfig['headers']): ResponseConfig {
    const examples: Record<string, { summary: string; value: ErrorResponse }> = {};
    for (const item of cases) {
      let name = item.code;
      for (let n = 2; name in examples; n++) name = `${item.code}_${n}`;
      examples[name] = { summary: item.message, value: { error: item } };
    }
    return { description, headers, content: { 'application/json': { schema: ErrorResponse, examples } } };
  }

  const badRequest = (...extra: ErrorBody[]) =>
    error('Datos inválidos', [errors.validation, errors.invalidJson, ...extra]);
  const badParams = (...extra: ErrorBody[]) => error('Parámetros inválidos', [errors.validation, ...extra]);
  const unauthorizedJwt = error('Falta el access token, es inválido o expiró', [
    errors.missingToken,
    errors.invalidToken,
  ]);
  const forbiddenRole = error('El rol del usuario no tiene permiso', [errors.forbiddenRole]);
  const tooManyRequests = error('La API key superó su límite de solicitudes por minuto', [errors.rateLimit], {
    'Retry-After': header('Retry-After'),
    ...rateLimitHeaders,
  });

  function path(config: RouteConfig): void {
    registry.registerPath(config);
  }

  // ---------- Salud ----------

  path({
    method: 'get',
    path: '/health',
    tags: ['Salud'],
    summary: 'Estado de la API, la base y Redis',
    description: 'Público. Comprueba la conexión con PostgreSQL y con Redis.',
    security: security.none,
    responses: {
      200: json(Health, 'Todo responde', { status: 'ok', checks: { database: 'ok', redis: 'ok' } }),
      503: json(Health, 'Falla la base o Redis', { status: 'error', checks: { database: 'ok', redis: 'error' } }),
    },
  });

  // ---------- Autenticación ----------

  path({
    method: 'post',
    path: '/auth/register',
    tags: ['Autenticación'],
    summary: 'Registrar un usuario',
    description: 'Público. Siempre crea el usuario con rol `ESTUDIANTE`; los demás roles los asigna un administrador.',
    security: security.none,
    request: body(RegisterSchema, { email: 'ana.lopez@umes.edu.gt', name: 'Ana López', password: 'contraseña-segura' }),
    responses: {
      201: json(PublicUser, 'Usuario creado', { ...userExample, role: 'ESTUDIANTE' }),
      400: badRequest(),
      409: error('El correo ya está registrado', [
        { code: 'EMAIL_ALREADY_REGISTERED', message: 'Ya existe una cuenta con ese correo' },
      ]),
    },
  });

  path({
    method: 'post',
    path: '/auth/login',
    tags: ['Autenticación'],
    summary: 'Iniciar sesión',
    description:
      'Público. Devuelve un access token JWT (15 minutos) y un refresh token opaco (7 días). Guarde el refresh token: ' +
      'la API solo conserva su hash.',
    security: security.none,
    request: body(LoginSchema, { email: 'ana.lopez@umes.edu.gt', password: 'contraseña-segura' }),
    responses: {
      200: json(LoginResponse, 'Sesión iniciada', {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiRE9DRU5URSJ9.firma',
        refreshToken: 'q8ZtV1x0bN3mK5pR7sT9uW2yA4cE6gI8kM0oQ2sU4wY',
      }),
      400: badRequest(),
      401: error('Credenciales incorrectas', [
        { code: 'INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos' },
      ]),
    },
  });

  const invalidRefreshToken = {
    code: 'INVALID_REFRESH_TOKEN',
    message: 'El refresh token no es válido, expiró o fue revocado',
  };

  path({
    method: 'post',
    path: '/auth/refresh',
    tags: ['Autenticación'],
    summary: 'Renovar el access token',
    description: 'Público. Cambia un refresh token vigente por un access token nuevo.',
    security: security.none,
    request: body(RefreshTokenSchema, { refreshToken: 'q8ZtV1x0bN3mK5pR7sT9uW2yA4cE6gI8kM0oQ2sU4wY' }),
    responses: {
      200: json(RefreshResponse, 'Access token nuevo', {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiRE9DRU5URSJ9.firma',
      }),
      400: badRequest(),
      401: error('Refresh token inválido', [invalidRefreshToken]),
    },
  });

  path({
    method: 'post',
    path: '/auth/logout',
    tags: ['Autenticación'],
    summary: 'Cerrar sesión',
    description:
      '**Requiere:** JWT de cualquier rol. Revoca el refresh token enviado, que debe pertenecer al usuario del access token.',
    security: security.jwt,
    request: body(RefreshTokenSchema, { refreshToken: 'q8ZtV1x0bN3mK5pR7sT9uW2yA4cE6gI8kM0oQ2sU4wY' }),
    responses: {
      204: { description: 'Sesión cerrada' },
      400: badRequest(),
      401: error('Falta el access token o el refresh token no es válido', [
        errors.missingToken,
        errors.invalidToken,
        invalidRefreshToken,
      ]),
    },
  });

  path({
    method: 'get',
    path: '/auth/me',
    tags: ['Autenticación'],
    summary: 'Usuario autenticado',
    description: '**Requiere:** JWT de cualquier rol.',
    security: security.jwt,
    responses: {
      200: json(PublicUser, 'Datos del usuario', userExample),
      401: error('Falta el access token, es inválido o el usuario ya no existe', [
        errors.missingToken,
        errors.invalidToken,
        { code: 'UNAUTHORIZED', message: 'El usuario del token ya no existe' },
      ]),
    },
  });

  // ---------- Espacios ----------

  const readSpacesAuth =
    '**Requiere:** JWT de cualquier rol, o una API key con el permiso `read:spaces` en la cabecera `X-API-Key` ' +
    '(si se envía `X-API-Key`, se usa la key aunque también haya un JWT). Con API key cuenta para el límite por minuto.';

  const unauthorizedJwtOrApiKey = error('Falta la autenticación, o el token o la API key no son válidos', [
    errors.missingToken,
    errors.invalidToken,
    errors.invalidApiKey,
  ]);
  const forbiddenApiKey = (permission: string) =>
    error('La API key no tiene el permiso necesario', [errors.apiKeyWithout(permission)]);

  path({
    method: 'get',
    path: '/spaces',
    tags: ['Espacios'],
    summary: 'Listar espacios',
    description: `${readSpacesAuth}\n\nOrdenados por edificio y nombre. \`building\` compara sin distinguir mayúsculas. Se cachea en Redis.`,
    security: security.jwtOrApiKey,
    request: { query: SpaceFiltersSchema },
    responses: {
      200: json(z.array(Space), 'Espacios que cumplen los filtros', [spaceExample], {
        'X-Cache': header('X-Cache'),
        ...rateLimitHeaders,
      }),
      400: badParams(),
      401: unauthorizedJwtOrApiKey,
      403: forbiddenApiKey('read:spaces'),
      429: tooManyRequests,
    },
  });

  path({
    method: 'get',
    path: '/spaces/{id}/availability',
    tags: ['Espacios'],
    summary: 'Disponibilidad de un espacio en un día',
    description:
      `${readSpacesAuth}\n\nBloques ocupados y libres entre las ${OPENING_HOUR}:00 y las ${CLOSING_HOUR}:00 del día indicado, ` +
      'en hora de Guatemala (UTC-6). Se cachea por espacio y fecha, y se invalida al reservar o cancelar.',
    security: security.jwtOrApiKey,
    request: { params: IdParamsSchema, query: AvailabilityQuerySchema },
    responses: {
      200: json(
        Availability,
        'Bloques del día',
        {
          spaceId: SPACE_ID,
          date: '2026-11-10',
          timezone: 'America/Guatemala',
          window: { startsAt: '2026-11-10T07:00:00-06:00', endsAt: '2026-11-10T21:00:00-06:00' },
          occupied: [{ startsAt: '2026-11-10T09:00:00-06:00', endsAt: '2026-11-10T11:00:00-06:00' }],
          free: [
            { startsAt: '2026-11-10T07:00:00-06:00', endsAt: '2026-11-10T09:00:00-06:00' },
            { startsAt: '2026-11-10T11:00:00-06:00', endsAt: '2026-11-10T21:00:00-06:00' },
          ],
        },
        { 'X-Cache': header('X-Cache'), ...rateLimitHeaders },
      ),
      400: badParams(),
      401: unauthorizedJwtOrApiKey,
      403: forbiddenApiKey('read:spaces'),
      404: error('El espacio no existe', [errors.spaceNotFound]),
      429: tooManyRequests,
    },
  });

  path({
    method: 'post',
    path: '/spaces',
    tags: ['Espacios'],
    summary: 'Crear un espacio',
    description: '**Requiere:** JWT de `ADMIN`. Las API keys no tienen acceso.',
    security: security.jwt,
    request: body(CreateSpaceSchema, { name: 'Laboratorio de Redes', building: 'Edificio A', capacity: 30 }),
    responses: {
      201: json(Space, 'Espacio creado', spaceExample),
      400: badRequest(),
      401: unauthorizedJwt,
      403: forbiddenRole,
    },
  });

  path({
    method: 'patch',
    path: '/spaces/{id}',
    tags: ['Espacios'],
    summary: 'Editar un espacio',
    description: '**Requiere:** JWT de `ADMIN`. Solo cambia los campos enviados; debe enviar al menos uno.',
    security: security.jwt,
    request: { params: IdParamsSchema, ...body(UpdateSpaceSchema, { capacity: 35 }) },
    responses: {
      200: json(Space, 'Espacio actualizado', { ...spaceExample, capacity: 35 }),
      400: badRequest(),
      401: unauthorizedJwt,
      403: forbiddenRole,
      404: error('El espacio no existe', [errors.spaceNotFound]),
    },
  });

  path({
    method: 'delete',
    path: '/spaces/{id}',
    tags: ['Espacios'],
    summary: 'Borrar un espacio',
    description:
      '**Requiere:** JWT de `ADMIN`. No se puede borrar un espacio con reservas confirmadas en curso o futuras; ' +
      'las reservas pasadas o canceladas se borran con él.',
    security: security.jwt,
    request: { params: IdParamsSchema },
    responses: {
      204: { description: 'Espacio borrado' },
      400: badParams(),
      401: unauthorizedJwt,
      403: forbiddenRole,
      404: error('El espacio no existe', [errors.spaceNotFound]),
      409: error('El espacio tiene reservas vigentes', [
        { code: 'SPACE_HAS_RESERVATIONS', message: 'El espacio tiene reservas confirmadas vigentes o futuras' },
      ]),
    },
  });

  // ---------- Reservas ----------

  path({
    method: 'post',
    path: '/reservations',
    tags: ['Reservas'],
    summary: 'Crear una reserva',
    description:
      '**Requiere:** JWT de `DOCENTE` o `ADMIN`.\n\n' +
      `La reserva debe empezar en el futuro y caber en un mismo día entre las ${OPENING_HOUR}:00 y las ${CLOSING_HOUR}:00 ` +
      'en hora de Guatemala. Las horas se envían en ISO 8601 con desfase (`-06:00`) o en UTC (`Z`). Un espacio no admite ' +
      'dos reservas confirmadas que se traslapen; los rangos son semiabiertos, así que una reserva puede empezar justo ' +
      'cuando termina otra.',
    security: security.jwt,
    request: body(CreateReservationSchema, {
      spaceId: SPACE_ID,
      startsAt: '2026-11-10T09:00:00-06:00',
      endsAt: '2026-11-10T11:00:00-06:00',
    }),
    responses: {
      201: json(Reservation, 'Reserva confirmada', reservationExample),
      400: badRequest(
        { code: 'INVALID_TIME_RANGE', message: 'endsAt debe ser posterior a startsAt' },
        { code: 'RESERVATION_IN_PAST', message: 'No se puede reservar en el pasado' },
        {
          code: 'OUTSIDE_OPERATING_HOURS',
          message: `La reserva debe estar dentro del mismo día, entre las ${OPENING_HOUR}:00 y las ${CLOSING_HOUR}:00 (hora de Guatemala)`,
        },
      ),
      401: unauthorizedJwt,
      403: forbiddenRole,
      404: error('El espacio no existe', [errors.spaceNotFound]),
      409: error('El horario se traslapa con otra reserva', [
        { code: 'RESERVATION_OVERLAP', message: 'El espacio ya está reservado en ese horario' },
      ]),
    },
  });

  path({
    method: 'get',
    path: '/reservations/me',
    tags: ['Reservas'],
    summary: 'Mis reservas',
    description: '**Requiere:** JWT de cualquier rol. Solo devuelve las reservas del usuario autenticado, confirmadas y canceladas.',
    security: security.jwt,
    responses: {
      200: json(z.array(Reservation), 'Reservas del usuario', [reservationExample]),
      401: unauthorizedJwt,
    },
  });

  path({
    method: 'delete',
    path: '/reservations/{id}',
    tags: ['Reservas'],
    summary: 'Cancelar una reserva',
    description:
      '**Requiere:** JWT del dueño de la reserva o de un `ADMIN`. No borra la reserva: la pasa a `CANCELLED` y libera el horario.',
    security: security.jwt,
    request: { params: IdParamsSchema },
    responses: {
      200: json(Reservation, 'Reserva cancelada', { ...reservationExample, status: 'CANCELLED' }),
      400: badParams(),
      401: unauthorizedJwt,
      403: error('No es el dueño ni ADMIN', [
        { code: 'FORBIDDEN', message: 'Solo el dueño de la reserva o un administrador puede cancelarla' },
      ]),
      404: error('La reserva no existe', [{ code: 'RESERVATION_NOT_FOUND', message: 'La reserva no existe' }]),
      409: error('La reserva ya estaba cancelada', [
        { code: 'RESERVATION_ALREADY_CANCELLED', message: 'La reserva ya estaba cancelada' },
      ]),
    },
  });

  // ---------- API keys ----------

  const manageKeysAuth = '**Requiere:** JWT de `ADMIN`. Una API key nunca puede gestionar API keys.';

  path({
    method: 'post',
    path: '/api-keys',
    tags: ['API keys'],
    summary: 'Crear una API key',
    description:
      `${manageKeysAuth}\n\nLa respuesta trae la key completa (\`key\`) **por única vez**: la API solo guarda su hash ` +
      'SHA-256 y un prefijo para reconocerla. Permisos disponibles: `read:spaces` (listado y disponibilidad) y ' +
      '`read:now` (pantalla informativa). Los permisos repetidos se ignoran.',
    security: security.jwt,
    request: body(CreateApiKeySchema, { name: 'Pantalla del Edificio A', permissions: ['read:now'] }),
    responses: {
      201: json(CreatedApiKey, 'API key creada', {
        ...apiKeyExample,
        lastUsedAt: null,
        key: 'rl_live_Xk3v9QpL2mN8rT5wY1aC4eG7iK0oS3uW6zB9dF2hJ5l',
      }),
      400: badRequest(),
      401: unauthorizedJwt,
      403: forbiddenRole,
    },
  });

  path({
    method: 'get',
    path: '/api-keys',
    tags: ['API keys'],
    summary: 'Listar las API keys',
    description: `${manageKeysAuth}\n\nIncluye las revocadas. Nunca devuelve la key ni su hash, solo el prefijo.`,
    security: security.jwt,
    responses: {
      200: json(z.array(ApiKey), 'API keys, de la más reciente a la más antigua', [apiKeyExample]),
      401: unauthorizedJwt,
      403: forbiddenRole,
    },
  });

  path({
    method: 'delete',
    path: '/api-keys/{id}',
    tags: ['API keys'],
    summary: 'Revocar una API key',
    description: `${manageKeysAuth}\n\nLa key deja de funcionar de inmediato (401 \`INVALID_API_KEY\`). No se borra: queda con \`revokedAt\`.`,
    security: security.jwt,
    request: { params: IdParamsSchema },
    responses: {
      200: json(ApiKey, 'API key revocada', { ...apiKeyExample, revokedAt: '2026-11-12T08:00:00.000Z' }),
      400: badParams(),
      401: unauthorizedJwt,
      403: forbiddenRole,
      404: error('La API key no existe', [{ code: 'API_KEY_NOT_FOUND', message: 'La API key no existe' }]),
      409: error('La API key ya estaba revocada', [
        { code: 'API_KEY_ALREADY_REVOKED', message: 'La API key ya estaba revocada' },
      ]),
    },
  });

  // ---------- Pantalla informativa ----------

  path({
    method: 'get',
    path: '/now',
    tags: ['Pantalla informativa'],
    summary: 'Estado actual de todos los espacios',
    description:
      '**Requiere:** API key con el permiso `read:now` en la cabecera `X-API-Key`. Un JWT no sirve aquí. Cuenta para ' +
      'el límite por minuto.\n\n' +
      'Para cada espacio indica si está ocupado en este momento (y hasta cuándo, uniendo reservas seguidas) y su siguiente ' +
      'reserva del día. Usa el reloj del servidor y la hora de Guatemala. Se cachea hasta el próximo cambio de estado, ' +
      `con ${env.CACHE_TTL_SECONDS} s como máximo.`,
    security: security.apiKey,
    responses: {
      200: json(
        NowResponse,
        'Estado de los espacios',
        {
          now: '2026-11-10T10:15:00-06:00',
          timezone: 'America/Guatemala',
          spaces: [
            {
              id: SPACE_ID,
              name: 'Laboratorio de Redes',
              building: 'Edificio A',
              capacity: 30,
              status: 'OCCUPIED',
              occupiedUntil: '2026-11-10T11:00:00-06:00',
              nextReservation: { startsAt: '2026-11-10T14:00:00-06:00', endsAt: '2026-11-10T16:00:00-06:00' },
            },
            {
              id: OTHER_SPACE_ID,
              name: 'Salón 204',
              building: 'Edificio B',
              capacity: 40,
              status: 'FREE',
              occupiedUntil: null,
              nextReservation: null,
            },
          ],
        },
        { 'X-Cache': header('X-Cache'), ...rateLimitHeaders },
      ),
      401: error('Falta la API key o no es válida', [errors.missingApiKey, errors.invalidApiKey]),
      403: forbiddenApiKey('read:now'),
      429: tooManyRequests,
    },
  });

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'ReservaLab API',
      version: '1.0.0',
      description:
        'API para reservar laboratorios y salones de la UMES Quetzaltenango.\n\n' +
        '- Todas las horas van en ISO 8601. Las respuestas usan la hora de Guatemala (`-06:00`).\n' +
        '- Los errores siempre tienen el formato `{ "error": { "code", "message" } }`. Los de validación agregan `details` con un elemento por campo.\n' +
        '- Autenticación: JWT (`bearerAuth`) para usuarios y API key (`apiKeyAuth`) para sistemas externos de solo lectura.',
    },
    servers: [{ url: API_V1_BASE_PATH }],
    tags: [
      { name: 'Salud' },
      { name: 'Autenticación', description: 'Registro, sesión y tokens' },
      { name: 'Espacios', description: 'Laboratorios y salones, y su disponibilidad' },
      { name: 'Reservas' },
      { name: 'API keys', description: 'Gestión de las keys de sistemas externos' },
      { name: 'Pantalla informativa', description: 'Para pantallas de los edificios, con API key' },
    ],
  });
}
