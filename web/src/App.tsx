import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useAuth } from './state/auth';
import { Landing } from './routes/Landing';
import { Catalog } from './routes/Catalog';
import { ConnectorDetail } from './routes/ConnectorDetail';
import { Connections } from './routes/Connections';
import { Settings } from './routes/Settings';
import { Admin } from './routes/Admin';
import { ForgotPassword, Login, Register, ResetPassword } from './routes/auth-pages';
import { Consent } from './routes/Consent';

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
  );
}
