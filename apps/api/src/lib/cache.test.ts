import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as cache from './cache';
import { redis } from './redis';

// Redis falso en memoria: solo los comandos que usa la caché. Estas pruebas no abren conexiones.
vi.mock('./redis', () => {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const ttls = new Map<string, number>();
  const client = {
    store,
    sets,
    ttls,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key) || sets.delete(key)) count++;
      }
      return count;
    }),
    incr: vi.fn(async (key: string) => {
      const value = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(value));
      return value;
    }),
    sMembers: vi.fn(async (key: string) => [...(sets.get(key) ?? [])]),
    multi: vi.fn(() => {
      const queue: (() => void)[] = [];
      const multi = {
        set: (key: string, value: string, options: { EX: number }) => {
          queue.push(() => {
            store.set(key, value);
            ttls.set(key, options.EX);
          });
          return multi;
        },
        sAdd: (key: string, member: string) => {
          queue.push(() => sets.set(key, (sets.get(key) ?? new Set()).add(member)));
          return multi;
        },
        expire: (key: string, seconds: number) => {
          queue.push(() => ttls.set(key, seconds));
          return multi;
        },
        exec: vi.fn(async () => queue.forEach((run) => run())),
      };
      return multi;
    }),
  };
  return { redis: client };
});

interface FakeRedis {
  store: Map<string, string>;
  sets: Map<string, Set<string>>;
  ttls: Map<string, number>;
  get: Mock;
  del: Mock;
  incr: Mock;
  sMembers: Mock;
  multi: Mock;
}
const fake = redis as unknown as FakeRedis;

let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fake.store.clear();
  fake.sets.clear();
  fake.ttls.clear();
  vi.clearAllMocks();
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  consoleWarn.mockRestore();
  vi.useRealTimers();
});

describe('get y set', () => {
  it('guarda en JSON con el TTL indicado y lo recupera', async () => {
    await cache.set('clave', { a: 1, fecha: '2026-11-10' }, 30);

    expect(fake.store.get('clave')).toBe('{"a":1,"fecha":"2026-11-10"}');
    expect(fake.ttls.get('clave')).toBe(30);
    await expect(cache.get('clave')).resolves.toEqual({ a: 1, fecha: '2026-11-10' });
  });

  it('usa CACHE_TTL_SECONDS (60) si no se indica TTL', async () => {
    await cache.set('clave', [1]);

    expect(fake.ttls.get('clave')).toBe(60);
  });

  it('get devuelve null si la clave no existe', async () => {
    await expect(cache.get('no-existe')).resolves.toBeNull();
  });

  it('get trata un valor que no es JSON como MISS', async () => {
    fake.store.set('clave', 'esto no es json');

    await expect(cache.get('clave')).resolves.toBeNull();
    expect(consoleWarn).toHaveBeenCalled();
  });

  it('set con grupo anota la clave en el grupo con el mismo TTL', async () => {
    await cache.set('availability:e1:2026-11-10', {}, 60, 'availability-keys:e1');

    expect([...fake.sets.get('availability-keys:e1')!]).toEqual(['availability:e1:2026-11-10']);
    expect(fake.ttls.get('availability-keys:e1')).toBe(60);
  });
});

describe('del y delGroup', () => {
  it('del borra las claves indicadas', async () => {
    fake.store.set('a', '1');
    fake.store.set('b', '2');

    await cache.del('a', 'b');

    expect(fake.store.size).toBe(0);
  });

  it('del sin claves no llama a Redis', async () => {
    await cache.del();

    expect(fake.del).not.toHaveBeenCalled();
  });

  it('delGroup borra todas las claves del grupo y el grupo, sin tocar otras', async () => {
    await cache.set('availability:e1:2026-11-10', {}, 60, 'availability-keys:e1');
    await cache.set('availability:e1:2026-11-11', {}, 60, 'availability-keys:e1');
    await cache.set('availability:e2:2026-11-10', {}, 60, 'availability-keys:e2');

    await cache.delGroup('availability-keys:e1');

    expect([...fake.store.keys()]).toEqual(['availability:e2:2026-11-10']);
    expect(fake.sets.has('availability-keys:e1')).toBe(false);
  });
});

