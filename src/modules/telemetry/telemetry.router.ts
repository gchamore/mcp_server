import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../core/logger.js';
import { clientIp } from '../auth/session.service.js';
import { getBody, validate } from '../../middleware/validate.js';
import { telemetryLimiter } from '../../middleware/rate-limit.js';

/**
 * ===========================================================================
 *  Remontée des erreurs survenues dans le navigateur
 * ===========================================================================
 *
 * Le garde-fou de rendu écrivait dans `console.error`, c'est-à-dire nulle part :
 * une page blanche chez un utilisateur ne laissait aucune trace. On ne
 * l'apprenait que s'il prenait la peine de le signaler.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi pas Sentry
 * ---------------------------------------------------------------------------
 *
 * Parce qu'il faut un compte, une clé, un contrat, et que les journaux de
 * l'hébergeur suffisent à ce stade : ce qu'on cherche, c'est savoir *qu'une*
 * page a cassé, où, et avec quel message. Une ligne de journal structurée le
 * dit aussi bien qu'un tableau de bord.
 *
 * La forme retenue reste compatible avec un collecteur externe : le jour où
 * l'on en branche un, il n'y a qu'à ajouter un envoi dans `report()`, sans
 * toucher au navigateur.
 *
 * ---------------------------------------------------------------------------
 * Un point d'entrée non authentifié écrit dans les journaux
 * ---------------------------------------------------------------------------
 *
 * C'est nécessaire — une erreur survient aussi avant la connexion — et ça
 * mérite d'être borné, sans quoi le premier venu remplit le stockage de
 * journaux :
 *
 *  • limitation de débit dédiée, plus stricte que la globale ;
 *  • champs bornés en longueur et en nombre, par le schéma ;
 *  • rien n'est écrit en base, uniquement dans le flux de journaux ;
 *  • le contenu part dans des champs distincts, jamais concaténé au message —
 *    pino sérialise en JSON, une injection de fausse ligne est donc sans effet.
 */

export const telemetryRouter: Router = Router();

const errorReportSchema = z.object({
  /** Message de l'exception. Court par nature. */
  message: z.string().trim().min(1).max(500),
  /** Pile d'appels. Bornée : au-delà, le début suffit toujours à situer. */
  stack: z.string().max(4000).optional(),
  /** Arborescence des composants React, quand le garde-fou l'a fournie. */
  componentStack: z.string().max(4000).optional(),
  /** Route affichée au moment de l'erreur. */
  path: z.string().max(300).optional(),
  /** Origine du signalement, pour distinguer les cas au dépouillement. */
  source: z.enum(['render', 'window', 'promise']).default('render'),
});

type ErrorReport = z.infer<typeof errorReportSchema>;

telemetryRouter.post(
  '/errors',
  telemetryLimiter,
  validate({ body: errorReportSchema }),
  (req, res) => {
    const report = getBody<ErrorReport>(req);

    logger.error(
      {
        origine: 'navigateur',
        source: report.source,
        path: report.path,
        stack: report.stack,
        componentStack: report.componentStack,
        userAgent: req.get('user-agent')?.slice(0, 200),
        ip: clientIp(req),
        // Renseigné si une session existe : `optionalAuth` tourne en amont.
        userId: req.currentUser?.userId,
      },
      `Erreur navigateur : ${report.message}`,
    );

    // Réponse volontairement vide : le navigateur n'a rien à en faire, et un
    // corps de réponse ne ferait qu'inviter à s'en servir comme d'un écho.
    res.status(204).end();
  },
);
