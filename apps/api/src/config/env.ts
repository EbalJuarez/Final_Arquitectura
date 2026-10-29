import { z } from 'zod';

// Variables de entorno que la API necesita; falla al arrancar si falta alguna.
const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(3000),
  JWT_ACCESS_SECRET: z.string().min(16),
  // Vida del access token (15 min) y del refresh token (7 días)
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
});

export const env = EnvSchema.parse(process.env);
