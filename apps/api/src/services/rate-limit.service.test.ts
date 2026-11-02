import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as rateLimitRepository from '../repositories/rate-limit.repository';
import { consumeApiKeyRequest } from './rate-limit.service';

// Redis mockeado: estas pruebas no abren conexiones.
vi.mock('../repositories/rate-limit.repository', () => ({
  incrementCounter: vi.fn(),
}));

const counters = vi.mocked(rateLimitRepository);

const KEY_ID = '55555555-5555-4555-8555-555555555555';
// 18:00:15 UTC: faltan 45 s para que empiece la siguiente ventana
const NOW = new Date('2026-11-02T18:00:15Z');
const WINDOW_START = new Date('2026-11-02T18:00:00Z').getTime();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('consumeApiKeyRequest', () => {
  it('usa un contador por key y por minuto, con vencimiento de 60 s', async () => {
    counters.incrementCounter.mockResolvedValue(1);

    await consumeApiKeyRequest(KEY_ID, NOW, 60);

    expect(counters.incrementCounter).toHaveBeenCalledWith(`rate-limit:api-key:${KEY_ID}:${WINDOW_START}`, 60);
  });

  it('dentro del mismo minuto usa el mismo contador, y en el siguiente uno nuevo', async () => {
    counters.incrementCounter.mockResolvedValue(1);

    await consumeApiKeyRequest(KEY_ID, new Date('2026-11-02T18:00:59.999Z'), 60);
    await consumeApiKeyRequest(KEY_ID, new Date('2026-11-02T18:01:00Z'), 60);

    const [first, second] = counters.incrementCounter.mock.calls.map(([key]) => key);
    expect(first).toBe(`rate-limit:api-key:${KEY_ID}:${WINDOW_START}`);
    expect(second).toBe(`rate-limit:api-key:${KEY_ID}:${WINDOW_START + 60_000}`);
  });

  it.each([
    [1, true, 59],
    [59, true, 1],
    [60, true, 0],
    [61, false, 0],
    [200, false, 0],
  ])('con el contador en %i: allowed=%s y quedan %i', async (count, allowed, remaining) => {
    counters.incrementCounter.mockResolvedValue(count);

    await expect(consumeApiKeyRequest(KEY_ID, NOW, 60)).resolves.toEqual({
      allowed,
      limit: 60,
      remaining,
      retryAfterSeconds: 45,
    });
  });

  it('Retry-After nunca es 0, aunque falte menos de un segundo', async () => {
    counters.incrementCounter.mockResolvedValue(61);

    const result = await consumeApiKeyRequest(KEY_ID, new Date('2026-11-02T18:00:59.800Z'), 60);

    expect(result?.retryAfterSeconds).toBe(1);
  });

  describe('si Redis no responde, la solicitud pasa', () => {
    let consoleWarn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      consoleWarn.mockRestore();
      vi.useRealTimers();
    });

    it('devuelve null y registra una advertencia si Redis falla', async () => {
      counters.incrementCounter.mockRejectedValue(new Error('The client is closed'));

      await expect(consumeApiKeyRequest(KEY_ID, NOW, 60)).resolves.toBeNull();
      expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('The client is closed'));
    });

    it('devuelve null si Redis tarda más de 500 ms', async () => {
      vi.useFakeTimers();
      counters.incrementCounter.mockReturnValue(new Promise(() => {}));

      const result = consumeApiKeyRequest(KEY_ID, NOW, 60);
      await vi.advanceTimersByTimeAsync(500);

      await expect(result).resolves.toBeNull();
      expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('Redis no respondió en 500 ms'));
    });
  });
});
