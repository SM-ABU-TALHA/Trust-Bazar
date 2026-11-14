import type { RequestHandler } from 'express';
import type { Config } from '../config/index.js';
import { err } from '../lib/errors.js';
import type { Repositories } from '../repositories/index.js';
import { verifyOperatorToken } from '../services/auth/tokens.js';

export function normalizeIp(ip: string | undefined): string {
  return (ip ?? '').replace(/^::ffff:/, '');
}

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Step 3b — operator bearer check: `typ:'ops'`, active account, IP allowlist
 * (global ∪ per-operator; both empty = allow). Roles are enforced per route.
 */
export function requireOperator(
  config: Config,
  repos: Repositories,
  ...roles: string[]
): RequestHandler {
  const globalAllow = csv(config.OPS_IP_ALLOWLIST);

  return async (req, _res, next) => {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      return next(err.unauthenticated('Missing operator token'));
    }

    try {
      const claims = await verifyOperatorToken(config, header.slice(7));
      const operator = (await repos.operatorAccounts.findById(claims.sub)) as unknown as {
        _id: unknown;
        role: string;
        active?: boolean;
        ipAllowlist?: string[];
      } | null;

      if (!operator || operator.active === false) {
        return next(err.unauthenticated('Operator inactive'));
      }

      const allowlist = [...globalAllow, ...(operator.ipAllowlist ?? [])];
      const ip = normalizeIp(req.ip);
      if (allowlist.length > 0 && !allowlist.includes(ip)) {
        return next(err.forbidden('ip_not_allowed'));
      }

      if (roles.length > 0 && !roles.includes(operator.role)) {
        return next(err.forbidden('operator_role_required'));
      }

      req.operator = { id: String(operator._id), role: operator.role };
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Shared by login and the middleware so the rule lives in one place. */
export function isOperatorIpAllowed(
  config: Config,
  operatorAllowlist: string[] | undefined,
  ip: string | undefined,
): boolean {
  const allowlist = [...csv(config.OPS_IP_ALLOWLIST), ...(operatorAllowlist ?? [])];
  return allowlist.length === 0 || allowlist.includes(normalizeIp(ip));
}
