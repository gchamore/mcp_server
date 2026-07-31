import type { Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { env } from '../../core/env.js';
import { generateToken, hashToken } from '../../core/crypto.js';
import { prisma } from '../../core/prisma.js';

/**
 * Sessions par token opaque stocké dans un cookie httpOnly.
 *
 * Pourquoi pas un JWT ? Parce qu'un JWT n'est pas révocable : « supprimer mon
 * compte » ou « déconnecter tous mes appareils » resteraient sans effet jusqu'à
 * expiration. Ici, une ligne supprimée en base invalide immédiatement l'accès.
 * Le coût est une requête indexée par appel authentifié.
 */

const SESSION_COOKIE = 'wsp_session';

const SESSION_TTL_MS = env.ttl.sessionDays * 24 * 60 * 60 * 1000;
/** On ne réécrit `lastSeenAt` que toutes les 15 min, pour éviter une écriture par requête. */
const LAST_SEEN_THROTTLE_MS = 15 * 60 * 1000;

export type ResolvedSession = {
  sessionId: string;
  userId: string;
  email: string;
  role: Role;
};

export async function createSession(userId: string, req: Request): Promise<string> {
  const token = generateToken('wsp');

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
      ipAddress: clientIp(req),
    },
  });

  return token;
}

export async function resolveSession(token: string): Promise<ResolvedSession | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      lastSeenAt: true,
      user: { select: { id: true, email: true, role: true, isActive: true } },
    },
  });

  if (!session || !session.user.isActive) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  return {
    sessionId: session.id,
    userId: session.user.id,
    email: session.user.email,
    role: session.user.role,
  };
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId } });
  return count;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
  });
}

export function readSessionToken(req: Request): string | null {
  const fromCookie = req.cookies?.[SESSION_COOKIE];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) return fromCookie;

  // Repli sur l'en-tête Bearer : utile pour les clients non-navigateur (CLI, tests).
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) {
    const value = header.slice(7).trim();
    if (value.length > 0) return value;
  }

  return null;
}

export function clientIp(req: Request): string | null {
  return (req.ip ?? req.socket.remoteAddress ?? null)?.slice(0, 64) ?? null;
}
