import { PrismaClient } from '@prisma/client';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Client Prisma unique. Le `globalThis` évite d'ouvrir un nouveau pool à chaque
 * rechargement à chaud en développement (tsx watch).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
  });

if (!env.isProduction) globalForPrisma.prisma = prisma;

/** Vérifie que la base répond. Utilisé par /health et au démarrage. */
export async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Base de données injoignable');
    return false;
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
