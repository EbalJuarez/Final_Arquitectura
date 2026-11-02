import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeCache, fakeCacheModule } from '../../test/fake-cache';
import * as notificationsClient from '../clients/notifications.client';
import { AppError } from '../errors/app-error';
import * as reservationRepository from '../repositories/reservation.repository';
import type { ReservationRecord } from '../repositories/reservation.repository';
import * as spaceRepository from '../repositories/space.repository';
import type { AuthUser } from '../types/express';
import * as reservationService from './reservation.service';

// Repositorios y cliente de notificaciones mockeados: estas pruebas no tocan la base ni la red.
vi.mock('../repositories/reservation.repository', () => ({
  findConfirmedReservationsInRange: vi.fn(),
  createReservation: vi.fn(),
  findReservationById: vi.fn(),
  listReservationsByUser: vi.fn(),
  cancelReservation: vi.fn(),
}));
vi.mock('../repositories/space.repository', () => ({ findSpaceById: vi.fn() }));
vi.mock('../clients/notifications.client', () => ({
  notifyReservationConfirmed: vi.fn(),
  notifyReservationCancelled: vi.fn(),
}));
// Caché en memoria
vi.mock('../lib/cache', async () => (await import('../../test/fake-cache')).fakeCacheModule);

const reservations = vi.mocked(reservationRepository);
const spaces = vi.mocked(spaceRepository);
const notifications = vi.mocked(notificationsClient);

const SPACE_ID = '44444444-4444-4444-8444-444444444444';
const RESERVATION_ID = '55555555-5555-4555-8555-555555555555';
const DOCENTE: AuthUser = { id: '11111111-1111-4111-8111-111111111111', role: 'DOCENTE' };
const OTRO_DOCENTE: AuthUser = { id: '22222222-2222-4222-8222-222222222222', role: 'DOCENTE' };
const ADMIN: AuthUser = { id: '33333333-3333-4333-8333-333333333333', role: 'ADMIN' };
// Lunes 2026-11-02 a las 12:00 en Guatemala
const NOW = new Date('2026-11-02T12:00:00-06:00');

function makeReservation(overrides: Partial<ReservationRecord> = {}): ReservationRecord {
  return {
    id: RESERVATION_ID,
    spaceId: SPACE_ID,
    userId: DOCENTE.id,
    startsAt: new Date('2026-11-04T09:00:00-06:00'),
    endsAt: new Date('2026-11-04T11:00:00-06:00'),
    status: 'CONFIRMED',
    createdAt: new Date('2026-11-02T18:00:00.000Z'),
    space: { id: SPACE_ID, name: 'Laboratorio de Redes', building: 'Edificio A' },
    user: { id: DOCENTE.id, email: 'docente@reservalab.test' },
    ...overrides,
  };
}

const input = {
  spaceId: SPACE_ID,
  startsAt: '2026-11-04T09:00:00-06:00',
  endsAt: '2026-11-04T11:00:00-06:00',
};

async function expectAppError(promise: Promise<unknown>, statusCode: number, code: string): Promise<void> {
  const error = await promise.then(
    () => expect.unreachable('se esperaba un AppError'),
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ statusCode, code });
}

