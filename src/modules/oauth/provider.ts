import type { Response } from 'express';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidGrantError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { getConnector } from '../../connectors/registry.js';
import { decryptJson, encryptJson, generateToken, hashToken } from '../../core/crypto.js';
import { env } from '../../core/env.js';
import { badRequest } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { prisma } from '../../core/prisma.js';
import { clientStore } from './client-store.js';

/**
 * ===========================================================================
 *  Serveur d'autorisation OAuth 2.1 pour les clients MCP
 * ===========================================================================
 *
 * C'est la pièce qui remplace le copier-coller d'une URL contenant un secret.
 * Le client IA découvre nos métadonnées, s'enregistre, ouvre un navigateur,
 * l'utilisateur consent, et le client repart avec un jeton.
 *
 * Le point sensible est `authorize()` : le SDK nous passe la réponse HTTP mais
 * pas l'identité de l'utilisateur — c'est normal, à cet instant on ne sait pas
 * encore qui est derrière le navigateur. On redirige donc vers notre propre
 * écran de consentement, en emportant la demande dans un jeton **chiffré et
 * authentifié** (AES-256-GCM) plutôt que dans une table : rien à stocker, rien
 * à purger, et toute altération du paramètre fait échouer le déchiffrement.
 */

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 h
const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 j
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000; // 5 min
const PENDING_REQUEST_TTL_MS = 30 * 60 * 1000; // 30 min pour se connecter et consentir

export const MCP_SCOPE = 'mcp';

/** Demande d'autorisation en attente, transportée chiffrée dans l'URL. */
export type PendingAuthorization = {
  clientId: string;
  /**
   * Nul lorsque le client n'a pas transmis d'indicateur de ressource : le
   * connecteur est alors choisi par l'utilisateur sur l'écran de consentement.
   */
  connectorId: string | null;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  state?: string;
  resource?: string;
  expiresAt: number;
};

/**
 * Le client indique la ressource visée (RFC 8707) : c'est l'URL MCP exacte,
 * par exemple `https://mcp.wesype.com/mcp/gmail`. On en déduit le connecteur.
 */
export function connectorIdFromResource(resource: URL | string | undefined): string | null {
  if (!resource) return null;
  const path = typeof resource === 'string' ? safePath(resource) : resource.pathname;
  if (!path) return null;

  const match = /^\/mcp\/([a-z0-9][a-z0-9-]*)\/?$/.exec(path);
  return match?.[1] ?? null;
}

