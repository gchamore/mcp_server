import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ConnectorCard } from '../components/ConnectorCard';
import { Spinner } from '../components/ui';
import { formatNumber } from '../lib/format';

/**
 * Page d'accueil publique.
 *
 * Construction en trois temps : une affirmation plein écran, la preuve
 * (le catalogue réel, pas une maquette), puis le mode d'emploi. Les chiffres
 * sous le héros viennent de l'API — annoncer « 3 connecteurs » quand il y en a
 * douze serait une promesse à re-tenir à chaque ajout.
 */
export function Landing() {
  const { data, isLoading } = useQuery({
    queryKey: ['catalog', {}],
    queryFn: () => api.catalog.list(),
  });

  const connectors = data?.connectors ?? [];
  const toolCount = connectors.reduce((sum, connector) => sum + connector.toolCount, 0);

  return (
    <>
      <section className="hero">
        <div className="hero__content">
          <div className="hero__inner">
            <span className="eyebrow eyebrow--accent">Model Context Protocol</span>
            <h1>Vos outils métier, pilotés par votre assistant IA.</h1>
            <p className="lead">
              MCP Wesype expose vos logiciels — CRM, facturation, e-mailing — comme des outils que
              Claude, Dust ou ChatGPT savent utiliser. Vous collez une URL, l’assistant travaille
              avec vos données.
            </p>
            <div className="hero__actions">
              <Link to="/inscription" className="btn btn--primary btn--lg">
                Commencer
              </Link>
              <Link to="/catalogue" className="btn btn--secondary btn--lg">
                Voir le catalogue
              </Link>
            </div>
          </div>

          <dl className="hero__metrics">
            <div className="hero__metric">
              <dt>Connecteurs</dt>
              <dd>{isLoading ? '—' : formatNumber(connectors.length)}</dd>
            </div>
            <div className="hero__metric">
              <dt>Outils exposés</dt>
              <dd>{isLoading ? '—' : formatNumber(toolCount)}</dd>
            </div>
            <div className="hero__metric">
              <dt>Clé à copier</dt>
              <dd>0</dd>
            </div>
            <div className="hero__metric">
              <dt>Chiffrement</dt>
              <dd>AES-256</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <span className="eyebrow">Catalogue</span>
          <h2>Connecteurs disponibles</h2>
          <p className="lead">
            Chaque connecteur expose un jeu d’outils décrits pour être compris par un modèle.
            Branchez-en autant que nécessaire, avec plusieurs comptes par service si besoin.
          </p>
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

      <section className="section">
        <div className="section__head">
          <span className="eyebrow">Mise en service</span>
          <h2>Trois étapes, aucune configuration</h2>
        </div>

        <div className="grid">
          {[
            {
              n: '01',
              title: 'Connectez votre compte',
              body: "Clé API ou connexion OAuth selon le service. Les identifiants sont vérifiés auprès du fournisseur, puis chiffrés avant stockage.",
            },
            {
              n: '02',
              title: 'Copiez l’URL du connecteur',
              body: "Une URL publique et stable. Votre client IA détecte seul qu’une autorisation est nécessaire et ouvre l’écran de consentement.",
            },
            {
              n: '03',
              title: 'Parlez à vos données',
              body: "« Quelles factures sont impayées ce mois-ci ? » — l’assistant appelle l’outil, lit la réponse, et répond.",
            },
          ].map((step) => (
            <article key={step.n} className="card--interactive" style={{ cursor: 'default' }}>
              <span className="eyebrow eyebrow--bare">{step.n}</span>
              <h3>{step.title}</h3>
              <p className="card__meta">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <span className="eyebrow">Sécurité</span>
          <h2>Vos clés ne quittent jamais la plateforme</h2>
          <p className="lead">
            Le client IA reçoit un jeton limité à un seul connecteur, révocable à tout instant. Il
            n’a jamais accès à vos identifiants : c’est MCP Wesype qui appelle le service, jamais
            lui.
          </p>
        </div>

        <div className="grid">
          {[
            ['Chiffrement au repos', 'Identifiants tiers chiffrés en AES-256-GCM. Jamais réaffichés en clair, jamais journalisés.'],
            ['Jetons révocables', 'Chaque accès est indépendant. Une URL compromise se révoque sans toucher aux autres.'],
            ['Autorisation OAuth 2.1', 'PKCE obligatoire, rotation des jetons, détection de rejeu conforme à la spécification MCP.'],
            ['Traçabilité', 'Chaque appel d’outil est journalisé : quel compte, quel outil, quelle durée.'],
          ].map(([title, body]) => (
            <article key={title} className="card--interactive" style={{ cursor: 'default' }}>
              <h3>{title}</h3>
              <p className="card__meta">{body}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
