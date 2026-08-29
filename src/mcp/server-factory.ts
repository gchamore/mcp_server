import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AnyConnector, Credentials, ToolResult } from '../connectors/types.js';
import { errorMessage } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { Logger } from 'pino';

/**
 * Construit un serveur MCP à partir d'une définition de connecteur.
 *
 * Un serveur est instancié par requête HTTP puis fermé : le transport est en
 * mode « stateless ». Conséquence importante — il n'existe plus aucun état MCP
 * en mémoire, donc plus rien à reconstruire après un redéploiement et rien qui
 * empêche de faire tourner plusieurs instances derrière un répartiteur.
 */

export interface McpServerContext {
  connectionId: string;
  connectorId: string;
  /** Outils retenus au consentement. null ou absent = tous. */
  allowedTools?: string[] | null;
  /** Nul sur le chemin OAuth : il n'y a pas de point d'accès statique. */
  endpointId: string | null;
  credentials: Credentials;
  /** Appelé après chaque exécution d'outil, pour les statistiques d'usage. */
  onToolCall?: (event: {
    toolName: string;
    success: boolean;
    durationMs: number;
    errorCode?: string;
  }) => void;
}

const SERVER_VERSION = '2.0.0';

export function buildMcpServer(connector: AnyConnector, context: McpServerContext): McpServer {
  const server = new McpServer(
    { name: `toolink-${connector.id}`, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        `Outils ${connector.name} fournis par Toolink. ${connector.description}\n` +
        `Les listes sont paginées : si un résultat semble tronqué, rappeler l'outil avec la page suivante.`,
    },
  );

  const toolLogger = logger.child({
    connector: connector.id,
    connectionId: context.connectionId,
  });

  const allowed = context.allowedTools ? new Set(context.allowedTools) : null;

  for (const tool of connector.tools) {
    if (allowed && !allowed.has(tool.name)) continue;
    registerConnectorTool(server, connector, tool, {
      prefix: '',
      credentials: context.credentials,
      connectionId: context.connectionId,
      logger: toolLogger,
      ...(context.onToolCall ? { onToolCall: context.onToolCall } : {}),
    });
  }

  return server;
}

interface ToolWiring {
  /** Préfixe du nom exposé — vide pour un connecteur seul, `gmail_` dans le hub. */
  prefix: string;
  credentials: Credentials;
  connectionId: string;
  logger: Logger;
  onToolCall?: McpServerContext['onToolCall'];
}

function registerConnectorTool(
  server: McpServer,
  connector: AnyConnector,
  tool: AnyConnector['tools'][number],
  wiring: ToolWiring,
): void {
  {
    server.registerTool(
      `${wiring.prefix}${tool.name}`,
      {
        title: wiring.prefix ? `${connector.name} — ${tool.title}` : tool.title,
        description: wiring.prefix
          ? `[${connector.name}] ${tool.description}`
          : tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.annotations ? { annotations: { title: tool.title, ...tool.annotations } } : {}),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (args: any, extra: { signal: AbortSignal }): Promise<CallToolResult> => {
        const startedAt = Date.now();
        try {
          const result = await tool.handler(args, {
            credentials: wiring.credentials,
            connectionId: wiring.connectionId,
            logger: wiring.logger,
            signal: extra.signal,
          });

          wiring.onToolCall?.({
            toolName: tool.name,
            success: true,
            durationMs: Date.now() - startedAt,
          });

          return toCallToolResult(result);
        } catch (error) {
          const message = errorMessage(error);

          wiring.onToolCall?.({
            toolName: tool.name,
            success: false,
            durationMs: Date.now() - startedAt,
            errorCode: error instanceof Error ? error.name : 'UnknownError',
          });

          /**
           * Le message part au modèle, donc potentiellement à un tiers.
           *
           * `core/http-client.ts` en est le garant : il ne restitue d'un
           * service distant que des champs de message reconnus, jamais le corps
           * brut, et il retire les valeurs d'authentification qu'il a lui-même
           * envoyées. Ce commentaire affirmait déjà cette garantie avant
           * qu'elle n'existe.
           */
          wiring.logger.warn({ err: error, tool: tool.name }, "Échec d'exécution d'un outil MCP");

          return {
            content: [{ type: 'text', text: `Échec de l'appel à ${tool.name} : ${message}` }],
            isError: true,
          };
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
  }
}

/**
 * Serveur MCP du hub : l'union des outils des connexions cochées.
 *
 * Chaque outil est exposé sous `<connecteur>_<nom>` — deux services déclarant
 * `get_account` ne se percutent pas — et son libellé porte le nom du service,
 * pour que le modèle sache à quoi il parle. La sélection faite au consentement
 * filtre ici : un outil décoché n'existe simplement pas pour ce jeton.
 */
export function buildHubMcpServer(
  entries: {
    connector: AnyConnector;
    connectionId: string;
    credentials: Credentials;
    allowedTools: string[] | null;
  }[],
  options: {
    onToolCall?: (
      event: {
        toolName: string;
        success: boolean;
        durationMs: number;
        errorCode?: string;
      } & { connectorId: string; connectionId: string },
    ) => void;
  } = {},
): McpServer {
  const server = new McpServer(
    { name: 'toolink-hub', version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        'Hub Toolink : plusieurs services derrière une seule connexion. ' +
        'Chaque outil est préfixé par le service qu’il pilote (ex. gmail_, axonaut_).\n' +
        'Les listes sont paginées : si un résultat semble tronqué, rappeler l’outil avec la page suivante.',
    },
  );

  for (const entry of entries) {
    const allowed = entry.allowedTools ? new Set(entry.allowedTools) : null;
    const toolLogger = logger.child({
      connector: entry.connector.id,
      connectionId: entry.connectionId,
      hub: true,
    });

    for (const tool of entry.connector.tools) {
      if (allowed && !allowed.has(tool.name)) continue;

      registerConnectorTool(server, entry.connector, tool, {
        prefix: `${entry.connector.id}_`,
        credentials: entry.credentials,
        connectionId: entry.connectionId,
        logger: toolLogger,
        ...(options.onToolCall
          ? {
              onToolCall: (event) =>
                options.onToolCall?.({
                  ...event,
                  connectorId: entry.connector.id,
                  connectionId: entry.connectionId,
                }),
            }
          : {}),
      });
    }
  }

  return server;
}

function toCallToolResult(result: ToolResult): CallToolResult {
  if (typeof result === 'string') {
    return { content: [{ type: 'text', text: result }] };
  }

  const payload: CallToolResult = { content: [{ type: 'text', text: result.text }] };

  // `structuredContent` doit être un objet JSON : on encapsule les tableaux.
  if (result.data !== undefined && result.data !== null) {
    payload.structuredContent = Array.isArray(result.data)
      ? { items: result.data }
      : (result.data as Record<string, unknown>);
  }

  return payload;
}
