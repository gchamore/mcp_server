import { Link } from 'react-router-dom';
import { Badge, ConnectorStatusBadge } from './ui';
import { pluralize } from '../lib/format';
import type { Connector } from '../lib/types';

/**
 * Carte du catalogue.
 *
 * Purement pilotée par les données : c'est ce qui permet d'ajouter un
 * connecteur sans toucher au front, là où l'ancienne version demandait un
 * bouton codé en dur puis une page HTML entière copiée-collée.
 *
 * La couleur de marque du service n'est utilisée que sur un filet d'un pixel
 * au survol : assez pour identifier, trop peu pour rompre la monochromie.
 */
export function ConnectorCard({
  connector,
  connectionCount = 0,
}: {
  connector: Connector;
  connectionCount?: number;
}) {
  return (
    <Link
      to={`/catalogue/${connector.id}`}
      className="card--interactive"
      style={{ '--accent': connector.accentColor } as React.CSSProperties}
    >
      <div className="card__header">
        <img
          className="connector-icon"
          src={connector.icon}
          alt=""
          loading="lazy"
          onError={(event) => {
            // Une icône distante peut disparaître : on ne laisse pas une image
            // cassée dégrader la grille.
            event.currentTarget.style.visibility = 'hidden';
          }}
        />
        <div className="stack stack--tight" style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 'var(--s2)' }}>
            <span className="card__title">{connector.name}</span>
            <ConnectorStatusBadge status={connector.status} />
            {!connector.available && <Badge tone="neutral">indisponible</Badge>}
          </div>
          <span className="card__meta">{connector.tagline}</span>
        </div>
      </div>

      <div className="card__footer">
        <span>{pluralize(connector.toolCount, 'outil')}</span>
        {connectionCount > 0 ? (
          <Badge tone="success">
            <span className="dot" aria-hidden="true" />
            {pluralize(connectionCount, 'connexion')}
          </Badge>
        ) : (
          <span className="card__arrow" aria-hidden="true">
            →
          </span>
        )}
      </div>
    </Link>
  );
}
