import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConnectors } from '../src/connectors/registry.js';
import { prisma } from '../src/core/prisma.js';

/**
 * Espace d'administration.
 *
 * Ces routes sont les plus privilégiées du serveur : elles listent tous les
 * comptes, changent les rôles, et révoquent les accès MCP. Elles étaient
 * pourtant les moins couvertes de tout le projet — 29 % —, ce qui veut dire que
 * les garde-fous qui les protègent n'étaient vérifiés par personne.
 *
 * Deux d'entre eux comptent particulièrement, parce que leur défaillance est
 * irréversible depuis l'interface : un administrateur ne doit pouvoir ni se
 * retirer ses propres droits, ni retirer les derniers droits existants. Dans
 * les deux cas, la plateforme deviendrait inadministrable.
 */

const app = createApp();

const ADMIN = 'admin-test@test.local';
const AUTRE_ADMIN = 'admin2-test@test.local';
const SIMPLE = 'simple-test@test.local';
const PASSWORD = 'MotDePasseDeTest!2026';

const emails = [ADMIN, AUTRE_ADMIN, SIMPLE];

const adminAgent = request.agent(app);
const simpleAgent = request.agent(app);

let adminId: string;
let autreAdminId: string;
let simpleId: string;

async function inscrire(agent: request.Agent, email: string): Promise<string> {
  const reponse = await agent.post('/api/auth/register').send({ email, password: PASSWORD });
  expect(reponse.status).toBe(201);
  return reponse.body.user.id;
}

beforeAll(async () => {
  await loadConnectors();
  await prisma.user.deleteMany({ where: { email: { in: emails } } });

  adminId = await inscrire(adminAgent, ADMIN);
  simpleId = await inscrire(simpleAgent, SIMPLE);
  autreAdminId = await inscrire(request.agent(app), AUTRE_ADMIN);

  // Le premier compte créé devient administrateur, mais la base de test peut
  // déjà en contenir : on force les rôles plutôt que d'en dépendre.
  await prisma.user.updateMany({
    where: { email: { in: [ADMIN, AUTRE_ADMIN] } },
    data: { role: 'ADMIN' },
  });
  await prisma.user.update({ where: { id: simpleId }, data: { role: 'USER' } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
});

describe('accès à l’administration', () => {
  it('refuse un visiteur anonyme', async () => {
    await request(app).get('/api/admin/overview').expect(401);
  });

  it('refuse un utilisateur sans le rôle', async () => {
    await simpleAgent.get('/api/admin/overview').expect(403);
  });

  it('laisse passer un administrateur', async () => {
    const reponse = await adminAgent.get('/api/admin/overview').expect(200);
    expect(reponse.body).toHaveProperty('connectors');
  });
});

describe('garde-fous sur les rôles', () => {
  it('empêche un administrateur de se retirer ses propres droits', async () => {
    const reponse = await adminAgent
      .patch(`/api/admin/users/${adminId}`)
      .send({ role: 'USER' })
      .expect(400);

    expect(reponse.body.error.message).toMatch(/vos propres droits/i);

    // Et le rôle n'a pas bougé.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: adminId } });
    expect(user.role).toBe('ADMIN');
  });

  it('empêche un administrateur de désactiver son propre compte', async () => {
    await adminAgent.patch(`/api/admin/users/${adminId}`).send({ isActive: false }).expect(400);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: adminId } });
    expect(user.isActive).toBe(true);
  });

  it('accepte de rétrograder un autre administrateur tant qu’il en reste un', async () => {
    await adminAgent.patch(`/api/admin/users/${autreAdminId}`).send({ role: 'USER' }).expect(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: autreAdminId } });
    expect(user.role).toBe('USER');

    // Remis en place pour ne pas influencer les tests suivants.
    await prisma.user.update({ where: { id: autreAdminId }, data: { role: 'ADMIN' } });
  });

  it('promeut un utilisateur simple', async () => {
    await adminAgent.patch(`/api/admin/users/${simpleId}`).send({ role: 'ADMIN' }).expect(200);
    await adminAgent.patch(`/api/admin/users/${simpleId}`).send({ role: 'USER' }).expect(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: simpleId } });
    expect(user.role).toBe('USER');
  });
});

describe('liste des comptes', () => {
  it('pagine et n’expose jamais d’empreinte de mot de passe', async () => {
    const reponse = await adminAgent.get('/api/admin/users').query({ perPage: 2 }).expect(200);

    expect(reponse.body.users.length).toBeLessThanOrEqual(2);
    expect(reponse.body).toHaveProperty('total');

    // La projection est explicite côté serveur ; ce test la fige.
    for (const user of reponse.body.users) {
      expect(user).not.toHaveProperty('passwordHash');
    }
  });
});

describe('clients MCP', () => {
  it('liste les clients et les URI de redirection de Dust', async () => {
    const reponse = await adminAgent.get('/api/admin/mcp-clients').expect(200);

    expect(Array.isArray(reponse.body.clients)).toBe(true);
    expect(reponse.body.dustRedirectUris.length).toBeGreaterThan(0);
  });

  it('crée un client statique et renvoie son secret une seule fois', async () => {
    const creation = await adminAgent
      .post('/api/admin/mcp-clients')
      .send({
        name: 'Client statique de test',
        redirectUris: ['https://dust.tt/oauth/mcp_static/finalize'],
      })
      .expect(201);

    expect(creation.body.clientSecret).toBeTruthy();

    // Le secret n'est jamais réaffiché : la liste ne doit pas le contenir.
    const liste = await adminAgent.get('/api/admin/mcp-clients').expect(200);
    expect(JSON.stringify(liste.body)).not.toContain(creation.body.clientSecret);

    await prisma.oAuthClient.deleteMany({ where: { name: 'Client statique de test' } });
  });

  it('renvoie le nombre d’inscriptions purgées', async () => {
    const reponse = await adminAgent.post('/api/admin/mcp-clients/purge').expect(200);
    expect(typeof reponse.body.removed).toBe('number');
  });
});

describe('statistiques d’usage', () => {
  it('borne la fenêtre demandée', async () => {
    await adminAgent.get('/api/admin/usage').query({ days: 7 }).expect(200);
    // Au-delà de 90 jours, le schéma refuse : la requête serait trop coûteuse.
    await adminAgent.get('/api/admin/usage').query({ days: 400 }).expect(400);
  });
});
