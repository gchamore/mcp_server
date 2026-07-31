import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { env } from './env.js';
import { internalError } from './errors.js';

/**
 * Primitives cryptographiques du serveur.
 *
 * - `encryptJson` / `decryptJson` : chiffrement authentifié AES-256-GCM des
 *   identifiants tiers stockés en base.
 * - `generateToken` / `hashToken` : tokens opaques (sessions, endpoints MCP,
 *   réinitialisation de mot de passe). Seul le SHA-256 est stocké, jamais le
 *   token en clair — une fuite de la base ne donne aucun accès.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommandation NIST pour GCM
const CURRENT_VERSION = 'v2';

const key = Buffer.from(env.encryptionKey, 'hex');

/** Chiffre une valeur JSON. Format : `v2.<iv>.<tag>.<ciphertext>` (base64url). */
export function encryptJson(value: unknown): string {
  const plaintext = JSON.stringify(value);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(CURRENT_VERSION));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    CURRENT_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptJson<T = unknown>(payload: string): T {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== CURRENT_VERSION) {
    throw internalError('Format de données chiffrées invalide');
  }

  const [version, ivPart, tagPart, dataPart] = parts as [string, string, string, string];

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'));
    decipher.setAAD(Buffer.from(version));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');

    return JSON.parse(plaintext) as T;
  } catch (cause) {
    // Message volontairement générique : ne jamais indiquer *pourquoi* le
    // déchiffrement a échoué (mauvaise clé vs données corrompues).
    throw internalError('Impossible de déchiffrer les identifiants', cause);
  }
}

/** Token opaque, sûr pour une URL. 32 octets d'entropie. */
export function generateToken(prefix?: string): string {
  const token = randomBytes(32).toString('base64url');
  return prefix ? `${prefix}_${token}` : token;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Comparaison à temps constant de deux chaînes hexadécimales de même longueur. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Signature HMAC détachée, utilisée pour l'état OAuth (state + PKCE). */
export function sign(value: string): string {
  return createHmac('sha256', env.sessionSecret).update(value).digest('base64url');
}

export function verifySignature(value: string, signature: string): boolean {
  return safeEqual(sign(value), signature);
}
