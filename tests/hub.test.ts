import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { loadConnectors } from '../src/connectors/registry.js';
import { prisma } from '../src/core/prisma.js';
import { encryptJson } from '../src/core/crypto.js';

/**
 * Le hub : une URL, plusieurs services cochés.
 *
 * Ce que ces tests doivent prouver, dans l'ordre d'importance :
 *
 *  1. l'isolation ne se relâche pas — cocher la connexion d'un autre
 *     utilisateur est refusé ;
 *  2. la sélection d'outils faite au consentement est réellement appliquée —
 *     un outil décoché n'existe pas pour ce jeton ;
 *  3. un appel d'outil est attribué à la bonne connexion — les statistiques
 *     par service restent justes à travers l'agrégation ;
 *  4. le rafraîchissement du jeton conserve l'ensemble.
 */

const app = createApp();

const EMAIL = 'hub@test.local';
const INTRUS = 'hub-intrus@test.local';
const PASSWORD = 'MotDePasseDeTest!2026';
const REDIRECT = 'https://client.example/callback';

const agent = request.agent(app);

let clientId: string;
let userId: string;
let axonautId: string;
let brevoId: string;
let intrusConnexionId: string;

async function obtenirDemande(): Promise<{ demande: string; codeVerifier: string }> {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const authorize = await request(app)
    .get('/authorize')
    .query({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: REDIRECT,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      resource: 'http://localhost/mcp/hub',
    })
    .expect(302);

  const demande = new URL(
    authorize.headers.location as string,
    'http://localhost',
  ).searchParams.get('demande') as string;

  return { demande, codeVerifier };
}

async function obtenirJetons(
  selections: { connectionId: string; tools?: string[] }[],
): Promise<{ access: string; refresh: string }> {
  const { demande, codeVerifier } = await obtenirDemande();

  const approval = await agent
    .post('/api/oauth/authorization/approve')
    .send({ demande, selections })
    .expect(200);

  const code = new URL(approval.body.redirectTo).searchParams.get('code') as string;

  const tokens = await request(app).post('/token').type('form').send({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_verifier: codeVerifier,
  });
  expect(tokens.status).toBe(200);

  return { access: tokens.body.access_token, refresh: tokens.body.refresh_token };
}

function listerOutils(access: string) {
  return request(app)
    .post('/mcp/hub')
    .set('Authorization', `Bearer ${access}`)
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
}

beforeAll(async () => {
  await loadConnectors();
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, INTRUS] } } });
  await prisma.oAuthClient.deleteMany({ where: { name: 'Client hub' } });

  const registration = await agent
    .post('/api/auth/register')
    .send({ email: EMAIL, password: PASSWORD })
    .expect(201);
  userId = registration.body.user.id;

  const axonaut = await prisma.connection.create({
    data: {
      userId,
      connectorId: 'axonaut',
      label: 'Axonaut',
      credentials: encryptJson({ apiKey: 'cle-axonaut' }),
      status: 'ACTIVE',
    },
  });
  axonautId = axonaut.id;

  const brevo = await prisma.connection.create({
    data: {
      userId,
      connectorId: 'brevo',
      label: 'Brevo',
      credentials: encryptJson({ apiKey: 'cle-brevo' }),
      status: 'ACTIVE',
    },
  });
  brevoId = brevo.id;

  const intrus = await prisma.user.create({ data: { email: INTRUS, passwordHash: 'x' } });
  const connexionIntrus = await prisma.connection.create({
    data: {
      userId: intrus.id,
      connectorId: 'brevo',
      label: 'Brevo intrus',
      credentials: encryptJson({ apiKey: 'cle-intrus' }),
      status: 'ACTIVE',
    },
  });
  intrusConnexionId = connexionIntrus.id;

  const inscription = await request(app)
    .post('/register')
    .send({
      client_name: 'Client hub',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
    })
    .expect(201);
  clientId = inscription.body.client_id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, INTRUS] } } });
  await prisma.oAuthClient.deleteMany({ where: { name: 'Client hub' } });
});

