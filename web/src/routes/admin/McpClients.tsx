import { api, ApiError } from '../../lib/api';
import { useToast } from '../../components/Toast';
import {
  Alert,
  Badge,
  Button,
  CopyField,
  EmptyState,
  Field,
  Input,
  Modal,
  Spinner,
} from '../../components/ui';
import { IconLink, IconTrash } from '../../components/icons';
import { timeAgo } from '../../lib/format';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Clients MCP connectés à la plateforme.
 *
 * Deux origines : ceux qui se sont enregistrés seuls (mode « Automatic »), et
 * ceux créés à la main ici pour les outils qui exigent un identifiant et un
 * secret fournis à l'avance — c'est le mode « Static OAuth » de Dust.
 */
export function McpClients() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{
    clientId: string;
    clientSecret: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    scopes: string;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'mcp-clients'],
    queryFn: api.admin.mcpClients,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.admin.createMcpClient({
        name,
        redirectUris: data?.dustRedirectUris ?? [],
      }),
    onSuccess: async (result) => {
      setCreated(result);
      setCreating(false);
      setName('');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'mcp-clients'] });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Création impossible.'),
  });

  const deleteMutation = useMutation({
    mutationFn: api.admin.deleteMcpClient,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'mcp-clients'] });
      toast.success('Client révoqué. Ses jetons sont invalidés.');
    },
  });

  const purgeMutation = useMutation({
    mutationFn: api.admin.purgeMcpClients,
    onSuccess: async ({ removed }) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'mcp-clients'] });
      toast.success(
        removed === 0
          ? 'Aucune inscription abandonnée à retirer.'
          : `${removed} inscription(s) abandonnée(s) retirée(s).`,
      );
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Purge impossible.'),
  });

  /**
   * Inscriptions sans aucun jeton et jamais utilisées.
   *
   * Chaque tentative d'ajout d'un serveur MCP en crée une, y compris celles qui
   * échouent — et aucune plateforme ne les supprime en retirant le serveur de
   * son côté. Les compter permet de proposer le ménage au bon moment, plutôt
   * que d'afficher un bouton qui ne servirait à rien.
   */
  const abandonnees =
    data?.clients.filter(
      (client) => !client.isStatic && client._count.tokens === 0 && !client.lastUsedAt,
    ).length ?? 0;

  if (isLoading) return <Spinner />;

  return (
    <div className="stack">
      <div className="row row--between">
        <p className="text-sm text-muted" style={{ maxWidth: '62ch' }}>
          La plupart des clients s’enregistrent seuls en découvrant l’URL d’un connecteur. Créez un
          client statique uniquement pour un outil qui réclame un identifiant et un secret à saisir
          manuellement.
        </p>
        <div className="row" style={{ gap: 'var(--s3)' }}>
          {abandonnees > 0 && (
            <Button
              variant="secondary"
              loading={purgeMutation.isPending}
              onClick={() => purgeMutation.mutate()}
            >
              <IconTrash size={14} />
              Purger {abandonnees} inscription(s) inutilisée(s)
            </Button>
          )}
          <Button variant="primary" onClick={() => setCreating(true)}>
            Créer un client statique
          </Button>
        </div>
      </div>

      <Alert tone="info">
        Retirer un serveur MCP dans Dust ou Claude <strong>ne nous en informe pas</strong> : la
        spécification prévoit bien un moyen pour un client de supprimer son inscription, mais aucune
        plateforme ne l’utilise. Les lignes sans jeton sont des tentatives abandonnées, sans effet ;
        celles qui portent des jetons donnent un accès réel, à révoquer explicitement.
      </Alert>

      {(data?.clients.length ?? 0) === 0 ? (
        <EmptyState
          icon={<IconLink size={22} />}
          title="Aucun client connecté"
          description="Collez l’URL d’un connecteur dans Claude ou Dust : le client apparaîtra ici après son premier enregistrement."
        />
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Origine</th>
                <th>Connecteurs autorisés</th>
                <th>Jetons</th>
                <th>Dernier usage</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data?.clients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <div className="stack stack--tight">
                      <strong>{client.name}</strong>
                      <span className="text-xs text-muted mono">{client.clientId}</span>
                    </div>
                  </td>
                  <td>
                    <Badge tone={client.isStatic ? 'warning' : 'success'}>
                      {client.isStatic ? 'statique' : 'automatique'}
                    </Badge>
                  </td>
                  <td className="text-sm">
                    {client.accesses.length === 0
                      ? '—'
                      : client.accesses
                          .map((access) => `${access.connectorId} · ${access.owner.email}`)
                          .join(', ')}
                  </td>
                  <td>{client._count.tokens}</td>
                  <td className="text-sm text-muted">{timeAgo(client.lastUsedAt)}</td>
                  <td>
                    <div className="row row--end">
                      <Button
                        size="sm"
                        variant="danger-ghost"
                        onClick={() => deleteMutation.mutate(client.id)}
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

      <Modal
        open={creating}
        title="Créer un client statique"
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              loading={createMutation.isPending}
              disabled={name.trim().length === 0}
              onClick={() => createMutation.mutate()}
            >
              Créer
            </Button>
          </>
        }
      >
        <div className="stack">
          <Field label="Nom du client" required help="Par exemple « Dust — espace Toolink ».">
            {(props) => (
              <Input {...props} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
          <div className="stack stack--tight">
            <span className="field__label">URI de redirection autorisées</span>
            <ul className="text-xs mono text-muted">
              {data?.dustRedirectUris.map((uri) => (
                <li key={uri}>{uri}</li>
              ))}
            </ul>
            <span className="field__help">
              Ce sont les adresses de rappel documentées par Dust pour le mode « Static OAuth ».
            </span>
          </div>
        </div>
      </Modal>

      <Modal
        open={created !== null}
        title="Client créé"
        wide
        onClose={() => setCreated(null)}
        footer={
          <Button variant="primary" onClick={() => setCreated(null)}>
            J’ai noté ces informations
          </Button>
        }
      >
        {created && (
          <div className="stack">
            <Alert tone="warning">
              Le secret n’est affiché qu’une seule fois. Copiez-le maintenant.
            </Alert>
            <CopyField value={created.clientId} label="Client ID" />
            <CopyField value={created.clientSecret} label="Client Secret" />
            <CopyField value={created.authorizationEndpoint} label="OAuth Authorization Endpoint" />
            <CopyField value={created.tokenEndpoint} label="OAuth Token Endpoint" />
            <CopyField value={created.scopes} label="OAuth scopes" />
          </div>
        )}
      </Modal>
    </div>
  );
}
