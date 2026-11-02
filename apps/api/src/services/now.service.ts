import type { NowResponse, NowSpace } from '@reservalab/shared';
import { BUSINESS_TIMEZONE, BUSINESS_UTC_OFFSET_MINUTES } from '../config/schedule';
import * as cache from '../lib/cache';
import type { CacheResult } from '../lib/cache';
import * as reservationRepository from '../repositories/reservation.repository';
import type { SpaceReservationInterval } from '../repositories/reservation.repository';
import * as spaceRepository from '../repositories/space.repository';
import type { SpaceRecord } from '../repositories/space.repository';
import { getDayWindow, toOffsetIso, type Interval } from './availability.service';
import { NOW_KEY } from './cache-keys';

// Día completo (00:00 a 24:00) en hora de Guatemala que contiene el instante now.
// Ejemplo: 2026-11-10T03:00Z es todavía el 9 de noviembre en Guatemala (21:00).
export function getBusinessDay(now: Date, utcOffsetMinutes = BUSINESS_UTC_OFFSET_MINUTES): Interval {
  const localDate = toOffsetIso(now, utcOffsetMinutes).slice(0, 10);
  return getDayWindow(localDate, 0, 24, utcOffsetMinutes);
}

// Estado de un espacio en el instante now a partir de sus reservas. Los rangos son [inicio, fin):
// en el inicio exacto ya está ocupado y en el fin exacto ya está libre.
export function computeSpaceStatus(
  reservations: Interval[],
  now: Date,
  dayEnd: Date,
): { occupiedUntil: Date | null; next: Interval | null } {
  const sorted = [...reservations].sort((a, b) => a.start.getTime() - b.start.getTime());

  // Si hay reservas seguidas sin hueco (9-10 y 10-11), el espacio se libera al final de la última.
  let occupiedUntil: Date | null = null;
  for (const reservation of sorted) {
    const coversNow = reservation.start <= now && now < reservation.end;
    const continuesOccupation = occupiedUntil !== null && reservation.start <= occupiedUntil;
    if ((coversNow || continuesOccupation) && reservation.end > (occupiedUntil ?? now)) {
      occupiedUntil = reservation.end;
    }
  }

  // Siguiente reserva: la primera que empieza cuando el espacio ya está libre, dentro del mismo día.
  const freeFrom = occupiedUntil ?? now;
  const next = sorted.find((reservation) => reservation.start >= freeFrom && reservation.start < dayEnd) ?? null;
  return { occupiedUntil, next };
}

// Función pura: recibe la hora actual como parámetro para poder probarla con cualquier instante.
export function buildNowResponse(
  spaces: SpaceRecord[],
  reservations: SpaceReservationInterval[],
  now: Date,
  utcOffsetMinutes = BUSINESS_UTC_OFFSET_MINUTES,
): NowResponse {
  const day = getBusinessDay(now, utcOffsetMinutes);
  const toIso = (date: Date) => toOffsetIso(date, utcOffsetMinutes);

  const bySpace = new Map<string, Interval[]>();
  for (const reservation of reservations) {
    const list = bySpace.get(reservation.spaceId) ?? [];
    list.push({ start: reservation.startsAt, end: reservation.endsAt });
    bySpace.set(reservation.spaceId, list);
  }

  return {
    now: toIso(now),
    timezone: BUSINESS_TIMEZONE,
    spaces: spaces.map((space): NowSpace => {
      const { occupiedUntil, next } = computeSpaceStatus(bySpace.get(space.id) ?? [], now, day.end);
      return {
        id: space.id,
        name: space.name,
        building: space.building,
        capacity: space.capacity,
        status: occupiedUntil ? 'OCCUPIED' : 'FREE',
        occupiedUntil: occupiedUntil ? toIso(occupiedUntil) : null,
        nextReservation: next ? { startsAt: toIso(next.start), endsAt: toIso(next.end) } : null,
      };
    }),
  };
}

// Pantalla informativa: estado de todos los espacios con el reloj del servidor. Se cachea en una sola
// clave, así que la respuesta (incluido "now") puede tener hasta CACHE_TTL_SECONDS de antigüedad.
export async function getNow(now = new Date()): Promise<CacheResult<NowResponse>> {
  return cache.remember(NOW_KEY, () => loadNow(now));
}

async function loadNow(now: Date): Promise<NowResponse> {
  const day = getBusinessDay(now);
  // Solo hacen falta las reservas que siguen activas o empiezan más tarde hoy.
  const [spaces, reservations] = await Promise.all([
    spaceRepository.listSpaces({}),
    reservationRepository.findConfirmedReservationsOfAllSpaces(now, day.end),
  ]);
  return buildNowResponse(spaces, reservations, now);
}
