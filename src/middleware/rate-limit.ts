import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { env } from '../core/env.js';

/**
 * Limitation de débit. Remplace l'ancienne Map maison qui n'était jamais purgée
 * (fuite mémoire) et se laissait contourner en changeant de User-Agent.
 *
 * Note pour le passage à plusieurs instances : le stockage par défaut est en
 * mémoire, donc par processus. Brancher `rate-limit-redis` le jour où le
 * serveur tourne sur plus d'un conteneur.
 */

function handler(_req: Request, res: Response): void {
  res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: 'Trop de requêtes. Réessayez dans quelques instants.',
    },
  });
}

/** Compte par utilisateur connecté, sinon par IP (IPv6 correctement normalisée). */
function keyGenerator(req: Request): string {
  return req.currentUser ? `user:${req.currentUser.userId}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

function makeLimiter(overrides: Partial<Options>) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    handler,
    // Désactivé en test : sinon les suites qui enchaînent les requêtes tombent en 429.
    skip: () => env.isTest,
    ...overrides,
  });
}

/** Garde-fou global, large : protège contre le trafic anormal, pas contre l'usage normal. */
export const globalLimiter = makeLimiter({ windowMs: 60_000, limit: 300 });

/** Endpoints d'authentification : cible privilégiée du bourrage d'identifiants. */
export const authLimiter = makeLimiter({
  windowMs: 15 * 60_000,
  limit: 20,
  skipSuccessfulRequests: true,
});

/** Actions coûteuses ou envoyant des e-mails. */
export const sensitiveLimiter = makeLimiter({ windowMs: 15 * 60_000, limit: 10 });

/** Trafic MCP : volumétrie légitimement élevée, on borne surtout les abus. */
export const mcpLimiter = makeLimiter({
  windowMs: 60_000,
  limit: 240,
  keyGenerator: (req: Request) => `mcp:${ipKeyGenerator(req.ip ?? '')}`,
});
