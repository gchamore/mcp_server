import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconClose, IconCopy } from './icons';
import type { ConnectionStatus, ConnectorStatus } from '../lib/types';

/** Briques d'interface réutilisables. Aucune dépendance UI externe. */

// --- Boutons ---------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  block?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  block = false,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    `btn--${variant}`,
    size !== 'md' ? `btn--${size}` : '',
    block ? 'btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} disabled={disabled ?? loading} {...rest}>
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

// --- Champs ----------------------------------------------------------------

interface FieldProps {
  label: string;
  required?: boolean;
  help?: string;
  error?: string;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}

/**
 * Enveloppe accessible : relie le label, l'aide et l'erreur au champ via
 * `aria-describedby`, ce qui fait annoncer l'erreur par les lecteurs d'écran.
 */
export function Field({ label, required, help, error, children }: FieldProps) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {required && (
          <span className="field__required" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {children({
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })}

      {help && (
        <span className="field__help" id={helpId}>
          {help}
        </span>
      )}
      {error && (
        <span className="field__error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return <input className={`input ${className}`.trim()} {...rest} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', children, ...rest } = props;
  return (
    <select className={`select ${className}`.trim()} {...rest}>
      {children}
    </select>
  );
}

// --- Retours visuels -------------------------------------------------------

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  children: ReactNode;
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

const CONNECTION_STATUS: Record<
  ConnectionStatus,
  { tone: 'success' | 'warning' | 'danger'; label: string }
> = {
  ACTIVE: { tone: 'success', label: 'Connecté' },
  PENDING: { tone: 'warning', label: 'En attente' },
  ERROR: { tone: 'danger', label: 'Erreur' },
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const { tone, label } = CONNECTION_STATUS[status];
  return (
    <Badge tone={tone}>
      <span className="dot" aria-hidden="true" />
      {label}
    </Badge>
  );
}

export function ConnectorStatusBadge({ status }: { status: ConnectorStatus }) {
  if (status === 'stable') return null;
  return status === 'beta' ? (
    <Badge tone="info">Bêta</Badge>
  ) : (
    <Badge tone="neutral">Bientôt</Badge>
  );
}

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  children: ReactNode;
}) {
  return (
    <div className={`alert alert--${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="loader">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  /** Icône vectorielle. Volontairement pas une chaîne : les émojis changent
   *  d'aspect selon l'OS et trahissent une interface non dessinée. */
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && (
        <span className="empty-state__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <strong>{title}</strong>
      {description && <p className="text-sm">{description}</p>}
      {action}
    </div>
  );
}

// --- Modale ----------------------------------------------------------------

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/**
 * Modale accessible : fermeture par Échap, focus déplacé à l'ouverture,
 * défilement de la page bloqué, rendu par portail.
 */
export function Modal({ open, title, onClose, children, footer, wide }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal ${wide ? 'modal--wide' : ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal__header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Fermer">
            <IconClose size={18} />
          </button>
        </div>
        {children}
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmation pour les actions destructrices. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmer',
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Annuler
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted">{message}</div>
    </Modal>
  );
}

// --- Copie dans le presse-papiers ------------------------------------------

export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // `navigator.clipboard` exige un contexte sécurisé : repli manuel.
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="stack stack--tight">
      {label && <span className="field__label">{label}</span>}
      <div className="code-block">
        <span className="code-block__value">{value}</span>
        <Button size="sm" variant="secondary" onClick={copy} aria-label="Copier">
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          {copied ? 'Copié' : 'Copier'}
        </Button>
      </div>
    </div>
  );
}
