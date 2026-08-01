import { createApp } from './app.js';
import { connectorCount, loadConnectors } from './connectors/registry.js';
import { env } from './core/env.js';
import { logger } from './core/logger.js';
import { checkDatabase, disconnectPrisma } from './core/prisma.js';
import { connectRedis, disconnectRedis } from './core/redis.js';
import { startCleanupJob, stopCleanupJob } from './jobs/cleanup.js';
import { initMailer } from './services/mail.js';

/**
 * Point d'entrée : chargement des connecteurs, démarrage du serveur HTTP,
 * puis arrêt propre. Toute erreur de démarrage arrête le processus — un
 * conteneur mort et redémarré vaut mieux qu'un conteneur vivant et cassé.
 */

async function main(): Promise<void> {
  if (env.usesFallbackSecrets) {
    logger.warn(
      'Secrets de développement dérivés automatiquement. Définir ENCRYPTION_KEY et SESSION_SECRET avant toute mise en production.',
    );
  }

  // Chargé avant l'ouverture du port : un connecteur mal formé doit empêcher le
  // démarrage, pas produire des erreurs à la première requête.
  await loadConnectors();

  initMailer();

  if (!(await checkDatabase())) {
    throw new Error('Base de données injoignable au démarrage.');
  }

  /**
   * Avant `createApp` : les limiteurs choisissent leur stockage à la
   * construction. Ouvrir la connexion après reviendrait à garder des compteurs
   * locaux malgré un Redis disponible.
   */
  await connectRedis();

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(
      {
        port: env.port,
        baseUrl: env.baseUrl,
        environment: env.nodeEnv,
        connectors: connectorCount(),
        google: env.googleOAuth.enabled,
        smtp: env.smtp.enabled,
      },
      'MCP Wesype démarré',
    );
  });

  startCleanupJob();

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Arrêt en cours');
    stopCleanupJob();

    server.close(() => {
      void Promise.allSettled([disconnectPrisma(), disconnectRedis()]).finally(() =>
        process.exit(0),
      );
    });

    // Filet de sécurité : si des connexions restent ouvertes (flux SSE MCP
    // notamment), on n'attend pas indéfiniment.
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Rejet de promesse non géré');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Exception non capturée — arrêt');
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Démarrage impossible');
  process.exit(1);
});
