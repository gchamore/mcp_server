import { prisma } from '../lib/prisma.js';
import { EncryptionService } from './encryption.service.js';
export class McpService {
    static async createOrUpdateSession(sessionData) {
        try {
            const encryptedAccessKey = EncryptionService.encrypt(sessionData.accessKey);
            const session = await prisma.mcpSession.upsert({
                where: {
                    userId_toolName: {
                        userId: sessionData.userId,
                        toolName: sessionData.toolName
                    }
                },
                update: {
                    accessKey: encryptedAccessKey,
                    updatedAt: new Date()
                },
                create: {
                    userId: sessionData.userId,
                    toolName: sessionData.toolName,
                    accessKey: encryptedAccessKey
                },
                select: {
                    id: true,
                    toolName: true,
                    createdAt: true,
                    updatedAt: true,
                    user: {
                        select: {
                            email: true,
                            firstName: true,
                            lastName: true
                        }
                    }
                }
            });
            return {
                session,
                message: 'Session MCP créée/mise à jour avec succès'
            };
        }
        catch (error) {
            console.error('Erreur lors de la création de la session MCP:', error);
            if (error instanceof Error) {
                throw new Error(`Erreur lors de la création de la session: ${error.message}`);
            }
            throw new Error('Erreur inconnue lors de la création de la session');
        }
    }
    static async getUserSessions(userId) {
        try {
            const sessions = await prisma.mcpSession.findMany({
                where: { userId },
                select: {
                    id: true,
                    toolName: true,
                    mcpUrl: true,
                    createdAt: true,
                    updatedAt: true
                },
                orderBy: { createdAt: 'desc' }
            });
            return sessions;
        }
        catch (error) {
            console.error('Erreur lors de la récupération des sessions:', error);
            throw new Error('Erreur lors de la récupération des sessions');
        }
    }
    static async hasToolSession(userId, toolName) {
        try {
            const session = await prisma.mcpSession.findUnique({
                where: {
                    userId_toolName: {
                        userId,
                        toolName
                    }
                }
            });
            return !!session;
        }
        catch (error) {
            console.error('Erreur lors de la vérification de la session:', error);
            return false;
        }
    }
    static async deleteSession(userId, toolName) {
        try {
            await prisma.mcpSession.delete({
                where: {
                    userId_toolName: {
                        userId,
                        toolName
                    }
                }
            });
            return { message: 'Session supprimée avec succès' };
        }
        catch (error) {
            console.error('Erreur lors de la suppression de la session:', error);
            throw new Error('Erreur lors de la suppression de la session');
        }
    }
    static async updateSessionUrl(sessionId, mcpUrl) {
        try {
            await prisma.mcpSession.update({
                where: { id: sessionId },
                data: { mcpUrl }
            });
            return { message: 'URL MCP mise à jour avec succès' };
        }
        catch (error) {
            console.error('Erreur lors de la mise à jour de l\'URL MCP:', error);
            throw new Error('Erreur lors de la mise à jour de l\'URL MCP');
        }
    }
    static async validateAccessKey(userId, toolName, accessKey) {
        try {
            const session = await prisma.mcpSession.findUnique({
                where: {
                    userId_toolName: {
                        userId,
                        toolName
                    }
                }
            });
            if (!session) {
                return false;
            }
            try {
                const decryptedKey = EncryptionService.decrypt(session.accessKey);
                return accessKey === decryptedKey;
            }
            catch (decryptError) {
                console.error('Erreur de déchiffrement lors de la validation:', decryptError);
                return false;
            }
        }
        catch (error) {
            console.error('Erreur lors de la validation de la clé:', error);
            return false;
        }
    }
    static async getSessionApiKey(userId, toolName) {
        try {
            const session = await prisma.mcpSession.findUnique({
                where: {
                    userId_toolName: {
                        userId,
                        toolName
                    }
                },
                select: {
                    accessKey: true
                }
            });
            if (!session?.accessKey) {
                return null;
            }
            return EncryptionService.decrypt(session.accessKey);
        }
        catch (error) {
            console.error('Erreur lors de la récupération de la clé API:', error);
            return null;
        }
    }
    static async migrateUnencryptedKeys() {
        try {
            console.log('🔄 Vérification et migration des clés non chiffrées...');
            const sessions = await prisma.mcpSession.findMany({
                select: {
                    id: true,
                    accessKey: true
                }
            });
            let migratedCount = 0;
            for (const session of sessions) {
                if (!EncryptionService.isEncrypted(session.accessKey)) {
                    console.log(`🔧 Migration de la session ${session.id}...`);
                    const encryptedKey = EncryptionService.encrypt(session.accessKey);
                    await prisma.mcpSession.update({
                        where: { id: session.id },
                        data: { accessKey: encryptedKey }
                    });
                    migratedCount++;
                }
            }
            if (migratedCount > 0) {
                console.log(`✅ ${migratedCount} clé(s) migrée(s) vers le format chiffré moderne`);
            }
            else {
                console.log('✅ Toutes les clés sont déjà au format chiffré moderne');
            }
        }
        catch (error) {
            console.error('❌ Erreur lors de la migration des clés:', error);
        }
    }
    static async getAllSessionsWithUrls() {
        try {
            const sessions = await prisma.mcpSession.findMany({
                where: {
                    mcpUrl: {
                        not: null
                    }
                },
                select: {
                    id: true,
                    userId: true,
                    toolName: true,
                    accessKey: true,
                    mcpUrl: true,
                    createdAt: true,
                    updatedAt: true,
                    user: {
                        select: {
                            email: true,
                            isActive: true
                        }
                    }
                }
            });
            return sessions.filter(session => session.user.isActive);
        }
        catch (error) {
            console.error('Erreur lors de la récupération des sessions avec URLs:', error);
            return [];
        }
    }
}
