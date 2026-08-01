import { api } from '../../lib/api';
import { Badge, EmptyState, Spinner } from '../../components/ui';
import { IconChart } from '../../components/icons';
import { formatNumber } from '../../lib/format';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

export function Usage() {
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
