import { afterEach, describe, expect, it } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';
import {
  buildKeyRing,
  decryptJson,
  encryptJson,
  isEncryptedWithPrimary,
} from '../src/core/crypto.js';
import { prisma } from '../src/core/prisma.js';
import { rotateEncryptedColumns } from '../src/jobs/rotate-encryption.js';

/**
 * Rotation de la clé de chiffrement.
 *
 * Avant le format v3, changer ENCRYPTION_KEY rendait tout le stock illisible
 * d'un coup : une clé compromise ne laissait aucun recours autre que demander
 * à chaque utilisateur de tout ressaisir. Le trousseau ferme cet angle : la
 * nouvelle clé chiffre, les anciennes continuent de lire le temps du
 * rechiffrement.
 */

const cleA = randomBytes(32).toString('hex');
const cleB = randomBytes(32).toString('hex');

describe('trousseau de clés', () => {
  it('déchiffre avec la clé primaire — l’aller-retour ordinaire', () => {
    const ring = buildKeyRing(cleA);
    expect(decryptJson(encryptJson({ apiKey: 's3cret' }, ring), ring)).toEqual({
      apiKey: 's3cret',
    });
  });

  it('lit une donnée chiffrée sous l’ancienne clé pendant la rotation', () => {
    const ancienRing = buildKeyRing(cleA);
    const chiffre = encryptJson({ apiKey: 'ancien' }, ancienRing);

    // Rotation : B devient primaire, A passe en clé précédente.
    const nouveauRing = buildKeyRing(cleB, [cleA]);
    expect(decryptJson(chiffre, nouveauRing)).toEqual({ apiKey: 'ancien' });

    // Et le critère de rechiffrement le repère comme à reprendre.
    expect(isEncryptedWithPrimary(chiffre, nouveauRing)).toBe(false);
    expect(isEncryptedWithPrimary(encryptJson({ x: 1 }, nouveauRing), nouveauRing)).toBe(true);
  });

  it('refuse une donnée dont la clé a été retirée du trousseau', () => {
    const chiffre = encryptJson({ apiKey: 'perdu' }, buildKeyRing(cleA));

    // Rotation terminée trop tôt : l'ancienne clé n'est plus là.
    expect(() => decryptJson(chiffre, buildKeyRing(cleB))).toThrowError(
      /clé absente du trousseau/,
    );
  });

  it('lit encore l’ancien format v2, y compris via une clé précédente', () => {
    /**
     * Le stock existant est en v2 — sans identifiant de clé. Reconstitution
     * fidèle du format historique pour figer la compatibilité : si ce test
     * casse, une mise en production rendrait la base illisible.
     */
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(cleA, 'hex'), iv);
    cipher.setAAD(Buffer.from('v2'));
    const data = Buffer.concat([
      cipher.update(JSON.stringify({ apiKey: 'héritée' }), 'utf8'),
      cipher.final(),
    ]);
    const v2 = [
      'v2',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      data.toString('base64url'),
    ].join('.');

    expect(decryptJson(v2, buildKeyRing(cleA))).toEqual({ apiKey: 'héritée' });
    expect(decryptJson(v2, buildKeyRing(cleB, [cleA]))).toEqual({ apiKey: 'héritée' });
    expect(isEncryptedWithPrimary(v2, buildKeyRing(cleA))).toBe(false);
  });

  it('lie l’identifiant de clé au texte chiffré : le déplacer casse l’authentification', () => {
    const ringAB = buildKeyRing(cleA, [cleB]);
    const sousA = encryptJson({ apiKey: 'x' }, ringAB).split('.');
    const idB = buildKeyRing(cleB).keys[0]?.id as string;

    // Même trousseau, mais l'étiquette prétend que c'est la clé B.
    const falsifie = [sousA[0], idB, sousA[2], sousA[3], sousA[4]].join('.');
    expect(() => decryptJson(falsifie, ringAB)).toThrowError();
  });
});

describe('rechiffrement du stock', () => {
  const EMAIL = 'rotation@test.local';

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
  });

  it('reprend les lignes héritées et laisse les lignes déjà à jour', async () => {
    const user = await prisma.user.create({ data: { email: EMAIL, passwordHash: 'x' } });

    // Une ligne au format courant, une au format hérité v2 (via le trousseau
    // du serveur : le stock v2 réel a été produit avec la même clé primaire).
    const { env } = (await import('../src/core/env.js')) as typeof import('../src/core/env.js');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(env.encryptionKey, 'hex'), iv);
    cipher.setAAD(Buffer.from('v2'));
    const data = Buffer.concat([
      cipher.update(JSON.stringify({ apiKey: 'v2-a-reprendre' }), 'utf8'),
      cipher.final(),
    ]);
    const enV2 = [
      'v2',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      data.toString('base64url'),
    ].join('.');

    const aJour = await prisma.connection.create({
      data: {
        userId: user.id,
        connectorId: 'axonaut',
        label: 'déjà à jour',
        credentials: encryptJson({ apiKey: 'ok' }),
        status: 'ACTIVE',
      },
    });
    const heritee = await prisma.connection.create({
      data: {
        userId: user.id,
        connectorId: 'axonaut',
        label: 'héritée',
        credentials: enV2,
        status: 'ACTIVE',
      },
    });

    const report = await rotateEncryptedColumns();

    expect(report.connections).toBeGreaterThanOrEqual(1);

    const apres = await prisma.connection.findUniqueOrThrow({ where: { id: heritee.id } });
    expect(isEncryptedWithPrimary(apres.credentials)).toBe(true);
    expect(decryptJson(apres.credentials)).toEqual({ apiKey: 'v2-a-reprendre' });

    // La ligne à jour n'a pas été réécrite : même texte chiffré qu'à la
    // création, à l'octet près — pas seulement même contenu déchiffré.
    const intacte = await prisma.connection.findUniqueOrThrow({ where: { id: aJour.id } });
    expect(intacte.credentials).toBe(aJour.credentials);
    expect(report.skipped).toBeGreaterThanOrEqual(1);
  });

  it('couvre toutes les colonnes chiffrées du schéma — pas une de moins', async () => {
    /**
     * Le rechiffrement énumère les colonnes à la main : si quelqu'un ajoute un
     * champ `*Encrypted` ou `credentials` au schéma sans l'ajouter au script,
     * la prochaine rotation le rendrait illisible. Ce test transforme cet
     * oubli en échec immédiat.
     */
    const fs = await import('node:fs/promises');
    const schema = await fs.readFile('prisma/schema.prisma', 'utf8');
    const colonnes = [...schema.matchAll(/^\s*(\w*(?:credentials|Encrypted)\w*)\s+String/gim)]
      .map((m) => (m[1] as string).trim())
      .sort();

    expect(colonnes).toEqual(['clientSecretEncrypted', 'credentials', 'tokenEncrypted']);
  });
});
