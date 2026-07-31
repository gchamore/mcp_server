import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthClient } from '@prisma/client';
import { decryptJson, encryptJson, generateToken, hashToken } from '../../core/crypto.js';
import { logger } from '../../core/logger.js';
import { prisma } from '../../core/prisma.js';

/**
 * Répertoire des clients MCP (Claude, Dust, ChatGPT…).
 *
 * Deux façons d'y entrer, qui correspondent aux deux options documentées par
 * Dust pour ajouter un serveur MCP distant :
 *
 *  1. **Enregistrement dynamique** (RFC 7591) — l'option « Automatic ». Le
 *     client s'inscrit tout seul à partir de la seule URL. Client *public* :
 *     aucun secret, PKCE tient lieu d'authentification.
 *
 *  2. **Enregistrement statique** — l'option « Static OAuth ». Un administrateur
 *     crée le client à la main et remet `client_id` + `client_secret` à coller
 *     dans l'outil. Client *confidentiel*.
 *
 * S'enregistrer ne donne aucun droit : un client ne peut rien lire tant qu'un
 * utilisateur n'a pas consenti sur notre écran d'autorisation.
 */

const MAX_REDIRECT_URIS = 10;

/** URI de rappel de Dust en mode « Static OAuth », proposées par défaut. */
export const DUST_STATIC_REDIRECT_URIS = [
  'https://dust.tt/oauth/mcp_static/finalize',
  'https://eu.dust.tt/oauth/mcp_static/finalize',
];

function toClientInformation(row: OAuthClient): OAuthClientInformationFull {
  // Le SDK compare le secret en clair : il faut donc le restituer ici.
  const clientSecret = row.clientSecretEncrypted
    ? decryptJson<string>(row.clientSecretEncrypted)
    : undefined;

  return {
    client_id: row.clientId,
    client_name: row.name,
    redirect_uris: row.redirectUris,
    grant_types: row.grantTypes,
    response_types: ['code'],
    scope: row.scopes.join(' '),
    ...(clientSecret
      ? { client_secret: clientSecret, token_endpoint_auth_method: 'client_secret_post' }
      : { token_endpoint_auth_method: 'none' }),
    client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
  };
}

export const clientStore: OAuthRegisteredClientsStore = {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const client = await prisma.oAuthClient.findUnique({ where: { clientId } });
    return client ? toClientInformation(client) : undefined;
  },

  async registerClient(metadata): Promise<OAuthClientInformationFull> {
    const created = await prisma.oAuthClient.create({
      data: {
        clientId: newClientId(),
        name: metadata.client_name?.slice(0, 120) ?? 'Client MCP',
        redirectUris: metadata.redirect_uris.slice(0, MAX_REDIRECT_URIS),
        grantTypes: metadata.grant_types ?? ['authorization_code', 'refresh_token'],
        scopes: (metadata.scope ?? 'mcp').split(' ').filter(Boolean),
        isStatic: false,
      },
    });

    logger.info(
      { clientId: created.clientId, name: created.name },
      'Client MCP enregistré dynamiquement',
    );

    return toClientInformation(created);
  },
};

/**
 * Crée un client confidentiel à la main (mode « Static OAuth »).
 * Le secret n'est renvoyé qu'ici, une seule fois.
 */
export async function createStaticClient(input: {
  name: string;
  redirectUris: string[];
  scopes?: string[];
}): Promise<{ clientId: string; clientSecret: string }> {
  const clientId = newClientId();
  const clientSecret = generateToken('wsp-cs');

  await prisma.oAuthClient.create({
    data: {
      clientId,
      clientSecretEncrypted: encryptJson(clientSecret),
      name: input.name.slice(0, 120),
      redirectUris: input.redirectUris.slice(0, MAX_REDIRECT_URIS),
      grantTypes: ['authorization_code', 'refresh_token'],
      scopes: input.scopes ?? ['mcp'],
      isStatic: true,
    },
  });

  logger.info({ clientId, name: input.name }, 'Client MCP statique créé');
  return { clientId, clientSecret };
}

function newClientId(): string {
  return `wsp-client_${hashToken(`${Date.now()}:${Math.random()}`).slice(0, 24)}`;
}
