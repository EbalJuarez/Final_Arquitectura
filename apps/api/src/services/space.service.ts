import type { CreateSpaceInput, Space, SpaceFilters, UpdateSpaceInput } from '@reservalab/shared';
import { AppError } from '../errors/app-error';
import * as cache from '../lib/cache';
import type { CacheResult } from '../lib/cache';
import * as spaceRepository from '../repositories/space.repository';
import type { SpaceRecord } from '../repositories/space.repository';
import { NOW_KEY, SPACES_NAMESPACE, availabilityGroup, spacesListKey } from './cache-keys';

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

// Se llama DESPUÉS de confirmar la escritura en la base. Incrementa la versión del listado (invalida
// todas sus combinaciones de filtros), borra la disponibilidad cacheada del espacio y /now, que muestra
// los espacios. La caché nunca lanza: si Redis falla solo se registra y el cambio no se revierte.
async function invalidateSpaceCaches(spaceId: string): Promise<void> {
  await Promise.all([
    cache.incrementVersion(SPACES_NAMESPACE),
    cache.delGroup(availabilityGroup(spaceId)),
    cache.del(NOW_KEY),
  ]);
}

// RF-05. La clave lleva la versión del listado: al crear, editar o borrar un espacio se incrementa y
// todas las combinaciones de filtros quedan invalidadas a la vez.
export async function listSpaces(filters: SpaceFilters): Promise<CacheResult<Space[]>> {
  const load = async () => (await spaceRepository.listSpaces(filters)).map(toSpace);

  const version = await cache.getVersion(SPACES_NAMESPACE);
  if (version === null) {
    // Redis no respondió: sin versión no hay clave segura, así que se consulta la base directamente.
    return { data: await load(), cache: 'MISS' };
  }
  return cache.remember(spacesListKey(version, filters), load);
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
  const space = await spaceRepository.createSpace(input);
  await invalidateSpaceCaches(space.id);
  return toSpace(space);
}

export async function updateSpace(id: string, input: UpdateSpaceInput): Promise<Space> {
  const space = await spaceRepository.updateSpace(id, input);
  if (!space) {
    throw spaceNotFound();
  }
  await invalidateSpaceCaches(space.id);
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
  await invalidateSpaceCaches(id);
}
