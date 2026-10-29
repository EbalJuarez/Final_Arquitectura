import type { NextFunction, Request, Response } from 'express';
import type { ErrorResponse } from '@reservalab/shared';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error';

function sendError(res: Response, statusCode: number, error: ErrorResponse['error']): void {
  res.status(statusCode).json({ error } satisfies ErrorResponse);
}

export function notFoundHandler(_req: Request, res: Response): void {
  sendError(res, 404, { code: 'NOT_FOUND', message: 'Recurso no encontrado' });
}

// Express 5 envía aquí los errores de los handlers async sin necesidad de try/catch.
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof AppError) {
    sendError(res, error.statusCode, { code: error.code, message: error.message });
    return;
  }

  if (error instanceof ZodError) {
    sendError(res, 400, {
      code: 'VALIDATION_ERROR',
      message: 'Los datos enviados no son válidos',
      details: error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  // express.json() lanza este error cuando el cuerpo no es JSON válido
  if (error instanceof SyntaxError && 'body' in error) {
    sendError(res, 400, { code: 'INVALID_JSON', message: 'El cuerpo de la solicitud no es JSON válido' });
    return;
  }

  console.error(error);
  sendError(res, 500, { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' });
}
