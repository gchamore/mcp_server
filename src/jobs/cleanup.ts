import { env } from '../core/env.js';
import { logger } from '../core/logger.js';
import { prisma } from '../core/prisma.js';

/**
 * ===========================================================================
 *  Tâche d'entretien périodique
 * ===========================================================================
 *
 * Purge des données expirées : sessions, jetons de réinitialisation, appels
 * d'outils au-delà de la rétention, codes d'autorisation périmés, inscriptions
 * dynamiques abandonnées.
 *
 * ---------------------------------------------------------------------------
 * Plusieurs instances
 * ---------------------------------------------------------------------------
 *
 * Le déclenchement reste un `setInterval` par processus : c'est simple et sans
 * infrastructure. Avec N instances, la tâche se déclenche donc N fois par
 * heure.
 *
 * La version précédente s'en accommodait au motif que les suppressions sont
 * idempotentes. C'est vrai du résultat, pas du chemin : N processus lançant
 * simultanément cinq `DELETE` sur les mêmes lignes se disputent les verrous de
 * PostgreSQL, et le coût croît avec le nombre d'instances au lieu de rester
 * constant.
 *
 * Un verrou consultatif règle la question sans rien ajouter à la pile : c'est
 * PostgreSQL, déjà là, qui arbitre. `pg_try_advisory_lock` ne bloque pas —
 * l'instance qui ne l'obtient pas passe simplement son tour, ce qui est
 * exactement le comportement voulu pour une purge horaire.
 */

const INTERVAL_MS = 60 * 60 * 1000; // toutes les heures

/**
 * Identifiant du verrou consultatif.
 *
 * L'espace est global à la base : une constante arbitraire mais fixe, choisie
 * une fois. À ne jamais réutiliser pour un autre verrou.
 */
const CLEANUP_LOCK_ID = 4_812_233_901;

let timer: NodeJS.Timeout | null = null;

/**
 * Exécute `travail` seulement si aucune autre instance ne le fait déjà.
 *
 * Le verrou est pris au niveau de la session PostgreSQL et relâché
 * explicitement dans le `finally` : sans cela, il survivrait jusqu'à la
 * fermeture de la connexion, que le pool garde ouverte — et la purge suivante
 * ne s'exécuterait plus jamais sur cette instance.
 */
async function withAdvisoryLock(travail: () => Promise<void>): Promise<boolean> {
  const lignes = await prisma.$queryRaw<
    { acquis: boolean }[]
  >`SELECT pg_try_advisory_lock(${CLEANUP_LOCK_ID}::bigint) AS "acquis"`;

  if (!lignes[0]?.acquis) return false;

  try {
    await travail();
    return true;
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${CLEANUP_LOCK_ID}::bigint)`;
  }
}

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
  try {
    const execute = await withAdvisoryLock(purgeAll);
    if (!execute) {
      logger.debug('Purge déjà en cours sur une autre instance : tour passé');
    }
  } catch (error) {
    logger.error({ err: error }, 'Purge périodique en échec');
  }
}

async function purgeAll(): Promise<void> {
  const now = new Date();
  const invocationCutoff = new Date(
    now.getTime() - env.ttl.toolInvocationRetentionDays * 24 * 60 * 60 * 1000,
  );

  const auditCutoff = new Date(now.getTime() - env.ttl.auditLogRetentionDays * 24 * 60 * 60 * 1000);
  const tokenCutoff = new Date(now.getTime() - env.ttl.oauthTokenGraceDays * 24 * 60 * 60 * 1000);

  const [sessions, resetTokens, invocations, grants, audits, tokens, orphanClients] =
    await Promise.all([
      prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.toolInvocation.deleteMany({ where: { createdAt: { lt: invocationCutoff } } }),
      // Codes d'autorisation périmés : quelques minutes de durée de vie, mais
      // rien ne les effaçait jusqu'ici.
      prisma.oAuthGrant.deleteMany({ where: { expiresAt: { lt: now } } }),
      // Deux tables grossissaient sans borne : le journal d'audit, et les
      // jetons OAuth morts — expirés ou révoqués depuis plus que le délai de
      // grâce, gardé pour la détection de rejeu de leur famille.
      prisma.auditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } }),
      prisma.oAuthToken.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: tokenCutoff } }, { revokedAt: { lt: tokenCutoff } }],
        },
      }),
      purgeOrphanClients(now),
    ]);

  const removed =
    sessions.count +
    resetTokens.count +
    invocations.count +
    grants.count +
    audits.count +
    tokens.count +
    orphanClients;

  if (removed > 0) {
    logger.info(
      {
        sessions: sessions.count,
        resetTokens: resetTokens.count,
        toolInvocations: invocations.count,
        oauthGrants: grants.count,
        auditLogs: audits.count,
        oauthTokens: tokens.count,
        orphanClients,
      },
      'Purge périodique effectuée',
    );
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
