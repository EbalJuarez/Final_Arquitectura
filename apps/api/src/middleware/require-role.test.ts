import type { Request, Response } from 'express';
import type { Role } from '@reservalab/shared';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error';
import { requireRole } from './require-role';

function run(allowed: Role[], role?: Role) {
  const req = (role ? { user: { id: '11111111-1111-4111-8111-111111111111', role } } : {}) as Request;
  const next = vi.fn();
  let error: unknown;
  try {
    requireRole(...allowed)(req, {} as Response, next);
  } catch (e) {
    error = e;
  }
  return { next, error };
}

describe('requireRole', () => {
  it.each<[Role[], Role]>([
    [['ADMIN'], 'ADMIN'],
    [['DOCENTE', 'ADMIN'], 'DOCENTE'],
    [['DOCENTE', 'ADMIN'], 'ADMIN'],
    [['ESTUDIANTE', 'DOCENTE', 'ADMIN'], 'ESTUDIANTE'],
  ])('permite el paso cuando los roles %j incluyen %s', (allowed, role) => {
    const { next, error } = run(allowed, role);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it.each<[Role[], Role]>([
    [['ADMIN'], 'ESTUDIANTE'],
    [['ADMIN'], 'DOCENTE'],
    [['DOCENTE', 'ADMIN'], 'ESTUDIANTE'],
  ])('responde 403 cuando los roles %j no incluyen %s', (allowed, role) => {
    const { next, error } = run(allowed, role);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(next).not.toHaveBeenCalled();
  });

  it('responde 401 si se usa sin authenticate (no hay req.user)', () => {
    const { next, error } = run(['ADMIN']);

    expect(error).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    expect(next).not.toHaveBeenCalled();
  });
});
