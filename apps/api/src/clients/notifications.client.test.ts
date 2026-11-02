import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import {
  notifyReservationCancelled,
  notifyReservationConfirmed,
  type ReservationNotification,
} from './notifications.client';

const payload: ReservationNotification = {
  reservationId: '55555555-5555-4555-8555-555555555555',
  spaceId: '44444444-4444-4444-8444-444444444444',
  spaceName: 'Laboratorio de Redes',
  userId: '11111111-1111-4111-8111-111111111111',
  userEmail: 'docente@reservalab.test',
  startsAt: '2026-11-04T09:00:00-06:00',
  endsAt: '2026-11-04T11:00:00-06:00',
};

// fetch falso: nunca toca la red
function stubFetch(implementation: (url: string, init: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('notifications.client', () => {
  it.each([
    ['confirmada', notifyReservationConfirmed, '/notifications/reservation-confirmed'],
    ['cancelada', notifyReservationCancelled, '/notifications/reservation-cancelled'],
  ])('reserva %s: hace POST con el JSON a la ruta correcta', async (_caso, notify, path) => {
    const fetchMock = stubFetch(async () => new Response('{}', { status: 202 }));

    await notify(payload);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${env.NOTIFICATIONS_URL}${path}`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual(payload);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('lanza si el servicio responde con un error HTTP', async () => {
    stubFetch(async () => new Response('falló', { status: 500 }));

    await expect(notifyReservationConfirmed(payload)).rejects.toThrow('respondió 500');
  });

  it('lanza si no se puede conectar', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(notifyReservationConfirmed(payload)).rejects.toThrow('fetch failed');
  });

  it('aborta si el servicio tarda más que NOTIFICATIONS_TIMEOUT_MS', async () => {
    // fetch que nunca responde, salvo que se aborte su señal
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );

    const start = Date.now();
    await expect(notifyReservationConfirmed(payload)).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(Date.now() - start).toBeGreaterThanOrEqual(env.NOTIFICATIONS_TIMEOUT_MS - 20);
  });
});
