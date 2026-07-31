import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConnectors } from '../src/connectors/registry.js';
import { encryptJson } from '../src/core/crypto.js';
import { MAX_RETURN_TO } from '../src/core/limits.js';
import { prisma } from '../src/core/prisma.js';

/**
 * Longueur de `returnTo` — reproduction du parcours réel.
 *
 * Symptôme observé : en ajoutant le connecteur Gmail dans Dust, l'utilisateur
 * choisissait « personnel ou partagé », arrivait sur l'écran de consentement,
 * cliquait sur « Continuer avec Google » et recevait :
 *
 *     {"code":"VALIDATION_ERROR","details":{"returnTo":"Too big: expected
 *      string to have <=512 characters"}}
 *
 * Cause : la demande d'autorisation est chiffrée dans l'URL (≈530 caractères).
 * L'écran de consentement l'emporte dans `returnTo` pour y revenir après la
 * connexion, ce qui dépasse la borne de 512 retenue au départ — borne fixée
 * sans tenir compte de ce chaînage.
 */

const app = createApp();

/**
 * Agent authentifié.
 *
 * Indispensable pour le second chemin : `requireAuth` s'exécute avant la
 * validation, donc une requête anonyme reçoit un 401 sans jamais atteindre le
 * schéma. Un test non authentifié passait ici même avec l'ancienne borne — il
 * n'aurait rien attrapé.
 */
const EMAIL = 'return-to@test.local';
const PASSWORD = 'MotDePasseDeTest!2026';
const agent = request.agent(app);

beforeAll(async () => {
  await loadConnectors();
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await agent.post('/api/auth/register').send({ email: EMAIL, password: PASSWORD }).expect(201);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
});

/** Reconstitue une demande d'autorisation de la taille de celles de Dust. */
function demandeRealiste(): string {
  return encryptJson({
    clientId: `mcp_client_${'a'.repeat(32)}`,
    connectorId: 'gmail',
    redirectUri: 'https://dust.tt/oauth/mcp_static/finalize',
    codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    scopes: ['mcp'],
    state: 'b'.repeat(64),
    resource: 'https://www.gchamore.com/mcp/gmail',
    expiresAt: Date.now() + 600_000,
  });
}

/** Exactement ce que construit `Consent.tsx` avant d'envoyer vers la connexion. */
function returnToDepuisConsentement(): string {
  return `/autoriser?demande=${encodeURIComponent(demandeRealiste())}`;
}

describe('retour vers l’écran de consentement', () => {
  it('produit bien un returnTo qui dépassait l’ancienne borne', () => {
    const returnTo = returnToDepuisConsentement();

    // Si cette assertion tombe un jour, c'est que la charge a maigri — le test
    // ne prouverait alors plus rien.
    expect(returnTo.length).toBeGreaterThan(512);
    expect(returnTo.length).toBeLessThan(MAX_RETURN_TO);
  });

  it('accepte la connexion Google lancée depuis le consentement', async () => {
    const response = await request(app)
      .get('/api/auth/google')
      .query({ returnTo: returnToDepuisConsentement() });

    // Google peut être désactivé sur cet environnement de test ; ce qui compte
    // est qu'on ne soit plus recalé sur la longueur.
    expect(response.status).not.toBe(400);
    expect(JSON.stringify(response.body)).not.toContain('returnTo');
  });

  it('accepte le même returnTo sur le raccordement du compte tiers', async () => {
    const response = await agent
      .get('/api/connections/oauth/gmail/start')
      .query({ returnTo: returnToDepuisConsentement() });

    /**
     * Ce second chemin portait la même borne de 512. Il aurait cassé à l'étape
     * suivante du parcours — quand l'utilisateur raccorde son compte Gmail —
     * juste après la correction de la connexion.
     *
     * L'application OAuth Gmail peut ne pas être configurée sur cet
     * environnement : ce qui est vérifié, c'est l'absence de rejet sur la
     * longueur, pas l'aboutissement du flux.
     */
    expect(response.status).not.toBe(400);
    expect(JSON.stringify(response.body)).not.toContain('returnTo');
  });

  it('refuse toujours un returnTo réellement démesuré', async () => {
    const response = await request(app)
      .get('/api/auth/google')
      .query({ returnTo: `/autoriser?demande=${'x'.repeat(MAX_RETURN_TO)}` })
      .expect(400);

    expect(response.body.error.details.returnTo).toBeDefined();
  });

  it('refuse une redirection vers un autre domaine, quelle que soit sa taille', async () => {
    const response = await request(app)
      .get('/api/auth/google')
      .query({ returnTo: 'https://exemple-malveillant.test/vol' });

    // `sanitizeReturnTo` ramène toute cible externe sur la racine.
    expect(response.headers.location ?? '').not.toContain('exemple-malveillant');
  });
});
