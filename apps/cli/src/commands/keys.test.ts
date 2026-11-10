import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../lib/api-client';
import type { Context } from '../lib/context';
import { CliError } from '../lib/errors';
import { registerKeys } from './keys';

// Comandos `keys` contra una API simulada: fetch mockeado y sesión en memoria.

const API_URL = 'http://api.prueba';
const KEY_ID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const apiKey = {
  id: KEY_ID,
  name: 'Pantalla del Edificio A',
  prefix: 'rl_ab12',
  permissions: ['read:spaces', 'read:now'],
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-11-01T15:30:00.000Z',
};
const createdKey = { ...apiKey, key: 'rl_ab12_secreto_completo' };

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
  registerKeys(program, context);
  await program.parseAsync(['keys', ...args], { from: 'user' });
}

function call(n: number) {
  const [url, init] = fetchMock.mock.calls[n]!;
  return { url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
}

describe('keys create', () => {
  it('acepta permisos separados por coma o espacio, sin repetidos, y muestra la key solo en stdout', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, createdKey));

    await run(['create', '--name', 'Pantalla del Edificio A', '--permissions', 'read:spaces, read:now', 'read:spaces']);

    expect(call(0)).toMatchObject({
      url: `${API_URL}/api/v1/api-keys`,
      method: 'POST',
      body: { name: 'Pantalla del Edificio A', permissions: ['read:spaces', 'read:now'] },
    });
    expect(stdout).toBe('rl_ab12_secreto_completo\n');
    expect(stderr).toContain(`API key creada: Pantalla del Edificio A (id ${KEY_ID})`);
    expect(stderr).toContain('Permisos: read:spaces, read:now');
    expect(stderr).toContain('ÚNICA vez');
  });

  it('con --json imprime la key creada en JSON y mantiene el aviso en stderr', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, createdKey));

    await run(['create', '--name', 'Pantalla', '--permissions', 'read:now'], true);

    expect(JSON.parse(stdout)).toEqual(createdKey);
    expect(stderr).toContain('ÚNICA vez');
    expect(stderr).not.toContain('API key creada');
  });

  it('rechaza un permiso desconocido sin llamar a la API', async () => {
    const error = await run(['create', '--name', 'Pantalla', '--permissions', 'write:all']).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((error as CliError).details?.[0]?.field).toBe('permissions.0');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechaza una lista de permisos vacía', async () => {
    const error = await run(['create', '--name', 'Pantalla', '--permissions', ',']).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((error as CliError).details?.[0]?.message).toBe('Debe incluir al menos un permiso');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('keys list', () => {
  it('muestra prefijo, permisos y estado, nunca la key', async () => {
    const revoked = { ...apiKey, id: 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e', revokedAt: '2026-11-02T10:00:00.000Z' };
    fetchMock.mockResolvedValue(jsonResponse(200, [apiKey, revoked]));

    await run(['list']);

    expect(call(0)).toMatchObject({ url: `${API_URL}/api/v1/api-keys`, method: 'GET' });
    const lines = stdout.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^ID\s+Nombre\s+Prefijo\s+Permisos\s+Estado\s+Último uso\s+Creada$/);
    expect(lines[2]).toContain('read:spaces,read:now');
    expect(lines[2]).toMatch(/activa\s+-\s+2026-11-01/);
    expect(lines[3]).toContain('revocada');
    expect(stdout).not.toContain('secreto');
  });

  it('avisa cuando no hay API keys', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await run(['list']);

    expect(stdout).toBe('No hay API keys.\n');
  });

  it('con --json imprime la lista', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [apiKey]));

    await run(['list'], true);

    expect(JSON.parse(stdout)).toEqual([apiKey]);
  });

  it('falla con INVALID_RESPONSE si la API devuelve algo que no es una lista de keys', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [{ id: 'x' }]));

    await expect(run(['list'])).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('keys revoke', () => {
  it('llama a DELETE /api-keys/:id y confirma con el prefijo y el nombre', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ...apiKey, revokedAt: '2026-11-02T10:00:00.000Z' }));

    await run(['revoke', KEY_ID]);

    expect(call(0)).toMatchObject({ url: `${API_URL}/api/v1/api-keys/${KEY_ID}`, method: 'DELETE' });
    expect(stderr).toBe('API key rl_ab12… (Pantalla del Edificio A) revocada.\n');
  });

  it('con --json imprime la key revocada', async () => {
    const revoked = { ...apiKey, revokedAt: '2026-11-02T10:00:00.000Z' };
    fetchMock.mockResolvedValue(jsonResponse(200, revoked));

    await run(['revoke', KEY_ID], true);

    expect(JSON.parse(stdout)).toEqual(revoked);
  });

  it('rechaza un id que no es UUID sin llamar a la API', async () => {
    await expect(run(['revoke', '123'])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propaga el 404 de una key inexistente', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'API key no encontrada' } }));

    await expect(run(['revoke', KEY_ID])).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});
