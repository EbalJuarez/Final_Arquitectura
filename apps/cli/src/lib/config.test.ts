import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configPath, configSessionStore, readConfig, writeConfig } from './config';
import { SessionError } from './errors';

// Usa una carpeta temporal (RESERVALAB_CONFIG_DIR) en vez de ~/.reservalab.

const config = {
  apiUrl: 'http://localhost:3000',
  email: 'admin@reservalab.test',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reservalab-cli-'));
  process.env.RESERVALAB_CONFIG_DIR = dir;
});

afterEach(async () => {
  delete process.env.RESERVALAB_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe('archivo de configuración', () => {
  it('guarda y lee la sesión en config.json', async () => {
    await writeConfig(config);

    expect(configPath()).toBe(join(dir, 'config.json'));
    await expect(readConfig()).resolves.toEqual(config);
  });

  it.skipIf(process.platform === 'win32')('queda con permisos 600', async () => {
    await writeFile(join(dir, 'config.json'), '{}', { mode: 0o644 });

    await writeConfig(config);

    expect((await stat(configPath())).mode & 0o777).toBe(0o600);
  });

  it('sin archivo, o con un archivo dañado, no hay sesión', async () => {
    await expect(readConfig()).resolves.toBeNull();

    await writeFile(configPath(), 'no es json');
    await expect(readConfig()).resolves.toBeNull();

    await writeFile(configPath(), JSON.stringify({ apiUrl: 'x' }));
    await expect(readConfig()).resolves.toBeNull();
  });
});

describe('configSessionStore', () => {
  it('guarda el access token renovado sin tocar el resto', async () => {
    await writeConfig(config);

    await configSessionStore(config.apiUrl).saveAccessToken('access-2');

    expect(JSON.parse(await readFile(configPath(), 'utf8'))).toEqual({ ...config, accessToken: 'access-2' });
  });

  it('si la sesión es de otra URL de la API, pide volver a iniciar sesión', async () => {
    await writeConfig(config);

    await expect(configSessionStore('http://otra-api:3000').load()).rejects.toBeInstanceOf(SessionError);
  });
});
