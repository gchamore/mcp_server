import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ConnectorCard } from '../components/ConnectorCard';
import { Spinner } from '../components/ui';
import { pluralize } from '../lib/format';

/** Page d'accueil publique : explique le produit et montre le catalogue réel. */
export function Landing() {
  const { data, isLoading } = useQuery({
    queryKey: ['catalog', {}],
    queryFn: () => api.catalog.list(),
  });

  const connectors = data?.connectors ?? [];

  return (
    <div className="stack stack--loose">
      <section className="hero">
        <h1>Branchez vos outils métier à votre assistant IA</h1>
        <p>
          MCP Wesype transforme vos logiciels (CRM, facturation, e-mailing) en outils utilisables
          directement par Claude, Dust ou ChatGPT. Vous collez une URL, l’assistant sait travailler
          avec vos données.
        </p>
        <div className="row">
          <Link to="/inscription" className="btn btn--primary btn--lg">
            Commencer gratuitement
          </Link>
          <Link to="/connexion" className="btn btn--secondary btn--lg">
            J’ai déjà un compte
          </Link>
        </div>
      </section>

      <section className="stack">
        <div className="page-header">
          <div className="page-header__title">
            <h2>Connecteurs disponibles</h2>
            <p>
              {isLoading
                ? 'Chargement du catalogue…'
                : `${pluralize(connectors.length, 'connecteur')} prêts à l’emploi, ${pluralize(
                    connectors.reduce((sum, connector) => sum + connector.toolCount, 0),
                    'outil',
                  )} au total.`}
            </p>
          </div>
        </div>

        {isLoading ? (
          <Spinner />
        ) : (
          <div className="grid">
            {connectors.map((connector) => (
              <ConnectorCard key={connector.id} connector={connector} />
            ))}
          </div>
        )}
      </section>

      <section className="grid">
        <article className="card stack stack--tight">
          <h3>1. Connectez votre compte</h3>
          <p className="text-sm text-muted">
            Renseignez votre clé API. Elle est vérifiée auprès du service, puis chiffrée avant
            stockage.
          </p>
        </article>
        <article className="card stack stack--tight">
          <h3>2. Copiez votre URL MCP</h3>
          <p className="text-sm text-muted">
            Une URL privée et révocable est générée. Collez-la dans votre assistant, c’est tout.
          </p>
        </article>
        <article className="card stack stack--tight">
          <h3>3. Discutez avec vos données</h3>
          <p className="text-sm text-muted">
            « Quelles factures sont impayées ce mois-ci ? » — l’assistant interroge votre outil et
            répond.
          </p>
        </article>
      </section>
    </div>
  );
}
