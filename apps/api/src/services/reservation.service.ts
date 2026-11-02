import type { CreateReservationInput, Reservation } from '@reservalab/shared';
import * as notificationsClient from '../clients/notifications.client';
import type { ReservationNotification } from '../clients/notifications.client';
import { BUSINESS_UTC_OFFSET_MINUTES, CLOSING_HOUR, OPENING_HOUR } from '../config/schedule';
import { AppError } from '../errors/app-error';
import * as reservationRepository from '../repositories/reservation.repository';
import type { ReservationRecord } from '../repositories/reservation.repository';
import type { AuthUser } from '../types/express';
import { getDayWindow, toOffsetIso } from './availability.service';
import { getSpaceRecord } from './space.service';

const overlapError = () =>
  new AppError(409, 'RESERVATION_OVERLAP', 'El espacio ya está reservado en ese horario');

function toReservation(reservation: ReservationRecord): Reservation {
  return {
    id: reservation.id,
    space: reservation.space,
    userId: reservation.userId,
    startsAt: toOffsetIso(reservation.startsAt, BUSINESS_UTC_OFFSET_MINUTES),
    endsAt: toOffsetIso(reservation.endsAt, BUSINESS_UTC_OFFSET_MINUTES),
    status: reservation.status,
    createdAt: reservation.createdAt.toISOString(),
  };
}

function toNotification(reservation: ReservationRecord): ReservationNotification {
  return {
    reservationId: reservation.id,
    spaceId: reservation.space.id,
    spaceName: reservation.space.name,
    userId: reservation.user.id,
    userEmail: reservation.user.email,
    startsAt: toOffsetIso(reservation.startsAt, BUSINESS_UTC_OFFSET_MINUTES),
    endsAt: toOffsetIso(reservation.endsAt, BUSINESS_UTC_OFFSET_MINUTES),
  };
}

// La notificación no bloquea la respuesta ni revierte la reserva: si falla o excede el timeout
// del cliente, solo se registra el error.
function notifyInBackground(kind: 'confirmed' | 'cancelled', reservation: ReservationRecord): void {
  const send =
    kind === 'confirmed'
      ? notificationsClient.notifyReservationConfirmed
      : notificationsClient.notifyReservationCancelled;

  send(toNotification(reservation)).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[notificaciones] No se pudo notificar ${kind} de la reserva ${reservation.id}: ${reason}`);
  });
}

// Reglas de horario: rango válido, no en el pasado y dentro de la ventana de operación de un
// mismo día en hora de Guatemala. Lanza AppError 400 si alguna no se cumple.
export function validateReservationTimes(startsAt: Date, endsAt: Date, now: Date): void {
  if (endsAt <= startsAt) {
    throw new AppError(400, 'INVALID_TIME_RANGE', 'endsAt debe ser posterior a startsAt');
  }
  if (startsAt < now) {
    throw new AppError(400, 'RESERVATION_IN_PAST', 'No se puede reservar en el pasado');
  }

  const localDate = toOffsetIso(startsAt, BUSINESS_UTC_OFFSET_MINUTES).slice(0, 10);
  const window = getDayWindow(localDate, OPENING_HOUR, CLOSING_HOUR, BUSINESS_UTC_OFFSET_MINUTES);
  if (startsAt < window.start || endsAt > window.end) {
    throw new AppError(
      400,
      'OUTSIDE_OPERATING_HOURS',
      `La reserva debe estar dentro del mismo día, entre las ${OPENING_HOUR}:00 y las ${CLOSING_HOUR}:00 (hora de Guatemala)`,
    );
  }
}

// RF-08
export async function createReservation(
  user: AuthUser,
  input: CreateReservationInput,
  now = new Date(),
): Promise<Reservation> {
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  validateReservationTimes(startsAt, endsAt, now);

  await getSpaceRecord(input.spaceId);

  const overlapping = await reservationRepository.findConfirmedReservationsInRange(input.spaceId, startsAt, endsAt);
  if (overlapping.length > 0) {
    throw overlapError();
  }

  // Última defensa: si otra solicitud simultánea pasó la misma validación, la base la rechaza.
  const result = await reservationRepository.createReservation({
    spaceId: input.spaceId,
    userId: user.id,
    startsAt,
    endsAt,
  });
  if (result.status === 'OVERLAP') {
    throw overlapError();
  }

  // TODO(Fase 4): invalidar en Redis la caché de disponibilidad del espacio result.reservation.spaceId
  // para el día de la reserva.
  notifyInBackground('confirmed', result.reservation);
  return toReservation(result.reservation);
}

// RF-09
export async function listMyReservations(userId: string): Promise<Reservation[]> {
  const reservations = await reservationRepository.listReservationsByUser(userId);
  return reservations.map(toReservation);
}

// RF-10: el dueño o un ADMIN. No borra la fila, la pasa a CANCELLED.
export async function cancelReservation(user: AuthUser, reservationId: string): Promise<Reservation> {
  const reservation = await reservationRepository.findReservationById(reservationId);
  if (!reservation) {
    throw new AppError(404, 'RESERVATION_NOT_FOUND', 'La reserva no existe');
  }
  if (reservation.userId !== user.id && user.role !== 'ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Solo el dueño de la reserva o un administrador puede cancelarla');
  }

  const alreadyCancelled = () =>
    new AppError(409, 'RESERVATION_ALREADY_CANCELLED', 'La reserva ya estaba cancelada');
  if (reservation.status === 'CANCELLED') {
    throw alreadyCancelled();
  }

  // Si otra solicitud la canceló al mismo tiempo, el repositorio devuelve null.
  const cancelled = await reservationRepository.cancelReservation(reservationId);
  if (!cancelled) {
    throw alreadyCancelled();
  }

  // TODO(Fase 4): invalidar en Redis la caché de disponibilidad del espacio cancelled.spaceId
  // para el día de la reserva.
  notifyInBackground('cancelled', cancelled);
  return toReservation(cancelled);
}
