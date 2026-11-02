import type { SpaceFilters } from '@reservalab/shared';

// Claves de caché compartidas por las lecturas y las invalidaciones. Ninguna depende del usuario:
// las respuestas cacheadas son las mismas para cualquier JWT o API key.

// Espacio de nombres del listado de espacios: su versión forma parte de cada clave.
export const SPACES_NAMESPACE = 'spaces';

// El filtro building se compara sin distinguir mayúsculas en la base, pero la clave usa el texto
// exacto: así dos textos distintos nunca comparten una respuesta.
export function spacesListKey(version: number, filters: SpaceFilters): string {
  const building = filters.building === undefined ? '*' : encodeURIComponent(filters.building);
  const minCapacity = filters.minCapacity ?? '*';
  return `spaces:v${version}:building=${building}:minCapacity=${minCapacity}`;
}

export function availabilityKey(spaceId: string, date: string): string {
  return `availability:${spaceId}:${date}`;
}

// Grupo con todas las claves de disponibilidad cacheadas de un espacio (una por fecha consultada).
export function availabilityGroup(spaceId: string): string {
  return `availability-keys:${spaceId}`;
}

export const NOW_KEY = 'now';
