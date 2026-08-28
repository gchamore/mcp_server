import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { requireConnector } from '../../connectors/registry.js';
import type { AnyConnector, OAuthCredentials } from '../../connectors/types.js';
import { encryptJson } from '../../core/crypto.js';
import { connectorOAuthApp, env } from '../../core/env.js';
import { badRequest, featureDisabled, upstreamError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { prisma } from '../../core/prisma.js';
import { safeInternalPath } from '../../core/redirect.js';
import { StateCookie } from '../../core/state-cookie.js';

/**
 * ===========================================================================
 *  Couche B — Wesype s'authentifie auprès d'un service tiers
 * ===========================================================================
 *
 * Quand un connecteur déclare `auth.type: 'oauth2'`, l'utilisateur ne saisit
 * aucune clé : il est envoyé chez le fournisseur (Google, Notion, Slack…), et
 * les jetons obtenus deviennent les « identifiants » de sa connexion — chiffrés
 * comme n'importe quelle clé API.
 *
 * Ce service est appelé depuis deux endroits :
 *  - la page d'un connecteur, quand l'utilisateur clique « Connecter » ;
 *  - l'écran de consentement MCP, quand un client IA demande l'accès à un
 *    connecteur que l'utilisateur n'a pas encore raccordé. C'est ce chaînage
 *    qui produit le parcours « tout se configure tout seul ».
 */

const STATE_TTL_MS = 15 * 60 * 1000;
/** Marge avant expiration : on rafraîchit un peu en avance. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

type ConnectorOAuthState = {
  connectorId: string;
  userId: string;
  codeVerifier: string;
  nonce: string;
  label: string;
  returnTo: string;
  expiresAt: number;
};

/**
 * Chiffré, pas seulement signé : contrairement au flux de connexion, cet état
 * porte un `userId`. Un cookie signé reste lisible par son porteur, et rien
 * n'oblige à lui révéler l'identifiant interne d'un compte.
 */
const stateCookie = new StateCookie<ConnectorOAuthState>({
  name: 'wsp_connector_oauth',
  path: '/api/connections/oauth',
  ttlMs: STATE_TTL_MS,
  encrypted: true,
});

/** L'application OAuth du connecteur est-elle configurée sur ce serveur ? */
export function isConnectorOAuthReady(connector: AnyConnector): boolean {
  if (connector.auth.type !== 'oauth2') return true;
  if (!connector.auth.oauth) return false;
  return connectorOAuthApp(connector.auth.oauth.credentialsEnvPrefix) !== null;
}

function requireOAuthConfig(connector: AnyConnector) {
  const config = connector.auth.oauth;
  if (connector.auth.type !== 'oauth2' || !config) {
    throw badRequest(`Le connecteur ${connector.name} n'utilise pas OAuth.`);
  }

  const app = connectorOAuthApp(config.credentialsEnvPrefix);
  if (!app) {
    throw featureDisabled(
      `L'application OAuth de ${connector.name} n'est pas configurée sur ce serveur ` +
        `(${config.credentialsEnvPrefix}_CLIENT_ID / ${config.credentialsEnvPrefix}_CLIENT_SECRET).`,
    );
  }

  return { config, app };
}

function connectorRedirectUri(connectorId: string): string {
  return `${env.baseUrl}/api/connections/oauth/${connectorId}/callback`;
}

/** Étape 1 : construit l'URL du fournisseur et dépose l'état dans un cookie signé. */
export function startConnectorOAuth(
  res: Response,
  input: { connectorId: string; userId: string; label: string; returnTo: string },
): string {
  const connector = requireConnector(input.connectorId);
  const { config, app } = requireOAuthConfig(connector);

  const nonce = randomBytes(16).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');

  const state: ConnectorOAuthState = {
    connectorId: connector.id,
    userId: input.userId,
    codeVerifier,
    nonce,
    label: input.label,
    returnTo: safeInternalPath(input.returnTo, '/connexions'),
    expiresAt: stateCookie.expiryTimestamp(),
  };

  stateCookie.write(res, state);

  const url = new URL(config.authorizationUrl);
  url.searchParams.set('client_id', app.clientId);
  url.searchParams.set('redirect_uri', connectorRedirectUri(connector.id));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', nonce);
  url.searchParams.set(
    'code_challenge',
    createHash('sha256').update(codeVerifier).digest('base64url'),
  );
  url.searchParams.set('code_challenge_method', 'S256');

  for (const [key, value] of Object.entries(config.authorizationParams ?? {})) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

/** Étape 2 : échange le code, crée ou met à jour la connexion, renvoie où revenir. */
export async function completeConnectorOAuth(
  req: Request,
  res: Response,
  input: { connectorId: string; code: string; state: string },
): Promise<{ connectionId: string; returnTo: string }> {
  const stored = stateCookie.read(req);
  stateCookie.clear(res);

  if (!stored) throw badRequest('Session OAuth expirée. Relancez la connexion.');
  if (stored.nonce !== input.state) throw badRequest('Paramètre state invalide.');
  if (stored.connectorId !== input.connectorId) throw badRequest('Connecteur inattendu.');

  const connector = requireConnector(input.connectorId);
  const { config, app } = requireOAuthConfig(connector);

  const tokens = await exchange(
    config.tokenUrl,
    {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: connectorRedirectUri(connector.id),
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code_verifier: stored.codeVerifier,
    },
    config.tokenEndpointAuth,
  );

  const credentials = toCredentials(tokens);

  // Le connecteur nous dit à quel compte distant on vient de se raccorder :
  // c'est ce qui s'affiche dans l'interface (« Wesype — contact@… »).
  const verification = await connector
    .verify(credentials, { signal: AbortSignal.timeout(15_000), logger })
    .catch(() => ({ ok: false as const, message: 'Vérification impossible.' }));

  const connection = await prisma.connection.upsert({
    where: {
      userId_connectorId_label: {
        userId: stored.userId,
        connectorId: connector.id,
        label: stored.label,
      },
    },
    update: {
      credentials: encryptJson(credentials),
      status: verification.ok ? 'ACTIVE' : 'ERROR',
      statusMessage: verification.ok ? null : verification.message,
      accountLabel: verification.ok ? (verification.accountLabel ?? null) : null,
      lastVerifiedAt: new Date(),
    },
    create: {
      userId: stored.userId,
      connectorId: connector.id,
      label: stored.label,
      credentials: encryptJson(credentials),
      status: verification.ok ? 'ACTIVE' : 'ERROR',
      statusMessage: verification.ok ? null : verification.message,
      accountLabel: verification.ok ? (verification.accountLabel ?? null) : null,
      lastVerifiedAt: new Date(),
    },
  });

  return { connectionId: connection.id, returnTo: stored.returnTo };
}

/**
 * Renvoie des identifiants utilisables, en rafraîchissant le jeton d'accès si
 * nécessaire. Appelé juste avant chaque exécution d'outil : c'est ce qui évite
 * qu'une connexion « expire » du point de vue de l'utilisateur.
 */
export async function ensureFreshCredentials(
  connector: AnyConnector,
  connectionId: string,
  credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
  if (connector.auth.type !== 'oauth2') return credentials;

  const expiresAt = credentials.expiresAt ? Date.parse(credentials.expiresAt) : NaN;
  const stillValid = Number.isFinite(expiresAt) && expiresAt - REFRESH_MARGIN_MS > Date.now();
  if (stillValid || !credentials.refreshToken) return credentials;

  const { config, app } = requireOAuthConfig(connector);

  try {
    const tokens = await exchange(
      config.tokenUrl,
      {
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
        client_id: app.clientId,
        client_secret: app.clientSecret,
      },
      config.tokenEndpointAuth,
    );

    // Beaucoup de fournisseurs ne renvoient pas de nouveau refresh_token :
    // on conserve l'ancien plutôt que de perdre l'accès.
    const refreshed: OAuthCredentials = {
      ...toCredentials(tokens),
      refreshToken: tokens.refresh_token ?? credentials.refreshToken,
    };

    await prisma.connection.update({
      where: { id: connectionId },
      data: { credentials: encryptJson(refreshed), status: 'ACTIVE', statusMessage: null },
    });

    return refreshed;
  } catch (error) {
    // Un refresh refusé signifie presque toujours un consentement révoqué côté
    // fournisseur : on bascule la connexion en erreur pour que l'utilisateur
    // soit invité à se reconnecter, au lieu d'accumuler des échecs opaques.
    await prisma.connection
      .update({
        where: { id: connectionId },
        data: {
          status: 'ERROR',
          statusMessage:
            "L'autorisation a expiré ou a été révoquée. Reconnectez votre compte depuis « Mes connexions ».",
        },
      })
      .catch(() => undefined);

    logger.warn(
      { err: error, connectionId, connector: connector.id },
      'Rafraîchissement OAuth refusé',
    );
    throw upstreamError("L'autorisation du compte a expiré. Reconnectez-le depuis MCP Wesype.");
  }
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

/**
 * Échange auprès du point de jeton du fournisseur.
 *
 * Deux écoles d'authentification cohabitent chez les fournisseurs : le secret
 * dans le corps (Google, Microsoft…) ou en HTTP Basic (Notion, et tout
 * fournisseur qui suit la RFC 6749 §2.3.1 à la lettre — certains **refusent**
 * le secret dans le corps). Le connecteur choisit via `tokenEndpointAuth` ;
 * en Basic, les identifiants sortent du corps pour ne pas voyager deux fois.
 */
export async function exchange(
  tokenUrl: string,
  params: Record<string, string>,
  auth: 'body' | 'basic' = 'body',
): Promise<TokenResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  const body = { ...params };

  if (auth === 'basic') {
    const { client_id: clientId, client_secret: clientSecret } = body;
    delete body.client_id;
    delete body.client_secret;
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers,
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    // Le corps peut contenir le secret client renvoyé en écho : on ne le
    // journalise pas et on ne le remonte pas à l'appelant.
    throw upstreamError(`Le fournisseur a refusé l'échange de jetons (${response.status}).`);
  }

  const tokens = (await response.json()) as TokenResponse;
  if (!tokens.access_token) throw upstreamError("Le fournisseur n'a pas renvoyé de jeton d'accès.");
  return tokens;
}

function toCredentials(tokens: TokenResponse): OAuthCredentials {
  return {
    accessToken: tokens.access_token as string,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    ...(tokens.expires_in
      ? { expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString() }
      : {}),
    ...(tokens.scope ? { scope: tokens.scope } : {}),
  };
}
