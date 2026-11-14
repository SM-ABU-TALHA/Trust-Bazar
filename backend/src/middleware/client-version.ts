import type { RequestHandler } from 'express';
import { err } from '../lib/errors.js';

function parts(version: string): number[] {
  return version
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

/** true when `current` is strictly older than `min`. */
export function isVersionBehind(current: string, min: string): boolean {
  const a = parts(current);
  const b = parts(min);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left < right) return true;
    if (left > right) return false;
  }
  return false;
}

/**
 * Client-version gate (API_spec §13): clients that send their version are
 * forced to upgrade once `config.minVersion` moves ahead. Header-less callers
 * (web, curl, tests) are unaffected.
 */
export function clientVersionGate(
  getMinVersion: () => Promise<Record<string, string> | null>,
): RequestHandler {
  return async (req, _res, next) => {
    const platform = req.header('x-app-platform');
    const version = req.header('x-app-version');
    if (!platform || !version) return next();
    // Bootstrap and webhooks must stay reachable while clients upgrade.
    if (req.path === '/config' || req.path.startsWith('/webhooks/')) return next();

    try {
      const minVersion = await getMinVersion();
      const min = minVersion?.[platform];
      if (min && isVersionBehind(version, min)) return next(err.upgradeRequired(min));
    } catch {
      // Config read failure must never take the API down.
    }
    next();
  };
}
