/**
 * Erreurs applicatives typées. Le gestionnaire d'erreurs Express (voir
 * middleware/error-handler.ts) transforme une AppError en réponse JSON propre,
 * et tout le reste en 500 générique sans fuiter de détail interne.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'FEATURE_DISABLED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  /** true = le message peut être montré tel quel à l'utilisateur final. */
  readonly expose: boolean;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options: { details?: unknown; cause?: unknown; expose?: boolean } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.expose = options.expose ?? status < 500;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'VALIDATION_ERROR', message, { details });

export const unauthenticated = (message = 'Authentification requise') =>
  new AppError(401, 'UNAUTHENTICATED', message);

export const invalidCredentials = (message = 'Email ou mot de passe incorrect') =>
  new AppError(401, 'INVALID_CREDENTIALS', message);

export const forbidden = (message = 'Accès refusé') => new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Ressource introuvable') =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);

export const upstreamError = (message: string, cause?: unknown) =>
  new AppError(502, 'UPSTREAM_ERROR', message, { cause, expose: true });

export const featureDisabled = (message: string) =>
  new AppError(503, 'FEATURE_DISABLED', message, { expose: true });

export const internalError = (message = 'Erreur interne', cause?: unknown) =>
  new AppError(500, 'INTERNAL_ERROR', message, { cause });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Extrait un message lisible de n'importe quelle valeur levée. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Erreur inconnue';
}
