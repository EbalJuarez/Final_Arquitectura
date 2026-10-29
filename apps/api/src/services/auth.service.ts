import type {
  LoginInput,
  LoginResponse,
  PublicUser,
  RefreshResponse,
  RegisterInput,
} from '@reservalab/shared';
import { AppError } from '../errors/app-error';
import { hashPassword, verifyPassword } from '../lib/password';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
  signAccessToken,
} from '../lib/tokens';
import * as refreshTokenRepository from '../repositories/refresh-token.repository';
import * as userRepository from '../repositories/user.repository';
import type { UserRecord } from '../repositories/user.repository';

// Mismo error para correo inexistente y contraseña incorrecta: no revela cuál de los dos falló.
const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos');
const invalidRefreshToken = () =>
  new AppError(401, 'INVALID_REFRESH_TOKEN', 'El refresh token no es válido, expiró o fue revocado');

// Hash de relleno para verificar aunque el correo no exista, así ambos casos tardan lo mismo.
let dummyPasswordHash: Promise<string> | undefined;

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

// RF-01: el registro público siempre crea ESTUDIANTE, sin importar lo que se envíe.
export async function register(input: RegisterInput): Promise<PublicUser> {
  const user = await userRepository.createUser({
    email: input.email,
    name: input.name,
    passwordHash: await hashPassword(input.password),
    role: 'ESTUDIANTE',
  });
  if (!user) {
    throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'Ya existe una cuenta con ese correo');
  }
  return toPublicUser(user);
}

// RF-02
export async function login(input: LoginInput): Promise<LoginResponse> {
  const user = await userRepository.findUserByEmail(input.email);
  if (!user) {
    dummyPasswordHash ??= hashPassword('contraseña-de-relleno');
    await verifyPassword(await dummyPasswordHash, input.password);
    throw invalidCredentials();
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw invalidCredentials();
  }

  const refreshToken = generateRefreshToken();
  await refreshTokenRepository.createRefreshToken({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: refreshTokenExpiresAt(),
  });

  return {
    accessToken: signAccessToken({ id: user.id, role: user.role }),
    refreshToken,
  };
}

// RF-03
export async function refresh(refreshToken: string): Promise<RefreshResponse> {
  const stored = await refreshTokenRepository.findRefreshTokenByHash(hashRefreshToken(refreshToken));
  if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
    throw invalidRefreshToken();
  }
  return { accessToken: signAccessToken({ id: stored.user.id, role: stored.user.role }) };
}

// RF-04: revoca el refresh token indicado si pertenece al usuario autenticado.
export async function logout(userId: string, refreshToken: string): Promise<void> {
  const revoked = await refreshTokenRepository.revokeRefreshToken(hashRefreshToken(refreshToken), userId);
  if (revoked === 0) {
    throw invalidRefreshToken();
  }
}

export async function getProfile(userId: string): Promise<PublicUser> {
  const user = await userRepository.findUserById(userId);
  if (!user) {
    throw new AppError(401, 'UNAUTHORIZED', 'El usuario del token ya no existe');
  }
  return toPublicUser(user);
}
