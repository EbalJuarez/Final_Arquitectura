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

// Formato común de los errores de la API
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: { field: string; message: string }[];
  };
}
