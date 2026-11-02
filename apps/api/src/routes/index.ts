import { Router } from 'express';
import { authRouter } from './auth.routes';
import { healthRouter } from './health.routes';
import { reservationRouter } from './reservation.routes';
import { spaceRouter } from './space.routes';

// Todas las rutas de la versión 1 de la API.
export const apiV1Router = Router();

apiV1Router.use('/health', healthRouter);
apiV1Router.use('/auth', authRouter);
apiV1Router.use('/spaces', spaceRouter);
apiV1Router.use('/reservations', reservationRouter);
