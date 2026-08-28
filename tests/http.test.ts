import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConnectors } from '../src/connectors/registry.js';

/**
 * Test d'intégration du câblage HTTP : ordre des middlewares, CSRF, CORS,
 * en-têtes de sécurité, format d'erreur, routage.
 *
 * Volontairement limité aux chemins qui ne touchent pas la base : la suite doit
 * pouvoir tourner en CI sans PostgreSQL. Les parcours nécessitant des données
 * (connexion, création de connexion, appel MCP authentifié) relèvent d'une
 * suite d'intégration séparée, avec une base éphémère.
 */

await loadConnectors();
const app: Express = createApp();

describe('catalogue public', () => {
  it('expose les connecteurs sans authentification', async () => {
    const response = await request(app).get('/api/connectors').expect(200);

    expect(Array.isArray(response.body.connectors)).toBe(true);
    expect(response.body.connectors.length).toBeGreaterThanOrEqual(2);
    expect(response.body.categories.length).toBeGreaterThan(0);
  });

  it('ne renvoie jamais de code exécutable ni de secret', async () => {
    const response = await request(app).get('/api/connectors').expect(200);
    const serialized = JSON.stringify(response.body);

    expect(serialized).not.toContain('handler');
    expect(serialized).not.toContain('credentials');
  });

  it('filtre par recherche, en ignorant les accents', async () => {
    const response = await request(app).get('/api/connectors?q=facturation').expect(200);
    expect(response.body.connectors.some((c: { id: string }) => c.id === 'axonaut')).toBe(true);
  });

  it('filtre par catégorie', async () => {
    const response = await request(app).get('/api/connectors?category=marketing').expect(200);
    expect(
      response.body.connectors.every((c: { category: string }) => c.category === 'marketing'),
    ).toBe(true);
  });

  it('renvoie 404 pour un connecteur inconnu, au format d’erreur standard', async () => {
    const response = await request(app).get('/api/connectors/inexistant').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(typeof response.body.error.message).toBe('string');
  });
});

describe('authentification', () => {
  it('refuse les routes protégées sans session', async () => {
    const response = await request(app).get('/api/connections').expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuse l’administration sans session', async () => {
    await request(app).get('/api/admin/overview').expect(401);
  });

  it('annonce les méthodes de connexion disponibles', async () => {
    const response = await request(app).get('/api/auth/providers').expect(200);
    expect(response.body).toMatchObject({ password: true });
    expect(typeof response.body.google).toBe('boolean');
  });

  it('valide le corps de la requête avant toute logique métier', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'pas-un-email', password: 'x' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toHaveProperty('email');
  });
});

describe('protections', () => {
  it('bloque une requête mutante venant d’une origine étrangère (CSRF)', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://site-malveillant.example')
      .send({ email: 'a@b.fr', password: 'motdepasse123' })
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('n’autorise pas le partage CORS avec une origine inconnue', async () => {
    const response = await request(app)
      .get('/api/connectors')
      .set('Origin', 'https://site-malveillant.example')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('accepte l’origine déclarée', async () => {
    const response = await request(app)
      .get('/api/connectors')
      .set('Origin', 'http://localhost:3000')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('pose les en-têtes de sécurité', async () => {
    const response = await request(app).get('/api/connectors').expect(200);

    expect(response.headers['content-security-policy']).toBeTruthy();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('transport MCP', () => {
  it('publie ses informations sans exposer de secret', async () => {
    const response = await request(app).get('/mcp').expect(200);

    expect(response.body.transport).toBe('streamable-http');
    expect(response.body.connectors.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(response.body)).not.toMatch(/mcp_[A-Za-z0-9_-]{20,}/);
  });

  /**
   * Le 401 sur l'URL OAuth n'est pas un simple refus : c'est le déclencheur de
   * la configuration automatique. Sans l'en-tête `WWW-Authenticate` pointant
   * vers les métadonnées de ressource, un client IA ne saurait pas où aller et
   * demanderait à l'utilisateur de coller un jeton à la main.
   */
  it('déclenche la découverte automatique sur appel non authentifié', async () => {
    const response = await request(app)
      .post('/mcp/axonaut')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(401);

    const header = response.headers['www-authenticate'] as string;
    expect(header).toContain('Bearer');
    expect(header).toContain(
      'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp/axonaut"',
    );
  });

  // Le rejet d'un jeton statique invalide interroge la base : il est couvert
  // par tests/oauth-flow.test.ts, avec une base éphémère.
});

describe('découverte OAuth', () => {
  it('publie les métadonnées du serveur d’autorisation', async () => {
    const response = await request(app).get('/.well-known/oauth-authorization-server').expect(200);

    expect(response.body.authorization_endpoint).toBe('http://localhost:3000/authorize');
    expect(response.body.token_endpoint).toBe('http://localhost:3000/token');
    expect(response.body.registration_endpoint).toBe('http://localhost:3000/register');
    // PKCE obligatoire : c'est ce qui permet des clients publics sans secret.
    expect(response.body.code_challenge_methods_supported).toContain('S256');
  });

  it('publie les métadonnées de ressource par connecteur', async () => {
    const response = await request(app)
      .get('/.well-known/oauth-protected-resource/mcp/axonaut')
      .expect(200);

    expect(response.body.resource).toBe('http://localhost:3000/mcp/axonaut');
    expect(response.body.authorization_servers).toContain('http://localhost:3000');
  });

  it('renvoie 404 pour la ressource d’un connecteur inconnu', async () => {
    await request(app).get('/.well-known/oauth-protected-resource/mcp/inexistant').expect(404);
  });

  // L'enregistrement dynamique écrit en base : couvert par
  // tests/oauth-flow.test.ts, qui déroule le flux complet.
});

describe('routage', () => {
  it('renvoie 404 au format API pour une route /api inconnue', async () => {
    const response = await request(app).get('/api/inconnu').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
