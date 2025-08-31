import { Request, Response } from 'express';
import { DynamicMcpService } from '../services/dynamic-mcp.service.js';
import { AuthService } from '../services/auth.service.js';
import { McpService } from '../services/mcp.service.js';

export class DynamicMcpController {
  private static mcpService = DynamicMcpService.getInstance();

  /**
   * Créer une nouvelle session MCP
   */
  static async createMcpSession(req: Request, res: Response) {
    try {
      const { toolName } = req.body;
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

      if (!toolName) {
        return res.status(400).json({
          success: false,
          error: 'Nom de l\'outil requis'
        });
      }

      // Vérifier que l'utilisateur a configuré cet outil
      const hasSession = await McpService.hasToolSession(userId, toolName);
      if (!hasSession) {
        return res.status(400).json({
          success: false,
          error: `Outil ${toolName} non configuré. Veuillez d'abord ajouter votre clé API.`
        });
      }

      const result = await DynamicMcpController.mcpService.createMcpSession(userId, toolName);

      console.log(`🚀 Session MCP créée: ${result.sessionId} pour ${toolName}`);

      res.status(201).json({
        success: true,
        sessionId: result.sessionId,
        url: result.url,
        toolName,
        message: 'Session MCP créée avec succès'
      });

    } catch (error) {
      console.error('Erreur création session MCP:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors de la création de la session MCP'
      });
    }
  }

  /**
   * Connexion SSE pour une session MCP spécifique
   */
  static async handleSSEConnection(req: Request, res: Response) {
    try {
      const { sessionId, toolName } = req.params;
      const { apiKey } = req.query;

      if (!sessionId || !toolName) {
        return res.status(400).json({
          success: false,
          error: 'Session ID et nom d\'outil requis'
        });
      }

      if (!apiKey) {
        return res.status(400).json({
          success: false,
          error: 'Clé API requise pour la connexion'
        });
      }

      console.log(`🔌 Tentative de connexion SSE pour ${sessionId}/${toolName}`);

      // Configurer les headers SSE
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      // Créer la connexion SSE
      await DynamicMcpController.mcpService.createSSEConnection(sessionId, toolName, res, apiKey as string);

    } catch (error) {
      console.error('❌ Erreur SSE MCP:', error);
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false,
          error: error instanceof Error ? error.message : 'Erreur de connexion MCP' 
        });
      }
    }
  }

  /**
   * Endpoint pour les messages MCP
   */
  static async handleMcpMessages(req: Request, res: Response) {
    try {
      const { sessionId, toolName } = req.params;
      const message = req.body;
      
      console.log(`📨 Message MCP reçu pour ${sessionId}/${toolName}:`, message);
      
      // Vérifier que la session existe
      const session = DynamicMcpController.mcpService.getActiveSession(sessionId);
      if (!session) {
        return res.status(404).json({
          jsonrpc: "2.0",
          id: message.id || null,
          error: {
            code: -32002,
            message: "Session MCP non trouvée"
          }
        });
      }

      if (session.toolName !== toolName) {
        return res.status(400).json({
          jsonrpc: "2.0",
          id: message.id || null,
          error: {
            code: -32602,
            message: "Outil incorrect pour cette session"
          }
        });
      }

      // Gérer les différents types de messages MCP
      switch (message.method) {
        case 'initialize':
          return res.json({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: "2025-06-18",
              capabilities: { 
                tools: {} 
              },
              serverInfo: { 
                name: "mcp-wesype-server", 
                version: "1.0.0" 
              }
            }
          });

        case 'tools/list':
          // Retourner la liste des outils disponibles
          const toolConfig = DynamicMcpController.mcpService.getToolConfig(toolName);
          if (!toolConfig) {
            return res.json({
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: -32602,
                message: "Configuration d'outil non trouvée"
              }
            });
          }

          return res.json({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              tools: toolConfig.tools.map((tool: any) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema
              }))
            }
          });

        case 'tools/call':
          // Exécuter un outil
          const { name: toolCallName, arguments: toolArgs } = message.params;
          
          try {
            const toolConfig = DynamicMcpController.mcpService.getToolConfig(toolName);
            const tool = toolConfig?.tools.find((t: any) => t.name === toolCallName);
            
            if (!tool) {
              return res.json({
                jsonrpc: "2.0",
                id: message.id,
                error: {
                  code: -32602,
                  message: `Outil ${toolCallName} non trouvé`
                }
              });
            }

            // Utiliser la clé API de la session active
            const apiKey = session.apiKey;
            if (!apiKey) {
              return res.json({
                jsonrpc: "2.0",
                id: message.id,
                error: {
                  code: -32002,
                  message: "Clé API non configurée pour cette session"
                }
              });
            }
            
            const result = await tool.execute(toolArgs, apiKey);
            
            return res.json({
              jsonrpc: "2.0",
              id: message.id,
              result: {
                content: [{
                  type: "text",
                  text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                }]
              }
            });

          } catch (toolError) {
            console.error(`❌ Erreur exécution outil ${toolCallName}:`, toolError);
            return res.json({
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: -32603,
                message: `Erreur lors de l'exécution de l'outil: ${toolError instanceof Error ? toolError.message : 'Erreur inconnue'}`
              }
            });
          }

        default:
          return res.json({
            jsonrpc: "2.0",
            id: message.id || null,
            error: {
              code: -32601,
              message: `Méthode ${message.method} non supportée`
            }
          });
      }

    } catch (error) {
      console.error('❌ Erreur message MCP:', error);
      res.status(500).json({
        jsonrpc: "2.0",
        id: req.body?.id || null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Erreur lors du traitement du message'
        }
      });
    }
  }

  /**
   * Informations sur une session MCP
   */
  static async getSessionInfo(req: Request, res: Response) {
    try {
      const { sessionId, toolName } = req.params;

      const session = DynamicMcpController.mcpService.getActiveSession(sessionId);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Session MCP non trouvée'
        });
      }

      if (session.toolName !== toolName) {
        return res.status(400).json({
          success: false,
          error: 'Outil incorrect pour cette session'
        });
      }

      res.json({
        success: true,
        session: {
          sessionId: session.sessionId,
          toolName: session.toolName,
          createdAt: session.createdAt,
          userId: session.userId
        },
        endpoints: {
          sse: `/mcp/${sessionId}/${toolName}/sse`,
          messages: `/mcp/${sessionId}/${toolName}/messages`,
          info: `/mcp/${sessionId}/${toolName}`
        }
      });

    } catch (error) {
      console.error('❌ Erreur info session MCP:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors de la récupération des informations'
      });
    }
  }

  /**
   * Supprimer une session MCP
   */
  static async deleteSession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
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

      const session = DynamicMcpController.mcpService.getActiveSession(sessionId);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Session MCP non trouvée'
        });
      }

      // Vérifier que l'utilisateur est propriétaire de la session
      if (session.userId !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Accès refusé à cette session'
        });
      }

      const removed = DynamicMcpController.mcpService.removeSession(sessionId);
      if (removed) {
        console.log(`🗑️ Session MCP supprimée: ${sessionId}`);
        res.json({
          success: true,
          message: 'Session MCP supprimée avec succès'
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Session non trouvée'
        });
      }

    } catch (error) {
      console.error('❌ Erreur suppression session MCP:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors de la suppression'
      });
    }
  }

  /**
   * Statistiques des sessions MCP
   */
  static async getStats(req: Request, res: Response) {
    try {
      const stats = DynamicMcpController.mcpService.getSessionStats();
      
      res.json({
        success: true,
        stats,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Erreur stats MCP:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors de la récupération des statistiques'
      });
    }
  }

  /**
   * Nettoyage des sessions expirées (endpoint admin)
   */
  static async cleanup(req: Request, res: Response) {
    try {
      DynamicMcpController.mcpService.cleanupExpiredSessions();
      
      res.json({
        success: true,
        message: 'Nettoyage des sessions expirées effectué'
      });

    } catch (error) {
      console.error('❌ Erreur nettoyage MCP:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors du nettoyage'
      });
    }
  }
}
