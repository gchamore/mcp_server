import type { RequestHandler } from 'express';
import helmet from 'helmet';
import { env } from '../core/env.js';
import { forbidden } from '../core/errors.js';

/**
 * En-têtes de sécurité et politique d'origine.
 *
 * L'ancienne version renvoyait `Access-Control-Allow-Origin: *` sur toutes les
 * routes API, y compris celles qui portent une session — n'importe quel site
 * pouvait donc appeler l'API depuis le navigateur d'un utilisateur connecté.
 * Ici la liste d'origines est explicite et les cookies ne sont partagés
 * qu'avec elles.
 */

export const securityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // Le style en ligne reste nécessaire pour les variables CSS injectées
      // (couleur d'accent d'un connecteur, par exemple).
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Les icônes des connecteurs sont hébergées par les services eux-mêmes.
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", ...env.corsOrigins],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      ...(env.isProduction ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  crossOriginEmbedderPolicy: false,
  // Les icônes distantes seraient bloquées par la valeur par défaut.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

/** CORS restreint aux origines déclarées, avec cookies autorisés. */
export const cors: RequestHandler = (req, res, next) => {
  const origin = req.get('origin');

  if (origin && env.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
};

/**
 * Défense CSRF pour l'API.
 *
 * Le cookie de session est en SameSite=Lax, ce qui bloque déjà l'essentiel.
 * On y ajoute une vérification d'origine sur les méthodes mutantes : un
 * formulaire hébergé sur un autre domaine ne peut ni forger l'en-tête `Origin`
 * ni le supprimer.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }

  const origin = req.get('origin');

  // Absence d'Origin : requête non-navigateur (curl, client MCP, tests).
  // Ces appelants ne portent pas de cookie ambiant, donc pas de risque CSRF.
  if (!origin) {
    next();
    return;
  }

  if (!env.corsOrigins.includes(origin)) {
    next(forbidden('Origine non autorisée.'));
    return;
  }

  next();
};
