import { Prisma, type Space } from '@prisma/client';
import { prisma } from '../lib/prisma';

// Los servicios usan este tipo en lugar de importar @prisma/client.
export type SpaceRecord = Space;

export interface SpaceListFilters {
  building?: string;
  minCapacity?: number;
}

export interface SpaceData {
  name: string;
  building: string;
  capacity: number;
}

export type DeleteSpaceResult = 'DELETED' | 'NOT_FOUND' | 'HAS_RESERVATIONS';

export function listSpaces(filters: SpaceListFilters): Promise<Space[]> {
  return prisma.space.findMany({
    where: {
      building: filters.building ? { equals: filters.building, mode: 'insensitive' } : undefined,
      capacity: filters.minCapacity ? { gte: filters.minCapacity } : undefined,
    },
    orderBy: [{ building: 'asc' }, { name: 'asc' }],
  });
}

export function findSpaceById(id: string): Promise<Space | null> {
  return prisma.space.findUnique({ where: { id } });
}

export function createSpace(data: SpaceData): Promise<Space> {
  return prisma.space.create({ data });
}

// Devuelve null si el espacio no existe.
export async function updateSpace(id: string, data: Partial<SpaceData>): Promise<Space | null> {
  try {
    return await prisma.space.update({ where: { id }, data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return null;
    }
    throw error;
  }
}

// Reservas CONFIRMED que todavía no terminan (en curso o futuras).
export async function hasActiveConfirmedReservations(spaceId: string, now: Date): Promise<boolean> {
  const count = await prisma.reservation.count({
    where: { spaceId, status: 'CONFIRMED', endsAt: { gt: now } },
  });
  return count > 0;
}

// Borra el espacio junto con su historial (reservas canceladas o ya terminadas) en una transacción.
// Si entre la validación y el borrado se creó una reserva activa, la FK (Restrict) lo impide.
export async function deleteSpace(id: string, now: Date): Promise<DeleteSpaceResult> {
  try {
    await prisma.$transaction([
      prisma.reservation.deleteMany({
        where: { spaceId: id, OR: [{ status: 'CANCELLED' }, { endsAt: { lte: now } }] },
      }),
      prisma.space.delete({ where: { id } }),
    ]);
    return 'DELETED';
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') return 'NOT_FOUND';
      if (error.code === 'P2003') return 'HAS_RESERVATIONS';
    }
    throw error;
  }
}