describe('versiones', () => {
  it('una versión que no existe vale 0', async () => {
    await expect(cache.getVersion('spaces')).resolves.toBe(0);
  });

  it('incrementVersion la sube de uno en uno', async () => {
    await cache.incrementVersion('spaces');
    await cache.incrementVersion('spaces');

    await expect(cache.getVersion('spaces')).resolves.toBe(2);
    expect(fake.store.get('version:spaces')).toBe('2');
  });
});

describe('remember', () => {
  it('la primera vez es MISS y guarda; la segunda es HIT sin llamar a load', async () => {
    const load = vi.fn().mockResolvedValue({ libres: 3 });

    await expect(cache.remember('clave', load)).resolves.toEqual({ data: { libres: 3 }, cache: 'MISS' });
    await expect(cache.remember('clave', load)).resolves.toEqual({ data: { libres: 3 }, cache: 'HIT' });
    expect(load).toHaveBeenCalledOnce();
  });

  it('si load lanza no guarda nada (los errores no se cachean)', async () => {
    const error = new Error('404');

    await expect(cache.remember('clave', () => Promise.reject(error))).rejects.toBe(error);
    expect(fake.store.has('clave')).toBe(false);
  });

  it('el TTL puede calcularse a partir del dato', async () => {
    await cache.remember('clave', async () => ({ venceEn: 7 }), { ttlSeconds: (data) => data.venceEn });

    expect(fake.ttls.get('clave')).toBe(7);
  });

  it('pasa el TTL y el grupo a set', async () => {
    await cache.remember('clave', async () => 1, { ttlSeconds: 15, group: 'grupo' });

    expect(fake.ttls.get('clave')).toBe(15);
    expect(fake.sets.get('grupo')?.has('clave')).toBe(true);
  });
});

describe('fail-open: si Redis falla nunca lanza', () => {
  const down = () => Promise.reject(new Error('The client is closed'));

  it('get es MISS y registra una advertencia', async () => {
    fake.get.mockImplementationOnce(down);

    await expect(cache.get('clave')).resolves.toBeNull();
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('The client is closed'));
  });

  it('set, del, delGroup e incrementVersion no lanzan', async () => {
    fake.multi.mockImplementationOnce(() => {
      throw new Error('The client is closed');
    });
    fake.del.mockImplementationOnce(down);
    fake.sMembers.mockImplementationOnce(down);
    fake.incr.mockImplementationOnce(down);

    await expect(cache.set('clave', 1)).resolves.toBeUndefined();
    await expect(cache.del('clave')).resolves.toBeUndefined();
    await expect(cache.delGroup('grupo')).resolves.toBeUndefined();
    await expect(cache.incrementVersion('spaces')).resolves.toBeUndefined();
    expect(consoleWarn).toHaveBeenCalledTimes(4);
  });

  it('getVersion devuelve null (no 0) para que no se use una versión equivocada', async () => {
    fake.get.mockImplementationOnce(down);

    await expect(cache.getVersion('spaces')).resolves.toBeNull();
  });

  it('remember con Redis caído calcula el dato y responde MISS', async () => {
    fake.get.mockImplementationOnce(down);
    fake.multi.mockImplementationOnce(() => {
      throw new Error('The client is closed');
    });

    await expect(cache.remember('clave', async () => 'dato')).resolves.toEqual({ data: 'dato', cache: 'MISS' });
    expect(fake.store.has('clave')).toBe(false);
  });

  it('si Redis no contesta en 500 ms se trata como MISS', async () => {
    vi.useFakeTimers();
    fake.get.mockImplementationOnce(() => new Promise(() => {}));

    const result = cache.get('clave');
    await vi.advanceTimersByTimeAsync(500);

    await expect(result).resolves.toBeNull();
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('no respondió en 500 ms'));
  });
});
