import express, { type Express } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { apiRouter } from './api.js';
import { connectorCount } from './connectors/registry.js';
import { env } from './core/env.js';
import { logger } from './core/logger.js';
import { checkDatabase } from './core/prisma.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { mcpRouter } from './mcp/router.js';
import { wellKnownRouter } from './mcp/well-known.js';
import { MCP_SCOPE, oauthProvider } from './modules/oauth/provider.js';
import { mountWeb } from './web/serve.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { globalLimiter } from './middleware/rate-limit.js';
import { cors, csrfGuard, securityHeaders } from './middleware/security.js';

/**
 * Fabrique de l'application Express.
 *
 * Séparée de `index.ts` pour que les tests puissent monter l'application sans
 * ouvrir de port ni démarrer les tâches de fond.
 */
export function createApp(): Express {
  const app = express();

  // Railway place l'application derrière un proxy : sans ça, `req.ip` renvoie
  // l'IP du proxy (limitation de débit inopérante) et les cookies `secure`
  // ne sont pas posés.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        // Les fichiers statiques et le health check noient les journaux.
        ignore: (req) =>
          req.url === '/health' || Boolean(req.url?.startsWith('/assets/')),
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  app.use(securityHeaders);
  app.use(cors);
  app.use(cookieParser(env.sessionSecret));
  app.use(globalLimiter);

  // --- Santé -------------------------------------------------------------
  app.get('/health', async (_req, res) => {
    const databaseUp = await checkDatabase();
    const memory = process.memoryUsage();

    res.status(databaseUp ? 200 : 503).json({
      status: databaseUp ? 'ok' : 'degraded',
      version: '2.0.0',
      environment: env.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      database: databaseUp ? 'up' : 'down',
      connectors: connectorCount(),
      memoryMb: {
        used: Math.round(memory.heapUsed / 1024 / 1024),
        total: Math.round(memory.heapTotal / 1024 / 1024),
      },
    });
  });

  // --- Serveur d'autorisation OAuth 2.1 -----------------------------------
  // Doit être monté à la racine : la spécification impose des chemins fixes
  // (/.well-known/…, /authorize, /token, /register). C'est ce qui permet à un
  // client IA de tout découvrir à partir de la seule URL du connecteur.
  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: new URL(env.baseUrl),
      baseUrl: new URL(env.baseUrl),
      scopesSupported: [MCP_SCOPE],
      resourceName: 'MCP Wesype',
      serviceDocumentationUrl: new URL(`${env.baseUrl}/catalogue`),
    }),
  );
  app.use('/.well-known', wellKnownRouter);

  // --- Transport MCP -----------------------------------------------------
  // Monté avant l'API : il gère lui-même son parsing de corps et n'est pas
  // soumis à la protection CSRF (ses appelants sont des serveurs, pas des
  // navigateurs, et ils s'authentifient par jeton dédié).
  app.use('/mcp', mcpRouter);

  // --- API REST ----------------------------------------------------------
  /**
   * Les réponses de l'API sont calculées à chaque appel : impossible de les
   * précompresser comme les assets. Le seuil par défaut de 1 ko évite de
   * compresser les accusés de réception, où l'en-tête coûterait plus que le
   * corps.
   */
  app.use('/api', compression(), express.json({ limit: '256kb' }), csrfGuard, apiRouter);
  app.use('/api', notFoundHandler);

  // --- Interface web (SPA React construite par Vite) ----------------------
  mountWeb(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
