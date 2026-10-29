import { z } from 'zod';

// Variables de entorno que la API necesita; falla al arrancar si falta alguna.
const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(3000),
});

export const env = EnvSchema.parse(process.env);
