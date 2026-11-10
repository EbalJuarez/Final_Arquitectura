import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env';
import { prisma } from '../../src/lib/prisma';
import { toOffsetIso } from '../../src/services/availability.service';
import { createTestUser, newRunId, startTestServer, type TestServer } from './helpers';

// Integración contra el Mockoon real del docker compose (packages/mocks/notifications.json): sin mocks del
// cliente de notificaciones. Lo que llegó a Mockoon se lee con su admin API (/mockoon-admin/logs).
// Se corre con `pnpm test:integration:mockoon` (proyecto "mockoon" de vitest.integration.config.ts).
// Si Mockoon o su admin API no responden, se omite (salvo con MOCKOON_REQUIRED=1, como en el CI).

const MOCKOON_URL = env.NOTIFICATIONS_URL.replace(/\/+$/, '');
const ADMIN_TOKEN = process.env.MOCKOON_ADMIN_API_TOKEN ?? 'token_admin_mockoon_falso';

interface MockoonLog {
  request: { method: string; urlPath: string; body: string; headers: { key: string; value: string }[] };
  response: { statusCode: number };
}

async function fetchMockoonLogs(): Promise<MockoonLog[]> {
  const response = await fetch(`${MOCKOON_URL}/mockoon-admin/logs`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    signal: AbortSignal.timeout(1000),
  });
  if (!response.ok) {
    throw new Error(`el admin API de Mockoon respondió ${response.status}`);
  }
  return (await response.json()) as MockoonLog[];
}

// Mockoon guarda pocas transacciones y deja de registrar cuando se llena: se vacía antes de cada prueba.
async function purgeMockoonLogs(): Promise<void> {
  const response = await fetch(`${MOCKOON_URL}/mockoon-admin/logs/purge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    signal: AbortSignal.timeout(1000),
  });
  if (!response.ok) {
    throw new Error(`el admin API de Mockoon respondió ${response.status} al vaciar el log`);
  }
}

async function checkMockoon(): Promise<string | null> {
  try {
    await fetchMockoonLogs();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const unavailableReason = await checkMockoon();
// En el CI Mockoon debe estar arriba: con MOCKOON_REQUIRED=1 la falta de Mockoon es un error, no una omisión.
if (unavailableReason && process.env.MOCKOON_REQUIRED === '1') {
  throw new Error(`MOCKOON_REQUIRED=1 pero Mockoon no está disponible en ${MOCKOON_URL} (${unavailableReason})`);
}
if (unavailableReason) {
  console.warn(
    `[mockoon] Se omiten las pruebas de notificaciones: Mockoon no está disponible en ${MOCKOON_URL} ` +
      `(${unavailableReason}). Levántalo con \`docker compose up -d mockoon\`.`,
  );
}

// Espera a que Mockoon registre una solicitud a urlPath cuyo cuerpo mencione la reserva.
async function waitForMockoonRequest(urlPath: string, reservationId: string): Promise<MockoonLog> {
  let found: MockoonLog | undefined;
  await vi.waitFor(
    async () => {
      const logs = await fetchMockoonLogs();
      found = logs.find((log) => log.request.urlPath === urlPath && log.request.body.includes(reservationId));
      if (!found) throw new Error(`Mockoon no recibió ${urlPath} para ${reservationId}`);
    },
    { timeout: 4000, interval: 100 },
  );
  return found!;
}

const RUN_ID = newRunId();
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = toOffsetIso(new Date(Date.now() + 31 * DAY_MS), -360).slice(0, 10);
const ORIGINAL_NOTIFICATIONS_URL = env.NOTIFICATIONS_URL;

let server: TestServer;
let user: { id: string; token: string; email: string };
let space: { id: string; name: string };

function slot(hour: number) {
  const pad = (h: number) => String(h).padStart(2, '0');
  return { startsAt: `${DATE}T${pad(hour)}:00:00-06:00`, endsAt: `${DATE}T${pad(hour + 1)}:00:00-06:00` };
}

