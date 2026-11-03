import { SpaceSchema } from '@reservalab/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiClient, type Session, type SessionStore } from './api-client';
import { ApiError, CliError, SessionError } from './errors';

// fetch mockeado: estas pruebas no abren conexiones.

const API_URL = 'http://api.prueba';
const space = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'Laboratorio de Redes',
  building: 'Edificio A',
  capacity: 30,
  createdAt: '2026-11-01T15:30:00.000Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const unauthorized = () => jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'Token de acceso inválido o expirado' } });

// Sesión en memoria
function memoryStore(session: Session | null) {
  const store = {
    session,
    load: vi.fn(async () => store.session),
    saveAccessToken: vi.fn(async (accessToken: string) => {
      store.session = { ...store.session!, accessToken };
    }),
  };
  return store satisfies SessionStore;
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let store: ReturnType<typeof memoryStore>;
let client: ApiClient;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  store = memoryStore({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  client = new ApiClient(`${API_URL}/`, store, fetchMock);
});

// Datos de la llamada número n a fetch
function call(n: number) {
  const [url, init] = fetchMock.mock.calls[n]!;
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return { url, method: init?.method, headers, body: init?.body ? JSON.parse(String(init.body)) : undefined };
}

describe('solicitudes', () => {
  it('arma la URL bajo /api/v1, envía el access token y valida la respuesta con el esquema de shared', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [space]));

    const result = await client.request('GET', '/spaces?building=A', { schema: z.array(SpaceSchema) });

    expect(result).toEqual([space]);
    expect(call(0)).toMatchObject({
      url: 'http://api.prueba/api/v1/spaces?building=A',
      method: 'GET',
      headers: { Authorization: 'Bearer access-1', Accept: 'application/json' },
    });
    expect(call(0).headers['Content-Type']).toBeUndefined();
  });

  it('envía el cuerpo como JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, space));

    await client.request('POST', '/spaces', { body: { name: 'Lab', building: 'A', capacity: 30 }, schema: SpaceSchema });

    expect(call(0)).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { name: 'Lab', building: 'A', capacity: 30 },
    });
  });

  it('una respuesta 204 devuelve undefined sin leer el cuerpo', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(client.request('DELETE', `/spaces/${space.id}`)).resolves.toBeUndefined();
  });

  it('sin auth no envía token ni necesita sesión (login)', async () => {
    const anonymous = new ApiClient(API_URL, memoryStore(null), fetchMock);
    fetchMock.mockResolvedValue(jsonResponse(200, { accessToken: 'a', refreshToken: 'r' }));

    await anonymous.request('POST', '/auth/login', { body: { email: 'a@b.c', password: 'x' }, auth: false });

    expect(call(0).headers.Authorization).toBeUndefined();
  });

  it('sin sesión guardada pide iniciar sesión, sin llamar a la API', async () => {
    const anonymous = new ApiClient(API_URL, memoryStore(null), fetchMock);

    const error = await anonymous.request('GET', '/api-keys').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SessionError);
    expect((error as SessionError).message).toMatch(/No has iniciado sesión.*login/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('errores', () => {
  it('traduce { error: { code, message, details } } a ApiError con el estado HTTP', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Los datos enviados no son válidos',
          details: [{ field: 'capacity', message: 'Too small' }],
        },
      }),
    );

    const error = await client.request('POST', '/spaces', { body: {} }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Los datos enviados no son válidos',
      details: [{ field: 'capacity', message: 'Too small' }],
    });
  });

  it('un error sin el formato de la API queda como HTTP_<estado>', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }));

    await expect(client.request('GET', '/spaces')).rejects.toMatchObject({
      status: 502,
      code: 'HTTP_502',
      message: 'La API respondió 502 Bad Gateway',
    });
  });

  it('si no puede conectar lanza NETWORK_ERROR con la URL', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const error = await client.request('GET', '/spaces').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({ code: 'NETWORK_ERROR' });
    expect((error as CliError).message).toContain('http://api.prueba/api/v1');
  });

  it('una respuesta 200 que no cumple el esquema lanza INVALID_RESPONSE', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [{ id: 'no-es-un-espacio' }]));

    await expect(client.request('GET', '/spaces', { schema: z.array(SpaceSchema) })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});

describe('renovación del access token', () => {
  it('ante un 401 renueva con el refresh token, guarda el nuevo access token y reintenta una vez', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'access-2' }))
      .mockResolvedValueOnce(jsonResponse(200, [space]));

    const result = await client.request('GET', '/spaces', { schema: z.array(SpaceSchema) });

    expect(result).toEqual([space]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(call(1)).toMatchObject({
      url: 'http://api.prueba/api/v1/auth/refresh',
      method: 'POST',
      body: { refreshToken: 'refresh-1' },
    });
    expect(call(1).headers.Authorization).toBeUndefined();
    expect(call(2).headers.Authorization).toBe('Bearer access-2');
    expect(store.saveAccessToken).toHaveBeenCalledWith('access-2');
    expect(store.session).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-1' });
  });

  it('el reintento repite el mismo método y cuerpo', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'access-2' }))
      .mockResolvedValueOnce(jsonResponse(201, space));

    await client.request('POST', '/spaces', { body: { name: 'Lab' }, schema: SpaceSchema });

    expect(call(2)).toMatchObject({ method: 'POST', body: { name: 'Lab' } });
  });

  it('si el refresh token también expiró, pide volver a ejecutar login y no reintenta', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'El refresh token no es válido' } }),
      );

    const error = await client.request('GET', '/spaces').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SessionError);
    expect(error).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect((error as SessionError).message).toMatch(/expiró.*pnpm cli login/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.saveAccessToken).not.toHaveBeenCalled();
  });

  it('renueva una sola vez: si el token nuevo también da 401, no entra en un ciclo', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'access-2' }))
      .mockResolvedValueOnce(unauthorized());

    await expect(client.request('GET', '/spaces')).rejects.toBeInstanceOf(SessionError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('otros errores no disparan la renovación (403 se muestra tal cual)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'No tienes permiso para realizar esta acción' } }),
    );

    await expect(client.request('GET', '/api-keys')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('si la API falla al renovar (500), se muestra ese error', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' } }));

    await expect(client.request('GET', '/spaces')).rejects.toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  });

  it('un 401 en login (credenciales) no intenta renovar', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos' } }),
    );

    await expect(client.request('POST', '/auth/login', { body: {}, auth: false })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
