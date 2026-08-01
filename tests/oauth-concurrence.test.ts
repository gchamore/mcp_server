import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { loadConnectors } from '../src/connectors/registry.js';
import { prisma } from '../src/core/prisma.js';
import { encryptJson } from '../src/core/crypto.js';

/**
 * Concurrence et rejeu sur le serveur d'autorisation.
 *
 * Deux défauts corrigés ensemble, parce qu'ils partagent la même cause : une
 * décision de sécurité prise en lisant l'état, puis appliquée en l'écrivant.
 * Entre les deux, une seconde requête voit le même état de départ.
 *
 *  1. Le code d'autorisation est à usage unique. Il était marqué consommé
 *     *après* la vérification : deux échanges simultanés du même code
 *     produisaient deux jeux de jetons.
 *  2. Un jeton de rafraîchissement rejoué après rotation était refusé, mais la
 *     famille restait active. La spécification demande de tout révoquer : un
 *     jeton tourné qui resurgit signale une copie, et rien ne permet de savoir
 *     laquelle des deux parties est légitime.
 */

const app = createApp();

const EMAIL = 'concurrence@test.local';
const PASSWORD = 'MotDePasseDeTest!2026';
const REDIRECT = 'https://client.example/callback';

let clientId: string;
let userId: string;
let connectionId: string;
/** Clé primaire interne du client, nécessaire pour fabriquer des grants à la main. */
let oauthClientRowId: string;

const agent = request.agent(app);

/** Mène un parcours complet jusqu'au code d'autorisation. */
async function obtenirCode(): Promise<{ code: string; codeVerifier: string }> {
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
      resource: 'http://localhost/mcp/axonaut',
    })
    .expect(302);

  const demande = new URL(
    authorize.headers.location as string,
    'http://localhost',
  ).searchParams.get('demande') as string;

  const approval = await agent
    .post('/api/oauth/authorization/approve')
    .send({ demande, connectionId })
    .expect(200);

  const code = new URL(approval.body.redirectTo).searchParams.get('code') as string;
  return { code, codeVerifier };
}

function echangerCode(code: string, codeVerifier: string) {
  return request(app).post('/token').type('form').send({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_verifier: codeVerifier,
  });
}

beforeAll(async () => {
  await loadConnectors();
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.oAuthClient.deleteMany({ where: { name: 'Client de concurrence' } });

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
  connectionId = connection.id;

  const inscription = await request(app)
    .post('/register')
    .send({
      client_name: 'Client de concurrence',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
    })
    .expect(201);
  clientId = inscription.body.client_id;

  const row = await prisma.oAuthClient.findUniqueOrThrow({ where: { clientId } });
  oauthClientRowId = row.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.oAuthClient.deleteMany({ where: { name: 'Client de concurrence' } });
});

describe('consommation atomique du code', () => {
  /**
   * Ce test porte sur le mécanisme, pas sur le parcours HTTP.
   *
   * Huit échanges HTTP lancés ensemble ne reproduisent pas la fenêtre de façon
   * fiable — mesuré, l'ancien code y survivait. Le passer sous silence aurait
   * donné un test rassurant et vide.
   *
   * La garantie ne vient pas du minutage applicatif mais de la base : c'est
   * donc là qu'elle se vérifie. Les deux motifs sont mis en concurrence côte à
   * côte, et l'écart est net et reproductible.
   */
  it('départage une seule requête, là où « lire puis écrire » les laisse toutes passer', async () => {
    const CONCURRENTS = 12;

    const creerGrant = () =>
      prisma.oAuthGrant.create({
        data: {
          codeHash: `course-${randomBytes(16).toString('hex')}`,
          oauthClientId: oauthClientRowId,
          userId,
          connectorId: 'axonaut',
          redirectUri: REDIRECT,
          codeChallenge: 'peu-importe',
          scopes: ['mcp'],
          expiresAt: new Date(Date.now() + 600_000),
        },
      });

    // Motif d'avant : la décision est prise sur une lecture, appliquée ensuite.
    const avant = await creerGrant();
    const gagnantsAvant = (
      await Promise.all(
        Array.from({ length: CONCURRENTS }, async () => {
          const row = await prisma.oAuthGrant.findUnique({ where: { id: avant.id } });
          if (row?.usedAt) return false;
          await prisma.oAuthGrant.update({ where: { id: avant.id }, data: { usedAt: new Date() } });
          return true;
        }),
      )
    ).filter(Boolean).length;

    // Motif d'aujourd'hui : la condition fait partie de l'écriture.
    const apres = await creerGrant();
    const gagnantsApres = (
      await Promise.all(
        Array.from({ length: CONCURRENTS }, async () => {
          const { count } = await prisma.oAuthGrant.updateMany({
            where: { id: apres.id, usedAt: null },
            data: { usedAt: new Date() },
          });
          return count === 1;
        }),
      )
    ).filter(Boolean).length;

    expect(gagnantsAvant).toBeGreaterThan(1); // la course existe bel et bien
    expect(gagnantsApres).toBe(1); // et l'écriture atomique la referme
  });

  it('refuse le second échange d’un code, en séquentiel', async () => {
    const { code, codeVerifier } = await obtenirCode();

    await echangerCode(code, codeVerifier).expect(200);
    await echangerCode(code, codeVerifier).expect(400);
  });

  it('révoque la famille entière quand un code déjà consommé est rejoué', async () => {
    const { code, codeVerifier } = await obtenirCode();

    const premier = await echangerCode(code, codeVerifier).expect(200);
    const accessToken = premier.body.access_token as string;

    // Le jeton fonctionne.
    await request(app)
      .post('/mcp/axonaut')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(200);

    await echangerCode(code, codeVerifier).expect(400);

    // Le rejeu coupe l'accès émis précédemment : si le code a fuité, on ne sait
    // pas qui détient quoi, donc on invalide tout.
    await request(app)
      .post('/mcp/axonaut')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      .expect(401);
  });
});

describe('rotation des jetons de rafraîchissement', () => {
  it('révoque la famille quand un jeton déjà tourné est rejoué', async () => {
    const { code, codeVerifier } = await obtenirCode();
    const premier = await echangerCode(code, codeVerifier).expect(200);

    const refreshInitial = premier.body.refresh_token as string;

    const rafraichi = await request(app)
      .post('/token')
      .type('form')
      .send({ grant_type: 'refresh_token', refresh_token: refreshInitial, client_id: clientId })
      .expect(200);

    const accesCourant = rafraichi.body.access_token as string;

    // Le jeton courant fonctionne.
    await request(app)
      .post('/mcp/axonaut')
      .set('Authorization', `Bearer ${accesCourant}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(200);

    // Rejeu de l'ancien jeton de rafraîchissement : signature d'une copie.
    await request(app)
      .post('/token')
      .type('form')
      .send({ grant_type: 'refresh_token', refresh_token: refreshInitial, client_id: clientId })
      .expect(400);

    /**
     * L'accès légitime tombe aussi, et c'est voulu : on ne sait pas si c'est la
     * victime ou le voleur qui a tourné le jeton en premier. Dans le doute, on
     * coupe et l'utilisateur réautorise. Se contenter de refuser la requête
     * laissait la session du voleur intacte une fois sur deux.
     */
    await request(app)
      .post('/mcp/axonaut')
      .set('Authorization', `Bearer ${accesCourant}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      .expect(401);
  });
});
