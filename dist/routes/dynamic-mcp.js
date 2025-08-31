import express from 'express';
import { DynamicMcpController } from '../controllers/dynamic-mcp.controller.js';
const router = express.Router();
router.post('/create-session', DynamicMcpController.createMcpSession);
router.get('/:sessionId/:toolName/sse', DynamicMcpController.handleSSEConnection);
router.post('/:sessionId/:toolName/messages', DynamicMcpController.handleMcpMessages);
router.get('/:sessionId/:toolName', DynamicMcpController.getSessionInfo);
router.post('/:sessionId/:toolName', DynamicMcpController.handleMcpMessages);
router.delete('/sessions/:sessionId', DynamicMcpController.deleteSession);
router.get('/admin/stats', DynamicMcpController.getStats);
router.post('/admin/cleanup', DynamicMcpController.cleanup);
router.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        service: 'Dynamic MCP Service',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});
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
