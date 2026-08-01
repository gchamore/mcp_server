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

/** Clé par IP, avec la normalisation IPv6 attendue par la bibliothèque. */
const byIp = (req: Request): string => `ip:${ipKeyGenerator(req.ip ?? '')}`;

/**
 * Compte par utilisateur connecté, sinon par IP.
 *
 * Ne vaut que pour les limiteurs montés **après** `optionalAuth`, c'est-à-dire
 * ceux de `/api`. Avant lui, `req.currentUser` est toujours vide : la clé
 * retomberait silencieusement sur l'IP, en laissant croire au lecteur qu'elle
 * distingue les utilisateurs.
 */
function byUserOrIp(req: Request): string {
  return req.currentUser ? `user:${req.currentUser.userId}` : byIp(req);
}

function makeLimiter(overrides: Partial<Options>) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: byUserOrIp,
    handler,
    // Désactivé en test : sinon les suites qui enchaînent les requêtes tombent en 429.
    skip: () => env.isTest,
    ...overrides,
  });
}

/**
 * Garde-fou global, large : protège contre le trafic anormal, pas contre
 * l'usage normal.
 *
 * Monté avant la résolution de session, donc **par IP exclusivement**. La clé
 * est explicite plutôt qu'héritée : le limiteur global se comportait déjà
 * ainsi, mais sa clé prétendait distinguer les utilisateurs, ce qu'elle ne
 * pouvait pas faire à cet endroit de la chaîne.
 *
 * Conséquence assumée : derrière une sortie réseau partagée — un bureau, un
 * VPN d'entreprise — les utilisateurs se partagent ce quota. D'où une limite
 * volontairement haute, dont le rôle est d'écrêter, pas d'arbitrer.
 */
export const globalLimiter = makeLimiter({ windowMs: 60_000, limit: 300, keyGenerator: byIp });

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
