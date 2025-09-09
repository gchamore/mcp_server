import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { 
  ListToolsRequestSchema, 
  CallToolRequestSchema 
} from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';
import { McpTool, McpServerConfig, ActiveMcpSession } from '../types/mcp.types.js';
import { AxonautTools } from '../tools/axonaut.tools.js';
import { McpService } from './mcp.service.js';
import { EncryptionService } from './encryption.service.js';

/**
 * Service pour gérer les serveurs MCP dynamiques
 */
export class DynamicMcpService {
  private static instance: DynamicMcpService;
  private activeSessions: Map<string, ActiveMcpSession> = new Map();
  private isInitialized: boolean = false;
  
  /**
   * Singleton pattern
   */
  public static getInstance(): DynamicMcpService {
    if (!DynamicMcpService.instance) {
      DynamicMcpService.instance = new DynamicMcpService();
    }
    return DynamicMcpService.instance;
  }

  /**
   * Initialiser le service et recréer les sessions existantes
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      console.log('🔄 Initialisation du service MCP et reconstruction des sessions...');
      
      // Récupérer toutes les sessions de la DB avec des URLs MCP
      const existingSessions = await McpService.getAllSessionsWithUrls();
      
      for (const dbSession of existingSessions) {
        if (dbSession.mcpUrl) {
          // Extraire sessionId de l'URL
          const urlParts = dbSession.mcpUrl.split('/');
          const sessionId = urlParts[urlParts.length - 2]; // avant le toolName
          
          console.log(`🔧 Reconstruction de la session ${sessionId} pour ${dbSession.toolName}`);
          
          try {
            // Déchiffrer la clé API avant de recréer la session
            const decryptedApiKey = EncryptionService.decrypt(dbSession.accessKey);
            await this.recreateSession(sessionId, dbSession.userId, dbSession.toolName, decryptedApiKey);
          } catch (error) {
            console.error(`❌ Erreur lors de la reconstruction de la session ${sessionId}:`, error);
            // Continuer avec les autres sessions
          }
        }
      }
      
      this.isInitialized = true;
      console.log(`✅ Service MCP initialisé avec ${this.activeSessions.size} sessions actives`);
      
    } catch (error) {
      console.error('❌ Erreur lors de l\'initialisation du service MCP:', error);
    }
  }

  /**
   * Recréer une session existante
   */
  private async recreateSession(sessionId: string, userId: string, toolName: string, apiKey: string): Promise<void> {
    const config = this.toolConfigs.get(toolName);
    if (!config) {
      throw new Error(`Configuration non trouvée pour ${toolName}`);
    }

    // Créer le serveur MCP
    const server = new Server({
      name: config.name,
      version: config.version,
      description: config.description
    }, {
      capabilities: { tools: {} }
    });

    // Configuration des handlers
    this.setupServerHandlers(server, config.tools, () => apiKey);

    // Créer la session active
    const activeSession: ActiveMcpSession = {
      sessionId,
      userId,
      toolName,
      apiKey,
      server,
      createdAt: new Date()
    };

    this.activeSessions.set(sessionId, activeSession);
    console.log(`✅ Session ${sessionId} reconstruite pour ${toolName}`);
  }

  /**
   * Configuration des outils par type
   */
  private toolConfigs: Map<string, McpServerConfig> = new Map([
    ['axonaut', {
      name: 'axonaut-mcp-server',
      version: '1.0.0',
      description: 'Serveur MCP pour Axonaut CRM',
      tools: AxonautTools,
      apiKeyRequired: true
    }]
  ]);

