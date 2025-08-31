import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';
import { AxonautTools } from '../tools/axonaut.tools.js';
import { McpService } from './mcp.service.js';
export class DynamicMcpService {
    constructor() {
        this.activeSessions = new Map();
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
    async createMcpSession(userId, toolName) {
        try {
            console.log(`🔨 Création d'une session MCP ${toolName} pour l'utilisateur ${userId}`);
            const hasSession = await McpService.hasToolSession(userId, toolName);
            if (!hasSession) {
                throw new Error(`Aucune session trouvée pour l'outil ${toolName}. Veuillez d'abord configurer votre clé API.`);
            }
            const config = this.toolConfigs.get(toolName);
            if (!config) {
                throw new Error(`Outil ${toolName} non supporté`);
            }
            const sessionId = uuidv4();
            const dbSessions = await McpService.getUserSessions(userId);
            const dbSession = dbSessions.find((s) => s.toolName === toolName);
            if (!dbSession) {
                throw new Error(`Session ${toolName} non trouvée en base de données`);
            }
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
                apiKey: apiKey,
                server,
                createdAt: new Date()
            };
            this.activeSessions.set(sessionId, activeSession);
            const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
            const mcpUrl = `${baseUrl}/mcp/${sessionId}/${toolName}`;
            await McpService.updateSessionUrl(dbSession.id, mcpUrl);
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
                if (!apiKey) {
                    throw new Error('Clé API non configurée pour cette session');
                }
                const result = await tool.execute(args, apiKey);
                return {
                    content: [{
                            type: "text",
                            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                        }]
                };
            }
            catch (error) {
                console.error(`❌ Erreur lors de l'exécution de l'outil ${name}:`, error);
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
            const session = this.activeSessions.get(sessionId);
            if (!session) {
                throw new Error(`Session ${sessionId} non trouvée`);
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
    getActiveSession(sessionId) {
        return this.activeSessions.get(sessionId);
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
