import { ErrorResponseSchema, RefreshResponseSchema } from '@reservalab/shared';
import type { z } from 'zod';
import { ApiError, CliError, SessionError } from './errors';

// Cliente HTTP de la API. Valida cada respuesta con los esquemas de @reservalab/shared y traduce los
// errores de la API ({ error: { code, message } }) a ApiError. Si el access token expiró, lo renueva
// una sola vez con el refresh token y repite la solicitud.

export const DEFAULT_API_URL = 'http://localhost:3000';

export interface Session {
  accessToken: string;
  refreshToken: string;
}

// Dónde vive la sesión (en el CLI, ~/.reservalab/config.json; en las pruebas, memoria)
export interface SessionStore {
  load(): Promise<Session | null>;
  saveAccessToken(accessToken: string): Promise<void>;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestOptions<T> {
  body?: unknown;
  // Esquema de la respuesta; sin esquema no se lee el cuerpo (por ejemplo, 204)
  schema?: z.ZodType<T>;
  // false en login, que no lleva access token
  auth?: boolean;
}

export class ApiClient {
  private readonly baseUrl: string;

  constructor(
    apiUrl: string,
    private readonly store: SessionStore,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.baseUrl = `${apiUrl.replace(/\/+$/, '')}/api/v1`;
  }

  async request<T = undefined>(method: Method, path: string, options: RequestOptions<T> = {}): Promise<T> {
    const { body, schema, auth = true } = options;
    if (!auth) {
      return this.parse(await this.send(method, path, body), schema);
    }

    const session = await this.store.load();
    if (!session) {
      throw new SessionError('No has iniciado sesión');
    }

    let response = await this.send(method, path, body, session.accessToken);
    if (response.status === 401) {
      // Access token vencido o inválido: se renueva una sola vez y se reintenta
      const accessToken = await this.refresh(session.refreshToken);
      response = await this.send(method, path, body, accessToken);
      if (response.status === 401) {
        throw new SessionError('La API rechazó el token renovado');
      }
    }
    return this.parse(response, schema);
  }

  private async refresh(refreshToken: string): Promise<string> {
    const response = await this.send('POST', '/auth/refresh', { refreshToken });
    if (response.status === 401) {
      throw new SessionError('La sesión expiró');
    }
    const { accessToken } = await this.parse(response, RefreshResponseSchema);
    await this.store.saveAccessToken(accessToken);
    return accessToken;
  }

  private async send(method: Method, path: string, body?: unknown, accessToken?: string): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    try {
      return await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new CliError('NETWORK_ERROR', `No se pudo conectar con la API en ${this.baseUrl}. ¿Está levantada?`);
    }
  }

  private async parse<T>(response: Response, schema?: z.ZodType<T>): Promise<T> {
    if (!response.ok) {
      throw await toApiError(response);
    }
    if (!schema || response.status === 204) {
      return undefined as T;
    }
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new CliError('INVALID_RESPONSE', 'La respuesta de la API no tiene el formato esperado');
    }
    return parsed.data;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = ErrorResponseSchema.safeParse(await response.json().catch(() => undefined));
  if (body.success) {
    const { code, message, details } = body.data.error;
    return new ApiError(response.status, code, message, details);
  }
  return new ApiError(
    response.status,
    `HTTP_${response.status}`,
    `La API respondió ${response.status} ${response.statusText}`.trim(),
  );
}
