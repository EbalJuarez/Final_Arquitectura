import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../lib/api-client';
import { configSessionStore } from '../lib/config';
import type { Context } from '../lib/context';
import { CliError } from '../lib/errors';
import { askCredentials } from '../lib/prompt';
import { registerLogin } from './login';

// Comando `login` con fetch mockeado, credenciales simuladas y la configuración en una carpeta temporal.

vi.mock('../lib/prompt', () => ({ askCredentials: vi.fn() }));

const API_URL = 'http://api.prueba';
const admin = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  email: 'admin@reservalab.test',
  name: 'Ada Admin',
  role: 'ADMIN',
  createdAt: '2026-11-01T15:30:00.000Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let dir: string;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let stdout: string;
let stderr: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reservalab-login-'));
  process.env.RESERVALAB_CONFIG_DIR = dir;
  fetchMock = vi.fn<typeof fetch>();
  vi.mocked(askCredentials).mockResolvedValue({ email: 'admin@reservalab.test', password: 'secreta' });
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

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.RESERVALAB_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
});

// Usa el almacén de sesión real (config.json), igual que el CLI
async function run(json = false): Promise<void> {
  const context = (): Context => ({
    apiUrl: API_URL,
    client: new ApiClient(API_URL, configSessionStore(API_URL), fetchMock),
    json,
  });
  const program = new Command().exitOverride();
  registerLogin(program, context);
  await program.parseAsync(['login'], { from: 'user' });
}

function mockLogin(user: typeof admin) {
  fetchMock
    .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'access-1', refreshToken: 'refresh-1' }))
    .mockResolvedValueOnce(jsonResponse(200, user));
}

describe('login', () => {
  it('envía las credenciales sin token, guarda los tokens y consulta /auth/me con el access token', async () => {
    mockLogin(admin);

    await run();

    const [loginUrl, loginInit] = fetchMock.mock.calls[0]!;
    expect(loginUrl).toBe(`${API_URL}/api/v1/auth/login`);
    expect(JSON.parse(String(loginInit?.body))).toEqual({ email: 'admin@reservalab.test', password: 'secreta' });
    expect((loginInit?.headers as Record<string, string>).Authorization).toBeUndefined();

    const [meUrl, meInit] = fetchMock.mock.calls[1]!;
    expect(meUrl).toBe(`${API_URL}/api/v1/auth/me`);
    expect((meInit?.headers as Record<string, string>).Authorization).toBe('Bearer access-1');

    const saved = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(saved).toEqual({
      apiUrl: API_URL,
      email: 'admin@reservalab.test',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
    expect(stderr).toContain(`Sesión iniciada como Ada Admin <admin@reservalab.test> (ADMIN) en ${API_URL}`);
    expect(stderr).toContain(`Tokens guardados en ${join(dir, 'config.json')}`);
    expect(stderr).not.toContain('no es ADMIN');
  });

  it('con --json imprime el usuario y la ruta de la configuración', async () => {
    mockLogin(admin);

    await run(true);

    expect(JSON.parse(stdout)).toEqual({ user: admin, configPath: join(dir, 'config.json') });
  });

  it('avisa cuando el usuario no es ADMIN', async () => {
    mockLogin({ ...admin, role: 'DOCENTE' });

    await run();

    expect(stderr).toContain('Aviso: este usuario no es ADMIN');
  });

  it('rechaza un correo inválido sin llamar a la API ni guardar nada', async () => {
    vi.mocked(askCredentials).mockResolvedValue({ email: 'no-es-correo', password: 'x' });

    const error = await run().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((error as CliError).details?.[0]?.field).toBe('email');
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(readFile(join(dir, 'config.json'), 'utf8')).rejects.toThrow();
  });

  it('con credenciales incorrectas propaga el 401 de la API y no guarda la sesión', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos' } }),
    );

    await expect(run()).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(readFile(join(dir, 'config.json'), 'utf8')).rejects.toThrow();
  });
});
