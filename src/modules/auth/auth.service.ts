import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { conflict, invalidCredentials } from '../../core/errors.js';
import { prisma } from '../../core/prisma.js';

/** Coût bcrypt : ~250 ms sur une machine moderne, bon compromis en 2026. */
const SALT_ROUNDS = 12;

export type PublicUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  role: User['role'];
  provider: User['provider'];
  hasPassword: boolean;
  createdAt: Date;
};

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    provider: user.provider,
    hasPassword: Boolean(user.passwordHash),
    createdAt: user.createdAt,
  };
}

export const hashPassword = (password: string) => bcrypt.hash(password, SALT_ROUNDS);

export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

/**
 * Le tout premier compte créé devient administrateur.
 *
 * C'est ce qui remplace l'ancienne liste d'e-mails codée en dur — laquelle
 * était dupliquée côté serveur ET livrée au navigateur. Le rôle vit désormais
 * en base et se gère depuis le panneau d'administration.
 */
async function resolveInitialRole(): Promise<User['role']> {
  const existing = await prisma.user.count();
  return existing === 0 ? 'ADMIN' : 'USER';
}

export async function registerUser(input: {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}): Promise<User> {
  const email = input.email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw conflict('Un compte existe déjà avec cette adresse e-mail.');

  return prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(input.password),
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      provider: 'LOCAL',
      role: await resolveInitialRole(),
      // L'inscription ouvre une session : sans cela le compte apparaîtrait
      // comme inactif dans les statistiques dès sa création.
      lastLoginAt: new Date(),
    },
  });
}

export async function authenticate(email: string, password: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  // Le hachage est exécuté même quand l'utilisateur n'existe pas : sans cela, la
  // différence de temps de réponse permet d'énumérer les comptes existants.
  const hash =
    user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const passwordMatches = await verifyPassword(password, hash);

  if (!user || !user.passwordHash || !passwordMatches) throw invalidCredentials();
  if (!user.isActive) throw invalidCredentials('Ce compte est désactivé.');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return user;
}

export async function upsertGoogleUser(profile: {
  googleId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
}): Promise<User> {
  const email = profile.email.toLowerCase();

  const existing = await prisma.user.findFirst({
    where: { OR: [{ googleId: profile.googleId }, { email }] },
  });

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        googleId: profile.googleId,
        avatarUrl: profile.avatarUrl ?? existing.avatarUrl,
        firstName: existing.firstName ?? profile.firstName ?? null,
        lastName: existing.lastName ?? profile.lastName ?? null,
        // Un compte local qui se connecte via Google conserve son mot de passe :
        // on ne bascule `provider` que s'il n'y en avait pas.
        provider: existing.passwordHash ? existing.provider : 'GOOGLE',
        lastLoginAt: new Date(),
      },
    });
  }

  return prisma.user.create({
    data: {
      email,
      googleId: profile.googleId,
      firstName: profile.firstName ?? null,
      lastName: profile.lastName ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      provider: 'GOOGLE',
      role: await resolveInitialRole(),
      lastLoginAt: new Date(),
    },
  });
}
