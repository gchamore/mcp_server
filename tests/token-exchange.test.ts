import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchange } from '../src/modules/connections/connector-oauth.service.js';

/**
 * Authentification auprès du point de jeton d'un fournisseur OAuth.
 *
 * Deux écoles cohabitent : le secret client dans le corps (Google, Microsoft…)
 * ou en HTTP Basic (Notion, et tout fournisseur qui applique la RFC 6749
 * §2.3.1 à la lettre — certains refusent le secret dans le corps). Sans le
 * mode Basic, ces fournisseurs étaient inaccessibles ; et en Basic, le secret
 * ne doit pas voyager une seconde fois dans le corps.
 */

function stubTokenEndpoint() {
  const appels: { headers: Record<string, string>; body: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL, init?: RequestInit) => {
      appels.push({
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: String(init?.body),
      });
      return new Response(JSON.stringify({ access_token: 'jeton', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return appels;
}

afterEach(() => vi.unstubAllGlobals());

const PARAMS = {
  grant_type: 'authorization_code',
  code: 'abc',
  client_id: 'mon-id',
  client_secret: 'mon-secret',
};

describe('exchange', () => {
  it('mode corps (défaut) : identifiants dans le corps, pas d’en-tête Authorization', async () => {
    const appels = stubTokenEndpoint();
    await exchange('https://fournisseur.test/token', { ...PARAMS });

    const [appel] = appels;
    expect(appel?.body).toContain('client_secret=mon-secret');
    expect(appel?.headers.Authorization).toBeUndefined();
  });

  it('mode basic : en-tête RFC 6749, et le secret sort du corps', async () => {
    const appels = stubTokenEndpoint();
    await exchange('https://fournisseur.test/token', { ...PARAMS }, 'basic');

    const [appel] = appels;
    const attendu = `Basic ${Buffer.from('mon-id:mon-secret').toString('base64')}`;
    expect(appel?.headers.Authorization).toBe(attendu);
    // Le secret ne doit pas voyager deux fois.
    expect(appel?.body).not.toContain('mon-secret');
    expect(appel?.body).not.toContain('client_id');
  });

  it('refuse une réponse sans jeton d’accès', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
    await expect(exchange('https://fournisseur.test/token', { ...PARAMS })).rejects.toThrowError(
      /pas renvoyé de jeton/,
    );
  });
});
