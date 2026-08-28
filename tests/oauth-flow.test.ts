import { createHash, randomBytes } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConnectors } from '../src/connectors/registry.js';
import { checkDatabase, prisma } from '../src/core/prisma.js';

/**
 * Flux OAuth de bout en bout, tel qu'un client IA le déroule.
 *
 * Cette suite a besoin d'une vraie base. Elle se saute d'elle-même si
 * `DATABASE_URL` ne répond pas, pour ne pas bloquer un `npm test` local sans
 * PostgreSQL :
 *
 *   docker run -d --name wesype-test-db -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_USER=test -e POSTGRES_DB=wesype_test -p 55432:5432 postgres:16-alpine
 *   DATABASE_URL=postgresql://test:test@localhost:55432/wesype_test npx prisma migrate deploy
 *   DATABASE_URL=postgresql://test:test@localhost:55432/wesype_test npm test
 */

const databaseUp = await checkDatabase().catch(() => false);
const suite = databaseUp ? describe : describe.skip;

await loadConnectors();
const app: Express = createApp();

const EMAIL = `oauth-${randomBytes(4).toString('hex')}@wesype.test`;
const PASSWORD = 'motdepasse-de-test-2026';

/** Agent partagé : conserve le cookie de session entre les requêtes. */
const agent = request.agent(app);

