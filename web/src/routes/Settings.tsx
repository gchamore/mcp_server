import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../state/auth';
import { useToast } from '../components/Toast';
import { Alert, Button, ConfirmDialog, Field, Input, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';

/** Paramètres du compte : mot de passe, sessions, suppression. */
export function Settings() {
  const { user, isLoading, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (isLoading) return <Spinner />;
  if (!user) return null;

  const revokeSessions = async () => {
    try {
      const { revoked } = await api.auth.revokeAllSessions();
      toast.success(`${revoked} session(s) fermée(s). Reconnectez-vous.`);
      await logout();
      navigate('/connexion');
    } catch {
      toast.error('Impossible de fermer les sessions.');
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await api.auth.deleteAccount();
      toast.success('Compte supprimé.');
      await logout();
      navigate('/');
    } catch {
      toast.error('Suppression impossible.');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="stack stack--loose" style={{ maxWidth: '720px' }}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>Paramètres</h1>
          <p>Gérez votre compte et la sécurité de vos accès.</p>
        </div>
      </div>

      <section className="card stack">
        <h2>Profil</h2>
        <dl className="stack stack--tight">
          <div className="row row--between">
            <dt className="text-muted">Adresse e-mail</dt>
            <dd className="mono text-sm">{user.email}</dd>
          </div>
          <div className="row row--between">
            <dt className="text-muted">Nom</dt>
            <dd>{[user.firstName, user.lastName].filter(Boolean).join(' ') || '—'}</dd>
          </div>
          <div className="row row--between">
            <dt className="text-muted">Méthode de connexion</dt>
            <dd>{user.provider === 'GOOGLE' ? 'Google' : 'Mot de passe'}</dd>
          </div>
          <div className="row row--between">
            <dt className="text-muted">Compte créé le</dt>
            <dd>{formatDate(user.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <PasswordSection hasPassword={user.hasPassword} />

      <section className="card stack">
        <h2>Sessions</h2>
        <p className="text-sm text-muted">
          Fermer toutes les sessions déconnecte votre compte de tous les navigateurs et appareils.
          Utile si vous pensez qu’un accès a été compromis.
        </p>
        <div className="row row--end">
          <Button variant="secondary" onClick={() => void revokeSessions()}>
            Fermer toutes les sessions
          </Button>
        </div>
      </section>

      <section className="card stack">
        <h2>Zone de danger</h2>
        <p className="text-sm text-muted">
          La suppression du compte efface définitivement vos connexions, vos identifiants chiffrés
          et tous vos points d’accès MCP. Cette action est irréversible.
        </p>
        <div className="row row--end">
          <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)}>
            Supprimer mon compte
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmDelete}
        title="Supprimer définitivement votre compte ?"
        confirmLabel="Oui, tout supprimer"
        loading={deleting}
        message="Toutes vos connexions et URLs MCP seront détruites. Les assistants qui les utilisent cesseront de fonctionner immédiatement."
        onConfirm={() => void deleteAccount()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmation: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasPassword) {
    return (
      <section className="card stack">
        <h2>Mot de passe</h2>
        <Alert tone="info">
          Ce compte utilise la connexion Google. La gestion du mot de passe se fait depuis votre
          compte Google.
        </Alert>
      </section>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (form.newPassword !== form.confirmation) {
      setError('Les deux nouveaux mots de passe ne correspondent pas.');
      return;
    }

    setLoading(true);
    try {
      const { message } = await api.auth.changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      toast.success(message);
      setForm({ currentPassword: '', newPassword: '', confirmation: '' });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Modification impossible.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card stack">
      <h2>Mot de passe</h2>
      {error && <Alert tone="danger">{error}</Alert>}

      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Mot de passe actuel" required>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
              required
            />
          )}
        </Field>

        <Field label="Nouveau mot de passe" required help="10 caractères minimum.">
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={form.newPassword}
              onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
              required
            />
          )}
        </Field>

        <Field label="Confirmation" required>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="new-password"
              value={form.confirmation}
              onChange={(event) => setForm({ ...form, confirmation: event.target.value })}
              required
            />
          )}
        </Field>

        <div className="row row--end">
          <Button type="submit" variant="primary" loading={loading}>
            Mettre à jour
          </Button>
        </div>
      </form>
    </section>
  );
}
