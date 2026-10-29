import { z } from 'zod';

// Roles de usuario del sistema
export const RoleSchema = z.enum(['ESTUDIANTE', 'DOCENTE', 'ADMIN']);
export type Role = z.infer<typeof RoleSchema>;

// Datos para registrar un usuario nuevo
export const RegisterSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(2),
  password: z.string().min(8),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

// Credenciales para iniciar sesión
export const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginSchema>;
