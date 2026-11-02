import type { ApiKeyPermission, Role } from '@reservalab/shared';

// Usuario autenticado que deja el middleware authenticate en req.user
export interface AuthUser {
  id: string;
  role: Role;
}

// Sistema externo autenticado que deja el middleware authenticateApiKey en req.apiKey
export interface ApiKeyPrincipal {
  id: string;
  prefix: string;
  permissions: ApiKeyPermission[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      apiKey?: ApiKeyPrincipal;
    }
  }
}
