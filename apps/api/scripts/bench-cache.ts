import { randomUUID } from 'node:crypto';
import { Agent, get } from 'node:http';
import { arch, cpus, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { prisma } from '../src/lib/prisma';
import { redis } from '../src/lib/redis';
import { signAccessToken } from '../src/lib/tokens';
import { availabilityGroup, availabilityKey } from '../src/services/cache-keys';

// Mide la latencia de GET /spaces/:id/availability con la caché vacía (MISS) y caliente (HIT) contra
// una API ya levantada (por defecto la del docker compose). Crea un usuario, un espacio y sus reservas
// con un identificador propio y los borra al terminar.
//
//   pnpm --filter @reservalab/api bench:cache
//   BENCH_BASE_URL=http://localhost:3010 BENCH_REQUESTS=500 pnpm --filter @reservalab/api bench:cache

const BASE_URL = process.env.BENCH_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? 3000}`;
const REQUESTS = Number(process.env.BENCH_REQUESTS ?? 200);
const WARMUP = 20;
const RESERVATIONS_PER_DAY = 5;

const RUN_ID = randomUUID().slice(0, 8);
const DAY_MS = 24 * 60 * 60 * 1000;
const GT_OFFSET_MS = -6 * 60 * 60 * 1000;
// Dentro de una semana, en hora de Guatemala
const DATE = new Date(Date.now() + 7 * DAY_MS + GT_OFFSET_MS).toISOString().slice(0, 10);

interface Stats {
  p50: number;
  p95: number;
  mean: number;
  min: number;
  max: number;
}

// Percentil por el método del rango más cercano
function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function summarize(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  };
}

async function main(): Promise<void> {
  const user = await prisma.user.create({
    data: {
      email: `bench-${RUN_ID}@reservalab.test`,
      name: 'Medición de caché',
      passwordHash: 'no-se-usa',
      role: 'DOCENTE',
    },
  });
  const space = await prisma.space.create({
    data: { name: `Medición ${RUN_ID}`, building: 'Pruebas', capacity: 10 },
  });
  const key = availabilityKey(space.id, DATE);
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });

  try {
    await redis.connect();
    // Bloques de 2 h desde las 7:00, para que la respuesta tenga ocupados y libres
    await prisma.reservation.createMany({
      data: Array.from({ length: RESERVATIONS_PER_DAY }, (_, i) => ({
        spaceId: space.id,
        userId: user.id,
        startsAt: new Date(`${DATE}T${String(7 + 3 * i).padStart(2, '0')}:00:00-06:00`),
        endsAt: new Date(`${DATE}T${String(9 + 3 * i).padStart(2, '0')}:00:00-06:00`),
      })),
    });

    const token = signAccessToken({ id: user.id, role: user.role });
    const url = `${BASE_URL}/api/v1/spaces/${space.id}/availability?date=${DATE}`;

    // node:http con keep-alive y no fetch: en Windows, fetch (undici) sumaba unos 13 ms fijos a cada
    // solicitud contra localhost y ocultaba la diferencia entre MISS y HIT.
    const headers = { Authorization: `Bearer ${token}` };

    function request(expected: 'HIT' | 'MISS'): Promise<number> {
      return new Promise((resolve, reject) => {
        const start = performance.now();
        get(url, { agent, headers }, (response) => {
          response.resume();
          response.on('end', () => {
            const elapsed = performance.now() - start;
            const cache = response.headers['x-cache'];
            if (response.statusCode !== 200 || cache !== expected) {
              reject(new Error(`Se esperaba 200 ${expected} y llegó ${response.statusCode} ${cache ?? '(sin X-Cache)'}`));
            } else {
              resolve(elapsed);
            }
          });
        }).on('error', reject);
      });
    }

    async function measure(expected: 'HIT' | 'MISS'): Promise<number[]> {
      const samples: number[] = [];
      for (let i = 0; i < REQUESTS; i++) {
        // Caché vacía: se borra la clave antes de cada solicitud (fuera de la medición)
        if (expected === 'MISS') await redis.del(key);
        samples.push(await request(expected));
      }
      return samples;
    }

    // Calentamiento: conexiones HTTP, pool de Prisma y JIT. No se cuenta.
    for (let i = 0; i < WARMUP; i++) {
      await redis.del(key);
      await request('MISS');
    }

    const cold = summarize(await measure('MISS'));
    // La última solicitud MISS dejó la clave guardada: desde aquí todas son HIT
    const warm = summarize(await measure('HIT'));

    const row = (name: string, s: Stats) =>
      `| ${name} | ${REQUESTS} | ${s.p50.toFixed(2)} | ${s.p95.toFixed(2)} | ${s.mean.toFixed(2)} | ${s.min.toFixed(2)} | ${s.max.toFixed(2)} |`;
    console.log(`Fecha: ${new Date().toISOString()}`);
    console.log(`API: ${BASE_URL}  ·  fecha consultada: ${DATE}  ·  ${RESERVATIONS_PER_DAY} reservas en el día`);
    console.log(`Cliente: Node ${process.version} en ${platform()} ${release()} ${arch()}, ${cpus()[0]?.model ?? 'CPU desconocida'}`);
    console.log(`Solicitudes secuenciales (una a la vez), ${WARMUP} de calentamiento sin contar\n`);
    console.log('| Caso | Solicitudes | p50 (ms) | p95 (ms) | Media (ms) | Mín (ms) | Máx (ms) |');
    console.log('|---|---:|---:|---:|---:|---:|---:|');
    console.log(row('Caché vacía (MISS)', cold));
    console.log(row('Caché caliente (HIT)', warm));
    console.log(`\np50: ${(cold.p50 / warm.p50).toFixed(1)}x más rápido con HIT · p95: ${(cold.p95 / warm.p95).toFixed(1)}x`);
  } finally {
    agent.destroy();
    if (redis.isOpen) {
      await redis.del([key, availabilityGroup(space.id)]);
      await redis.quit();
    }
    await prisma.reservation.deleteMany({ where: { spaceId: space.id } });
    await prisma.space.delete({ where: { id: space.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
