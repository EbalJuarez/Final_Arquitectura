import { z } from 'zod';

// Roles de usuario del sistema
export const RoleSchema = z.enum(['ESTUDIANTE', 'DOCENTE', 'ADMIN']);
export type Role = z.infer<typeof RoleSchema>;

// Correo normalizado (sin espacios y en minúsculas) para que no haya duplicados por mayúsculas
const EmailSchema = z.string().trim().toLowerCase().pipe(z.email());

// Datos para registrar un usuario nuevo
export const RegisterSchema = z.object({
  email: EmailSchema,
  name: z.string().trim().min(2),
  password: z.string().min(8),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

// Credenciales para iniciar sesión
export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginSchema>;

// Cuerpo de /auth/refresh y /auth/logout
export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;

// Usuario tal como lo devuelve la API (nunca incluye el hash de la contraseña)
export const PublicUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: RoleSchema,
  createdAt: z.iso.datetime(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

// Respuesta de /auth/login
export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// Respuesta de /auth/refresh
export const RefreshResponseSchema = z.object({
  accessToken: z.string(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

// Parámetro :id de las rutas (todos los ids son UUID)
export const IdParamsSchema = z.object({
  id: z.uuid(),
});
export type IdParams = z.infer<typeof IdParamsSchema>;

// Datos para crear un espacio (laboratorio o salón)
export const CreateSpaceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  building: z.string().trim().min(1).max(100),
  capacity: z.number().int().positive().max(1000),
});
export type CreateSpaceInput = z.infer<typeof CreateSpaceSchema>;

// Edición parcial de un espacio: al menos un campo
export const UpdateSpaceSchema = CreateSpaceSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'Debe enviar al menos un campo para actualizar' },
);
export type UpdateSpaceInput = z.infer<typeof UpdateSpaceSchema>;

// Filtros de GET /spaces (llegan como query string, por eso se convierte minCapacity)
export const SpaceFiltersSchema = z.object({
  building: z.string().trim().min(1).optional(),
  minCapacity: z.coerce.number().int().positive().optional(),
});
export type SpaceFilters = z.infer<typeof SpaceFiltersSchema>;

// Espacio tal como lo devuelve la API
export const SpaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  building: z.string(),
  capacity: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type Space = z.infer<typeof SpaceSchema>;

// Query de GET /spaces/:id/availability: un día en formato YYYY-MM-DD (hora de Guatemala)
export const AvailabilityQuerySchema = z.object({
  date: z.iso.date(),
});
export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;

// Bloque de tiempo; las horas van en ISO 8601 con el desfase de Guatemala (-06:00)
export const TimeBlockSchema = z.object({
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
});
export type TimeBlock = z.infer<typeof TimeBlockSchema>;

// Respuesta de GET /spaces/:id/availability
export const AvailabilityResponseSchema = z.object({
  spaceId: z.uuid(),
  date: z.iso.date(),
  timezone: z.string(),
  window: TimeBlockSchema,
  occupied: z.array(TimeBlockSchema),
  free: z.array(TimeBlockSchema),
});
export type AvailabilityResponse = z.infer<typeof AvailabilityResponseSchema>;

// Estados de una reserva
export const ReservationStatusSchema = z.enum(['CONFIRMED', 'CANCELLED']);
export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;

// Datos para crear una reserva. Las horas van en ISO 8601 con desfase o en UTC,
// por ejemplo 2026-11-03T09:00:00-06:00 o 2026-11-03T15:00:00Z.
export const CreateReservationSchema = z.object({
  spaceId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
});
export type CreateReservationInput = z.infer<typeof CreateReservationSchema>;

// Reserva tal como la devuelve la API (horas con el desfase de Guatemala, -06:00)
export const ReservationSchema = z.object({
  id: z.uuid(),
  space: z.object({ id: z.uuid(), name: z.string(), building: z.string() }),
  userId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  status: ReservationStatusSchema,
  createdAt: z.iso.datetime(),
});
export type Reservation = z.infer<typeof ReservationSchema>;

// ---------- API keys ----------

// Permisos que puede tener una API key de un sistema externo
export const ApiKeyPermissionSchema = z.enum(['read:spaces', 'read:now']);
export type ApiKeyPermission = z.infer<typeof ApiKeyPermissionSchema>;

// Datos para crear una API key; los permisos repetidos se ignoran
export const CreateApiKeySchema = z.object({
  name: z.string().trim().min(2).max(100),
  permissions: z
    .array(ApiKeyPermissionSchema)
    .min(1, 'Debe incluir al menos un permiso')
    .transform((permissions) => [...new Set(permissions)]),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;

// API key tal como la lista la API: nunca incluye la key ni su hash
export const ApiKeySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string(),
  permissions: z.array(ApiKeyPermissionSchema),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

// Respuesta de creación: la única vez que se devuelve la key completa
export const CreatedApiKeySchema = ApiKeySchema.extend({ key: z.string() });
export type CreatedApiKey = z.infer<typeof CreatedApiKeySchema>;

// ---------- Pantalla informativa (GET /now) ----------

export const SpaceNowStatusSchema = z.enum(['FREE', 'OCCUPIED']);
export type SpaceNowStatus = z.infer<typeof SpaceNowStatusSchema>;

// Estado de un espacio en este momento. occupiedUntil es la hora en que se libera (null si está libre);
// si hay reservas seguidas sin hueco, es el fin de la última. nextReservation es la siguiente reserva
// del día que empieza después de que se libere, o null si no hay.
export const NowSpaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  building: z.string(),
  capacity: z.number().int(),
  status: SpaceNowStatusSchema,
  occupiedUntil: z.iso.datetime({ offset: true }).nullable(),
  nextReservation: TimeBlockSchema.nullable(),
});
export type NowSpace = z.infer<typeof NowSpaceSchema>;

// Respuesta de GET /now; todas las horas con el desfase de Guatemala (-06:00)
export const NowResponseSchema = z.object({
  now: z.iso.datetime({ offset: true }),
  timezone: z.string(),
  spaces: z.array(NowSpaceSchema),
});
export type NowResponse = z.infer<typeof NowResponseSchema>;

// Formato común de los errores de la API
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: { field: string; message: string }[];
  };
}