function expectTimesError(startsAt: string, endsAt: string, code: string): void {
  expect(() => reservationService.validateReservationTimes(new Date(startsAt), new Date(endsAt), NOW)).toThrow(
    expect.objectContaining({ statusCode: 400, code }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeCache.reset();
  spaces.findSpaceById.mockResolvedValue({
    id: SPACE_ID,
    name: 'Laboratorio de Redes',
    building: 'Edificio A',
    capacity: 30,
    createdAt: new Date(),
  });
  reservations.findConfirmedReservationsInRange.mockResolvedValue([]);
  notifications.notifyReservationConfirmed.mockResolvedValue(undefined);
  notifications.notifyReservationCancelled.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateReservationTimes', () => {
  it('acepta una reserva válida y las que tocan exactamente la apertura y el cierre', () => {
    const validate = (s: string, e: string) =>
      reservationService.validateReservationTimes(new Date(s), new Date(e), NOW);

    expect(() => validate('2026-11-04T09:00:00-06:00', '2026-11-04T11:00:00-06:00')).not.toThrow();
    expect(() => validate('2026-11-04T07:00:00-06:00', '2026-11-04T08:00:00-06:00')).not.toThrow();
    expect(() => validate('2026-11-04T20:00:00-06:00', '2026-11-04T21:00:00-06:00')).not.toThrow();
  });

  it('rechaza endsAt igual o anterior a startsAt', () => {
    expectTimesError('2026-11-04T10:00:00-06:00', '2026-11-04T10:00:00-06:00', 'INVALID_TIME_RANGE');
    expectTimesError('2026-11-04T11:00:00-06:00', '2026-11-04T10:00:00-06:00', 'INVALID_TIME_RANGE');
  });

  it('rechaza reservas en el pasado', () => {
    expectTimesError('2026-11-02T11:00:00-06:00', '2026-11-02T13:00:00-06:00', 'RESERVATION_IN_PAST');
  });

  it('rechaza reservas fuera de la ventana de operación', () => {
    expectTimesError('2026-11-04T06:30:00-06:00', '2026-11-04T08:00:00-06:00', 'OUTSIDE_OPERATING_HOURS');
    expectTimesError('2026-11-04T20:00:00-06:00', '2026-11-04T21:30:00-06:00', 'OUTSIDE_OPERATING_HOURS');
  });

  it('rechaza reservas que cruzan al día siguiente', () => {
    expectTimesError('2026-11-04T20:00:00-06:00', '2026-11-05T08:00:00-06:00', 'OUTSIDE_OPERATING_HOURS');
  });

  it('usa el día de Guatemala aunque la hora llegue en UTC', () => {
    // 2026-11-05T02:00Z es 2026-11-04 a las 20:00 en Guatemala: dentro de la ventana de ese día
    expect(() =>
      reservationService.validateReservationTimes(
        new Date('2026-11-05T02:00:00Z'),
        new Date('2026-11-05T03:00:00Z'),
        NOW,
      ),
    ).not.toThrow();
    // 2026-11-04T12:00Z es 2026-11-04 a las 06:00 en Guatemala: antes de abrir
    expectTimesError('2026-11-04T12:00:00Z', '2026-11-04T14:00:00Z', 'OUTSIDE_OPERATING_HOURS');
  });
});

describe('createReservation', () => {
  it('guarda la reserva a nombre del usuario, notifica y responde en hora de Guatemala', async () => {
    reservations.createReservation.mockResolvedValue({ status: 'CREATED', reservation: makeReservation() });

    const result = await reservationService.createReservation(DOCENTE, input, NOW);

    expect(reservations.createReservation).toHaveBeenCalledWith({
      spaceId: SPACE_ID,
      userId: DOCENTE.id,
      startsAt: new Date('2026-11-04T15:00:00Z'),
      endsAt: new Date('2026-11-04T17:00:00Z'),
    });
    expect(result).toMatchObject({
      id: RESERVATION_ID,
      startsAt: '2026-11-04T09:00:00-06:00',
      endsAt: '2026-11-04T11:00:00-06:00',
      status: 'CONFIRMED',
    });
    expect(notifications.notifyReservationConfirmed).toHaveBeenCalledWith({
      reservationId: RESERVATION_ID,
      spaceId: SPACE_ID,
      spaceName: 'Laboratorio de Redes',
      userId: DOCENTE.id,
      userEmail: 'docente@reservalab.test',
      startsAt: '2026-11-04T09:00:00-06:00',
      endsAt: '2026-11-04T11:00:00-06:00',
    });
  });

  it('valida los horarios antes de consultar la base', async () => {
    await expectAppError(
      reservationService.createReservation(DOCENTE, { ...input, endsAt: input.startsAt }, NOW),
      400,
      'INVALID_TIME_RANGE',
    );
    expect(spaces.findSpaceById).not.toHaveBeenCalled();
    expect(reservations.createReservation).not.toHaveBeenCalled();
  });

  it('responde 404 si el espacio no existe', async () => {
    spaces.findSpaceById.mockResolvedValue(null);

    await expectAppError(reservationService.createReservation(DOCENTE, input, NOW), 404, 'SPACE_NOT_FOUND');
    expect(reservations.createReservation).not.toHaveBeenCalled();
  });

  it('responde 409 si el servicio detecta un traslape, sin insertar ni notificar', async () => {
    reservations.findConfirmedReservationsInRange.mockResolvedValue([
      { startsAt: new Date('2026-11-04T10:00:00-06:00'), endsAt: new Date('2026-11-04T12:00:00-06:00') },
    ]);

    await expectAppError(reservationService.createReservation(DOCENTE, input, NOW), 409, 'RESERVATION_OVERLAP');
    expect(reservations.findConfirmedReservationsInRange).toHaveBeenCalledWith(
      SPACE_ID,
      new Date('2026-11-04T15:00:00Z'),
      new Date('2026-11-04T17:00:00Z'),
    );
    expect(reservations.createReservation).not.toHaveBeenCalled();
    expect(notifications.notifyReservationConfirmed).not.toHaveBeenCalled();
  });

  it('responde el mismo 409 si la base rechaza el traslape (carrera entre solicitudes)', async () => {
    reservations.createReservation.mockResolvedValue({ status: 'OVERLAP' });

    await expectAppError(reservationService.createReservation(DOCENTE, input, NOW), 409, 'RESERVATION_OVERLAP');
    expect(notifications.notifyReservationConfirmed).not.toHaveBeenCalled();
  });

  it('si la notificación falla, registra el error y la reserva se mantiene', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    reservations.createReservation.mockResolvedValue({ status: 'CREATED', reservation: makeReservation() });
    notifications.notifyReservationConfirmed.mockRejectedValue(new Error('fetch failed'));

    const result = await reservationService.createReservation(DOCENTE, input, NOW);

    expect(result.status).toBe('CONFIRMED');
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(`reserva ${RESERVATION_ID}: fetch failed`)),
    );
  });

  it('no espera a la notificación: responde aunque el servicio nunca conteste', async () => {
    reservations.createReservation.mockResolvedValue({ status: 'CREATED', reservation: makeReservation() });
    notifications.notifyReservationConfirmed.mockReturnValue(new Promise(() => {}));

    await expect(reservationService.createReservation(DOCENTE, input, NOW)).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
  });
});

