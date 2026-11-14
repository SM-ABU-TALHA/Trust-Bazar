import type { RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import { RATE_LIMITS } from '@trust/shared/constants';
import { err } from '../lib/errors.js';
import { getRedis } from '../lib/redis.js';

export interface RateLimitStore {
  /** Fixed-window increment; returns count and seconds until window reset. */
  incr(key: string, windowMs: number): Promise<{ count: number; resetInSec: number }>;
}

const WINDOW_MS = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '1d': 86_400_000,
} as const;

type Window = keyof typeof WINDOW_MS;

/** Redis fixed window: INCR + PEXPIRE on first hit. */
export function redisRateLimitStore(redis: Redis): RateLimitStore {
  return {
    async incr(key, windowMs) {
      const count = await redis.incr(key);
      if (count === 1) await redis.pexpire(key, windowMs);
      const ttl = await redis.pttl(key);
      return { count, resetInSec: Math.max(1, Math.ceil(ttl / 1000)) };
    },
  };
}

/** Degraded-mode fallback (Redis down): process-local window. */
export function memoryRateLimitStore(): RateLimitStore {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    async incr(key, windowMs) {
      const now = Date.now();
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      return { count: bucket.count, resetInSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    },
  };
}

/**
 * Redis-first store with a memory fallback — resolves the client lazily so a
 * late/failed Redis connection never breaks rate limiting (Architecture §3.7).
 */
export function createRateLimitStore(): RateLimitStore {
  const memory = memoryRateLimitStore();
  return {
    async incr(key, windowMs) {
      const redis = getRedis();
      if (!redis) return memory.incr(key, windowMs);
      try {
        const count = await redis.incr(key);
        if (count === 1) await redis.pexpire(key, windowMs);
        const ttl = await redis.pttl(key);
        return { count, resetInSec: Math.max(1, Math.ceil(ttl / 1000)) };
      } catch {
        return memory.incr(key, windowMs);
      }
    },
  };
}

interface RuleOverride {
  readonly max: number;
  readonly window: Window;
}

/**
 * Step 2 — per-action quota from PRD NFR-04b (shared RATE_LIMITS table).
 * Key: rl:{action}:{userId|ip}. Guests use the guest quota; auth-only
 * actions skip limiting here (step 3 `auth` rejects them anyway).
 */
export function rateLimit(
  action: string,
  store: RateLimitStore,
  override?: RuleOverride,
): RequestHandler {
  const rule = RATE_LIMITS.find((r) => r.action === action);
  if (!rule && !override) throw new Error(`Unknown rate-limit action: ${action}`);

  return async (req, res, next) => {
    try {
      const quota = override ?? (req.user ? rule?.authenticated : rule?.guest);
      if (!quota) return next(); // auth middleware will reject unauthenticated calls

      const windowMs = WINDOW_MS[quota.window as Window];
      if (!windowMs) throw new Error(`Invalid window: ${quota.window}`);

      const subject = req.user?.id ?? req.ip ?? 'unknown';
      const bucket = Math.floor(Date.now() / windowMs);
      const { count, resetInSec } = await store.incr(`rl:${action}:${subject}:${bucket}`, windowMs);

      res.setHeader('RateLimit-Limit', quota.max);
      res.setHeader('RateLimit-Remaining', Math.max(0, quota.max - count));
      res.setHeader('RateLimit-Reset', resetInSec);
      if (count > quota.max) return next(err.rateLimited(resetInSec));
      next();
    } catch (error) {
      next(error);
    }
  };
}
