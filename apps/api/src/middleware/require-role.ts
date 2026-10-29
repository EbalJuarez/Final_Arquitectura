import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@reservalab/shared';
import { AppError } from '../errors/app-error';

// Se usa después de authenticate: requireRole('ADMIN') o requireRole('DOCENTE', 'ADMIN').
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Se requiere autenticación');
    }
    if (!roles.includes(req.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para realizar esta acción');
    }
    next();
  };
}
