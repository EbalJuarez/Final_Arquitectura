import { Router } from 'express';
import { CreateReservationSchema, IdParamsSchema } from '@reservalab/shared';
import * as reservationController from '../controllers/reservation.controller';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/require-role';
import { validate } from '../middleware/validate';

export const reservationRouter = Router();

reservationRouter.use(authenticate);

// RF-08: solo DOCENTE y ADMIN
reservationRouter.post(
  '/',
  requireRole('DOCENTE', 'ADMIN'),
  validate(CreateReservationSchema),
  reservationController.create,
);

// RF-09: cualquier usuario autenticado, solo sus reservas
reservationRouter.get('/me', reservationController.mine);

// RF-10: el dueño o un ADMIN (la regla se valida en el servicio)
reservationRouter.delete('/:id', validate(IdParamsSchema, 'params'), reservationController.cancel);
