import { Router } from 'express';
import path from 'path';
import { config } from '../config/app.js';
import { prisma, withRetry } from '../lib/prisma.js';
const indexRouter = Router();
indexRouter.get('/', (req, res) => {
    res.sendFile(path.join(config.__dirname, '../../public/index.html'));
});
indexRouter.get('/reset-password', (req, res) => {
    res.sendFile(path.join(config.__dirname, '../../public/reset-password.html'));
});
indexRouter.get('/health', async (req, res) => {
    try {
        await withRetry(async () => {
            await prisma.$queryRaw `SELECT 1`;
        });
        res.json({
            status: 'OK',
            service: 'MCP Wesype Server',
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            environment: config.NODE_ENV,
            database: 'Connected',
            uptime: process.uptime(),
            memory: {
                used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
            }
        });
    }
    catch (error) {
        console.error('❌ Erreur de santé de la DB:', error);
        res.status(503).json({
            status: 'ERROR',
            service: 'MCP Wesype Server',
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            environment: config.NODE_ENV,
            database: 'Disconnected',
            error: 'Database connection failed'
        });
    }
});
indexRouter.get('/api/info', (req, res) => {
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
