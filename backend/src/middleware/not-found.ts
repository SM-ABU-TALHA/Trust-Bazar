import type { RequestHandler } from 'express';
import { err } from '../lib/errors.js';

/** Unknown routes inside /api/v1 — RFC-7807 404 with requestId. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(err.notFound(`${req.method} ${req.path}`));
};
