import { Types } from 'mongoose';
import { canonical, sha256 } from '../../lib/crypto.js';
import type { Repositories } from '../../repositories/index.js';

export interface AuditEntry {
  actor: 'user' | 'operator' | 'system';
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Best-effort hash-chained append (Architecture §8). When the audit cluster
 * is not provisioned the repository is `null` and this becomes a no-op, so
 * a missing audit cluster never blocks a user flow. The `seq` race is retried
 * on duplicate-key — the chain only ever grows by one.
 */
export async function appendAudit(repos: Repositories, entry: AuditEntry): Promise<void> {
  const audit = repos.auditEvents;
  if (!audit) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [last] = await audit.find({} as never, { sort: { seq: -1 }, limit: 1 });
    const previous = last as { seq?: number; hash?: string } | undefined;
    const seq = (previous?.seq ?? 0) + 1;

    try {
      await audit.insert({
        seq,
        actor: entry.actor,
        actorId: entry.actorId ? new Types.ObjectId(entry.actorId) : null,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ? new Types.ObjectId(entry.entityId) : null,
        before: entry.before ?? null,
        after: entry.after ?? null,
        prevHash: previous?.hash ?? 'GENESIS',
        hash: '',
        at: new Date(),
      } as never);
      return;
    } catch (error) {
      const duplicate = (error as { code?: number }).code === 11000;
      if (!duplicate || attempt === 2) return;
    }
  }
}

interface AuditDoc {
  _id: Types.ObjectId;
  seq: number;
  prevHash: string;
  hash: string;
  [key: string]: unknown;
}

/**
 * Recomputes the whole chain (`hash = sha256(prevHash + canonical(doc))`).
 * A mutated document no longer matches its stored hash and is reported as
 * `brokenAt` (the sequence number), which the `audit-verify` job alerts on.
 */
export async function verifyChain(
  repos: Repositories,
): Promise<{ ok: boolean; checked: number; brokenAt?: number; degraded?: boolean }> {
  const audit = repos.auditEvents;
  if (!audit) return { ok: true, checked: 0, degraded: true };

  const docs = (await audit.find({} as never, { sort: { seq: 1 } })) as unknown as AuditDoc[];
  for (const doc of docs) {
    // `__v` is added by Mongoose on save and never part of the signed payload.
    const rest: Record<string, unknown> = { ...doc, hash: '' };
    delete rest.__v;
    const expected = sha256(doc.prevHash + canonical(rest));
    if (expected !== doc.hash) return { ok: false, checked: docs.length, brokenAt: doc.seq };
  }
  return { ok: true, checked: docs.length };
}

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

/** Read-only chain view for the ops console (access itself is audited). */
export async function listAudit(repos: Repositories, query: AuditQuery = {}) {
  const audit = repos.auditEvents;
  if (!audit) return [];

  const filter: Record<string, unknown> = {};
  if (query.entityType) filter.entityType = query.entityType;
  if (query.entityId) filter.entityId = new Types.ObjectId(query.entityId);
  if (query.from || query.to) {
    filter.at = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }

  return audit.find(filter as never, {
    sort: { seq: -1 },
    limit: Math.min(query.limit ?? 200, 500),
  });
}
