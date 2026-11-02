import { randomUUID } from 'node:crypto';
import { AvailabilityResponseSchema, ReservationSchema } from '@reservalab/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { redis } from '../../src/lib/redis';
import { availabilityGroup, availabilityKey } from '../../src/services/cache-keys';
import { createTestUser, newRunId, startTestServer, type TestServer } from './helpers';

// Integración contra PostgreSQL y Redis reales: la caché de disponibilidad a través de HTTP, con la
// invalidación al reservar y cancelar.

const RUN_ID = newRunId();
const DAY_MS = 24 * 60 * 60 * 1000;
const GT_OFFSET_MS = -6 * 60 * 60 * 1000;

// Dentro de una semana, en hora de Guatemala, para que la reserva nunca quede en el pasado
const DATE = new Date(Date.now() + 7 * DAY_MS + GT_OFFSET_MS).toISOString().slice(0, 10);
const BLOCK = { startsAt: `${DATE}T09:00:00-06:00`, endsAt: `${DATE}T11:00:00-06:00` };

let server: TestServer;
let userId: string;
let token: string;
const spaceIds: string[] = [];

function api(path: string, init: RequestInit = {}) {
  return fetch(`${server.baseUrl}/api/v1${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
  });
}

async function getAvailability(spaceId: string) {
  const response = await api(`/spaces/${spaceId}/availability?date=${DATE}`);
  expect(response.status).toBe(200);
  return {
    cache: response.headers.get('x-cache'),
    body: AvailabilityResponseSchema.parse(await response.json()),
  };
}

async function reserve(spaceId: string) {
  const response = await api('/reservations', { method: 'POST', body: JSON.stringify({ spaceId, ...BLOCK }) });
  expect(response.status).toBe(201);
  return ReservationSchema.parse(await response.json());
}

const occupiedBlock = { startsAt: BLOCK.startsAt, endsAt: BLOCK.endsAt };

beforeAll(async () => {
  const user = await createTestUser(RUN_ID, 'DOCENTE');
  userId = user.id;
  token = user.token;

  // Se crean directo en la base para no subir la versión del listado de espacios en Redis
  for (const name of ['A', 'B']) {
    const space = await prisma.space.create({
      data: { name: `Caché ${name} ${RUN_ID}`, building: 'Pruebas', capacity: 10 },
    });
    spaceIds.push(space.id);
  }

  server = await startTestServer();
  // Por si quedó algo de una ejecución interrumpida con los mismos ids (no debería)
  await redis.del(spaceIds.flatMap((id) => [availabilityKey(id, DATE), availabilityGroup(id)]));
});

afterAll(async () => {
  if (redis.isOpen) {
    await redis.del(spaceIds.flatMap((id) => [availabilityKey(id, DATE), availabilityGroup(id)]));
  }
  if (spaceIds.length > 0) {
    await prisma.reservation.deleteMany({ where: { spaceId: { in: spaceIds } } });
    await prisma.space.deleteMany({ where: { id: { in: spaceIds } } });
  }
  if (userId) {
    await prisma.user.delete({ where: { id: userId } });
  }
  await server?.close();
});

describe('caché de disponibilidad con Redis real', () => {
  it('dos consultas seguidas: MISS y luego HIT con el mismo cuerpo', async () => {
    const [spaceId] = spaceIds as [string];

    const first = await getAvailability(spaceId);
    const second = await getAvailability(spaceId);

    expect(first.cache).toBe('MISS');
    expect(second.cache).toBe('HIT');
    expect(second.body).toEqual(first.body);
    expect(await redis.exists(availabilityKey(spaceId, DATE))).toBe(1);
  });

  it('reservar invalida: la consulta siguiente es MISS y ya muestra el bloque ocupado; cancelar lo libera', async () => {
    const [spaceId] = spaceIds as [string];
    await getAvailability(spaceId);
    expect((await getAvailability(spaceId)).cache).toBe('HIT');

    const reservation = await reserve(spaceId);

    const afterReserve = await getAvailability(spaceId);
    expect(afterReserve.cache).toBe('MISS');
    expect(afterReserve.body.occupied).toEqual([occupiedBlock]);
    expect((await getAvailability(spaceId)).cache).toBe('HIT');

    const cancel = await api(`/reservations/${reservation.id}`, { method: 'DELETE' });
    expect(cancel.status).toBe(200);

    const afterCancel = await getAvailability(spaceId);
    expect(afterCancel.cache).toBe('MISS');
    expect(afterCancel.body.occupied).toEqual([]);
    expect(afterCancel.body.free).toEqual([afterCancel.body.window]);
  });

  it('dos espacios no se contaminan: reservar en A no toca la caché ni los datos de B', async () => {
    const [spaceA, spaceB] = spaceIds as [string, string];
    await getAvailability(spaceA);
    await getAvailability(spaceB);

    await reserve(spaceA);

    const a = await getAvailability(spaceA);
    const b = await getAvailability(spaceB);
    expect(a.cache).toBe('MISS');
    expect(a.body).toMatchObject({ spaceId: spaceA, occupied: [occupiedBlock] });
    expect(b.cache).toBe('HIT');
    expect(b.body).toMatchObject({ spaceId: spaceB, occupied: [] });
  });

  it('no guarda respuestas 404 ni 400', async () => {
    const unknownSpace = randomUUID();

    const notFound = await api(`/spaces/${unknownSpace}/availability?date=${DATE}`);
    const badRequest = await api(`/spaces/${spaceIds[0]}/availability?date=2026-13-45`);

    expect(notFound.status).toBe(404);
    expect(badRequest.status).toBe(400);
    expect(notFound.headers.get('x-cache')).toBeNull();
    expect(badRequest.headers.get('x-cache')).toBeNull();
    expect(await redis.exists(availabilityKey(unknownSpace, DATE))).toBe(0);
    expect(await redis.exists(availabilityKey(spaceIds[0]!, '2026-13-45'))).toBe(0);
  });
});
