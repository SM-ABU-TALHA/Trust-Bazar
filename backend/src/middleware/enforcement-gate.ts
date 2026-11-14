import type { RequestHandler } from 'express';
import { err } from '../lib/errors.js';

/**
 * Paths a suspended/banned user may still reach (PRD Appendix B):
 * logout, own profile, appeals, support tickets and notifications —
 * the escape hatches required while enforcement is active.
 */
const ALLOWLIST = [
  /^\/api\/v1\/auth\/logout$/,
  /^\/api\/v1\/account\/profile$/,
  /^\/api\/v1\/appeals(\/.*)?$/,
  /^\/api\/v1\/support\/tickets(\/.*)?$/,
  /^\/api\/v1\/me\/support\/tickets$/,
  /^\/api\/v1\/notifications(\/.*)?$/,
];

/** Step 4 — suspended/banned short-circuit. */
export const enforcementGate: RequestHandler = (req, _res, next) => {
  const state = req.user?.enforcement.state;
  if (!state || state === 'none' || state === 'warned') return next();
  if (ALLOWLIST.some((pattern) => pattern.test(req.path))) return next();
  next(err.enforcementBlocked(state, req.user?.enforcement.until));
};
