import type { NextFunction, Request, Response } from 'express';
import { CreateSpaceSchema, ErrorResponseSchema } from '@reservalab/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '../errors/app-error';
import { errorHandler, notFoundHandler } from './errors';

// Respuesta simulada que guarda el código y el cuerpo enviados.
function mockResponse() {
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status: vi.fn((code: number) => {
      sent.status = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      sent.body = body;
      return res;
    }),
  };
  return { res: res as unknown as Response, sent };
}

function handle(error: unknown) {
  const { res, sent } = mockResponse();
  const next = vi.fn() as NextFunction;
  errorHandler(error, {} as Request, res, next);
  // El cuerpo siempre cumple el contrato compartido con la web y la CLI
  expect(ErrorResponseSchema.safeParse(sent.body).success).toBe(true);
  expect(next).not.toHaveBeenCalled();
  return sent;
}

describe('errorHandler', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('traduce un AppError a su código HTTP, código y mensaje', () => {
    const sent = handle(new AppError(409, 'RESERVATION_OVERLAP', 'El espacio ya está reservado en ese horario'));

    expect(sent).toEqual({
      status: 409,
      body: { error: { code: 'RESERVATION_OVERLAP', message: 'El espacio ya está reservado en ese horario' } },
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('traduce un 404 de recurso no encontrado lanzado por un servicio', () => {
    const sent = handle(new AppError(404, 'SPACE_NOT_FOUND', 'Espacio no encontrado'));

    expect(sent.status).toBe(404);
    expect(sent.body).toEqual({ error: { code: 'SPACE_NOT_FOUND', message: 'Espacio no encontrado' } });
  });

  it('responde 400 VALIDATION_ERROR con un detalle por campo inválido', () => {
    const result = CreateSpaceSchema.safeParse({ name: 'L', building: '', capacity: -3 });
    expect(result.success).toBe(false);

    const sent = handle(result.error);

    expect(sent.status).toBe(400);
    const { error } = ErrorResponseSchema.parse(sent.body);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('Los datos enviados no son válidos');
    expect(error.details?.map((detail) => detail.field).sort()).toEqual(['building', 'capacity', 'name']);
    expect(error.details?.every((detail) => detail.message.length > 0)).toBe(true);
  });

  it('une con puntos la ruta de los campos anidados', () => {
    const schema = z.object({ window: z.object({ startsAt: z.iso.datetime() }) });
    const result = schema.safeParse({ window: { startsAt: 'ayer' } });

    const sent = handle(result.error);

    expect(ErrorResponseSchema.parse(sent.body).error.details).toEqual([
      { field: 'window.startsAt', message: expect.any(String) },
    ]);
  });

  it('responde 400 INVALID_JSON cuando express.json() no puede leer el cuerpo', () => {
    // Forma del error que lanza body-parser: un SyntaxError con el cuerpo crudo en "body"
    const parseError = Object.assign(new SyntaxError('Unexpected token } in JSON at position 9'), {
      body: '{"name": }',
      status: 400,
      type: 'entity.parse.failed',
    });

    const sent = handle(parseError);

    expect(sent).toEqual({
      status: 400,
      body: { error: { code: 'INVALID_JSON', message: 'El cuerpo de la solicitud no es JSON válido' } },
    });
  });

  it('trata como error interno un SyntaxError que no viene del cuerpo de la solicitud', () => {
    const sent = handle(new SyntaxError('Unexpected end of JSON input'));

    expect(sent.status).toBe(500);
  });

  it('responde 500 genérico sin filtrar el mensaje ni el stack de un error no controlado', () => {
    const internal = new Error('connect ECONNREFUSED postgres:5432 usuario=reservalab');

    const sent = handle(internal);

    expect(sent).toEqual({
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' } },
    });
    const serialized = JSON.stringify(sent.body);
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(serialized).not.toContain('stack');
    expect(serialized).not.toContain(internal.stack!.split('\n')[1]!.trim());
    // El detalle sí queda en el log del servidor
    expect(consoleError).toHaveBeenCalledWith(internal);
  });

  it('responde 500 aunque lo lanzado no sea un Error', () => {
    const sent = handle('algo salió mal');

    expect(sent.status).toBe(500);
    expect(sent.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' } });
  });
});

describe('notFoundHandler', () => {
  it('responde 404 NOT_FOUND con el formato de error común', () => {
    const { res, sent } = mockResponse();

    notFoundHandler({} as Request, res);

    expect(sent).toEqual({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Recurso no encontrado' } } });
    expect(ErrorResponseSchema.safeParse(sent.body).success).toBe(true);
  });
});
