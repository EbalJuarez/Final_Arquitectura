import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error';
import { signAccessToken } from '../lib/tokens';
import * as apiKeyService from '../services/api-key.service';
import { authenticateApiKey, authenticateJwtOrApiKey } from './authenticate-api-key';

// Servicio mockeado: estas pruebas no tocan la base de datos.
vi.mock('../services/api-key.service', () => ({
  authenticateApiKey: vi.fn(),
}));

const service = vi.mocked(apiKeyService);

const PRINCIPAL = {
  id: '55555555-5555-4555-8555-555555555555',
  prefix: 'rl_live_AbCdEfGh',
  permissions: ['read:spaces' as const],
};
const USER = { id: '11111111-1111-4111-8111-111111111111', role: 'ESTUDIANTE' as const };

type Middleware = (req: Request, res: Response, next: () => void) => Promise<void>;

async function run(middleware: Middleware, headers: Record<string, string>) {
  const req = { headers } as Request;
  const next = vi.fn();
  const error = await middleware(req, {} as Response, next).then(
    () => undefined,
    (e: unknown) => e,
  );
  return { req, next, error };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('authenticateApiKey', () => {
  it('con una key válida deja req.apiKey y llama a next()', async () => {
    service.authenticateApiKey.mockResolvedValue(PRINCIPAL);

    const { req, next, error } = await run(authenticateApiKey('read:spaces'), { 'x-api-key': 'rl_live_x' });

    expect(error).toBeUndefined();
    expect(service.authenticateApiKey).toHaveBeenCalledWith('rl_live_x', 'read:spaces');
    expect(req.apiKey).toEqual(PRINCIPAL);
    expect(next).toHaveBeenCalledOnce();
  });

  it.each<Record<string, string>>([{}, { 'x-api-key': '' }])('responde 401 sin cabecera X-API-Key (%j)', async (headers) => {
    const { next, error } = await run(authenticateApiKey('read:spaces'), headers);

    expect(error).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Falta la API key' });
    expect(service.authenticateApiKey).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('propaga el error del servicio (401 o 403) sin llamar a next()', async () => {
    service.authenticateApiKey.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'Sin permiso'));

    const { req, next, error } = await run(authenticateApiKey('read:spaces'), { 'x-api-key': 'rl_live_x' });

    expect(error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(req.apiKey).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('authenticateJwtOrApiKey', () => {
  it('con X-API-Key usa la key y exige el permiso', async () => {
    service.authenticateApiKey.mockResolvedValue(PRINCIPAL);

    const { req, next } = await run(authenticateJwtOrApiKey('read:spaces'), { 'x-api-key': 'rl_live_x' });

    expect(service.authenticateApiKey).toHaveBeenCalledWith('rl_live_x', 'read:spaces');
    expect(req.apiKey).toEqual(PRINCIPAL);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('sin X-API-Key acepta un JWT válido', async () => {
    const { req, next, error } = await run(authenticateJwtOrApiKey('read:spaces'), {
      authorization: `Bearer ${signAccessToken(USER)}`,
    });

    expect(error).toBeUndefined();
    expect(req.user).toEqual(USER);
    expect(req.apiKey).toBeUndefined();
    expect(service.authenticateApiKey).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('sin ninguna de las dos responde 401', async () => {
    const { next, error } = await run(authenticateJwtOrApiKey('read:spaces'), {});

    expect(error).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    expect(next).not.toHaveBeenCalled();
  });

  it('con una key inválida responde 401 aunque también venga un JWT válido', async () => {
    service.authenticateApiKey.mockRejectedValue(new AppError(401, 'INVALID_API_KEY', 'API key inválida o revocada'));

    const { req, next, error } = await run(authenticateJwtOrApiKey('read:spaces'), {
      'x-api-key': 'rl_live_inventada',
      authorization: `Bearer ${signAccessToken(USER)}`,
    });

    expect(error).toMatchObject({ statusCode: 401, code: 'INVALID_API_KEY' });
    expect(req.user).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });
});
