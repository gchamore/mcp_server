import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Suspense, lazy, type ReactNode } from 'react';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useAuth } from './state/auth';

/**
 * Découpage par route.
 *
 * La page d'accueil embarque la bibliothèque d'animation et le défilement
 * inertiel — une cinquantaine de kilo-octets compressés dont les écrans de
 * travail n'ont aucun usage. Sans découpage, tout le monde les téléchargerait ;
 * avec, chaque page ne paie que ce qu'elle affiche.
 *
 * `Layout`, `ui` et l'authentification restent en statique : ils sont sur le
 * chemin critique de toutes les pages, les différer n'ajouterait qu'un
 * aller-retour.
 */
const Landing = lazy(() => import('./routes/Landing').then((m) => ({ default: m.Landing })));
const Catalog = lazy(() => import('./routes/Catalog').then((m) => ({ default: m.Catalog })));
const ConnectorDetail = lazy(() =>
  import('./routes/ConnectorDetail').then((m) => ({ default: m.ConnectorDetail })),
);
const Connections = lazy(() =>
  import('./routes/Connections').then((m) => ({ default: m.Connections })),
);
const Settings = lazy(() => import('./routes/Settings').then((m) => ({ default: m.Settings })));
const Admin = lazy(() => import('./routes/Admin').then((m) => ({ default: m.Admin })));
const Consent = lazy(() => import('./routes/Consent').then((m) => ({ default: m.Consent })));
const Login = lazy(() => import('./routes/auth-pages').then((m) => ({ default: m.Login })));
const Register = lazy(() => import('./routes/auth-pages').then((m) => ({ default: m.Register })));
const ForgotPassword = lazy(() =>
  import('./routes/auth-pages').then((m) => ({ default: m.ForgotPassword })),
);
const ResetPassword = lazy(() =>
  import('./routes/auth-pages').then((m) => ({ default: m.ResetPassword })),
);

/** Redirige vers la connexion en mémorisant la page demandée. */
function RequireAuth({ children, adminOnly }: { children: ReactNode; adminOnly?: boolean }) {
  const { user, isAdmin, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <Spinner />;

  if (!user) {
    return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  }
  if (adminOnly && !isAdmin) return <Navigate to="/catalogue" replace />;

  return <>{children}</>;
}

/** Racine : la page d'accueil pour les visiteurs, le catalogue pour les connectés. */
function Home() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <Spinner />;
  return user ? <Navigate to="/catalogue" replace /> : <Landing />;
}

export function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        {/* Écrans plein écran, hors coquille applicative. */}
        <Route path="/connexion" element={<Login />} />
        <Route path="/inscription" element={<Register />} />
        <Route path="/mot-de-passe-oublie" element={<ForgotPassword />} />
        <Route path="/reinitialiser-mot-de-passe" element={<ResetPassword />} />
        {/* Écran de consentement MCP : hors coquille, c'est un point de passage. */}
        <Route path="/autoriser" element={<Consent />} />

        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/catalogue" element={<Catalog />} />
          <Route path="/catalogue/:connectorId" element={<ConnectorDetail />} />
          <Route
            path="/connexions"
            element={
              <RequireAuth>
                <Connections />
              </RequireAuth>
            }
          />
          <Route
            path="/parametres"
            element={
              <RequireAuth>
                <Settings />
              </RequireAuth>
            }
          />
          <Route
            path="/administration"
            element={
              <RequireAuth adminOnly>
                <Admin />
              </RequireAuth>
            }
          />
          <Route
            path="*"
            element={
              <div className="stack">
                <h1>Page introuvable</h1>
                <p className="text-muted">Cette adresse ne correspond à aucune page.</p>
              </div>
            }
          />
        </Route>
      </Routes>
    </Suspense>
  );
}
