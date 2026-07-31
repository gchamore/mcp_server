import { z } from 'zod';
import { env } from '../core/env.js';
import { badRequest, notFound } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { isConnectorOAuthReady } from '../modules/connections/connector-oauth.service.js';
import { connectors as declaredConnectors } from './index.js';
import type {
  ConnectorDefinition,
  ConnectorSummary,
  CredentialField,
  Credentials,
} from './types.js';

/**
 * Registre des connecteurs.
 *
 * La source est la liste explicite de `connectors/index.ts`. Chaque définition
 * est validée au chargement : un connecteur mal formé fait échouer le démarrage
 * bruyamment, plutôt que de casser silencieusement l'interface ou un serveur
 * MCP une fois en production.
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConnector = ConnectorDefinition<any>;

const registry = new Map<string, AnyConnector>();
let loaded = false;

/**
 * Asynchrone bien que le chargement soit synchrone : la signature reste stable
 * si l'on introduit un jour des connecteurs configurés à distance.
 */
export async function loadConnectors(): Promise<void> {
  if (loaded) return;

  for (const definition of declaredConnectors) {
    const connector = assertValidConnector(definition);

    if (registry.has(connector.id)) {
      throw new Error(`Deux connecteurs déclarent le même id "${connector.id}".`);
    }
    registry.set(connector.id, connector);
  }

  loaded = true;
  logger.info({ count: registry.size, connectors: [...registry.keys()] }, 'Connecteurs chargés');
}

function assertValidConnector(value: unknown): AnyConnector {
  const connector = value as AnyConnector;
  const label = (connector as { id?: string })?.id ?? '(sans id)';
  const fail = (reason: string): never => {
    throw new Error(`Connecteur invalide « ${label} » : ${reason}`);
  };

  if (typeof connector !== 'object' || connector === null) fail('la définition n’est pas un objet');
  if (!ID_PATTERN.test(connector.id ?? '')) {
    fail(`id invalide (attendu : minuscules, chiffres et tirets)`);
  }
  for (const field of ['name', 'tagline', 'description', 'category', 'icon'] as const) {
    if (!connector[field]) fail(`champ obligatoire manquant : ${field}`);
  }
  if (typeof connector.verify !== 'function') fail('verify() manquant');

  if (!connector.auth) fail('auth manquant');

  if (connector.auth.type === 'oauth2') {
    // Un connecteur OAuth ne demande rien à l'utilisateur : ce qu'il lui faut,
    // ce sont les points d'entrée du fournisseur.
    const oauth = connector.auth.oauth;
    if (!oauth) fail("auth.oauth est requis lorsque auth.type vaut 'oauth2'");
    for (const key of ['authorizationUrl', 'tokenUrl', 'credentialsEnvPrefix'] as const) {
      if (!oauth?.[key]) fail(`auth.oauth.${key} manquant`);
    }
    if (!oauth?.scopes?.length) fail('auth.oauth.scopes doit contenir au moins un scope');
    if (connector.auth.fields.length > 0) {
      fail("un connecteur OAuth ne doit déclarer aucun champ de saisie (auth.fields)");
    }
  } else if (!connector.auth.fields?.length) {
    fail('auth.fields doit contenir au moins un champ');
  }

  const fieldKeys = new Set<string>();
  for (const field of connector.auth.fields) {
    if (fieldKeys.has(field.key)) fail(`champ d'authentification dupliqué : ${field.key}`);
    fieldKeys.add(field.key);
    if (field.type === 'select' && !field.options?.length) {
      fail(`le champ "${field.key}" est de type select mais n'a pas d'options`);
    }
  }

  if (!Array.isArray(connector.tools) || connector.tools.length === 0) {
    fail('aucun outil déclaré');
  }
  const toolNames = new Set<string>();
  for (const tool of connector.tools) {
    if (!TOOL_NAME_PATTERN.test(tool.name)) {
      fail(`nom d'outil "${tool.name}" invalide (attendu : snake_case)`);
    }
    if (toolNames.has(tool.name)) fail(`outil dupliqué : ${tool.name}`);
    toolNames.add(tool.name);
    if (!tool.description) fail(`l'outil "${tool.name}" n'a pas de description`);
    if (typeof tool.handler !== 'function') fail(`l'outil "${tool.name}" n'a pas de handler`);
  }

  return connector;
}

