import { prisma } from '../lib/prisma';

export interface ReservationInterval {
  startsAt: Date;
  endsAt: Date;
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
