import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error';
import { hashApiKey } from '../lib/api-keys';
import * as apiKeyRepository from '../repositories/api-key.repository';
import type { ApiKeyRecord } from '../repositories/api-key.repository';
import * as apiKeyService from './api-key.service';

// Repositorio mockeado: estas pruebas no tocan la base de datos.
vi.mock('../repositories/api-key.repository', () => ({
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  findApiKeyById: vi.fn(),
  findApiKeyByHash: vi.fn(),
  revokeApiKey: vi.fn(),
  updateLastUsedAt: vi.fn(),
}));

const apiKeys = vi.mocked(apiKeyRepository);

const KEY_ID = '55555555-5555-4555-8555-555555555555';
const RAW_KEY = 'rl_live_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';
const NOW = new Date('2026-11-02T18:00:00Z');

function makeKey(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: KEY_ID,
    name: 'Pantalla del lobby',
    prefix: 'rl_live_AbCdEfGh',
    keyHash: hashApiKey(RAW_KEY),
    permissions: ['read:spaces'],
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-11-01T12:00:00.000Z'),
    ...overrides,
  };
}

async function expectAppError(promise: Promise<unknown>, statusCode: number, code: string) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ statusCode, code });
}

beforeEach(() => {
  vi.clearAllMocks();
  apiKeys.updateLastUsedAt.mockResolvedValue();
});

describe('createApiKey', () => {
  it('guarda solo el hash y el prefijo, y devuelve la key completa una vez', async () => {
    apiKeys.createApiKey.mockImplementation(async (data) => makeKey({ ...data }));

    const created = await apiKeyService.createApiKey({ name: 'Pantalla del lobby', permissions: ['read:spaces'] });

    expect(created.key).toMatch(/^rl_live_[A-Za-z0-9_-]{43}$/);
    const data = apiKeys.createApiKey.mock.calls[0]![0];
    expect(data).toEqual({
      name: 'Pantalla del lobby',
      prefix: created.key.slice(0, 16),
      keyHash: hashApiKey(created.key),
      permissions: ['read:spaces'],
    });
    expect(data).not.toHaveProperty('key');
    // Lo guardado no es la key ni la contiene: es un SHA-256 en hexadecimal
    expect(data.keyHash).not.toBe(created.key);
    expect(data.keyHash).not.toContain(created.key.slice('rl_live_'.length));
    expect(data.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created).toMatchObject({ prefix: created.key.slice(0, 16), revokedAt: null });
    expect(created).not.toHaveProperty('keyHash');
  });
});

describe('listApiKeys', () => {
  it('nunca devuelve la key ni su hash', async () => {
    apiKeys.listApiKeys.mockResolvedValue([makeKey({ lastUsedAt: NOW })]);

    const [key] = await apiKeyService.listApiKeys();

    expect(key).toEqual({
      id: KEY_ID,
      name: 'Pantalla del lobby',
      prefix: 'rl_live_AbCdEfGh',
      permissions: ['read:spaces'],
      lastUsedAt: NOW.toISOString(),
      revokedAt: null,
      createdAt: '2026-11-01T12:00:00.000Z',
    });
  });

  it('ignora permisos guardados que ya no existen en el catálogo', async () => {
    apiKeys.listApiKeys.mockResolvedValue([makeKey({ permissions: ['read:spaces', 'write:legacy'] })]);

    const [key] = await apiKeyService.listApiKeys();

    expect(key?.permissions).toEqual(['read:spaces']);
  });
});

