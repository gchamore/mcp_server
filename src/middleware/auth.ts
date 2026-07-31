import type { Request, RequestHandler } from 'express';
import { forbidden, unauthenticated } from '../core/errors.js';
import { readSessionToken, resolveSession } from '../modules/auth/session.service.js';

async function attachSession(req: Request): Promise<void> {
  if (req.currentUser) return;

  const token = readSessionToken(req);
  if (!token) return;

  const session = await resolveSession(token);
  if (!session) return;

  req.currentUser = {
    userId: session.userId,
    sessionId: session.sessionId,
    email: session.email,
    role: session.role,
  };
}

/** Résout la session si un cookie/bearer est présent, sans jamais échouer. */
export const optionalAuth: RequestHandler = async (req, _res, next) => {
  try {
    await attachSession(req);
    next();
  } catch (error) {
    next(error);
  }
};

/** Exige une session valide. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    await attachSession(req);
    if (!req.currentUser) {
      next(unauthenticated());
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};

/** Exige le rôle ADMIN. Le rôle vit en base, pas dans une liste d'e-mails codée en dur. */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.currentUser) {
    next(unauthenticated());
    return;
  }
  if (req.currentUser.role !== 'ADMIN') {
    next(forbidden('Droits administrateur requis'));
    return;
  }
  next();
};

/** Raccourci typé pour les handlers placés derrière `requireAuth`. */
export function auth(req: Request): Express.SessionUser {
  if (!req.currentUser) throw unauthenticated();
  return req.currentUser;
}
