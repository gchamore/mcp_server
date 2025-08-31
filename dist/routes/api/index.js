import express from 'express';
import authRouter from '../auth.js';
import mcpRouter from '../mcp.js';
import { config } from '../../config/app.js';
const router = express.Router();
router.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (!config.isProduction) {
        console.log(`📡 API ${req.method} ${req.path} from ${req.ip}`);
    }
    next();
});
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
            health: '/health'
        }
    });
});
router.use('/auth', authRouter);
router.use('/mcp', mcpRouter);
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
