/**
 * ===========================================================================
 *  Signalement des erreurs du navigateur
 * ===========================================================================
 *
 * Une exception côté navigateur n'existe que dans la console de la personne qui
 * la subit. Sans remontée, une page blanche en production reste invisible tant
 * que quelqu'un ne prend pas la peine de la signaler.
 *
 * Trois sources sont couvertes :
 *
 *  • `render`  — le garde-fou de rendu React ;
 *  • `window`  — les erreurs non rattrapées hors de React ;
 *  • `promise` — les rejets de promesse sans `catch`.
 *
 * Volontairement sans dépendance : `fetch`, `keepalive`, et rien d'autre.
 */

const ENDPOINT = '/api/telemetry/errors';

/** Longueurs alignées sur le schéma du serveur : inutile d'émettre ce qu'il rejettera. */
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;

/**
 * Ce qui a déjà été signalé pendant cette visite.
 *
 * Une page qui casse en boucle produirait sinon un signalement par rendu, et
 * le serveur les refuserait tous après le trentième — en noyant au passage
 * ceux d'autres utilisateurs derrière la même sortie réseau.
 */
const dejaSignale = new Set<string>();

/** Plafond par chargement de page, indépendamment de la déduplication. */
const MAX_PAR_PAGE = 5;
let envoyes = 0;

interface Signalement {
  message: string;
  stack?: string;
  componentStack?: string;
  source: 'render' | 'window' | 'promise';
}

export function reportError({ message, stack, componentStack, source }: Signalement): void {
  const cle = `${source}:${message}`;
  if (envoyes >= MAX_PAR_PAGE || dejaSignale.has(cle)) return;

  dejaSignale.add(cle);
  envoyes += 1;

  const corps = {
    message: message.slice(0, MAX_MESSAGE),
    ...(stack ? { stack: stack.slice(0, MAX_STACK) } : {}),
    ...(componentStack ? { componentStack: componentStack.slice(0, MAX_STACK) } : {}),
    path: window.location.pathname + window.location.search,
    source,
  };

  void fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
    // La page peut être en train de se fermer ou de naviguer : `keepalive`
    // laisse la requête aboutir malgré tout.
    keepalive: true,
    // Le signalement d'une erreur ne doit jamais devenir la cause d'une autre.
  }).catch(() => undefined);
}

/**
 * Branche les sources globales.
 *
 * Appelé une seule fois au démarrage. Les erreurs de rendu React, elles, ne
 * remontent pas jusqu'à `window` : c'est le garde-fou qui les signale.
 */
export function installErrorReporting(): void {
  window.addEventListener('error', (event) => {
    reportError({
      message: event.message || 'Erreur inconnue',
      ...(event.error instanceof Error && event.error.stack ? { stack: event.error.stack } : {}),
      source: 'window',
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const raison: unknown = event.reason;
    reportError({
      message: raison instanceof Error ? raison.message : String(raison).slice(0, MAX_MESSAGE),
      ...(raison instanceof Error && raison.stack ? { stack: raison.stack } : {}),
      source: 'promise',
    });
  });
}
