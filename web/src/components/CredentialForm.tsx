import { useMemo, useState, type FormEvent } from 'react';
import { Alert, Button, Field, Input, Select } from './ui';
import type { CredentialField, Connector } from '../lib/types';

/**
 * ============================================================================
 *  Formulaire d'identifiants — entièrement généré depuis la définition serveur
 * ============================================================================
 *
 * C'est la pièce qui rend la plateforme extensible côté interface. Le connecteur
 * décrit ses champs (`auth.fields`) et ce composant en déduit :
 *   • le type d'input (mot de passe, e-mail, URL, liste déroulante) ;
 *   • les contraintes de validation, alignées sur celles du serveur ;
 *   • l'aide contextuelle et les libellés.
 *
 * Ajouter un connecteur ne demande donc AUCUNE ligne de code ici.
 */

interface Props {
  connector: Connector;
  /** Valeurs initiales (édition). Les champs mot de passe restent vides. */
  initialValues?: Record<string, string>;
  submitLabel: string;
  loading?: boolean;
  serverErrors?: Record<string, string>;
  onSubmit: (credentials: Record<string, string>) => void;
  onCancel?: () => void;
}

export function CredentialForm({
  connector,
  initialValues,
  submitLabel,
  loading = false,
  serverErrors = {},
  onSubmit,
  onCancel,
}: Props) {
  const fields = connector.auth.fields;

  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      initial[field.key] = initialValues?.[field.key] ?? field.defaultValue ?? '';
    }
    return initial;
  });

  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const clientErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const field of fields) {
      const error = validateField(field, values[field.key] ?? '');
      if (error) errors[field.key] = error;
    }
    return errors;
  }, [fields, values]);

  const hasErrors = Object.keys(clientErrors).length > 0;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (hasErrors) {
      setTouched(Object.fromEntries(fields.map((field) => [field.key, true])));
      return;
    }

    // Les champs facultatifs laissés vides ne sont pas transmis.
    const payload: Record<string, string> = {};
    for (const field of fields) {
      const value = (values[field.key] ?? '').trim();
      if (value) payload[field.key] = value;
    }
    onSubmit(payload);
  };

  return (
    <form className="stack" onSubmit={handleSubmit} noValidate>
      {connector.auth.instructions && (
        <Alert tone="info">
          <div className="stack stack--tight">
            <span>{connector.auth.instructions}</span>
            {connector.auth.docsUrl && (
              <a href={connector.auth.docsUrl} target="_blank" rel="noreferrer noopener">
                Documentation {connector.name} ↗
              </a>
            )}
          </div>
        </Alert>
      )}

      {fields.map((field) => {
        const error = touched[field.key] ? (clientErrors[field.key] ?? serverErrors[field.key]) : serverErrors[field.key];

        return (
          <Field
            key={field.key}
            label={field.label}
            required={field.required ?? true}
            {...(field.help ? { help: field.help } : {})}
            {...(error ? { error } : {})}
          >
            {(props) =>
              field.type === 'select' ? (
                <Select
                  {...props}
                  value={values[field.key] ?? ''}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  onBlur={() => setTouched((current) => ({ ...current, [field.key]: true }))}
                >
                  <option value="">Sélectionner…</option>
                  {field.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  {...props}
                  type={inputType(field.type)}
                  value={values[field.key] ?? ''}
                  placeholder={field.placeholder ?? ''}
                  autoComplete={field.type === 'password' ? 'new-password' : 'off'}
                  spellCheck={false}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  onBlur={() => setTouched((current) => ({ ...current, [field.key]: true }))}
                />
              )
            }
          </Field>
        );
      })}

      <p className="text-xs text-muted">
        Vos identifiants sont chiffrés (AES-256-GCM) avant d’être stockés et ne sont jamais
        réaffichés en clair.
      </p>

      <div className="row row--end">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>
            Annuler
          </Button>
        )}
        <Button type="submit" variant="primary" loading={loading}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function inputType(type: CredentialField['type']): string {
  switch (type) {
    case 'password':
      return 'password';
    case 'email':
      return 'email';
    case 'url':
      return 'url';
    default:
      return 'text';
  }
}

/**
 * Validation côté client, volontairement calquée sur `buildFieldSchema()` du
 * serveur : mêmes règles, mêmes messages. Le serveur reste l'autorité — ceci
 * n'est qu'un retour immédiat pour l'utilisateur.
 */
function validateField(field: CredentialField, rawValue: string): string | null {
  const value = rawValue.trim();
  const required = field.required ?? true;

  if (!value) return required ? `${field.label} est obligatoire` : null;

  if (field.minLength && value.length < field.minLength) {
    return `Au moins ${field.minLength} caractères`;
  }
  if (field.maxLength && value.length > field.maxLength) {
    return `Au plus ${field.maxLength} caractères`;
  }
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    return 'Adresse e-mail invalide';
  }
  if (field.type === 'url' && !/^https?:\/\/[^\s]+$/.test(value)) {
    return 'URL invalide (http ou https)';
  }
  if (field.pattern && !new RegExp(field.pattern).test(value)) {
    return 'Format invalide';
  }

  return null;
}
