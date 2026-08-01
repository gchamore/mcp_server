import { createClient, type RedisClientType } from 'redis';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * ===========================================================================
 *  Connexion Redis, facultative
 * ===========================================================================
 *
 * Redis ne sert ici qu'à une chose : partager les compteurs de limitation de
 * débit entre plusieurs instances. Sans lui, chaque processus tient les siens,
 * et trois instances accordent trois fois le quota annoncé.
 *
 * Elle est **facultative** à dessein. Tant que le serveur tourne sur un seul
 * conteneur — le cas aujourd'hui — les compteurs en mémoire sont corrects et
 * plus rapides. Imposer Redis reviendrait à ajouter une pièce à faire tourner,
 * surveiller et payer, pour résoudre un problème qui ne se pose pas encore.
 *
 * Le jour où l'on passe à plusieurs instances, il suffit de renseigner
 * `REDIS_URL` : le partage s'active, sans toucher au code.
 *
 * ---------------------------------------------------------------------------
 * Ce qui se passe si Redis tombe
 * ---------------------------------------------------------------------------
 *
 * Rien de fatal. La bibliothèque tente de se reconnecter ; les requêtes de
 * limitation qui échouent laissent passer le trafic plutôt que de le bloquer.
 * C'est le bon arbitrage pour un compteur de débit : mieux vaut un quota
 * temporairement trop généreux qu'un service indisponible parce que son
 * compteur est en panne.
 */

let client: RedisClientType | null = null;

/**
 * Ouvre la connexion si `REDIS_URL` est renseignée.
 *
 * Appelé une fois au démarrage, avant la construction de l'application : les
 * limiteurs interrogent ensuite `getRedisClient()` pour savoir s'ils doivent
 * partager leurs compteurs.
 */
export async function connectRedis(): Promise<void> {
  if (!env.redisUrl || client) return;

  const candidat: RedisClientType = createClient({
    url: env.redisUrl,
    socket: {
      // Espacement croissant, plafonné : on ne martèle pas un service à terre.
      reconnectStrategy: (tentatives) => Math.min(tentatives * 200, 5_000),
    },
  });

  // Sans écouteur, une erreur de socket devient une exception non rattrapée qui
  // arrête le processus — pour une dépendance explicitement facultative.
  candidat.on('error', (error) => {
    logger.warn({ err: error }, 'Redis indisponible : compteurs de débit en mémoire');
  });

  try {
    await candidat.connect();
    client = candidat;
    logger.info('Redis connecté : compteurs de débit partagés entre instances');
  } catch (error) {
    logger.warn(
      { err: error },
      'Connexion Redis impossible : les compteurs de débit restent locaux au processus',
    );
  }
}

export function getRedisClient(): RedisClientType | null {
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (!client) return;
  const aFermer = client;
  client = null;
  await aFermer.quit().catch(() => undefined);
}
