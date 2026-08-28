import { LogoMark } from '../components/Logo';
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
          <Link to="/" className="brand" style={{ marginBottom: 'var(--s2)' }}>
            <span className="brand__mark" aria-hidden="true">
              <LogoMark size={16} />
            </span>
            Toolink
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

/**
 * Symbole « G » officiel, quadrichrome.
 *
 * Les règles de marque de Google (developers.google.com/identity/branding-guidelines)
 * imposent le G en couleurs standard, jamais recoloré ni redessiné, dans un
 * bouton avec libellé — le G seul est interdit. Les tracés ci-dessous sont ceux
 * distribués par Google.
 */
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.859-3.0477.859-2.344 0-4.3282-1.5831-5.036-3.7104H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1022-1.17.2822-1.71V4.9582H.9573A8.9965 8.9965 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.964 10.71z"
      />
      <path
        fill="#EA4335"
        d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.3459l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.656 3.5795 9 3.5795z"
      />
    </svg>
  );
}

function GoogleButton({ label, returnTo = '/catalogue' }: { label: string; returnTo?: string }) {
  const { data } = useQuery({ queryKey: ['auth', 'providers'], queryFn: api.auth.providers });
  if (!data?.google) return null;

  return (
    <>
      {/* Lien natif, et non fetch : le flux OAuth est une navigation complète. */}
      <a
        className="btn btn--google btn--block"
        href={`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`}
      >
        <GoogleG />
        {label}
      </a>
      <div className="divider">ou</div>
    </>
  );
}

/** N'accepte qu'un chemin interne : bloque les redirections ouvertes. */
/**
 * Ramène une destination demandée à un chemin interne.
 *
 * Le contrôle précédent — « commence par `/` mais pas par `//` » — laissait
 * passer `/\evil.test`, que le navigateur normalise en `//evil.test`, donc une
 * URL relative au protocole vers un autre domaine.
 *
 * Ici la valeur est résolue contre l'origine courante et rejetée si elle en
 * sort : on délègue le calcul à celui qui fera la navigation, plutôt que de
 * tenter d'énumérer les écritures dangereuses. Le serveur applique exactement
 * le même contrôle sur `returnTo` ; les deux doivent rester d'accord.
 */
// eslint-disable-next-line no-control-regex -- les détecter est précisément l’objet de ce test.
const CARACTERES_DE_CONTROLE = /[\u0000-\u001f\u007f]/;

function safeReturnTo(value: string | null): string {
  const fallback = '/catalogue';
  if (!value || !value.startsWith('/') || CARACTERES_DE_CONTROLE.test(value)) return fallback;

  try {
    const resolved = new URL(value, window.location.origin);
    if (resolved.origin !== window.location.origin) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
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
        <div className="row" style={{ gap: 'var(--s3)', flexWrap: 'nowrap' }}>
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

  /**
   * L'absence de jeton se connaît dès le premier rendu : la déduire ici évite
   * un rendu « en vérification » suivi d'un rendu « invalide » — l'utilisateur
   * voyait un chargement pour une réponse déjà connue.
   */
  const [status, setStatus] = useState<'checking' | 'valid' | 'invalid'>(
    token ? 'checking' : 'invalid',
  );
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const { message, capture, reset } = useApiError();

  useEffect(() => {
    if (!token) return;
    api.auth
      .verifyResetToken(token)
      .then(({ valid }) => setStatus(valid ? 'valid' : 'invalid'))
      .catch(() => setStatus('invalid'));
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    reset();

    if (password !== confirmation) {
      capture(
        new ApiError(400, 'VALIDATION_ERROR', 'Les deux mots de passe ne correspondent pas.'),
      );
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
