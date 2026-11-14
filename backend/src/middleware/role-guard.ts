import type { RequestHandler } from 'express';
import type { Role } from '@trust/shared/constants';
import { err } from '../lib/errors.js';

/** Step 5 — capability check against the role matrix (API_spec §0.1). */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(err.unauthenticated());
    if (roles.some((role) => req.user?.roles.includes(role))) return next();
    next(err.forbidden(`Requires role: ${roles.join(' | ')}`));
  };
}
