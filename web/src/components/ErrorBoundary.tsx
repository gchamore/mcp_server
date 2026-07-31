import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Garde-fou de rendu.
 *
 * Sans lui, une exception dans n'importe quel composant démonte tout l'arbre :
 * React vide `#root` et l'utilisateur se retrouve devant une page blanche, sans
 * message, sans moyen de repartir. C'est le pire échec possible — il ressemble
 * à une panne de serveur alors que le serveur va très bien.
 *
 * Volontairement une classe : c'est encore la seule façon d'intercepter une
 * erreur de rendu en React 19, aucun hook n'expose `componentDidCatch`.
 */
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Pas encore de collecteur d'erreurs : la console reste le seul endroit où
    // un incident laisse une trace exploitable.
    console.error('Erreur de rendu', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="auth-layout">
        <div className="auth-card stack">
          <span className="eyebrow eyebrow--accent">Erreur</span>
          <h1>Cette page n’a pas pu s’afficher.</h1>
          <p className="text-muted">
            L’incident vient de l’interface, pas de vos données : rien n’a été modifié.
          </p>

          <div className="row" style={{ gap: 'var(--s3)' }}>
            {/* Rechargement complet plutôt que remise à zéro de l'état : si le
                composant a échoué une fois, il échouera à l'identique. */}
            <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
              Recharger la page
            </button>
            <a className="btn btn--secondary" href="/">
              Retour à l’accueil
            </a>
          </div>

          <details className="text-xs text-faint">
            <summary>Détail technique</summary>
            <pre className="mono" style={{ whiteSpace: 'pre-wrap', marginTop: 'var(--s2)' }}>
              {error.message}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
