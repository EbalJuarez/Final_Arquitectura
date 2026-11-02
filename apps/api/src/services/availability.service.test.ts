import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error';
import * as reservationRepository from '../repositories/reservation.repository';
import * as spaceRepository from '../repositories/space.repository';
import {
  clipToWindow,
  computeFreeBlocks,
  getAvailability,
  getDayWindow,
  toOffsetIso,
  type Interval,
} from './availability.service';

// Repositorios mockeados: estas pruebas no tocan la base de datos.
vi.mock('../repositories/space.repository', () => ({ findSpaceById: vi.fn() }));
vi.mock('../repositories/reservation.repository', () => ({ findConfirmedReservationsInRange: vi.fn() }));

const spaces = vi.mocked(spaceRepository);
const reservations = vi.mocked(reservationRepository);

const GT = -6 * 60;

// Intervalo en hora de Guatemala: gt('09:00', '11:00') el 2026-11-03
function gt(start: string, end: string, date = '2026-11-03'): Interval {
  return { start: new Date(`${date}T${start}:00-06:00`), end: new Date(`${date}T${end}:00-06:00`) };
}

const WINDOW = gt('07:00', '21:00');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getDayWindow', () => {
  it('interpreta el día en hora de Guatemala, no en UTC', () => {
    const window = getDayWindow('2026-11-03', 7, 21, GT);

    expect(window.start.toISOString()).toBe('2026-11-03T13:00:00.000Z');
    // 21:00 en Guatemala ya es el día siguiente en UTC
    expect(window.end.toISOString()).toBe('2026-11-04T03:00:00.000Z');
  });

  it('admite cierre a las 24 (medianoche del día siguiente)', () => {
    const window = getDayWindow('2026-11-03', 0, 24, GT);

    expect(window.start.toISOString()).toBe('2026-11-03T06:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-11-04T06:00:00.000Z');
  });

  it('funciona en cambios de mes y años bisiestos', () => {
    expect(getDayWindow('2028-02-29', 7, 21, GT).start.toISOString()).toBe('2028-02-29T13:00:00.000Z');
    expect(getDayWindow('2026-12-31', 7, 21, GT).end.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });
});

describe('clipToWindow', () => {
  it('recorta a la ventana, descarta lo que queda fuera y ordena', () => {
    const clipped = clipToWindow(WINDOW, [
      gt('20:00', '23:00'),
      gt('05:00', '06:00'),
      gt('06:00', '07:30'),
      gt('22:00', '23:00'),
    ]);

    expect(clipped).toEqual([gt('07:00', '07:30'), gt('20:00', '21:00')]);
  });
});

describe('computeFreeBlocks', () => {
  it('sin reservas, toda la ventana está libre', () => {
    expect(computeFreeBlocks(WINDOW, [])).toEqual([WINDOW]);
  });

  it('con un solo bloque ocupado deja libre lo de antes y lo de después', () => {
    expect(computeFreeBlocks(WINDOW, [gt('10:00', '12:00')])).toEqual([gt('07:00', '10:00'), gt('12:00', '21:00')]);
  });

  it('devuelve los huecos entre reservas', () => {
    expect(computeFreeBlocks(WINDOW, [gt('09:00', '11:00'), gt('14:00', '15:30')])).toEqual([
      gt('07:00', '09:00'),
      gt('11:00', '14:00'),
      gt('15:30', '21:00'),
    ]);
  });

  it('no crea bloques libres de duración cero entre reservas contiguas', () => {
    expect(computeFreeBlocks(WINDOW, [gt('09:00', '11:00'), gt('11:00', '12:30')])).toEqual([
      gt('07:00', '09:00'),
      gt('12:30', '21:00'),
    ]);
  });

  it('no deja bloque libre si las reservas tocan la apertura y el cierre', () => {
    expect(computeFreeBlocks(WINDOW, [gt('07:00', '10:00'), gt('18:00', '21:00')])).toEqual([
      gt('10:00', '18:00'),
    ]);
  });

  it('tolera reservas desordenadas, traslapadas o fuera de la ventana', () => {
    const free = computeFreeBlocks(WINDOW, [
      gt('15:00', '16:00'),
      gt('06:00', '08:00'),
      gt('09:00', '12:00'),
      gt('10:00', '11:00'),
      gt('20:30', '23:00'),
      gt('05:00', '06:30', '2026-11-04'),
    ]);

    expect(free).toEqual([gt('08:00', '09:00'), gt('12:00', '15:00'), gt('16:00', '20:30')]);
  });

  it('si una reserva cubre toda la ventana no hay bloques libres', () => {
    expect(computeFreeBlocks(WINDOW, [gt('06:00', '22:00')])).toEqual([]);
  });

  it('libres y ocupados juntos cubren exactamente la ventana', () => {
    const occupied = clipToWindow(WINDOW, [gt('08:15', '09:45'), gt('13:00', '17:20')]);
    const free = computeFreeBlocks(WINDOW, occupied);
    const total = [...occupied, ...free].reduce((ms, b) => ms + (b.end.getTime() - b.start.getTime()), 0);

    expect(total).toBe(WINDOW.end.getTime() - WINDOW.start.getTime());
  });
});

