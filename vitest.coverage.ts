import { readFileSync } from 'node:fs';

// Umbral de cobertura común a todo el monorepo. El valor vive en coverage.thresholds.json, que también
// lee scripts/test-coverage.mjs para imprimir el resumen:
//   - threshold: porcentaje mínimo.
//   - metrics: métricas a las que se aplica (lines, statements, branches, functions).
//   - enforcedPackages: paquetes a los que se exige. Para exigirlo a la CLI o a la web basta agregar
//     "@reservalab/cli" o "@reservalab/web" a la lista.
type Metric = 'lines' | 'statements' | 'branches' | 'functions';

interface CoverageConfig {
  threshold: number;
  metrics: Metric[];
  enforcedPackages: string[];
}

export const coverageConfig: CoverageConfig = JSON.parse(
  readFileSync(new URL('./coverage.thresholds.json', import.meta.url), 'utf8'),
);

// Umbrales para coverage.thresholds de Vitest; vacío si el paquete no está en enforcedPackages.
export function coverageThresholds(packageName: string): Partial<Record<Metric, number>> {
  if (!coverageConfig.enforcedPackages.includes(packageName)) {
    return {};
  }
  return Object.fromEntries(coverageConfig.metrics.map((metric) => [metric, coverageConfig.threshold]));
}
