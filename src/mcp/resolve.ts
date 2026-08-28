import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Connection } from '@prisma/client';
import { getConnector } from '../connectors/registry.js';
import type { AnyConnector, Credentials, OAuthCredentials } from '../connectors/types.js';
import { decryptJson } from '../core/crypto.js';
import { logger } from '../core/logger.js';
import { prisma } from '../core/prisma.js';
import { ensureFreshCredentials } from '../modules/connections/connector-oauth.service.js';
import { resolveEndpoint } from '../modules/endpoints/endpoint.service.js';

/**
 * Résolution du contexte d'exécution d'un appel MCP.
 *
 * Deux chemins d'accès mènent ici, et un seul contexte en sort :
 *
 *  1. **Jeton OAuth** (`Authorization: Bearer`) — le chemin moderne. Le client
 *     IA a fait la découverte et le consentement tout seul. Le jeton porte
 *     l'identité de l'utilisateur et la connexion retenue à ce moment-là.
 *
 *  2. **Jeton statique dans l'URL** (`/mcp/:connectorId/:token`) — le chemin de
 *     repli, pour les clients incapables de faire de l'OAuth. Toujours un
 *     compte partagé, puisque l'URL *est* l'identité.
 */

export type McpContext = {
  connector: AnyConnector;
  connection: Connection;
  credentials: Credentials;
  /** Renseigné uniquement sur le chemin à jeton statique. */
  endpointId: string | null;
  /** Utilisateur à l'origine de l'appel, connu seulement via OAuth. */
  userId: string;
  origin: 'oauth' | 'url-token';
};

export type ResolutionFailure = {
  reason: 'unauthorized' | 'not-found' | 'connection-error';
  message: string;
};

/** Résolution depuis un jeton OAuth déjà validé par le middleware du SDK. */
export async function resolveFromAuthInfo(
  authInfo: AuthInfo,
  connectorId: string,
): Promise<McpContext | ResolutionFailure> {
  const extra = authInfo.extra as
    { userId?: string; connectorId?: string; connectionId?: string | null } | undefined;

  if (!extra?.userId || extra.connectorId !== connectorId) {
    return { reason: 'unauthorized', message: "Ce jeton n'est pas valide pour ce connecteur." };
  }

  const connector = getConnector(connectorId);
  if (!connector) return { reason: 'not-found', message: `Connecteur inconnu : ${connectorId}` };

  if (!extra.connectionId) {
    return {
      reason: 'connection-error',
      message:
        "Aucun compte n'est raccordé à cette autorisation. Reconnectez le serveur depuis votre client IA.",
    };
  }

  const connection = await prisma.connection.findUnique({ where: { id: extra.connectionId } });
  if (!connection || connection.connectorId !== connectorId) {
    return {
      reason: 'connection-error',
      message:
        'Le compte associé à cette autorisation a été supprimé. Reconnectez le serveur depuis votre client IA.',
    };
  }

  return finalize(connector, connection, {
    endpointId: null,
    userId: extra.userId,
    origin: 'oauth',
  });
}

/** Résolution depuis un jeton statique présent dans l'URL. */
export async function resolveFromUrlToken(
  token: string,
  connectorId: string,
): Promise<McpContext | ResolutionFailure> {
  const resolved = await resolveEndpoint(token);

  // Message identique pour « inconnu », « révoqué » et « mauvais connecteur » :
  // aucun oracle exploitable pour deviner un jeton valide.
  if (!resolved || resolved.connection.connectorId !== connectorId) {
    return { reason: 'unauthorized', message: 'Point d’accès MCP invalide ou révoqué.' };
  }

  return finalize(resolved.connector, resolved.connection, {
    endpointId: resolved.endpoint.id,
    userId: resolved.connection.userId,
    origin: 'url-token',
  });
}

async function finalize(
  connector: AnyConnector,
  connection: Connection,
  meta: { endpointId: string | null; userId: string; origin: McpContext['origin'] },
): Promise<McpContext | ResolutionFailure> {
  let credentials: Credentials;
  try {
    credentials = decryptJson<Credentials>(connection.credentials);
  } catch (error) {
    logger.error(
      { err: error, connectionId: connection.id },
      'Déchiffrement des identifiants impossible',
    );
    return {
      reason: 'connection-error',
      message: 'Identifiants illisibles. Reconfigurez la connexion.',
    };
  }

  // Pour un connecteur OAuth, le jeton d'accès a une durée de vie courte :
  // on le rafraîchit avant chaque session plutôt que de laisser l'outil
  // échouer sur un 401 incompréhensible pour le modèle.
  if (connector.auth.type === 'oauth2') {
    try {
      credentials = await ensureFreshCredentials(
        connector,
        connection.id,
        credentials as OAuthCredentials,
      );
    } catch (error) {
      return {
        reason: 'connection-error',
        message:
          error instanceof Error
            ? error.message
            : "L'autorisation du compte a expiré. Reconnectez-le depuis Toolink.",
      };
    }
  }

  return { connector, connection, credentials, ...meta };
}

/**
 * -----------------------------------------------------------------------------
 * Résolution du hub : un jeton, plusieurs connexions
 * -----------------------------------------------------------------------------
 */

export type HubEntry = {
  connector: AnyConnector;
  connection: Connection;
  credentials: Credentials;
  /** Outils retenus au consentement pour cette connexion. null = tous. */
  allowedTools: string[] | null;
};

export type HubContext = {
  kind: 'hub';
  userId: string;
  entries: HubEntry[];
};

export async function resolveHubFromAuthInfo(
  authInfo: AuthInfo,
): Promise<HubContext | ResolutionFailure> {
  const extra = authInfo.extra as
    | {
        userId?: string;
        connectorId?: string;
        connectionIds?: string[];
        toolSelection?: Record<string, string[]> | null;
      }
    | undefined;

  if (!extra?.userId || extra.connectorId !== 'hub' || !extra.connectionIds?.length) {
    return { reason: 'unauthorized', message: "Ce jeton n'est pas valide pour le hub." };
  }

  const rows = await prisma.connection.findMany({
    where: { id: { in: extra.connectionIds }, userId: extra.userId },
  });

  const entries: HubEntry[] = [];
  for (const connection of rows) {
    const connector = getConnector(connection.connectorId);
    if (!connector) continue; // connecteur retiré du code : la connexion est orpheline

    const resolved = await finalize(connector, connection, {
      endpointId: null,
      userId: extra.userId,
      origin: 'oauth',
    });
    /**
     * Une connexion en échec (identifiants illisibles, OAuth expiré) est omise
     * plutôt que fatale : le hub sert ce qui marche encore, et l'utilisateur
     * répare l'entrée en panne depuis « Mes connexions » sans perdre le reste.
     */
    if (isFailure(resolved)) {
      logger.warn(
        { connectionId: connection.id, reason: resolved.reason },
        "Connexion omise du hub",
      );
      continue;
    }

    entries.push({
      connector,
      connection,
      credentials: resolved.credentials,
      allowedTools: extra.toolSelection?.[connection.id] ?? null,
    });
  }

  if (entries.length === 0) {
    return {
      reason: 'connection-error',
      message:
        'Aucune des connexions de ce hub n’est utilisable. Vérifiez-les dans « Mes connexions », puis réautorisez.',
    };
  }

  return { kind: 'hub', userId: extra.userId, entries };
}

export function isFailure(value: McpContext | ResolutionFailure): value is ResolutionFailure {
  return 'reason' in value;
}
