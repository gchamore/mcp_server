import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../src/core/http-client.js';

/**
 * Ce que le client HTTP restitue d'un service distant.
 *
 * L'enjeu n'est pas cosmétique : ce message remonte jusqu'au modèle, donc
 * potentiellement jusqu'à un tiers. La version précédente recopiait les 200
 * premiers caractères du corps d'erreur brut — et un service qui échoue renvoie
 * parfois la requête qui a échoué, en-têtes compris.
 */

/**
 * Valeur factice, volontairement éloignée du format d'un vrai fournisseur.
 *
 * La première version de ce test employait `sk_live_…`, et l'analyse de secrets
 * de GitHub a refusé la poussée — à juste titre : elle ne peut pas distinguer
 * une clé inventée d'une vraie. Un fixture qui imite un format réel finit tôt ou
 * tard par déclencher une alerte, ou pire, par masquer une vraie fuite dans le
 * bruit.
 */
const CLE = 'jeton-factice-pour-test-0123456789abcdef';

function clientDeTest(reponse: { status: number; body: string; contentType?: string }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(reponse.body, {
          status: reponse.status,
          headers: { 'content-type': reponse.contentType ?? 'application/json' },
        }),
    ),
  );

  return new HttpClient({
    baseUrl: 'https://api.exemple.test',
    serviceName: 'Exemple',
    headers: { Authorization: `Bearer ${CLE}` },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('messages d’erreur distants', () => {
  it('ne répète jamais la clé d’authentification qu’il a envoyée', async () => {
    // Cas réel : un service renvoie la requête reçue pour aider au débogage.
    const client = clientDeTest({
      status: 400,
      body: JSON.stringify({
        message: `Requête invalide. Reçu : Authorization: Bearer ${CLE}`,
      }),
    });

    await expect(client.get('/ressource')).rejects.toThrowError(
      expect.objectContaining({
        message: expect.not.stringContaining(CLE) as unknown as string,
      }),
    );
  });

  it('reprend le message utile du service, pour rester actionnable', async () => {
    const client = clientDeTest({
      status: 400,
      body: JSON.stringify({ message: 'Le champ « email » est obligatoire.' }),
    });

    await expect(client.get('/ressource')).rejects.toThrowError(/champ « email » est obligatoire/);
  });

  it('lit aussi les autres façons de nommer un message d’erreur', async () => {
    for (const champ of ['error_description', 'error', 'detail', 'title']) {
      const client = clientDeTest({
        status: 400,
        body: JSON.stringify({ [champ]: `signalé via ${champ}` }),
      });
      await expect(client.get('/ressource')).rejects.toThrowError(
        new RegExp(`signalé via ${champ}`),
      );
      vi.unstubAllGlobals();
    }
  });

  it('n’extrait rien d’un corps non structuré', async () => {
    /**
     * Une page HTML d'erreur, une trace de pile, un vidage de configuration :
     * rien de tout cela n'a de champ de message. Ne rien restituer vaut mieux
     * que d'en recopier un fragment au hasard.
     */
    // Statut 4xx et non 5xx : au-delà de 500, le message est générique et
    // n'inclut aucun extrait — le test aurait passé sans rien vérifier.
    const client = clientDeTest({
      status: 400,
      body: '<html><body>DB_PASSWORD=super-secret at line 42</body></html>',
      contentType: 'text/html',
    });

    await expect(client.get('/ressource')).rejects.toThrowError(
      expect.objectContaining({
        message: expect.not.stringContaining('super-secret') as unknown as string,
      }),
    );
  });

  it('n’extrait rien d’un JSON sans champ de message', async () => {
    const client = clientDeTest({
      status: 400,
      body: JSON.stringify({ requestHeaders: { authorization: `Bearer ${CLE}` } }),
    });

    await expect(client.get('/ressource')).rejects.toThrowError(
      expect.objectContaining({
        message: expect.not.stringContaining(CLE) as unknown as string,
      }),
    );
  });

  it('borne la longueur de ce qu’il restitue', async () => {
    const client = clientDeTest({
      status: 400,
      body: JSON.stringify({ message: 'x'.repeat(5000) }),
    });

    await expect(client.get('/ressource')).rejects.toThrowError(
      expect.objectContaining({
        message: expect.stringMatching(/^.{0,260}$/s) as unknown as string,
      }),
    );
  });

  it('reste explicite sur les codes qui appellent une action précise', async () => {
    const client = clientDeTest({ status: 401, body: JSON.stringify({ message: 'nope' }) });
    await expect(client.get('/ressource')).rejects.toThrowError(/refusé les identifiants/);

    vi.unstubAllGlobals();
    const limite = clientDeTest({ status: 429, body: JSON.stringify({ message: 'slow down' }) });
    await expect(limite.get('/ressource')).rejects.toThrowError(/limite de débit/);
  });
});
