import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConnectors } from '../src/connectors/registry.js';
import { prisma } from '../src/core/prisma.js';
import { createEndpoint } from '../src/modules/endpoints/endpoint.service.js';
import { encryptJson } from '../src/core/crypto.js';

/**
 * Jeton de point d'accès présenté en en-tête `Authorization`.
 *
 * Dust offre trois modes pour un serveur MCP distant : « Automatic » (OAuth
 * avec enregistrement dynamique), « Static OAuth », et « Bearer Token ». Ce
 * dernier est le seul praticable pour un connecteur à clé API : il n'y a rien à
 * négocier, la personne colle simplement un jeton.
 *
 * Sans cette prise en charge, seuls les jetons placés dans le chemin d'URL
 * fonctionnaient — une forme que Dust ne sait pas produire.
 */

const app = createApp();

const EMAIL = 'bearer-endpoint@test.local';
const PASSWORD = 'MotDePasseDeTest!2026';

let token: string;
let userId: string;

beforeAll(async () => {
  await loadConnectors();
  await prisma.user.deleteMany({ where: { email: EMAIL } });

  const agent = request.agent(app);
  const registration = await agent
    .post('/api/auth/register')
    .send({ email: EMAIL, password: PASSWORD })
    .expect(201);
  userId = registration.body.user.id;

  const connection = await prisma.connection.create({
    data: {
      userId,
      connectorId: 'axonaut',
      label: 'Compte de test',
      credentials: encryptJson({ apiKey: 'cle-de-test' }),
      status: 'ACTIVE',
    },
  });

  ({ token } = await createEndpoint(connection.id, 'axonaut', 'Jeton pour Dust'));
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
});

describe('jeton de point d’accès en en-tête Bearer', () => {
  it('donne accès aux outils, comme le jeton placé dans l’URL', async () => {
    const response = await request(app)
      .post('/mcp/axonaut')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(200);

    expect(response.body.result.tools.length).toBeGreaterThan(0);
  });

  it('donne exactement le même résultat que le jeton dans l’URL', async () => {
    const parUrl = await request(app)
      .post(`/mcp/axonaut/${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(200);

    const parEntete = await request(app)
      .post('/mcp/axonaut')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(200);

    expect(parEntete.body.result).toEqual(parUrl.body.result);
  });

  it('refuse ce jeton sur un autre connecteur', async () => {
    const response = await request(app)
      .post('/mcp/brevo')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('refuse un jeton de point d’accès inventé', async () => {
    const response = await request(app)
      .post('/mcp/axonaut')
      .set('Authorization', 'Bearer mcp_jeton_totalement_invalide')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(401);

    expect(response.body.error.code).toBe(-32001);
  });

  it('laisse le chemin OAuth intact pour un jeton sans notre préfixe', async () => {
    /**
     * Un jeton qui ne commence pas par `mcp_` doit continuer à être traité par
     * le middleware OAuth — et donc produire un `WWW-Authenticate` porteur de
     * l'URL de métadonnées, c'est cet en-tête qui déclenche la découverte
     * automatique côté client.
     */
    const response = await request(app)
      .post('/mcp/axonaut')
      .set('Authorization', 'Bearer un-jeton-oauth-inconnu')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toContain('resource_metadata');
  });

  it('renvoie toujours la découverte quand aucun jeton n’est présenté', async () => {
    const response = await request(app)
      .post('/mcp/axonaut')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(401);

    expect(response.headers['www-authenticate']).toContain('resource_metadata');
  });
});
