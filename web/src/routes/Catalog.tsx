import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ConnectorCard } from '../components/ConnectorCard';
import { CopyField, EmptyState, Input, Spinner } from '../components/ui';
import { IconExternal, IconSearch } from '../components/icons';
import { pluralize } from '../lib/format';
import { useAuth } from '../state/auth';

/**
 * Catalogue des connecteurs : recherche, filtres par catégorie, grille.
 * Tout provient de `/api/connectors` — la page ne connaît aucun connecteur
 * en particulier et absorbe donc n'importe quel nombre d'ajouts.
 */
export function Catalog() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  const catalogQuery = useQuery({
    queryKey: ['catalog', { search, category }],
    queryFn: () => api.catalog.list({ q: search, category }),
    // Évite un scintillement de la grille à chaque frappe.
    placeholderData: (previous) => previous,
  });

  const connectionsQuery = useQuery({
    queryKey: ['connections'],
    queryFn: api.connections.list,
    enabled: Boolean(user),
  });

  /** Nombre de connexions par connecteur, pour marquer les cartes déjà branchées. */
  const connectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const connection of connectionsQuery.data?.connections ?? []) {
      counts.set(connection.connectorId, (counts.get(connection.connectorId) ?? 0) + 1);
    }
    return counts;
  }, [connectionsQuery.data]);

  const connectors = catalogQuery.data?.connectors ?? [];
  const categories = catalogQuery.data?.categories ?? [];

  return (
    <div className="stack stack--loose">
      <div className="page-header">
        <div className="page-header__title">
          <h1>Catalogue</h1>
          <p>
            Choisissez un service, renseignez vos identifiants, récupérez votre URL MCP. Vos
            assistants IA sauront alors travailler avec vos données.
          </p>
        </div>
      </div>

      {/* Le hub : la porte d'entrée recommandée — une URL pour tous les
          services cochés. Montré aux seuls connectés : un visiteur n'a encore
          rien à agréger. */}
      {user && (
        <div className="card stack stack--tight">
          <div className="row row--between" style={{ alignItems: 'baseline' }}>
            <strong>Hub Toolink — tous vos services derrière une seule URL</strong>
            <span className="text-xs text-muted">recommandé</span>
          </div>
          <p className="text-sm text-muted">
            Collez cette URL dans Dust ou Claude : au moment d’autoriser, vous cocherez les
            services et les outils à exposer.
          </p>
          <CopyField value={`${window.location.origin}/mcp/hub`} />
        </div>
      )}

      <div className="stack">
        <div className="row">
          <div className="search">
            <span className="search__icon" aria-hidden="true">
              <IconSearch size={15} />
            </span>
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher un connecteur ou un outil…"
              aria-label="Rechercher un connecteur"
            />
          </div>
        </div>

        <div className="chips" role="group" aria-label="Filtrer par catégorie">
          <button
            type="button"
            className="chip"
            aria-pressed={category === 'all'}
            onClick={() => setCategory('all')}
          >
            Tout
          </button>
          {categories.map((item) => (
            <button
              key={item.id}
              type="button"
              className="chip"
              aria-pressed={category === item.id}
              onClick={() => setCategory(item.id)}
            >
              {item.label} ({item.count})
            </button>
          ))}
        </div>
      </div>

      {catalogQuery.isLoading ? (
        <Spinner />
      ) : connectors.length === 0 ? (
        <EmptyState
          icon={<IconSearch size={22} />}
          title="Aucun connecteur ne correspond"
          description="Essayez un autre terme, ou retirez le filtre de catégorie."
        />
      ) : (
        <div className="stack">
          <p className="text-sm text-muted">{pluralize(connectors.length, 'connecteur')}</p>
          <div className="grid">
            {connectors.map((connector) => (
              <ConnectorCard
                key={connector.id}
                connector={connector}
                connectionCount={connectionCounts.get(connector.id) ?? 0}
              />
            ))}
          </div>
        </div>
      )}

      {/* Seconde nature du catalogue : les serveurs MCP hébergés par les
          éditeurs eux-mêmes. Référencés, jamais proxifiés — la connexion se
          fait en direct, sans passer par Toolink. Un même service peut exister
          des deux côtés : c'est voulu, l'utilisateur choisit. */}
      {(catalogQuery.data?.hosted ?? []).length > 0 && (
        <div className="stack">
          <div className="stack stack--tight">
            <h2 style={{ fontSize: '1.15rem' }}>MCP officiels des éditeurs</h2>
            <p className="text-sm text-muted" style={{ maxWidth: '68ch' }}>
              Ces services hébergent leur propre serveur MCP : collez l’URL directement dans votre
              client IA. La connexion ne transite pas par Toolink — l’autorisation et le choix des
              outils se font chez l’éditeur.
            </p>
          </div>
          <div className="grid">
            {(catalogQuery.data?.hosted ?? []).map((entry) => (
              <article key={entry.id} className="step">
                <div className="row" style={{ gap: 'var(--s3)', alignItems: 'center' }}>
                  <img className="connector-icon" src={entry.icon} alt="" />
                  <h3 style={{ margin: 0 }}>{entry.name}</h3>
                  <span className="text-xs text-faint" style={{ marginLeft: 'auto' }}>
                    hébergé par l’éditeur
                  </span>
                </div>
                <p className="card__meta">{entry.tagline}</p>
                <CopyField value={entry.url} />
                <div className="row row--between text-xs">
                  <span className="text-muted">
                    {entry.auth === 'oauth' ? 'OAuth' : 'OAuth ou clé API'}
                  </span>
                  <a href={entry.docsUrl} target="_blank" rel="noreferrer noopener">
                    Documentation <IconExternal size={11} />
                  </a>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
