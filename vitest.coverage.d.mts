// Tipos de vitest.coverage.mjs
export type Metric = 'lines' | 'statements' | 'branches' | 'functions';

export interface CoverageConfig {
  threshold: number;
  metrics: Metric[];
  enforcedPackages: string[];
}

export declare const coverageConfig: CoverageConfig;

export declare function coverageThresholds(packageName: string): Partial<Record<Metric, number>>;
