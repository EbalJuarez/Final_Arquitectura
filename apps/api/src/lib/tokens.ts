import { createHash, randomBytes } from 'node:crypto';
import { RoleSchema } from '@reservalab/shared';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env';
import type { AuthUser } from '../types/express';

const AccessTokenPayloadSchema = z.object({
  sub: z.string(),
  role: RoleSchema,
});

export function signAccessToken(user: AuthUser): string {
  return jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: user.id,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

// Lanza si la firma no es válida, si expiró o si el payload no tiene la forma esperada.
export function verifyAccessToken(token: string): AuthUser {
  const payload = AccessTokenPayloadSchema.parse(
    jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }),
  );
  return { id: payload.sub, role: payload.role };
}

// Refresh token opaco: 32 bytes aleatorios (no es un JWT).
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

// En la base solo se guarda el hash SHA-256 del refresh token.
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
