import type { McpAccessMode } from '@prisma/client';
import { listConnectors, requireConnector, toSummary } from '../../connectors/registry.js';
import { generateToken, hashToken } from '../../core/crypto.js';
import { badRequest, forbidden, notFound } from '../../core/errors.js';
import { prisma } from '../../core/prisma.js';
import { isConnectorOAuthReady } from '../connections/connector-oauth.service.js';
import { authorizationCodeTtlMs, type PendingAuthorization } from './provider.js';

/**
 * Écran de consentement : ce que voit l'utilisateur quand un client IA demande
 * l'accès, et ce qui se passe quand il approuve.
 *
 * C'est ici que se décide le mode d'accès (individuel ou partagé). Le choix
 * n'est proposé qu'à la **première** configuration d'un couple
 * (client MCP, connecteur) ; ensuite il s'impose à tout le monde, pour que le
 * comportement reste prévisible au sein d'une équipe.
 */

export type ConsentView = {
  client: { name: string; clientId: string };
  /**
   * Nul si le client n'a pas transmis d'indicateur de ressource : l'utilisateur
   * doit alors choisir parmi `selectableConnectors`.
   */
  connector: ReturnType<typeof toSummary> | null;
  /** Renseigné uniquement lorsque `connector` est nul. */
  selectableConnectors: { id: string; name: string; tagline: string; icon: string }[];
  /** Mode déjà fixé par une configuration antérieure, sinon null (premier passage). */
  establishedMode: McpAccessMode | null;
  /** true si l'utilisateur courant est celui qui a fait la configuration initiale. */
  isOwner: boolean;
  /** Connexions de l'utilisateur pour ce connecteur. */
  connections: { id: string; label: string; accountLabel: string | null; status: string }[];
  /** En mode partagé déjà configuré : le compte imposé. */
  sharedConnection: { id: string; label: string; accountLabel: string | null } | null;
  /** true si l'utilisateur doit d'abord raccorder son compte via OAuth tiers. */
  requiresConnectorOAuth: boolean;
  /** false si l'application OAuth du connecteur n'est pas configurée. */
  connectorAvailable: boolean;
  scopes: string[];
};

export async function describeAuthorization(
  pending: PendingAuthorization,
  userId: string,
  /** Choix fait par l'utilisateur quand le client n'a pas précisé la ressource. */
  chosenConnectorId?: string,
): Promise<ConsentView> {
  const client = await prisma.oAuthClient.findUnique({ where: { clientId: pending.clientId } });
  if (!client) throw notFound('Client MCP inconnu.');

  const connectorId = pending.connectorId ?? chosenConnectorId;

  // Aucun connecteur déterminé : on renvoie la liste pour que l'utilisateur
  // tranche, plutôt que d'interrompre le parcours.
  if (!connectorId) {
    return {
      client: { name: client.name, clientId: client.clientId },
      connector: null,
      selectableConnectors: listConnectors().map((entry) => ({
        id: entry.id,
        name: entry.name,
        tagline: entry.tagline,
        icon: entry.icon,
      })),
      establishedMode: null,
      isOwner: true,
      connections: [],
      sharedConnection: null,
      requiresConnectorOAuth: false,
      connectorAvailable: true,
      scopes: [],
    };
  }

  const connector = requireConnector(connectorId);

  const access = await prisma.mcpAccess.findUnique({
    where: {
      oauthClientId_connectorId: { oauthClientId: client.id, connectorId: connector.id },
    },
    include: {
      connection: { select: { id: true, label: true, accountLabel: true } },
    },
  });

  const connections = await prisma.connection.findMany({
    where: { userId, connectorId: connector.id },
    select: { id: true, label: true, accountLabel: true, status: true },
    orderBy: { createdAt: 'asc' },
  });

  const sharedAlreadySet = access?.mode === 'SHARED' && access.connection !== null;

  return {
    client: { name: client.name, clientId: client.clientId },
    connector: toSummary(connector),
    selectableConnectors: [],
    establishedMode: access?.mode ?? null,
    isOwner: access ? access.ownerId === userId : true,
    connections,
    sharedConnection: access?.connection ?? null,
    // En mode partagé déjà configuré, l'utilisateur n'a rien à raccorder.
    requiresConnectorOAuth:
      !sharedAlreadySet && connections.length === 0 && connector.auth.type === 'oauth2',
    connectorAvailable: isConnectorOAuthReady(connector),
    scopes: connector.auth.type === 'oauth2' ? (connector.auth.oauth?.scopes ?? []) : [],
  };
}