export function listConnectors(): AnyConnector[] {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export function getConnector(id: string): AnyConnector | undefined {
  return registry.get(id);
}

export function requireConnector(id: string): AnyConnector {
  const connector = registry.get(id);
  if (!connector) throw notFound(`Connecteur inconnu : ${id}`);
  return connector;
}

export function connectorCount(): number {
  return registry.size;
}

/**
 * Projection publique : jamais d'identifiants, jamais de code exécutable, et
 * jamais la configuration OAuth interne (URLs de jetons, préfixe des secrets).
 * Seule la liste des scopes est exposée, pour que l'utilisateur sache ce qu'il
 * s'apprête à autoriser.
 */
export function toSummary(connector: AnyConnector): ConnectorSummary {
  const oauthReady = isConnectorOAuthReady(connector);

  return {
    id: connector.id,
    name: connector.name,
    tagline: connector.tagline,
    description: connector.description,
    category: connector.category,
    status: connector.status ?? 'stable',
    icon: connector.icon,
    accentColor: connector.accentColor ?? '#1e3a8a',
    ...(connector.docsUrl ? { docsUrl: connector.docsUrl } : {}),
    auth: {
      type: connector.auth.type,
      fields: connector.auth.fields,
      ...(connector.auth.docsUrl ? { docsUrl: connector.auth.docsUrl } : {}),
      ...(connector.auth.instructions ? { instructions: connector.auth.instructions } : {}),
      ...(connector.auth.oauth ? { scopes: connector.auth.oauth.scopes } : {}),
    },
    available: oauthReady,
    ...(oauthReady
      ? {}
      : {
          unavailableReason:
            "L'application OAuth de ce service n'est pas encore configurée sur ce serveur.",
        }),
    mcpUrl: `${env.baseUrl}/mcp/${connector.id}`,
    tools: connector.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      readOnly: tool.annotations?.readOnlyHint ?? false,
    })),
    toolCount: connector.tools.length,
  };
}

/**
 * Construit dynamiquement un schéma zod à partir de `auth.fields` et valide la
 * saisie utilisateur. Les contraintes déclarées dans le connecteur servent donc
 * à la fois au rendu du formulaire et à la validation serveur.
 */
export function parseCredentials(connector: AnyConnector, input: unknown): Credentials {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of connector.auth.fields) {
    shape[field.key] = buildFieldSchema(field);
  }

  const result = z.object(shape).safeParse(input);
  if (!result.success) {
    const details: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!details[key]) details[key] = issue.message;
    }
    throw badRequest('Identifiants invalides', details);
  }

  // On ne conserve que les champs déclarés, débarrassés des espaces parasites.
  const credentials: Credentials = {};
  for (const field of connector.auth.fields) {
    const value = (result.data as Record<string, string | undefined>)[field.key];
    if (value !== undefined && value !== '') credentials[field.key] = value;
  }
  return credentials;
}

/**
 * Les motifs email/URL sont écrits à la main plutôt que via `z.email()` /
 * `z.url()` : cela garde le schéma sur un unique `ZodString`, donc chaînable
 * avec min/max/regex quelle que soit la version mineure de zod.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_PATTERN = /^https?:\/\/[^\s]+$/;

function buildFieldSchema(field: CredentialField): z.ZodTypeAny {
  if (field.type === 'select' && field.options?.length) {
    const allowed = field.options.map((option) => option.value);
    const enumSchema = z.enum(allowed as [string, ...string[]]);
    return (field.required ?? true) ? enumSchema : enumSchema.optional();
  }

  let schema = z.string().trim();

  if (field.type === 'email') schema = schema.regex(EMAIL_PATTERN, 'Adresse e-mail invalide');
  if (field.type === 'url') schema = schema.regex(URL_PATTERN, 'URL invalide (http ou https)');
  if (field.minLength) {
    schema = schema.min(field.minLength, `Au moins ${field.minLength} caractères`);
  }
  if (field.maxLength) {
    schema = schema.max(field.maxLength, `Au plus ${field.maxLength} caractères`);
  }
  if (field.pattern) schema = schema.regex(new RegExp(field.pattern), 'Format invalide');

  if (field.required ?? true) return schema.min(1, `${field.label} est obligatoire`);
  return schema.optional();
}

/** Aperçu masqué des identifiants, pour l'affichage dans l'UI. */
export function describeCredentials(
  connector: AnyConnector,
  credentials: Credentials,
): { key: string; label: string; filled: boolean; preview: string }[] {
  return connector.auth.fields.map((field) => {
    const value = credentials[field.key];
    return {
      key: field.key,
      label: field.label,
      filled: Boolean(value),
      preview: !value ? '' : field.type === 'password' ? `••••${value.slice(-4)}` : value,
    };
  });
}

/** Réinitialise le registre — utilisé par les tests uniquement. */
export function resetRegistryForTests(): void {
  registry.clear();
  loaded = false;
}
