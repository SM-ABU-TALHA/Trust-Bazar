/** Rate limits — source: PRD v1.7.1 NFR-04b table. */
export interface RateLimitRule {
  readonly action: string;
  /** Authenticated quota, `null` = not allowed. */
  readonly authenticated: { readonly max: number; readonly window: string } | null;
  /** Guest quota, `null` = blocked. */
  readonly guest: { readonly max: number; readonly window: string } | null;
}

export const RATE_LIMITS: readonly RateLimitRule[] = [
  { action: 'otp_request', authenticated: { max: 5, window: '1d' }, guest: null },
  { action: 'otp_verify', authenticated: { max: 5, window: '5m' }, guest: null },
  {
    action: 'search',
    authenticated: { max: 60, window: '1m' },
    guest: { max: 20, window: '1m' },
  },
  { action: 'listing_create', authenticated: { max: 10, window: '1d' }, guest: null },
  { action: 'chat_message', authenticated: { max: 30, window: '1m' }, guest: null },
  { action: 'thread_create', authenticated: { max: 20, window: '1d' }, guest: null },
  { action: 'phone_reveal', authenticated: { max: 20, window: '1d' }, guest: null },
  { action: 'offer_send', authenticated: { max: 20, window: '1d' }, guest: null },
  { action: 'report_create', authenticated: { max: 5, window: '1d' }, guest: null },
  { action: 'boost_purchase', authenticated: { max: 10, window: '1d' }, guest: null },
] as const;

/** Redis key builder — keeps bucket naming identical in API and workers. */
export function rateLimitKey(action: string, subject: string): string {
  return `rl:${action}:${subject}`;
}