function safePath(value: string): string | null {
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

function encodePendingAuthorization(pending: PendingAuthorization): string {
  return encryptJson(pending);
}

export function decodePendingAuthorization(token: string): PendingAuthorization {
  let pending: PendingAuthorization;
  try {
    pending = decryptJson<PendingAuthorization>(token);
  } catch {
    throw badRequest("Demande d'autorisation illisible. Relancez la connexion depuis votre client IA.");
  }
  if (pending.expiresAt <= Date.now()) {
    throw badRequest("Demande d'autorisation expirée. Relancez la connexion depuis votre client IA.");
  }
  return pending;
}

export const oauthProvider: OAuthServerProvider = {
  get clientsStore() {
    return clientStore;
  },

  /**
   * Étape 1 : le navigateur arrive ici. On ne sait pas encore qui est
   * l'utilisateur, donc on emballe la demande et on l'envoie sur notre écran
   * de consentement, qui exigera une session Wesype.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const connectorId = connectorIdFromResource(params.resource);

    // Une ressource explicitement fournie mais inconnue est une vraie erreur.
    if (connectorId && !getConnector(connectorId)) {
      redirectWithError(
        res,
        params.redirectUri,
        params.state,
        'invalid_request',
        `Connecteur inconnu : ${connectorId}`,
      );
      return;
    }

    // En revanche, l'ABSENCE de `resource` n'est pas rédhibitoire. La
    // spécification MCP l'impose (RFC 8707), mais tous les clients ne la
    // respectent pas encore. Plutôt que de casser le parcours, on laisse
    // l'utilisateur désigner le connecteur sur l'écran de consentement.

    const pending: PendingAuthorization = {
      clientId: client.client_id,
      connectorId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes: params.scopes?.length ? params.scopes : [MCP_SCOPE],
      ...(params.state ? { state: params.state } : {}),
      ...(params.resource ? { resource: params.resource.toString() } : {}),
      expiresAt: Date.now() + PENDING_REQUEST_TTL_MS,
    };

    const target = new URL('/autoriser', env.baseUrl);
    target.searchParams.set('demande', encodePendingAuthorization(pending));

    res.redirect(target.toString());
  },

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const grant = await prisma.oAuthGrant.findUnique({
      where: { codeHash: hashToken(authorizationCode) },
      include: { client: true },
    });

    if (!grant || grant.client.clientId !== client.client_id) {
      throw new InvalidGrantError("Code d'autorisation invalide.");
    }
    return grant.codeChallenge;
  },

  /** Étape 3 : le client échange son code contre des jetons. */
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    // La vérification PKCE est faite par le SDK via challengeForAuthorizationCode.
    const grant = await prisma.oAuthGrant.findUnique({
      where: { codeHash: hashToken(authorizationCode) },
      include: { client: true },
    });

    if (!grant || grant.client.clientId !== client.client_id) {
      throw new InvalidGrantError("Code d'autorisation invalide.");
    }
    if (grant.usedAt) {
      // Code rejoué : on révoque toute la famille de jetons issue de ce code,
      // conformément aux recommandations OAuth 2.1 sur la détection de rejeu.
      await prisma.oAuthToken.updateMany({
        where: { familyId: grant.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      logger.warn({ grantId: grant.id }, "Rejeu d'un code d'autorisation détecté");
      throw new InvalidGrantError("Code d'autorisation déjà utilisé.");
    }
    if (grant.expiresAt.getTime() <= Date.now()) {
      throw new InvalidGrantError("Code d'autorisation expiré.");
    }
    if (redirectUri && redirectUri !== grant.redirectUri) {
      throw new InvalidGrantError('redirect_uri ne correspond pas à la demande initiale.');
    }
    if (resource && grant.resource && resource.toString() !== grant.resource) {
      throw new InvalidGrantError("Le paramètre 'resource' ne correspond pas à la demande initiale.");
    }

    await prisma.oAuthGrant.update({ where: { id: grant.id }, data: { usedAt: new Date() } });

    return issueTokens({
      familyId: grant.id,
      oauthClientId: grant.oauthClientId,
      userId: grant.userId,
      connectorId: grant.connectorId,
      connectionId: grant.connectionId,
      scopes: grant.scopes,
      resource: grant.resource,
    });
  },

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    _resource?: URL,
  ): Promise<OAuthTokens> {
    const existing = await prisma.oAuthToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { client: true },
    });

    if (
      !existing ||
      existing.type !== 'REFRESH' ||
      existing.client.clientId !== client.client_id ||
      existing.revokedAt ||
      existing.expiresAt.getTime() <= Date.now()
    ) {
      throw new InvalidGrantError('Jeton de rafraîchissement invalide ou expiré.');
    }

    // Rotation : l'ancien jeton de rafraîchissement est révoqué immédiatement.
    await prisma.oAuthToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    return issueTokens({
      familyId: existing.familyId,
      oauthClientId: existing.oauthClientId,
      userId: existing.userId,
      connectorId: existing.connectorId,
      connectionId: existing.connectionId,
      // On n'élargit jamais la portée lors d'un rafraîchissement.
      scopes: scopes?.length ? scopes.filter((s) => existing.scopes.includes(s)) : existing.scopes,
      resource: existing.resource,
    });
  },

  /** Étape 4 : chaque appel MCP passe par ici. */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = await prisma.oAuthToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { client: true, user: { select: { isActive: true } } },
    });

    if (!row || row.type !== 'ACCESS' || row.revokedAt || !row.user.isActive) {
      throw new InvalidTokenError('Jeton invalide.');
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new InvalidTokenError('Jeton expiré.');
    }

    // Marquage d'usage, sans bloquer la requête.
    void prisma.oAuthToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return {
      token,
      clientId: row.client.clientId,
      scopes: row.scopes,
      expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
      ...(row.resource ? { resource: new URL(row.resource) } : {}),
      // C'est ce qui permet de savoir QUI appelle, et donc de résoudre la
      // bonne connexion en mode individuel.
      extra: {
        userId: row.userId,
        connectorId: row.connectorId,
        connectionId: row.connectionId,
      },
    };
  },

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    const row = await prisma.oAuthToken.findUnique({
      where: { tokenHash: hashToken(request.token) },
      include: { client: true },
    });

    // Révocation silencieuse si le jeton est inconnu : ne pas révéler son existence.
    if (!row || row.client.clientId !== client.client_id) return;

    // Révoquer un jeton révoque toute sa famille : sinon le client conserverait
    // un accès via le jeton de rafraîchissement associé.
    await prisma.oAuthToken.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },
};

async function issueTokens(input: {
  familyId: string;
  oauthClientId: string;
  userId: string;
  connectorId: string;
  connectionId: string | null;
  scopes: string[];
  resource: string | null;
}): Promise<OAuthTokens> {
  const accessToken = generateToken('wsp-at');
  const refreshToken = generateToken('wsp-rt');
  const now = Date.now();

  const common = {
    oauthClientId: input.oauthClientId,
    userId: input.userId,
    connectorId: input.connectorId,
    connectionId: input.connectionId,
    scopes: input.scopes,
    resource: input.resource,
    familyId: input.familyId,
  };

  await prisma.oAuthToken.createMany({
    data: [
      {
        ...common,
        tokenHash: hashToken(accessToken),
        type: 'ACCESS',
        expiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
      },
      {
        ...common,
        tokenHash: hashToken(refreshToken),
        type: 'REFRESH',
        expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
      },
    ],
  });

  await prisma.oAuthClient
    .update({ where: { id: input.oauthClientId }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: input.scopes.join(' '),
  };
}

/** Erreur OAuth renvoyée au client via son URI de redirection. */
function redirectWithError(
  res: Response,
  redirectUri: string,
  state: string | undefined,
  error: string,
  description: string,
): void {
  const target = new URL(redirectUri);
  target.searchParams.set('error', error);
  target.searchParams.set('error_description', description);
  if (state) target.searchParams.set('state', state);
  res.redirect(target.toString());
}

/** Durée de vie d'un code d'autorisation, exposée pour le service de consentement. */
export const authorizationCodeTtlMs = AUTHORIZATION_CODE_TTL_MS;
