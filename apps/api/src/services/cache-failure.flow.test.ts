import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as notificationsClient from '../clients/notifications.client';
import * as reservationRepository from '../repositories/reservation.repository';
import type { ReservationRecord } from '../repositories/reservation.repository';
import * as spaceRepository from '../repositories/space.repository';
import type { SpaceRecord } from '../repositories/space.repository';
import type { AuthUser } from '../types/express';
import { getAvailability } from './availability.service';
import { getNow } from './now.service';
import * as reservationService from './reservation.service';
import * as spaceService from './space.service';

// Flujo completo con la caché REAL (lib/cache.ts) sobre un cliente de Redis que lanza en cada comando:
// comprueba que el fail-open llega hasta los servicios. Los repositorios están mockeados y responden
// como la base; si la caché dejara escapar el error, estas pruebas fallarían.
vi.mock('../lib/redis', () => {
  const fail = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
  const multi = () => {
    const chain = { set: () => chain, sAdd: () => chain, expire: () => chain, exec: fail };
    return chain;
  };
  return {
    // Conectado según el cliente, pero cada comando falla (por ejemplo, la conexión se cae a mitad)
    redis: { isReady: true, get: vi.fn(fail), del: vi.fn(fail), incr: vi.fn(fail), sMembers: fail, multi },
    assertRedisReady: () => {},
  };
});
vi.mock('../repositories/space.repository', () => ({
  listSpaces: vi.fn(),
  findSpaceById: vi.fn(),
  createSpace: vi.fn(),
  updateSpace: vi.fn(),
  hasActiveConfirmedReservations: vi.fn(),
  deleteSpace: vi.fn(),
}));
vi.mock('../repositories/reservation.repository', () => ({
  findConfirmedReservationsInRange: vi.fn(),
  findConfirmedReservationsOfAllSpaces: vi.fn(),
  createReservation: vi.fn(),
  findReservationById: vi.fn(),
  cancelReservation: vi.fn(),
}));
vi.mock('../clients/notifications.client', () => ({
  notifyReservationConfirmed: vi.fn(),
  notifyReservationCancelled: vi.fn(),
}));

const spaces = vi.mocked(spaceRepository);
const reservations = vi.mocked(reservationRepository);
const notifications = vi.mocked(notificationsClient);

const SPACE_ID = '44444444-4444-4444-8444-444444444444';
const DOCENTE: AuthUser = { id: '11111111-1111-4111-8111-111111111111', role: 'DOCENTE' };
const NOW = new Date('2026-11-02T12:00:00-06:00');

const space: SpaceRecord = {
  id: SPACE_ID,
  name: 'Laboratorio de Redes',
  building: 'Edificio A',
  capacity: 30,
  createdAt: new Date('2026-11-01T12:00:00Z'),
};

const reservation: ReservationRecord = {
  id: '55555555-5555-4555-8555-555555555555',
  spaceId: SPACE_ID,
  userId: DOCENTE.id,
  startsAt: new Date('2026-11-04T09:00:00-06:00'),
  endsAt: new Date('2026-11-04T11:00:00-06:00'),
  status: 'CONFIRMED',
  createdAt: new Date('2026-11-02T18:00:00Z'),
  space: { id: SPACE_ID, name: 'Laboratorio de Redes', building: 'Edificio A' },
  user: { id: DOCENTE.id, email: 'docente@reservalab.test' },
};

let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  notifications.notifyReservationConfirmed.mockResolvedValue(undefined);
  notifications.notifyReservationCancelled.mockResolvedValue(undefined);
  spaces.findSpaceById.mockResolvedValue(space);
});

afterEach(() => {
  consoleWarn.mockRestore();
});

describe('si Redis lanza en cada comando, los servicios responden con datos de la base', () => {
  it('GET /spaces: MISS con el listado del repositorio', async () => {
    spaces.listSpaces.mockResolvedValue([space]);

    const result = await spaceService.listSpaces({});

    expect(result).toMatchObject({ cache: 'MISS', data: [{ id: SPACE_ID, name: 'Laboratorio de Redes' }] });
    expect(spaces.listSpaces).toHaveBeenCalledOnce();
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('[cache]'));
  });

  it('disponibilidad: MISS en cada consulta, siempre desde la base', async () => {
    reservations.findConfirmedReservationsInRange.mockResolvedValue([
      { startsAt: reservation.startsAt, endsAt: reservation.endsAt },
    ]);

    const first = await getAvailability(SPACE_ID, '2026-11-04');
    const second = await getAvailability(SPACE_ID, '2026-11-04');

    expect([first.cache, second.cache]).toEqual(['MISS', 'MISS']);
    expect(first.data.occupied).toEqual([
      { startsAt: '2026-11-04T09:00:00-06:00', endsAt: '2026-11-04T11:00:00-06:00' },
    ]);
    expect(reservations.findConfirmedReservationsInRange).toHaveBeenCalledTimes(2);
  });

  it('GET /now: MISS con el estado calculado desde la base', async () => {
    spaces.listSpaces.mockResolvedValue([space]);
    reservations.findConfirmedReservationsOfAllSpaces.mockResolvedValue([]);

    const result = await getNow(NOW);

    expect(result).toMatchObject({ cache: 'MISS', data: { spaces: [{ id: SPACE_ID, status: 'FREE' }] } });
  });

  it('crear y cancelar una reserva funcionan aunque la invalidación falle', async () => {
    reservations.findConfirmedReservationsInRange.mockResolvedValue([]);
    reservations.createReservation.mockResolvedValue({ status: 'CREATED', reservation });
    reservations.findReservationById.mockResolvedValue(reservation);
    reservations.cancelReservation.mockResolvedValue({ ...reservation, status: 'CANCELLED' });

    await expect(
      reservationService.createReservation(
        DOCENTE,
        { spaceId: SPACE_ID, startsAt: '2026-11-04T09:00:00-06:00', endsAt: '2026-11-04T11:00:00-06:00' },
        NOW,
      ),
    ).resolves.toMatchObject({ status: 'CONFIRMED' });
    await expect(reservationService.cancelReservation(DOCENTE, reservation.id)).resolves.toMatchObject({
      status: 'CANCELLED',
    });
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining(`DEL availability:${SPACE_ID}:2026-11-04 now`));
  });

  it('crear, editar y borrar un espacio funcionan aunque la invalidación falle', async () => {
    spaces.createSpace.mockResolvedValue(space);
    spaces.updateSpace.mockResolvedValue({ ...space, capacity: 40 });
    spaces.hasActiveConfirmedReservations.mockResolvedValue(false);
    spaces.deleteSpace.mockResolvedValue('DELETED');

    await expect(
      spaceService.createSpace({ name: 'Laboratorio de Redes', building: 'Edificio A', capacity: 30 }),
    ).resolves.toMatchObject({ id: SPACE_ID });
    await expect(spaceService.updateSpace(SPACE_ID, { capacity: 40 })).resolves.toMatchObject({ capacity: 40 });
    await expect(spaceService.deleteSpace(SPACE_ID, NOW)).resolves.toBeUndefined();
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('INCR versión spaces'));
  });
});
