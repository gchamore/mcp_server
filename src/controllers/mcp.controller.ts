import { Request, Response } from 'express';
import { McpService } from '../services/mcp.service.js';
import { AuthService } from '../services/auth.service.js';
import { ApiValidationService } from '../services/api-validation.service.js';
import { DynamicMcpService } from '../services/dynamic-mcp.service.js';

export class McpController {
  private static dynamicMcpService = DynamicMcpService.getInstance();

  /**
   * Créer une nouvelle session MCP
   */
  static async createSession(req: Request, res: Response) {
    try {
      const { toolName, accessKey } = req.body;
      
      // Utiliser req.mcpUser fourni par le middleware requireAuth
      const userId = req.mcpUser!.userId;

      // Vérifier que l'utilisateur existe
      const user = await AuthService.getUserById(userId);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Utilisateur non trouvé'
        });
      }

      if (!toolName || !accessKey) {
        return res.status(400).json({
          success: false,
          error: 'Nom de l\'outil et clé d\'accès requis'
        });
      }

      // Valider le nom de l'outil
      const validTools = ['axonaut', 'gmail'];
      if (!validTools.includes(toolName.toLowerCase())) {
        return res.status(400).json({
          success: false,
          error: 'Outil non supporté. Outils disponibles: ' + validTools.join(', ')
        });
      }

      // Valider la clé API
      console.log(`🔍 Validation de la clé API ${toolName}...`);
      const validation = await ApiValidationService.validateApiKey(toolName.toLowerCase(), accessKey);
      
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: validation.error || 'Clé API invalide'
        });
      }

      console.log(`✅ Clé API ${toolName} validée avec succès`);

      const result = await McpService.createOrUpdateSession({
        userId,
        toolName: toolName.toLowerCase(),
        accessKey
      });

      console.log(`🔧 Session MCP créée: ${toolName} pour l'utilisateur ${userId}`);

      // Créer automatiquement la session MCP dynamique
      try {
        const mcpSessionResult = await McpController.dynamicMcpService.createMcpSession(userId, toolName.toLowerCase());
        
        res.status(201).json({
          success: true,
          message: result.message,
          session: result.session,
          mcpSession: {
            sessionId: mcpSessionResult.sessionId,
            url: mcpSessionResult.url,
            instructions: {
              title: `URL MCP pour ${toolName}`,
              description: 'Copiez cette URL dans votre application (Dust AI, etc.)',
              url: mcpSessionResult.url,
              note: 'Cette URL vous permet d\'utiliser les outils ' + toolName + ' via MCP'
            }
          }
        });
      } catch (mcpError) {
        console.warn('⚠️ Erreur lors de la création de la session MCP automatique:', mcpError);
        // On retourne quand même un succès car la session DB a été créée
        res.status(201).json({
          success: true,
          message: result.message,
          session: result.session,
          warning: 'Session créée mais URL MCP non générée. Vous pouvez la créer manuellement.'
        });
      }

    } catch (error) {
      console.error('Erreur création session MCP:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors de la création de la session'
      });
    }
  }

  /**
   * Récupérer les sessions de l'utilisateur connecté
   */
  static async getSessions(req: Request, res: Response) {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Token d\'authentification requis'
        });
      }

      const token = authHeader.split(' ')[1];
      const decoded = AuthService.verifyToken(token);
      const userId = decoded.userId;

      // Vérifier que l'utilisateur existe
      const user = await AuthService.getUserById(userId);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Utilisateur non trouvé'
        });
      }

      const sessions = await McpService.getUserSessions(userId);

      res.json({
        success: true,
        sessions
      });

    } catch (error) {
      console.error('Erreur récupération sessions MCP:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des sessions'
      });
    }
  }

  /**
   * Vérifier si l'utilisateur a une session pour un outil spécifique
   */
  static async checkToolSession(req: Request, res: Response) {
    try {
      const { toolName } = req.params;
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Token d\'authentification requis'
        });
      }

      const token = authHeader.split(' ')[1];
      const decoded = AuthService.verifyToken(token);
      const userId = decoded.userId;

      // Vérifier que l'utilisateur existe
      const user = await AuthService.getUserById(userId);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Utilisateur non trouvé'
        });
      }

      const hasSession = await McpService.hasToolSession(userId, toolName.toLowerCase());
      
      let mcpUrl = null;
      if (hasSession) {
        // Récupérer l'URL MCP si elle existe
        const sessions = await McpService.getUserSessions(userId);
        const session = sessions.find((s: any) => s.toolName === toolName.toLowerCase());
        mcpUrl = session?.mcpUrl || null;
      }

      res.json({
        success: true,
        hasSession,
        mcpUrl,
        toolName: toolName.toLowerCase()
      });

    } catch (error) {
      console.error('Erreur vérification session MCP:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la vérification de la session'
      });
    }
  }

  /**
   * Valider une clé API sans la sauvegarder
   */
  static async validateApiKey(req: Request, res: Response) {
    try {
      const { toolName, accessKey } = req.body;
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Token d\'authentification requis'
        });
      }

      if (!toolName || !accessKey) {
        return res.status(400).json({
          success: false,
          error: 'Nom de l\'outil et clé d\'accès requis'
        });
      }

      console.log(`🔍 Test de validation de la clé API ${toolName}...`);
      const validation = await ApiValidationService.validateApiKey(toolName.toLowerCase(), accessKey);

      res.json({
        success: true,
        valid: validation.valid,
        error: validation.error,
        toolName: toolName.toLowerCase()
      });

    } catch (error) {
      console.error('Erreur validation clé API:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la validation de la clé API'
      });
    }
  }

  /**
   * Supprimer une session MCP
   */
  static async deleteSession(req: Request, res: Response) {
    try {
      const { toolName } = req.params;
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Token d\'authentification requis'
        });
      }

      const token = authHeader.split(' ')[1];
      const decoded = AuthService.verifyToken(token);
      const userId = decoded.userId;

      // Vérifier que l'utilisateur existe
      const user = await AuthService.getUserById(userId);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Utilisateur non trouvé'
        });
      }

      await McpService.deleteSession(userId, toolName.toLowerCase());

      console.log(`🗑️ Session MCP supprimée: ${toolName} pour l'utilisateur ${userId}`);

      res.json({
        success: true,
        message: 'Session supprimée avec succès'
      });

    } catch (error) {
      console.error('Erreur suppression session MCP:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors de la suppression de la session'
      });
    }
  }
}
