import { env } from '../core/env.js';
import { logger } from '../core/logger.js';
import { prisma } from '../core/prisma.js';

/**
 * Tâche d'entretien périodique : purge des données expirées.
 *
 * Volontairement basée sur un `setInterval` du processus. Le jour où plusieurs
 * instances tournent en parallèle, la purge sera simplement exécutée plusieurs
 * fois — les opérations sont idempotentes, donc sans conséquence.
 */

const INTERVAL_MS = 60 * 60 * 1000; // toutes les heures

let timer: NodeJS.Timeout | null = null;

/**
 * Inscriptions dynamiques abandonnées.
 *
 * L'enregistrement dynamique (RFC 7591) veut qu'un client s'inscrive tout seul
 * avant de demander une autorisation. Chaque tentative — y compris celles qui
 * échouent, et celles qu'on relance après une erreur — crée une inscription.
 *
 * Or aucune plateforme ne les supprime : la RFC 7592 prévoit bien un point de
 * terminaison pour ça, mais personne ne l'appelle. Retirer un serveur MCP dans
 * Dust ne nous informe de rien. La table se remplit donc d'inscriptions mortes.
 *
 * On ne supprime que ce qui est indiscutablement mort : aucun jeton, jamais
 * utilisé, inscrit il y a plus d'un jour. Un client détenant ne serait-ce qu'un
 * jeton est laissé intact — c'est un accès réel, sa suppression relève d'une
 * révocation explicite, pas d'un ménage automatique.
 */
export async function purgeOrphanClients(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - env.ttl.orphanClientHours * 60 * 60 * 1000);

  const { count } = await prisma.oAuthClient.deleteMany({
    where: {
      // Un client statique a été créé à la main : il n'a pas vocation à
      // disparaître parce qu'il n'a pas encore servi.
      isStatic: false,
      lastUsedAt: null,
      createdAt: { lt: cutoff },
      tokens: { none: {} },
    },
  });

  return count;
}

async function runCleanup(): Promise<void> {
  const now = new Date();
  const invocationCutoff = new Date(
    now.getTime() - env.ttl.toolInvocationRetentionDays * 24 * 60 * 60 * 1000,
  );

  try {
    const [sessions, resetTokens, invocations, grants, orphanClients] = await Promise.all([
      prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.toolInvocation.deleteMany({ where: { createdAt: { lt: invocationCutoff } } }),
      // Codes d'autorisation périmés : quelques minutes de durée de vie, mais
      // rien ne les effaçait jusqu'ici.
      prisma.oAuthGrant.deleteMany({ where: { expiresAt: { lt: now } } }),
      purgeOrphanClients(now),
    ]);

    const removed =
      sessions.count + resetTokens.count + invocations.count + grants.count + orphanClients;

    if (removed > 0) {
      logger.info(
        {
          sessions: sessions.count,
          resetTokens: resetTokens.count,
          toolInvocations: invocations.count,
          oauthGrants: grants.count,
          orphanClients,
        },
        'Purge périodique effectuée',
      );
    }
  } catch (error) {
    logger.error({ err: error }, 'Purge périodique en échec');
  }
}

export function startCleanupJob(): void {
  if (timer) return;
  void runCleanup();
  timer = setInterval(() => void runCleanup(), INTERVAL_MS);
  // N'empêche pas le processus de s'arrêter proprement.
  timer.unref();
}

export function stopCleanupJob(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
