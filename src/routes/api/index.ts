import express from 'express';
import authRouter from '../auth.js';
import mcpRouter from '../mcp.js';
import passwordRouter from '../password.js';
import { config } from '../../config/app.js';

const router = express.Router();

// Middleware pour toutes les routes API
router.use((req, res, next) => {
  // Ajouter les headers CORS
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Log des requêtes API (seulement en développement)
  if (!config.isProduction) {
    console.log(`📡 API ${req.method} ${req.path} from ${req.ip}`);
  }
  
  next();
});

// Route de base API
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'MCP Wesype API',
    version: '1.0.0',
    environment: config.isRailway ? 'railway' : 'local',
    baseUrl: config.BASE_URL,
    endpoints: {
      auth: '/api/auth',
      mcp: '/api/mcp',
      password: '/api/password',
      health: '/health'
    }
  });
});

// Routes d'authentification
router.use('/auth', authRouter);

// Routes MCP
router.use('/mcp', mcpRouter);

// Routes de gestion des mots de passe
router.use('/password', passwordRouter);

// Route de santé de l'API
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'OK',
    service: 'MCP Wesype API',
    timestamp: new Date().toISOString(),
    environment: config.NODE_ENV,
    platform: config.isRailway ? 'Railway' : 'Local',
    database: config.DATABASE_URL ? 'Connected' : 'Not configured'
  });
});

export default router;
