/**
 * ===========================================================================
 *  Destinations de redirection internes
 * ===========================================================================
 *
 * Une seule implémentation, parce qu'il y en avait trois : deux côté serveur
 * (connexion Google, raccordement d'un connecteur) et une côté navigateur, avec
 * des valeurs de repli différentes et — surtout — la même faille.
 *
 * ---------------------------------------------------------------------------
 * La faille
 * ---------------------------------------------------------------------------
 *
 * Le contrôle était : « commence par `/` mais pas par `//` ». Il laisse passer
 * `/\evil.test/vol`, que les navigateurs normalisent en `//evil.test/vol`,
 * c'est-à-dire une URL relative au protocole — donc un autre domaine :
 *
 *     new URL('/\\evil.test/vol', 'https://www.gchamore.com')
 *       → https://evil.test/vol
 *
 * C'est une redirection ouverte. Son intérêt pour un attaquant est de faire
 * partir un lien depuis *notre* domaine, avec notre certificat et notre nom,
 * vers une page qu'il contrôle : le parcours de connexion devient un support
 * d'hameçonnage crédible. Sur ce serveur, le paramètre traverse justement
 * l'écran de consentement OAuth, là où l'utilisateur est le plus enclin à
 * suivre une redirection sans la lire.
 *
 * ---------------------------------------------------------------------------
 * L'approche retenue
 * ---------------------------------------------------------------------------
 *
 * On ne cherche plus à repérer les formes dangereuses — cette liste n'est
 * jamais close. On résout la valeur contre une origine de référence et on
 * n'accepte que ce qui y reste. Le navigateur fait le même calcul : impossible
 * qu'une écriture exotique nous fasse dire oui et lui dire ailleurs.
 */
import { env } from './env.js';

/**
 * Caractères de contrôle.
 *
 * Ni utiles dans un chemin, ni interprétés de la même façon partout : `\r` et
 * `\n` permettraient d'injecter des en-têtes dans un `Location:`, et une
 * tabulation placée au bon endroit fait diverger notre lecture de celle du
 * navigateur.
 */
// eslint-disable-next-line no-control-regex -- les détecter est précisément l’objet de cette ligne.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Ramène une destination demandée à un chemin interne sûr.
 *
 * @param value       Ce que l'appelant a transmis. Non fiable par nature.
 * @param fallback    Destination retenue si `value` est absente ou refusée.
 *                    Doit être un chemin interne littéral, écrit dans le code.
 * @returns Un chemin commençant par `/`, jamais une URL absolue.
 */
export function safeInternalPath(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0) return fallback;

  // Un chemin ne commence jamais par autre chose. Écarté d'emblée : inutile de
  // résoudre une URL absolue pour la refuser ensuite.
  if (!value.startsWith('/')) return fallback;

  if (CONTROL_CHARACTERS.test(value)) return fallback;

  try {
    const resolved = new URL(value, env.baseUrl);
    const reference = new URL(env.baseUrl);

    // C'est ici que `/\evil.test` est attrapé : il se résout sur une autre
    // origine, exactement comme le ferait le navigateur.
    if (resolved.origin !== reference.origin) return fallback;

    // On renvoie la forme normalisée, pas l'entrée : ce qu'on a validé est
    // alors littéralement ce qu'on émet.
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
