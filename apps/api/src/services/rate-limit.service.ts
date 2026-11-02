import { env } from '../config/env';
import { withTimeout } from '../lib/with-timeout';
import * as rateLimitRepository from '../repositories/rate-limit.repository';

const WINDOW_MS = 60_000;

// Si Redis tarda más que esto se considera caído y la solicitud pasa sin límite.
const REDIS_TIMEOUT_MS = 500;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  // Segundos hasta que empiece la siguiente ventana
  retryAfterSeconds: number;
}

// Ventana fija de 1 minuto por key: el contador se llama con el inicio del minuto y vence solo.
// Devuelve null si Redis no responde; en ese caso la solicitud pasa y se registra una advertencia.
export async function consumeApiKeyRequest(
  apiKeyId: string,
  now = new Date(),
  limit = env.API_KEY_RATE_LIMIT_PER_MINUTE,
): Promise<RateLimitResult | null> {
  const windowStart = Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS;
  const counterKey = `rate-limit:api-key:${apiKeyId}:${windowStart}`;

  let count: number;
  try {
    count = await withTimeout(rateLimitRepository.incrementCounter(counterKey, WINDOW_MS / 1000), REDIS_TIMEOUT_MS);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[rate-limit] Sin límite para la API key ${apiKeyId} porque Redis falló: ${reason}`);
    return null;
  }

  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart + WINDOW_MS - now.getTime()) / 1000)),
  };
}
