import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AnyConnector, Credentials, ToolResult } from '../connectors/types.js';
import { errorMessage } from '../core/errors.js';
import { logger } from '../core/logger.js';

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

export function buildMcpServer(
  connector: AnyConnector,
  context: McpServerContext,
): McpServer {
  const server = new McpServer(
    { name: `wesype-${connector.id}`, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        `Outils ${connector.name} fournis par MCP Wesype. ${connector.description}\n` +
        `Les listes sont paginées : si un résultat semble tronqué, rappeler l'outil avec la page suivante.`,
    },
  );

  const toolLogger = logger.child({
    connector: connector.id,
    connectionId: context.connectionId,
  });

  for (const tool of connector.tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.annotations ? { annotations: { title: tool.title, ...tool.annotations } } : {}),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (args: any, extra: { signal: AbortSignal }): Promise<CallToolResult> => {
        const startedAt = Date.now();
        try {
          const result = await tool.handler(args, {
            credentials: context.credentials,
            connectionId: context.connectionId,
            logger: toolLogger,
            signal: extra.signal,
          });

          context.onToolCall?.({
            toolName: tool.name,
            success: true,
            durationMs: Date.now() - startedAt,
          });

          return toCallToolResult(result);
        } catch (error) {
          const message = errorMessage(error);

          context.onToolCall?.({
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
          toolLogger.warn({ err: error, tool: tool.name }, "Échec d'exécution d'un outil MCP");

          return {
            content: [{ type: 'text', text: `Échec de l'appel à ${tool.name} : ${message}` }],
            isError: true,
          };
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
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