describe('toOffsetIso', () => {
  it('formatea en hora local con el desfase', () => {
    expect(toOffsetIso(new Date('2026-11-04T03:00:00Z'), GT)).toBe('2026-11-03T21:00:00-06:00');
    expect(toOffsetIso(new Date('2026-11-03T13:30:00Z'), 0)).toBe('2026-11-03T13:30:00+00:00');
    expect(toOffsetIso(new Date('2026-11-03T13:30:00Z'), 330)).toBe('2026-11-03T19:00:00+05:30');
  });
});

describe('getAvailability', () => {
  const SPACE_ID = '44444444-4444-4444-8444-444444444444';

  it('consulta la ventana del día en Guatemala y arma ocupados y libres', async () => {
    spaces.findSpaceById.mockResolvedValue({
      id: SPACE_ID,
      name: 'Laboratorio',
      building: 'A',
      capacity: 30,
      createdAt: new Date(),
    });
    reservations.findConfirmedReservationsInRange.mockResolvedValue([
      { startsAt: gt('06:00', '07:30').start, endsAt: gt('06:00', '07:30').end },
      { startsAt: gt('09:00', '11:00').start, endsAt: gt('09:00', '11:00').end },
    ]);

    const result = await getAvailability(SPACE_ID, '2026-11-03');

    expect(reservations.findConfirmedReservationsInRange).toHaveBeenCalledWith(SPACE_ID, WINDOW.start, WINDOW.end);
    expect(result).toEqual({
      spaceId: SPACE_ID,
      date: '2026-11-03',
      timezone: 'America/Guatemala',
      window: { startsAt: '2026-11-03T07:00:00-06:00', endsAt: '2026-11-03T21:00:00-06:00' },
      occupied: [
        { startsAt: '2026-11-03T07:00:00-06:00', endsAt: '2026-11-03T07:30:00-06:00' },
        { startsAt: '2026-11-03T09:00:00-06:00', endsAt: '2026-11-03T11:00:00-06:00' },
      ],
      free: [
        { startsAt: '2026-11-03T07:30:00-06:00', endsAt: '2026-11-03T09:00:00-06:00' },
        { startsAt: '2026-11-03T11:00:00-06:00', endsAt: '2026-11-03T21:00:00-06:00' },
      ],
    });
  });

  it('responde 404 si el espacio no existe, sin consultar reservas', async () => {
    spaces.findSpaceById.mockResolvedValue(null);

    const error = await getAvailability(SPACE_ID, '2026-11-03').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 404, code: 'SPACE_NOT_FOUND' });
    expect(reservations.findConfirmedReservationsInRange).not.toHaveBeenCalled();
  });
});
