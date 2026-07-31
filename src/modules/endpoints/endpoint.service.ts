import type { Connection, McpEndpoint } from '@prisma/client';
import { getConnector } from '../../connectors/registry.js';
import type { ConnectorDefinition, Credentials } from '../../connectors/types.js';
import { decryptJson, encryptJson, generateToken, hashToken } from '../../core/crypto.js';
import { env } from '../../core/env.js';
import { logger } from '../../core/logger.js';
import { prisma } from '../../core/prisma.js';

/**
 * Points d'accès MCP.
 *
 * Un endpoint est un secret révocable qui pointe vers une connexion. C'est lui
 * qui corrige le trou de sécurité de la version précédente, où l'URL MCP
 * n'était protégée que par un UUID prévisible et sans aucune vérification.
 *
 * Le token n'est stocké que sous forme de SHA-256 : il est affiché une seule
 * fois, à la création, exactement comme une clé API.
 */

export type ResolvedEndpoint = {
  endpoint: McpEndpoint;
  connection: Connection;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connector: ConnectorDefinition<any>;
  credentials: Credentials;
};

function buildEndpointUrl(connectorId: string, token: string): string {
  return `${env.baseUrl}/mcp/${connectorId}/${token}`;
}

export async function createEndpoint(
  connectionId: string,
  connectorId: string,
  name = 'Point d’accès',
): Promise<{ endpoint: McpEndpoint; token: string; url: string }> {
  const token = generateToken('mcp');

  const endpoint = await prisma.mcpEndpoint.create({
    data: {
      connectionId,
      tokenHash: hashToken(token),
      tokenEncrypted: encryptJson(token),
      tokenHint: token.slice(-6),
      name,
    },
  });

  return { endpoint, token, url: buildEndpointUrl(connectorId, token) };
}

/**
 * Réaffiche l'URL complète d'un endpoint à son propriétaire. Utilisé par l'UI
 * (bouton « Révéler ») pour éviter d'avoir à régénérer un token à chaque fois
 * qu'on veut brancher un client IA supplémentaire.
 */
export function revealEndpointUrl(
  endpoint: Pick<McpEndpoint, 'tokenEncrypted'>,
  connectorId: string,
): string {
  return buildEndpointUrl(connectorId, decryptJson<string>(endpoint.tokenEncrypted));
}

/**
 * Résout un token en contexte d'exécution complet. Renvoie `null` pour toute
 * raison d'échec — jamais de détail : un appelant non autorisé ne doit pas
 * pouvoir distinguer « token inconnu » de « token révoqué ».
 */
export async function resolveEndpoint(token: string): Promise<ResolvedEndpoint | null> {
  const endpoint = await prisma.mcpEndpoint.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { connection: { include: { user: { select: { isActive: true } } } } },
  });

  if (!endpoint) return null;
  if (endpoint.revokedAt) return null;
  if (endpoint.expiresAt && endpoint.expiresAt.getTime() <= Date.now()) return null;
  if (!endpoint.connection.user.isActive) return null;

  const connector = getConnector(endpoint.connection.connectorId);
  if (!connector) {
    logger.error(
      { connectorId: endpoint.connection.connectorId, endpointId: endpoint.id },
      'Endpoint rattaché à un connecteur absent du registre',
    );
    return null;
  }

  let credentials: Credentials;
  try {
    credentials = decryptJson<Credentials>(endpoint.connection.credentials);
  } catch (error) {
    logger.error({ err: error, connectionId: endpoint.connectionId }, 'Déchiffrement impossible');
    return null;
  }

  const { user: _user, ...connection } = endpoint.connection;
  const { connection: _connection, ...endpointRow } = endpoint;

  return { endpoint: endpointRow as McpEndpoint, connection, connector, credentials };
}

/** Compteurs d'usage, en écriture « au mieux » : jamais bloquant pour l'appel MCP. */
export function touchEndpoint(endpointId: string, connectionId: string): void {
  const now = new Date();
  void Promise.all([
    prisma.mcpEndpoint.update({
      where: { id: endpointId },
      data: { lastUsedAt: now, callCount: { increment: 1 } },
    }),
    prisma.connection.update({ where: { id: connectionId }, data: { lastUsedAt: now } }),
  ]).catch((error: unknown) => {
    logger.warn({ err: error, endpointId }, "Mise à jour des compteurs d'usage échouée");
  });
}

export function recordToolInvocation(input: {
  connectionId: string;
  endpointId: string | null;
  connectorId: string;
  toolName: string;
  success: boolean;
  durationMs: number;
  errorCode?: string;
}): void {
  void prisma.toolInvocation
    .create({
      data: {
        connectionId: input.connectionId,
        endpointId: input.endpointId ?? null,
        connectorId: input.connectorId,
        toolName: input.toolName,
        success: input.success,
        durationMs: input.durationMs,
        errorCode: input.errorCode ?? null,
      },
    })
    .catch((error: unknown) => {
      logger.warn({ err: error }, "Journalisation d'un appel d'outil échouée");
    });
}
