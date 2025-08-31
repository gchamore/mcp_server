import { DynamicMcpService } from '../services/dynamic-mcp.service.js';
import { AuthService } from '../services/auth.service.js';
import { McpService } from '../services/mcp.service.js';
export class DynamicMcpController {
    static async createMcpSession(req, res) {
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
            const hasSession = await McpService.hasToolSession(userId, toolName);
            if (!hasSession) {
                return res.status(400).json({
                    success: false,
                    error: `Outil ${toolName} non configuré. Veuillez d'abord ajouter votre clé API.`
                });
            }
            const result = await this.mcpService.createMcpSession(userId, toolName);
            console.log(`🚀 Session MCP créée: ${result.sessionId} pour ${toolName}`);
            res.status(201).json({
                success: true,
                sessionId: result.sessionId,
                url: result.url,
                toolName,
                message: 'Session MCP créée avec succès'
            });
        }
        catch (error) {
            console.error('Erreur création session MCP:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Erreur lors de la création de la session MCP'
            });
        }
    }
    static async handleSSEConnection(req, res) {
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
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Cache-Control'
            });
            await this.mcpService.createSSEConnection(sessionId, toolName, res, apiKey);
        }
        catch (error) {
            console.error('❌ Erreur SSE MCP:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: error instanceof Error ? error.message : 'Erreur de connexion MCP'
                });
            }
        }
    }
    static async handleMcpMessages(req, res) {
        try {
            const { sessionId, toolName } = req.params;
            console.log(`📨 Message MCP reçu pour ${sessionId}/${toolName}:`, req.body);
            const session = this.mcpService.getActiveSession(sessionId);
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
                status: 'received',
                sessionId,
                toolName
            });
        }
        catch (error) {
            console.error('❌ Erreur message MCP:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Erreur lors du traitement du message'
            });
        }
    }
    static async getSessionInfo(req, res) {
        try {
            const { sessionId, toolName } = req.params;
            const session = this.mcpService.getActiveSession(sessionId);
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
        }
        catch (error) {
            console.error('❌ Erreur info session MCP:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Erreur lors de la récupération des informations'
            });
        }
    }
    static async deleteSession(req, res) {
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
            const session = this.mcpService.getActiveSession(sessionId);
            if (!session) {
                return res.status(404).json({
                    success: false,
                    error: 'Session MCP non trouvée'
                });
            }
            if (session.userId !== userId) {
                return res.status(403).json({
                    success: false,
                    error: 'Accès refusé à cette session'
                });
            }
            const removed = this.mcpService.removeSession(sessionId);
            if (removed) {
                console.log(`🗑️ Session MCP supprimée: ${sessionId}`);
                res.json({
                    success: true,
                    message: 'Session MCP supprimée avec succès'
                });
            }
            else {
                res.status(404).json({
                    success: false,
                    error: 'Session non trouvée'
                });
            }
        }
        catch (error) {
            console.error('❌ Erreur suppression session MCP:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Erreur lors de la suppression'
            });
        }
    }
    static async getStats(req, res) {
        try {
            const stats = this.mcpService.getSessionStats();
            res.json({
                success: true,
                stats,
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            console.error('❌ Erreur stats MCP:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Erreur lors de la récupération des statistiques'
            });
        }
    }
    static async cleanup(req, res) {
        try {
            this.mcpService.cleanupExpiredSessions();
            res.json({
                success: true,
                message: 'Nettoyage des sessions expirées effectué'
            });
        }
        catch (error) {
            console.error('❌ Erreur nettoyage MCP:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Erreur lors du nettoyage'
            });
        }
    }
}
DynamicMcpController.mcpService = new DynamicMcpService();
