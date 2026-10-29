import type { Request, Response } from 'express';
import * as healthService from '../services/health.service';

export async function getHealth(_req: Request, res: Response): Promise<void> {
  const report = await healthService.getHealth();
  res.status(report.status === 'ok' ? 200 : 503).json(report);
}
