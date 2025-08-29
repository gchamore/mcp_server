import { Router, Request, Response } from 'express';
import path from 'path';
import { config } from '../config/app.js';

const indexRouter = Router();

/**
 * GET /
 * Page d'accueil de l'application
 */
indexRouter.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(config.__dirname, '../../public/index.html'));
});

/**
 * GET /health
 * Endpoint de santé du serveur
 */
indexRouter.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'OK', 
    service: 'MCP Wesype Server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: config.NODE_ENV,
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
    }
  });
});

/**
 * GET /api/info
 * Informations générales sur l'API
 */
indexRouter.get('/api/info', (req: Request, res: Response) => {
  res.json({
    name: 'MCP Wesype API',
    version: '1.0.0',
    description: 'Model Context Protocol Platform API',
    endpoints: {
      auth: '/api/auth',
      health: '/health',
      info: '/api/info'
    },
    environment: config.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

export default indexRouter;
