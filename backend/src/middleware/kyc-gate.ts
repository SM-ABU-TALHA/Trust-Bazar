import type { RequestHandler } from 'express';
import { err } from '../lib/errors.js';

/**
 * Capability gate for KYC-protected actions (PRD §3.1): chat requires a
 * verified buyer, listing creation requires a verified seller. Roles are
 * carried in the access token, so the client refreshes after approval.
 */
export function requireKyc(scope: 'buyer' | 'seller'): RequestHandler {
  const required = scope === 'seller' ? 'seller' : 'verifiedBuyer';
  return (req, _res, next) => {
    const roles = req.user?.roles ?? [];
    if (!roles.includes(required)) {
      next(err.forbidden('kyc_required'));
      return;
    }
    next();
  };
}
