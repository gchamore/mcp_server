import type { Connection, McpEndpoint } from '@prisma/client';
import {
  describeCredentials,
  parseCredentials,
  requireConnector,
  toSummary,
} from '../../connectors/registry.js';
import type { ConnectorSummary, Credentials } from '../../connectors/types.js';
import { conflict, notFound } from '../../core/errors.js';
import { decryptJson, encryptJson } from '../../core/crypto.js';
import { logger } from '../../core/logger.js';
import { prisma } from '../../core/prisma.js';
import { createEndpoint, revealEndpointUrl } from '../endpoints/endpoint.service.js';

/**
 * Gestion des connexions : une connexion = les identifiants d'un utilisateur
 * pour un connecteur donné, plus les points d'accès MCP qui en découlent.
 */

const VERIFY_TIMEOUT_MS = 15_000;

export type EndpointView = {
  id: string;
  name: string;
  tokenHint: string;
  callCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  revoked: boolean;
};

export type ConnectionView = {
  id: string;
  connectorId: string;
  label: string;
  status: Connection['status'];
  statusMessage: string | null;
  accountLabel: string | null;
  lastVerifiedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  credentials: { key: string; label: string; filled: boolean; preview: string }[];
  endpoints: EndpointView[];
  connector: ConnectorSummary;
};

function toEndpointView(endpoint: McpEndpoint): EndpointView {
  return {
    id: endpoint.id,
    name: endpoint.name,
    tokenHint: endpoint.tokenHint,
    callCount: endpoint.callCount,
    lastUsedAt: endpoint.lastUsedAt,
    createdAt: endpoint.createdAt,
    revoked: endpoint.revokedAt !== null,
  };
}

function toConnectionView(connection: Connection & { endpoints: McpEndpoint[] }): ConnectionView {
  const connector = requireConnector(connection.connectorId);

  let credentials: Credentials = {};
  try {
    credentials = decryptJson<Credentials>(connection.credentials);
  } catch (error) {
    // On n'échoue pas l'affichage de la liste pour une connexion illisible :
    // l'utilisateur doit pouvoir la voir pour la corriger ou la supprimer.
    logger.error({ err: error, connectionId: connection.id }, 'Identifiants illisibles');
  }

  return {
    id: connection.id,
    connectorId: connection.connectorId,
    label: connection.label,
    status: connection.status,
    statusMessage: connection.statusMessage,
    accountLabel: connection.accountLabel,
    lastVerifiedAt: connection.lastVerifiedAt,
    lastUsedAt: connection.lastUsedAt,
    createdAt: connection.createdAt,
    credentials: describeCredentials(connector, credentials),
    endpoints: connection.endpoints
      .filter((endpoint) => !endpoint.revokedAt)
      .map(toEndpointView),
    connector: toSummary(connector),
  };
}

export async function listConnections(userId: string): Promise<ConnectionView[]> {
  const connections = await prisma.connection.findMany({
    where: { userId },
    include: { endpoints: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });

  return connections.map(toConnectionView);
}

export async function getConnection(userId: string, connectionId: string): Promise<ConnectionView> {
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, userId },
    include: { endpoints: { orderBy: { createdAt: 'asc' } } },
  });

  if (!connection) throw notFound('Connexion introuvable.');
  return toConnectionView(connection);
}

/** Teste les identifiants auprès du service distant, sans jamais lever. */
async function runVerification(connectorId: string, credentials: Credentials) {
  const connector = requireConnector(connectorId);
  const signal = AbortSignal.timeout(VERIFY_TIMEOUT_MS);

  try {
    return await connector.verify(credentials, {
      signal,
      logger: logger.child({ connector: connectorId }),
    });
  } catch (error) {
    logger.warn({ err: error, connector: connectorId }, 'Vérification du connecteur en échec');
    return { ok: false as const, message: 'Le service distant n’a pas pu être contacté.' };
  }
}

