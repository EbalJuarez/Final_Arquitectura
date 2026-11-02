import { Prisma, type Reservation } from '@prisma/client';
import { prisma } from '../lib/prisma';

export interface ReservationInterval {
  startsAt: Date;
  endsAt: Date;
}

export interface CreateReservationData {
  spaceId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
}

const withRelations = {
  space: { select: { id: true, name: true, building: true } },
  user: { select: { id: true, email: true } },
} satisfies Prisma.ReservationInclude;

// Los servicios usan este tipo en lugar de importar @prisma/client.
export type ReservationRecord = Reservation & {
  space: { id: string; name: string; building: string };
  user: { id: string; email: string };
};

export type CreateReservationResult =
  | { status: 'CREATED'; reservation: ReservationRecord }
  | { status: 'OVERLAP' };

// Prisma 6 no traduce las violaciones de una restricción EXCLUDE: llegan como
// PrismaClientUnknownRequestError, sin code ni meta, y el código 23P01 de PostgreSQL
// solo aparece dentro del mensaje (comprobado contra la base real).
function isOverlapViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    error.message.includes('23P01') &&
    error.message.includes('Reservation_no_overlap')
  );
}

// Reservas CONFIRMED del espacio que se traslapan con [from, to), ordenadas por inicio.
export function findConfirmedReservationsInRange(
  spaceId: string,
  from: Date,
  to: Date,
): Promise<ReservationInterval[]> {
  return prisma.reservation.findMany({
    where: { spaceId, status: 'CONFIRMED', startsAt: { lt: to }, endsAt: { gt: from } },
    select: { startsAt: true, endsAt: true },
    orderBy: { startsAt: 'asc' },
  });
}

// Si otra solicitud simultánea ganó el horario, la restricción EXCLUDE lo rechaza y se devuelve OVERLAP.
export async function createReservation(data: CreateReservationData): Promise<CreateReservationResult> {
  try {
    const reservation = await prisma.reservation.create({ data, include: withRelations });
    return { status: 'CREATED', reservation };
  } catch (error) {
    if (isOverlapViolation(error)) {
      return { status: 'OVERLAP' };
    }
    throw error;
  }
}

export function findReservationById(id: string): Promise<ReservationRecord | null> {
  return prisma.reservation.findUnique({ where: { id }, include: withRelations });
}

export function listReservationsByUser(userId: string): Promise<ReservationRecord[]> {
  return prisma.reservation.findMany({
    where: { userId },
    include: withRelations,
    orderBy: { startsAt: 'asc' },
  });
}

// Pasa la reserva a CANCELLED solo si sigue CONFIRMED; devuelve null si ya no lo estaba.
export async function cancelReservation(id: string): Promise<ReservationRecord | null> {
  try {
    return await prisma.reservation.update({
      where: { id, status: 'CONFIRMED' },
      data: { status: 'CANCELLED' },
      include: withRelations,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return null;
    }
    throw error;
  }
}
