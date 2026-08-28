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

/**
 * Masque les secrets qu'une URL peut transporter, avant journalisation.
 *
 * La liste `redact` ci-dessus couvre les en-têtes — pas les URL. Or deux
 * parcours font transiter un secret dans l'URL même :
 *
 *  • le chemin de repli MCP : `/mcp/gmail/mcp_<jeton>` — l'URL *est* l'accès ;
 *  • le lien de réinitialisation : `/reinitialiser-mot-de-passe?token=rst_…`.
 *
 * Sans masquage, chaque requête déposait son jeton en clair dans les journaux
 * de l'hébergeur : quiconque lit les logs pouvait rejouer l'accès. Les jetons
 * hachés en base ne protègent de rien si les logs en gardent l'original.
 */
export function maskSensitiveUrl(url: string): string {
  return (
    url
      // Segment de chemin qui est un jeton (préfixes émis par generateToken).
      .replace(/\/(mcp|wsp|rst)_[A-Za-z0-9_-]+/g, '/[jeton]')
      // Paramètres de requête porteurs de secrets, quel que soit le chemin.
      .replace(/([?&](?:token|code|state|demande)=)[^&#]+/gi, '$1[masqué]')
  );
}
