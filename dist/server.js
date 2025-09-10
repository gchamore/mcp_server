import express from 'express';
import { config, setupMiddleware, setupErrorHandling } from './config/app.js';
import indexRouter from './routes/index.js';
import apiRouter from './routes/api/index.js';
import dynamicMcpRouter from './routes/dynamic-mcp.js';
import { DynamicMcpService } from './services/dynamic-mcp.service.js';
import { McpService } from './services/mcp.service.js';
import { EmailService } from './services/email.service.js';
import { PasswordService } from './services/password.service.js';
import { startConnectionHealthCheck } from './lib/prisma.js';
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
    startConnectionHealthCheck();
    console.log(`✅ Surveillance de la connexion DB activée`);
    try {
        await EmailService.initialize();
        const emailStatus = EmailService.getStatus();
        if (emailStatus.configured) {
            console.log(`✅ Service d'email initialisé (${emailStatus.provider})`);
        }
        else {
            console.log(`⚠️  Service d'email non configuré`);
        }
    }
    catch (error) {
        console.error(`❌ Erreur lors de l'initialisation du service email:`, error);
    }
    setInterval(async () => {
        try {
            const cleanedCount = await PasswordService.cleanupExpiredTokens();
            if (cleanedCount > 0) {
                console.log(`🧹 ${cleanedCount} tokens de réinitialisation expirés nettoyés`);
            }
        }
        catch (error) {
            console.error('❌ Erreur lors du nettoyage des tokens:', error);
        }
    }, 60 * 60 * 1000);
    try {
        await McpService.migrateUnencryptedKeys();
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
