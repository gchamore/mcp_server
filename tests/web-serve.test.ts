import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConnectors } from '../src/connectors/registry.js';

/**
 * Service de l'interface.
 *
 * Ces vérifications portent sur des choses qui cassent en silence : personne ne
 * remarque un `robots.txt` qui répond du HTML, ni un asset servi en brotli sans
 * l'en-tête qui va avec — jusqu'au jour où le référencement s'effondre ou
 * qu'un navigateur refuse d'exécuter un script.
 */
const app = createApp();

// Le registre est peuplé au démarrage du serveur, pas par `createApp` : sans
// ça, le plan du site et les fiches connecteur seraient vides ici.
beforeAll(loadConnectors);

describe('métadonnées par route', () => {
  it('donne à la page d’accueil son titre, sa canonique et sa description structurée', async () => {
    const response = await request(app).get('/').expect(200);

    expect(response.text).toContain('<title>Toolink — Vos outils métier');
    expect(response.text).toContain('rel="canonical"');
    expect(response.text).toContain('application/ld+json');
    expect(response.text).toContain('property="og:title"');
    expect(response.text).not.toContain('name="robots"');
  });

  it('donne à chaque fiche connecteur son propre titre', async () => {
    const response = await request(app).get('/catalogue/gmail').expect(200);
    expect(response.text).toContain('<title>Gmail — connecteur MCP');
  });

  it('interdit l’indexation des écrans applicatifs', async () => {
    const response = await request(app).get('/administration').expect(200);
    expect(response.text).toContain('content="noindex, nofollow"');
  });

  it('n’émet qu’un seul titre — le gabarit ne doit pas laisser traîner le sien', async () => {
    const response = await request(app).get('/catalogue').expect(200);
    expect(response.text.match(/<title>/g)).toHaveLength(1);
  });
});

describe('fichiers destinés aux robots', () => {
  it('sert un robots.txt en texte brut, pas la page d’application', async () => {
    const response = await request(app).get('/robots.txt').expect(200);

    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toContain('User-agent: *');
    expect(response.text).toContain('Sitemap: ');
    expect(response.text).not.toContain('<!doctype html>');
  });

  it('liste les connecteurs réels dans le plan du site', async () => {
    const response = await request(app).get('/sitemap.xml').expect(200);

    expect(response.headers['content-type']).toMatch(/xml/);
    expect(response.text).toContain('/catalogue/gmail');
  });
});

describe('fichiers absents', () => {
  /**
   * Le repli SPA renvoyait autrefois `index.html` en 200 pour n'importe quelle
   * URL. Un module manquant échouait alors sur une erreur de syntaxe
   * incompréhensible, au lieu d'un franc 404.
   */
  it('renvoie 404 pour un asset inexistant plutôt que du HTML', async () => {
    const response = await request(app).get('/assets/inexistant.js').expect(404);
    expect(response.text).not.toContain('<!doctype html>');
  });

  it('renvoie tout de même l’application pour une route côté client inconnue', async () => {
    const response = await request(app).get('/une-page-inventee').expect(200);
    expect(response.text).toContain('<div id="root">');
  });
});

describe('compression', () => {
  it('sert la variante brotli avec son encodage et son type déclarés', async () => {
    const index = await request(app).get('/');
    const asset = /\/assets\/index-[A-Za-z0-9_-]+\.js/.exec(index.text)?.[0];
    expect(asset).toBeDefined();

    const response = await request(app)
      .get(asset!)
      .set('Accept-Encoding', 'br')
      .expect(200);

    expect(response.headers['content-encoding']).toBe('br');
    // Sans ça, le navigateur téléchargerait le fichier au lieu de l'exécuter.
    expect(response.headers['content-type']).toMatch(/text\/javascript/);
    // Sans ça, un cache partagé servirait du brotli à un client qui l'ignore.
    expect(response.headers.vary).toMatch(/Accept-Encoding/i);
  });

  it('sert le fichier d’origine à un client qui ne compresse pas', async () => {
    const index = await request(app).get('/');
    const asset = /\/assets\/index-[A-Za-z0-9_-]+\.js/.exec(index.text)?.[0];

    const response = await request(app)
      .get(asset!)
      .set('Accept-Encoding', 'identity')
      .expect(200);

    expect(response.headers['content-encoding']).toBeUndefined();
  });
});
