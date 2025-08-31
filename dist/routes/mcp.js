import express from 'express';
import { McpController } from '../controllers/mcp.controller.js';
const router = express.Router();
router.post('/sessions', McpController.createSession);
router.get('/sessions', McpController.getSessions);
router.get('/sessions/:toolName/check', McpController.checkToolSession);
router.delete('/sessions/:toolName', McpController.deleteSession);
router.post('/validate', McpController.validateApiKey);
export default router;
