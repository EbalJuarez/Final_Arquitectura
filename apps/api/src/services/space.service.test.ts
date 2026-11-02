import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeCache, fakeCacheModule } from '../../test/fake-cache';
import { AppError } from '../errors/app-error';
import * as spaceRepository from '../repositories/space.repository';
import type { SpaceRecord } from '../repositories/space.repository';
import * as spaceService from './space.service';

// Repositorio mockeado: estas pruebas no tocan la base de datos.
vi.mock('../repositories/space.repository', () => ({
  listSpaces: vi.fn(),
  findSpaceById: vi.fn(),
  createSpace: vi.fn(),
  updateSpace: vi.fn(),
  hasActiveConfirmedReservations: vi.fn(),
  deleteSpace: vi.fn(),
}));

// Caché en memoria
vi.mock('../lib/cache', async () => (await import('../../test/fake-cache')).fakeCacheModule);

const spaces = vi.mocked(spaceRepository);

const SPACE_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-02T18:00:00Z');

function makeSpace(overrides: Partial<SpaceRecord> = {}): SpaceRecord {
  return {
    id: SPACE_ID,
    name: 'Laboratorio de Redes',
    building: 'Edificio A',
    capacity: 30,
    createdAt: new Date('2026-11-01T12:00:00.000Z'),
    ...overrides,
  };
}

async function expectAppError(promise: Promise<unknown>, statusCode: number, code: string): Promise<void> {
  const error = await promise.then(
    () => expect.unreachable('se esperaba un AppError'),
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ statusCode, code });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeCache.reset();
});

describe('listSpaces', () => {
  it('pasa los filtros al repositorio y devuelve fechas en ISO', async () => {
    spaces.listSpaces.mockResolvedValue([makeSpace()]);

    const result = await spaceService.listSpaces({ building: 'Edificio A', minCapacity: 20 });

    expect(spaces.listSpaces).toHaveBeenCalledWith({ building: 'Edificio A', minCapacity: 20 });
    expect(result).toEqual({
      data: [
        { id: SPACE_ID, name: 'Laboratorio de Redes', building: 'Edificio A', capacity: 30, createdAt: '2026-11-01T12:00:00.000Z' },
      ],
      cache: 'MISS',
    });
  });

  it('sin filtros consulta todos los espacios', async () => {
    spaces.listSpaces.mockResolvedValue([]);

    await expect(spaceService.listSpaces({})).resolves.toEqual({ data: [], cache: 'MISS' });
    expect(spaces.listSpaces).toHaveBeenCalledWith({});
  });

  describe('caché', () => {
    beforeEach(() => {
      spaces.listSpaces.mockResolvedValue([makeSpace()]);
    });

    it('la segunda consulta con los mismos filtros es HIT y no vuelve a la base', async () => {
      const first = await spaceService.listSpaces({ building: 'Edificio A' });
      const second = await spaceService.listSpaces({ building: 'Edificio A' });

      expect(first.cache).toBe('MISS');
      expect(second).toEqual({ data: first.data, cache: 'HIT' });
      expect(spaces.listSpaces).toHaveBeenCalledOnce();
    });

    it('la clave lleva la versión del listado y los filtros', async () => {
      fakeCache.versions.set('spaces', 3);

      await spaceService.listSpaces({ building: 'Edificio A', minCapacity: 20 });
      await spaceService.listSpaces({});

      expect([...fakeCache.store.keys()]).toEqual([
        'spaces:v3:building=Edificio%20A:minCapacity=20',
        'spaces:v3:building=*:minCapacity=*',
      ]);
    });

    it('filtros distintos no comparten respuesta', async () => {
      await spaceService.listSpaces({ building: 'Edificio A' });
      const other = await spaceService.listSpaces({ building: 'Edificio B' });

      expect(other.cache).toBe('MISS');
      expect(spaces.listSpaces).toHaveBeenCalledTimes(2);
    });

    it('al subir la versión la consulta siguiente es MISS', async () => {
      await spaceService.listSpaces({});
      fakeCache.versions.set('spaces', 1);

      await expect(spaceService.listSpaces({})).resolves.toMatchObject({ cache: 'MISS' });
    });

    it('con Redis caído (sin versión) consulta la base sin tocar la caché', async () => {
      fakeCache.goDown();

      await expect(spaceService.listSpaces({})).resolves.toMatchObject({ cache: 'MISS' });
      expect(spaces.listSpaces).toHaveBeenCalledOnce();
    });
  });
});

describe('createSpace y updateSpace', () => {
  it('crea el espacio', async () => {
    spaces.createSpace.mockResolvedValue(makeSpace());

    const result = await spaceService.createSpace({ name: 'Laboratorio de Redes', building: 'Edificio A', capacity: 30 });

    expect(result.id).toBe(SPACE_ID);
  });

  it('actualiza solo los campos enviados', async () => {
    spaces.updateSpace.mockResolvedValue(makeSpace({ capacity: 35 }));

    const result = await spaceService.updateSpace(SPACE_ID, { capacity: 35 });

    expect(spaces.updateSpace).toHaveBeenCalledWith(SPACE_ID, { capacity: 35 });
    expect(result.capacity).toBe(35);
  });

  it('responde 404 al editar un espacio inexistente', async () => {
    spaces.updateSpace.mockResolvedValue(null);

    await expectAppError(spaceService.updateSpace(SPACE_ID, { capacity: 35 }), 404, 'SPACE_NOT_FOUND');
  });
});

