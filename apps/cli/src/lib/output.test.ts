import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, CliError } from './errors';
import { printError, printJson, printTable } from './output';

let stdout: string;
let stderr: string;

beforeEach(() => {
  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => ((stdout += String(chunk)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => ((stderr += String(chunk)), true));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('printError', () => {
  it('muestra código, estado HTTP, mensaje y detalles en stderr, y devuelve 1', () => {
    const error = new ApiError(400, 'VALIDATION_ERROR', 'Los datos enviados no son válidos', [
      { field: 'capacity', message: 'Too small' },
    ]);

    expect(printError(error, false)).toBe(1);
    expect(stderr).toBe('Error VALIDATION_ERROR (HTTP 400): Los datos enviados no son válidos\n  - capacity: Too small\n');
    expect(stdout).toBe('');
  });

  it('con --json escribe el error como JSON en stderr', () => {
    printError(new ApiError(409, 'API_KEY_ALREADY_REVOKED', 'La API key ya estaba revocada'), true);

    expect(JSON.parse(stderr)).toEqual({
      error: { code: 'API_KEY_ALREADY_REVOKED', message: 'La API key ya estaba revocada', status: 409 },
    });
  });

  it('los errores del CLI no llevan estado HTTP, y los inesperados usan UNEXPECTED_ERROR', () => {
    printError(new CliError('NETWORK_ERROR', 'No se pudo conectar'), false);
    printError(new Error('algo raro'), false);

    expect(stderr).toBe('Error NETWORK_ERROR: No se pudo conectar\nError UNEXPECTED_ERROR: algo raro\n');
  });
});

describe('salida de datos', () => {
  it('printTable alinea las columnas y muestra - para null', () => {
    printTable(
      [
        { ID: 'a1', Nombre: 'Laboratorio', 'Último uso': null },
        { ID: 'b22', Nombre: 'Salón', 'Último uso': '2026-11-10' },
      ],
      'vacío',
    );

    expect(stdout).toBe(
      'ID   Nombre       Último uso\n' +
        '---  -----------  ----------\n' +
        'a1   Laboratorio  -\n' +
        'b22  Salón        2026-11-10\n',
    );
  });

  it('printTable sin filas muestra el mensaje', () => {
    printTable([], 'No hay espacios.');

    expect(stdout).toBe('No hay espacios.\n');
  });

  it('printJson escribe JSON válido en stdout', () => {
    printJson([{ id: 1 }]);

    expect(JSON.parse(stdout)).toEqual([{ id: 1 }]);
  });
});
