import { PrismaClient } from '@prisma/client';
const globalForPrisma = globalThis;
export const prisma = globalForPrisma.prisma ?? new PrismaClient({
    log: ['warn', 'error'],
    datasources: {
        db: {
            url: process.env.DATABASE_URL
        }
    }
});
if (process.env.NODE_ENV !== 'production')
    globalForPrisma.prisma = prisma;
export async function withRetry(operation, maxRetries = 3, delay = 1000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            const connectionErrors = ['P1017', 'P1001', 'P1002', 'P1008', 'P1011'];
            if (connectionErrors.includes(error.code) && attempt < maxRetries) {
                console.warn(`🔄 Tentative ${attempt}/${maxRetries} échouée, reconnexion...`);
                await prisma.$disconnect();
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}
let connectionCheckInterval = null;
export function startConnectionHealthCheck() {
    if (connectionCheckInterval)
        return;
    connectionCheckInterval = setInterval(async () => {
        try {
            await prisma.$queryRaw `SELECT 1`;
        }
        catch (error) {
            console.warn('🔗 Problème de connexion DB détecté, reconnexion...');
            await prisma.$disconnect();
        }
    }, 300000);
}
export function stopConnectionHealthCheck() {
    if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
        connectionCheckInterval = null;
    }
}
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