describe('listMyReservations', () => {
  it('devuelve solo las reservas del usuario', async () => {
    reservations.listReservationsByUser.mockResolvedValue([makeReservation()]);

    const result = await reservationService.listMyReservations(DOCENTE.id);

    expect(reservations.listReservationsByUser).toHaveBeenCalledWith(DOCENTE.id);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: RESERVATION_ID, space: { name: 'Laboratorio de Redes' } });
  });
});

describe('cancelReservation', () => {
  it('responde 404 si la reserva no existe', async () => {
    reservations.findReservationById.mockResolvedValue(null);

    await expectAppError(reservationService.cancelReservation(DOCENTE, RESERVATION_ID), 404, 'RESERVATION_NOT_FOUND');
  });

  it('responde 403 si no es el dueño ni ADMIN', async () => {
    reservations.findReservationById.mockResolvedValue(makeReservation());

    await expectAppError(reservationService.cancelReservation(OTRO_DOCENTE, RESERVATION_ID), 403, 'FORBIDDEN');
    expect(reservations.cancelReservation).not.toHaveBeenCalled();
  });

  it.each([
    ['el dueño', DOCENTE],
    ['un ADMIN', ADMIN],
  ])('%s puede cancelarla: pasa a CANCELLED y se notifica', async (_quien, user) => {
    reservations.findReservationById.mockResolvedValue(makeReservation());
    reservations.cancelReservation.mockResolvedValue(makeReservation({ status: 'CANCELLED' }));

    const result = await reservationService.cancelReservation(user, RESERVATION_ID);

    expect(reservations.cancelReservation).toHaveBeenCalledWith(RESERVATION_ID);
    expect(result.status).toBe('CANCELLED');
    expect(notifications.notifyReservationCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: RESERVATION_ID }),
    );
  });

  it('responde 409 si ya estaba cancelada', async () => {
    reservations.findReservationById.mockResolvedValue(makeReservation({ status: 'CANCELLED' }));

    await expectAppError(
      reservationService.cancelReservation(DOCENTE, RESERVATION_ID),
      409,
      'RESERVATION_ALREADY_CANCELLED',
    );
    expect(reservations.cancelReservation).not.toHaveBeenCalled();
  });

  it('responde 409 si otra solicitud la canceló al mismo tiempo', async () => {
    reservations.findReservationById.mockResolvedValue(makeReservation());
    reservations.cancelReservation.mockResolvedValue(null);

    await expectAppError(
      reservationService.cancelReservation(DOCENTE, RESERVATION_ID),
      409,
      'RESERVATION_ALREADY_CANCELLED',
    );
    expect(notifications.notifyReservationCancelled).not.toHaveBeenCalled();
  });

  it('si la notificación de cancelación falla, la cancelación se mantiene', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    reservations.findReservationById.mockResolvedValue(makeReservation());
    reservations.cancelReservation.mockResolvedValue(makeReservation({ status: 'CANCELLED' }));
    notifications.notifyReservationCancelled.mockRejectedValue(new Error('timeout'));

    const result = await reservationService.cancelReservation(DOCENTE, RESERVATION_ID);

    expect(result.status).toBe('CANCELLED');
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('cancelled')));
  });
});

