import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';

// fetch y localStorage simulados: estas pruebas corren en Node, sin navegador ni red.

const SESSION_KEY = 'reservalab.session';
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

const storage = new Map<string, string>();
const fetchMock = vi.fn<typeof fetch>();
const expired = vi.fn();

function setSession(accessToken: string, refreshToken: string) {
  storage.set(SESSION_KEY, JSON.stringify({ accessToken, refreshToken }));
}
const session = () => JSON.parse(storage.get(SESSION_KEY) ?? 'null') as { accessToken: string; refreshToken: string } | null;
const call = (n: number) => {
  const [url, init] = fetchMock.mock.calls[n]!;
  return { url, method: init?.method, headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined };
};

beforeEach(() => {
  storage.clear();
  fetchMock.mockReset();
  expired.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  api.onSessionExpired(expired);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sesión', () => {
  it('login guarda los tokens; las solicitudes usan rutas relativas /api/v1 con el access token', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'access-1', refreshToken: 'refresh-1' }))
      .mockResolvedValueOnce(jsonResponse(200, [space]));

    await api.login({ email: 'docente@reservalab.test', password: 'x' });
    const spaces = await api.listSpaces({ building: 'Edificio A', minCapacity: 20 });

    expect(api.hasSession()).toBe(true);
    expect(spaces).toEqual([space]);
    expect(call(0)).toMatchObject({ url: '/api/v1/auth/login', method: 'POST' });
    expect(call(0).headers.Authorization).toBeUndefined();
    expect(call(1)).toMatchObject({
      url: '/api/v1/spaces?building=Edificio+A&minCapacity=20',
      headers: { Authorization: 'Bearer access-1' },
    });
  });

  it('logout revoca el refresh token en la API y borra la sesión', async () => {
    setSession('access-1', 'refresh-1');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await api.logout();

    expect(call(0)).toMatchObject({ url: '/api/v1/auth/logout', method: 'POST', body: { refreshToken: 'refresh-1' } });
    expect(api.hasSession()).toBe(false);
  });

  it('logout borra la sesión local aunque la API no responda', async () => {
    setSession('access-1', 'refresh-1');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(api.logout()).rejects.toBeInstanceOf(api.NetworkError);
    expect(api.hasSession()).toBe(false);
  });
});

describe('renovación del access token', () => {
  it('ante un 401 renueva con el refresh token, guarda el nuevo y repite la solicitud', async () => {
    setSession('access-1', 'refresh-1');
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'access-2' }))
      .mockResolvedValueOnce(jsonResponse(200, [space]));

    await expect(api.listSpaces({})).resolves.toEqual([space]);

    expect(call(1)).toMatchObject({ url: '/api/v1/auth/refresh', body: { refreshToken: 'refresh-1' } });
    expect(call(2).headers.Authorization).toBe('Bearer access-2');
    expect(session()).toEqual({ accessToken: 'access-2', refreshToken: 'refresh-1' });
    expect(expired).not.toHaveBeenCalled();
  });

  it('dos solicitudes con 401 a la vez comparten una sola renovación', async () => {
    setSession('access-1', 'refresh-1');
    fetchMock.mockImplementation(async (url, init) => {
      const auth = (init?.headers as Record<string, string>).Authorization;
      if (url === '/api/v1/auth/refresh') return jsonResponse(200, { accessToken: 'access-2' });
      return auth === 'Bearer access-2' ? jsonResponse(200, [space]) : unauthorized();
    });

    await Promise.all([api.listSpaces({}), api.listSpaces({})]);

    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/v1/auth/refresh')).toHaveLength(1);
  });

  it('si el refresh token tampoco sirve, borra la sesión, avisa y lanza SESSION_EXPIRED', async () => {
    setSession('access-1', 'refresh-1');
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'No válido' } }));

    await expect(api.listMyReservations()).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
    expect(api.hasSession()).toBe(false);
    expect(expired).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sin sesión no llama a la API', async () => {
    await expect(api.listMyReservations()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('errores', () => {
  it('un 409 de la API llega como ApiError con su código', async () => {
    setSession('access-1', 'refresh-1');
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: { code: 'RESERVATION_OVERLAP', message: 'El espacio ya está reservado en ese horario' } }),
    );

    const error = await api
      .createReservation({ spaceId: space.id, startsAt: '2026-11-10T09:00:00-06:00', endsAt: '2026-11-10T11:00:00-06:00' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(api.ApiError);
    expect(error).toMatchObject({ status: 409, code: 'RESERVATION_OVERLAP' });
  });

  it('sin red lanza NetworkError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(api.register({ email: 'a@b.co', name: 'Ana', password: '12345678' })).rejects.toBeInstanceOf(api.NetworkError);
  });
});

describe('pantalla informativa', () => {
  it('GET /now usa la API key en X-API-Key y no el JWT', async () => {
    setSession('access-1', 'refresh-1');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { now: '2026-11-10T10:15:00-06:00', timezone: 'America/Guatemala', spaces: [] }));

    await api.getNow('rl_live_demo');

    expect(call(0)).toMatchObject({ url: '/api/v1/now', headers: { 'X-API-Key': 'rl_live_demo' } });
    expect(call(0).headers.Authorization).toBeUndefined();
  });
});
