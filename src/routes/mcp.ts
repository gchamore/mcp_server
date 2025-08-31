import express from 'express';
import { McpController } from '../controllers/mcp.controller.js';

const router = express.Router();

// Routes pour les sessions MCP
router.post('/sessions', McpController.createSession);
router.get('/sessions', McpController.getSessions);
router.get('/sessions/:toolName/check', McpController.checkToolSession);
router.delete('/sessions/:toolName', McpController.deleteSession);

// Route pour valider une clé API
router.post('/validate', McpController.validateApiKey);

export default router;
