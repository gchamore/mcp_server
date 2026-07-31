import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { api } from '../lib/api';
import { ConnectorCard } from '../components/ConnectorCard';
import { Spinner } from '../components/ui';
import { Counter, CursorGlow, Reveal, Stagger, StaggerItem } from '../components/motion';
import { IconArrowRight, IconKey, IconLink, IconPlug, IconShield } from '../components/icons';
import { useSmoothScroll } from '../hooks/useSmoothScroll';

/**
 * Page d'accueil.
 *
 * Construction en quatre temps : une affirmation plein écran, la preuve (le
 * catalogue réel, pas une maquette), le mode d'emploi, puis le modèle de
 * sécurité. Les chiffres viennent de l'API — annoncer « 3 connecteurs » en dur
 * serait une promesse à re-tenir à chaque ajout.
 *
 * Le mouvement est réservé à cette page : le héros joue à l'arrivée, les
 * sections se révèlent au défilement, et le défilement lui-même est inertiel.
 * Les écrans de travail, eux, restent immédiats.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

export function Landing() {
  useSmoothScroll();
  const reduced = useReducedMotion();

  const { data, isLoading } = useQuery({
    queryKey: ['catalog', {}],
    queryFn: () => api.catalog.list(),
  });

  const connectors = data?.connectors ?? [];
  const toolCount = connectors.reduce((sum, connector) => sum + connector.toolCount, 0);

  // Entrée du héros : séquencée à l'arrivée, pas au défilement.
  const enter = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 22 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.9, delay, ease: EASE },
  });

  return (
    <>
      <section className="hero">
        <div className="aurora" aria-hidden="true" />
        <CursorGlow />

        <div className="hero__content">
          <div className="hero__inner">
            <motion.span className="eyebrow eyebrow--accent" {...enter(0)}>
              Model Context Protocol
            </motion.span>

            <motion.h1 className="display" {...enter(0.08)}>
              Vos outils métier,
              <br />
              pilotés par votre&nbsp;IA.
            </motion.h1>

            <motion.p className="lead" {...enter(0.16)}>
              MCP Wesype expose vos logiciels — CRM, facturation, e-mailing — comme des outils que
              Claude, Dust ou ChatGPT savent utiliser. Vous collez une URL, l’assistant travaille
              avec vos données.
            </motion.p>

            <motion.div className="hero__actions" {...enter(0.24)}>
              <Link to="/inscription" className="btn btn--primary btn--lg">
                Commencer
                <IconArrowRight size={15} />
              </Link>
              <Link to="/catalogue" className="btn btn--secondary btn--lg">
                Voir le catalogue
              </Link>
            </motion.div>
          </div>

          <motion.dl className="hero__metrics" {...enter(0.36)}>
            <div className="hero__metric">
              <dt>Connecteurs</dt>
              <dd>{isLoading ? '—' : <Counter value={connectors.length} />}</dd>
            </div>
            <div className="hero__metric">
              <dt>Outils exposés</dt>
              <dd>{isLoading ? '—' : <Counter value={toolCount} />}</dd>
            </div>
            <div className="hero__metric">
              <dt>Clé à copier</dt>
              <dd>0</dd>
            </div>
            <div className="hero__metric">
              <dt>Chiffrement</dt>
              <dd>AES-256</dd>
            </div>
          </motion.dl>
        </div>
      </section>

      <section className="section section--lit">
        <Reveal className="section__head">
          <span className="eyebrow">Catalogue</span>
          <h2>Connecteurs disponibles</h2>
          <p className="lead">
            Chaque connecteur expose un jeu d’outils décrits pour être compris par un modèle.
            Branchez-en autant que nécessaire, avec plusieurs comptes par service si besoin.
          </p>
        </Reveal>

        {isLoading ? (
          <Spinner />
        ) : (
          <Stagger className="grid">
            {connectors.map((connector) => (
              <StaggerItem key={connector.id}>
                <ConnectorCard connector={connector} />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </section>

      <section className="section section--lit">
        <Reveal className="section__head">
          <span className="eyebrow">Mise en service</span>
          <h2>Trois étapes, aucune configuration</h2>
        </Reveal>

        <Stagger className="grid">
          {[
            {
              n: '01',
              Icon: IconKey,
              title: 'Connectez votre compte',
              body: 'Clé API ou connexion OAuth selon le service. Les identifiants sont vérifiés auprès du fournisseur, puis chiffrés avant stockage.',
            },
            {
              n: '02',
              Icon: IconLink,
              title: 'Copiez l’URL du connecteur',
              body: 'Une URL publique et stable. Votre client IA détecte seul qu’une autorisation est nécessaire et ouvre l’écran de consentement.',
            },
            {
              n: '03',
              Icon: IconPlug,
              title: 'Parlez à vos données',
              body: '« Quelles factures sont impayées ce mois-ci ? » — l’assistant appelle l’outil, lit la réponse, et répond.',
            },
          ].map(({ n, Icon, title, body }) => (
            <StaggerItem key={n} as="article" className="step">
              <div className="step__head">
                <span className="step__n">{n}</span>
                <Icon size={18} />
              </div>
              <h3>{title}</h3>
              <p className="card__meta">{body}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section className="section section--lit">
        <Reveal className="section__head">
          <span className="eyebrow">
            <IconShield size={13} />
            Sécurité
          </span>
          <h2>Vos clés ne quittent jamais la plateforme</h2>
          <p className="lead">
            Le client IA reçoit un jeton limité à un seul connecteur, révocable à tout instant. Il
            n’a jamais accès à vos identifiants : c’est MCP Wesype qui appelle le service, jamais
            lui.
          </p>
        </Reveal>

        <Stagger className="grid">
          {[
            [
              'Chiffrement au repos',
              'Identifiants tiers chiffrés en AES-256-GCM. Jamais réaffichés en clair, jamais journalisés.',
            ],
            [
              'Jetons révocables',
              'Chaque accès est indépendant. Une URL compromise se révoque sans toucher aux autres.',
            ],
            [
              'Autorisation OAuth 2.1',
              'PKCE obligatoire, rotation des jetons, détection de rejeu conforme à la spécification MCP.',
            ],
            [
              'Traçabilité',
              'Chaque appel d’outil est journalisé : quel compte, quel outil, quelle durée.',
            ],
          ].map(([title, body]) => (
            <StaggerItem key={title} as="article" className="step">
              <h3>{title}</h3>
              <p className="card__meta">{body}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section className="section">
        <Reveal>
          <div className="cta">
            <div className="stack">
              <span className="eyebrow eyebrow--accent">Prêt</span>
              <h2>Branchez votre premier outil en deux minutes.</h2>
            </div>
            <Link to="/inscription" className="btn btn--primary btn--lg">
              Créer un compte
              <IconArrowRight size={15} />
            </Link>
          </div>
        </Reveal>
      </section>
    </>
  );
}
