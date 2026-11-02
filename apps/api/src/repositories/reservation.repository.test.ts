import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../lib/prisma';
import { createReservation } from './reservation.repository';

// Prisma mockeado: se simula el error exactamente como lo entrega Prisma 6 ante la restricción EXCLUDE.
vi.mock('../lib/prisma', () => ({
  prisma: { reservation: { create: vi.fn() } },
}));

const create = vi.mocked(prisma.reservation.create);

const data = {
  spaceId: '44444444-4444-4444-8444-444444444444',
  userId: '11111111-1111-4111-8111-111111111111',
  startsAt: new Date('2026-11-04T15:00:00Z'),
  endsAt: new Date('2026-11-04T17:00:00Z'),
};

// Mensaje real (recortado) obtenido al violar la restricción contra PostgreSQL 16
const EXCLUSION_MESSAGE =
  'Error occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23P01", message: "conflicting key value violates exclusion constraint \\"Reservation_no_overlap\\"", severity: "ERROR" }) })';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createReservation', () => {
  it('devuelve CREATED con la reserva creada', async () => {
    create.mockResolvedValue({ id: 'r1' } as never);

    await expect(createReservation(data)).resolves.toEqual({ status: 'CREATED', reservation: { id: 'r1' } });
  });

  it('traduce la violación de EXCLUDE (23P01) a OVERLAP', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientUnknownRequestError(EXCLUSION_MESSAGE, { clientVersion: '6.19.3' }),
    );

    await expect(createReservation(data)).resolves.toEqual({ status: 'OVERLAP' });
  });

  it('no confunde otros errores de la base con un traslape', async () => {
    const checkViolation = new Prisma.PrismaClientUnknownRequestError(
      'PostgresError { code: "23514", message: "violates check constraint \\"Reservation_endsAt_after_startsAt\\"" }',
      { clientVersion: '6.19.3' },
    );
    create.mockRejectedValue(checkViolation);

    await expect(createReservation(data)).rejects.toBe(checkViolation);
  });
});
