import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { SessionStore } from './api-client';
import { SessionError } from './errors';

// Sesión del CLI en ~/.reservalab/config.json, legible solo por el usuario (600; la carpeta, 700).
// RESERVALAB_CONFIG_DIR cambia la carpeta (útil para pruebas o para varias cuentas).
// En Windows los permisos POSIX no aplican: el archivo queda protegido por las ACL del perfil del usuario.

const ConfigSchema = z.object({
  apiUrl: z.string(),
  email: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type Config = z.infer<typeof ConfigSchema>;

export function configDir(): string {
  return process.env.RESERVALAB_CONFIG_DIR ?? join(homedir(), '.reservalab');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

// null si no existe o no tiene el formato esperado
export async function readConfig(): Promise<Config | null> {
  let raw: string;
  try {
    raw = await readFile(configPath(), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = ConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeConfig(config: Config): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // mode solo aplica al crear el archivo: si ya existía con otros permisos, se corrigen
  await chmod(configPath(), 0o600);
}

export async function deleteConfig(): Promise<void> {
  await rm(configPath(), { force: true });
}

// La sesión guardada como SessionStore del cliente HTTP. Los tokens solo valen para la API que los
// emitió, así que si RESERVALAB_API_URL cambió se pide iniciar sesión otra vez.
export function configSessionStore(apiUrl: string): SessionStore {
  return {
    async load() {
      const config = await readConfig();
      if (!config) return null;
      if (config.apiUrl !== apiUrl) {
        throw new SessionError(`La sesión guardada es de ${config.apiUrl}, no de ${apiUrl}`);
      }
      return config;
    },
    async saveAccessToken(accessToken) {
      const config = await readConfig();
      if (config) await writeConfig({ ...config, accessToken });
    },
  };
}