describe('deleteSpace', () => {
  it('borra el espacio si no tiene reservas confirmadas vigentes', async () => {
    spaces.findSpaceById.mockResolvedValue(makeSpace());
    spaces.hasActiveConfirmedReservations.mockResolvedValue(false);
    spaces.deleteSpace.mockResolvedValue('DELETED');

    await expect(spaceService.deleteSpace(SPACE_ID, NOW)).resolves.toBeUndefined();

    expect(spaces.hasActiveConfirmedReservations).toHaveBeenCalledWith(SPACE_ID, NOW);
    expect(spaces.deleteSpace).toHaveBeenCalledWith(SPACE_ID, NOW);
  });

  it('responde 404 si el espacio no existe', async () => {
    spaces.findSpaceById.mockResolvedValue(null);

    await expectAppError(spaceService.deleteSpace(SPACE_ID, NOW), 404, 'SPACE_NOT_FOUND');
    expect(spaces.deleteSpace).not.toHaveBeenCalled();
  });

  it('responde 409 si tiene reservas CONFIRMED futuras, sin intentar borrar', async () => {
    spaces.findSpaceById.mockResolvedValue(makeSpace());
    spaces.hasActiveConfirmedReservations.mockResolvedValue(true);

    await expectAppError(spaceService.deleteSpace(SPACE_ID, NOW), 409, 'SPACE_HAS_RESERVATIONS');
    expect(spaces.deleteSpace).not.toHaveBeenCalled();
  });

  it('responde 409 si se creó una reserva entre la validación y el borrado', async () => {
    spaces.findSpaceById.mockResolvedValue(makeSpace());
    spaces.hasActiveConfirmedReservations.mockResolvedValue(false);
    spaces.deleteSpace.mockResolvedValue('HAS_RESERVATIONS');

    await expectAppError(spaceService.deleteSpace(SPACE_ID, NOW), 409, 'SPACE_HAS_RESERVATIONS');
  });

  it('responde 404 si otro administrador lo borró entre la validación y el borrado', async () => {
    spaces.findSpaceById.mockResolvedValue(makeSpace());
    spaces.hasActiveConfirmedReservations.mockResolvedValue(false);
    spaces.deleteSpace.mockResolvedValue('NOT_FOUND');

    await expectAppError(spaceService.deleteSpace(SPACE_ID, NOW), 404, 'SPACE_NOT_FOUND');
  });
});

describe('invalidación de caché', () => {
  const NOW = new Date('2026-11-02T18:00:00Z');

  beforeEach(() => {
    fakeCache.versions.set('spaces', 5);
    fakeCache.store.set(`availability:${SPACE_ID}:2026-11-04`, {});
    fakeCache.groups.set(`availability-keys:${SPACE_ID}`, new Set([`availability:${SPACE_ID}:2026-11-04`]));
    fakeCache.store.set('availability:otro-espacio:2026-11-04', {});
    fakeCache.store.set('now', {});
  });

  function expectInvalidated(): void {
    expect(fakeCache.versions.get('spaces')).toBe(6);
    expect([...fakeCache.store.keys()]).toEqual(['availability:otro-espacio:2026-11-04']);
  }

  function expectUntouched(): void {
    expect(fakeCache.versions.get('spaces')).toBe(5);
    expect(fakeCache.store.size).toBe(3);
  }

  it('al crear un espacio sube la versión del listado y borra /now', async () => {
    spaces.createSpace.mockResolvedValue(makeSpace());

    await spaceService.createSpace({ name: 'Laboratorio de Redes', building: 'Edificio A', capacity: 30 });

    expectInvalidated();
  });

  it('al editar sube la versión, borra la disponibilidad de ese espacio (todas las fechas) y /now', async () => {
    spaces.updateSpace.mockResolvedValue(makeSpace({ capacity: 40 }));

    await spaceService.updateSpace(SPACE_ID, { capacity: 40 });

    expectInvalidated();
  });

  it('al borrar sube la versión, borra la disponibilidad de ese espacio y /now, después de borrar en la base', async () => {
    spaces.findSpaceById.mockResolvedValue(makeSpace());
    spaces.hasActiveConfirmedReservations.mockResolvedValue(false);
    spaces.deleteSpace.mockResolvedValue('DELETED');

    await spaceService.deleteSpace(SPACE_ID, NOW);

    expectInvalidated();
    const deleted = spaces.deleteSpace.mock.invocationCallOrder[0]!;
    expect(fakeCacheModule.incrementVersion.mock.invocationCallOrder[0]!).toBeGreaterThan(deleted);
  });

  it('si la edición falla (404) no invalida nada', async () => {
    spaces.updateSpace.mockResolvedValue(null);

    await spaceService.updateSpace(SPACE_ID, { capacity: 40 }).catch(() => undefined);

    expectUntouched();
  });

  it('si el borrado falla (409) no invalida nada', async () => {
    spaces.findSpaceById.mockResolvedValue(makeSpace());
    spaces.hasActiveConfirmedReservations.mockResolvedValue(true);

    await spaceService.deleteSpace(SPACE_ID, NOW).catch(() => undefined);

    expectUntouched();
  });

  it('con Redis caído el espacio se crea igual', async () => {
    fakeCache.goDown();
    spaces.createSpace.mockResolvedValue(makeSpace());

    await expect(
      spaceService.createSpace({ name: 'Laboratorio de Redes', building: 'Edificio A', capacity: 30 }),
    ).resolves.toMatchObject({ id: SPACE_ID });
  });
});
