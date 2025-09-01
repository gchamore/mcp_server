import express from 'express';
import { config, setupMiddleware, setupErrorHandling } from './config/app.js';
import indexRouter from './routes/index.js';
import apiRouter from './routes/api/index.js';
import dynamicMcpRouter from './routes/dynamic-mcp.js';
import { DynamicMcpService } from './services/dynamic-mcp.service.js';
const app = express();
setupMiddleware(app);
app.use('/', indexRouter);
app.use('/api', apiRouter);
app.use('/mcp', dynamicMcpRouter);
setupErrorHandling(app);
app.listen(config.PORT, async () => {
    console.log(`MCP Wesype Server running on port ${config.PORT}`);
    console.log(`Environment: ${config.NODE_ENV}`);
    console.log(`URL: ${config.BASE_URL}`);
    console.log(`Platform: ${config.isRailway ? 'Railway' : 'Local'}`);
    console.log(`Database: ${config.DATABASE_URL ? 'Connected' : 'Not configured'}`);
    try {
        const mcpService = DynamicMcpService.getInstance();
        await mcpService.initialize();
        console.log(`✅ Service MCP initialisé avec succès`);
    }
    catch (error) {
        console.error(`❌ Erreur lors de l'initialisation du service MCP:`, error);
    }
    console.log(`Ready to handle requests!`);
});
export default app;
