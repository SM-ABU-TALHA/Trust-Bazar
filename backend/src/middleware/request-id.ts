import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Step 1 — correlation ID on every request; echoed back as X-Request-Id. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.id = incoming && incoming.length <= 64 ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
