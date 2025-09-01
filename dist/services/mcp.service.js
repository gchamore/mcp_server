import { prisma } from '../lib/prisma.js';
export class McpService {
    static async createOrUpdateSession(sessionData) {
        try {
            const session = await prisma.mcpSession.upsert({
                where: {
                    userId_toolName: {
                        userId: sessionData.userId,
                        toolName: sessionData.toolName
                    }
                },
                update: {
                    accessKey: sessionData.accessKey,
                    updatedAt: new Date()
                },
                create: {
                    userId: sessionData.userId,
                    toolName: sessionData.toolName,
                    accessKey: sessionData.accessKey
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
            return accessKey === session.accessKey;
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
            return session?.accessKey || null;
        }
        catch (error) {
            console.error('Erreur lors de la récupération de la clé API:', error);
            return null;
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
