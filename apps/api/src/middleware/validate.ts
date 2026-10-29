import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';

// Valida req.body con un esquema de @reservalab/shared y lo reemplaza por los datos ya limpios.
// Si falla, el ZodError llega al middleware global de errores (400 con detalle de campos).
export function validate(schema: z.ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.body = schema.parse(req.body ?? {});
    next();
  };
}
