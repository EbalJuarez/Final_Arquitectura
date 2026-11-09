import { defineConfig } from 'vitest/config';
import { coverageThresholds } from '../../vitest.coverage.mjs';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // json-summary lo lee scripts/test-coverage.mjs para el resumen por paquete
      reporter: ['text', 'html', 'json-summary'],
      // Umbral común (coverage.thresholds.json); vacío si este paquete no está en enforcedPackages
      thresholds: coverageThresholds('@reservalab/cli'),
    },
  },
});
