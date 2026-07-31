import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useToast } from '../components/Toast';
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
} from '../components/ui';
import { IconChart, IconInbox, IconLink, IconSearch, IconTrash } from '../components/icons';
import { formatDateTime, formatNumber, formatPercent, timeAgo } from '../lib/format';

/** Panneau d'administration : usage de la plateforme et gestion des comptes. */
export function Admin() {
  const [tab, setTab] = useState<'overview' | 'users' | 'usage' | 'clients'>('overview');

  return (
    <div className="stack stack--loose">
      <div className="page-header">
        <div className="page-header__title">
          <h1>Administration</h1>
          <p>Vue d’ensemble de la plateforme, comptes utilisateurs et usage des connecteurs.</p>
        </div>
      </div>

      <div className="chips" role="tablist" aria-label="Sections d’administration">
        {(
          [
            ['overview', "Vue d'ensemble"],
            ['users', 'Utilisateurs'],
            ['usage', 'Usage des outils'],
            ['clients', 'Clients MCP'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="chip"
            aria-pressed={tab === id}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview />}
      {tab === 'users' && <Users />}
      {tab === 'usage' && <Usage />}
      {tab === 'clients' && <McpClients />}
    </div>
  );
}

/**
 * Clients MCP connectés à la plateforme.
 *
 * Deux origines : ceux qui se sont enregistrés seuls (mode « Automatic »), et
 * ceux créés à la main ici pour les outils qui exigent un identifiant et un
 * secret fournis à l'avance — c'est le mode « Static OAuth » de Dust.
 */
function McpClients() {
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
          La plupart des clients s’enregistrent seuls en découvrant l’URL d’un connecteur.
          Créez un client statique uniquement pour un outil qui réclame un identifiant et un
          secret à saisir manuellement.
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
          <Field label="Nom du client" required help="Par exemple « Dust — espace Wesype ».">
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

function Overview() {
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'overview'], queryFn: api.admin.overview });

  if (isLoading) return <Spinner />;
  if (!data) return null;

  return (
    <div className="stack stack--loose">
      <div className="grid grid--stats">
        <Stat label="Utilisateurs" value={formatNumber(data.totals.users)} hint={`${formatNumber(data.totals.activeUsers)} actifs sur 7 jours`} />
        <Stat label="Connexions" value={formatNumber(data.totals.connections)} />
        <Stat label="Points d’accès" value={formatNumber(data.totals.endpoints)} hint="non révoqués" />
        <Stat label="Connecteurs" value={formatNumber(data.totals.connectors)} hint="au catalogue" />
        <Stat
          label="Appels d’outils"
          value={formatNumber(data.calls.total)}
          hint={`${formatPercent(data.calls.successRate)} de succès sur 7 jours`}
        />
      </div>

      <section className="stack">
        <h2>Connecteurs</h2>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Connecteur</th>
                <th>Statut</th>
                <th>Outils</th>
                <th>Appels (7 j.)</th>
              </tr>
            </thead>
            <tbody>
              {data.connectors.map((connector) => (
                <tr key={connector.id}>
                  <td>
                    <strong>{connector.name}</strong>{' '}
                    <span className="mono text-xs text-muted">{connector.id}</span>
                  </td>
                  <td>
                    <Badge tone={connector.status === 'stable' ? 'success' : 'info'}>
                      {connector.status}
                    </Badge>
                  </td>
                  <td>{connector.tools}</td>
                  <td>{formatNumber(connector.calls)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack">
        <h2>Activité récente</h2>
        {data.recentActivity.length === 0 ? (
          <EmptyState icon={<IconInbox size={22} />} title="Aucune activité enregistrée" />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Utilisateur</th>
                  <th>Quand</th>
                </tr>
              </thead>
              <tbody>
                {data.recentActivity.map((entry) => (
                  <tr key={entry.id}>
                    <td className="mono text-xs">{entry.action}</td>
                    <td className="text-sm">{entry.user?.email ?? '—'}</td>
                    <td className="text-sm text-muted" title={formatDateTime(entry.createdAt)}>
                      {timeAgo(entry.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Users() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', { search, page }],
    queryFn: () => api.admin.users({ q: search, page }),
    placeholderData: (previous) => previous,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: 'USER' | 'ADMIN'; isActive?: boolean }) =>
      api.admin.updateUser(id, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      toast.success('Utilisateur mis à jour.');
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Mise à jour impossible.');
    },
  });

  return (
    <div className="stack">
      <div className="search" style={{ maxWidth: '360px' }}>
        <span className="search__icon" aria-hidden="true">
          <IconSearch size={15} />
        </span>
        <Input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Rechercher par e-mail ou nom…"
          aria-label="Rechercher un utilisateur"
        />
      </div>

      {isLoading ? (
        <Spinner />
      ) : (
        <>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Utilisateur</th>
                  <th>Rôle</th>
                  <th>Connexions</th>
                  <th>Dernière connexion</th>
                  <th>Statut</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data?.users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="stack stack--tight">
                        <strong>{[user.firstName, user.lastName].filter(Boolean).join(' ') || '—'}</strong>
                        <span className="text-xs text-muted mono">{user.email}</span>
                      </div>
                    </td>
                    <td>
                      <Badge tone={user.role === 'ADMIN' ? 'info' : 'neutral'}>{user.role}</Badge>
                    </td>
                    <td>{user._count.connections}</td>
                    <td className="text-sm text-muted">{timeAgo(user.lastLoginAt)}</td>
                    <td>
                      <Badge tone={user.isActive ? 'success' : 'danger'}>
                        {user.isActive ? 'Actif' : 'Désactivé'}
                      </Badge>
                    </td>
                    <td>
                      <div className="row row--end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            updateMutation.mutate({
                              id: user.id,
                              role: user.role === 'ADMIN' ? 'USER' : 'ADMIN',
                            })
                          }
                        >
                          {user.role === 'ADMIN' ? 'Retirer admin' : 'Passer admin'}
                        </Button>
                        <Button
                          size="sm"
                          variant={user.isActive ? 'danger-ghost' : 'ghost'}
                          onClick={() =>
                            updateMutation.mutate({ id: user.id, isActive: !user.isActive })
                          }
                        >
                          {user.isActive ? 'Désactiver' : 'Réactiver'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data && data.pages > 1 && (
            <div className="row row--between">
              <span className="text-sm text-muted">
                Page {data.page} sur {data.pages} — {formatNumber(data.total)} utilisateurs
              </span>
              <div className="row">
                <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Précédent
                </Button>
                <Button
                  size="sm"
                  disabled={page >= data.pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Suivant
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Usage() {
  const [days, setDays] = useState(7);
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'usage', days],
    queryFn: () => api.admin.usage(days),
  });

  return (
    <div className="stack">
      <div className="chips">
        {[1, 7, 30].map((value) => (
          <button
            key={value}
            type="button"
            className="chip"
            aria-pressed={days === value}
            onClick={() => setDays(value)}
          >
            {value === 1 ? '24 heures' : `${value} jours`}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Spinner />
      ) : !data || data.tools.length === 0 ? (
        <EmptyState
          icon={<IconChart size={22} />}
          title="Aucun appel sur la période"
          description="Les statistiques apparaîtront dès qu’un assistant utilisera un outil."
        />
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Connecteur</th>
                <th>Outil</th>
                <th>Appels</th>
                <th>Échecs</th>
                <th>Durée moyenne</th>
              </tr>
            </thead>
            <tbody>
              {data.tools.map((tool) => (
                <tr key={`${tool.connectorId}-${tool.toolName}`}>
                  <td>{tool.connectorId}</td>
                  <td className="mono text-xs">{tool.toolName}</td>
                  <td>{formatNumber(tool.calls)}</td>
                  <td>
                    {tool.failures > 0 ? (
                      <Badge tone="danger">{formatNumber(tool.failures)}</Badge>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td className="text-sm text-muted">{tool.avgMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {hint && <div className="stat__hint">{hint}</div>}
    </div>
  );
}
