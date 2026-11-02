import type { Request, Response } from 'express';
import type {
  AvailabilityQuery,
  CreateSpaceInput,
  IdParams,
  SpaceFilters,
  UpdateSpaceInput,
} from '@reservalab/shared';
import * as availabilityService from '../services/availability.service';
import * as spaceService from '../services/space.service';

// body, query y params ya vienen validados por el middleware validate() de cada ruta.

export async function list(req: Request, res: Response): Promise<void> {
  res.json(await spaceService.listSpaces(req.query as SpaceFilters));
}

export async function create(req: Request, res: Response): Promise<void> {
  res.status(201).json(await spaceService.createSpace(req.body as CreateSpaceInput));
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  res.json(await spaceService.updateSpace(id, req.body as UpdateSpaceInput));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  await spaceService.deleteSpace(id);
  res.status(204).end();
}

export async function availability(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  const { date } = req.query as AvailabilityQuery;
  res.json(await availabilityService.getAvailability(id, date));
}
