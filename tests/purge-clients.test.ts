import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/core/prisma.js';
import { purgeOrphanClients } from '../src/jobs/cleanup.js';
import { encryptJson, hashToken } from '../src/core/crypto.js';

/**
 * Purge des inscriptions dynamiques abandonnées.
 *
 * Chaque tentative d'ajout d'un serveur MCP crée une inscription (RFC 7591), y
 * compris les tentatives qui échouent. Retirer le serveur côté Dust ne nous en
 * informe pas : la RFC 7592 prévoit un point de terminaison pour supprimer une
 * inscription, mais aucune plateforme ne l'appelle.
 *
 * Le risque de la purge est évidemment de couper un accès réel. Ces tests
 * cadrent précisément ce qu'elle a le droit de supprimer.
 */

const PREFIX = 'purge-test-';
const HOURS = 60 * 60 * 1000;

let userId: string;

async function creerClient(options: {
  suffixe: string;
  ageHeures: number;
  avecJeton?: boolean;
  statique?: boolean;
  dejaUtilise?: boolean;
}) {
  const createdAt = new Date(Date.now() - options.ageHeures * HOURS);

  const client = await prisma.oAuthClient.create({
    data: {
      clientId: `${PREFIX}${options.suffixe}`,
      name: `${PREFIX}${options.suffixe}`,
      redirectUris: ['https://dust.tt/oauth/mcp/finalize'],
      grantTypes: ['authorization_code'],
      scopes: ['mcp'],
      isStatic: options.statique ?? false,
      createdAt,
      ...(options.dejaUtilise ? { lastUsedAt: createdAt } : {}),
      ...(options.statique ? { clientSecretEncrypted: encryptJson('secret') } : {}),
    },
  });

  if (options.avecJeton) {
    await prisma.oAuthToken.create({
      data: {
        tokenHash: hashToken(`acces-${options.suffixe}`),
        type: 'ACCESS',
        oauthClientId: client.id,
        userId,
        connectorId: 'axonaut',
        scopes: ['mcp'],
        familyId: `famille-${options.suffixe}`,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
  }

  return client;
}

beforeAll(async () => {
  const user = await prisma.user.upsert({
    where: { email: 'purge-test@test.local' },
    update: {},
    create: { email: 'purge-test@test.local', passwordHash: 'x' },
  });
  userId = user.id;
});

afterEach(async () => {
  await prisma.oAuthClient.deleteMany({ where: { clientId: { startsWith: PREFIX } } });
});

describe('purge des inscriptions abandonnées', () => {
  it('retire une inscription ancienne, sans jeton et jamais utilisée', async () => {
    await creerClient({ suffixe: 'abandonnee', ageHeures: 48 });

    await purgeOrphanClients();

    const reste = await prisma.oAuthClient.findUnique({
      where: { clientId: `${PREFIX}abandonnee` },
    });
    expect(reste).toBeNull();
  });

  it('épargne une inscription récente — le consentement peut être en cours', async () => {
    await creerClient({ suffixe: 'recente', ageHeures: 1 });

    await purgeOrphanClients();

    expect(
      await prisma.oAuthClient.findUnique({ where: { clientId: `${PREFIX}recente` } }),
    ).not.toBeNull();
  });

  it('épargne une inscription qui détient un jeton, même ancienne', async () => {
    await creerClient({ suffixe: 'avec-jeton', ageHeures: 500, avecJeton: true });

    await purgeOrphanClients();

    /**
     * C'est la garantie qui compte : un client détenant un jeton donne un accès
     * réel. Le supprimer couperait un serveur MCP en service, sans que personne
     * l'ait demandé. Sa suppression relève d'une révocation explicite.
     */
    expect(
      await prisma.oAuthClient.findUnique({ where: { clientId: `${PREFIX}avec-jeton` } }),
    ).not.toBeNull();
  });

  it('épargne une inscription déjà utilisée, même sans jeton en cours', async () => {
    await creerClient({ suffixe: 'deja-servie', ageHeures: 500, dejaUtilise: true });

    await purgeOrphanClients();

    expect(
      await prisma.oAuthClient.findUnique({ where: { clientId: `${PREFIX}deja-servie` } }),
    ).not.toBeNull();
  });

  it('épargne un client statique, créé à la main et pas encore servi', async () => {
    await creerClient({ suffixe: 'statique', ageHeures: 500, statique: true });

    await purgeOrphanClients();

    // Un administrateur l'a créé en prévision d'un usage : son absence d'usage
    // ne prouve rien.
    expect(
      await prisma.oAuthClient.findUnique({ where: { clientId: `${PREFIX}statique` } }),
    ).not.toBeNull();
  });

  it('renvoie le nombre exact d’inscriptions retirées', async () => {
    await creerClient({ suffixe: 'a', ageHeures: 48 });
    await creerClient({ suffixe: 'b', ageHeures: 48 });
    await creerClient({ suffixe: 'c', ageHeures: 1 });

    const avant = await prisma.oAuthClient.count({
      where: { clientId: { startsWith: PREFIX } },
    });
    const retirees = await purgeOrphanClients();
    const apres = await prisma.oAuthClient.count({
      where: { clientId: { startsWith: PREFIX } },
    });

    expect(avant - apres).toBe(2);
    // La purge peut retirer d'autres inscriptions du même environnement : on
    // vérifie qu'elle en compte au moins les nôtres, pas qu'elle en compte deux.
    expect(retirees).toBeGreaterThanOrEqual(2);
  });
});
