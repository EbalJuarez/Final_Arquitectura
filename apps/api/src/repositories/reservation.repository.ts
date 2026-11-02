import { Prisma, type Reservation } from '@prisma/client';
import { prisma } from '../lib/prisma';

export interface ReservationInterval {
  startsAt: Date;
  endsAt: Date;
}

export interface SpaceReservationInterval extends ReservationInterval {
  spaceId: string;
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

// Dos INSERT traslapados exactamente al mismo tiempo pueden esperar cada uno la transacción del otro
// para evaluar la restricción EXCLUDE; PostgreSQL lo detecta como deadlock (40P01) y aborta uno.
// Llega igual que el 23P01 (comprobado con la prueba de integración). P2034 es el código con el que
// Prisma reporta deadlocks en otros contextos.
function isDeadlock(error: unknown): boolean {
  return (
    (error instanceof Prisma.PrismaClientUnknownRequestError && error.message.includes('40P01')) ||
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
  );
}

const MAX_CREATE_ATTEMPTS = 3;

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

// Reservas CONFIRMED de todos los espacios que se traslapan con [from, to), ordenadas por inicio.
export function findConfirmedReservationsOfAllSpaces(from: Date, to: Date): Promise<SpaceReservationInterval[]> {
  return prisma.reservation.findMany({
    where: { status: 'CONFIRMED', startsAt: { lt: to }, endsAt: { gt: from } },
    select: { spaceId: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: 'asc' },
  });
}

// Si otra solicitud simultánea ganó el horario, la restricción EXCLUDE lo rechaza y se devuelve OVERLAP.
// Ante un deadlock se reintenta: la otra transacción ya terminó, así que el reintento obtiene el
// resultado real (OVERLAP si la otra se confirmó, o CREATED si no).
export async function createReservation(data: CreateReservationData): Promise<CreateReservationResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      const reservation = await prisma.reservation.create({ data, include: withRelations });
      return { status: 'CREATED', reservation };
    } catch (error) {
      if (isOverlapViolation(error)) {
        return { status: 'OVERLAP' };
      }
      if (isDeadlock(error) && attempt < MAX_CREATE_ATTEMPTS) {
        continue;
      }
      throw error;
    }
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
