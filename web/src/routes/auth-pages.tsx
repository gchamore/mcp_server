import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../state/auth';
import { useToast } from '../components/Toast';
import { Alert, Button, Field, Input } from '../components/ui';

/** Écrans d'authentification : connexion, inscription, mot de passe oublié. */

function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="auth-layout">
      <div className="auth-card stack">
        <div className="stack stack--tight">
          <Link to="/" className="brand" style={{ marginBottom: 'var(--space-2)' }}>
            <span className="brand__mark" aria-hidden="true">
              W
            </span>
            MCP&nbsp;Wesype
          </Link>
          <h1 style={{ fontSize: '1.5rem' }}>{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {children}
        {footer && <div className="text-sm text-muted">{footer}</div>}
      </div>
    </div>
  );
}

function GoogleButton({ label, returnTo = '/catalogue' }: { label: string; returnTo?: string }) {
  const { data } = useQuery({ queryKey: ['auth', 'providers'], queryFn: api.auth.providers });
  if (!data?.google) return null;

  return (
    <>
      {/* Lien natif, et non fetch : le flux OAuth est une navigation complète. */}
      <a
        className="btn btn--secondary btn--block"
        href={`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`}
      >
        {label}
      </a>
      <div className="divider">ou</div>
    </>
  );
}

/** N'accepte qu'un chemin interne : bloque les redirections ouvertes. */
function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/catalogue';
  return value;
}

/** Traduit une erreur d'API en message + erreurs par champ. */
function useApiError() {
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const capture = (error: unknown) => {
    if (error instanceof ApiError) {
      setMessage(error.message);
      setFields(error.fields);
      return;
    }
    setMessage('Une erreur inattendue est survenue.');
    setFields({});
  };

  const reset = () => {
    setMessage(null);
    setFields({});
  };

  return { message, fields, capture, reset };
}

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { message, fields, capture, reset } = useApiError();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: '', password: '' });

  const oauthError = searchParams.get('erreur');
  // Renseigné quand on arrive depuis l'écran de consentement MCP.
  const returnTo = safeReturnTo(searchParams.get('returnTo'));

  if (user) return <Navigate to={returnTo} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    reset();
    setLoading(true);
    try {
      await login(form);
      navigate(returnTo, { replace: true });
    } catch (error) {
      capture(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Connexion"
      subtitle="Accédez à vos connecteurs MCP."
      footer={
        <>
          Pas encore de compte ? <Link to="/inscription">Créer un compte</Link>
        </>
      }
    >
      {oauthError && <Alert tone="danger">La connexion Google a échoué. Réessayez.</Alert>}
      {message && <Alert tone="danger">{message}</Alert>}

      <GoogleButton label="Continuer avec Google" returnTo={returnTo} />

      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Adresse e-mail" required {...(fields.email ? { error: fields.email } : {})}>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              required
            />
          )}
        </Field>

        <Field
          label="Mot de passe"
          required
          {...(fields.password ? { error: fields.password } : {})}
        >
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              required
            />
          )}
        </Field>

        <div className="row row--between">
          <Link className="text-sm" to="/mot-de-passe-oublie">
            Mot de passe oublié ?
          </Link>
        </div>

        <Button type="submit" variant="primary" block loading={loading}>
          Se connecter
        </Button>
      </form>
    </AuthShell>
  );
}

export function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const { message, fields, capture, reset } = useApiError();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '' });

  if (user) return <Navigate to="/catalogue" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    reset();
    setLoading(true);
    try {
      await register({
        email: form.email,
        password: form.password,
        ...(form.firstName ? { firstName: form.firstName } : {}),
        ...(form.lastName ? { lastName: form.lastName } : {}),
      });
      navigate('/catalogue', { replace: true });
    } catch (error) {
      capture(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Créer un compte"
      subtitle="Quelques secondes suffisent."
      footer={
        <>
          Déjà inscrit ? <Link to="/connexion">Se connecter</Link>
        </>
      }
    >
      {message && <Alert tone="danger">{message}</Alert>}

      <GoogleButton label="S’inscrire avec Google" />

      <form className="stack" onSubmit={submit} noValidate>
        <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'nowrap' }}>
          <Field label="Prénom">
            {(props) => (
              <Input
                {...props}
                autoComplete="given-name"
                value={form.firstName}
                onChange={(event) => setForm({ ...form, firstName: event.target.value })}
              />
            )}
          </Field>
          <Field label="Nom">
            {(props) => (
              <Input
                {...props}
                autoComplete="family-name"
                value={form.lastName}
                onChange={(event) => setForm({ ...form, lastName: event.target.value })}
              />
            )}
          </Field>
        </div>

        <Field label="Adresse e-mail" required {...(fields.email ? { error: fields.email } : {})}>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              required
            />
          )}
        </Field>

        <Field
          label="Mot de passe"
          required
          help="10 caractères minimum."
          {...(fields.password ? { error: fields.password } : {})}
        >
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              required
            />
          )}
        </Field>

        <Button type="submit" variant="primary" block loading={loading}>
          Créer mon compte
        </Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPassword() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const { message } = await api.auth.forgotPassword(email);
      toast.success(message);
      setSent(true);
    } catch {
      toast.error('Impossible d’envoyer l’e-mail pour le moment.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Mot de passe oublié"
      subtitle="Nous vous enverrons un lien de réinitialisation."
      footer={<Link to="/connexion">Retour à la connexion</Link>}
    >
      {sent ? (
        <Alert tone="success">
          Si un compte existe pour cette adresse, l’e-mail vient de partir. Pensez à vérifier vos
          courriers indésirables.
        </Alert>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <Field label="Adresse e-mail" required>
            {(props) => (
              <Input
                {...props}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            )}
          </Field>
          <Button type="submit" variant="primary" block loading={loading}>
            Envoyer le lien
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const token = searchParams.get('token') ?? '';

  const [status, setStatus] = useState<'checking' | 'valid' | 'invalid'>('checking');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const { message, capture, reset } = useApiError();

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      return;
    }
    api.auth
      .verifyResetToken(token)
      .then(({ valid }) => setStatus(valid ? 'valid' : 'invalid'))
      .catch(() => setStatus('invalid'));
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    reset();

    if (password !== confirmation) {
      capture(new ApiError(400, 'VALIDATION_ERROR', 'Les deux mots de passe ne correspondent pas.'));
      return;
    }

    setLoading(true);
    try {
      await api.auth.resetPassword({ token, password });
      toast.success('Mot de passe mis à jour.');
      navigate('/connexion', { replace: true });
    } catch (error) {
      capture(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Nouveau mot de passe"
      footer={<Link to="/connexion">Retour à la connexion</Link>}
    >
      {status === 'checking' && <p className="text-sm text-muted">Vérification du lien…</p>}

      {status === 'invalid' && (
        <Alert tone="danger">
          Ce lien est invalide ou expiré. Relancez une demande depuis « mot de passe oublié ».
        </Alert>
      )}

      {status === 'valid' && (
        <form className="stack" onSubmit={submit} noValidate>
          {message && <Alert tone="danger">{message}</Alert>}

          <Field label="Nouveau mot de passe" required help="10 caractères minimum.">
            {(props) => (
              <Input
                {...props}
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
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
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
              />
            )}
          </Field>

          <Button type="submit" variant="primary" block loading={loading}>
            Mettre à jour
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
