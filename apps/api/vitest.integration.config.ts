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
    env,
    testTimeout: 20_000,
    // Un archivo a la vez: comparten Redis, y claves como la de /now son globales. En paralelo, un archivo
    // podría llenar la caché entre el borrado y la primera consulta de otro.
    fileParallelism: false,
    projects: [
      // pnpm test:integration: PostgreSQL y Redis reales; las notificaciones se simulan o no se revisan
      { extends: true, test: { name: 'integracion', include: ['test/integration/**/*.int.test.ts'] } },
      // pnpm test:integration:mockoon: notificaciones contra el Mockoon real; se omiten si no está disponible
      { extends: true, test: { name: 'mockoon', include: ['test/integration/**/*.mockoon.test.ts'] } },
    ],
  },
});
