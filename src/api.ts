import { Router } from 'express';
import { connectorCount } from './connectors/registry.js';
import { env } from './core/env.js';
import { adminRouter } from './modules/admin/admin.router.js';
import { authRouter } from './modules/auth/auth.router.js';
import { catalogRouter } from './modules/catalog/catalog.router.js';
import { connectionRouter } from './modules/connections/connection.router.js';
import { oauthRouter } from './modules/oauth/oauth.router.js';
import { optionalAuth } from './middleware/auth.js';

/** Assemblage de l'API REST sous /api. */
export const apiRouter: Router = Router();

// La session est résolue une fois pour toutes : les routeurs en aval lisent
// simplement `req.currentUser`, sans re-parser d'en-tête chacun de leur côté.
apiRouter.use(optionalAuth);

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'MCP Wesype API',
    version: '2.0.0',
    environment: env.nodeEnv,
    connectors: connectorCount(),
    endpoints: {
      auth: '/api/auth',
      catalog: '/api/connectors',
      connections: '/api/connections',
      admin: '/api/admin',
      mcp: '/mcp',
    },
  });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/oauth', oauthRouter);
apiRouter.use('/connectors', catalogRouter);
apiRouter.use('/connections', connectionRouter);
apiRouter.use('/admin', adminRouter);
