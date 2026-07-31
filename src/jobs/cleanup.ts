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

async function runCleanup(): Promise<void> {
  const now = new Date();
  const invocationCutoff = new Date(
    now.getTime() - env.ttl.toolInvocationRetentionDays * 24 * 60 * 60 * 1000,
  );

  try {
    const [sessions, resetTokens, invocations] = await Promise.all([
      prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.toolInvocation.deleteMany({ where: { createdAt: { lt: invocationCutoff } } }),
    ]);

    const removed = sessions.count + resetTokens.count + invocations.count;
    if (removed > 0) {
      logger.info(
        {
          sessions: sessions.count,
          resetTokens: resetTokens.count,
          toolInvocations: invocations.count,
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
