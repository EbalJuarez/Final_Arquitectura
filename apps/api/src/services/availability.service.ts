import type { AvailabilityResponse, TimeBlock } from '@reservalab/shared';
import {
  BUSINESS_TIMEZONE,
  BUSINESS_UTC_OFFSET_MINUTES,
  CLOSING_HOUR,
  OPENING_HOUR,
} from '../config/schedule';
import * as cache from '../lib/cache';
import type { CacheResult } from '../lib/cache';
import * as reservationRepository from '../repositories/reservation.repository';
import { availabilityGroup, availabilityKey } from './cache-keys';
import { getSpaceRecord } from './space.service';

export interface Interval {
  start: Date;
  end: Date;
}

const MINUTE_MS = 60 * 1000;

// Ventana de operación de un día (YYYY-MM-DD) interpretado en la zona del negocio, no en UTC.
// Ejemplo: 2026-11-03 de 7 a 21 en UTC-6 => 2026-11-03T13:00Z a 2026-11-04T03:00Z.
export function getDayWindow(
  date: string,
  openingHour: number,
  closingHour: number,
  utcOffsetMinutes: number,
): Interval {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const toUtc = (hour: number) => new Date(Date.UTC(year, month - 1, day, hour) - utcOffsetMinutes * MINUTE_MS);
  return { start: toUtc(openingHour), end: toUtc(closingHour) };
}

// Recorta los bloques a la ventana, descarta los que quedan fuera y los ordena por inicio.
export function clipToWindow(window: Interval, blocks: Interval[]): Interval[] {
  return blocks
    .map((block) => ({
      start: new Date(Math.max(block.start.getTime(), window.start.getTime())),
      end: new Date(Math.min(block.end.getTime(), window.end.getTime())),
    }))
    .filter((block) => block.start < block.end)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

// Bloques libres: el complemento de los ocupados dentro de la ventana.
// Tolera bloques desordenados, traslapados o fuera de la ventana.
export function computeFreeBlocks(window: Interval, occupied: Interval[]): Interval[] {
  const free: Interval[] = [];
  let cursor = window.start;

  for (const block of clipToWindow(window, occupied)) {
    if (block.start > cursor) {
      free.push({ start: cursor, end: block.start });
    }
    if (block.end > cursor) {
      cursor = block.end;
    }
  }

  if (cursor < window.end) {
    free.push({ start: cursor, end: window.end });
  }
  return free;
}

// ISO 8601 en hora local del negocio, por ejemplo 2026-11-03T07:00:00-06:00.
export function toOffsetIso(date: Date, utcOffsetMinutes: number): string {
  const local = new Date(date.getTime() + utcOffsetMinutes * MINUTE_MS).toISOString().slice(0, 19);
  const sign = utcOffsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(utcOffsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `${local}${sign}${hours}:${minutes}`;
}

function toTimeBlock(interval: Interval): TimeBlock {
  return {
    startsAt: toOffsetIso(interval.start, BUSINESS_UTC_OFFSET_MINUTES),
    endsAt: toOffsetIso(interval.end, BUSINESS_UTC_OFFSET_MINUTES),
  };
}

// RF-07: bloques ocupados y libres de un espacio en un día. Se cachea por espacio y fecha; si el
// espacio no existe lanza 404 antes de guardar, así que los errores no quedan en caché.
export async function getAvailability(spaceId: string, date: string): Promise<CacheResult<AvailabilityResponse>> {
  return cache.remember(availabilityKey(spaceId, date), () => loadAvailability(spaceId, date), {
    group: availabilityGroup(spaceId),
  });
}

async function loadAvailability(spaceId: string, date: string): Promise<AvailabilityResponse> {
  await getSpaceRecord(spaceId);

  const window = getDayWindow(date, OPENING_HOUR, CLOSING_HOUR, BUSINESS_UTC_OFFSET_MINUTES);
  const reservations = await reservationRepository.findConfirmedReservationsInRange(
    spaceId,
    window.start,
    window.end,
  );
  const occupied = clipToWindow(
    window,
    reservations.map((reservation) => ({ start: reservation.startsAt, end: reservation.endsAt })),
  );

  return {
    spaceId,
    date,
    timezone: BUSINESS_TIMEZONE,
    window: toTimeBlock(window),
    occupied: occupied.map(toTimeBlock),
    free: computeFreeBlocks(window, occupied).map(toTimeBlock),
  };
}
