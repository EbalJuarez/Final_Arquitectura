import type { z } from 'zod';
import { ApiClient, DEFAULT_API_URL } from './api-client';
import { configSessionStore } from './config';
import { CliError } from './errors';

// Lo que necesita cada comando: el cliente de la API y si la salida va en JSON.
export interface Context {
  apiUrl: string;
  client: ApiClient;
  json: boolean;
}

export function createContext(json: boolean): Context {
  const apiUrl = (process.env.RESERVALAB_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
  return { apiUrl, client: new ApiClient(apiUrl, configSessionStore(apiUrl)), json };
}

// Valida los datos del usuario con el esquema de shared antes de enviarlos, con el mismo formato de
// error que la API (VALIDATION_ERROR con un detalle por campo).
export function parseInput<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new CliError(
      'VALIDATION_ERROR',
      'Los datos ingresados no son válidos',
      parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    );
  }
  return parsed.data;
}
