import express from 'express';
import { config, setupMiddleware, setupErrorHandling } from './config/app.js';
import indexRouter from './routes/index.js';
import apiRouter from './routes/api/index.js';
import dynamicMcpRouter from './routes/dynamic-mcp.js';
import { validateEmail, validatePassword, validateRegistration, rateLimit } from './middleware/validation.js';

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

// Démarrage du serveur
app.listen(config.PORT, () => {
  console.log(`MCP Wesype Server running on port ${config.PORT}`);
  console.log(`Environment: ${config.NODE_ENV}`);
  console.log(`URL: ${config.BASE_URL}`);
  console.log(`Platform: ${config.isRailway ? 'Railway' : 'Local'}`);
  console.log(`Database: ${config.DATABASE_URL ? 'Connected' : 'Not configured'}`);
  console.log(`Ready to handle requests!`);
});

export default app;
