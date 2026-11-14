import { z } from 'zod';

/** Full boot-time config — validated once, then injected everywhere. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  APP_BASE_URL: z.string().url(),
  WORKER: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  COOKIE_DOMAIN: z.string().min(1),

  MONGO_APP_URI: z.string().min(1),
  MONGO_AUDIT_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  PEPPER: z.string().min(16),
  ENCRYPTION_KEY: z.string().length(64),

  // Media storage (PROMPT 07). Local driver is for dev/test only.
  STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
  MEDIA_LOCAL_DIR: z.string().optional(),
  INTERNAL_SECRET: z.string().min(16).optional(),

  // Search (PROMPT 10). Atlas Search is opt-in: when disabled (dev/M0) the
  // endpoint serves the degraded regex/text fallback with `X-Degraded: search`.
  ATLAS_SEARCH_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  ATLAS_SEARCH_INDEX: z.string().default('listings_search'),

  // Vendors — optional until their modules ship (PROMPT 07/08/13).
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_KYC: z.string().optional(),
  R2_BUCKET_LISTINGS: z.string().optional(),
  R2_BUCKET_PROFILE: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
  PORICHOY_BASE_URL: z.string().optional(),
  PORICHOY_API_KEY: z.string().optional(),
  PORICHOY_WEBHOOK_SECRET: z.string().optional(),
  SMS_PRIMARY_BASE_URL: z.string().optional(),
  SMS_PRIMARY_API_KEY: z.string().optional(),
  SMS_PRIMARY_SENDER_ID: z.string().optional(),
  SMS_SECONDARY_BASE_URL: z.string().optional(),
  SMS_SECONDARY_API_KEY: z.string().optional(),
  SMS_SECONDARY_SENDER_ID: z.string().optional(),
  BKASH_BASE_URL: z.string().optional(),
  NAGAD_BASE_URL: z.string().optional(),
  FCM_SERVER_KEY: z.string().optional(),

  // Payments webhooks (PROMPT 13): HMAC secrets + optional IP allowlists.
  BKASH_WEBHOOK_SECRET: z.string().optional(),
  NAGAD_WEBHOOK_SECRET: z.string().optional(),
  BKASH_WEBHOOK_IPS: z.string().optional(),
  NAGAD_WEBHOOK_IPS: z.string().optional(),
  RECON_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(90).default(3),

  // Ops console (PROMPT 16): comma-separated IP allowlist; empty = allow all.
  OPS_IP_ALLOWLIST: z.string().optional(),
});

export type Config = Readonly<z.infer<typeof envSchema>>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${problems}`);
  }
  return Object.freeze(parsed.data);
}
