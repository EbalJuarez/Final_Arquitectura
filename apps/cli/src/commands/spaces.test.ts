import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../lib/api-client';
import type { Context } from '../lib/context';
import { ApiError, CliError } from '../lib/errors';
import { registerSpaces } from './spaces';

// Comandos `spaces` contra una API simulada: fetch mockeado y sesión en memoria.

const API_URL = 'http://api.prueba';
const SPACE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const space = {
  id: SPACE_ID,
  name: 'Laboratorio de Redes',
  building: 'Edificio A',
  capacity: 30,
  createdAt: '2026-11-01T15:30:00.000Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let stdout: string;
let stderr: string;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function run(args: string[], json = false): Promise<void> {
  const store = {
    load: async () => ({ accessToken: 'access-1', refreshToken: 'refresh-1' }),
    saveAccessToken: async () => {},
  };
  const context = (): Context => ({ apiUrl: API_URL, client: new ApiClient(API_URL, store, fetchMock), json });
  const program = new Command().exitOverride();
  registerSpaces(program, context);
  await program.parseAsync(['spaces', ...args], { from: 'user' });
}

function call(n: number) {
  const [url, init] = fetchMock.mock.calls[n]!;
  return { url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
}

describe('spaces list', () => {
  it('sin filtros pide /spaces y muestra una tabla con los espacios', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [space]));

    await run(['list']);

    expect(call(0)).toMatchObject({ url: `${API_URL}/api/v1/spaces`, method: 'GET' });
    const lines = stdout.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^ID\s+Nombre\s+Edificio\s+Capacidad$/);
    expect(lines[2]).toContain(SPACE_ID);
    expect(lines[2]).toContain('Laboratorio de Redes');
    expect(lines[2]).toContain('Edificio A');
    expect(lines[2]).toMatch(/30$/);
  });

  it('envía los filtros de edificio y capacidad mínima en la query', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await run(['list', '--building', ' Edificio A ', '--min-capacity', '20']);

    const url = new URL(String(call(0).url));
    expect(url.pathname).toBe('/api/v1/spaces');
    expect(url.searchParams.get('building')).toBe('Edificio A');
    expect(url.searchParams.get('minCapacity')).toBe('20');
  });

  it('avisa cuando no hay espacios que cumplan los filtros', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await run(['list', '--building', 'Z']);

    expect(stdout).toBe('No hay espacios que cumplan los filtros.\n');
  });

  it('con --json imprime la lista tal como la devuelve la API', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [space]));

    await run(['list'], true);

    expect(JSON.parse(stdout)).toEqual([space]);
  });

  it('rechaza una capacidad mínima inválida sin llamar a la API', async () => {
    const error = await run(['list', '--min-capacity', 'muchos']).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((error as CliError).details?.[0]?.field).toBe('minCapacity');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propaga el error 403 de la API', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'Requiere rol ADMIN' } }));

    await expect(run(['list'])).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'Requiere rol ADMIN' });
  });
});

describe('spaces create', () => {
  it('envía nombre, edificio y capacidad numérica y muestra el espacio creado', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, space));

    await run(['create', '--name', 'Laboratorio de Redes', '--building', 'Edificio A', '--capacity', '30']);

    expect(call(0)).toMatchObject({
      url: `${API_URL}/api/v1/spaces`,
      method: 'POST',
      body: { name: 'Laboratorio de Redes', building: 'Edificio A', capacity: 30 },
    });
    expect(stderr).toContain('Espacio creado:');
    expect(stdout).toContain(SPACE_ID);
  });

  it('con --json imprime el espacio creado', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, space));

    await run(['create', '--name', 'Laboratorio de Redes', '--building', 'Edificio A', '--capacity', '30'], true);

    expect(JSON.parse(stdout)).toEqual(space);
    expect(stderr).toBe('');
  });

  it('rechaza una capacidad que no es número sin llamar a la API', async () => {
    const error = await run(['create', '--name', 'Lab', '--building', 'A', '--capacity', 'treinta']).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((error as CliError).details?.map((d) => d.field)).toEqual(['capacity']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propaga los errores de validación de la API con sus detalles', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: { code: 'CONFLICT', message: 'Ya existe un espacio con ese nombre' } }),
    );

    const error = await run(['create', '--name', 'Lab', '--building', 'A', '--capacity', '10']).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'CONFLICT' });
  });
});

describe('spaces delete', () => {
  it('llama a DELETE /spaces/:id y confirma el borrado', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await run(['delete', SPACE_ID]);

    expect(call(0)).toMatchObject({ url: `${API_URL}/api/v1/spaces/${SPACE_ID}`, method: 'DELETE' });
    expect(stderr).toBe(`Espacio ${SPACE_ID} borrado.\n`);
  });

  it('con --json imprime el id borrado', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await run(['delete', SPACE_ID], true);

    expect(JSON.parse(stdout)).toEqual({ id: SPACE_ID, deleted: true });
  });

  it('rechaza un id que no es UUID sin llamar a la API', async () => {
    await expect(run(['delete', 'abc'])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propaga el 409 cuando el espacio tiene reservas vigentes', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: { code: 'SPACE_HAS_RESERVATIONS', message: 'El espacio tiene reservas' } }),
    );

    await expect(run(['delete', SPACE_ID])).rejects.toMatchObject({ status: 409, code: 'SPACE_HAS_RESERVATIONS' });
    expect(stderr).toBe('');
  });
});
