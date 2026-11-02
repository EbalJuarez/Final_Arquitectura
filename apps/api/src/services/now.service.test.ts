import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeCache } from '../../test/fake-cache';
import * as reservationRepository from '../repositories/reservation.repository';
import type { SpaceReservationInterval } from '../repositories/reservation.repository';
import * as spaceRepository from '../repositories/space.repository';
import type { SpaceRecord } from '../repositories/space.repository';
import { buildNowResponse, computeSpaceStatus, getBusinessDay, getNow } from './now.service';

// Repositorios mockeados: estas pruebas no tocan la base de datos.
vi.mock('../repositories/space.repository', () => ({ listSpaces: vi.fn() }));
vi.mock('../repositories/reservation.repository', () => ({ findConfirmedReservationsOfAllSpaces: vi.fn() }));
// Caché en memoria
vi.mock('../lib/cache', async () => (await import('../../test/fake-cache')).fakeCacheModule);

const spaces = vi.mocked(spaceRepository);
const reservations = vi.mocked(reservationRepository);

const SPACE_A = '44444444-4444-4444-8444-44444444444a';
const SPACE_B = '44444444-4444-4444-8444-44444444444b';

// Hora local de Guatemala (UTC-6) del 10 de noviembre de 2026
const at = (time: string) => new Date(`2026-11-10T${time}:00-06:00`);
const block = (start: string, end: string) => ({ start: at(start), end: at(end) });
// Fin del 10 de noviembre en Guatemala
const DAY_END = new Date('2026-11-11T00:00:00-06:00');

function status(list: { start: Date; end: Date }[], now: string) {
  return computeSpaceStatus(list, at(now), DAY_END);
}

function makeSpace(id: string, name: string): SpaceRecord {
  return { id, name, building: 'Edificio A', capacity: 30, createdAt: new Date('2026-11-01T12:00:00Z') };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeCache.reset();
});

describe('getBusinessDay', () => {
  it('devuelve el día completo en hora de Guatemala', () => {
    expect(getBusinessDay(at('10:00'))).toEqual({
      start: new Date('2026-11-10T06:00:00Z'),
      end: new Date('2026-11-11T06:00:00Z'),
    });
  });

  it('a las 21:30 en Guatemala sigue siendo el mismo día, aunque en UTC ya sea el siguiente', () => {
    const now = new Date('2026-11-11T03:30:00Z');

    expect(getBusinessDay(now).start).toEqual(new Date('2026-11-10T06:00:00Z'));
  });

  it('a las 00:00 en punto empieza el día nuevo', () => {
    expect(getBusinessDay(new Date('2026-11-11T06:00:00Z')).start).toEqual(new Date('2026-11-11T06:00:00Z'));
  });
});

describe('computeSpaceStatus', () => {
  it('sin reservas: libre y sin siguiente', () => {
    expect(status([], '10:00')).toEqual({ occupiedUntil: null, next: null });
  });

  it('con una reserva en curso: ocupado hasta su fin', () => {
    expect(status([block('09:00', '11:00')], '10:00')).toEqual({ occupiedUntil: at('11:00'), next: null });
  });

  it('libre con una reserva más tarde: la devuelve como siguiente', () => {
    expect(status([block('14:00', '15:00')], '10:00')).toEqual({ occupiedUntil: null, next: block('14:00', '15:00') });
  });

  it('ocupado y con otra reserva después de un hueco: la siguiente es la posterior', () => {
    const result = status([block('14:00', '15:00'), block('09:00', '11:00')], '10:00');

    expect(result).toEqual({ occupiedUntil: at('11:00'), next: block('14:00', '15:00') });
  });

  it('en el inicio exacto de una reserva ya está ocupado', () => {
    expect(status([block('10:00', '11:00')], '10:00')).toEqual({ occupiedUntil: at('11:00'), next: null });
  });

  it('en el fin exacto de una reserva ya está libre', () => {
    expect(status([block('09:00', '10:00')], '10:00')).toEqual({ occupiedUntil: null, next: null });
  });

  it('un instante antes del inicio sigue libre y esa reserva es la siguiente', () => {
    const now = new Date(at('10:00').getTime() - 1);

    expect(computeSpaceStatus([block('10:00', '11:00')], now, DAY_END)).toEqual({
      occupiedUntil: null,
      next: block('10:00', '11:00'),
    });
  });

  it('con reservas seguidas sin hueco se libera al final de la última', () => {
    const result = status([block('09:00', '10:30'), block('10:30', '12:00'), block('13:00', '14:00')], '10:00');

    expect(result).toEqual({ occupiedUntil: at('12:00'), next: block('13:00', '14:00') });
  });

  it('ignora las reservas que ya terminaron', () => {
    expect(status([block('07:00', '08:00'), block('08:00', '09:00')], '10:00')).toEqual({
      occupiedUntil: null,
      next: null,
    });
  });

  it('la siguiente reserva debe ser del mismo día', () => {
    const tomorrow = { start: DAY_END, end: new Date(DAY_END.getTime() + 60 * 60_000) };

    expect(status([tomorrow], '20:00')).toEqual({ occupiedUntil: null, next: null });
  });
});

