import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { CredentialForm } from '../components/CredentialForm';
import { useToast } from '../components/Toast';
import {
  Alert,
  Button,
  ConfirmDialog,
  ConnectionBadge,
  CopyField,
  EmptyState,
  Modal,
  Spinner,
} from '../components/ui';
import { formatDateTime, pluralize, timeAgo } from '../lib/format';
import type { Connection } from '../lib/types';

/** Tableau de bord des connexions de l'utilisateur et de leurs points d'accès MCP. */
export function Connections() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['connections'], queryFn: api.connections.list });

  const connections = data?.connections ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['connections'] });

  if (isLoading) return <Spinner />;

  return (
    <div className="stack stack--loose">
      <div className="page-header">
        <div className="page-header__title">
          <h1>Mes connexions</h1>
          <p>
            Chaque connexion relie un de vos comptes à un ou plusieurs points d’accès MCP. Un point
            d’accès peut être révoqué sans toucher aux autres.
          </p>
        </div>
        <Link to="/catalogue" className="btn btn--primary">
          Ajouter un connecteur
        </Link>
      </div>

      {connections.length === 0 ? (
        <EmptyState
          icon="🔌"
          title="Aucune connexion pour l’instant"
          description="Parcourez le catalogue et branchez votre premier outil métier."
          action={
            <Link to="/catalogue" className="btn btn--primary">
              Voir le catalogue
            </Link>
          }
        />
      ) : (
        <div className="stack stack--loose">
          {connections.map((connection) => (
            <ConnectionCard key={connection.id} connection={connection} onChange={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectionCard({
  connection,
  onChange,
}: {
  connection: Connection;
  onChange: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [revealed, setRevealed] = useState<{ id: string; url: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleError = (error: unknown, fallback: string) => {
    if (error instanceof ApiError) {
      setFieldErrors(error.fields);
      toast.error(error.message);
      return;
    }
    toast.error(fallback);
  };

  const verifyMutation = useMutation({
    mutationFn: () => api.connections.verify(connection.id),
    onSuccess: ({ connection: updated }) => {
      onChange();
      if (updated.status === 'ACTIVE') toast.success('Connexion opérationnelle.');
      else toast.error(updated.statusMessage ?? 'La vérification a échoué.');
    },
    onError: (error) => handleError(error, 'Vérification impossible.'),
  });

  const updateMutation = useMutation({
    mutationFn: (credentials: Record<string, string>) =>
      api.connections.update(connection.id, { credentials }),
    onSuccess: ({ connection: updated }) => {
      setEditing(false);
      setFieldErrors({});
      onChange();
      if (updated.status === 'ACTIVE') toast.success('Identifiants mis à jour.');
      else toast.error(updated.statusMessage ?? 'Identifiants refusés par le service.');
    },
    onError: (error) => handleError(error, 'Mise à jour impossible.'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.connections.remove(connection.id),
    onSuccess: () => {
      setConfirmDelete(false);
      onChange();
      toast.success('Connexion supprimée.');
    },
    onError: (error) => handleError(error, 'Suppression impossible.'),
  });

  const addEndpointMutation = useMutation({
    mutationFn: () => api.connections.addEndpoint(connection.id, 'Point d’accès'),
    onSuccess: ({ endpoint, url }) => {
      onChange();
      setRevealed({ id: endpoint.id, url });
    },
    onError: (error) => handleError(error, 'Création du point d’accès impossible.'),
  });

  const revokeEndpointMutation = useMutation({
    mutationFn: (endpointId: string) => api.connections.removeEndpoint(connection.id, endpointId),
    onSuccess: () => {
      onChange();
      toast.success('Point d’accès révoqué.');
    },
    onError: (error) => handleError(error, 'Révocation impossible.'),
  });

  const reveal = async (endpointId: string) => {
    try {
      const { url } = await api.connections.revealEndpoint(connection.id, endpointId);
      setRevealed({ id: endpointId, url });
    } catch (error) {
      handleError(error, 'Impossible d’afficher l’URL.');
    }
  };

  return (
    <article className="card stack">
      <div className="row row--between" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 'var(--s3)', alignItems: 'flex-start' }}>
          <img className="connector-icon" src={connection.connector.icon} alt="" />
          <div className="stack stack--tight">
            <div className="row" style={{ gap: 'var(--s2)' }}>
              <strong>{connection.connector.name}</strong>
              <span className="text-muted">·</span>
              <span className="text-muted">{connection.label}</span>
              <ConnectionBadge status={connection.status} />
            </div>
            <span className="text-sm text-muted">
              {connection.accountLabel ?? 'Compte connecté'} · vérifiée{' '}
              {timeAgo(connection.lastVerifiedAt)} · dernier appel {timeAgo(connection.lastUsedAt)}
            </span>
          </div>
        </div>

        <div className="row">
          <Button size="sm" onClick={() => verifyMutation.mutate()} loading={verifyMutation.isPending}>
            Vérifier
          </Button>
          <Button size="sm" onClick={() => setEditing(true)}>
            Modifier les identifiants
          </Button>
          <Button size="sm" variant="danger-ghost" onClick={() => setConfirmDelete(true)}>
            Supprimer
          </Button>
        </div>
      </div>

      {connection.status === 'ERROR' && connection.statusMessage && (
        <Alert tone="danger">{connection.statusMessage}</Alert>
      )}

      <div className="stack stack--tight">
        <div className="row row--between">
          <strong className="text-sm">
            Points d’accès MCP ({connection.endpoints.length})
          </strong>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => addEndpointMutation.mutate()}
            loading={addEndpointMutation.isPending}
          >
            + Nouveau point d’accès
          </Button>
        </div>

        {connection.endpoints.length === 0 ? (
          <p className="text-sm text-muted">
            Aucun point d’accès actif. Créez-en un pour obtenir une URL MCP.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Token</th>
                  <th>Appels</th>
                  <th>Dernier usage</th>
                  <th>Créé le</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {connection.endpoints.map((endpoint) => (
                  <tr key={endpoint.id}>
                    <td>{endpoint.name}</td>
                    <td className="mono text-xs">…{endpoint.tokenHint}</td>
                    <td>{endpoint.callCount}</td>
                    <td className="text-sm text-muted">{timeAgo(endpoint.lastUsedAt)}</td>
                    <td className="text-sm text-muted">{formatDateTime(endpoint.createdAt)}</td>
                    <td>
                      <div className="row row--end">
                        <Button size="sm" variant="ghost" onClick={() => void reveal(endpoint.id)}>
                          Révéler l’URL
                        </Button>
                        <Button
                          size="sm"
                          variant="danger-ghost"
                          onClick={() => revokeEndpointMutation.mutate(endpoint.id)}
                        >
                          Révoquer
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <details className="text-sm">
        <summary className="text-muted" style={{ cursor: 'pointer' }}>
          Identifiants enregistrés et outils disponibles
        </summary>
        <div className="stack" style={{ marginTop: 'var(--s3)' }}>
          <ul className="stack stack--tight" style={{ listStyle: 'none', padding: 0 }}>
            {connection.credentials.map((credential) => (
              <li key={credential.key} className="row row--between">
                <span className="text-muted">{credential.label}</span>
                <span className="mono text-xs">
                  {credential.filled ? credential.preview : 'non renseigné'}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted">
            {pluralize(connection.connector.toolCount, 'outil')} exposés —{' '}
            <Link to={`/catalogue/${connection.connectorId}`}>voir le détail</Link>
          </p>
        </div>
      </details>

      <Modal
        open={editing}
        title={`Modifier les identifiants — ${connection.connector.name}`}
        onClose={() => setEditing(false)}
      >
        <CredentialForm
          connector={connection.connector}
          submitLabel="Enregistrer"
          loading={updateMutation.isPending}
          serverErrors={fieldErrors}
          onSubmit={(credentials) => updateMutation.mutate(credentials)}
          onCancel={() => setEditing(false)}
        />
      </Modal>

      <Modal
        open={revealed !== null}
        title="URL du serveur MCP"
        wide
        onClose={() => setRevealed(null)}
      >
        <div className="stack">
          {revealed && <CopyField value={revealed.url} label="À coller dans votre assistant IA" />}
          <p className="text-sm text-muted">
            Cette URL contient un secret équivalent à un mot de passe. Si elle a fuité, révoquez le
            point d’accès et créez-en un nouveau.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Supprimer cette connexion ?"
        confirmLabel="Supprimer définitivement"
        loading={deleteMutation.isPending}
        message={
          <>
            Les identifiants {connection.connector.name} et{' '}
            {pluralize(connection.endpoints.length, 'point d’accès')} seront supprimés. Les
            assistants qui utilisent ces URLs cesseront immédiatement de fonctionner.
          </>
        }
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </article>
  );
}
