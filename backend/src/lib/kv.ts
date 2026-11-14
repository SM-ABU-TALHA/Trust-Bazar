import { getRedis } from './redis.js';

/** Minimal key-value contract used by OTP and recovery flows (Redis in prod). */
export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Fixed-window counter; TTL is set on the first increment. */
  incr(key: string, ttlSec: number): Promise<number>;
}

/** Degraded-mode fallback (Redis down): process-local with expiry. */
export function memoryKv(): KvStore {
  const store = new Map<string, { value: string; expiresAt: number }>();

  const read = (key: string): string | null => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry.value;
  };

  return {
    async get(key) {
      return read(key);
    },
    async set(key, value, ttlSec) {
      store.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
    },
    async del(key) {
      store.delete(key);
    },
    async incr(key, ttlSec) {
      const existing = store.get(key);
      const alive = existing !== undefined && existing.expiresAt > Date.now();
      const next = Number(await read(key) ?? '0') + 1;
      store.set(key, {
        value: String(next),
        expiresAt: alive ? existing.expiresAt : Date.now() + ttlSec * 1000,
      });
      return next;
    },
  };
}

/**
 * Redis-first store with an in-process fallback. Reads the client lazily so a
 * late Redis connection (or an outage) never blocks boot (Architecture §3.7).
 */
export function createKv(): KvStore {
  const memory = memoryKv();

  return {
    async get(key) {
      const redis = getRedis();
      if (!redis) return memory.get(key);
      try {
        return await redis.get(key);
      } catch {
        return memory.get(key);
      }
    },
    async set(key, value, ttlSec) {
      const redis = getRedis();
      if (redis) {
        try {
          await redis.set(key, value, 'EX', ttlSec);
          return;
        } catch {
          // fall through to memory
        }
      }
      await memory.set(key, value, ttlSec);
    },
    async del(key) {
      const redis = getRedis();
      if (redis) {
        try {
          await redis.del(key);
        } catch {
          // memory cleanup below still runs
        }
      }
      await memory.del(key);
    },
    async incr(key, ttlSec) {
      const redis = getRedis();
      if (redis) {
        try {
          const count = await redis.incr(key);
          if (count === 1) await redis.expire(key, ttlSec);
          return count;
        } catch {
          // fall through to memory
        }
      }
      return memory.incr(key, ttlSec);
    },
  };
}
