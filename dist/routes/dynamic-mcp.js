import express from 'express';
import { DynamicMcpController } from '../controllers/dynamic-mcp.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/validation.js';
const router = express.Router();
router.post('/create-session', requireAuth, rateLimit(10, 300000), DynamicMcpController.createMcpSession);
router.get('/:sessionId/:toolName/sse', rateLimit(30, 60000), DynamicMcpController.handleSSEConnection);
router.post('/:sessionId/:toolName/messages', rateLimit(100, 60000), DynamicMcpController.handleMcpMessages);
router.get('/:sessionId/:toolName', DynamicMcpController.getSessionInfo);
router.post('/:sessionId/:toolName', rateLimit(50, 60000), DynamicMcpController.handleMcpMessages);
router.delete('/sessions/:sessionId', requireAuth, rateLimit(20, 300000), DynamicMcpController.deleteSession);
router.get('/admin/stats', requireAuth, requireAdmin, DynamicMcpController.getStats);
router.post('/admin/cleanup', requireAuth, requireAdmin, rateLimit(5, 300000), DynamicMcpController.cleanup);
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
