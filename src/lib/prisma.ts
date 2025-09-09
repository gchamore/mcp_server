import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Configuration optimisée pour Railway
export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['warn', 'error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Fonction utilitaire pour exécuter des requêtes avec retry automatique
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Codes d'erreur de connexion Prisma
      const connectionErrors = ['P1017', 'P1001', 'P1002', 'P1008', 'P1011'];
      
      if (connectionErrors.includes(error.code) && attempt < maxRetries) {
        console.warn(`🔄 Tentative ${attempt}/${maxRetries} échouée, reconnexion...`);
        
        // Déconnecter et attendre avant de réessayer
        await prisma.$disconnect();
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
        continue;
      }
      
      // Si ce n'est pas une erreur de connexion ou dernière tentative
      throw error;
    }
  }
  
  throw lastError;
}

// Test de connexion périodique (optionnel)
let connectionCheckInterval: NodeJS.Timeout | null = null;

export function startConnectionHealthCheck() {
  if (connectionCheckInterval) return;
  
  connectionCheckInterval = setInterval(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      console.warn('🔗 Problème de connexion DB détecté, reconnexion...');
      await prisma.$disconnect();
    }
  }, 300000); // Vérification toutes les 5 minutes
}

export function stopConnectionHealthCheck() {
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval);
    connectionCheckInterval = null;
  }
}

// Gestion gracieuse des déconnexions
process.on('beforeExit', async () => {
  console.log('🔌 Fermeture de la connexion Prisma...');
  stopConnectionHealthCheck();
  await prisma.$disconnect();
});

process.on('SIGINT', async () => {
  console.log('🔌 Arrêt du serveur, fermeture de la connexion Prisma...');
  stopConnectionHealthCheck();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🔌 Arrêt du serveur, fermeture de la connexion Prisma...');
  stopConnectionHealthCheck();
  await prisma.$disconnect();
  process.exit(0);
});
