import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, connectorOAuthUrl } from '../lib/api';
import { CredentialForm } from '../components/CredentialForm';
import { useToast } from '../components/Toast';
import {
  Alert,
  Badge,
  Button,
  ConnectionBadge,
  ConnectorStatusBadge,
  CopyField,
  Modal,
  Spinner,
} from '../components/ui';
import { IconArrowRight, IconExternal } from '../components/icons';
import { pluralize, timeAgo } from '../lib/format';
import { useAuth } from '../state/auth';

/**
 * Page de détail d'un connecteur — générique.
 *
 * Elle remplace les anciennes pages HTML dupliquées (axonaut.html, gmail.html…)
 * qui répétaient 700 lignes de balisage et de CSS pour chaque service.
 */
export function ConnectorDetail() {
  const { connectorId = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const connectorQuery = useQuery({
    queryKey: ['connector', connectorId],
    queryFn: () => api.catalog.get(connectorId),
  });

  const connectionsQuery = useQuery({
    queryKey: ['connections'],
    queryFn: api.connections.list,
    enabled: Boolean(user),
  });

  const connector = connectorQuery.data?.connector;
  const existing = (connectionsQuery.data?.connections ?? []).filter(
    (connection) => connection.connectorId === connectorId,
  );

  const createMutation = useMutation({
    mutationFn: (credentials: Record<string, string>) =>
      api.connections.create({
        connectorId,
        label: existing.length === 0 ? 'Compte principal' : `Compte ${existing.length + 1}`,
        credentials,
      }),
    onSuccess: async ({ connection, endpointUrl }) => {
      setFieldErrors({});
      await queryClient.invalidateQueries({ queryKey: ['connections'] });

      if (connection.status === 'ERROR') {
        toast.error(connection.statusMessage ?? 'Identifiants refusés par le service.');
      } else {
        toast.success('Connexion établie.');
      }
      setCreatedUrl(endpointUrl);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setFieldErrors(error.fields);
        toast.error(error.message);
        return;
      }
      toast.error('Impossible de créer la connexion.');
    },
  });

  if (connectorQuery.isLoading) return <Spinner />;

  if (connectorQuery.isError || !connector) {
    return (
      <Alert tone="danger">
        Ce connecteur n’existe pas. <Link to="/catalogue">Retour au catalogue</Link>
      </Alert>
    );
  }

  const readOnlyTools = connector.tools.filter((tool) => tool.readOnly).length;

  return (
    <div className="stack stack--loose">
      <nav className="text-sm text-muted">
        <Link to="/catalogue">Catalogue</Link> <span aria-hidden="true">/</span> {connector.name}
      </nav>

      <header className="row row--between" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 'var(--s4)', alignItems: 'flex-start' }}>
          <img className="connector-icon connector-icon--lg" src={connector.icon} alt="" />
          <div className="stack stack--tight">
            <div className="row" style={{ gap: 'var(--s2)' }}>
              <h1 style={{ fontSize: '1.75rem' }}>{connector.name}</h1>
              <ConnectorStatusBadge status={connector.status} />
            </div>
            <p className="text-muted" style={{ maxWidth: '62ch' }}>
              {connector.description}
            </p>
            <div className="row text-sm text-muted">
              <span>{pluralize(connector.toolCount, 'outil')}</span>
              <span aria-hidden="true">·</span>
              <span>{readOnlyTools} en lecture seule</span>
              {connector.docsUrl && (
                <>
                  <span aria-hidden="true">·</span>
                  <a href={connector.docsUrl} target="_blank" rel="noreferrer noopener">
                    Documentation <IconExternal size={12} />
                  </a>
                </>
              )}
            </div>
          </div>
        </div>

        {!user ? (
          <Button variant="primary" onClick={() => navigate('/connexion')}>
            Se connecter pour brancher
          </Button>
        ) : !connector.available ? (
          <Button variant="secondary" disabled>
            Bientôt disponible
          </Button>
        ) : connector.auth.type === 'oauth2' ? (
          // Connecteur OAuth : navigation complète vers le fournisseur.
          <a
            className="btn btn--primary"
            href={connectorOAuthUrl(connector.id, {
              returnTo: `/catalogue/${connector.id}`,
              label: existing.length === 0 ? 'Compte principal' : `Compte ${existing.length + 1}`,
            })}
          >
            {existing.length === 0 ? `Connecter mon compte ${connector.name}` : 'Ajouter un compte'}
          </a>
        ) : (
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            {existing.length === 0 ? 'Connecter' : 'Ajouter un compte'}
          </Button>
        )}
      </header>

      {!connector.available && connector.unavailableReason && (
        <Alert tone="warning">{connector.unavailableReason}</Alert>
      )}

      <section className="card stack stack--tight">
        <div className="row row--between">
          <strong>Brancher dans un client IA</strong>
          <Badge tone="info">configuration automatique</Badge>
        </div>
        <p className="text-sm text-muted">
          Collez cette URL dans Claude, Dust ou ChatGPT. Le client détecte seul qu’une
          autorisation est nécessaire et ouvre l’écran de consentement : aucune clé à copier.
        </p>
        <CopyField value={connector.mcpUrl} label="URL du serveur MCP" />
      </section>

      {existing.length > 0 && (
        <section className="stack">
          <h2>Vos connexions</h2>
          <div className="grid">
            {existing.map((connection) => (
              <Link key={connection.id} to="/connexions" className="card card--interactive">
                <div className="row row--between">
                  <strong>{connection.label}</strong>
                  <ConnectionBadge status={connection.status} />
                </div>
                <span className="card__meta">
                  {connection.accountLabel ?? 'Compte connecté'} · vérifiée{' '}
                  {timeAgo(connection.lastVerifiedAt)}
                </span>
                <div className="card__footer">
                  <span>{pluralize(connection.endpoints.length, 'point d’accès')}</span>
                  <span className="card__arrow" aria-hidden="true">
                    <IconArrowRight size={14} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="stack">
        <h2>Outils exposés à l’assistant</h2>
        <p className="text-sm text-muted">
          Ce sont les actions que votre assistant IA pourra déclencher une fois la connexion en
          place.
        </p>
        <ul className="tool-list">
          {connector.tools.map((tool) => (
            <li key={tool.name} className="tool-item">
              <div className="stack stack--tight" style={{ flex: 1 }}>
                <div className="row" style={{ gap: 'var(--s2)' }}>
                  <strong>{tool.title}</strong>
                  {tool.readOnly ? (
                    <Badge tone="neutral">Lecture</Badge>
                  ) : (
                    <Badge tone="warning">Écriture</Badge>
                  )}
                </div>
                <span className="tool-item__name">{tool.name}</span>
                <span className="text-sm text-muted">{tool.description}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Formulaire de connexion : entièrement dérivé de connector.auth.fields */}
      <Modal
        open={modalOpen && !createdUrl}
        title={`Connecter ${connector.name}`}
        onClose={() => setModalOpen(false)}
      >
        <CredentialForm
          connector={connector}
          submitLabel="Connecter"
          loading={createMutation.isPending}
          serverErrors={fieldErrors}
          onSubmit={(credentials) => createMutation.mutate(credentials)}
          onCancel={() => setModalOpen(false)}
        />
      </Modal>

      {/* L'URL n'est affichée intégralement qu'ici et via « Révéler ». */}
      <Modal
        open={createdUrl !== null}
        title="Votre URL MCP est prête"
        wide
        onClose={() => {
          setCreatedUrl(null);
          setModalOpen(false);
        }}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCreatedUrl(null);
                setModalOpen(false);
              }}
            >
              Fermer
            </Button>
            <Button variant="primary" onClick={() => navigate('/connexions')}>
              Voir mes connexions
            </Button>
          </>
        }
      >
        <div className="stack">
          <Alert tone="success">
            Collez cette URL dans votre assistant IA (Claude, Dust, ChatGPT…) comme serveur MCP.
          </Alert>
          {createdUrl && <CopyField value={createdUrl} label="URL du serveur MCP" />}
          <p className="text-sm text-muted">
            Cette URL contient un secret. Ne la partagez pas publiquement : elle donne accès à votre
            compte {connector.name}. Vous pourrez la révoquer à tout moment depuis « Mes connexions ».
          </p>
        </div>
      </Modal>
    </div>
  );
}
