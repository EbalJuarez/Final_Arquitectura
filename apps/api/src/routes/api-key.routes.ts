import { Router } from 'express';
import { CreateApiKeySchema, IdParamsSchema } from '@reservalab/shared';
import * as apiKeyController from '../controllers/api-key.controller';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/require-role';
import { validate } from '../middleware/validate';

export const apiKeyRouter = Router();

// Gestión de API keys: solo ADMIN con JWT. Una API key nunca puede gestionar keys.
apiKeyRouter.use(authenticate, requireRole('ADMIN'));

apiKeyRouter.post('/', validate(CreateApiKeySchema), apiKeyController.create);
apiKeyRouter.get('/', apiKeyController.list);
apiKeyRouter.delete('/:id', validate(IdParamsSchema, 'params'), apiKeyController.revoke);
