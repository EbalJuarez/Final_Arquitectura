import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

// Pruebas de integración: usan la base real del docker compose con las variables de ../../.env.
const envFile = new URL('../../.env', import.meta.url);
if (!existsSync(envFile)) {
  throw new Error('Falta el archivo .env en la raíz: las pruebas de integración usan la base real');
}
const env = parseEnv(readFileSync(envFile, 'utf8'));

// Protección: estas pruebas escriben y borran datos, así que solo corren contra una base local.
const databaseHost = new URL(env.DATABASE_URL ?? '').hostname;
if (!['localhost', '127.0.0.1'].includes(databaseHost)) {
  throw new Error(`Las pruebas de integración solo corren contra una base local (DATABASE_URL apunta a ${databaseHost})`);
}

export default defineConfig({
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    env,
    testTimeout: 20_000,
  },
});
