import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app-error';
import { verifyAccessToken } from '../lib/tokens';
import type { AuthUser } from '../types/express';

// Exige "Authorization: Bearer <token>" con un access token válido y deja el usuario en req.user.
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
  if (scheme !== 'Bearer' || !token) {
    throw new AppError(401, 'UNAUTHORIZED', 'Falta el token de acceso');
  }

  try {
    req.user = verifyAccessToken(token);
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Token de acceso inválido o expirado');
  }
  next();
}

// Para controladores de rutas protegidas: devuelve req.user o responde 401 si no hay sesión.
export function getAuthUser(req: Request): AuthUser {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Se requiere autenticación');
  }
  return req.user;
}
