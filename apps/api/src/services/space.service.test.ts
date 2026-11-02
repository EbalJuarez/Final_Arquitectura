import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});

describe('listSpaces', () => {
  it('pasa los filtros al repositorio y devuelve fechas en ISO', async () => {
    spaces.listSpaces.mockResolvedValue([makeSpace()]);

    const result = await spaceService.listSpaces({ building: 'Edificio A', minCapacity: 20 });

    expect(spaces.listSpaces).toHaveBeenCalledWith({ building: 'Edificio A', minCapacity: 20 });
    expect(result).toEqual([
      { id: SPACE_ID, name: 'Laboratorio de Redes', building: 'Edificio A', capacity: 30, createdAt: '2026-11-01T12:00:00.000Z' },
    ]);
  });

  it('sin filtros consulta todos los espacios', async () => {
    spaces.listSpaces.mockResolvedValue([]);

    await expect(spaceService.listSpaces({})).resolves.toEqual([]);
    expect(spaces.listSpaces).toHaveBeenCalledWith({});
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
