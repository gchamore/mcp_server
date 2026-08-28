import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConnectors } from '../src/connectors/registry.js';
import { hostedMcps } from '../src/connectors/hosted.js';

/**
 * Les MCP officiels référencés.
 *
 * Le point sensible n'est pas la liste elle-même, c'est ce qu'elle promet :
 * chaque fiche envoie l'utilisateur autoriser un serveur externe. Une URL
 * fausse ou non-HTTPS l'enverrait autoriser n'importe quoi — d'où des
 * assertions sur la forme de chaque entrée, pas seulement sur leur présence.
 */
const app = createApp();

beforeAll(loadConnectors);

describe('catalogue — fiches officielles', () => {
  it('expose les fiches avec URL https et documentation', async () => {
    const reponse = await request(app).get('/api/connectors').expect(200);

    expect(reponse.body.hosted.length).toBeGreaterThanOrEqual(4);
    for (const entry of reponse.body.hosted) {
      expect(entry.url).toMatch(/^https:\/\//);
      expect(entry.docsUrl).toMatch(/^https:\/\//);
      expect(entry.name).toBeTruthy();
      expect(['oauth', 'oauth_ou_cle_api']).toContain(entry.auth);
    }
  });

  it('applique la recherche aux deux natures d’entrées', async () => {
    const reponse = await request(app).get('/api/connectors').query({ q: 'stripe' }).expect(200);

    const noms = reponse.body.hosted.map((e: { name: string }) => e.name);
    expect(noms).toContain('Stripe');
    expect(noms).not.toContain('Notion');
  });

  it('n’entre jamais en collision avec les identifiants de connecteurs ou le hub', () => {
    const ids = hostedMcps.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('hub');
    // Les connecteurs Toolink et les fiches officielles partagent le même
    // espace d'affichage : un doublon d'id casserait les clés React.
    for (const id of ['axonaut', 'brevo', 'gmail']) {
      expect(ids).not.toContain(id);
    }
  });
});
