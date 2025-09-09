import express from 'express';
import { McpController } from '../controllers/mcp.controller.js';
import { rateLimit } from '../middleware/validation.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Routes pour les sessions MCP avec rate limiting et authentification
router.post('/sessions', 
  requireAuth,
  rateLimit(20, 300000), // 20 créations de sessions par 5 minutes
  McpController.createSession
);

router.get('/sessions', 
  requireAuth,
  McpController.getSessions
);

router.get('/sessions/:toolName/check', 
  requireAuth,
  McpController.checkToolSession
);

router.delete('/sessions/:toolName', 
  requireAuth,
  rateLimit(10, 60000), // 10 suppressions par minute
  McpController.deleteSession
);

// Route pour valider une clé API avec rate limiting et authentification
router.post('/validate',
  requireAuth,
  rateLimit(15, 300000), // 15 validations par 5 minutes
  McpController.validateApiKey
);

export default router;
