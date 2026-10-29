import type { RefreshToken, User } from '@prisma/client';
import { prisma } from '../lib/prisma';

export interface CreateRefreshTokenData {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export async function createRefreshToken(data: CreateRefreshTokenData): Promise<void> {
  await prisma.refreshToken.create({ data });
}

export function findRefreshTokenByHash(
  tokenHash: string,
): Promise<(RefreshToken & { user: User }) | null> {
  return prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
}

// Revoca el token solo si pertenece al usuario y sigue activo; devuelve cuántos se revocaron.
export async function revokeRefreshToken(tokenHash: string, userId: string): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: { tokenHash, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
