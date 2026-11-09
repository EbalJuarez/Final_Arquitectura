// pnpm test:coverage: corre Vitest con cobertura en cada paquete vía Turborepo y luego imprime un
// resumen por paquete. Termina con el código de salida de Turborepo, así que falla si algún paquete de
// enforcedPackages (coverage.thresholds.json) queda bajo el umbral: eso lo hace cumplir Vitest.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const config = JSON.parse(readFileSync(new URL('coverage.thresholds.json', root), 'utf8'));
const packages = ['apps/api', 'apps/cli', 'apps/web'];
const metrics = ['lines', 'statements', 'branches', 'functions'];

// Se borran los resúmenes anteriores para no reportar números viejos si un paquete falla antes de
// escribir el suyo. Si Turborepo usa su caché, los restaura junto con el resto de coverage/.
for (const dir of packages) {
  rmSync(new URL(`${dir}/coverage/coverage-summary.json`, root), { force: true });
}

// --continue: aunque un paquete falle, los demás corren y el resumen sale completo.
// shell: true para que Windows encuentre turbo(.cmd) en node_modules/.bin.
const turbo = spawnSync('turbo', ['run', 'test:coverage', '--continue', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
});

const rows = [];
for (const dir of packages) {
  const pkg = JSON.parse(readFileSync(new URL(`${dir}/package.json`, root), 'utf8'));
  const summaryFile = new URL(`${dir}/coverage/coverage-summary.json`, root);
  const enforced = config.enforcedPackages.includes(pkg.name);
  if (!existsSync(summaryFile)) {
    rows.push([pkg.name, ...metrics.map(() => '-'), enforced ? 'SIN DATOS' : 'sin umbral']);
    continue;
  }
  const total = JSON.parse(readFileSync(summaryFile, 'utf8')).total;
  const failing = config.metrics.filter((metric) => total[metric].pct < config.threshold);
  const status = !enforced ? 'sin umbral' : failing.length === 0 ? 'OK' : `BAJO UMBRAL (${failing.join(', ')})`;
  rows.push([pkg.name, ...metrics.map((metric) => `${total[metric].pct.toFixed(2)} %`), status]);
}

const header = ['Paquete', 'Lines', 'Statements', 'Branches', 'Functions', 'Estado'];
const widths = header.map((title, i) => Math.max(title.length, ...rows.map((row) => row[i].length)));
const line = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join(' | ');

console.log(`\nCobertura por paquete. Umbral: ${config.threshold} % en ${config.metrics.join(', ')}; se exige a ${config.enforcedPackages.join(', ')}.`);
console.log(line(header));
console.log(widths.map((width) => '-'.repeat(width)).join('-|-'));
for (const row of rows) console.log(line(row));

process.exit(turbo.status ?? 1);
