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

/**
 * ---------------------------------------------------------------------------
 * Trousseau de clés — ce qui rend la rotation possible
 * ---------------------------------------------------------------------------
 *
 * L'ancien format `v2.<iv>.<tag>.<données>` ne disait pas avec quelle clé il
 * avait été produit : changer ENCRYPTION_KEY rendait toute la base illisible
 * d'un coup, et une clé compromise ne laissait aucune porte de sortie.
 *
 * Le format v3 ajoute un identifiant de clé — huit hexadécimaux du SHA-256 de
 * la clé, ce qui identifie sans rien révéler :
 *
 *     v3.<idClé>.<iv>.<tag>.<données>
 *
 * Le chiffrement utilise toujours la clé primaire. Le déchiffrement accepte
 * toutes les clés du trousseau : la primaire, plus celles listées dans
 * ENCRYPTION_KEY_PREVIOUS pendant une rotation. La marche à suivre tient en
 * quatre gestes : nouvelle clé dans ENCRYPTION_KEY, ancienne dans
 * ENCRYPTION_KEY_PREVIOUS, `npm run rotate:encryption`, retirer l'ancienne.
 *
 * L'identifiant participe à l'AAD : déplacer un texte chiffré sous un autre
 * identifiant fait échouer l'authentification.
 */
const CURRENT_VERSION = 'v3';
const LEGACY_VERSION = 'v2';

export interface KeyRing {
  /** Clé primaire d'abord : c'est elle qui chiffre. Les autres ne font que lire. */
  keys: { id: string; key: Buffer }[];
}

function keyIdOf(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

/** Construit un trousseau. Exporté pour que les tests fabriquent le leur. */
export function buildKeyRing(primaryHex: string, previousHex: string[] = []): KeyRing {
  return {
    keys: [primaryHex, ...previousHex].map((hex) => {
      const key = Buffer.from(hex, 'hex');
      return { id: keyIdOf(key), key };
    }),
  };
}

const defaultRing = buildKeyRing(env.encryptionKey, env.encryptionKeysPrevious);

/** Chiffre une valeur JSON avec la clé primaire. Format : `v3.<idClé>.<iv>.<tag>.<données>`. */
export function encryptJson(value: unknown, ring: KeyRing = defaultRing): string {
  const primary = ring.keys[0];
  if (!primary) throw internalError('Trousseau de chiffrement vide');

  const plaintext = JSON.stringify(value);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, primary.key, iv);
  cipher.setAAD(Buffer.from(`${CURRENT_VERSION}.${primary.id}`));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    CURRENT_VERSION,
    primary.id,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptJson<T = unknown>(payload: string, ring: KeyRing = defaultRing): T {
  const parts = payload.split('.');

  // Format courant : l'identifiant désigne la clé, sans essais successifs.
  if (parts.length === 5 && parts[0] === CURRENT_VERSION) {
    const [, keyId, ivPart, tagPart, dataPart] = parts as [string, string, string, string, string];
    const entry = ring.keys.find((k) => k.id === keyId);
    if (!entry) {
      throw internalError(
        'Données chiffrées avec une clé absente du trousseau. ' +
          "Si une rotation est en cours, ajoutez l'ancienne clé à ENCRYPTION_KEY_PREVIOUS.",
      );
    }
    return open<T>(entry.key, `${CURRENT_VERSION}.${keyId}`, ivPart, tagPart, dataPart);
  }

  // Format hérité, sans identifiant : on essaie chaque clé du trousseau. Le tag
  // GCM authentifie — une mauvaise clé échoue, elle ne déchiffre pas de travers.
  if (parts.length === 4 && parts[0] === LEGACY_VERSION) {
    const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];
    for (const entry of ring.keys) {
      try {
        return open<T>(entry.key, LEGACY_VERSION, ivPart, tagPart, dataPart);
      } catch {
        // Clé suivante.
      }
    }
    throw internalError('Impossible de déchiffrer les identifiants');
  }

  throw internalError('Format de données chiffrées invalide');
}

function open<T>(key: Buffer, aad: string, ivPart: string, tagPart: string, dataPart: string): T {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'));
    decipher.setAAD(Buffer.from(aad));
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

/**
 * La donnée est-elle déjà chiffrée avec la clé primaire ?
 *
 * C'est le critère du rechiffrement : tout ce qui répond `false` — ancien
 * format v2, ou v3 sous une clé précédente — est à reprendre.
 */
export function isEncryptedWithPrimary(payload: string, ring: KeyRing = defaultRing): boolean {
  const parts = payload.split('.');
  return parts.length === 5 && parts[0] === CURRENT_VERSION && parts[1] === ring.keys[0]?.id;
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
