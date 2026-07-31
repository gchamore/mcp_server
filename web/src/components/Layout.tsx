import { NavLink, Link, Outlet } from 'react-router-dom';
import { useAuth } from '../state/auth';
import { Button } from './ui';
import { initials } from '../lib/format';

/** Coquille commune : barre de navigation, contenu, pied de page. */
export function Layout() {
  const { user, isAdmin, logout } = useAuth();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#contenu">
        Aller au contenu
      </a>

      <header className="topbar">
        <div className="container topbar__inner">
          <Link to={user ? '/catalogue' : '/'} className="brand">
            <span className="brand__mark" aria-hidden="true">
              W
            </span>
            MCP&nbsp;Wesype
          </Link>

          {user && (
            <nav className="topbar__nav" aria-label="Navigation principale">
              <NavLink to="/catalogue" className="nav-link">
                Catalogue
              </NavLink>
              <NavLink to="/connexions" className="nav-link">
                Mes connexions
              </NavLink>
              {isAdmin && (
                <NavLink to="/administration" className="nav-link">
                  Administration
                </NavLink>
              )}
            </nav>
          )}

          <div className="topbar__spacer" />

          {user ? (
            <div className="row">
              <Link to="/parametres" className="nav-link" title={user.email}>
                <span className="row" style={{ gap: 'var(--space-2)' }}>
                  <span
                    className="brand__mark"
                    style={{ background: 'var(--bg-sunken)', color: 'var(--text-muted)' }}
                    aria-hidden="true"
                  >
                    {initials(user.firstName, user.lastName, user.email)}
                  </span>
                  <span className="truncate" style={{ maxWidth: '12ch' }}>
                    {user.firstName ?? user.email}
                  </span>
                </span>
              </Link>
              <Button size="sm" variant="ghost" onClick={() => void logout()}>
                Déconnexion
              </Button>
            </div>
          ) : (
            <div className="row">
              <Link to="/connexion" className="btn btn--ghost btn--sm">
                Se connecter
              </Link>
              <Link to="/inscription" className="btn btn--primary btn--sm">
                Créer un compte
              </Link>
            </div>
          )}
        </div>
      </header>

      <main id="contenu" className="page">
        <div className="container">
          <Outlet />
        </div>
      </main>

      <footer className="footer">
        <div className="container footer__inner">
          <span>© {new Date().getFullYear()} Wesype — Model Context Protocol</span>
          <a href="/mcp" target="_blank" rel="noreferrer noopener">
            État du service
          </a>
        </div>
      </footer>
    </div>
  );
}
