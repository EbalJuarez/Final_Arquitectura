import { HealthResponseSchema } from '@reservalab/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as healthRepository from '../repositories/health.repository';
import * as healthService from './health.service';

// Repositorio mockeado: cada ping simula a PostgreSQL o Redis respondiendo o caídos.
vi.mock('../repositories/health.repository', () => ({
  pingDatabase: vi.fn(),
  pingRedis: vi.fn(),
}));

const repository = vi.mocked(healthRepository);

describe('getHealth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repository.pingDatabase.mockResolvedValue(undefined);
    repository.pingRedis.mockResolvedValue(undefined);
  });

  it('reporta ok cuando PostgreSQL y Redis responden', async () => {
    const report = await healthService.getHealth();

    expect(report).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
    expect(HealthResponseSchema.parse(report)).toEqual(report);
    expect(repository.pingDatabase).toHaveBeenCalledOnce();
    expect(repository.pingRedis).toHaveBeenCalledOnce();
  });

  it('reporta error y señala la base si PostgreSQL está caído', async () => {
    repository.pingDatabase.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5433'));

    const report = await healthService.getHealth();

    expect(report).toEqual({ status: 'error', checks: { database: 'error', redis: 'ok' } });
  });

  it('reporta error y señala Redis si Redis está caído', async () => {
    repository.pingRedis.mockRejectedValue(new Error('The client is closed'));

    const report = await healthService.getHealth();

    expect(report).toEqual({ status: 'error', checks: { database: 'ok', redis: 'error' } });
  });

  it('reporta ambas dependencias caídas sin lanzar', async () => {
    repository.pingDatabase.mockRejectedValue(new Error('timeout'));
    repository.pingRedis.mockRejectedValue(new Error('timeout'));

    const report = await healthService.getHealth();

    expect(report).toEqual({ status: 'error', checks: { database: 'error', redis: 'error' } });
    expect(HealthResponseSchema.parse(report)).toEqual(report);
  });

  it('consulta Redis aunque la base falle, en paralelo y no en secuencia', async () => {
    // La base tarda en fallar; Redis debe consultarse antes de que la base termine.
    let rejectDatabase!: (error: Error) => void;
    repository.pingDatabase.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectDatabase = reject;
      }),
    );

    const pending = healthService.getHealth();
    expect(repository.pingRedis).toHaveBeenCalledOnce();

    rejectDatabase(new Error('connect ETIMEDOUT'));
    await expect(pending).resolves.toEqual({ status: 'error', checks: { database: 'error', redis: 'ok' } });
  });
});
