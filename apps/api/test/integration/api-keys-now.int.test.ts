import { CreatedApiKeySchema, NowResponseSchema, type ApiKeyPermission } from '@reservalab/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashApiKey } from '../../src/lib/api-keys';
import { prisma } from '../../src/lib/prisma';
import { redis } from '../../src/lib/redis';
import { createTestUser, newRunId, startTestServer, type TestServer } from './helpers';

// Integración contra PostgreSQL y Redis reales: el ciclo de vida de una API key a través de HTTP,
// desde su creación por un ADMIN hasta su revocación, usando GET /now.

const RUN_ID = newRunId();
const MINUTE_MS = 60 * 1000;

let server: TestServer;
let adminId: string;
let adminToken: string;
let spaceId: string;
const createdKeyIds: string[] = [];

function api(path: string, init: RequestInit = {}) {
  return fetch(`${server.baseUrl}/api/v1${path}`, init);
}

async function createKey(permissions: ApiKeyPermission[]) {
  const response = await api('/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ name: `Integración ${RUN_ID}`, permissions }),
  });
  expect(response.status).toBe(201);
  const created = CreatedApiKeySchema.parse(await response.json());
  createdKeyIds.push(created.id);
  return created;
}

const getNow = (key: string) => api('/now', { headers: { 'X-API-Key': key } });

beforeAll(async () => {
  const admin = await createTestUser(RUN_ID, 'ADMIN');
  adminId = admin.id;
  adminToken = admin.token;

  // Un espacio con una reserva en curso: empezó hace 10 minutos y termina en 10.
  // Se inserta directo porque el servicio no permite reservas que empiezan en el pasado.
  const space = await prisma.space.create({
    data: { name: `Espacio de integración ${RUN_ID}`, building: 'Pruebas', capacity: 10 },
  });
  spaceId = space.id;
  const now = Date.now();
  await prisma.reservation.create({
    data: {
      spaceId,
      userId: adminId,
      startsAt: new Date(now - 10 * MINUTE_MS),
      endsAt: new Date(now + 10 * MINUTE_MS),
    },
  });

  server = await startTestServer();
});

afterAll(async () => {
  if (createdKeyIds.length > 0) {
    const counters = await redis.keys('rate-limit:api-key:*');
    const ours = counters.filter((counter) => createdKeyIds.some((id) => counter.includes(id)));
    if (ours.length > 0) {
      await redis.del(ours);
    }
    await prisma.apiKey.deleteMany({ where: { id: { in: createdKeyIds } } });
  }
  if (spaceId) {
    await prisma.reservation.deleteMany({ where: { spaceId } });
    await prisma.space.delete({ where: { id: spaceId } });
  }
  if (adminId) {
    await prisma.user.delete({ where: { id: adminId } });
  }
  await server?.close();
});

describe('API keys contra la base real', () => {
  it('crear una key, llamar a /now (200), revocarla y volver a llamar (401)', async () => {
    const created = await createKey(['read:now']);

    // En la base queda solo el hash, nunca la key
    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.keyHash).toBe(hashApiKey(created.key));
    expect(stored.keyHash).not.toBe(created.key);

    const ok = await getNow(created.key);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-ratelimit-limit')).not.toBeNull();
    const body = NowResponseSchema.parse(await ok.json());
    expect(body.timezone).toBe('America/Guatemala');
    expect(body.now).toMatch(/-06:00$/);
    expect(body.spaces.find((space) => space.id === spaceId)).toMatchObject({ status: 'OCCUPIED' });

    const revoke = await api(`/api-keys/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(revoke.status).toBe(200);

    const rejected = await getNow(created.key);
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toMatchObject({ error: { code: 'INVALID_API_KEY' } });
  });

  it('una key sin read:now recibe 403', async () => {
    const created = await createKey(['read:spaces']);

    const response = await getNow(created.key);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });
});
