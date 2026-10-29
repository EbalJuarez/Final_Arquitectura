import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Valores falsos para que config/env.ts cargue; las pruebas unitarias no se conectan a nada.
    env: {
      DATABASE_URL: 'postgresql://prueba:prueba@localhost:5432/prueba',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'secreto_solo_para_pruebas_unitarias',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/server.ts'],
      reporter: ['text', 'html'],
    },
  },
});
