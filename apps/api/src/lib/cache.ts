import { env } from '../config/env';
import { redis } from './redis';
import { withTimeout } from './with-timeout';

// Caché de lecturas sobre Redis. Los valores se guardan en JSON.
// Fail-open: ninguna función lanza por un fallo de Redis. Se registra una advertencia y la operación
// cuenta como MISS (get), o simplemente no ocurre (set, del, versiones).

export type CacheStatus = 'HIT' | 'MISS';

// Dato junto con el estado de la caché; el controlador lo traduce a la cabecera X-Cache.
export interface CacheResult<T> {
  data: T;
  cache: CacheStatus;
}

// Si Redis tarda más que esto se trata como caído.
const REDIS_TIMEOUT_MS = 500;

async function attempt<T>(operation: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await withTimeout(run(), REDIS_TIMEOUT_MS);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[cache] ${operation} falló, se continúa sin caché: ${reason}`);
    return undefined;
  }
}

// null si no existe, venció o Redis falló.
export async function get<T>(key: string): Promise<T | null> {
  const raw = await attempt(`GET ${key}`, () => redis.get(key));
  if (raw === undefined || raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`[cache] El valor de ${key} no es JSON válido; se trata como MISS`);
    return null;
  }
}

// group: SET de Redis donde se anota la clave para poder borrar todo el grupo sin SCAN (delGroup).
export async function set(
  key: string,
  value: unknown,
  ttlSeconds = env.CACHE_TTL_SECONDS,
  group?: string,
): Promise<void> {
  await attempt(`SET ${key}`, async () => {
    const multi = redis.multi().set(key, JSON.stringify(value), { EX: ttlSeconds });
    if (group) {
      // El grupo vive lo mismo que su clave más reciente; si anota claves ya vencidas, DEL las ignora.
      multi.sAdd(group, key).expire(group, ttlSeconds);
    }
    await multi.exec();
  });
}

export async function del(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await attempt(`DEL ${keys.join(' ')}`, () => redis.del(keys));
}

// Borra todas las claves anotadas en el grupo y el grupo mismo.
export async function delGroup(group: string): Promise<void> {
  await attempt(`DEL grupo ${group}`, async () => {
    const members = await redis.sMembers(group);
    await redis.del([...members, group]);
  });
}

// Versión de un espacio de nombres: forma parte de sus claves, así que incrementarla invalida
// todas a la vez sin buscarlas. null si Redis falló (en ese caso no se debe usar la caché).
export async function getVersion(namespace: string): Promise<number | null> {
  const raw = await attempt(`GET versión ${namespace}`, () => redis.get(`version:${namespace}`));
  if (raw === undefined) {
    return null;
  }
  return raw === null ? 0 : Number(raw);
}

export async function incrementVersion(namespace: string): Promise<void> {
  await attempt(`INCR versión ${namespace}`, () => redis.incr(`version:${namespace}`));
}

export interface RememberOptions<T> {
  // Segundos, o una función que los calcula a partir del dato (por ejemplo, hasta su próximo cambio)
  ttlSeconds?: number | ((data: T) => number);
  group?: string;
}

// Devuelve el valor guardado (HIT) o lo calcula con load y lo guarda (MISS). Si load lanza, no se
// guarda nada: los errores (404, 400) nunca quedan en caché.
export async function remember<T>(
  key: string,
  load: () => Promise<T>,
  options: RememberOptions<T> = {},
): Promise<CacheResult<T>> {
  const cached = await get<T>(key);
  if (cached !== null) {
    return { data: cached, cache: 'HIT' };
  }
  const data = await load();
  const ttlSeconds = typeof options.ttlSeconds === 'function' ? options.ttlSeconds(data) : options.ttlSeconds;
  await set(key, data, ttlSeconds, options.group);
  return { data, cache: 'MISS' };
}
