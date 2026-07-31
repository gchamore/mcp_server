import { Router, type Request, type Response } from 'express';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { listConnectors } from '../connectors/registry.js';
import { env } from '../core/env.js';
import { logger } from '../core/logger.js';
import { mcpLimiter } from '../middleware/rate-limit.js';
import {
  recordToolInvocation,
  touchEndpoint,
} from '../modules/endpoints/endpoint.service.js';
import { oauthProvider } from '../modules/oauth/provider.js';
import { buildMcpServer } from './server-factory.js';
import { isFailure, resolveFromAuthInfo, resolveFromUrlToken, type McpContext } from './resolve.js';

/**
 * Transport MCP « Streamable HTTP », avec deux façons de s'authentifier.
 *
 * ┌── 1. OAuth 2.1 (recommandé) ────────────────────────────────────────────┐
 * │  URL publique et stable : https://…/mcp/gmail                           │
 * │  Le client IA appelle sans jeton → 401 + WWW-Authenticate → il découvre  │
 * │  nos métadonnées, s'enregistre, ouvre le navigateur, l'utilisateur       │
 * │  consent, et le client repart avec un jeton. Aucun secret à copier.      │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ┌── 2. Jeton statique dans l'URL (repli) ─────────────────────────────────┐
 * │  https://…/mcp/gmail/mcp_xxxxx — pour les clients sans OAuth.           │
 * │  Toujours un compte partagé : l'URL EST l'identité.                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Dans les deux cas, un serveur MCP est créé par requête puis détruit : aucun
 * état en mémoire, donc rien à reconstruire après un redémarrage.
 */

export const mcpRouter: Router = Router();

mcpRouter.use(mcpLimiter);
mcpRouter.use(express.json({ limit: '4mb' }));

/** Informations publiques : le catalogue et les modes de connexion. */
mcpRouter.get('/', (_req, res) => {
  res.json({
    name: 'MCP Wesype',
    version: '2.0.0',
    transport: 'streamable-http',
    authorization: {
      type: 'oauth2',
      note: "Collez l'URL d'un connecteur dans votre client IA : la configuration se fait automatiquement.",
      metadata: `${env.baseUrl}/.well-known/oauth-authorization-server`,
    },
    connectors: listConnectors().map((connector) => ({
      id: connector.id,
      name: connector.name,
      url: `${env.baseUrl}/mcp/${connector.id}`,
      tools: connector.tools.length,
    })),
  });
});

/**
 * Chemin OAuth. `requireBearerAuth` renvoie un 401 accompagné de
 * `WWW-Authenticate: Bearer resource_metadata="…"` — c'est précisément cet
 * en-tête qui déclenche la découverte automatique côté client.
 */
const bearerAuthFor = (connectorId: string) =>
  requireBearerAuth({
    verifier: oauthProvider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
      new URL(`${env.baseUrl}/mcp/${connectorId}`),
    ),
  });

/**
 * Préfixe des jetons de point d'accès (voir `endpoint.service.ts`).
 *
 * Il permet de distinguer, dans un en-tête `Authorization: Bearer`, un jeton de
 * point d'accès d'un jeton OAuth — les deux transitent au même endroit.
 */
const ENDPOINT_TOKEN_PREFIX = 'mcp_';

/**
 * Jeton de point d'accès présenté en en-tête.
 *
 * Dust propose trois modes d'authentification pour un serveur MCP distant :
 * « Automatic » (OAuth avec enregistrement dynamique), « Static OAuth », et
 * « Bearer Token » — ce dernier envoie simplement un jeton que l'on colle, en
 * en-tête `Authorization`.
 *
 * C'est le mode qui convient aux connecteurs à clé API, où il n'y a rien à
 * négocier : la personne crée son point d'accès chez nous, copie le jeton, le
 * colle dans Dust, et c'est fini. Sans cette prise en charge, ces connecteurs
 * n'étaient utilisables que via le jeton dans le chemin d'URL — que Dust ne
 * sait pas produire.
 *
 * Aucun élargissement de la surface d'attaque : c'est exactement le jeton de
 * `/mcp/:connectorId/:token`, avec la même portée et la même révocation. Un
 * en-tête est même préférable à un segment d'URL, qui se retrouve dans les
 * journaux d'accès et les en-têtes `Referer`.
 */
function endpointTokenFromHeader(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;

  const token = header.slice('Bearer '.length).trim();
  return token.startsWith(ENDPOINT_TOKEN_PREFIX) ? token : null;
}

const oauthHandler = async (req: Request, res: Response) => {
  const connectorId = req.params.connectorId as string;

  // Jeton de point d'accès en en-tête : on le traite sans passer par OAuth,
  // qui répondrait 401 sur un jeton qu'il ne connaît pas.
  const endpointToken = endpointTokenFromHeader(req);
  if (endpointToken) {
    await serve(req, res, await resolveFromUrlToken(endpointToken, connectorId));
    return;
  }

  // Le middleware est construit par connecteur pour que l'en-tête
  // WWW-Authenticate désigne la bonne ressource.
  await new Promise<void>((resolve) => {
    bearerAuthFor(connectorId)(req, res, () => resolve());
  });

  // Le middleware a déjà répondu (401/403) si le jeton est absent ou invalide.
  if (res.headersSent || !req.auth) return;

  const resolved = await resolveFromAuthInfo(req.auth, connectorId);
  await serve(req, res, resolved);
};

const urlTokenHandler = async (req: Request, res: Response) => {
  const connectorId = req.params.connectorId as string;
  const token = req.params.token as string;

  const resolved = await resolveFromUrlToken(token, connectorId);
  await serve(req, res, resolved);
};

// Les trois verbes du transport : POST (requêtes), GET (flux SSE), DELETE (fin).
for (const method of ['post', 'get', 'delete'] as const) {
  mcpRouter[method]('/:connectorId/:token', urlTokenHandler);
  mcpRouter[method]('/:connectorId', oauthHandler);
}

async function serve(
  req: Request,
  res: Response,
  resolved: Awaited<ReturnType<typeof resolveFromAuthInfo>>,
): Promise<void> {
  if (isFailure(resolved)) {
    const status = resolved.reason === 'unauthorized' ? 401 : resolved.reason === 'not-found' ? 404 : 403;
    sendJsonRpcError(res, status, -32001, resolved.message);
    return;
  }

  const context: McpContext = resolved;

  const server = buildMcpServer(context.connector, {
    connectionId: context.connection.id,
    connectorId: context.connector.id,
    endpointId: context.endpointId,
    credentials: context.credentials,
    onToolCall: (event) =>
      recordToolInvocation({
        connectionId: context.connection.id,
        endpointId: context.endpointId,
        connectorId: context.connector.id,
        ...event,
      }),
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => {
    void transport.close().catch(() => undefined);
    void server.close().catch(() => undefined);
  });

  try {
    await server.connect(transport);
    if (context.endpointId) touchEndpoint(context.endpointId, context.connection.id);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error(
      { err: error, connector: context.connector.id, origin: context.origin },
      'Erreur pendant le traitement MCP',
    );
    if (!res.headersSent) sendJsonRpcError(res, 500, -32603, 'Erreur interne du serveur MCP.');
  }
}

/** Les clients MCP attendent du JSON-RPC, y compris sur les erreurs de transport. */
function sendJsonRpcError(res: Response, status: number, code: number, message: string): void {
  if (res.headersSent) return;
  res.status(status).json({ jsonrpc: '2.0', id: null, error: { code, message } });
}
