import { pathToFileURL } from 'node:url';
import { decryptJson, encryptJson, isEncryptedWithPrimary } from '../core/crypto.js';
import { logger } from '../core/logger.js';
import { disconnectPrisma, prisma } from '../core/prisma.js';

/**
 * ===========================================================================
 *  Rechiffrement du stock — `npm run rotate:encryption`
 * ===========================================================================
 *
 * Reprend tout ce qui n'est pas chiffré avec la clé primaire courante — ancien
 * format v2, ou v3 sous une clé précédente — et le rechiffre. C'est l'étape 3
 * de la rotation :
 *
 *   1. nouvelle clé dans ENCRYPTION_KEY ;
 *   2. ancienne clé dans ENCRYPTION_KEY_PREVIOUS (le service continue de tout
 *      lire pendant ce temps — aucune interruption) ;
 *   3. `npm run rotate:encryption` ;
 *   4. retirer ENCRYPTION_KEY_PREVIOUS.
 *
 * Idempotent : une ligne déjà sous la clé primaire est ignorée. Relançable
 * après une interruption sans autre précaution.
 *
 * Trois colonnes chiffrées existent — la vérité est le schéma Prisma, et le
 * test de rotation échoue si une quatrième apparaît sans être reprise ici.
 */

export interface RotationReport {
  connections: number;
  endpoints: number;
  clients: number;
  /** Lignes déjà sous la clé primaire, laissées telles quelles. */
  skipped: number;
}

export async function rotateEncryptedColumns(): Promise<RotationReport> {
  const report: RotationReport = { connections: 0, endpoints: 0, clients: 0, skipped: 0 };

  const connections = await prisma.connection.findMany({
    select: { id: true, credentials: true },
  });
  for (const row of connections) {
    if (isEncryptedWithPrimary(row.credentials)) {
      report.skipped += 1;
      continue;
    }
    await prisma.connection.update({
      where: { id: row.id },
      data: { credentials: encryptJson(decryptJson(row.credentials)) },
    });
    report.connections += 1;
  }

  const endpoints = await prisma.mcpEndpoint.findMany({
    select: { id: true, tokenEncrypted: true },
  });
  for (const row of endpoints) {
    if (isEncryptedWithPrimary(row.tokenEncrypted)) {
      report.skipped += 1;
      continue;
    }
    await prisma.mcpEndpoint.update({
      where: { id: row.id },
      data: { tokenEncrypted: encryptJson(decryptJson(row.tokenEncrypted)) },
    });
    report.endpoints += 1;
  }

  const clients = await prisma.oAuthClient.findMany({
    where: { clientSecretEncrypted: { not: null } },
    select: { id: true, clientSecretEncrypted: true },
  });
  for (const row of clients) {
    const secret = row.clientSecretEncrypted as string;
    if (isEncryptedWithPrimary(secret)) {
      report.skipped += 1;
      continue;
    }
    await prisma.oAuthClient.update({
      where: { id: row.id },
      data: { clientSecretEncrypted: encryptJson(decryptJson(secret)) },
    });
    report.clients += 1;
  }

  return report;
}

// Exécution directe (`tsx src/jobs/rotate-encryption.ts`), jamais à l'import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  rotateEncryptedColumns()
    .then((report) => {
      logger.info(report, 'Rechiffrement terminé');
      return disconnectPrisma();
    })
    .catch((error) => {
      logger.error({ err: error }, 'Rechiffrement en échec — relançable sans risque');
      process.exitCode = 1;
      return disconnectPrisma();
    });
}
