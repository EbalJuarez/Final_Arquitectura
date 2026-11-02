import type { CheckStatus, HealthResponse } from '@reservalab/shared';
import * as healthRepository from '../repositories/health.repository';

async function check(probe: () => Promise<void>): Promise<CheckStatus> {
  try {
    await probe();
    return 'ok';
  } catch {
    return 'error';
  }
}

export async function getHealth(): Promise<HealthResponse> {
  const [database, redis] = await Promise.all([
    check(healthRepository.pingDatabase),
    check(healthRepository.pingRedis),
  ]);
  const status = database === 'ok' && redis === 'ok' ? 'ok' : 'error';
  return { status, checks: { database, redis } };
}