export async function createConnection(input: {
  userId: string;
  connectorId: string;
  label: string;
  credentials: unknown;
}): Promise<{ connection: ConnectionView; endpointUrl: string }> {
  const connector = requireConnector(input.connectorId);
  const credentials = parseCredentials(connector, input.credentials);

  const duplicate = await prisma.connection.findFirst({
    where: { userId: input.userId, connectorId: connector.id, label: input.label },
    select: { id: true },
  });
  if (duplicate) {
    throw conflict(`Une connexion « ${input.label} » existe déjà pour ${connector.name}.`);
  }

  const verification = await runVerification(connector.id, credentials);

  const connection = await prisma.connection.create({
    data: {
      userId: input.userId,
      connectorId: connector.id,
      label: input.label,
      credentials: encryptJson(credentials),
      status: verification.ok ? 'ACTIVE' : 'ERROR',
      statusMessage: verification.ok ? null : verification.message,
      accountLabel: verification.ok ? (verification.accountLabel ?? null) : null,
      lastVerifiedAt: new Date(),
    },
  });

  // Un point d'accès est créé d'office : sans lui la connexion ne sert à rien,
  // et l'utilisateur repart tout de suite avec son URL à coller.
  const { url } = await createEndpoint(connection.id, connector.id, 'Point d’accès principal');

  return { connection: await getConnection(input.userId, connection.id), endpointUrl: url };
}

export async function updateConnection(input: {
  userId: string;
  connectionId: string;
  label?: string;
  credentials?: unknown;
}): Promise<ConnectionView> {
  const existing = await prisma.connection.findFirst({
    where: { id: input.connectionId, userId: input.userId },
  });
  if (!existing) throw notFound('Connexion introuvable.');

  const connector = requireConnector(existing.connectorId);
  const data: Parameters<typeof prisma.connection.update>[0]['data'] = {};

  if (input.label !== undefined) data.label = input.label;

  if (input.credentials !== undefined) {
    const credentials = parseCredentials(connector, input.credentials);
    const verification = await runVerification(connector.id, credentials);

    data.credentials = encryptJson(credentials);
    data.status = verification.ok ? 'ACTIVE' : 'ERROR';
    data.statusMessage = verification.ok ? null : verification.message;
    data.accountLabel = verification.ok ? (verification.accountLabel ?? null) : null;
    data.lastVerifiedAt = new Date();
  }

  await prisma.connection.update({ where: { id: existing.id }, data });
  return getConnection(input.userId, existing.id);
}

/** Revérifie une connexion existante à la demande de l'utilisateur. */
export async function verifyConnection(
  userId: string,
  connectionId: string,
): Promise<ConnectionView> {
  const connection = await prisma.connection.findFirst({ where: { id: connectionId, userId } });
  if (!connection) throw notFound('Connexion introuvable.');

  const credentials = decryptJson<Credentials>(connection.credentials);
  const verification = await runVerification(connection.connectorId, credentials);

  await prisma.connection.update({
    where: { id: connection.id },
    data: {
      status: verification.ok ? 'ACTIVE' : 'ERROR',
      statusMessage: verification.ok ? null : verification.message,
      accountLabel: verification.ok ? (verification.accountLabel ?? null) : null,
      lastVerifiedAt: new Date(),
    },
  });

  return getConnection(userId, connection.id);
}

export async function deleteConnection(userId: string, connectionId: string): Promise<void> {
  const { count } = await prisma.connection.deleteMany({ where: { id: connectionId, userId } });
  if (count === 0) throw notFound('Connexion introuvable.');
}

// --- Points d'accès --------------------------------------------------------

export async function addEndpoint(
  userId: string,
  connectionId: string,
  name: string,
): Promise<{ endpoint: EndpointView; url: string }> {
  const connection = await prisma.connection.findFirst({ where: { id: connectionId, userId } });
  if (!connection) throw notFound('Connexion introuvable.');

  const { endpoint, url } = await createEndpoint(connection.id, connection.connectorId, name);
  return { endpoint: toEndpointView(endpoint), url };
}

export async function revealEndpoint(
  userId: string,
  connectionId: string,
  endpointId: string,
): Promise<string> {
  const endpoint = await prisma.mcpEndpoint.findFirst({
    where: { id: endpointId, connectionId, revokedAt: null, connection: { userId } },
    include: { connection: { select: { connectorId: true } } },
  });
  if (!endpoint) throw notFound('Point d’accès introuvable.');

  return revealEndpointUrl(endpoint, endpoint.connection.connectorId);
}

export async function removeEndpoint(
  userId: string,
  connectionId: string,
  endpointId: string,
): Promise<void> {
  const { count } = await prisma.mcpEndpoint.updateMany({
    where: { id: endpointId, connectionId, revokedAt: null, connection: { userId } },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw notFound('Point d’accès introuvable.');
}
