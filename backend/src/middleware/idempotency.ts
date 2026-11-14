import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Db } from 'mongodb';
import { err } from '../lib/errors.js';

export interface IdempotencyRecord {
  payloadHash: string;
  status: number;
  body: unknown;
}

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null>;
  set(key: string, record: IdempotencyRecord): Promise<void>;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TTL_MS = 24 * 60 * 60 * 1000; // 24h (API_spec conventions)

/** Production store — `idempotencyKeys` collection (TTL index on expiresAt). */
export function mongoIdempotencyStore(db: Db): IdempotencyStore {
  const coll = db.collection('idempotencyKeys');
  return {
    async get(key) {
      const doc = await coll.findOne<{ payloadHash: string; status: number; body: unknown }>({
        _id: key as never,
      });
      return doc ? { payloadHash: doc.payloadHash, status: doc.status, body: doc.body } : null;
    },
    async set(key, record) {
      await coll.updateOne(
        { _id: key as never },
        {
          $setOnInsert: {
            ...record,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + TTL_MS),
          },
        },
        { upsert: true },
      );
    },
  };
}

/** Test / degraded-mode store. */
export function memoryIdempotencyStore(): IdempotencyStore {
  const map = new Map<string, IdempotencyRecord>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, record) {
      map.set(key, record);
    },
  };
}

function hashPayload(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

/**
 * Step 6 — replay-safe mutations (API_spec §0.5 / Appendix B).
 * Same key + same payload → cached response replayed. Same key + different
 * payload → 409 idempotency_replay. Missing key on a mutation → 400.
 */
export function idempotency(store: IdempotencyStore): RequestHandler {
  return async (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();

    const key = req.header('idempotency-key');
    if (!key) return next(err.badRequest('Missing Idempotency-Key header'));

    try {
      const payloadHash = hashPayload(req.body);
      const existing = await store.get(key);
      if (existing) {
        if (existing.payloadHash !== payloadHash) return next(err.idempotencyReplay());
        res.setHeader('Idempotency-Replayed', 'true');
        return res.status(existing.status).json(existing.body);
      }

      // Capture the first successful response and cache it.
      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        if (res.statusCode < 500) {
          store.set(key, { payloadHash, status: res.statusCode, body }).catch(() => undefined);
        }
        return originalJson(body);
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
