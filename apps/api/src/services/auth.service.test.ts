import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginSchema, RegisterSchema, type RegisterInput } from '@reservalab/shared';
import { AppError } from '../errors/app-error';
import { verifyPassword } from '../lib/password';
import { hashRefreshToken, verifyAccessToken } from '../lib/tokens';
import * as refreshTokenRepository from '../repositories/refresh-token.repository';
import * as userRepository from '../repositories/user.repository';
import type { UserRecord } from '../repositories/user.repository';
import * as authService from './auth.service';

// Repositorios y hash de contraseñas mockeados: estas pruebas no tocan la base de datos.
vi.mock('../repositories/user.repository', () => ({
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  createUser: vi.fn(),
}));
vi.mock('../repositories/refresh-token.repository', () => ({
  createRefreshToken: vi.fn(),
  findRefreshTokenByHash: vi.fn(),
  revokeRefreshToken: vi.fn(),
}));
vi.mock('../lib/password', () => ({
  hashPassword: vi.fn(async (password: string) => `hash(${password})`),
  verifyPassword: vi.fn(),
}));

const users = vi.mocked(userRepository);
const refreshTokens = vi.mocked(refreshTokenRepository);
const verifyPasswordMock = vi.mocked(verifyPassword);

const DAY_MS = 24 * 60 * 60 * 1000;

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ana@reservalab.test',
    name: 'Ana Prueba',
    passwordHash: 'hash(claveSegura123)',
    role: 'ESTUDIANTE',
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
    ...overrides,
  };
}

function makeStoredRefreshToken(overrides: { expiresAt?: Date; revokedAt?: Date | null } = {}) {
  const user = makeUser();
  return {
    id: '22222222-2222-4222-8222-222222222222',
    userId: user.id,
    tokenHash: hashRefreshToken('token-valido'),
    expiresAt: new Date(Date.now() + DAY_MS),
    revokedAt: null,
    createdAt: new Date(),
    user,
    ...overrides,
  };
}

async function expectAppError(promise: Promise<unknown>, statusCode: number, code: string): Promise<AppError> {
  const error = await promise.then(
    () => expect.unreachable('se esperaba un AppError'),
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ statusCode, code });
  return error as AppError;
}

const registerInput: RegisterInput = {
  email: 'ana@reservalab.test',
  name: 'Ana Prueba',
  password: 'claveSegura123',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('register', () => {
  it('crea el usuario con la contraseña hasheada y no devuelve el hash', async () => {
    users.createUser.mockImplementation(async (data) => makeUser(data));

    const result = await authService.register(registerInput);

    expect(users.createUser).toHaveBeenCalledWith({
      email: 'ana@reservalab.test',
      name: 'Ana Prueba',
      passwordHash: 'hash(claveSegura123)',
      role: 'ESTUDIANTE',
    });
    expect(result).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'ana@reservalab.test',
      name: 'Ana Prueba',
      role: 'ESTUDIANTE',
      createdAt: '2026-10-01T12:00:00.000Z',
    });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('responde 409 si el correo ya está registrado', async () => {
    users.createUser.mockResolvedValue(null);

    await expectAppError(authService.register(registerInput), 409, 'EMAIL_ALREADY_REGISTERED');
  });

  it('ignora el rol ADMIN enviado y crea siempre ESTUDIANTE', async () => {
    users.createUser.mockImplementation(async (data) => makeUser(data));
    const body = { ...registerInput, role: 'ADMIN' };

    // Por la ruta real: el esquema descarta "role"
    const parsed = RegisterSchema.parse(body);
    expect(parsed).not.toHaveProperty('role');

    // Y aunque llegara al servicio, este fuerza ESTUDIANTE
    const result = await authService.register(body as RegisterInput);
    expect(users.createUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'ESTUDIANTE' }));
    expect(result.role).toBe('ESTUDIANTE');
  });

  it('normaliza el correo a minúsculas antes de guardarlo', async () => {
    users.createUser.mockImplementation(async (data) => makeUser(data));

    await authService.register(RegisterSchema.parse({ ...registerInput, email: '  Ana@ReservaLab.TEST ' }));

    expect(users.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'ana@reservalab.test' }));
  });
});

