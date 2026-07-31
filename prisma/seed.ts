import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Jeu de données de développement.
 *
 * Crée un compte administrateur et un compte utilisateur standard. Aucun
 * identifiant de service tiers n'est créé : il faut de vraies clés API pour que
 * les connecteurs répondent, et une clé factice ferait basculer la connexion en
 * statut ERROR — ce qui prêterait à confusion.
 *
 * Usage : npm run db:seed
 */

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@wesype.test';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'motdepasse-admin-2026';
const USER_EMAIL = process.env.SEED_USER_EMAIL ?? 'utilisateur@wesype.test';
const USER_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'motdepasse-utilisateur';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Le seed ne doit pas être exécuté en production.');
  }

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: 'ADMIN' },
    create: {
      email: ADMIN_EMAIL,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
      firstName: 'Admin',
      lastName: 'Wesype',
      role: 'ADMIN',
      provider: 'LOCAL',
    },
  });

  const user = await prisma.user.upsert({
    where: { email: USER_EMAIL },
    update: {},
    create: {
      email: USER_EMAIL,
      passwordHash: await bcrypt.hash(USER_PASSWORD, 12),
      firstName: 'Camille',
      lastName: 'Dupont',
      role: 'USER',
      provider: 'LOCAL',
    },
  });

  console.log('Comptes de développement créés :');
  console.log(`  • ${admin.email} / ${ADMIN_PASSWORD}  (ADMIN)`);
  console.log(`  • ${user.email} / ${USER_PASSWORD}  (USER)`);
  console.log('\nConnectez ensuite un service depuis le catalogue avec une vraie clé API.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
