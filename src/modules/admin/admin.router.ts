import { Router } from 'express';
import { z } from 'zod';
import { connectorCount, listConnectors } from '../../connectors/registry.js';
import { recordAudit } from '../../core/audit.js';
import { env } from '../../core/env.js';
import { badRequest, notFound } from '../../core/errors.js';
import { prisma } from '../../core/prisma.js';
import { createStaticClient, DUST_STATIC_REDIRECT_URIS } from '../oauth/client-store.js';
import { auth, requireAdmin, requireAuth } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rate-limit.js';
import { getBody, getParams, getQuery, validate } from '../../middleware/validate.js';

/**
 * Panneau d'administration. Toutes les routes exigent le rôle ADMIN, vérifié
 * en base — l'ancienne version se contentait d'une liste d'e-mails codée en
 * dur, dupliquée dans un fichier JavaScript servi au navigateur.
 */

export const adminRouter: Router = Router();

adminRouter.use(requireAuth, requireAdmin);

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(80).optional(),
});

/** Vue d'ensemble : usage de la plateforme et santé des connecteurs. */
adminRouter.get('/overview', async (_req, res) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [users, activeUsers, connections, endpoints, calls, failures, perConnector, recentAudit] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { lastLoginAt: { gte: since } } }),
      prisma.connection.count(),
      prisma.mcpEndpoint.count({ where: { revokedAt: null } }),
      prisma.toolInvocation.count({ where: { createdAt: { gte: since } } }),
      prisma.toolInvocation.count({ where: { createdAt: { gte: since }, success: false } }),
      prisma.toolInvocation.groupBy({
        by: ['connectorId'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          action: true,
          createdAt: true,
          targetType: true,
          user: { select: { email: true } },
        },
      }),
    ]);

  const usageByConnector = new Map(perConnector.map((row) => [row.connectorId, row._count._all]));

  res.json({
    period: { days: 7, since },
    totals: { users, activeUsers, connections, endpoints, connectors: connectorCount() },
    calls: { total: calls, failed: failures, successRate: calls === 0 ? 1 : 1 - failures / calls },
    connectors: listConnectors().map((connector) => ({
      id: connector.id,
      name: connector.name,
      tools: connector.tools.length,
      status: connector.status ?? 'stable',
      calls: usageByConnector.get(connector.id) ?? 0,
    })),
    recentActivity: recentAudit,
  });
});

adminRouter.get('/users', validate({ query: paginationSchema }), async (req, res) => {
  const { page, perPage, q } = getQuery<z.infer<typeof paginationSchema>>(req);

  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: 'insensitive' as const } },
          { firstName: { contains: q, mode: 'insensitive' as const } },
          { lastName: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        provider: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        _count: { select: { connections: true } },
      },
    }),
  ]);

  res.json({ users, page, perPage, total, pages: Math.ceil(total / perPage) });
});

const userIdParam = z.object({ id: z.string().min(1).max(40) });

adminRouter.patch(
  '/users/:id',
  validate({
    params: userIdParam,
    body: z.object({ role: z.enum(['USER', 'ADMIN']).optional(), isActive: z.boolean().optional() }),
  }),
  async (req, res) => {
    const actor = auth(req);
    const { id } = getParams<{ id: string }>(req);
    const changes = getBody<{ role?: 'USER' | 'ADMIN'; isActive?: boolean }>(req);

    if (id === actor.userId && (changes.role === 'USER' || changes.isActive === false)) {
      // Sans ce garde-fou, un administrateur peut se retirer ses propres droits
      // et laisser la plateforme sans aucun compte capable d'y accéder.
      throw badRequest('Vous ne pouvez pas retirer vos propres droits ni désactiver votre compte.');
    }

    if (changes.role === 'USER') {
      const admins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
      if (admins <= 1) throw badRequest('Il doit rester au moins un administrateur actif.');
    }

    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw notFound('Utilisateur introuvable.');

    const user = await prisma.user.update({
      where: { id },
      data: changes,
      select: { id: true, email: true, role: true, isActive: true },
    });

    // Désactiver un compte doit couper l'accès immédiatement.
    if (changes.isActive === false) await prisma.session.deleteMany({ where: { userId: id } });

    if (changes.role) {
      recordAudit({
        action: 'user.role_changed',
        userId: actor.userId,
        targetType: 'user',
        targetId: id,
        metadata: { role: changes.role },
      });
    }

    res.json({ user });
  },
);

// --- Clients MCP -----------------------------------------------------------

/**
 * Liste des clients MCP connectés à la plateforme, dynamiques et statiques.
 * Aucun secret n'est renvoyé : seule la création l'affiche, une fois.
 */
adminRouter.get('/mcp-clients', async (_req, res) => {
  const clients = await prisma.oAuthClient.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      clientId: true,
      name: true,
      isStatic: true,
      redirectUris: true,
      lastUsedAt: true,
      createdAt: true,
      _count: { select: { tokens: true } },
      accesses: {
        select: { connectorId: true, mode: true, owner: { select: { email: true } } },
      },
    },
  });

  res.json({ clients, dustRedirectUris: DUST_STATIC_REDIRECT_URIS });
});

/**
 * Crée un client confidentiel pour les outils qui ne savent pas s'enregistrer
 * seuls — c'est le mode « Static OAuth » de Dust.
 */
adminRouter.post(
  '/mcp-clients',
  sensitiveLimiter,
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(120),
      redirectUris: z.array(z.string().url()).min(1).max(10),
    }),
  }),
  async (req, res) => {
    const input = getBody<{ name: string; redirectUris: string[] }>(req);
    const created = await createStaticClient(input);

    recordAudit({
      action: 'oauth.client_registered',
      userId: auth(req).userId,
      targetType: 'oauth_client',
      targetId: created.clientId,
      metadata: { name: input.name, static: true },
    });

    // Le secret n'apparaîtra plus jamais ensuite.
    res.status(201).json({
      ...created,
      authorizationEndpoint: `${env.baseUrl}/authorize`,
      tokenEndpoint: `${env.baseUrl}/token`,
      scopes: 'mcp',
    });
  },
);

adminRouter.delete(
  '/mcp-clients/:id',
  validate({ params: userIdParam }),
  async (req, res) => {
    const { id } = getParams<{ id: string }>(req);
    // Les jetons et accès partent en cascade : révocation immédiate.
    await prisma.oAuthClient.delete({ where: { id } });
    res.status(204).end();
  },
);

/** Statistiques d'usage par outil, pour repérer ce qui sert vraiment. */
adminRouter.get(
  '/usage',
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }) }),
  async (req, res) => {
    const { days } = getQuery<{ days: number }>(req);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await prisma.toolInvocation.groupBy({
      by: ['connectorId', 'toolName', 'success'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _avg: { durationMs: true },
    });

    const byTool = new Map<
      string,
      { connectorId: string; toolName: string; calls: number; failures: number; avgMs: number }
    >();

    for (const row of rows) {
      const key = `${row.connectorId}::${row.toolName}`;
      const entry = byTool.get(key) ?? {
        connectorId: row.connectorId,
        toolName: row.toolName,
        calls: 0,
        failures: 0,
        avgMs: 0,
      };

      entry.calls += row._count._all;
      if (!row.success) entry.failures += row._count._all;
      entry.avgMs = Math.round(row._avg.durationMs ?? entry.avgMs);
      byTool.set(key, entry);
    }

    res.json({
      days,
      since,
      tools: [...byTool.values()].sort((a, b) => b.calls - a.calls),
    });
  },
);
