import { listConnectors, requireConnector, toSummary } from '../../connectors/registry.js';
import { generateToken, hashToken } from '../../core/crypto.js';
import { badRequest, notFound } from '../../core/errors.js';
import { prisma } from '../../core/prisma.js';
import { isConnectorOAuthReady } from '../connections/connector-oauth.service.js';
import { authorizationCodeTtlMs, type PendingAuthorization } from './provider.js';

/**
 * ===========================================================================
 *  Écran de consentement
 * ===========================================================================
 *
 * Ce que voit l'utilisateur quand un client IA demande l'accès, et ce qui se
 * passe quand il approuve.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi on ne demande plus « individuel ou partagé »
 * ---------------------------------------------------------------------------
 *
 * On le demandait ici. C'était une erreur d'analyse : les plateformes IA posent
 * déjà la question au moment où l'on colle l'URL. Dust distingue « Personal
 * credentials » et « Shared credentials » à l'ajout de l'outil, et en tire les
 * conséquences elle-même :
 *
 *   • partagé   → un seul parcours d'autorisation, réalisé par l'administrateur ;
 *                 son jeton est ensuite réutilisé pour tout l'espace de travail ;
 *   • personnel → l'administrateur en réalise un, puis **chaque** utilisateur
 *                 réalise le sien à sa première utilisation.
 *
 * Autrement dit, la distinction se traduit chez nous par un simple nombre de
 * parcours d'autorisation. Chaque jeton que nous émettons est déjà lié à un
 * utilisateur et à une connexion : les deux comportements en découlent sans
 * qu'on ait à les nommer.
 *
 * Reposer la question était donc au mieux redondant, au pire contradictoire —
 * rien n'empêchait de répondre « partagé » ici après avoir choisi « personnel »
 * dans Dust, et les deux modèles se seraient contredits en silence.
 *
 * Le protocole ne transmet d'ailleurs aucun indicateur de mode : nous ne
 * pouvons pas le connaître, et nous n'en avons pas besoin.
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
  /** Connexions de l'utilisateur pour ce connecteur. */
  connections: { id: string; label: string; accountLabel: string | null; status: string }[];
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
      connections: [],
      requiresConnectorOAuth: false,
      connectorAvailable: true,
      scopes: [],
    };
  }

  const connector = requireConnector(connectorId);

  const connections = await prisma.connection.findMany({
    where: { userId, connectorId: connector.id },
    select: { id: true, label: true, accountLabel: true, status: true },
    orderBy: { createdAt: 'asc' },
  });

  return {
    client: { name: client.name, clientId: client.clientId },
    connector: toSummary(connector),
    selectableConnectors: [],
    connections,
    requiresConnectorOAuth: connections.length === 0 && connector.auth.type === 'oauth2',
    connectorAvailable: isConnectorOAuthReady(connector),
    scopes: connector.auth.type === 'oauth2' ? (connector.auth.oauth?.scopes ?? []) : [],
  };
}

export async function approveAuthorization(
  pending: PendingAuthorization,
  userId: string,
  choice: { connectionId?: string; connectorId?: string },
): Promise<string> {
  const connectorId = pending.connectorId ?? choice.connectorId;
  if (!connectorId) {
    throw badRequest('Sélectionnez le service à autoriser avant de continuer.');
  }
  const connector = requireConnector(connectorId);

  const client = await prisma.oAuthClient.findUnique({ where: { clientId: pending.clientId } });
  if (!client) throw notFound('Client MCP inconnu.');

  /**
   * Le jeton est lié à la connexion de *cet* utilisateur, toujours.
   *
   * C'est ce qui rend les deux modes de Dust corrects sans les distinguer : en
   * partagé, une seule personne fait ce parcours et son jeton circule ensuite ;
   * en personnel, chacun fait le sien et obtient le sien.
   */
  const connectionId = await requireOwnedConnection(userId, connector.id, choice.connectionId);

  /**
   * Trace, et non plus règle.
   *
   * On garde la trace du couple (client, connecteur) et de qui l'a mis en place
   * — c'est ce qu'affiche l'administration. Cette ligne ne décide plus rien :
   * c'est le jeton qui porte la connexion.
   */
  await prisma.mcpAccess.upsert({
    where: {
      oauthClientId_connectorId: { oauthClientId: client.id, connectorId: connector.id },
    },
    update: {},
    create: {
      oauthClientId: client.id,
      connectorId: connector.id,
      ownerId: userId,
    },
  });

  const code = generateToken('wsp-code');

  await prisma.oAuthGrant.create({
    data: {
      codeHash: hashToken(code),
      oauthClientId: client.id,
      userId,
      connectorId: connector.id,
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
