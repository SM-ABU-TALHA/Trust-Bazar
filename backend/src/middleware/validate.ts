import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';
import type { ApiFieldError } from '@trust/shared/types';
import { err } from '../lib/errors.js';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function toFieldErrors(error: z.ZodError): ApiFieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    code: issue.code,
    message: issue.message,
  }));
}

/**
 * Step 7 — zod validation; parsed values replace the raw input so
 * controllers only ever see contract-shaped data (PRD Appendix C).
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    const failures: ApiFieldError[] = [];
    for (const part of ['body', 'query', 'params'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (!result.success) {
        failures.push(...toFieldErrors(result.error));
      } else if (part !== 'query') {
        // Express 5 makes req.query a getter — assign only writable parts.
        Object.defineProperty(req, part, { value: result.data, writable: true });
      }
    }
    if (failures.length > 0) return next(err.validation(failures));
    next();
  };
}
