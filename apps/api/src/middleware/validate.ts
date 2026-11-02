import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';

type RequestPart = 'body' | 'query' | 'params';

// Valida una parte de la solicitud con un esquema de @reservalab/shared y la reemplaza por los datos ya limpios.
// Si falla, el ZodError llega al middleware global de errores (400 con detalle de campos).
export function validate(schema: z.ZodType, part: RequestPart = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.parse(req[part] ?? {});
    if (part === 'query') {
      // En Express 5 req.query es un getter de solo lectura; se redefine en esta solicitud.
      Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true, enumerable: true });
    } else {
      req[part] = parsed;
    }
    next();
  };
}
