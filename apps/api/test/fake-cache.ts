import { vi } from 'vitest';
import type * as RealCache from '../src/lib/cache';
import type { CacheResult, RememberOptions } from '../src/lib/cache';

// Caché falsa en memoria con la misma interfaz que src/lib/cache.ts, para las pruebas unitarias de los
// servicios. Uso:
//   vi.mock('../lib/cache', async () => (await import('../../test/fake-cache')).fakeCacheModule);
//   import { fakeCache } from '../../test/fake-cache';   // y fakeCache.reset() en beforeEach

const store = new Map<string, unknown>();
const groups = new Map<string, Set<string>>();
const versions = new Map<string, number>();
// TTL con el que remember guardó cada clave (undefined = el de CACHE_TTL_SECONDS)
const ttls = new Map<string, number | undefined>();

// Si es true, todas las operaciones se comportan como con Redis caído (MISS, sin guardar, versión null).
let down = false;

async function get<T>(key: string): Promise<T | null> {
  return !down && store.has(key) ? (structuredClone(store.get(key)) as T) : null;
}

async function set(key: string, value: unknown, _ttlSeconds?: number, group?: string): Promise<void> {
  if (down) return;
  store.set(key, structuredClone(value));
  if (group) groups.set(group, (groups.get(group) ?? new Set()).add(key));
}

async function remember<T>(
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
  ttls.set(key, ttlSeconds);
  await set(key, data, ttlSeconds, options.group);
  return { data, cache: 'MISS' };
}

const del = vi.fn(async (...keys: string[]) => {
  if (down) return;
  keys.forEach((key) => store.delete(key));
});

const delGroup = vi.fn(async (group: string) => {
  if (down) return;
  groups.get(group)?.forEach((key) => store.delete(key));
  groups.delete(group);
});

const getVersion = vi.fn(async (namespace: string) => (down ? null : (versions.get(namespace) ?? 0)));

const incrementVersion = vi.fn(async (namespace: string) => {
  if (down) return;
  versions.set(namespace, (versions.get(namespace) ?? 0) + 1);
});

export const fakeCacheModule = {
  get,
  set,
  del,
  delGroup,
  getVersion,
  incrementVersion,
  remember,
} satisfies typeof RealCache;

export const fakeCache = {
  store,
  groups,
  versions,
  ttls,
  reset(): void {
    store.clear();
    groups.clear();
    versions.clear();
    ttls.clear();
    down = false;
  },
  // Simula Redis caído hasta el siguiente reset()
  goDown(): void {
    down = true;
  },
};
