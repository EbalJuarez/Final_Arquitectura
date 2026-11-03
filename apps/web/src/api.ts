import {
  AvailabilityResponseSchema,
  ErrorResponseSchema,
  LoginResponseSchema,
  NowResponseSchema,
  PublicUserSchema,
  RefreshResponseSchema,
  ReservationSchema,
  SpaceSchema,
  type CreateReservationInput,
  type LoginInput,
  type RegisterInput,
  type SpaceFilters,
} from '@reservalab/shared';
import { z } from 'zod';

// Único cliente de la API de la web: ninguna pantalla llama a fetch directamente. Las rutas son
// relativas (/api/v1): en desarrollo las reenvía Vite y en Docker nginx, así que la web y la API
// comparten origen. Cada respuesta se valida con los esquemas de @reservalab/shared.

const BASE_PATH = '/api/v1';
const SESSION_KEY = 'reservalab.session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { field: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// No se pudo hablar con la API (sin red, API caída)
export class NetworkError extends Error {
  constructor() {
    super('No se pudo conectar con el servidor');
    this.name = 'NetworkError';
  }
}

// ---------- Sesión (tokens en localStorage) ----------

interface Session {
  accessToken: string;
  refreshToken: string;
}

const SessionSchema = z.object({ accessToken: z.string(), refreshToken: z.string() });

function loadSession(): Session | null {
  try {
    const parsed = SessionSchema.safeParse(JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null'));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function hasSession(): boolean {
  return loadSession() !== null;
}

// Se avisa a la app cuando la sesión deja de servir (refresh token vencido o revocado)
let sessionExpiredListener: () => void = () => {};
export function onSessionExpired(listener: () => void): void {
  sessionExpiredListener = listener;
}

// ---------- Solicitudes ----------

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface RequestOptions<T> {
  body?: unknown;
  schema?: z.ZodType<T>;
  // jwt: con el access token (y renovación); apiKey: cabecera X-API-Key; none: sin credenciales
  auth?: 'jwt' | { apiKey: string } | 'none';
}

async function send(method: Method, path: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  try {
    return await fetch(`${BASE_PATH}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError();
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const parsed = ErrorResponseSchema.safeParse(await response.json().catch(() => undefined));
  if (parsed.success) {
    const { code, message, details } = parsed.data.error;
    return new ApiError(response.status, code, message, details);
  }
  return new ApiError(response.status, `HTTP_${response.status}`, `El servidor respondió ${response.status}`);
}

async function parse<T>(response: Response, schema?: z.ZodType<T>): Promise<T> {
  if (!response.ok) throw await toApiError(response);
  if (!schema || response.status === 204) return undefined as T;
  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'La respuesta del servidor no tiene el formato esperado');
  }
  return parsed.data;
}

function sessionExpired(): ApiError {
  clearSession();
  sessionExpiredListener();
  return new ApiError(401, 'SESSION_EXPIRED', 'Tu sesión expiró. Inicia sesión de nuevo.');
}

// Si varias solicitudes reciben 401 a la vez, comparten una sola renovación.
let refreshing: Promise<string | null> | null = null;

function refreshAccessToken(refreshToken: string): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      const response = await send('POST', '/auth/refresh', { refreshToken }, {});
      if (!response.ok) return null;
      const { accessToken } = await parse(response, RefreshResponseSchema);
      saveSession({ accessToken, refreshToken });
      return accessToken;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function request<T = undefined>(method: Method, path: string, options: RequestOptions<T> = {}): Promise<T> {
  const { body, schema, auth = 'jwt' } = options;

  if (auth === 'none') return parse(await send(method, path, body, {}), schema);
  if (typeof auth === 'object') return parse(await send(method, path, body, { 'X-API-Key': auth.apiKey }), schema);

  const session = loadSession();
  if (!session) throw sessionExpired();

  let response = await send(method, path, body, { Authorization: `Bearer ${session.accessToken}` });
  if (response.status === 401) {
    // Access token vencido: se renueva una sola vez con el refresh token y se repite la solicitud
    const accessToken = await refreshAccessToken(session.refreshToken);
    if (!accessToken) throw sessionExpired();
    response = await send(method, path, body, { Authorization: `Bearer ${accessToken}` });
    if (response.status === 401) throw sessionExpired();
  }
  return parse(response, schema);
}

// ---------- Endpoints ----------

export async function register(input: RegisterInput) {
  return request('POST', '/auth/register', { body: input, schema: PublicUserSchema, auth: 'none' });
}

export async function login(input: LoginInput): Promise<void> {
  saveSession(await request('POST', '/auth/login', { body: input, schema: LoginResponseSchema, auth: 'none' }));
}

// Revoca el refresh token en la API. La sesión local se borra aunque la API no responda.
export async function logout(): Promise<void> {
  const session = loadSession();
  try {
    if (session) await request('POST', '/auth/logout', { body: { refreshToken: session.refreshToken } });
  } finally {
    clearSession();
  }
}

export function getMe() {
  return request('GET', '/auth/me', { schema: PublicUserSchema });
}

export function listSpaces(filters: SpaceFilters) {
  const query = new URLSearchParams();
  if (filters.building) query.set('building', filters.building);
  if (filters.minCapacity) query.set('minCapacity', String(filters.minCapacity));
  const suffix = query.size > 0 ? `?${query}` : '';
  return request('GET', `/spaces${suffix}`, { schema: z.array(SpaceSchema) });
}

export function getAvailability(spaceId: string, date: string) {
  const query = new URLSearchParams({ date });
  return request('GET', `/spaces/${encodeURIComponent(spaceId)}/availability?${query}`, {
    schema: AvailabilityResponseSchema,
  });
}

export function createReservation(input: CreateReservationInput) {
  return request('POST', '/reservations', { body: input, schema: ReservationSchema });
}

export function listMyReservations() {
  return request('GET', '/reservations/me', { schema: z.array(ReservationSchema) });
}

export function cancelReservation(id: string) {
  return request('DELETE', `/reservations/${encodeURIComponent(id)}`, { schema: ReservationSchema });
}

// Pantalla informativa: con la API key read:now de VITE_INFO_API_KEY, sin sesión de usuario
export function getNow(apiKey: string) {
  return request('GET', '/now', { schema: NowResponseSchema, auth: { apiKey } });
}
