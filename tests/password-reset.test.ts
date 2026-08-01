import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/core/prisma.js';
import { hashToken } from '../src/core/crypto.js';
import { resetPassword } from '../src/modules/auth/password.service.js';
import { hashPassword, verifyPassword } from '../src/modules/auth/auth.service.js';
import { createSession } from '../src/modules/auth/session.service.js';
import type { Request } from 'express';

/**
 * Jeton de réinitialisation à usage unique.
 *
 * Même défaut que le code d'autorisation OAuth : `usedAt` était lu, puis écrit.
 * Entre les deux, une seconde requête portant le même lien voyait le jeton
 * encore libre.
 *
 * Le scénario qui rend cela gênant : un lien de réinitialisation fuite — boîte
 * partagée, journal de serveur mandataire, capture d'écran. Le porteur du lien
 * n'a plus qu'à lancer sa requête en même temps que la personne légitime pour
 * s'assurer que c'est son mot de passe qui subsiste.
 */

const EMAIL = 'reset-race@test.local';

let userId: string;

/** Crée un jeton de réinitialisation valide et renvoie sa forme en clair. */
async function creerJeton(): Promise<string> {
  const token = `rst_test_${Math.random().toString(36).slice(2)}`;

  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 600_000),
    },
  });

  return token;
}

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({
    data: { email: EMAIL, passwordHash: await hashPassword('AncienMotDePasse!2026') },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
});

describe('jeton de réinitialisation', () => {
  it('change bien le mot de passe et invalide les sessions ouvertes', async () => {
    const requete = { get: () => undefined, ip: '127.0.0.1', socket: {} } as unknown as Request;
    await createSession(userId, requete);
    expect(await prisma.session.count({ where: { userId } })).toBe(1);

    const token = await creerJeton();
    await resetPassword(token, 'NouveauMotDePasse!2026');

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await verifyPassword('NouveauMotDePasse!2026', user.passwordHash as string)).toBe(true);

    // Un mot de passe réinitialisé ne doit pas laisser d'accès déjà ouvert.
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
  });

  it('refuse un second usage du même lien', async () => {
    const token = await creerJeton();

    await resetPassword(token, 'PremierChoix!2026');
    await expect(resetPassword(token, 'SecondChoix!2026')).rejects.toThrowError(
      /invalide ou expiré/,
    );

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await verifyPassword('PremierChoix!2026', user.passwordHash as string)).toBe(true);
  });

  it('n’en laisse passer qu’un seul quand deux requêtes arrivent ensemble', async () => {
    const token = await creerJeton();

    /**
     * Les deux appels partent ensemble. Contrairement au parcours HTTP du
     * serveur OAuth — où la fenêtre s'était révélée trop étroite pour être
     * atteinte de façon fiable — on appelle ici directement le service, sans
     * couche réseau entre les deux : la course est reproductible.
     */
    const resultats = await Promise.allSettled([
      resetPassword(token, 'ChoixA!2026'),
      resetPassword(token, 'ChoixB!2026'),
    ]);

    const reussites = resultats.filter((r) => r.status === 'fulfilled');
    expect(reussites).toHaveLength(1);

    // Et le jeton est bien marqué consommé une seule fois.
    const record = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(token) },
    });
    expect(record.usedAt).not.toBeNull();
  });

  it('refuse un jeton expiré', async () => {
    const token = `rst_expire_${Math.random().toString(36).slice(2)}`;
    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });

    await expect(resetPassword(token, 'PeuImporte!2026')).rejects.toThrowError(
      /invalide ou expiré/,
    );
  });

  it('refuse un jeton inconnu', async () => {
    await expect(resetPassword('rst_inexistant', 'PeuImporte!2026')).rejects.toThrowError(
      /invalide ou expiré/,
    );
  });
});
