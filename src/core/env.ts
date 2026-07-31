import 'dotenv/config';
import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * Toute la configuration passe par ici. Aucun `process.env` ailleurs dans le
 * code : une variable manquante ou mal formée arrête le serveur au démarrage
 * avec un message explicite, plutôt que de produire une erreur obscure en
 * production trois heures plus tard.
 */

const isHex64 = (value: string) => /^[0-9a-fA-F]{64}$/.test(value);

const optionalString = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

const booleanish = z
  .string()
  .trim()
  .transform((value) => value === 'true' || value === '1')
  .optional();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // `APP_BASE_URL` est le nom à privilégier : `BASE_URL` est un nom très
  // générique, que certains outils (Vite/Vitest notamment) définissent déjà
  // avec la valeur « / ». Il reste accepté, mais seulement s'il contient une
  // URL absolue — sinon les URLs MCP générées seraient relatives, donc cassées.
  APP_BASE_URL: optionalString,
  BASE_URL: optionalString,
  RAILWAY_PUBLIC_DOMAIN: optionalString,
  CORS_ORIGINS: z.string().default(''),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL est requis'),

  ENCRYPTION_KEY: optionalString,
  SESSION_SECRET: optionalString,

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,

  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: booleanish,
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  EMAIL_FROM: z.string().default('MCP Wesype <no-reply@wesype.com>'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  • ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
    .join('\n');
  throw new Error(`Configuration d'environnement invalide :\n${details}`);
}

const raw = parsed.data;
const isProduction = raw.NODE_ENV === 'production';
const isTest = raw.NODE_ENV === 'test';

/**
 * En production, les secrets sont obligatoires. En dev/test on dérive une
 * valeur déterministe : stable entre deux redémarrages (les données chiffrées
 * restent lisibles) mais explicitement marquée comme non sécurisée.
 */
function resolveSecret(name: string, value: string | undefined, requireHex: boolean): string {
  if (value) {
    if (requireHex && !isHex64(value)) {
      throw new Error(
        `${name} doit faire 64 caractères hexadécimaux (32 octets). ` +
          `Générer avec : node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
      );
    }
    if (!requireHex && value.length < 32) {
      throw new Error(`${name} doit faire au moins 32 caractères.`);
    }
    return value;
  }

  if (isProduction) {
    throw new Error(
      `${name} est obligatoire en production. ` +
        `Générer avec : node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }

  return createHash('sha256').update(`mcp-wesype-dev-fallback:${name}`).digest('hex');
}

const encryptionKey = resolveSecret('ENCRYPTION_KEY', raw.ENCRYPTION_KEY, true);
const sessionSecret = resolveSecret('SESSION_SECRET', raw.SESSION_SECRET, false);
const usesFallbackSecrets = !raw.ENCRYPTION_KEY || !raw.SESSION_SECRET;

const isAbsoluteHttpUrl = (value: string | undefined): value is string =>
  typeof value === 'string' && /^https?:\/\/[^\s/]+/.test(value);

function resolveBaseUrl(): string {
  const explicit = isAbsoluteHttpUrl(raw.APP_BASE_URL)
    ? raw.APP_BASE_URL
    : isAbsoluteHttpUrl(raw.BASE_URL)
      ? raw.BASE_URL
      : undefined;

  if (explicit) return explicit.replace(/\/+$/, '');
  if (raw.RAILWAY_PUBLIC_DOMAIN) return `https://${raw.RAILWAY_PUBLIC_DOMAIN}`;

  if (isProduction) {
    throw new Error(
      'APP_BASE_URL doit être une URL absolue en production (ex. https://mcp.wesype.com). ' +
        'Sans elle, les URLs MCP remises aux utilisateurs seraient inutilisables.',
    );
  }
  return `http://localhost:${raw.PORT}`;
}

const baseUrl = resolveBaseUrl();

const corsOrigins = raw.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

// L'origine du serveur lui-même est toujours autorisée (SPA servie par Express).
if (!corsOrigins.includes(baseUrl)) corsOrigins.push(baseUrl);

const googleOAuth =
  raw.GOOGLE_CLIENT_ID && raw.GOOGLE_CLIENT_SECRET
    ? {
        enabled: true as const,
        clientId: raw.GOOGLE_CLIENT_ID,
        clientSecret: raw.GOOGLE_CLIENT_SECRET,
        redirectUri: `${baseUrl}/api/auth/google/callback`,
      }
    : { enabled: false as const };

const smtp = raw.SMTP_HOST
  ? {
      enabled: true as const,
      host: raw.SMTP_HOST,
      port: raw.SMTP_PORT,
      secure: raw.SMTP_SECURE ?? raw.SMTP_PORT === 465,
      user: raw.SMTP_USER,
      password: raw.SMTP_PASSWORD,
      from: raw.EMAIL_FROM,
    }
  : { enabled: false as const };

export const env = {
  nodeEnv: raw.NODE_ENV,
  isProduction,
  isTest,
  port: raw.PORT,
  logLevel: raw.LOG_LEVEL,
  baseUrl,
  corsOrigins,
  databaseUrl: raw.DATABASE_URL,
  encryptionKey,
  sessionSecret,
  usesFallbackSecrets,
  googleOAuth,
  smtp,

  /** Durées de vie, regroupées pour être ajustables d'un seul endroit. */
  ttl: {
    sessionDays: 30,
    passwordResetMinutes: 60,
    oauthStateMinutes: 10,
    toolInvocationRetentionDays: 30,
    /**
     * Au-delà, une inscription dynamique jamais utilisée est considérée morte.
     *
     * Entre l'inscription d'un client et le consentement, il s'écoule quelques
     * secondes. Vingt-quatre heures laissent une marge sans commune mesure avec
     * le cas réel, tout en évitant que la table n'accumule indéfiniment les
     * tentatives abandonnées.
     */
    orphanClientHours: 24,
  },
} as const;

export type Env = typeof env;

/**
 * Application OAuth d'un connecteur (« couche B »).
 *
 * Ces secrets ne peuvent pas être déclarés dans le schéma ci-dessus : leur
 * nombre dépend des connecteurs présents, qui sont découverts après le
 * chargement de la configuration. On les lit donc à la demande, en gardant la
 * règle « un seul fichier touche process.env ».
 *
 * Renvoie `null` si l'application n'est pas configurée — le connecteur
 * concerné apparaîtra alors désactivé dans le catalogue, sans faire échouer
 * le démarrage.
 */
export function connectorOAuthApp(
  prefix: string,
): { clientId: string; clientSecret: string } | null {
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
