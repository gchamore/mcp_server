import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, connectorOAuthUrl } from '../lib/api';
import { useAuth } from '../state/auth';
import { useToast } from '../components/Toast';
import { Alert, Badge, Button, Spinner } from '../components/ui';
import { CredentialForm } from '../components/CredentialForm';
import type { McpAccessMode } from '../lib/types';

/**
 * ===========================================================================
 *  Écran de consentement MCP
 * ===========================================================================
 *
 * C'est l'unique page que voit l'utilisateur lorsqu'il colle une URL MCP dans
 * Claude, Dust ou ChatGPT. Le client IA a déjà tout découvert et s'est
 * enregistré tout seul ; il ne reste qu'à dire oui, et à indiquer quel compte
 * utiliser.
 *
 * Quand le connecteur repose sur OAuth (Gmail…) et que l'utilisateur n'a pas
 * encore raccordé son compte, on enchaîne directement sur le fournisseur puis
 * on revient ici : de son point de vue, c'est un seul parcours.
 */
export function Consent() {
  const [searchParams] = useSearchParams();
  const demande = searchParams.get('demande') ?? '';
  const { user, isLoading: authLoading } = useAuth();
  const toast = useToast();

  const [mode, setMode] = useState<McpAccessMode>('INDIVIDUAL');
  const [connectionId, setConnectionId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [showCredentialForm, setShowCredentialForm] = useState(false);
  /**
   * Renseigné uniquement lorsque le client IA n'a pas transmis d'indicateur de
   * ressource : l'utilisateur désigne alors lui-même le service à autoriser.
   */
  const [pickedConnectorId, setPickedConnectorId] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['oauth', 'authorization', demande, pickedConnectorId],
    queryFn: () => api.oauth.authorization(demande, pickedConnectorId || undefined),
    enabled: Boolean(demande) && Boolean(user),
    retry: false,
  });

  // Le mode et le compte sélectionné se déduisent de la réponse serveur.
  useEffect(() => {
    if (!data) return;
    if (data.establishedMode) setMode(data.establishedMode);
    const preselected = searchParams.get('compte') ?? data.connections[0]?.id ?? '';
    setConnectionId((current) => current || preselected);
  }, [data, searchParams]);

  if (!demande) {
    return (
      <Shell>
        <Alert tone="danger">
          Demande d’autorisation absente. Relancez la connexion depuis votre client IA.
        </Alert>
      </Shell>
    );
  }

  if (authLoading) return <Shell><Spinner /></Shell>;

  // Non connecté : on passe par la page de connexion et on revient ici.
  if (!user) {
    const returnTo = `/autoriser?demande=${encodeURIComponent(demande)}`;
    return <Navigate to={`/connexion?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  if (isLoading) return <Shell><Spinner /></Shell>;

  if (error || !data) {
    return (
      <Shell>
        <Alert tone="danger">
          {error instanceof ApiError ? error.message : 'Demande d’autorisation illisible ou expirée.'}
        </Alert>
      </Shell>
    );
  }

  const submitDeny = async () => {
    try {
      const result = await api.oauth.deny(demande);
      window.location.href = result.redirectTo;
    } catch {
      toast.error('Impossible d’annuler la demande.');
    }
  };

  // Le client n'a pas dit quel service il veut : on le demande.
  if (!data.connector) {
    return (
      <Shell>
        <div className="stack">
          <div className="stack stack--tight">
            <h1 style={{ fontSize: '1.35rem' }}>Quel service autoriser ?</h1>
            <p className="text-muted text-sm">
              <strong>{data.client.name}</strong> demande un accès sans préciser lequel. Choisissez
              le service à connecter.
            </p>
          </div>

          <div className="stack stack--tight">
            {data.selectableConnectors.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="option"
                onClick={() => setPickedConnectorId(entry.id)}
              >
                <span className="row" style={{ gap: 'var(--s3)', flexWrap: 'nowrap' }}>
                  <img className="connector-icon" src={entry.icon} alt="" />
                  <span className="stack stack--tight">
                    <span className="option__title">{entry.name}</span>
                    <span className="option__desc">{entry.tagline}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="row row--end">
            <Button variant="ghost" onClick={() => void submitDeny()}>
              Annuler
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  const { connector } = data;
  const sharedLocked = data.establishedMode === 'SHARED' && !data.isOwner;
  const needsAccount = !sharedLocked && !connectionId;

  const submit = async (decision: 'approve' | 'deny') => {
    setSubmitting(true);
    try {
      const result =
        decision === 'deny'
          ? await api.oauth.deny(demande)
          : await api.oauth.approve({
              demande,
              ...(data.establishedMode && !data.isOwner ? {} : { mode }),
              ...(connectionId ? { connectionId } : {}),
              ...(pickedConnectorId ? { connectorId: pickedConnectorId } : {}),
            });

      // Retour vers le client IA : navigation complète, ce n'est pas notre domaine.
      window.location.href = result.redirectTo;
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Autorisation impossible.');
      setSubmitting(false);
    }
  };

  return (
    <Shell>
      <div className="stack">
        <div className="row" style={{ gap: 'var(--s3)', alignItems: 'flex-start' }}>
          <img className="connector-icon connector-icon--lg" src={connector.icon} alt="" />
          <div className="stack stack--tight">
            <h1 style={{ fontSize: '1.35rem' }}>
              Autoriser {data.client.name}
            </h1>
            <p className="text-muted text-sm">
              <strong>{data.client.name}</strong> demande l’accès à vos outils{' '}
              <strong>{connector.name}</strong> via MCP Wesype.
            </p>
          </div>
        </div>

        <section className="card stack stack--tight">
          <strong className="text-sm">Ce que cette application pourra faire</strong>
          <ul className="stack stack--tight" style={{ paddingInlineStart: '1.1rem', margin: 0 }}>
            {connector.tools.slice(0, 6).map((tool) => (
              <li key={tool.name} className="text-sm">
                {tool.title}{' '}
                {!tool.readOnly && <Badge tone="warning">écriture</Badge>}
              </li>
            ))}
          </ul>
          {connector.tools.length > 6 && (
            <span className="text-xs text-muted">
              …et {connector.tools.length - 6} autre(s) outil(s).
            </span>
          )}
        </section>

        {!data.connectorAvailable && (
          <Alert tone="danger">
            {connector.unavailableReason ??
              'Ce connecteur n’est pas disponible sur ce serveur pour le moment.'}
          </Alert>
        )}

        {/* Choix du mode : uniquement à la première configuration, ou par son auteur. */}
        {data.connectorAvailable && (data.establishedMode === null || data.isOwner) ? (
          <section className="stack stack--tight">
            <strong className="text-sm">Qui utilisera ce compte ?</strong>
            <ModeOption
              selected={mode === 'INDIVIDUAL'}
              onSelect={() => setMode('INDIVIDUAL')}
              title="Compte individuel"
              description="Chaque personne connecte son propre compte. Les actions sont réalisées en son nom."
            />
            <ModeOption
              selected={mode === 'SHARED'}
              onSelect={() => setMode('SHARED')}
              title="Compte partagé"
              description="Tout le monde passe par le compte que vous choisissez ici. Pratique pour une boîte générique, mais toutes les actions lui seront attribuées."
            />
          </section>
        ) : (
          data.establishedMode && (
            <Alert tone="info">
              Ce serveur a été configuré en mode{' '}
              <strong>
                {data.establishedMode === 'SHARED' ? 'compte partagé' : 'compte individuel'}
              </strong>{' '}
              par la personne qui l’a mis en place.
            </Alert>
          )
        )}

        {/* Sélection du compte à utiliser. */}
        {data.connectorAvailable && !sharedLocked && (
          <section className="stack stack--tight">
            <strong className="text-sm">Compte {connector.name} à utiliser</strong>

            {data.connections.length > 0 && (
              <div className="stack stack--tight">
                {data.connections.map((connection) => (
                  <ModeOption
                    key={connection.id}
                    selected={connectionId === connection.id}
                    onSelect={() => setConnectionId(connection.id)}
                    title={connection.label}
                    description={connection.accountLabel ?? 'Compte raccordé'}
                  />
                ))}
              </div>
            )}

            {/* Chaînage : connecteur OAuth non encore raccordé. */}
            {connector.auth.type === 'oauth2' ? (
              <a
                className="btn btn--secondary"
                href={connectorOAuthUrl(connector.id, {
                  returnTo: `/autoriser?demande=${encodeURIComponent(demande)}`,
                  label: data.connections.length === 0 ? 'Compte principal' : `Compte ${data.connections.length + 1}`,
                })}
              >
                {data.connections.length === 0
                  ? `Connecter mon compte ${connector.name}`
                  : `Connecter un autre compte ${connector.name}`}
              </a>
            ) : showCredentialForm ? (
              <div className="card">
                <CredentialForm
                  connector={connector}
                  submitLabel="Enregistrer ce compte"
                  onCancel={() => setShowCredentialForm(false)}
                  onSubmit={async (credentials) => {
                    try {
                      const created = await api.connections.create({
                        connectorId: connector.id,
                        label:
                          data.connections.length === 0
                            ? 'Compte principal'
                            : `Compte ${data.connections.length + 1}`,
                        credentials,
                      });
                      setConnectionId(created.connection.id);
                      setShowCredentialForm(false);
                      await refetch();
                    } catch (caught) {
                      toast.error(
                        caught instanceof ApiError ? caught.message : 'Enregistrement impossible.',
                      );
                    }
                  }}
                />
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setShowCredentialForm(true)}>
                {data.connections.length === 0
                  ? `Ajouter ma clé API ${connector.name}`
                  : 'Ajouter un autre compte'}
              </Button>
            )}
          </section>
        )}

        {sharedLocked && data.sharedConnection && (
          <Alert tone="info">
            Vous utiliserez le compte partagé <strong>{data.sharedConnection.label}</strong>
            {data.sharedConnection.accountLabel ? ` (${data.sharedConnection.accountLabel})` : ''}.
          </Alert>
        )}

        {data.scopes.length > 0 && (
          <details className="text-sm">
            <summary className="text-muted" style={{ cursor: 'pointer' }}>
              Autorisations demandées à {connector.name}
            </summary>
            <ul className="text-xs mono" style={{ marginTop: 'var(--s2)' }}>
              {data.scopes.map((scope) => (
                <li key={scope}>{scope}</li>
              ))}
            </ul>
          </details>
        )}

        <p className="text-xs text-muted">
          Vous pourrez révoquer cet accès à tout moment depuis « Mes connexions ». MCP Wesype ne
          transmet vos identifiants à aucun tiers : {data.client.name} reçoit uniquement un jeton
          limité à ce connecteur.
        </p>

        <div className="row row--end">
          <Button variant="ghost" onClick={() => void submit('deny')} disabled={submitting}>
            Refuser
          </Button>
          <Button
            variant="primary"
            loading={submitting}
            disabled={!data.connectorAvailable || needsAccount}
            onClick={() => void submit('approve')}
          >
            Autoriser
          </Button>
        </div>

        {needsAccount && data.connectorAvailable && (
          <p className="text-xs text-muted" style={{ textAlign: 'right' }}>
            Raccordez d’abord un compte {connector.name} pour pouvoir autoriser.
          </p>
        )}
      </div>
    </Shell>
  );
}

function ModeOption({
  selected,
  onSelect,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <button type="button" className="option" aria-pressed={selected} onClick={onSelect}>
      <span className="option__title">
        <span className="option__marker" aria-hidden="true">
          {selected ? '◉' : '○'}
        </span>
        {title}
      </span>
      <span className="option__desc">{description}</span>
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-layout">
      <div className="auth-card" style={{ width: 'min(520px, 100%)' }}>
        {children}
      </div>
    </div>
  );
}
