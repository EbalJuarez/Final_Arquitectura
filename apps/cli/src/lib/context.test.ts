import { CreateSpaceSchema } from '@reservalab/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiClient, DEFAULT_API_URL } from './api-client';
import { createContext, parseInput } from './context';
import { CliError } from './errors';

afterEach(() => {
  delete process.env.RESERVALAB_API_URL;
});

describe('createContext', () => {
  it('usa la URL por defecto si RESERVALAB_API_URL no está definida', () => {
    delete process.env.RESERVALAB_API_URL;

    const context = createContext(false);

    expect(context.apiUrl).toBe(DEFAULT_API_URL);
    expect(context.client).toBeInstanceOf(ApiClient);
    expect(context.json).toBe(false);
  });

  it('toma RESERVALAB_API_URL sin las barras finales y conserva el modo JSON', () => {
    process.env.RESERVALAB_API_URL = 'https://api.reservalab.test//';

    const context = createContext(true);

    expect(context.apiUrl).toBe('https://api.reservalab.test');
    expect(context.json).toBe(true);
  });

  it('una RESERVALAB_API_URL vacía cae en la URL por defecto', () => {
    process.env.RESERVALAB_API_URL = '';

    expect(createContext(false).apiUrl).toBe(DEFAULT_API_URL);
  });
});

describe('parseInput', () => {
  it('devuelve los datos ya transformados por el esquema', () => {
    expect(parseInput(CreateSpaceSchema, { name: '  Lab 1 ', building: ' A ', capacity: 20 })).toEqual({
      name: 'Lab 1',
      building: 'A',
      capacity: 20,
    });
  });

  it('lanza VALIDATION_ERROR con un detalle por campo inválido', () => {
    let error: unknown;
    try {
      parseInput(CreateSpaceSchema, { name: 'L', building: '', capacity: -1 });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Los datos ingresados no son válidos' });
    expect((error as CliError).details?.map((detail) => detail.field).sort()).toEqual(['building', 'capacity', 'name']);
  });
});
