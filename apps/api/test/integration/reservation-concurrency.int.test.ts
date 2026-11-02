import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createReservation } from '../../src/repositories/reservation.repository';
import { toOffsetIso } from '../../src/services/availability.service';
import { createTestUser, newRunId, startTestServer, type TestServer } from './helpers';

// Integración contra PostgreSQL real: se prueba la carrera entre solicitudes, que solo la
// restricción EXCLUDE puede resolver. Las notificaciones se mockean para no depender de Mockoon.
vi.mock('../../src/clients/notifications.client', () => ({
  notifyReservationConfirmed: vi.fn().mockResolvedValue(undefined),
  notifyReservationCancelled: vi.fn().mockResolvedValue(undefined),
}));

const RUN_ID = newRunId();
const DAY_MS = 24 * 60 * 60 * 1000;
// Un día futuro en hora de Guatemala, para que las reservas no queden en el pasado
const DATE = toOffsetIso(new Date(Date.now() + 30 * DAY_MS), -360).slice(0, 10);

let server: TestServer;
let userId: string;
let spaceId: string;
let token: string;

function slot(hour: number) {
  const pad = (h: number) => String(h).padStart(2, '0');
  return { startsAt: `${DATE}T${pad(hour)}:00:00-06:00`, endsAt: `${DATE}T${pad(hour + 1)}:00:00-06:00` };
}

function postReservation(body: object) {
  return fetch(`${server.baseUrl}/api/v1/reservations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  // Datos propios de esta ejecución; se borran en afterAll sin tocar los del seed.
  const user = await createTestUser(RUN_ID, 'DOCENTE');
  const space = await prisma.space.create({
    data: { name: `Espacio de integración ${RUN_ID}`, building: 'Pruebas', capacity: 10 },
  });
  userId = user.id;
  spaceId = space.id;
  token = user.token;

  server = await startTestServer();
});

afterAll(async () => {
  if (spaceId) {
    await prisma.reservation.deleteMany({ where: { spaceId } });
    await prisma.space.delete({ where: { id: spaceId } });
  }
  if (userId) {
    await prisma.user.delete({ where: { id: userId } });
  }
  await server?.close();
});

describe('reservas simultáneas contra la base real', () => {
  // Se repite en varios horarios para que la carrera ocurra más de una vez.
  it.each([8, 10, 12, 14, 16])(
    'dos POST simultáneos para %i:00: exactamente uno responde 201 y el otro 409',
    async (hour) => {
      const body = { spaceId, ...slot(hour) };

      const responses = await Promise.all([postReservation(body), postReservation(body)]);
      const statuses = responses.map((response) => response.status).sort();

      expect(statuses).toEqual([201, 409]);
      const rejected = responses.find((response) => response.status === 409)!;
      expect(await rejected.json()).toMatchObject({ error: { code: 'RESERVATION_OVERLAP' } });

      const confirmed = await prisma.reservation.count({
        where: { spaceId, status: 'CONFIRMED', startsAt: new Date(body.startsAt) },
      });
      expect(confirmed).toBe(1);
    },
  );

  it('la restricción EXCLUDE rechaza el traslape aunque se salte la validación del servicio', async () => {
    const { startsAt, endsAt } = slot(18);
    const first = await createReservation({ spaceId, userId, startsAt: new Date(startsAt), endsAt: new Date(endsAt) });
    expect(first.status).toBe('CREATED');

    // 18:30-19:30 se traslapa con 18:00-19:00; va directo al repositorio, sin consulta previa
    const second = await createReservation({
      spaceId,
      userId,
      startsAt: new Date(new Date(startsAt).getTime() + 30 * 60 * 1000),
      endsAt: new Date(new Date(endsAt).getTime() + 30 * 60 * 1000),
    });
    expect(second).toEqual({ status: 'OVERLAP' });
  });
});
