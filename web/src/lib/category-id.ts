import { createHash } from 'node:crypto';

/**
 * Server-only. `categories._id` is derived deterministically from the slug in
 * `backend/scripts/seed.ts` (sha256(slug) → first 24 hex chars). Mirroring it
 * here lets the storefront resolve `/category/[slug]` without a new endpoint.
 *
 * Keep this file out of client components — `categories.ts` is the safe one.
 */
export function categoryObjectId(slug: string): string {
  return createHash('sha256').update(slug).digest('hex').slice(0, 24);
}
