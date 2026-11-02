import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashApiKey } from '../lib/api-keys';
import * as apiKeyRepository from '../repositories/api-key.repository';
import type { ApiKeyRecord } from '../repositories/api-key.repository';
import { authenticateApiKey } from './authenticate-api-key';

// Middleware y servicio reales; solo se mockea el repositorio. Recorre cada caso hasta el código HTTP.
vi.mock('../repositories/api-key.repository', () => ({
  findApiKeyByHash: vi.fn(),
  updateLastUsedAt: vi.fn(),
}));

const apiKeys = vi.mocked(apiKeyRepository);

const RAW_KEY = 'rl_live_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';

function storedKey(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Pantalla del lobby',
    prefix: 'rl_live_AbCdEfGh',
    keyHash: hashApiKey(RAW_KEY),
    permissions: ['read:now'],
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-11-01T12:00:00Z'),
    ...overrides,
  };
}

async function run(headers: Record<string, string>) {
  const req = { headers } as Request;
  const next = vi.fn();
  const error = await authenticateApiKey('read:now')(req, {} as Response, next).then(
    () => undefined,
    (e: unknown) => e,
  );
  return { req, next, error };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiKeys.updateLastUsedAt.mockResolvedValue();
  // El repositorio solo encuentra la key cuyo hash coincide con el guardado
  apiKeys.findApiKeyByHash.mockImplementation(async (hash) => (hash === hashApiKey(RAW_KEY) ? storedKey() : null));
});

describe('authenticateApiKey con el servicio real', () => {
  it('sin cabecera: 401', async () => {
    const { error, next } = await run({});

    expect(error).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    expect(next).not.toHaveBeenCalled();
  });

  it('key inválida: 401', async () => {
    const { error, next } = await run({ 'x-api-key': 'rl_live_noExisteNoExisteNoExisteNoExisteNoExiste1' });

    expect(error).toMatchObject({ statusCode: 401, code: 'INVALID_API_KEY' });
    expect(next).not.toHaveBeenCalled();
  });

  it('key revocada: 401', async () => {
    apiKeys.findApiKeyByHash.mockResolvedValue(storedKey({ revokedAt: new Date('2026-11-02T12:00:00Z') }));

    const { error, next } = await run({ 'x-api-key': RAW_KEY });

    expect(error).toMatchObject({ statusCode: 401, code: 'INVALID_API_KEY' });
    expect(next).not.toHaveBeenCalled();
  });

  it('key sin el permiso: 403', async () => {
    apiKeys.findApiKeyByHash.mockResolvedValue(storedKey({ permissions: ['read:spaces'] }));

    const { error, next } = await run({ 'x-api-key': RAW_KEY });

    expect(error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(next).not.toHaveBeenCalled();
  });

  it('key con el permiso: pasa, deja req.apiKey y marca lastUsedAt', async () => {
    const { error, next, req } = await run({ 'x-api-key': RAW_KEY });

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
    expect(req.apiKey).toEqual({
      id: '55555555-5555-4555-8555-555555555555',
      prefix: 'rl_live_AbCdEfGh',
      permissions: ['read:now'],
    });
    expect(apiKeys.updateLastUsedAt).toHaveBeenCalledOnce();
  });
});
