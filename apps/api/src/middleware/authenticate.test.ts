import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import { AppError } from '../errors/app-error';
import { signAccessToken } from '../lib/tokens';
import { authenticate, getAuthUser } from './authenticate';

const USER = { id: '11111111-1111-4111-8111-111111111111', role: 'DOCENTE' as const };

function run(authorization?: string) {
  const req = { headers: authorization === undefined ? {} : { authorization } } as Request;
  const next = vi.fn();
  let error: unknown;
  try {
    authenticate(req, {} as Response, next);
  } catch (e) {
    error = e;
  }
  return { req, next, error };
}

function expectUnauthorized({ next, error, req }: ReturnType<typeof run>, message: string) {
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED', message });
  expect(next).not.toHaveBeenCalled();
  expect(req.user).toBeUndefined();
}

describe('authenticate', () => {
  it('con un token válido deja el usuario en req.user y llama a next()', () => {
    const result = run(`Bearer ${signAccessToken(USER)}`);

    expect(result.error).toBeUndefined();
    expect(result.next).toHaveBeenCalledOnce();
    expect(result.req.user).toEqual(USER);
  });

  it('responde 401 sin encabezado Authorization', () => {
    expectUnauthorized(run(), 'Falta el token de acceso');
  });

  it.each([
    ['otro esquema', `Basic ${signAccessToken(USER)}`],
    ['Bearer sin token', 'Bearer'],
    ['token sin esquema', signAccessToken(USER)],
    ['esquema en minúsculas', `bearer ${signAccessToken(USER)}`],
  ])('responde 401 con formato inválido (%s)', (_caso, header) => {
    expectUnauthorized(run(header), 'Falta el token de acceso');
  });

  it.each([
    ['malformado', 'esto-no-es-un-jwt'],
    ['con partes que no son JSON', 'abc.def.ghi'],
    ['firmado con otro secreto', jwt.sign({ role: 'ADMIN' }, 'otro-secreto-distinto', { subject: USER.id })],
    [
      'expirado',
      jwt.sign({ role: USER.role, exp: Math.floor(Date.now() / 1000) - 10 }, env.JWT_ACCESS_SECRET, {
        subject: USER.id,
      }),
    ],
    ['con un rol que no existe', jwt.sign({ role: 'SUPERUSUARIO' }, env.JWT_ACCESS_SECRET, { subject: USER.id })],
    ['sin sub', jwt.sign({ role: USER.role }, env.JWT_ACCESS_SECRET)],
    ['con algoritmo none', jwt.sign({ role: 'ADMIN' }, '', { algorithm: 'none', subject: USER.id })],
  ])('responde 401 con un token %s', (_caso, token) => {
    expectUnauthorized(run(`Bearer ${token}`), 'Token de acceso inválido o expirado');
  });
});

describe('getAuthUser', () => {
  it('devuelve req.user cuando existe', () => {
    expect(getAuthUser({ user: USER } as Request)).toEqual(USER);
  });

  it('responde 401 si no hay usuario autenticado', () => {
    expect(() => getAuthUser({} as Request)).toThrow(
      expect.objectContaining({ statusCode: 401, code: 'UNAUTHORIZED' }),
    );
  });
});
