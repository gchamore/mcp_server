import { useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, connectorOAuthUrl } from '../lib/api';
import { useAuth } from '../state/auth';
import { useToast } from '../components/Toast';
import { Alert, Badge, Button, Input, Spinner } from '../components/ui';
import { CredentialForm } from '../components/CredentialForm';
import { IconArrowRight, IconCheck, IconSearch } from '../components/icons';

/**
 * ===========================================================================
 *  Écran de consentement MCP
 * ===========================================================================
 *
 * L'unique page que voit l'utilisateur lorsqu'il colle une URL MCP dans Claude,
 * Dust ou ChatGPT. Le client IA a déjà tout découvert et s'est enregistré tout
 * seul ; il ne reste qu'à dire oui.
 *
 * ---------------------------------------------------------------------------
 * Une seule décision
 * ---------------------------------------------------------------------------
 *
 * Cet écran demandait auparavant « compte individuel ou partagé ». C'était une
 * question de trop : les plateformes IA la posent déjà au moment où l'on colle
 * l'URL — Dust parle de « Personal » et « Shared credentials » — et en tirent
 * elles-mêmes les conséquences. Rien n'empêchait de répondre l'inverse ici, et
 * les deux modèles se contredisaient en silence.
 *
 * Il ne reste donc qu'une chose à faire : autoriser, ou refuser.
 *
 * ---------------------------------------------------------------------------
 * Deux situations, deux formes
 * ---------------------------------------------------------------------------
 *
 * 1. Aucun compte raccordé, connecteur OAuth → le bouton principal *est* le
 *    départ vers le fournisseur. On voit qui demande quoi, on clique une fois,
 *    et Google prend le relais. Au retour, l'autorisation est accordée sans
 *    redemander : le clic initial valait consentement.
 *
 * 2. Un compte déjà raccordé → un simple « Autoriser ». Le choix du compte
 *    n'apparaît que s'il y en a plusieurs — poser une question à une seule
 *    réponse possible n'informe personne.
 */
