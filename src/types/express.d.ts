import type { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface SessionUser {
      userId: string;
      sessionId: string;
      email: string;
      role: Role;
    }

    interface Request {
      /**
       * Renseigné par `requireAuth` / `optionalAuth`.
       *
       * Volontairement nommé `currentUser` et non `auth` : le SDK MCP augmente
       * déjà `IncomingMessage.auth` avec son propre type `AuthInfo`, et une
       * collision empêche de passer `req` à `transport.handleRequest()`.
       */
      currentUser?: SessionUser;
    }
  }
}

export {};
