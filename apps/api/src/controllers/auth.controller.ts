import type { Request, Response } from 'express';
import type { LoginInput, RefreshTokenInput, RegisterInput } from '@reservalab/shared';
import { getAuthUser } from '../middleware/authenticate';
import * as authService from '../services/auth.service';

// req.body ya viene validado por el middleware validate() de cada ruta.

export async function register(req: Request, res: Response): Promise<void> {
  res.status(201).json(await authService.register(req.body as RegisterInput));
}

export async function login(req: Request, res: Response): Promise<void> {
  res.json(await authService.login(req.body as LoginInput));
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as RefreshTokenInput;
  res.json(await authService.refresh(refreshToken));
}

export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as RefreshTokenInput;
  await authService.logout(getAuthUser(req).id, refreshToken);
  res.status(204).end();
}

export async function me(req: Request, res: Response): Promise<void> {
  res.json(await authService.getProfile(getAuthUser(req).id));
}
