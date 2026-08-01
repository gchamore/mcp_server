import { api, ApiError } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { Badge, Button, Input, Spinner } from '../../components/ui';
import { IconSearch } from '../../components/icons';
import { formatNumber, timeAgo } from '../../lib/format';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export function Users() {
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
