import { Router } from 'express';
import { z } from 'zod';
import { recordAudit } from '../../core/audit.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rate-limit.js';
import { getBody, getQuery, validate } from '../../middleware/validate.js';
import { approveAuthorization, denyAuthorization, describeAuthorization } from './consent.service.js';
import { decodePendingAuthorization } from './provider.js';

/**
 * API de l'écran de consentement.
 *
 * Distincte des points d'accès OAuth normalisés (`/authorize`, `/token`…),
 * qui sont servis par le routeur du SDK : ici on parle à notre propre
 * interface React, avec la session Wesype habituelle.
 */

export const oauthRouter: Router = Router();

const demandeSchema = z.object({ demande: z.string().min(20).max(4000) });

/** Le connecteur n'est fourni que si le client n'a pas transmis de `resource`. */
const describeSchema = demandeSchema.extend({
  connectorId: z.string().min(1).max(40).optional(),
});

const approveSchema = z.object({
  demande: z.string().min(20).max(4000),
  connectionId: z.string().min(1).max(40).optional(),
  connectorId: z.string().min(1).max(40).optional(),
});

/** Ce que l'écran de consentement doit afficher. */
oauthRouter.get(
  '/authorization',
  requireAuth,
  validate({ query: describeSchema }),
  async (req, res) => {
    const { demande, connectorId } = getQuery<z.infer<typeof describeSchema>>(req);
    const pending = decodePendingAuthorization(demande);

    res.json(await describeAuthorization(pending, auth(req).userId, connectorId));
  },
);

/** L'utilisateur accepte : on émet le code et on renvoie où rediriger. */
oauthRouter.post(
  '/authorization/approve',
  requireAuth,
  sensitiveLimiter,
  validate({ body: approveSchema }),
  async (req, res) => {
    const { userId } = auth(req);
    const input = getBody<z.infer<typeof approveSchema>>(req);
    const pending = decodePendingAuthorization(input.demande);

    const redirectTo = await approveAuthorization(pending, userId, {
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
      ...(input.connectorId ? { connectorId: input.connectorId } : {}),
    });

    recordAudit({
      action: 'oauth.authorized',
      userId,
      targetType: 'connector',
      ...(pending.connectorId ?? input.connectorId
        ? { targetId: (pending.connectorId ?? input.connectorId) as string }
        : {}),
      metadata: { clientId: pending.clientId, connectionId: input.connectionId ?? null },
    });

    res.json({ redirectTo });
  },
);

/** L'utilisateur refuse : on renvoie l'erreur OAuth normalisée au client. */
oauthRouter.post(
  '/authorization/deny',
  requireAuth,
  validate({ body: demandeSchema }),
  (req, res) => {
    const { demande } = getBody<{ demande: string }>(req);
    const pending = decodePendingAuthorization(demande);

    recordAudit({
      action: 'oauth.denied',
      userId: auth(req).userId,
      targetType: 'connector',
      ...(pending.connectorId ? { targetId: pending.connectorId } : {}),
    });

    res.json({ redirectTo: denyAuthorization(pending) });
  },
);
