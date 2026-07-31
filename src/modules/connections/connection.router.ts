import { Router } from 'express';
import { z } from 'zod';
import { recordAudit } from '../../core/audit.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rate-limit.js';
import { getBody, getParams, getQuery, validate } from '../../middleware/validate.js';
import { completeConnectorOAuth, startConnectorOAuth } from './connector-oauth.service.js';
import {
  addEndpoint,
  createConnection,
  deleteConnection,
  getConnection,
  listConnections,
  removeEndpoint,
  revealEndpoint,
  updateConnection,
  verifyConnection,
} from './connection.service.js';

export const connectionRouter: Router = Router();

// --- Raccordement OAuth d'un compte tiers (« couche B ») -------------------
// Déclaré avant `requireAuth` global car le rappel du fournisseur arrive par
// navigation : la session est portée par le cookie, mais un échec doit
// rediriger vers une page, pas renvoyer un JSON 401.

const oauthStartSchema = z.object({
  label: z.string().trim().min(1).max(60).default('Compte principal'),
  returnTo: z.string().max(512).default('/connexions'),
});

const oauthCallbackSchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().max(200).optional(),
});

connectionRouter.get(
  '/oauth/:connectorId/start',
  requireAuth,
  sensitiveLimiter,
  validate({ params: z.object({ connectorId: z.string().min(1).max(40) }), query: oauthStartSchema }),
  (req, res) => {
    const { connectorId } = getParams<{ connectorId: string }>(req);
    const { label, returnTo } = getQuery<z.infer<typeof oauthStartSchema>>(req);

    res.redirect(
      startConnectorOAuth(res, { connectorId, userId: auth(req).userId, label, returnTo }),
    );
  },
);

connectionRouter.get(
  '/oauth/:connectorId/callback',
  validate({
    params: z.object({ connectorId: z.string().min(1).max(40) }),
    query: oauthCallbackSchema,
  }),
  async (req, res) => {
    const { connectorId } = getParams<{ connectorId: string }>(req);
    const query = getQuery<z.infer<typeof oauthCallbackSchema>>(req);

    if (query.error || !query.code || !query.state) {
      res.redirect(`/connexions?erreur=${encodeURIComponent(query.error ?? 'autorisation_annulee')}`);
      return;
    }

    const { connectionId, returnTo } = await completeConnectorOAuth(req, res, {
      connectorId,
      code: query.code,
      state: query.state,
    });

    recordAudit({
      action: 'connection.created',
      userId: req.currentUser?.userId ?? null,
      targetType: 'connection',
      targetId: connectionId,
      metadata: { connectorId, via: 'oauth' },
    });

    // `returnTo` peut ramener sur l'écran de consentement MCP : c'est ce
    // chaînage qui donne l'impression d'un seul et même parcours.
    const separator = returnTo.includes('?') ? '&' : '?';
    res.redirect(`${returnTo}${separator}compte=${encodeURIComponent(connectionId)}`);
  },
);

connectionRouter.use(requireAuth);

const labelSchema = z.string().trim().min(1).max(60);
const idParam = z.object({ id: z.string().min(1).max(40) });
const endpointParams = z.object({ id: z.string().min(1).max(40), endpointId: z.string().min(1).max(40) });

const createSchema = z.object({
  connectorId: z.string().min(1).max(40),
  label: labelSchema.default('Compte principal'),
  // Validé finement par le connecteur lui-même (parseCredentials).
  credentials: z.record(z.string(), z.string()),
});

const updateSchema = z
  .object({
    label: labelSchema.optional(),
    credentials: z.record(z.string(), z.string()).optional(),
  })
  .refine((value) => value.label !== undefined || value.credentials !== undefined, {
    message: 'Rien à mettre à jour.',
  });

const endpointSchema = z.object({ name: z.string().trim().min(1).max(60).default('Point d’accès') });

connectionRouter.get('/', async (req, res) => {
  res.json({ connections: await listConnections(auth(req).userId) });
});

connectionRouter.post('/', sensitiveLimiter, validate({ body: createSchema }), async (req, res) => {
  const { userId } = auth(req);
  const input = getBody<z.infer<typeof createSchema>>(req);

  const { connection, endpointUrl } = await createConnection({ userId, ...input });

  recordAudit({
    action: 'connection.created',
    userId,
    targetType: 'connection',
    targetId: connection.id,
    metadata: { connectorId: connection.connectorId },
  });

  // L'URL complète n'est renvoyée qu'ici et via /reveal : jamais dans les listes.
  res.status(201).json({ connection, endpointUrl });
});

connectionRouter.get('/:id', validate({ params: idParam }), async (req, res) => {
  const { id } = getParams<{ id: string }>(req);
  res.json({ connection: await getConnection(auth(req).userId, id) });
});

connectionRouter.patch(
  '/:id',
  validate({ params: idParam, body: updateSchema }),
  async (req, res) => {
    const { userId } = auth(req);
    const { id } = getParams<{ id: string }>(req);
    const input = getBody<z.infer<typeof updateSchema>>(req);

    const connection = await updateConnection({ userId, connectionId: id, ...input });

    recordAudit({
      action: 'connection.updated',
      userId,
      targetType: 'connection',
      targetId: id,
      metadata: { credentialsChanged: input.credentials !== undefined },
    });

    res.json({ connection });
  },
);

connectionRouter.post(
  '/:id/verify',
  sensitiveLimiter,
  validate({ params: idParam }),
  async (req, res) => {
    const { userId } = auth(req);
    const { id } = getParams<{ id: string }>(req);

    const connection = await verifyConnection(userId, id);
    recordAudit({ action: 'connection.verified', userId, targetType: 'connection', targetId: id });

    res.json({ connection });
  },
);

connectionRouter.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const { userId } = auth(req);
  const { id } = getParams<{ id: string }>(req);

  await deleteConnection(userId, id);
  recordAudit({ action: 'connection.deleted', userId, targetType: 'connection', targetId: id });

  res.status(204).end();
});

// --- Points d'accès MCP ----------------------------------------------------

connectionRouter.post(
  '/:id/endpoints',
  sensitiveLimiter,
  validate({ params: idParam, body: endpointSchema }),
  async (req, res) => {
    const { userId } = auth(req);
    const { id } = getParams<{ id: string }>(req);
    const { name } = getBody<{ name: string }>(req);

    const { endpoint, url } = await addEndpoint(userId, id, name);
    recordAudit({
      action: 'endpoint.created',
      userId,
      targetType: 'endpoint',
      targetId: endpoint.id,
    });

    res.status(201).json({ endpoint, url });
  },
);

connectionRouter.post(
  '/:id/endpoints/:endpointId/reveal',
  sensitiveLimiter,
  validate({ params: endpointParams }),
  async (req, res) => {
    const { userId } = auth(req);
    const { id, endpointId } = getParams<{ id: string; endpointId: string }>(req);
    res.json({ url: await revealEndpoint(userId, id, endpointId) });
  },
);

connectionRouter.delete(
  '/:id/endpoints/:endpointId',
  validate({ params: endpointParams }),
  async (req, res) => {
    const { userId } = auth(req);
    const { id, endpointId } = getParams<{ id: string; endpointId: string }>(req);

    await removeEndpoint(userId, id, endpointId);
    recordAudit({ action: 'endpoint.revoked', userId, targetType: 'endpoint', targetId: endpointId });

    res.status(204).end();
  },
);
