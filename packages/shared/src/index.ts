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

// Formato común de los errores de la API
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: { field: string; message: string }[];
  };
}
