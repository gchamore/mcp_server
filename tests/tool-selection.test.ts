import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { loadConnectors } from '../src/connectors/registry.js';
import { prisma } from '../src/core/prisma.js';
import { encryptJson } from '../src/core/crypto.js';

/**
 * Sélection d'outils sur un connecteur SEUL (hors hub).
 *
 * Le hub offrait le cochage fin ; le consentement mono-connecteur donnait tout
 * ou rien. Même granularité désormais — et même exigence : un outil décoché
 * n'existe pas pour le jeton, il n'est pas simplement masqué.
 */

const app = createApp();
const EMAIL = 'selection@test.local';
const PASSWORD = 'MotDePasseDeTest!2026';
const REDIRECT = 'https://client.example/callback';

const agent = request.agent(app);
let clientId: string;
let connectionId: string;

async function autoriser(tools?: string[]): Promise<string> {
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
      resource: 'http://localhost/mcp/brevo',
    })
    .expect(302);

  const demande = new URL(
    authorize.headers.location as string,
    'http://localhost',
  ).searchParams.get('demande') as string;

  const approval = await agent
    .post('/api/oauth/authorization/approve')
    .send({ demande, connectionId, ...(tools ? { tools } : {}) })
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
  return tokens.body.access_token as string;
}

function lister(access: string) {
  return request(app)
    .post('/mcp/brevo')
    .set('Authorization', `Bearer ${access}`)
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
}

beforeAll(async () => {
  await loadConnectors();
  await prisma.user.deleteMany({ where: { email: EMAIL } });

  const registration = await agent
    .post('/api/auth/register')
    .send({ email: EMAIL, password: PASSWORD })
    .expect(201);

  const connection = await prisma.connection.create({
    data: {
      userId: registration.body.user.id,
      connectorId: 'brevo',
      label: 'Brevo',
      credentials: encryptJson({ apiKey: 'cle-de-test' }),
      status: 'ACTIVE',
    },
  });
  connectionId = connection.id;

  const inscription = await request(app)
    .post('/register')
    .send({
      client_name: 'Client sélection',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
    })
    .expect(201);
  clientId = inscription.body.client_id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.oAuthClient.deleteMany({ where: { name: 'Client sélection' } });
});

describe('sélection mono-connecteur', () => {
  it('sans sélection : tous les outils, noms non préfixés', async () => {
    const access = await autoriser();
    const liste = await lister(access).expect(200);
    const noms = liste.body.result.tools.map((t: { name: string }) => t.name);

    expect(noms).toContain('get_account');
    expect(noms.length).toBeGreaterThan(1);
    // Hors hub, pas de préfixe : le nom est celui déclaré par le connecteur.
    expect(noms.every((n: string) => !n.startsWith('brevo_'))).toBe(true);
  });

  it('avec sélection : seul l’outil coché existe pour ce jeton', async () => {
    const access = await autoriser(['get_account']);
    const liste = await lister(access).expect(200);
    const noms = liste.body.result.tools.map((t: { name: string }) => t.name);

    expect(noms).toEqual(['get_account']);
  });

  it('refuse un outil inconnu', async () => {
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
        resource: 'http://localhost/mcp/brevo',
      })
      .expect(302);
    const demande = new URL(
      authorize.headers.location as string,
      'http://localhost',
    ).searchParams.get('demande') as string;

    await agent
      .post('/api/oauth/authorization/approve')
      .send({ demande, connectionId, tools: ['outil_fantome'] })
      .expect(400);
  });
});