describe('login', () => {
  it('devuelve un access token con sub y role, y guarda solo el hash del refresh token', async () => {
    users.findUserByEmail.mockResolvedValue(makeUser({ role: 'DOCENTE' }));
    verifyPasswordMock.mockResolvedValue(true);

    const result = await authService.login(LoginSchema.parse({ email: 'ANA@reservalab.test', password: 'claveSegura123' }));

    expect(users.findUserByEmail).toHaveBeenCalledWith('ana@reservalab.test');
    expect(verifyAccessToken(result.accessToken)).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      role: 'DOCENTE',
    });

    const saved = refreshTokens.createRefreshToken.mock.calls[0]![0];
    expect(saved.userId).toBe('11111111-1111-4111-8111-111111111111');
    expect(saved.tokenHash).toBe(hashRefreshToken(result.refreshToken));
    expect(saved.tokenHash).not.toBe(result.refreshToken);
    expect(saved.expiresAt.getTime() - Date.now()).toBeGreaterThan(7 * DAY_MS - 5000);
    expect(saved.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(7 * DAY_MS);
  });

  it('responde 401 genérico con contraseña incorrecta y con usuario inexistente', async () => {
    users.findUserByEmail.mockResolvedValueOnce(makeUser());
    verifyPasswordMock.mockResolvedValueOnce(false);
    const wrongPassword = await expectAppError(
      authService.login({ email: 'ana@reservalab.test', password: 'incorrecta' }),
      401,
      'INVALID_CREDENTIALS',
    );

    users.findUserByEmail.mockResolvedValueOnce(null);
    verifyPasswordMock.mockResolvedValueOnce(false);
    const unknownUser = await expectAppError(
      authService.login({ email: 'nadie@reservalab.test', password: 'incorrecta' }),
      401,
      'INVALID_CREDENTIALS',
    );

    expect(unknownUser.message).toBe(wrongPassword.message);
    expect(refreshTokens.createRefreshToken).not.toHaveBeenCalled();
  });

  it('con usuario inexistente igual compara la contraseña (contra un hash de relleno)', async () => {
    users.findUserByEmail.mockResolvedValue(null);
    verifyPasswordMock.mockResolvedValue(false);

    await expectAppError(
      authService.login({ email: 'nadie@reservalab.test', password: 'cualquiera' }),
      401,
      'INVALID_CREDENTIALS',
    );

    expect(verifyPasswordMock).toHaveBeenCalledTimes(1);
    expect(verifyPasswordMock).toHaveBeenCalledWith(expect.any(String), 'cualquiera');
  });
});

describe('refresh', () => {
  it('con un token válido devuelve un access token nuevo, buscando por hash', async () => {
    refreshTokens.findRefreshTokenByHash.mockResolvedValue(makeStoredRefreshToken());

    const result = await authService.refresh('token-valido');

    expect(refreshTokens.findRefreshTokenByHash).toHaveBeenCalledWith(hashRefreshToken('token-valido'));
    expect(verifyAccessToken(result.accessToken)).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      role: 'ESTUDIANTE',
    });
  });

  it.each([
    ['expirado', makeStoredRefreshToken({ expiresAt: new Date(Date.now() - 1000) })],
    ['revocado', makeStoredRefreshToken({ revokedAt: new Date() })],
    ['inexistente', null],
  ])('responde 401 con un token %s', async (_caso, stored) => {
    refreshTokens.findRefreshTokenByHash.mockResolvedValue(stored);

    await expectAppError(authService.refresh('token-valido'), 401, 'INVALID_REFRESH_TOKEN');
  });
});

describe('logout', () => {
  it('revoca el refresh token del usuario autenticado', async () => {
    refreshTokens.revokeRefreshToken.mockResolvedValue(1);

    await expect(authService.logout('11111111-1111-4111-8111-111111111111', 'token-valido')).resolves.toBeUndefined();

    expect(refreshTokens.revokeRefreshToken).toHaveBeenCalledWith(
      hashRefreshToken('token-valido'),
      '11111111-1111-4111-8111-111111111111',
    );
  });

  // El repositorio solo revoca si el hash coincide Y pertenece al usuario; si no revoca nada devuelve 0.
  it.each([['inexistente'], ['de otro usuario']])('responde 401 con un token %s', async () => {
    refreshTokens.revokeRefreshToken.mockResolvedValue(0);

    await expectAppError(
      authService.logout('33333333-3333-4333-8333-333333333333', 'token-valido'),
      401,
      'INVALID_REFRESH_TOKEN',
    );
  });
});

describe('getProfile', () => {
  it('devuelve el perfil público del usuario', async () => {
    users.findUserById.mockResolvedValue(makeUser());

    const profile = await authService.getProfile('11111111-1111-4111-8111-111111111111');

    expect(profile).toMatchObject({ email: 'ana@reservalab.test', role: 'ESTUDIANTE' });
    expect(profile).not.toHaveProperty('passwordHash');
  });

  it('responde 401 si el usuario del token ya no existe', async () => {
    users.findUserById.mockResolvedValue(null);

    await expectAppError(authService.getProfile('11111111-1111-4111-8111-111111111111'), 401, 'UNAUTHORIZED');
  });
});
