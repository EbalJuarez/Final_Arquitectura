import type { Role } from '@reservalab/shared';

// Usuario autenticado que deja el middleware authenticate en req.user
export interface AuthUser {
  id: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
