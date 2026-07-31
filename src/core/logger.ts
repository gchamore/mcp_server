import { pino } from 'pino';
import { env } from './env.js';

/**
 * Journalisation structurée. La liste `redact` est la ligne de défense contre
 * la fuite de secrets dans les logs — le serveur manipule des clés API tierces,
 * un `console.log(headers)` mal placé suffit à les publier.
 */
const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'credentials',
  '*.credentials',
  'apiKey',
  '*.apiKey',
  'accessKey',
  '*.accessKey',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'clientSecret',
  '*.clientSecret',
];

export const logger = pino({
  level: env.logLevel,
  redact: { paths: redactPaths, censor: '[redacted]' },
  base: { service: 'mcp-wesype' },
  ...(env.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        },
      }),
});

export type Logger = typeof logger;

/** Masque un secret pour l'affichage : "sk_live_abcd1234" → "sk_l…1234". */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 8) return '…';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