describe('consentement du hub', () => {
  it('présente toutes les connexions actives de l’utilisateur, avec leurs outils', async () => {
    const { demande } = await obtenirDemande();
    const vue = await agent.get('/api/oauth/authorization').query({ demande }).expect(200);

    expect(vue.body.hub).toBe(true);
    const ids = vue.body.connections.map((c: { id: string }) => c.id);
    expect(ids).toContain(axonautId);
    expect(ids).toContain(brevoId);
    // Jamais celles d'un autre utilisateur.
    expect(ids).not.toContain(intrusConnexionId);

    const brevo = vue.body.connections.find((c: { id: string }) => c.id === brevoId);
    expect(brevo.connectorName).toBe('Brevo');
    expect(brevo.tools.length).toBeGreaterThan(0);
    expect(brevo.tools[0]).toHaveProperty('readOnly');
  });

  it('refuse la connexion d’un autre utilisateur, même noyée dans une sélection valide', async () => {
    const { demande } = await obtenirDemande();
    await agent
      .post('/api/oauth/authorization/approve')
      .send({
        demande,
        selections: [{ connectionId: axonautId }, { connectionId: intrusConnexionId }],
      })
      .expect(400);
  });

  it('refuse une sélection vide', async () => {
    const { demande } = await obtenirDemande();
    await agent
      .post('/api/oauth/authorization/approve')
      .send({ demande, selections: [] })
      .expect(400);
  });

  it('refuse un outil inconnu pour le service', async () => {
    const { demande } = await obtenirDemande();
    await agent
      .post('/api/oauth/authorization/approve')
      .send({
        demande,
        selections: [{ connectionId: brevoId, tools: ['outil_qui_nexiste_pas'] }],
      })
      .expect(400);
  });
});

describe('service du hub', () => {
  it('expose l’union des outils, préfixés, et applique la sélection', async () => {
    const { access } = await obtenirJetons([
      { connectionId: axonautId },
      { connectionId: brevoId, tools: ['get_account'] },
    ]);

    const liste = await listerOutils(access).expect(200);
    const noms: string[] = liste.body.result.tools.map((t: { name: string }) => t.name);

    // Axonaut au complet, préfixé.
    expect(noms.some((n) => n.startsWith('axonaut_'))).toBe(true);
    // Brevo réduit à l'outil coché : la sélection est réellement appliquée.
    const brevoTools = noms.filter((n) => n.startsWith('brevo_'));
    expect(brevoTools).toEqual(['brevo_get_account']);
  });

  it('attribue chaque appel à la bonne connexion', async () => {
    const { access } = await obtenirJetons([
      { connectionId: axonautId },
      { connectionId: brevoId },
    ]);

    // La clé est factice : l'appel échoue proprement côté service distant —
    // mais l'invocation est journalisée, et c'est elle qui prouve le routage.
    const appel = await request(app)
      .post('/mcp/hub')
      .set('Authorization', `Bearer ${access}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'brevo_get_account', arguments: {} },
      })
      .expect(200);
    expect(appel.body.result.isError).toBe(true);

    const invocation = await prisma.toolInvocation.findFirst({
      where: { connectionId: brevoId, toolName: 'get_account' },
      orderBy: { createdAt: 'desc' },
    });
    expect(invocation).not.toBeNull();
    expect(invocation?.connectorId).toBe('brevo');
  });

  it('conserve l’ensemble à travers le rafraîchissement du jeton', async () => {
    const { refresh } = await obtenirJetons([
      { connectionId: axonautId },
      { connectionId: brevoId, tools: ['get_account'] },
    ]);

    const rafraichi = await request(app)
      .post('/token')
      .type('form')
      .send({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId })
      .expect(200);

    const liste = await listerOutils(rafraichi.body.access_token).expect(200);
    const noms: string[] = liste.body.result.tools.map((t: { name: string }) => t.name);
    expect(noms.some((n) => n.startsWith('axonaut_'))).toBe(true);
    expect(noms.filter((n) => n.startsWith('brevo_'))).toEqual(['brevo_get_account']);
  });

  it('refuse le jeton d’URL sur le hub — l’ensemble est porté par l’OAuth', async () => {
    const reponse = await request(app)
      .post('/mcp/hub/mcp_nimporte_quoi')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(404);
    expect(reponse.body.error.message).toMatch(/OAuth/);
  });

  it('publie ses métadonnées de ressource protégée', async () => {
    const meta = await request(app).get('/.well-known/oauth-protected-resource/mcp/hub').expect(200);
    expect(meta.body.resource).toMatch(/\/mcp\/hub$/);
    expect(meta.body.resource_name).toBe('Hub Toolink');
  });
});
