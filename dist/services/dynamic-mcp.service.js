import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';
import { AxonautTools } from '../tools/axonaut.tools.js';
import { McpService } from './mcp.service.js';
export class DynamicMcpService {
    constructor() {
        this.activeSessions = new Map();
        this.isInitialized = false;
        this.toolConfigs = new Map([
            ['axonaut', {
                    name: 'axonaut-mcp-server',
                    version: '1.0.0',
                    description: 'Serveur MCP pour Axonaut CRM',
                    tools: AxonautTools,
                    apiKeyRequired: true
                }]
        ]);
    }
    static getInstance() {
        if (!DynamicMcpService.instance) {
            DynamicMcpService.instance = new DynamicMcpService();
        }
        return DynamicMcpService.instance;
    }
    async initialize() {
        if (this.isInitialized)
            return;
        try {
            console.log('🔄 Initialisation du service MCP et reconstruction des sessions...');
            const existingSessions = await McpService.getAllSessionsWithUrls();
            for (const dbSession of existingSessions) {
                if (dbSession.mcpUrl) {
                    const urlParts = dbSession.mcpUrl.split('/');
                    const sessionId = urlParts[urlParts.length - 2];
                    console.log(`🔧 Reconstruction de la session ${sessionId} pour ${dbSession.toolName}`);
                    try {
                        await this.recreateSession(sessionId, dbSession.userId, dbSession.toolName, dbSession.accessKey);
                    }
                    catch (error) {
                        console.error(`❌ Erreur lors de la reconstruction de la session ${sessionId}:`, error);
                    }
                }
            }
            this.isInitialized = true;
            console.log(`✅ Service MCP initialisé avec ${this.activeSessions.size} sessions actives`);
        }
        catch (error) {
            console.error('❌ Erreur lors de l\'initialisation du service MCP:', error);
        }
    }
    async recreateSession(sessionId, userId, toolName, apiKey) {
        const config = this.toolConfigs.get(toolName);
        if (!config) {
            throw new Error(`Configuration non trouvée pour ${toolName}`);
        }
        const server = new Server({
            name: config.name,
            version: config.version,
            description: config.description
        }, {
            capabilities: { tools: {} }
        });
        this.setupServerHandlers(server, config.tools, () => apiKey);
        const activeSession = {
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
    async createMcpSession(userId, toolName) {
        try {
            await this.initialize();
            console.log(`🔨 Création/récupération d'une session MCP ${toolName} pour l'utilisateur ${userId}`);
            const existingSessionId = this.findExistingSession(userId, toolName);
            if (existingSessionId) {
                const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
                const mcpUrl = `${baseUrl}/mcp/${existingSessionId}/${toolName}`;
                console.log(`♻️ Session existante trouvée: ${existingSessionId}`);
                return { sessionId: existingSessionId, url: mcpUrl };
            }
            const hasSession = await McpService.hasToolSession(userId, toolName);
            if (!hasSession) {
                throw new Error(`Aucune session trouvée pour l'outil ${toolName}. Veuillez d'abord configurer votre clé API.`);
            }
            const config = this.toolConfigs.get(toolName);
            if (!config) {
                throw new Error(`Outil ${toolName} non supporté`);
            }
            const sessionId = uuidv4();
            const apiKey = await McpService.getSessionApiKey(userId, toolName);
            if (!apiKey) {
                throw new Error(`Clé API non trouvée pour l'outil ${toolName}`);
            }
            const server = new Server({
                name: config.name,
                version: config.version,
                description: config.description
            }, {
                capabilities: { tools: {} }
            });
            this.setupServerHandlers(server, config.tools, () => apiKey);
            const activeSession = {
                sessionId,
                userId,
                toolName,
                apiKey,
                server,
                createdAt: new Date()
            };
            this.activeSessions.set(sessionId, activeSession);
            const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
            const mcpUrl = `${baseUrl}/mcp/${sessionId}/${toolName}`;
            const dbSessions = await McpService.getUserSessions(userId);
            const dbSession = dbSessions.find((s) => s.toolName === toolName);
            if (dbSession) {
                await McpService.updateSessionUrl(dbSession.id, mcpUrl);
            }
            console.log(`✅ Session MCP créée: ${sessionId} - URL: ${mcpUrl}`);
            return {
                sessionId,
                url: mcpUrl
            };
        }
        catch (error) {
            console.error('❌ Erreur lors de la création de la session MCP:', error);
            throw error;
        }
    }
    findExistingSession(userId, toolName) {
        for (const [sessionId, session] of this.activeSessions) {
            if (session.userId === userId && session.toolName === toolName) {
                return sessionId;
            }
        }
        return null;
    }
    setupServerHandlers(server, tools, getApiKey) {
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
            }
            catch (error) {
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
    async createSSEConnection(sessionId, toolName, res, apiKey) {
        try {
            await this.initialize();
            let session = this.activeSessions.get(sessionId);
            if (!session) {
                console.log(`🔄 Session ${sessionId} non trouvée en mémoire, tentative de reconstruction...`);
                const dbSessions = await McpService.getAllSessionsWithUrls();
                const dbSession = dbSessions.find(s => s.mcpUrl && s.mcpUrl.includes(sessionId) && s.toolName === toolName);
                if (dbSession) {
                    await this.recreateSession(sessionId, dbSession.userId, toolName, dbSession.accessKey);
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
            session.apiKey = apiKey;
            console.log(`🔌 Connexion SSE établie pour la session ${sessionId} (${toolName})`);
            const transport = new SSEServerTransport('/mcp/messages', res);
            await session.server.connect(transport);
        }
        catch (error) {
            console.error('❌ Erreur lors de la connexion SSE:', error);
            throw error;
        }
    }
    async getActiveSession(sessionId) {
        await this.initialize();
        let session = this.activeSessions.get(sessionId);
        if (!session) {
            console.log(`🔄 Session ${sessionId} non trouvée, tentative de reconstruction...`);
            const dbSessions = await McpService.getAllSessionsWithUrls();
            const dbSession = dbSessions.find(s => s.mcpUrl && s.mcpUrl.includes(sessionId));
            if (dbSession) {
                try {
                    await this.recreateSession(sessionId, dbSession.userId, dbSession.toolName, dbSession.accessKey);
                    session = this.activeSessions.get(sessionId);
                    console.log(`✅ Session ${sessionId} reconstruite`);
                }
                catch (error) {
                    console.error(`❌ Erreur reconstruction session ${sessionId}:`, error);
                }
            }
        }
        return session;
    }
    getToolConfig(toolName) {
        return this.toolConfigs.get(toolName.toLowerCase());
    }
    removeSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            console.log(`🗑️ Suppression de la session MCP ${sessionId}`);
            this.activeSessions.delete(sessionId);
            return true;
        }
        return false;
    }
    cleanupExpiredSessions() {
        const now = new Date();
        const expiredSessions = [];
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
    getSessionStats() {
        return {
            totalSessions: this.activeSessions.size,
            sessionsByTool: Array.from(this.activeSessions.values()).reduce((acc, session) => {
                acc[session.toolName] = (acc[session.toolName] || 0) + 1;
                return acc;
            }, {})
        };
    }
}
