import { Router } from 'express';
import * as nowController from '../controllers/now.controller';
import { authenticateApiKey } from '../middleware/authenticate-api-key';
import { rateLimitApiKey } from '../middleware/rate-limit';

export const nowRouter = Router();

// Pantalla informativa: solo API key con read:now (un JWT no sirve aquí), con límite por minuto.
nowRouter.get('/', authenticateApiKey('read:now'), rateLimitApiKey, nowController.get);
