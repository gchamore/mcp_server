import { api } from '../../lib/api';
import { Badge, EmptyState, Spinner } from '../../components/ui';
import { IconInbox } from '../../components/icons';
import { formatDateTime, formatNumber, formatPercent, timeAgo } from '../../lib/format';
import { useQuery } from '@tanstack/react-query';
import { Stat } from './Stat';

/** Vue d'ensemble : les chiffres qui disent si la plateforme est vivante. */
export function Overview() {
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
