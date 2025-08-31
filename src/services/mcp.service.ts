import { prisma } from '../lib/prisma.js';
import bcrypt from 'bcryptjs';

export interface McpSessionData {
  userId: string;
  toolName: string;
  accessKey: string;
}

export class McpService {
  private static readonly ENCRYPTION_ROUNDS = 12;

  /**
   * Créer ou mettre à jour une session MCP
   */
  static async createOrUpdateSession(sessionData: McpSessionData) {
    try {
      // Chiffrer la clé d'accès pour la sécurité
      const encryptedAccessKey = await bcrypt.hash(sessionData.accessKey, this.ENCRYPTION_ROUNDS);

      // Utiliser upsert pour créer ou mettre à jour
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

    } catch (error) {
      console.error('Erreur lors de la création de la session MCP:', error);
      if (error instanceof Error) {
        throw new Error(`Erreur lors de la création de la session: ${error.message}`);
      }
      throw new Error('Erreur inconnue lors de la création de la session');
    }
  }

  /**
   * Récupérer les sessions d'un utilisateur avec l'URL MCP
   */
  static async getUserSessions(userId: string) {
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
    } catch (error) {
      console.error('Erreur lors de la récupération des sessions:', error);
      throw new Error('Erreur lors de la récupération des sessions');
    }
  }

  /**
   * Vérifier si un utilisateur a une session pour un outil spécifique
   */
  static async hasToolSession(userId: string, toolName: string): Promise<boolean> {
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
    } catch (error) {
      console.error('Erreur lors de la vérification de la session:', error);
      return false;
    }
  }

  /**
   * Supprimer une session MCP
   */
  static async deleteSession(userId: string, toolName: string) {
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
    } catch (error) {
      console.error('Erreur lors de la suppression de la session:', error);
      throw new Error('Erreur lors de la suppression de la session');
    }
  }

  /**
   * Mettre à jour l'URL MCP d'une session
   */
  static async updateSessionUrl(sessionId: string, mcpUrl: string) {
    try {
      await prisma.mcpSession.update({
        where: { id: sessionId },
        data: { mcpUrl }
      });

      return { message: 'URL MCP mise à jour avec succès' };
    } catch (error) {
      console.error('Erreur lors de la mise à jour de l\'URL MCP:', error);
      throw new Error('Erreur lors de la mise à jour de l\'URL MCP');
    }
  }

  /**
   * Valider une clé d'accès (pour l'authentification)
   */
  static async validateAccessKey(userId: string, toolName: string, accessKey: string): Promise<boolean> {
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

      return await bcrypt.compare(accessKey, session.accessKey);
    } catch (error) {
      console.error('Erreur lors de la validation de la clé:', error);
      return false;
    }
  }
}
