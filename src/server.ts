import express from 'express';
import { config, setupMiddleware, setupErrorHandling } from './config/app.js';
import indexRouter from './routes/index.js';
import apiRouter from './routes/api/index.js';
import dynamicMcpRouter from './routes/dynamic-mcp.js';
import { DynamicMcpService } from './services/dynamic-mcp.service.js';
import { McpService } from './services/mcp.service.js';

const app = express();

// Configuration des middlewares de base
setupMiddleware(app);

// Routes principales
app.use('/', indexRouter);

// Routes API (structure scalable)
app.use('/api', apiRouter);

// Routes MCP dynamiques
app.use('/mcp', dynamicMcpRouter);

// Configuration de la gestion d'erreurs (doit être en dernier)
setupErrorHandling(app);

// Démarrage du serveur avec initialisation du service MCP
app.listen(config.PORT, async () => {
  console.log(`MCP Wesype Server running on port ${config.PORT}`);
  console.log(`Environment: ${config.NODE_ENV}`);
  console.log(`URL: ${config.BASE_URL}`);
  console.log(`Platform: ${config.isRailway ? 'Railway' : 'Local'}`);
  console.log(`Database: ${config.DATABASE_URL ? 'Connected' : 'Not configured'}`);
  
  // Initialiser le service MCP pour reconstruire les sessions existantes
  try {
    // D'abord, migrer les clés non chiffrées
    await McpService.migrateUnencryptedKeys();
    
    // Ensuite, initialiser le service MCP
    const mcpService = DynamicMcpService.getInstance();
    await mcpService.initialize();
    console.log(`✅ Service MCP initialisé avec succès`);
  } catch (error) {
    console.error(`❌ Erreur lors de l'initialisation du service MCP:`, error);
  }
  
  console.log(`Ready to handle requests!`);
});

export default app;
