import type { Prisma } from '@prisma/client';
import { logger } from './logger.js';
import { prisma } from './prisma.js';

/**
 * Piste d'audit des actions sensibles. Écriture « au mieux » : un échec
 * d'écriture du journal ne doit jamais faire échouer l'action métier.
 */

export type AuditAction =
  | 'user.register'
  | 'user.login'
  | 'user.login_failed'
  | 'user.logout'
  | 'user.delete'
  | 'user.password_changed'
  | 'user.password_reset_requested'
  | 'user.password_reset'
  | 'user.role_changed'
  | 'connection.created'
  | 'connection.updated'
  | 'connection.deleted'
  | 'connection.verified'
  | 'endpoint.created'
  | 'endpoint.revoked'
  | 'endpoint.rotated'
  | 'oauth.authorized'
  | 'oauth.denied'
  | 'oauth.client_registered'
  | 'oauth.clients_purged';

type AuditInput = {
  action: AuditAction;
  userId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
};

export function recordAudit(input: AuditInput): void {
  void prisma.auditLog
    .create({
      data: {
        action: input.action,
        userId: input.userId ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: input.metadata,
        ipAddress: input.ipAddress ?? null,
      },
    })
    .catch((error: unknown) => {
      logger.warn({ err: error, action: input.action }, "Échec d'écriture du journal d'audit");
    });
}
