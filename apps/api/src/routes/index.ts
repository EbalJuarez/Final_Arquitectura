import { Router } from 'express';
import { apiKeyRouter } from './api-key.routes';
import { authRouter } from './auth.routes';
import { healthRouter } from './health.routes';
import { nowRouter } from './now.routes';
import { reservationRouter } from './reservation.routes';
import { spaceRouter } from './space.routes';

// Routers de la versión 1 con su prefijo. La prueba de la documentación los recorre para comprobar
// que cada ruta aparece en OpenAPI.
export const apiV1Routers: [prefix: string, router: Router][] = [
  ['/health', healthRouter],
  ['/auth', authRouter],
  ['/spaces', spaceRouter],
  ['/reservations', reservationRouter],
  ['/api-keys', apiKeyRouter],
  ['/now', nowRouter],
];

// Todas las rutas de la versión 1 de la API.
export const apiV1Router = Router();

for (const [prefix, router] of apiV1Routers) {
  apiV1Router.use(prefix, router);
}
