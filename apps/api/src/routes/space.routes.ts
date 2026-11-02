import { Router } from 'express';
import {
  AvailabilityQuerySchema,
  CreateSpaceSchema,
  IdParamsSchema,
  SpaceFiltersSchema,
  UpdateSpaceSchema,
} from '@reservalab/shared';
import * as spaceController from '../controllers/space.controller';
import { authenticate } from '../middleware/authenticate';
import { authenticateJwtOrApiKey } from '../middleware/authenticate-api-key';
import { requireRole } from '../middleware/require-role';
import { validate } from '../middleware/validate';

export const spaceRouter = Router();

// RF-05: cualquier usuario autenticado o un sistema externo con una API key read:spaces
spaceRouter.get('/', authenticateJwtOrApiKey('read:spaces'), validate(SpaceFiltersSchema, 'query'), spaceController.list);

// RF-07: cualquier usuario autenticado o un sistema externo con una API key read:spaces
spaceRouter.get(
  '/:id/availability',
  authenticateJwtOrApiKey('read:spaces'),
  validate(IdParamsSchema, 'params'),
  validate(AvailabilityQuerySchema, 'query'),
  spaceController.availability,
);

// RF-06: solo ADMIN con JWT
spaceRouter.post('/', authenticate, requireRole('ADMIN'), validate(CreateSpaceSchema), spaceController.create);
spaceRouter.patch(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validate(IdParamsSchema, 'params'),
  validate(UpdateSpaceSchema),
  spaceController.update,
);
spaceRouter.delete(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validate(IdParamsSchema, 'params'),
  spaceController.remove,
);
