import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as rateLimitService from '../services/rate-limit.service';
import { rateLimitApiKey } from './rate-limit';

vi.mock('../services/rate-limit.service', () => ({
  consumeApiKeyRequest: vi.fn(),
}));

const service = vi.mocked(rateLimitService);

const API_KEY = { id: '55555555-5555-4555-8555-555555555555', prefix: 'rl_live_AbCdEfGh', permissions: [] };

async function run(apiKey?: typeof API_KEY) {
  const req = (apiKey ? { apiKey } : {}) as Request;
  const headers: Record<string, string> = {};
  const res = { set: (name: string, value: string) => (headers[name] = value) } as unknown as Response;
  const next = vi.fn();
  const error = await rateLimitApiKey(req, res, next).then(
    () => undefined,
    (e: unknown) => e,
  );
  return { headers, next, error };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rateLimitApiKey', () => {
  it('no cuenta las solicitudes con JWT (sin req.apiKey)', async () => {
    const { headers, next } = await run();

    expect(service.consumeApiKeyRequest).not.toHaveBeenCalled();
    expect(headers).toEqual({});
    expect(next).toHaveBeenCalledOnce();
  });

  it('dentro del límite pone las cabeceras y deja pasar', async () => {
    service.consumeApiKeyRequest.mockResolvedValue({ allowed: true, limit: 60, remaining: 59, retryAfterSeconds: 45 });

    const { headers, next, error } = await run(API_KEY);

    expect(service.consumeApiKeyRequest).toHaveBeenCalledWith(API_KEY.id);
    expect(error).toBeUndefined();
    expect(headers).toEqual({ 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '59' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('al superar el límite responde 429 con Retry-After', async () => {
    service.consumeApiKeyRequest.mockResolvedValue({ allowed: false, limit: 60, remaining: 0, retryAfterSeconds: 45 });

    const { headers, next, error } = await run(API_KEY);

    expect(error).toMatchObject({ statusCode: 429, code: 'RATE_LIMIT_EXCEEDED' });
    expect(headers).toEqual({ 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '0', 'Retry-After': '45' });
    expect(next).not.toHaveBeenCalled();
  });

  it('si Redis no respondió (null) deja pasar sin cabeceras', async () => {
    service.consumeApiKeyRequest.mockResolvedValue(null);

    const { headers, next, error } = await run(API_KEY);

    expect(error).toBeUndefined();
    expect(headers).toEqual({});
    expect(next).toHaveBeenCalledOnce();
  });
});