  /**
   * Créer une nouvelle session MCP ou récupérer une existante
   */
  async createMcpSession(userId: string, toolName: string): Promise<{ sessionId: string; url: string }> {
    try {
      // S'assurer que le service est initialisé
      await this.initialize();
      
      console.log(`🔨 Création/récupération d'une session MCP ${toolName} pour l'utilisateur ${userId}`);
      
      // Vérifier si une session active existe déjà pour cet utilisateur/outil
      const existingSessionId = this.findExistingSession(userId, toolName);
      if (existingSessionId) {
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const mcpUrl = `${baseUrl}/mcp/${existingSessionId}/${toolName}`;
        console.log(`♻️ Session existante trouvée: ${existingSessionId}`);
        return { sessionId: existingSessionId, url: mcpUrl };
      }
      
      // Vérifier que l'utilisateur a une session DB pour cet outil
      const hasSession = await McpService.hasToolSession(userId, toolName);
      if (!hasSession) {
        throw new Error(`Aucune session trouvée pour l'outil ${toolName}. Veuillez d'abord configurer votre clé API.`);
      }

      // Récupérer la configuration de l'outil
      const config = this.toolConfigs.get(toolName);
      if (!config) {
        throw new Error(`Outil ${toolName} non supporté`);
      }

      // Générer un ID de session unique
      const sessionId = uuidv4();
      
      // Récupérer la clé API depuis la base de données
      const apiKey = await McpService.getSessionApiKey(userId, toolName);
      if (!apiKey) {
        throw new Error(`Clé API non trouvée pour l'outil ${toolName}`);
      }
      
      // Créer le serveur MCP
      const server = new Server({
        name: config.name,
        version: config.version,
        description: config.description
      }, {
        capabilities: { tools: {} }
      });

      // Configuration des handlers
      this.setupServerHandlers(server, config.tools, () => apiKey);

      // Créer la session active
      const activeSession: ActiveMcpSession = {
        sessionId,
        userId,
        toolName,
        apiKey,
        server,
        createdAt: new Date()
      };

      this.activeSessions.set(sessionId, activeSession);

      // Générer l'URL d'accès
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const mcpUrl = `${baseUrl}/mcp/${sessionId}/${toolName}`;

      // Mettre à jour la session en base avec l'URL MCP
      const dbSessions = await McpService.getUserSessions(userId);
      const dbSession = dbSessions.find((s: any) => s.toolName === toolName);
      
      if (dbSession) {
        await McpService.updateSessionUrl(dbSession.id, mcpUrl);
      }

      console.log(`✅ Session MCP créée: ${sessionId} - URL: ${mcpUrl}`);

      return {
        sessionId,
        url: mcpUrl
      };

    } catch (error) {
      console.error('❌ Erreur lors de la création de la session MCP:', error);
      throw error;
    }
  }

  /**
   * Trouver une session active existante pour un utilisateur/outil
   */
  private findExistingSession(userId: string, toolName: string): string | null {
    for (const [sessionId, session] of this.activeSessions) {
      if (session.userId === userId && session.toolName === toolName) {
        return sessionId;
      }
    }
    return null;
  }

