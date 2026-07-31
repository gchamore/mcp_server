import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { sign, verifySignature } from '../../core/crypto.js';
import { env } from '../../core/env.js';
import { badRequest, featureDisabled, upstreamError } from '../../core/errors.js';

/**
 * OAuth 2.0 Google — implémentation directe, sans Passport ni session serveur.
 *
 * L'ancienne version tirait passport + express-session (avec un MemoryStore qui
 * fuit et casse dès qu'il y a plus d'une instance) pour ce seul cas d'usage.
 * Le flux « Authorization Code + PKCE » tient en une centaine de lignes et
 * n'introduit aucun état côté serveur : `state` et `code_verifier` voyagent dans
 * un cookie signé de courte durée.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

const STATE_COOKIE = 'wsp_oauth';

export type GoogleProfile = {
  googleId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
};

function requireConfig() {
  if (!env.googleOAuth.enabled) {
    throw featureDisabled("La connexion Google n'est pas configurée sur ce serveur.");
  }
  return env.googleOAuth;
}

export const isGoogleEnabled = () => env.googleOAuth.enabled;

/** Prépare l'URL d'autorisation et dépose l'état dans un cookie signé. */
export function beginGoogleAuth(res: Response, returnTo: string | undefined): string {
  const config = requireConfig();

  const state = randomBytes(16).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const payload = JSON.stringify({
    state,
    codeVerifier,
    returnTo: sanitizeReturnTo(returnTo),
    expiresAt: Date.now() + env.ttl.oauthStateMinutes * 60_000,
  });
  const encoded = Buffer.from(payload).toString('base64url');

  res.cookie(STATE_COOKIE, `${encoded}.${sign(encoded)}`, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: env.ttl.oauthStateMinutes * 60_000,
  });

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');

  return url.toString();
}

/** Vérifie `state`, échange le code et renvoie le profil Google. */
export async function completeGoogleAuth(
  req: Request,
  res: Response,
  input: { code: string; state: string },
): Promise<{ profile: GoogleProfile; returnTo: string }> {
  const config = requireConfig();
  const stored = readState(req);
  res.clearCookie(STATE_COOKIE, { path: '/api/auth' });

  if (!stored) throw badRequest('Session OAuth expirée. Relancez la connexion.');
  if (stored.state !== input.state) throw badRequest('Paramètre state invalide.');

  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: stored.codeVerifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!tokenResponse.ok) {
    throw upstreamError("Google a refusé l'échange du code d'autorisation.");
  }

  const tokens = (await tokenResponse.json()) as { access_token?: string };
  if (!tokens.access_token) throw upstreamError("Google n'a pas renvoyé de jeton d'accès.");

  const userResponse = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!userResponse.ok) throw upstreamError('Impossible de lire le profil Google.');

  const profile = (await userResponse.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    given_name?: string;
    family_name?: string;
    picture?: string;
  };

  if (!profile.sub || !profile.email) {
    throw upstreamError('Profil Google incomplet (identifiant ou e-mail manquant).');
  }
  // Sans cette vérification, un compte Google à l'e-mail non validé pourrait
  // prendre le contrôle d'un compte local existant portant la même adresse.
  if (profile.email_verified === false) {
    throw badRequest("L'adresse e-mail de ce compte Google n'est pas vérifiée.");
  }

  return {
    profile: {
      googleId: profile.sub,
      email: profile.email,
      ...(profile.given_name ? { firstName: profile.given_name } : {}),
      ...(profile.family_name ? { lastName: profile.family_name } : {}),
      ...(profile.picture ? { avatarUrl: profile.picture } : {}),
    },
    returnTo: stored.returnTo,
  };
}

type StoredState = { state: string; codeVerifier: string; returnTo: string; expiresAt: number };

function readState(req: Request): StoredState | null {
  const raw = req.cookies?.[STATE_COOKIE];
  if (typeof raw !== 'string') return null;

  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return null;

  const encoded = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!verifySignature(encoded, signature)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as StoredState;
    return parsed.expiresAt > Date.now() ? parsed : null;
  } catch {
    return null;
  }
}

/** N'accepte qu'un chemin interne : bloque les redirections ouvertes. */
function sanitizeReturnTo(value: string | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
