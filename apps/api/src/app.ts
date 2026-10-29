import express from 'express';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { apiV1Router } from './routes';

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use('/api/v1', apiV1Router);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