export async function approveAuthorization(
  pending: PendingAuthorization,
  userId: string,
  choice: { mode?: McpAccessMode; connectionId?: string; connectorId?: string },
): Promise<string> {
  const connectorId = pending.connectorId ?? choice.connectorId;
  if (!connectorId) {
    throw badRequest('Sélectionnez le service à autoriser avant de continuer.');
  }
  const connector = requireConnector(connectorId);

  const client = await prisma.oAuthClient.findUnique({ where: { clientId: pending.clientId } });
  if (!client) throw notFound('Client MCP inconnu.');

  const existingAccess = await prisma.mcpAccess.findUnique({
    where: {
      oauthClientId_connectorId: { oauthClientId: client.id, connectorId: connector.id },
    },
  });

  // Détermination du mode, en trois règles simples :
  //  1. première configuration → l'utilisateur choisit (individuel par défaut) ;
  //  2. déjà configuré, utilisateur propriétaire → il peut changer d'avis ;
  //  3. déjà configuré, autre utilisateur → le mode s'impose à lui.
  const isOwner = !existingAccess || existingAccess.ownerId === userId;
  const mode: McpAccessMode = !existingAccess
    ? (choice.mode ?? 'INDIVIDUAL')
    : isOwner
      ? (choice.mode ?? existingAccess.mode)
      : existingAccess.mode;

  if (existingAccess && !isOwner && choice.mode && choice.mode !== existingAccess.mode) {
    throw forbidden(
      "Le mode d'accès a été défini par la personne qui a configuré ce serveur. " +
        'Demandez-lui de le modifier.',
    );
  }

  // Quelle connexion ce jeton utilisera-t-il ?
  //  - partagé et déjà configuré (par quelqu'un d'autre) → la connexion commune ;
  //  - sinon → celle que l'utilisateur vient de désigner, qui doit lui appartenir.
  const reuseShared =
    mode === 'SHARED' &&
    existingAccess?.mode === 'SHARED' &&
    existingAccess.connectionId !== null &&
    !choice.connectionId;

  const connectionId = reuseShared
    ? (existingAccess.connectionId as string)
    : await requireOwnedConnection(userId, connector.id, choice.connectionId);

  await prisma.mcpAccess.upsert({
    where: {
      oauthClientId_connectorId: { oauthClientId: client.id, connectorId: connector.id },
    },
    update: { mode, connectionId: mode === 'SHARED' ? connectionId : null },
    create: {
      oauthClientId: client.id,
      connectorId: connector.id,
      mode,
      ownerId: userId,
      connectionId: mode === 'SHARED' ? connectionId : null,
    },
  });

  const code = generateToken('wsp-code');

  await prisma.oAuthGrant.create({
    data: {
      codeHash: hashToken(code),
      oauthClientId: client.id,
      userId,
      connectorId: connector.id,
      // En mode partagé, le jeton pointera vers la connexion commune ; en mode
      // individuel, vers celle de cet utilisateur.
      connectionId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      scopes: pending.scopes,
      resource: pending.resource ?? null,
      expiresAt: new Date(Date.now() + authorizationCodeTtlMs),
    },
  });

  const target = new URL(pending.redirectUri);
  target.searchParams.set('code', code);
  if (pending.state) target.searchParams.set('state', pending.state);
  return target.toString();
}

export function denyAuthorization(pending: PendingAuthorization): string {
  const target = new URL(pending.redirectUri);
  target.searchParams.set('error', 'access_denied');
  target.searchParams.set('error_description', "L'utilisateur a refusé l'autorisation.");
  if (pending.state) target.searchParams.set('state', pending.state);
  return target.toString();
}

async function requireOwnedConnection(
  userId: string,
  connectorId: string,
  connectionId: string | undefined,
): Promise<string> {
  if (!connectionId) {
    throw badRequest('Sélectionnez le compte à utiliser avant d’autoriser.');
  }

  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, userId, connectorId },
    select: { id: true },
  });

  if (!connection) throw badRequest('Compte introuvable ou n’appartenant pas à cet utilisateur.');
  return connection.id;
}
