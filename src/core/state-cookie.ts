import type { Request, Response } from 'express';
import { decryptJson, encryptJson, sign, verifySignature } from './crypto.js';
import { env } from './env.js';
import { assertCookieFits } from './limits.js';

/**
 * ===========================================================================
 *  État OAuth transporté par cookie signé
 * ===========================================================================
 *
 * Les deux flux OAuth du serveur ont le même besoin : conserver, le temps d'un
 * aller-retour chez un fournisseur, un peu d'état que le client ne doit ni lire
 * ni modifier — vérificateur PKCE, destination de retour, échéance.
 *
 * Ils l'implémentaient chacun de leur côté : même découpage de la signature sur
 * le dernier point, même vérification, même contrôle d'expiration, à deux
 * endroits. Une correction sur l'un ne se propageait pas à l'autre, ce qui est
 * exactement la façon dont un contrôle de sécurité finit par diverger.
 *
 * ---------------------------------------------------------------------------
 * Chiffré ou seulement signé ?
 * ---------------------------------------------------------------------------
 *
 * Les deux, selon le contenu, et c'est délibéré :
 *
 *  • signé      — l'état est lisible par son porteur, mais infalsifiable. Suffit
 *                 quand il ne contient rien de secret pour l'utilisateur, qui
 *                 est de toute façon la personne concernée ;
 *  • chiffré    — en plus, illisible. Nécessaire dès que l'état porte de quoi
 *                 identifier un tiers, comme un identifiant d'utilisateur.
 *
 * Dans les deux cas la signature est vérifiée avant tout décodage : on ne donne
 * pas à l'analyseur JSON, ni au déchiffrement, des octets qu'on n'a pas
 * authentifiés.
 */

export interface StateCookieOptions {
  /** Nom du cookie. Distinct par flux, pour qu'ils ne s'écrasent pas. */
  name: string;
  /**
   * Chemin de portée du cookie.
   *
   * Volontairement étroit : le cookie n'est envoyé qu'aux routes qui en ont
   * besoin, et non sur chaque requête de page ou d'asset.
   */
  path: string;
  /** Durée de vie, en millisecondes. Courte par nature : un aller-retour. */
  ttlMs: number;
  /** Chiffrer le contenu en plus de le signer. */
  encrypted?: boolean;
}

/** Tout état stocké porte sa propre échéance : un cookie peut survivre au TTL. */
interface Expirable {
  expiresAt: number;
}

export class StateCookie<T extends Expirable> {
  constructor(private readonly options: StateCookieOptions) {}

  /** Sérialise, authentifie et dépose l'état. */
  write(res: Response, state: T): void {
    const payload = this.options.encrypted
      ? encryptJson(state)
      : Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');

    const value = `${payload}.${sign(payload)}`;
    assertCookieFits(this.options.name, value);

    res.cookie(this.options.name, value, {
      httpOnly: true,
      secure: env.isProduction,
      // `lax` et non `strict` : le retour du fournisseur est une navigation
      // venue d'un autre site, et `strict` empêcherait le cookie de partir —
      // le flux échouerait systématiquement à la dernière étape.
      sameSite: 'lax',
      path: this.options.path,
      maxAge: this.options.ttlMs,
    });
  }

  /**
   * Relit l'état. Renvoie `null` pour toute anomalie, sans distinguer les cas.
   *
   * Cookie absent, signature invalide, contenu illisible, état périmé : la
   * conclusion utile est la même — il n'y a pas d'état exploitable. Détailler
   * la cause à l'appelant n'aiderait que celui qui cherche à en fabriquer un.
   */
  read(req: Request): T | null {
    const raw = req.cookies?.[this.options.name];
    if (typeof raw !== 'string') return null;

    // La charge peut contenir des points (le format chiffré en a) : on découpe
    // sur le dernier, jamais sur le premier.
    const separator = raw.lastIndexOf('.');
    if (separator <= 0) return null;

    const payload = raw.slice(0, separator);
    if (!verifySignature(payload, raw.slice(separator + 1))) return null;

    try {
      const state = this.options.encrypted
        ? decryptJson<T>(payload)
        : (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T);

      return state.expiresAt > Date.now() ? state : null;
    } catch {
      return null;
    }
  }

  /** Efface le cookie. Le chemin doit correspondre à celui de la pose. */
  clear(res: Response): void {
    res.clearCookie(this.options.name, { path: this.options.path });
  }

  /** Échéance à poser dans l'état, cohérente avec la durée de vie du cookie. */
  expiryTimestamp(): number {
    return Date.now() + this.options.ttlMs;
  }
}
