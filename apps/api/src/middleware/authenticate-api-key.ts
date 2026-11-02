import type { NextFunction, Request, Response } from 'express';
import type { ApiKeyPermission } from '@reservalab/shared';
import { AppError } from '../errors/app-error';
import * as apiKeyService from '../services/api-key.service';
import { authenticate } from './authenticate';

const API_KEY_HEADER = 'x-api-key';

// Exige la cabecera X-API-Key con una key activa que tenga el permiso; deja la key en req.apiKey.
export function authenticateApiKey(permission: ApiKeyPermission) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const rawKey = req.headers[API_KEY_HEADER];
    if (typeof rawKey !== 'string' || rawKey === '') {
      throw new AppError(401, 'UNAUTHORIZED', 'Falta la API key');
    }

    req.apiKey = await apiKeyService.authenticateApiKey(rawKey, permission);
    next();
  };
}

// Para endpoints de lectura que aceptan ambas formas: con X-API-Key se exige una key con el permiso;
// sin ella, un JWT. Los endpoints de gestión y de reservas usan solo authenticate, así que una key
// nunca llega a ellos.
export function authenticateJwtOrApiKey(permission: ApiKeyPermission) {
  const withApiKey = authenticateApiKey(permission);
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.headers[API_KEY_HEADER] !== undefined) {
      await withApiKey(req, res, next);
      return;
    }
    authenticate(req, res, next);
  };
}
