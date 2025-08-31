import express from 'express';
import { DynamicMcpController } from '../controllers/dynamic-mcp.controller.js';

const router = express.Router();

// Routes pour la gestion des sessions MCP dynamiques

/**
 * POST /mcp/create-session
 * Créer une nouvelle session MCP pour un outil
 */
router.post('/create-session', DynamicMcpController.createMcpSession);

/**
 * GET /mcp/:sessionId/:toolName/sse
 * Connexion SSE pour une session MCP spécifique
 */
router.get('/:sessionId/:toolName/sse', DynamicMcpController.handleSSEConnection);

/**
 * POST /mcp/:sessionId/:toolName/messages
 * Endpoint pour les messages MCP
 */
router.post('/:sessionId/:toolName/messages', DynamicMcpController.handleMcpMessages);

/**
 * GET /mcp/:sessionId/:toolName
 * Informations sur une session MCP
 */
router.get('/:sessionId/:toolName', DynamicMcpController.getSessionInfo);

/**
 * DELETE /mcp/sessions/:sessionId
 * Supprimer une session MCP
 */
router.delete('/sessions/:sessionId', DynamicMcpController.deleteSession);

/**
 * GET /mcp/stats
 * Statistiques des sessions MCP
 */
router.get('/admin/stats', DynamicMcpController.getStats);

/**
 * POST /mcp/admin/cleanup
 * Nettoyage des sessions expirées
 */
router.post('/admin/cleanup', DynamicMcpController.cleanup);

/**
 * GET /mcp/health
 * Endpoint de santé du service MCP
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'Dynamic MCP Service',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

/**
 * GET /mcp/
 * Informations générales sur le service MCP
 */
router.get('/', (req, res) => {
  res.json({
    success: true,
    name: 'MCP Wesype Dynamic Service',
    version: '1.0.0',
    description: 'Service de gestion dynamique des sessions MCP',
    endpoints: {
      createSession: '/mcp/create-session',
      sse: '/mcp/:sessionId/:toolName/sse',
      messages: '/mcp/:sessionId/:toolName/messages',
      sessionInfo: '/mcp/:sessionId/:toolName',
      deleteSession: '/mcp/sessions/:sessionId',
      stats: '/mcp/admin/stats',
      cleanup: '/mcp/admin/cleanup',
      health: '/mcp/health'
    },
    supportedTools: ['axonaut'],
    documentation: 'https://docs.mcpwesype.com'
  });
});

export default router;
