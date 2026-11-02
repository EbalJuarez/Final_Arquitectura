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
import { requireRole } from '../middleware/require-role';
import { validate } from '../middleware/validate';

export const spaceRouter = Router();

// Por ahora todas las rutas de espacios exigen JWT (más adelante se aceptará API key).
spaceRouter.use(authenticate);

// RF-05: cualquier usuario autenticado
spaceRouter.get('/', validate(SpaceFiltersSchema, 'query'), spaceController.list);

// RF-07: cualquier usuario autenticado
spaceRouter.get(
  '/:id/availability',
  validate(IdParamsSchema, 'params'),
  validate(AvailabilityQuerySchema, 'query'),
  spaceController.availability,
);

// RF-06: solo ADMIN
spaceRouter.post('/', requireRole('ADMIN'), validate(CreateSpaceSchema), spaceController.create);
spaceRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  validate(IdParamsSchema, 'params'),
  validate(UpdateSpaceSchema),
  spaceController.update,
);
spaceRouter.delete('/:id', requireRole('ADMIN'), validate(IdParamsSchema, 'params'), spaceController.remove);