export function Consent() {
  const [searchParams] = useSearchParams();
  const demande = searchParams.get('demande') ?? '';
  const { user, isLoading: authLoading } = useAuth();
  const toast = useToast();

  const [connectionChoice, setConnectionChoice] = useState<string | null>(null);
  /**
   * Sélecteur du hub.
   *
   * `null` tant que l'utilisateur n'a rien touché : l'état initial est alors
   * déduit de la réponse serveur (tout coché) au moment du rendu, sans effet.
   * `outilsExclus` liste les outils décochés — le cas rare — plutôt que les
   * cochés : l'absence d'entrée signifie « tous », ce qui est aussi la
   * convention du serveur.
   */
  const [servicesCoches, setServicesCoches] = useState<Record<string, boolean> | null>(null);
  const [outilsExclus, setOutilsExclus] = useState<Record<string, string[]>>({});
  /** Mono-connecteur : outils décochés. L'absence = tous, comme au serveur. */
  const [exclusMono, setExclusMono] = useState<Set<string>>(new Set());
  const [recherche, setRecherche] = useState('');
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

  /** Compte retenu : celui choisi, celui d'où l'on revient, sinon le premier. */
  const connectionId =
    connectionChoice ?? searchParams.get('compte') ?? data?.connections[0]?.id ?? '';

  /** Cochage effectif d'un service : choix de l'utilisateur, sinon tout coché. */
  const estCoche = (id: string): boolean => servicesCoches?.[id] ?? true;

  const basculerService = (id: string) =>
    setServicesCoches((courant) => {
      const base: Record<string, boolean> = { ...(courant ?? {}) };
      for (const c of data?.connections ?? []) base[c.id] = base[c.id] ?? true;
      base[id] = !(base[id] ?? true);
      return base;
    });

  const basculerOutil = (connectionId: string, tool: string) =>
    setOutilsExclus((courant) => {
      const exclus = new Set(courant[connectionId] ?? []);
      if (exclus.has(tool)) exclus.delete(tool);
      else exclus.add(tool);
      return { ...courant, [connectionId]: [...exclus] };
    });

  /**
   * Préréglage « Recommandés » : la lecture seule. C'est le réglage sûr — un
   * hub qui ne peut rien écrire ne peut rien abîmer — et le critère est porté
   * par les connecteurs eux-mêmes (annotation readOnlyHint), pas par une liste
   * à maintenir ici.
   */
  const preregler = (mode: 'tout' | 'lecture' | 'rien') => {
    const services: Record<string, boolean> = {};
    const exclus: Record<string, string[]> = {};
    for (const connexion of data?.connections ?? []) {
      const outils = connexion.tools ?? [];
      if (mode === 'rien') {
        services[connexion.id] = false;
        continue;
      }
      if (mode === 'tout') {
        services[connexion.id] = true;
        continue;
      }
      const lecture = outils.filter((t) => t.readOnly);
      services[connexion.id] = lecture.length > 0;
      exclus[connexion.id] = outils.filter((t) => !t.readOnly).map((t) => t.name);
    }
    setServicesCoches(services);
    setOutilsExclus(mode === 'lecture' ? exclus : {});
  };

  const construireSelections = () =>
    (data?.connections ?? [])
      .filter((connexion) => estCoche(connexion.id))
      .map((connexion) => {
        const exclus = new Set(outilsExclus[connexion.id] ?? []);
        const gardes = (connexion.tools ?? []).filter((t) => !exclus.has(t.name));
        // Tous gardés → on n'envoie pas de liste : « tous » est la convention.
        return exclus.size === 0 || gardes.length === (connexion.tools ?? []).length
          ? { connectionId: connexion.id }
          : { connectionId: connexion.id, tools: gardes.map((t) => t.name) };
      });

  const selectionsValides = () =>
    construireSelections().length > 0 &&
    construireSelections().every((s) => !s.tools || s.tools.length > 0);

  const filtreRecherche = (connexion: NonNullable<typeof data>['connections'][number]) => {
    const besoin = recherche.trim().toLowerCase();
    if (!besoin) return true;
    const meule = [
      connexion.connectorName ?? '',
      connexion.label,
      connexion.accountLabel ?? '',
      ...(connexion.tools ?? []).map((t) => t.title),
    ]
      .join(' ')
      .toLowerCase();
    return meule.includes(besoin);
  };

  const submit = async (decision: 'approve' | 'deny') => {
    setSubmitting(true);
    try {
      const result =
        decision === 'deny'
          ? await api.oauth.deny(demande)
          : await api.oauth.approve({
              demande,
              ...(connectionId && !data?.hub ? { connectionId } : {}),
              ...(pickedConnectorId ? { connectorId: pickedConnectorId } : {}),
              ...(data?.hub ? { selections: construireSelections() } : {}),
              ...(!data?.hub && exclusMono.size > 0 && data?.connector
                ? {
                    tools: data.connector.tools
                      .map((t) => t.name)
                      .filter((name) => !exclusMono.has(name)),
                  }
                : {}),
            });

      // Retour vers le client IA : navigation complète, ce n'est pas notre domaine.
      window.location.href = result.redirectTo;
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Autorisation impossible.');
      setSubmitting(false);
    }
  };

  /**
   * Retour du fournisseur : on termine sans redemander.
   *
   * `compte` n'est présent que dans la redirection posée par notre propre
   * rappel OAuth, après que l'utilisateur a explicitement cliqué pour raccorder
   * son compte depuis cet écran. Ce clic valait consentement ; le lui redemander
   * ne lui apprendrait rien et ajouterait un écran à un parcours qui doit en
   * compter le moins possible.
   *
   * Le drapeau empêche de reboucler : sans lui, un échec d'approbation
   * relancerait la tentative à chaque rendu.
   */
  const autoApproved = useRef(false);
  const revenantDuFournisseur = Boolean(searchParams.get('compte'));

  useEffect(() => {
    if (autoApproved.current || !revenantDuFournisseur || !data?.connector || !connectionId) return;
    autoApproved.current = true;
    void submit('approve');
    // `submit` est recréé à chaque rendu ; l'inclure relancerait l'effet en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revenantDuFournisseur, data?.connector, connectionId]);

  const submitDeny = async () => {
    try {
      const result = await api.oauth.deny(demande);
      window.location.href = result.redirectTo;
    } catch {
      toast.error('Impossible d’annuler la demande.');
    }
  };

  if (!demande) {
    return (
      <Shell>
        <Alert tone="danger">
          Demande d’autorisation absente. Relancez la connexion depuis votre client IA.
        </Alert>
      </Shell>
    );
  }

  if (authLoading) {
    return (
      <Shell>
        <Spinner />
      </Shell>
    );
  }

  // Non connecté : on passe par la page de connexion et on revient ici.
  if (!user) {
    const returnTo = `/autoriser?demande=${encodeURIComponent(demande)}`;
    return <Navigate to={`/connexion?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  if (isLoading) {
    return (
      <Shell>
        <Spinner />
      </Shell>
    );
  }

  if (error || !data) {
    return (
      <Shell>
        <Alert tone="danger">
          {error instanceof ApiError
            ? error.message
            : 'Demande d’autorisation illisible ou expirée.'}
        </Alert>
      </Shell>
    );
  }

  /**
   * Écran du hub : composer son ensemble.
   *
   * Placé AVANT la branche « quel service ? » — le hub a aussi `connector`
   * nul, et tomberait sinon dans le sélecteur mono-service.
   */
  if (data.hub) {
    const visibles = data.connections.filter(filtreRecherche);
    const total = construireSelections().length;

    return (
      <Shell wide>
        <div className="stack">
          <div className="stack stack--tight">
            <h1 style={{ fontSize: '1.35rem' }}>Composez votre hub</h1>
            <p className="text-muted text-sm">
              <strong>{data.client.name}</strong> recevra une seule connexion exposant les services
              cochés. Vous pourrez ouvrir chaque service pour choisir ses outils.
            </p>
          </div>

          {data.connections.length === 0 ? (
            <Alert tone="info">
              Aucun service raccordé pour l’instant. Ajoutez vos comptes depuis le{' '}
              <a href="/catalogue">catalogue</a>, puis revenez autoriser le hub.
            </Alert>
          ) : (
            <>
              <div className="row" style={{ gap: 'var(--s3)', alignItems: 'center' }}>
                <div className="search" style={{ flex: 1 }}>
                  <span className="search__icon" aria-hidden="true">
                    <IconSearch size={15} />
                  </span>
                  <Input
                    type="search"
                    value={recherche}
                    onChange={(event) => setRecherche(event.target.value)}
                    placeholder="Rechercher un service ou un outil…"
                    aria-label="Rechercher"
                  />
                </div>
                <div className="row" style={{ gap: 'var(--s2)' }}>
                  <Button size="sm" variant="ghost" onClick={() => preregler('tout')}>
                    Tout
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => preregler('lecture')}>
                    Recommandés
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => preregler('rien')}>
                    Aucun
                  </Button>
                </div>
              </div>

              <div className="stack stack--tight">
                {visibles.map((connexion) => {
                  const exclus = new Set(outilsExclus[connexion.id] ?? []);
                  const outils = connexion.tools ?? [];
                  const gardes = outils.length - exclus.size;

                  return (
                    <div key={connexion.id} className="option" style={{ cursor: 'default' }}>
                      <label
                        className="row"
                        style={{ gap: 'var(--s3)', alignItems: 'center', cursor: 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          checked={estCoche(connexion.id)}
                          onChange={() => basculerService(connexion.id)}
                        />
                        {connexion.connectorIcon && (
                          <img className="connector-icon" src={connexion.connectorIcon} alt="" />
                        )}
                        <span className="stack stack--tight" style={{ gap: 0 }}>
                          <span className="option__title">{connexion.connectorName}</span>
                          <span className="option__desc">
                            {connexion.accountLabel ?? connexion.label}
                          </span>
                        </span>
                        <span className="text-xs text-faint" style={{ marginLeft: 'auto' }}>
                          {gardes}/{outils.length} outils
                        </span>
                      </label>

                      {estCoche(connexion.id) && outils.length > 0 && (
                        <details className="text-sm" style={{ marginTop: 'var(--s2)' }}>
                          <summary className="text-muted" style={{ cursor: 'pointer' }}>
                            Choisir les outils
                          </summary>
                          <div className="stack stack--tight" style={{ marginTop: 'var(--s2)' }}>
                            {outils.map((outil) => (
                              <label
                                key={outil.name}
                                className="row"
                                style={{ gap: 'var(--s2)', alignItems: 'center', cursor: 'pointer' }}
                              >
                                <input
                                  type="checkbox"
                                  checked={!exclus.has(outil.name)}
                                  onChange={() => basculerOutil(connexion.id, outil.name)}
                                />
                                <span>{outil.title}</span>
                                {!outil.readOnly && <Badge tone="warning">écriture</Badge>}
                              </label>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
                {visibles.length === 0 && (
                  <p className="text-sm text-muted">Rien ne correspond à cette recherche.</p>
                )}
              </div>
            </>
          )}

          <p className="text-xs text-muted">
            Chaque outil restera exécuté avec le compte affiché ; {data.client.name} ne voit jamais
            vos identifiants. La sélection se modifie en réautorisant le hub.
          </p>

          <div className="row row--end">
            <Button variant="ghost" onClick={() => void submit('deny')} disabled={submitting}>
              Refuser
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={!selectionsValides()}
              onClick={() => void submit('approve')}
            >
              Autoriser {total > 0 ? `${total} service${total > 1 ? 's' : ''}` : ''}
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

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
  const isOAuthConnector = connector.auth.type === 'oauth2';
  const hasAccount = Boolean(connectionId);

  // Au retour du fournisseur, l'approbation part toute seule : on montre une
  // attente plutôt qu'un écran de décision qui va disparaître aussitôt.
  if (revenantDuFournisseur && hasAccount) {
    return (
      <Shell>
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <Spinner label="Finalisation de l’autorisation…" />
          <p className="text-sm text-muted">Compte raccordé. Retour vers {data.client.name}…</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="stack">
        <div className="row" style={{ gap: 'var(--s3)', alignItems: 'flex-start' }}>
          <img className="connector-icon connector-icon--lg" src={connector.icon} alt="" />
          <div className="stack stack--tight">
            <h1 style={{ fontSize: '1.35rem' }}>Autoriser {data.client.name}</h1>
            <p className="text-muted text-sm">
              <strong>{data.client.name}</strong> demande l’accès à vos outils{' '}
              <strong>{connector.name}</strong> via Toolink.
            </p>
          </div>
        </div>

        <section className="card stack stack--tight">
          <div className="row row--between" style={{ alignItems: 'baseline' }}>
            <strong className="text-sm">Ce que cette application pourra faire</strong>
            <span className="text-xs text-faint">
              {connector.tools.length - exclusMono.size}/{connector.tools.length} outils
            </span>
          </div>
          {/* Même granularité que le hub : décocher un outil le retire du
              jeton — il n'existera pas pour ce client, pas seulement caché. */}
          <div className="stack stack--tight">
            {connector.tools.map((tool) => (
              <label
                key={tool.name}
                className="row text-sm"
                style={{ gap: 'var(--s2)', alignItems: 'center', cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={!exclusMono.has(tool.name)}
                  onChange={() =>
                    setExclusMono((courant) => {
                      const suivant = new Set(courant);
                      if (suivant.has(tool.name)) suivant.delete(tool.name);
                      else suivant.add(tool.name);
                      return suivant;
                    })
                  }
                />
                <span>{tool.title}</span>
                {!tool.readOnly && <Badge tone="warning">écriture</Badge>}
              </label>
            ))}
          </div>
        </section>

        {!data.connectorAvailable && (
          <Alert tone="danger">
            {connector.unavailableReason ??
              'Ce connecteur n’est pas disponible sur ce serveur pour le moment.'}
          </Alert>
        )}

        {/* Choix du compte : seulement s'il y en a plusieurs. */}
        {data.connectorAvailable && data.connections.length > 1 && (
          <section className="stack stack--tight">
            <strong className="text-sm">Compte {connector.name} à utiliser</strong>
            {data.connections.map((connection) => (
              <ChoixCompte
                key={connection.id}
                selected={connectionId === connection.id}
                onSelect={() => setConnectionChoice(connection.id)}
                title={connection.label}
                description={connection.accountLabel ?? 'Compte raccordé'}
              />
            ))}
          </section>
        )}

        {/* Un seul compte : on l'annonce, sans rien demander. */}
        {data.connectorAvailable && data.connections.length === 1 && (
          <p className="text-sm text-muted row" style={{ gap: 'var(--s2)' }}>
            <IconCheck size={14} />
            Compte utilisé :{' '}
            <strong>{data.connections[0]?.accountLabel ?? data.connections[0]?.label}</strong>
          </p>
        )}

        {/* Connecteur à clé API sans compte : le formulaire, sur place. */}
        {data.connectorAvailable && !isOAuthConnector && data.connections.length === 0 && (
          <section className="stack stack--tight">
            {showCredentialForm ? (
              <div className="card">
                <CredentialForm
                  connector={connector}
                  submitLabel="Enregistrer et autoriser"
                  onCancel={() => setShowCredentialForm(false)}
                  onSubmit={async (credentials) => {
                    try {
                      const created = await api.connections.create({
                        connectorId: connector.id,
                        label: 'Compte principal',
                        credentials,
                      });
                      setConnectionChoice(created.connection.id);
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
                Renseigner ma clé API {connector.name}
              </Button>
            )}
          </section>
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
          Vous pourrez révoquer cet accès à tout moment depuis « Mes connexions ». Toolink ne
          transmet vos identifiants à aucun tiers : {data.client.name} reçoit uniquement un jeton
          limité à ce connecteur.
        </p>

        <div className="row row--end">
          <Button variant="ghost" onClick={() => void submit('deny')} disabled={submitting}>
            Refuser
          </Button>

          {/*
            Aucun compte raccordé sur un connecteur OAuth : l'action principale
            part directement chez le fournisseur. Pas de bouton « Autoriser »
            grisé accompagné d'un message expliquant pourquoi — l'écran indique
            la seule chose à faire.
          */}
          {data.connectorAvailable && isOAuthConnector && !hasAccount ? (
            <a
              className="btn btn--primary"
              href={connectorOAuthUrl(connector.id, {
                returnTo: `/autoriser?demande=${encodeURIComponent(demande)}`,
                label: 'Compte principal',
              })}
            >
              Continuer avec {connector.name}
              <IconArrowRight size={15} />
            </a>
          ) : (
            <Button
              variant="primary"
              loading={submitting}
              disabled={
                !data.connectorAvailable ||
                !hasAccount ||
                exclusMono.size >= connector.tools.length
              }
              onClick={() => void submit('approve')}
            >
              Autoriser
            </Button>
          )}
        </div>

        {/* Raccorder un compte supplémentaire : action secondaire, discrète. */}
        {data.connectorAvailable && isOAuthConnector && hasAccount && (
          <a
            className="text-xs text-muted link-sweep"
            style={{ alignSelf: 'flex-end' }}
            href={connectorOAuthUrl(connector.id, {
              returnTo: `/autoriser?demande=${encodeURIComponent(demande)}`,
              label: `Compte ${data.connections.length + 1}`,
            })}
          >
            Utiliser un autre compte {connector.name}
          </a>
        )}
      </div>
    </Shell>
  );
}

function ChoixCompte({
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

function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="auth-layout">
      <div className="auth-card" style={{ width: wide ? 'min(680px, 100%)' : 'min(520px, 100%)' }}>
        {children}
      </div>
    </div>
  );
}
