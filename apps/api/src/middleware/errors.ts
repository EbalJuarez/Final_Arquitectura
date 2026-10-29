import type { NextFunction, Request, Response } from 'express';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
}

// Express 5 envía aquí los errores de los handlers async sin necesidad de try/catch.
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  console.error(error);
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Error interno del servidor' });
}