describe('invalidación de caché', () => {
  // La reserva de prueba es el 2026-11-04 de 9 a 11 en Guatemala
  const AVAILABILITY_KEY = `availability:${SPACE_ID}:2026-11-04`;

  beforeEach(() => {
    fakeCache.store.set(AVAILABILITY_KEY, { cacheada: true });
    fakeCache.store.set(`availability:${SPACE_ID}:2026-11-05`, { cacheada: true });
    fakeCache.store.set('now', { cacheada: true });
  });

  it('al crear borra la disponibilidad de ese espacio y fecha, y /now; no toca otras fechas', async () => {
    reservations.createReservation.mockResolvedValue({ status: 'CREATED', reservation: makeReservation() });

    await reservationService.createReservation(DOCENTE, input, NOW);

    expect([...fakeCache.store.keys()]).toEqual([`availability:${SPACE_ID}:2026-11-05`]);
  });

  it('invalida después de guardar en la base, no antes', async () => {
    reservations.createReservation.mockResolvedValue({ status: 'CREATED', reservation: makeReservation() });

    await reservationService.createReservation(DOCENTE, input, NOW);

    const saved = reservations.createReservation.mock.invocationCallOrder[0]!;
    const invalidated = fakeCacheModule.del.mock.invocationCallOrder[0]!;
    expect(invalidated).toBeGreaterThan(saved);
  });

  it('usa la fecha de Guatemala: una reserva de 19:00 a 20:30 el día 4 es el 5 en UTC', async () => {
    const evening = makeReservation({
      startsAt: new Date('2026-11-04T19:00:00-06:00'),
      endsAt: new Date('2026-11-04T20:30:00-06:00'),
    });
    reservations.createReservation.mockResolvedValue({ status: 'CREATED', reservation: evening });

    await reservationService.createReservation(
      DOCENTE,
      { spaceId: SPACE_ID, startsAt: '2026-11-04T19:00:00-06:00', endsAt: '2026-11-04T20:30:00-06:00' },
      NOW,
    );

    expect(fakeCacheModule.del).toHaveBeenCalledWith(AVAILABILITY_KEY, 'now');
  });

  it('si la creación falla (traslape) no invalida nada', async () => {
    reservations.createReservation.mockResolvedValue({ status: 'OVERLAP' });

    await expectAppError(reservationService.createReservation(DOCENTE, input, NOW), 409, 'RESERVATION_OVERLAP');
    expect(fakeCacheModule.del).not.toHaveBeenCalled();
    expect(fakeCache.store.size).toBe(3);
  });

  it('al cancelar borra la disponibilidad de ese espacio y fecha, y /now', async () => {
    reservations.findReservationById.mockResolvedValue(makeReservation());
    reservations.cancelReservation.mockResolvedValue(makeReservation({ status: 'CANCELLED' }));

    await reservationService.cancelReservation(DOCENTE, RESERVATION_ID);

    expect([...fakeCache.store.keys()]).toEqual([`availability:${SPACE_ID}:2026-11-05`]);
  });

  it('si la cancelación falla (ya cancelada) no invalida nada', async () => {
    reservations.findReservationById.mockResolvedValue(makeReservation({ status: 'CANCELLED' }));

    await expectAppError(
      reservationService.cancelReservation(DOCENTE, RESERVATION_ID),
      409,
      'RESERVATION_ALREADY_CANCELLED',
    );
    expect(fakeCacheModule.del).not.toHaveBeenCalled();
  });

  it('con Redis caído la reserva se crea igual', async () => {
    fakeCache.goDown();
    reservations.createReservation.mockResolvedValue({ status: 'CREATED', reservation: makeReservation() });

    await expect(reservationService.createReservation(DOCENTE, input, NOW)).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
  });
});