describe('revokeApiKey', () => {
  it('marca revokedAt y devuelve la key revocada', async () => {
    apiKeys.findApiKeyById.mockResolvedValue(makeKey());
    apiKeys.revokeApiKey.mockResolvedValue(makeKey({ revokedAt: NOW }));

    const revoked = await apiKeyService.revokeApiKey(KEY_ID, NOW);

    expect(apiKeys.revokeApiKey).toHaveBeenCalledWith(KEY_ID, NOW);
    expect(revoked.revokedAt).toBe(NOW.toISOString());
  });

  it('responde 404 si la key no existe', async () => {
    apiKeys.findApiKeyById.mockResolvedValue(null);

    await expectAppError(apiKeyService.revokeApiKey(KEY_ID, NOW), 404, 'API_KEY_NOT_FOUND');
    expect(apiKeys.revokeApiKey).not.toHaveBeenCalled();
  });

  it('responde 409 si ya estaba revocada, sin volver a escribir', async () => {
    apiKeys.findApiKeyById.mockResolvedValue(makeKey({ revokedAt: NOW }));

    await expectAppError(apiKeyService.revokeApiKey(KEY_ID, NOW), 409, 'API_KEY_ALREADY_REVOKED');
    expect(apiKeys.revokeApiKey).not.toHaveBeenCalled();
  });

  it('responde 409 si otra solicitud la revocó entre la consulta y la actualización', async () => {
    apiKeys.findApiKeyById.mockResolvedValue(makeKey());
    apiKeys.revokeApiKey.mockResolvedValue(null);

    await expectAppError(apiKeyService.revokeApiKey(KEY_ID, NOW), 409, 'API_KEY_ALREADY_REVOKED');
  });
});

describe('authenticateApiKey', () => {
  it('busca la key por su hash y devuelve id, prefijo y permisos', async () => {
    apiKeys.findApiKeyByHash.mockResolvedValue(makeKey());

    const principal = await apiKeyService.authenticateApiKey(RAW_KEY, 'read:spaces', NOW);

    expect(apiKeys.findApiKeyByHash).toHaveBeenCalledWith(hashApiKey(RAW_KEY));
    expect(principal).toEqual({ id: KEY_ID, prefix: 'rl_live_AbCdEfGh', permissions: ['read:spaces'] });
  });

  it('actualiza lastUsedAt sin esperar a que termine', async () => {
    apiKeys.findApiKeyByHash.mockResolvedValue(makeKey());
    apiKeys.updateLastUsedAt.mockReturnValue(new Promise(() => {}));

    await apiKeyService.authenticateApiKey(RAW_KEY, 'read:spaces', NOW);

    expect(apiKeys.updateLastUsedAt).toHaveBeenCalledWith(KEY_ID, NOW);
  });

  it('si falla lastUsedAt solo lo registra y la autenticación sigue', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    apiKeys.findApiKeyByHash.mockResolvedValue(makeKey());
    apiKeys.updateLastUsedAt.mockRejectedValue(new Error('conexión perdida'));

    await expect(apiKeyService.authenticateApiKey(RAW_KEY, 'read:spaces', NOW)).resolves.toMatchObject({ id: KEY_ID });
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('rl_live_AbCdEfGh: conexión perdida')),
    );
    consoleError.mockRestore();
  });

  it('responde 401 si la key no existe', async () => {
    apiKeys.findApiKeyByHash.mockResolvedValue(null);

    await expectAppError(apiKeyService.authenticateApiKey(RAW_KEY, 'read:spaces', NOW), 401, 'INVALID_API_KEY');
  });

  it('responde 401 sin consultar la base si no tiene el prefijo rl_live_', async () => {
    await expectAppError(apiKeyService.authenticateApiKey('otra-cosa', 'read:spaces', NOW), 401, 'INVALID_API_KEY');
    expect(apiKeys.findApiKeyByHash).not.toHaveBeenCalled();
  });

  it('responde 401 si la key está revocada', async () => {
    apiKeys.findApiKeyByHash.mockResolvedValue(makeKey({ revokedAt: NOW }));

    await expectAppError(apiKeyService.authenticateApiKey(RAW_KEY, 'read:spaces', NOW), 401, 'INVALID_API_KEY');
    expect(apiKeys.updateLastUsedAt).not.toHaveBeenCalled();
  });

  it('responde 403 si la key no tiene el permiso exigido', async () => {
    apiKeys.findApiKeyByHash.mockResolvedValue(makeKey({ permissions: ['read:now'] }));

    await expectAppError(apiKeyService.authenticateApiKey(RAW_KEY, 'read:spaces', NOW), 403, 'FORBIDDEN');
    expect(apiKeys.updateLastUsedAt).not.toHaveBeenCalled();
  });
});
