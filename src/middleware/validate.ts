import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../core/errors.js';
import { formatZodIssues } from './error-handler.js';

/**
 * Validation déclarative des entrées. Les handlers reçoivent des données déjà
 * typées et normalisées ; plus aucun `if (!req.body.email)` dispersé dans les
 * contrôleurs.
 *
 *   router.post('/login', validate({ body: loginSchema }), handler)
 *   // dans handler : const { email } = getBody<LoginInput>(req)
 */

type Schemas = {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
};

const VALIDATED = Symbol('validated');

type ValidatedStore = { body?: unknown; query?: unknown; params?: unknown };

export function validate(schemas: Schemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const store: ValidatedStore = {};

    for (const key of ['body', 'query', 'params'] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (!result.success) {
        next(
          new AppError(400, 'VALIDATION_ERROR', 'Données invalides', {
            details: formatZodIssues(result.error),
          }),
        );
        return;
      }
      store[key] = result.data;
    }

    (req as Request & { [VALIDATED]?: ValidatedStore })[VALIDATED] = store;
    next();
  };
}

function read<T>(req: Request, key: keyof ValidatedStore): T {
  const store = (req as Request & { [VALIDATED]?: ValidatedStore })[VALIDATED];
  if (!store || store[key] === undefined) {
    throw new AppError(500, 'INTERNAL_ERROR', `validate() n'a pas été appliqué à req.${key}`);
  }
  return store[key] as T;
}

export const getBody = <T>(req: Request): T => read<T>(req, 'body');
export const getQuery = <T>(req: Request): T => read<T>(req, 'query');
export const getParams = <T>(req: Request): T => read<T>(req, 'params');