describe('buildNowResponse', () => {
  const reservationsOf = (spaceId: string, start: string, end: string): SpaceReservationInterval => ({
    spaceId,
    startsAt: at(start),
    endsAt: at(end),
  });

  it('arma el estado de cada espacio con las horas en -06:00', () => {
    const response = buildNowResponse(
      [makeSpace(SPACE_A, 'Laboratorio de Redes'), makeSpace(SPACE_B, 'Salón 101')],
      [reservationsOf(SPACE_A, '09:00', '11:00'), reservationsOf(SPACE_B, '15:00', '16:30')],
      at('10:15'),
    );

    expect(response).toEqual({
      now: '2026-11-10T10:15:00-06:00',
      timezone: 'America/Guatemala',
      spaces: [
        {
          id: SPACE_A,
          name: 'Laboratorio de Redes',
          building: 'Edificio A',
          capacity: 30,
          status: 'OCCUPIED',
          occupiedUntil: '2026-11-10T11:00:00-06:00',
          nextReservation: null,
        },
        {
          id: SPACE_B,
          name: 'Salón 101',
          building: 'Edificio A',
          capacity: 30,
          status: 'FREE',
          occupiedUntil: null,
          nextReservation: { startsAt: '2026-11-10T15:00:00-06:00', endsAt: '2026-11-10T16:30:00-06:00' },
        },
      ],
    });
  });

  it('no mezcla las reservas de un espacio con las de otro', () => {
    const response = buildNowResponse(
      [makeSpace(SPACE_A, 'A'), makeSpace(SPACE_B, 'B')],
      [reservationsOf(SPACE_B, '10:00', '11:00')],
      at('10:30'),
    );

    expect(response.spaces.map((space) => space.status)).toEqual(['FREE', 'OCCUPIED']);
  });

  it('sin espacios devuelve una lista vacía', () => {
    expect(buildNowResponse([], [], at('10:00')).spaces).toEqual([]);
  });
});

describe('getNow', () => {
  it('pide las reservas desde ahora hasta el fin del día en Guatemala', async () => {
    spaces.listSpaces.mockResolvedValue([makeSpace(SPACE_A, 'A')]);
    reservations.findConfirmedReservationsOfAllSpaces.mockResolvedValue([]);
    const now = new Date('2026-11-11T03:30:00Z'); // 21:30 del 10 de noviembre en Guatemala

    const response = await getNow(now);

    expect(spaces.listSpaces).toHaveBeenCalledWith({});
    expect(reservations.findConfirmedReservationsOfAllSpaces).toHaveBeenCalledWith(
      now,
      new Date('2026-11-11T06:00:00Z'),
    );
    expect(response).toMatchObject({ cache: 'MISS', data: { now: '2026-11-10T21:30:00-06:00' } });
  });

  it('se cachea en una sola clave: la segunda consulta es HIT', async () => {
    spaces.listSpaces.mockResolvedValue([makeSpace(SPACE_A, 'A')]);
    reservations.findConfirmedReservationsOfAllSpaces.mockResolvedValue([]);

    const first = await getNow(at('10:00'));
    const second = await getNow(at('10:00'));

    expect(second).toEqual({ data: first.data, cache: 'HIT' });
    expect([...fakeCache.store.keys()]).toEqual(['now']);
    expect(spaces.listSpaces).toHaveBeenCalledOnce();
  });
});
