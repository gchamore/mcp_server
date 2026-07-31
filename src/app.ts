import path from 'node:path';
import express, { type Express } from 'express';
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
  app.use('/api', express.json({ limit: '256kb' }), csrfGuard, apiRouter);
  app.use('/api', notFoundHandler);

  // --- Interface web (SPA React construite par Vite) ----------------------
  const webRoot = path.resolve(process.cwd(), 'web', 'dist');

  app.use(
    express.static(webRoot, {
      // Les fichiers d'assets sont hachés par Vite : cache long sans risque.
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  // Routage côté client : toute URL inconnue renvoie index.html.
  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/mcp')) {
      next();
      return;
    }
    res.sendFile(path.join(webRoot, 'index.html'), (error) => {
      if (error) {
        // Cas typique : `npm run build:web` n'a pas encore tourné.
        res
          .status(503)
          .type('text/plain')
          .send("Interface web non construite. Lancez : npm run build:web");
      }
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
