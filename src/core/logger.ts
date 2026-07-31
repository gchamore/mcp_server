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
