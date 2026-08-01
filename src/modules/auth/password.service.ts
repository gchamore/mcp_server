import { badRequest, invalidCredentials, notFound } from '../../core/errors.js';
import { generateToken, hashToken } from '../../core/crypto.js';
import { env } from '../../core/env.js';
import { prisma } from '../../core/prisma.js';
import { renderPasswordResetEmail, sendMail } from '../../services/mail.js';
import { hashPassword, verifyPassword } from './auth.service.js';
import { revokeAllSessions } from './session.service.js';

const RESET_TTL_MS = env.ttl.passwordResetMinutes * 60_000;

/**
 * Demande de réinitialisation.
 *
 * Ne renvoie jamais d'information sur l'existence du compte : l'appelant reçoit
 * toujours la même réponse, qu'un e-mail parte ou non.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, email: true, isActive: true, passwordHash: true, provider: true },
  });

  // Compte inexistant, désactivé, ou connecté uniquement via Google : rien à faire.
  if (!user || !user.isActive || (!user.passwordHash && user.provider === 'GOOGLE')) return;

  // Une seule demande active à la fois.
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });

  const token = generateToken('rst');
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });

  const resetUrl = `${env.baseUrl}/reinitialiser-mot-de-passe?token=${encodeURIComponent(token)}`;
  const { text, html } = renderPasswordResetEmail(resetUrl, env.ttl.passwordResetMinutes);

  await sendMail({
    to: user.email,
    subject: 'Réinitialisation de votre mot de passe MCP Wesype',
    text,
    html,
  });
}

export async function verifyResetToken(token: string): Promise<boolean> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { expiresAt: true, usedAt: true },
  });

  return Boolean(record && !record.usedAt && record.expiresAt.getTime() > Date.now());
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
    throw badRequest('Ce lien de réinitialisation est invalide ou expiré.');
  }

  /**
   * Le hachage est calculé avant de consommer le jeton.
   *
   * bcrypt à 12 tours prend environ 250 ms. Le placer entre la consommation et
   * l'écriture ouvrirait une fenêtre où le jeton est déjà marqué utilisé alors
   * que le mot de passe ne l'est pas encore : une erreur à cet instant
   * laisserait l'utilisateur sans lien valide et sans nouveau mot de passe.
   */
  const passwordHash = await hashPassword(newPassword);

  /**
   * Consommation atomique, comme pour le code d'autorisation OAuth.
   *
   * La vérification ci-dessus lit `usedAt`, mais deux requêtes portant le même
   * lien la franchissent ensemble. En plaçant `usedAt: null` dans la clause de
   * filtrage, c'est la base qui départage : une seule des deux obtient le
   * droit de poursuivre.
   */
  const consumed = await prisma.passwordResetToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  if (consumed.count === 0) {
    throw badRequest('Ce lien de réinitialisation est invalide ou expiré.');
  }

  await prisma.user.update({ where: { id: record.userId }, data: { passwordHash } });

  // Un mot de passe réinitialisé doit invalider les sessions existantes :
  // sinon un attaquant déjà connecté conserve son accès.
  await revokeAllSessions(record.userId);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user) throw notFound('Utilisateur introuvable.');
  if (!user.passwordHash) {
    throw badRequest(
      "Ce compte n'a pas de mot de passe. Utilisez « mot de passe oublié » pour en définir un.",
    );
  }

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw invalidCredentials('Mot de passe actuel incorrect.');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
}
