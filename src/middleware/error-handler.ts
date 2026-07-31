import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, isAppError } from '../core/errors.js';
import { logger } from '../core/logger.js';

/**
 * Format d'erreur unique pour toute l'API :
 *   { "error": { "code": "NOT_FOUND", "message": "…", "details": … } }
 * Le front n'a donc qu'une seule forme à gérer.
 */

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route inconnue : ${req.method} ${req.originalUrl}` },
  });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Une réponse déjà commencée (streaming MCP par exemple) ne peut plus être
  // transformée en JSON : on coupe la connexion et on se contente de journaliser.
  if (res.headersSent) {
    logger.error({ err, path: req.originalUrl }, 'Erreur après envoi des en-têtes');
    res.end();
    return;
  }

  const appError = toAppError(err);

  if (appError.status >= 500) {
    logger.error(
      { err, code: appError.code, path: req.originalUrl, method: req.method },
      appError.message,
    );
  } else {
    logger.warn(
      { code: appError.code, path: req.originalUrl, method: req.method },
      appError.message,
    );
  }

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.expose ? appError.message : 'Une erreur interne est survenue',
      ...(appError.details !== undefined ? { details: appError.details } : {}),
    },
  });
};

function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;

  if (err instanceof ZodError) {
    return new AppError(400, 'VALIDATION_ERROR', 'Données invalides', {
      details: formatZodIssues(err),
    });
  }

  // Corps JSON malformé : Express/body-parser lève une SyntaxError avec `status`.
  if (err instanceof SyntaxError && 'status' in err && (err as { status: number }).status === 400) {
    return new AppError(400, 'VALIDATION_ERROR', 'Corps de requête JSON invalide');
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Erreur interne', { cause: err, expose: false });
}

export function formatZodIssues(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  return fields;
}
