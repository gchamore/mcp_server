import { prisma } from '../lib/prisma.js';
import { EncryptionService } from './encryption.service.js';

export interface McpSessionData {
  userId: string;
  toolName: string;
  accessKey: string;
}

export class McpService {
  /**
   * Créer ou mettre à jour une session MCP
   */
  static async createOrUpdateSession(sessionData: McpSessionData) {
    try {
      // Chiffrer la clé d'accès avant stockage
      const encryptedAccessKey = EncryptionService.encrypt(sessionData.accessKey);

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

      // Déchiffrer la clé stockée et comparer
      try {
        const decryptedKey = EncryptionService.decrypt(session.accessKey);
        return accessKey === decryptedKey;
      } catch (decryptError) {
        console.error('Erreur de déchiffrement lors de la validation:', decryptError);
        return false;
      }
    } catch (error) {
      console.error('Erreur lors de la validation de la clé:', error);
      return false;
    }
  }

  /**
   * Récupérer la clé API d'une session
   */
  static async getSessionApiKey(userId: string, toolName: string): Promise<string | null> {
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

      // Déchiffrer la clé d'accès
      return EncryptionService.decrypt(session.accessKey);
    } catch (error) {
      console.error('Erreur lors de la récupération de la clé API:', error);
      return null;
    }
  }

  /**
   * Migrer les clés d'accès non chiffrées vers le format chiffré
   */
  static async migrateUnencryptedKeys(): Promise<void> {
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
        // Vérifier si la clé est déjà chiffrée
        if (!EncryptionService.isEncrypted(session.accessKey)) {
          console.log(`🔧 Migration de la session ${session.id}...`);
          
          // Chiffrer la clé existante avec le nouveau format
          const encryptedKey = EncryptionService.encrypt(session.accessKey);
          
          // Mettre à jour en base
          await prisma.mcpSession.update({
            where: { id: session.id },
            data: { accessKey: encryptedKey }
          });
          
          migratedCount++;
        }
      }
      
      if (migratedCount > 0) {
        console.log(`✅ ${migratedCount} clé(s) migrée(s) vers le format chiffré moderne`);
      } else {
        console.log('✅ Toutes les clés sont déjà au format chiffré moderne');
      }
      
    } catch (error) {
      console.error('❌ Erreur lors de la migration des clés:', error);
      // Ne pas faire échouer l'application pour cette erreur
    }
  }

  /**
   * Récupérer toutes les sessions avec URLs MCP pour reconstruction
   */
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

      // Filtrer seulement les utilisateurs actifs
      return sessions.filter(session => session.user.isActive);
    } catch (error) {
      console.error('Erreur lors de la récupération des sessions avec URLs:', error);
      return [];
    }
  }
}
