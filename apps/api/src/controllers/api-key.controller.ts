import type { Request, Response } from 'express';
import type { CreateApiKeyInput, IdParams } from '@reservalab/shared';
import * as apiKeyService from '../services/api-key.service';

// body y params ya vienen validados por el middleware validate() de cada ruta.

export async function create(req: Request, res: Response): Promise<void> {
  res.status(201).json(await apiKeyService.createApiKey(req.body as CreateApiKeyInput));
}

export async function list(_req: Request, res: Response): Promise<void> {
  res.json(await apiKeyService.listApiKeys());
}

export async function revoke(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  res.json(await apiKeyService.revokeApiKey(id));
}
