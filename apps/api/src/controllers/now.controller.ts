import type { Request, Response } from 'express';
import * as nowService from '../services/now.service';

export async function get(_req: Request, res: Response): Promise<void> {
  res.json(await nowService.getNow());
}
