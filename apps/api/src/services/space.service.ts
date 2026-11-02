import type { CreateSpaceInput, Space, SpaceFilters, UpdateSpaceInput } from '@reservalab/shared';
import { AppError } from '../errors/app-error';
import * as spaceRepository from '../repositories/space.repository';
import type { SpaceRecord } from '../repositories/space.repository';

const spaceNotFound = () => new AppError(404, 'SPACE_NOT_FOUND', 'El espacio no existe');
const spaceHasReservations = () =>
  new AppError(409, 'SPACE_HAS_RESERVATIONS', 'El espacio tiene reservas confirmadas vigentes o futuras');

export function toSpace(space: SpaceRecord): Space {
  return {
    id: space.id,
    name: space.name,
    building: space.building,
    capacity: space.capacity,
    createdAt: space.createdAt.toISOString(),
  };
}

// RF-05
export async function listSpaces(filters: SpaceFilters): Promise<Space[]> {
  const spaces = await spaceRepository.listSpaces(filters);
  return spaces.map(toSpace);
}

// Lanza 404 si no existe; lo usan otras operaciones que dependen del espacio.
export async function getSpaceRecord(id: string): Promise<SpaceRecord> {
  const space = await spaceRepository.findSpaceById(id);
  if (!space) {
    throw spaceNotFound();
  }
  return space;
}

// RF-06
export async function createSpace(input: CreateSpaceInput): Promise<Space> {
  return toSpace(await spaceRepository.createSpace(input));
}

export async function updateSpace(id: string, input: UpdateSpaceInput): Promise<Space> {
  const space = await spaceRepository.updateSpace(id, input);
  if (!space) {
    throw spaceNotFound();
  }
  return toSpace(space);
}

// No se puede borrar un espacio con reservas CONFIRMED en curso o futuras.
export async function deleteSpace(id: string, now = new Date()): Promise<void> {
  await getSpaceRecord(id);
  if (await spaceRepository.hasActiveConfirmedReservations(id, now)) {
    throw spaceHasReservations();
  }

  const result = await spaceRepository.deleteSpace(id, now);
  if (result === 'NOT_FOUND') throw spaceNotFound();
  if (result === 'HAS_RESERVATIONS') throw spaceHasReservations();
}
