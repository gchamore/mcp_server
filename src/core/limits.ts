import { badRequest } from './errors.js';

/**
 * Bornes partagées entre les deux flux OAuth.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi `returnTo` est long
 * ---------------------------------------------------------------------------
 *
 * Quand un client IA lance une autorisation, la demande en attente est chiffrée
 * dans l'URL plutôt que rangée en base (voir `oauth/provider.ts`). Cette chaîne
 * fait à elle seule ~530 caractères pour une demande Dust ordinaire.
 *
 * Si l'utilisateur n'est pas connecté, l'écran de consentement l'envoie se
 * connecter en emportant sa destination :
 *
 *     /connexion?returnTo=%2Fautoriser%3Fdemande%3D<~530 caractères>
 *
 * Le `returnTo` dépasse alors 550 caractères. La borne de 512 retenue au départ
 * n'avait pas été calculée pour ce cas : elle rendait la connexion Google
 * impossible depuis le consentement, avec un message de validation obscur.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi 2048 et pas davantage
 * ---------------------------------------------------------------------------
 *
 * `returnTo` finit dans un cookie signé, et un navigateur **jette
 * silencieusement** tout cookie dépassant 4 096 octets. Le symptôme serait
 * alors « Session OAuth expirée » au retour du fournisseur — un message qui
 * n'oriente vers rien.
 *
 * Le pire cas est le flux connecteur, où l'état est chiffré (AES-GCM, environ
 * 1,34× le clair) avant signature :
 *
 *     (≈200 de contexte + returnTo) × 1,34 + 89 d'enveloppe ≤ 3 800
 *
 * ce qui autorise environ 2 500 caractères. 2 048 laisse une marge franche tout
 * en couvrant quatre fois le cas réel observé.
 */
export const MAX_RETURN_TO = 2048;

/** Marge de sécurité sous la limite de 4 096 octets imposée par les navigateurs. */
const MAX_COOKIE_BYTES = 3800;

/**
 * Refuse un cookie trop gros au lieu de le laisser tomber en silence.
 *
 * Sans ce contrôle, le navigateur ignore le `Set-Cookie` sans rien signaler :
 * la requête paraît réussir, l'utilisateur part chez Google, revient — et
 * l'état a disparu. On échoue donc ici, au moment où la cause est encore
 * lisible dans les journaux.
 */
export function assertCookieFits(name: string, value: string): void {
  const size = Buffer.byteLength(value, 'utf8');
  if (size <= MAX_COOKIE_BYTES) return;

  throw badRequest(
    `Demande d'autorisation trop volumineuse pour être traitée (${size} octets). ` +
      'Relancez la connexion depuis votre client IA.',
    { cookie: name, size, max: MAX_COOKIE_BYTES },
  );
}
