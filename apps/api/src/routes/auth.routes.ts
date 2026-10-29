import { Router } from 'express';
import { LoginSchema, RefreshTokenSchema, RegisterSchema } from '@reservalab/shared';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';

export const authRouter = Router();

authRouter.post('/register', validate(RegisterSchema), authController.register);
authRouter.post('/login', validate(LoginSchema), authController.login);
authRouter.post('/refresh', validate(RefreshTokenSchema), authController.refresh);
authRouter.post('/logout', authenticate, validate(RefreshTokenSchema), authController.logout);
// Ruta de prueba para comprobar el flujo de autenticación
authRouter.get('/me', authenticate, authController.me);
