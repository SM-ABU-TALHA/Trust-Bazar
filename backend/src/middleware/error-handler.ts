import type { ErrorRequestHandler } from 'express';
import type { Logger } from '../lib/logger.js';
import { AppError, toProblem } from '../lib/errors.js';

/**
 * Step 9 — final error mapping (API_spec §0.5). AppError instances keep
 * their contract; anything else is logged with the requestId and returned
 * as a stack-trace-free 500 in production.
 */
export function errorHandler(
  logger: Logger,
  isProd: boolean,
): ErrorRequestHandler {
  return (error, req, res, _next) => {
    const requestId = String(req.id);
    const { status, body, headers } = toProblem(error, requestId, isProd);

    const logContext = { requestId, method: req.method, path: req.path, status };
    if (error instanceof AppError && status < 500) {
      logger.warn({ ...logContext, type: error.type }, error.message);
    } else {
      logger.error({ ...logContext, err: error }, 'unhandled error');
    }

    if (headers) {
      for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    }
    res.status(status).contentType('application/problem+json').json(body);
  };
}
