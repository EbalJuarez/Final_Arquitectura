import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app-error';
import * as rateLimitService from '../services/rate-limit.service';

// Se usa después de authenticateJwtOrApiKey: limita las solicitudes por minuto de cada API key.
// Las solicitudes con JWT no tienen req.apiKey y pasan sin contar.
export async function rateLimitApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.apiKey) {
    next();
    return;
  }

  const result = await rateLimitService.consumeApiKeyRequest(req.apiKey.id);
  if (result) {
    res.set('X-RateLimit-Limit', String(result.limit));
    res.set('X-RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      res.set('Retry-After', String(result.retryAfterSeconds));
      throw new AppError(
        429,
        'RATE_LIMIT_EXCEEDED',
        `Se superó el límite de ${result.limit} solicitudes por minuto de esta API key`,
      );
    }
  }
  next();
}
