import rateLimit, { ipKeyGenerator, type Options, type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Request, Response } from 'express';
import { env } from '../core/env.js';
import { getRedisClient } from '../core/redis.js';

/**
 * ===========================================================================
 *  Limitation de débit
 * ===========================================================================
 *
 * Remplace l'ancienne Map maison qui n'était jamais purgée (fuite mémoire) et
 * se laissait contourner en changeant de User-Agent.
 *
 * ---------------------------------------------------------------------------
 * Compteurs locaux ou partagés
 * ---------------------------------------------------------------------------
 *
 * Par défaut, les compteurs vivent dans la mémoire du processus. Correct tant
 * qu'il n'y a qu'une instance ; faux dès qu'il y en a plusieurs, chacune
 * accordant alors le quota complet. Trois instances, trois fois le débit
 * annoncé — sans le moindre signal que la protection a fondu.
 *
 * Renseigner `REDIS_URL` fait basculer les compteurs dans Redis, partagés par
 * toutes les instances. Rien d'autre à changer.
 *
 * Le choix se fait à la construction des limiteurs, donc au démarrage : la
 * connexion Redis doit être ouverte avant. `index.ts` s'en charge.
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

/**
 * Compteurs partagés, si Redis est disponible.
 *
 * Chaque limiteur a son propre préfixe : sans cela, ils partageraient les mêmes
 * clés et le quota d'authentification consommerait celui du trafic MCP.
 */
function makeStore(prefix: string): Store | undefined {
  const redis = getRedisClient();
  if (!redis) return undefined;

  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args: string[]) => redis.sendCommand(args),
  });
}

function makeLimiter(prefix: string, overrides: Partial<Options>) {
  const store = makeStore(prefix);

  return rateLimit({
    ...(store ? { store } : {}),
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
export const globalLimiter = makeLimiter('global', {
  windowMs: 60_000,
  limit: 300,
  keyGenerator: byIp,
});

/** Endpoints d'authentification : cible privilégiée du bourrage d'identifiants. */
export const authLimiter = makeLimiter('auth', {
  windowMs: 15 * 60_000,
  limit: 20,
  skipSuccessfulRequests: true,
});

/** Actions coûteuses ou envoyant des e-mails. */
export const sensitiveLimiter = makeLimiter('sensible', { windowMs: 15 * 60_000, limit: 10 });

/**
 * Remontée d'erreurs depuis le navigateur.
 *
 * Point d'entrée non authentifié qui écrit dans les journaux : sans borne
 * stricte, il suffit d'une boucle pour saturer le stockage. Trente par quart
 * d'heure et par IP couvrent largement un incident réel — une page qui casse en
 * boucle produit quelques signalements, pas des milliers.
 */
export const telemetryLimiter = makeLimiter('telemetrie', { windowMs: 15 * 60_000, limit: 30 });

/** Trafic MCP : volumétrie légitimement élevée, on borne surtout les abus. */
export const mcpLimiter = makeLimiter('mcp', {
  windowMs: 60_000,
  limit: 240,
  keyGenerator: (req: Request) => `mcp:${ipKeyGenerator(req.ip ?? '')}`,
});