function request(method: string, path: string, body?: object) {
  return fetch(`${server.baseUrl}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe.skipIf(unavailableReason !== null)('notificaciones contra Mockoon real', () => {
  beforeAll(async () => {
    const created = await createTestUser(RUN_ID, 'DOCENTE');
    user = { ...created, email: `integracion-docente-${RUN_ID}@reservalab.test` };
    space = await prisma.space.create({
      data: { name: `Espacio Mockoon ${RUN_ID}`, building: 'Pruebas', capacity: 10 },
    });
    server = await startTestServer();
  });

  beforeEach(async () => {
    await purgeMockoonLogs();
  });

  afterEach(() => {
    env.NOTIFICATIONS_URL = ORIGINAL_NOTIFICATIONS_URL;
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (space) {
      await prisma.reservation.deleteMany({ where: { spaceId: space.id } });
      await prisma.space.delete({ where: { id: space.id } });
    }
    if (user) {
      await prisma.user.delete({ where: { id: user.id } });
    }
    await server?.close();
  });

  it('al confirmar una reserva Mockoon recibe reservation-confirmed con los datos de la reserva', async () => {
    const times = slot(8);
    const response = await request('POST', '/reservations', { spaceId: space.id, ...times });
    expect(response.status).toBe(201);
    const reservation = (await response.json()) as { id: string };

    const log = await waitForMockoonRequest('/notifications/reservation-confirmed', reservation.id);
    expect(log.request.method).toBe('post');
    expect(log.request.headers).toContainEqual({ key: 'content-type', value: 'application/json' });
    expect(log.response.statusCode).toBe(202);
    expect(JSON.parse(log.request.body)).toEqual({
      reservationId: reservation.id,
      spaceId: space.id,
      spaceName: space.name,
      userId: user.id,
      userEmail: user.email,
      ...times,
    });
  });

  it('al cancelar una reserva Mockoon recibe reservation-cancelled con los datos de la reserva', async () => {
    const times = slot(10);
    const created = await request('POST', '/reservations', { spaceId: space.id, ...times });
    expect(created.status).toBe(201);
    const reservation = (await created.json()) as { id: string };

    const cancelled = await request('DELETE', `/reservations/${reservation.id}`);
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ id: reservation.id, status: 'CANCELLED' });

    const log = await waitForMockoonRequest('/notifications/reservation-cancelled', reservation.id);
    expect(log.response.statusCode).toBe(202);
    expect(JSON.parse(log.request.body)).toEqual({
      reservationId: reservation.id,
      spaceId: space.id,
      spaceName: space.name,
      userId: user.id,
      userEmail: user.email,
      ...times,
    });
  });

  it('si Mockoon responde 500, la reserva se crea igual, queda CONFIRMED y el fallo solo se registra', async () => {
    env.NOTIFICATIONS_URL = `${MOCKOON_URL}/simular-500`;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request('POST', '/reservations', { spaceId: space.id, ...slot(12) });
    expect(response.status).toBe(201);
    const reservation = (await response.json()) as { id: string };

    const log = await waitForMockoonRequest('/simular-500/notifications/reservation-confirmed', reservation.id);
    expect(log.response.statusCode).toBe(500);

    // ADR 0005: el error se captura y se registra con console.error; la reserva no se revierte.
    await vi.waitFor(() => {
      const messages = consoleError.mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => m.includes(reservation.id) && m.includes('respondió 500'))).toBe(true);
    });
    const stored = await prisma.reservation.findUnique({ where: { id: reservation.id } });
    expect(stored?.status).toBe('CONFIRMED');

    // La API sigue atendiendo después del fallo.
    expect((await request('GET', '/reservations/me')).status).toBe(200);
  });

  it('si Mockoon tarda más que el timeout, la reserva responde sin esperarlo y el aviso se aborta', async () => {
    // La ruta /simular-demora tarda 3 s, más que NOTIFICATIONS_TIMEOUT_MS.
    expect(env.NOTIFICATIONS_TIMEOUT_MS).toBeLessThan(3000);
    env.NOTIFICATIONS_URL = `${MOCKOON_URL}/simular-demora`;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const started = performance.now();
    const response = await request('POST', '/reservations', { spaceId: space.id, ...slot(14) });
    const elapsedMs = performance.now() - started;

    expect(response.status).toBe(201);
    const reservation = (await response.json()) as { id: string };
    // ADR 0005: la respuesta no espera la notificación (ni los 3 s de Mockoon ni el timeout).
    expect(elapsedMs).toBeLessThan(env.NOTIFICATIONS_TIMEOUT_MS / 2);

    // Al vencer el timeout el cliente aborta y el servicio lo registra.
    await vi.waitFor(
      () => {
        const messages = consoleError.mock.calls.map((call) => String(call[0]));
        expect(messages.some((m) => m.includes(reservation.id))).toBe(true);
      },
      { timeout: env.NOTIFICATIONS_TIMEOUT_MS + 2000, interval: 100 },
    );
    const stored = await prisma.reservation.findUnique({ where: { id: reservation.id } });
    expect(stored?.status).toBe('CONFIRMED');
  });
});
