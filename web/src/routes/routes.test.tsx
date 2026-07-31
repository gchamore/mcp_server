import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ToastProvider } from '../components/Toast';
import { AuthProvider } from '../state/auth';

/**
 * Tests de rendu.
 *
 * Ils ne vérifient pas l'apparence — c'est hors de portée d'un DOM simulé, et
 * une capture d'écran comparée pixel à pixel casserait à chaque retouche de
 * design pour de mauvaises raisons.
 *
 * Ils vérifient ce que la compilation ne voit pas : qu'aucune page ne lève à
 * l'exécution. Le typage ne rattrape ni un composant `undefined` faute
 * d'export, ni un accès à `window` au premier rendu, ni une variable lue avant
 * sa déclaration dans une fermeture — trois pannes déjà rencontrées sur ce
 * projet, chacune donnant une page blanche en production.
 */

const CATALOG = {
  connectors: [
    {
      id: 'demo',
      name: 'Démo',
      tagline: 'Un connecteur de démonstration',
      description: 'Sert uniquement aux tests.',
      category: 'crm',
      status: 'stable',
      icon: 'D',
      accentColor: '#4da3ff',
      auth: { type: 'api_key', fields: [] },
      available: true,
      toolCount: 4,
      tools: [],
      mcpUrl: 'https://example.test/mcp/demo',
    },
  ],
  categories: [{ id: 'crm', label: 'CRM', count: 1 }],
};

function renderRoute(route: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  return render(
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <ToastProvider>
            <AuthProvider>
              <Suspense fallback={<span>chargement</span>}>
                <App />
              </Suspense>
            </AuthProvider>
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ErrorBoundary>,
  );
}

beforeEach(() => {
  // Visiteur anonyme : `/api/auth/me` répond 401, le catalogue reste public.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/connectors')) {
        return new Response(JSON.stringify(CATALOG), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: { message: 'Non authentifié' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('rendu des routes', () => {
  const publicRoutes = [
    ['/', 'accueil'],
    ['/catalogue', 'catalogue'],
    ['/connexion', 'connexion'],
    ['/inscription', 'inscription'],
    ['/mot-de-passe-oublie', 'mot de passe oublié'],
    ['/reinitialiser-mot-de-passe', 'réinitialisation'],
    ['/page-qui-nexiste-pas', '404'],
  ] as const;

  for (const [route, label] of publicRoutes) {
    it(`affiche ${label} sans lever`, async () => {
      const errors: unknown[] = [];
      const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));

      renderRoute(route);

      /**
       * Attendre un titre plutôt que la disparition d'un repli : ça prouve à la
       * fois que le module chargé à la demande est arrivé et qu'il a produit du
       * contenu réel. Toutes les routes en ont un — y compris l'écran de
       * secours du garde-fou, d'où la vérification qui suit.
       */
      // `findAllByRole` et non `findByRole` : les pages riches ont plusieurs
      // titres, et la variante au singulier ne se résout jamais dans ce cas —
      // elle réessaie jusqu'au délai d'expiration.
      /**
       * Délai large et assumé : la toute première route testée paie la
       * transformation à froid de `motion` et de lenis. Observé à 1,2 s sur
       * cette machine, ce sera plus lent sur un exécuteur partagé — un test
       * qui échoue une fois sur dix vaut moins que pas de test du tout.
       */
      const [heading] = await screen.findAllByRole('heading', {}, { timeout: 15_000 });

      if (heading?.textContent?.includes('n’a pas pu s’afficher')) {
        throw new Error(`La route ${route} a levé : ${JSON.stringify(errors[0])}`);
      }
      spy.mockRestore();
    });
  }

  it('affiche le titre de la page d’accueil et les chiffres du catalogue', async () => {
    renderRoute('/');
    expect(await screen.findByText(/pilotés par votre/i, {}, { timeout: 3000 })).toBeTruthy();
    expect(await screen.findByText('Connecteurs')).toBeTruthy();
  });

  it('liste les connecteurs renvoyés par l’API', async () => {
    renderRoute('/catalogue');
    expect(await screen.findByText('Démo', {}, { timeout: 3000 })).toBeTruthy();
  });
});

/**
 * L'écran de consentement n'a pas de titre : c'est un point de passage, pas
 * une page. Il est donc testé sur ce qu'il produit vraiment, et non sur la
 * règle générale ci-dessus.
 */
describe('écran de consentement', () => {
  it('refuse une demande absente au lieu de rester en chargement', async () => {
    renderRoute('/autoriser');
    expect(
      await screen.findByText(/Demande d’autorisation absente/i, {}, { timeout: 3000 }),
    ).toBeTruthy();
  });

  it('renvoie un visiteur anonyme vers la connexion en gardant sa destination', async () => {
    renderRoute('/autoriser?demande=jeton-de-test');

    // La redirection aboutit sur la page de connexion, qui porte un titre.
    const [heading] = await screen.findAllByRole('heading', {}, { timeout: 3000 });
    expect(heading?.textContent).toMatch(/connexion|connecter/i);
  });
});

describe('garde-fou de rendu', () => {
  it('remplace une page en échec par un écran de secours au lieu d’une page blanche', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    function Casse(): never {
      throw new Error('panne simulée');
    }

    render(
      <ErrorBoundary>
        <Casse />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Cette page n’a pas pu s’afficher.')).toBeTruthy();
    expect(screen.getByText('panne simulée')).toBeTruthy();
    spy.mockRestore();
  });
});
