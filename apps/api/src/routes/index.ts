import { Router } from 'express';
import { authRouter } from './auth.routes';
import { healthRouter } from './health.routes';

// Todas las rutas de la versión 1 de la API.
export const apiV1Router = Router();

apiV1Router.use('/health', healthRouter);
apiV1Router.use('/auth', authRouter);