  /**
   * Configurer les handlers d'un serveur MCP
   */
  private setupServerHandlers(server: Server, tools: McpTool[], getApiKey: () => string) {
    // Liste des outils disponibles
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      console.log('📋 Liste des outils demandée');
      return {
        tools: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }))
      };
    });

    // Exécution des outils
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      console.log(`🔧 Exécution de l'outil: ${name} avec args:`, args);
      
      const tool = tools.find(t => t.name === name);
      
      if (!tool) {
        throw new Error(`Outil ${name} non trouvé`);
      }
      
      try {
        const apiKey = getApiKey();
        console.log(`🔑 [DynamicMcpService] API Key récupérée:`, apiKey ? `${apiKey.substring(0, 10)}...` : 'VIDE');
        console.log(`🔑 [DynamicMcpService] Longueur API Key:`, apiKey?.length || 0);
        
        if (!apiKey) {
          throw new Error('Clé API non configurée pour cette session');
        }

        console.log(`🚀 [DynamicMcpService] Exécution de l'outil ${name} avec API Key`);
        const result = await tool.execute(args, apiKey);
        console.log(`✅ [DynamicMcpService] Outil ${name} exécuté avec succès`);
        
        return { 
          content: [{ 
            type: "text", 
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
          }] 
        };
      } catch (error) {
        console.error(`❌ [DynamicMcpService] Erreur lors de l'exécution de l'outil ${name}:`, error);
        return { 
          content: [{ 
            type: "text", 
            text: `❌ Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}` 
          }] 
        };
      }
    });
  }

  /**
   * Créer une connexion SSE pour une session (avec auto-reconstruction si nécessaire)
   */
  async createSSEConnection(sessionId: string, toolName: string, res: any, apiKey: string): Promise<void> {
    try {
      // S'assurer que le service est initialisé
      await this.initialize();
      
      let session = this.activeSessions.get(sessionId);
      
      // Si la session n'existe pas en mémoire, tenter de la reconstruire
      if (!session) {
        console.log(`🔄 Session ${sessionId} non trouvée en mémoire, tentative de reconstruction...`);
        
        // Rechercher la session en base
        const dbSessions = await McpService.getAllSessionsWithUrls();
        const dbSession = dbSessions.find(s => 
          s.mcpUrl && s.mcpUrl.includes(sessionId) && s.toolName === toolName
        );
        
        if (dbSession) {
          // Déchiffrer la clé API avant de recréer la session
          const decryptedApiKey = EncryptionService.decrypt(dbSession.accessKey);
          await this.recreateSession(sessionId, dbSession.userId, toolName, decryptedApiKey);
          session = this.activeSessions.get(sessionId);
          console.log(`✅ Session ${sessionId} reconstruite avec succès`);
        }
      }
      
      if (!session) {
        throw new Error(`Session ${sessionId} non trouvée et impossible à reconstruire`);
      }

      if (session.toolName !== toolName) {
        throw new Error(`L'outil ${toolName} ne correspond pas à la session ${sessionId}`);
      }

      // Mettre à jour la clé API pour cette session
      session.apiKey = apiKey;

      console.log(`🔌 Connexion SSE établie pour la session ${sessionId} (${toolName})`);
      
      const transport = new SSEServerTransport('/mcp/messages', res);
      await session.server.connect(transport);
    } catch (error) {
      console.error('❌ Erreur lors de la connexion SSE:', error);
      throw error;
    }
  }

  /**
   * Récupérer une session active (avec auto-reconstruction si nécessaire)
   */
  async getActiveSession(sessionId: string): Promise<ActiveMcpSession | undefined> {
    // S'assurer que le service est initialisé
    await this.initialize();
    
    let session = this.activeSessions.get(sessionId);
    
    // Si la session n'existe pas en mémoire, tenter de la reconstruire
    if (!session) {
      console.log(`🔄 Session ${sessionId} non trouvée, tentative de reconstruction...`);
      
      const dbSessions = await McpService.getAllSessionsWithUrls();
      const dbSession = dbSessions.find(s => 
        s.mcpUrl && s.mcpUrl.includes(sessionId)
      );
      
      if (dbSession) {
        try {
          // Déchiffrer la clé API avant de recréer la session
          const decryptedApiKey = EncryptionService.decrypt(dbSession.accessKey);
          await this.recreateSession(sessionId, dbSession.userId, dbSession.toolName, decryptedApiKey);
          session = this.activeSessions.get(sessionId);
          console.log(`✅ Session ${sessionId} reconstruite`);
        } catch (error) {
          console.error(`❌ Erreur reconstruction session ${sessionId}:`, error);
        }
      }
    }
    
    return session;
  }

  /**
   * Récupérer la configuration d'un outil
   */
  getToolConfig(toolName: string): McpServerConfig | undefined {
    return this.toolConfigs.get(toolName.toLowerCase());
  }

  /**
   * Supprimer une session
   */
  removeSession(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      console.log(`🗑️ Suppression de la session MCP ${sessionId}`);
      this.activeSessions.delete(sessionId);
      return true;
    }
    return false;
  }

  /**
   * Nettoyer les sessions expirées (plus de 24h)
   */
  cleanupExpiredSessions(): void {
    const now = new Date();
    const expiredSessions: string[] = [];

    this.activeSessions.forEach((session, sessionId) => {
      const sessionAge = now.getTime() - session.createdAt.getTime();
      const twentyFourHours = 24 * 60 * 60 * 1000;
      
      if (sessionAge > twentyFourHours) {
        expiredSessions.push(sessionId);
      }
    });

    expiredSessions.forEach(sessionId => {
      this.removeSession(sessionId);
    });

    if (expiredSessions.length > 0) {
      console.log(`🧹 ${expiredSessions.length} session(s) MCP expirée(s) supprimée(s)`);
    }
  }

  /**
   * Obtenir les statistiques des sessions
   */
  getSessionStats() {
    return {
      totalSessions: this.activeSessions.size,
      sessionsByTool: Array.from(this.activeSessions.values()).reduce((acc, session) => {
        acc[session.toolName] = (acc[session.toolName] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    };
  }
}