suite('flux OAuth complet', () => {
  let clientId: string;
  let userId: string;

  beforeAll(async () => {
    const registration = await agent
      .post('/api/auth/register')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(201);
    userId = registration.body.user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.oAuthClient.deleteMany({ where: { name: 'Client de test' } });
  });

  it('1. le client s’enregistre tout seul (RFC 7591)', async () => {
    const response = await request(app)
      .post('/register')
      .send({
        client_name: 'Client de test',
        redirect_uris: ['https://client.example/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
      })
      .expect(201);

    clientId = response.body.client_id;
    expect(clientId).toMatch(/^wsp-client_/);
    // Client public : PKCE tient lieu d'authentification, aucun secret émis.
    expect(response.body.client_secret).toBeUndefined();
  });

  it('2. /authorize redirige vers notre écran de consentement', async () => {
    const response = await request(app)
      .get('/authorize')
      .query({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: 'https://client.example/callback',
        code_challenge: 'peu-importe-ici',
        code_challenge_method: 'S256',
        resource: 'http://localhost:3000/mcp/axonaut',
        state: 'etat-123',
      })
      .expect(302);

    const location = new URL(response.headers.location as string);
    expect(location.pathname).toBe('/autoriser');
    expect(location.searchParams.get('demande')).toBeTruthy();
  });

  it('2 bis. une ressource inconnue est refusée proprement', async () => {
    const response = await request(app)
      .get('/authorize')
      .query({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: 'https://client.example/callback',
        code_challenge: 'x',
        code_challenge_method: 'S256',
        resource: 'http://localhost:3000/mcp/service-inexistant',
      })
      .expect(302);

    // L'erreur repart vers le client, au format OAuth.
    const location = new URL(response.headers.location as string);
    expect(location.origin + location.pathname).toBe('https://client.example/callback');
    expect(location.searchParams.get('error')).toBe('invalid_request');
  });

  it('3 à 6. consentement, échange du code, appel MCP authentifié', async () => {
    // --- Le client prépare son PKCE -------------------------------------
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const authorize = await request(app)
      .get('/authorize')
      .query({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: 'https://client.example/callback',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        resource: 'http://localhost:3000/mcp/axonaut',
        state: 'etat-xyz',
      })
      .expect(302);

    const demande = new URL(authorize.headers.location as string).searchParams.get(
      'demande',
    ) as string;

    // --- L'utilisateur arrive sur l'écran de consentement ----------------
    const view = await agent.get('/api/oauth/authorization').query({ demande }).expect(200);

    expect(view.body.client.name).toBe('Client de test');
    expect(view.body.connector.id).toBe('axonaut');
    // Aucun compte encore raccordé : l'écran doit orienter vers le fournisseur.
    expect(view.body.connections).toHaveLength(0);
    // Plus aucune notion de mode n'est exposée : la plateforme IA la gère.
    expect(view.body).not.toHaveProperty('establishedMode');

    // --- Il raccorde son compte Axonaut ---------------------------------
    const connection = await agent
      .post('/api/connections')
      .send({
        connectorId: 'axonaut',
        label: 'Compte de test',
        credentials: { apiKey: 'cle-api-de-test-suffisante' },
      })
      .expect(201);
    const connectionId = connection.body.connection.id;

    // --- Il approuve, en mode individuel --------------------------------
    const approval = await agent
      .post('/api/oauth/authorization/approve')
      .send({ demande, connectionId })
      .expect(200);

    const redirect = new URL(approval.body.redirectTo);
    expect(redirect.origin + redirect.pathname).toBe('https://client.example/callback');
    expect(redirect.searchParams.get('state')).toBe('etat-xyz');
    const code = redirect.searchParams.get('code') as string;
    expect(code).toMatch(/^wsp-code_/);

    // --- Le client échange le code contre des jetons --------------------
    const tokens = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: 'https://client.example/callback',
        code_verifier: codeVerifier,
        resource: 'http://localhost:3000/mcp/axonaut',
      })
      .expect(200);

    expect(tokens.body.token_type).toBe('Bearer');
    expect(tokens.body.access_token).toMatch(/^wsp-at_/);
    expect(tokens.body.refresh_token).toMatch(/^wsp-rt_/);
    const accessToken = tokens.body.access_token as string;

    // --- Et appelle enfin le serveur MCP --------------------------------
    const mcp = await request(app)
      .post('/mcp/axonaut')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(200);

    expect(mcp.body.result.tools.length).toBeGreaterThan(0);

    // --- Le même jeton ne vaut pas pour un autre connecteur -------------
    await request(app)
      .post('/mcp/brevo')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      .expect(401);

    // --- Le code d'autorisation ne peut pas être rejoué -----------------
    await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: 'https://client.example/callback',
        code_verifier: codeVerifier,
      })
      .expect(400);

    // Le rejeu révoque toute la famille de jetons : l'accès est coupé.
    await request(app)
      .post('/mcp/axonaut')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
      .expect(401);

    // --- La trace de l'autorisation existe ------------------------------
    // Elle ne décide plus rien : c'est le jeton qui porte la connexion. Elle
    // sert à l'administration, pour savoir quel client atteint quel connecteur
    // et qui l'a mis en place.
    const access = await prisma.mcpAccess.findFirst({
      where: { connectorId: 'axonaut', ownerId: userId },
    });
    expect(access).not.toBeNull();
  });

  it('rejette un code_verifier qui ne correspond pas (PKCE)', async () => {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const authorize = await request(app)
      .get('/authorize')
      .query({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: 'https://client.example/callback',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        resource: 'http://localhost:3000/mcp/axonaut',
      })
      .expect(302);

    const demande = new URL(authorize.headers.location as string).searchParams.get(
      'demande',
    ) as string;

    const connection = await prisma.connection.findFirst({
      where: { userId, connectorId: 'axonaut' },
    });

    const approval = await agent
      .post('/api/oauth/authorization/approve')
      .send({ demande, connectionId: connection?.id })
      .expect(200);

    const code = new URL(approval.body.redirectTo).searchParams.get('code') as string;

    await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: 'https://client.example/callback',
        code_verifier: randomBytes(32).toString('base64url'),
      })
      .expect(400);
  });

  /**
   * Tous les clients ne transmettent pas encore l'indicateur de ressource
   * (RFC 8707), pourtant exigé par la spécification MCP. Le parcours ne doit
   * pas casser : l'utilisateur désigne lui-même le service.
   */
  it('fonctionne sans indicateur de ressource, via choix du connecteur', async () => {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const authorize = await request(app)
      .get('/authorize')
      .query({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: 'https://client.example/callback',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        // volontairement : pas de `resource`
      })
      .expect(302);

    const location = new URL(authorize.headers.location as string);
    // Aucune erreur renvoyée au client : on va bien vers le consentement.
    expect(location.pathname).toBe('/autoriser');
    const demande = location.searchParams.get('demande') as string;

    // L'écran propose la liste des connecteurs.
    const view = await agent.get('/api/oauth/authorization').query({ demande }).expect(200);
    expect(view.body.connector).toBeNull();
    expect(view.body.selectableConnectors.length).toBeGreaterThanOrEqual(3);

    // Une fois le choix fait, la vue se comporte normalement.
    const chosen = await agent
      .get('/api/oauth/authorization')
      .query({ demande, connectorId: 'axonaut' })
      .expect(200);
    expect(chosen.body.connector.id).toBe('axonaut');

    const connection = await prisma.connection.findFirst({
      where: { userId, connectorId: 'axonaut' },
    });

    const approval = await agent
      .post('/api/oauth/authorization/approve')
      .send({ demande, connectorId: 'axonaut', connectionId: connection?.id })
      .expect(200);

    const code = new URL(approval.body.redirectTo).searchParams.get('code') as string;

    const tokens = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: 'https://client.example/callback',
        code_verifier: codeVerifier,
      })
      .expect(200);

    await request(app)
      .post('/mcp/axonaut')
      .set('Authorization', `Bearer ${tokens.body.access_token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(200);
  });

  /**
   * Mode « Static OAuth » de Dust : un administrateur crée le client à
   * l'avance, et l'outil s'authentifie avec un secret.
   */
  it('accepte un client confidentiel pré-enregistré', async () => {
    // L'utilisateur de test est administrateur si c'est le premier compte ;
    // on force le rôle pour rendre le test indépendant de l'ordre d'exécution.
    await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });

    const creation = await agent
      .post('/api/admin/mcp-clients')
      .send({
        name: 'Dust — espace de test',
        redirectUris: ['https://dust.tt/oauth/mcp_static/finalize'],
      })
      .expect(201);

    const staticClientId = creation.body.clientId as string;
    const staticSecret = creation.body.clientSecret as string;
    expect(staticSecret).toMatch(/^wsp-cs_/);

    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const authorize = await request(app)
      .get('/authorize')
      .query({
        client_id: staticClientId,
        response_type: 'code',
        redirect_uri: 'https://dust.tt/oauth/mcp_static/finalize',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        resource: 'http://localhost:3000/mcp/axonaut',
      })
      .expect(302);

    const demande = new URL(authorize.headers.location as string).searchParams.get(
      'demande',
    ) as string;

    const connection = await prisma.connection.findFirst({
      where: { userId, connectorId: 'axonaut' },
    });

    const approval = await agent
      .post('/api/oauth/authorization/approve')
      .send({ demande, connectionId: connection?.id })
      .expect(200);

    const code = new URL(approval.body.redirectTo).searchParams.get('code') as string;

    // Sans le secret, l'échange doit être rejeté. On vérifie le code d'erreur
    // OAuth plutôt que le statut HTTP : la RFC 6749 autorise 400 comme 401
    // pour `invalid_client`, et le SDK a choisi 400.
    const refused = await request(app).post('/token').type('form').send({
      grant_type: 'authorization_code',
      code,
      client_id: staticClientId,
      redirect_uri: 'https://dust.tt/oauth/mcp_static/finalize',
      code_verifier: codeVerifier,
    });

    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.body.error).toBe('invalid_client');

    // Avec le secret, il réussit.
    const tokens = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        client_id: staticClientId,
        client_secret: staticSecret,
        redirect_uri: 'https://dust.tt/oauth/mcp_static/finalize',
        code_verifier: codeVerifier,
      })
      .expect(200);

    await request(app)
      .post('/mcp/axonaut')
      .set('Authorization', `Bearer ${tokens.body.access_token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(200);

    /**
     * Le jeton porte la connexion — c'est ce qui rend les deux modes de Dust
     * corrects sans qu'on ait à les distinguer. Un jeton unique, réutilisé par
     * tout un espace de travail, donne le comportement « partagé » ; un jeton
     * par personne donne le comportement « individuel ».
     */
    const grant = await prisma.oAuthGrant.findFirst({
      where: { connectorId: 'axonaut', client: { clientId: staticClientId } },
      orderBy: { createdAt: 'desc' },
    });
    expect(grant?.connectionId).toBe(connection?.id);

    const access = await prisma.mcpAccess.findFirst({
      where: { connectorId: 'axonaut', client: { clientId: staticClientId } },
    });
    expect(access).not.toBeNull();
  });

  it('refuse un jeton statique inconnu', async () => {
    const response = await request(app)
      .post('/mcp/axonaut/mcp_jeton_totalement_invalide')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(401);

    expect(response.body.jsonrpc).toBe('2.0');
    expect(response.body.error.code).toBe(-32001);
  });

  it('exige une session Toolink pour consulter une demande de consentement', async () => {
    await request(app)
      .get('/api/oauth/authorization')
      .query({ demande: 'x'.repeat(40) })
      .expect(401);
  });
});
