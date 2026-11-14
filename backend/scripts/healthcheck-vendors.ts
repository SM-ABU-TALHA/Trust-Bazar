/**
 * healthcheck-vendors.ts — probes every external dependency and prints a table.
 *
 * Core infra (Mongo app, Mongo audit, Redis) → must be OK, else exit 1.
 * Vendors (Porichoy, SMS×2, bKash, Nagad, FCM, R2, Wasabi) → OK / SKIP
 * (no credentials yet) / FAIL. SKIP never fails the run — vendor sandbox
 * setup is an external action tracked in Pre-Launch_Actions.md.
 * Run: pnpm -C backend healthcheck
 */
import { MongoClient } from 'mongodb';
import { Redis } from 'ioredis';
import { loadEnvFile, probeEnv, requireEnv } from '../src/lib/env.js';

type Status = 'OK' | 'SKIP' | 'FAIL';

interface CheckResult {
  readonly name: string;
  readonly status: Status;
  readonly detail: string;
}

const HTTP_TIMEOUT_MS = 4_000;

async function checkMongo(name: string, uri: string): Promise<CheckResult> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: HTTP_TIMEOUT_MS });
  try {
    await client.connect();
    await client.db().command({ ping: 1 });
    return { name, status: 'OK', detail: 'ping ok' };
  } catch (error) {
    return { name, status: 'FAIL', detail: message(error) };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function checkRedis(url: string): Promise<CheckResult> {
  const redis = new Redis(url, {
    lazyConnect: true,
    connectTimeout: HTTP_TIMEOUT_MS,
    maxRetriesPerRequest: 0,
  });
  try {
    await redis.connect();
    const pong = await redis.ping();
    return { name: 'Redis (Upstash)', status: 'OK', detail: pong };
  } catch (error) {
    return { name: 'Redis (Upstash)', status: 'FAIL', detail: message(error) };
  } finally {
    redis.disconnect();
  }
}

async function checkHttpVendor(
  name: string,
  baseUrl: string | undefined,
  requiredKeys: readonly string[],
): Promise<CheckResult> {
  const probe = probeEnv(requiredKeys);
  if (!baseUrl || probe.missing.length > 0) {
    return {
      name,
      status: 'SKIP',
      detail: `missing: ${[...(baseUrl ? [] : ['BASE_URL']), ...probe.missing].join(', ') || 'credentials'}`,
    };
  }
  try {
    // Any HTTP response (even 401/403) proves reachability + DNS + TLS.
    const response = await fetch(baseUrl, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      redirect: 'manual',
    });
    return { name, status: 'OK', detail: `HTTP ${response.status} (reachable)` };
  } catch (error) {
    return { name, status: 'FAIL', detail: message(error) };
  }
}

function checkKeyOnly(name: string, requiredKeys: readonly string[]): CheckResult {
  const probe = probeEnv(requiredKeys);
  if (probe.missing.length > 0) {
    return { name, status: 'SKIP', detail: `missing: ${probe.missing.join(', ')}` };
  }
  return { name, status: 'OK', detail: 'credentials present' };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 120) : String(error);
}

async function main() {
  loadEnvFile();

  const core = requireEnv(['MONGO_APP_URI', 'MONGO_AUDIT_URI', 'REDIS_URL'] as const);

  const results: CheckResult[] = [];
  const coreResults = await Promise.all([
    checkMongo('MongoDB Atlas (app)', core.MONGO_APP_URI),
    checkMongo('MongoDB Atlas (audit)', core.MONGO_AUDIT_URI),
    checkRedis(core.REDIS_URL),
  ]);
  results.push(...coreResults);

  const vendorResults = await Promise.all([
    checkHttpVendor('Porichoy', process.env.PORICHOY_BASE_URL, ['PORICHOY_API_KEY'] as const),
    checkHttpVendor('SMS primary', process.env.SMS_PRIMARY_BASE_URL, [
      'SMS_PRIMARY_API_KEY',
    ] as const),
    checkHttpVendor('SMS secondary', process.env.SMS_SECONDARY_BASE_URL, [
      'SMS_SECONDARY_API_KEY',
    ] as const),
    checkHttpVendor('bKash', process.env.BKASH_BASE_URL, [
      'BKASH_APP_KEY',
      'BKASH_APP_SECRET',
    ] as const),
    checkHttpVendor('Nagad', process.env.NAGAD_BASE_URL, [
      'NAGAD_MERCHANT_ID',
      'NAGAD_MERCHANT_KEY',
    ] as const),
    checkKeyOnly('FCM', ['FCM_SERVER_KEY'] as const),
    checkKeyOnly('Cloudflare R2', [
      'R2_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
    ] as const),
    checkKeyOnly('Wasabi', ['WASABI_ACCESS_KEY_ID', 'WASABI_SECRET_ACCESS_KEY'] as const),
  ]);
  results.push(...vendorResults);

  console.log('\nTrust Bazar — dependency healthcheck\n');
  for (const r of results) {
    const icon = r.status === 'OK' ? '✓' : r.status === 'SKIP' ? '–' : '✗';
    console.log(`  ${icon} ${r.status.padEnd(4)}  ${r.name.padEnd(24)} ${r.detail}`);
  }

  const coreFailed = coreResults.filter((r) => r.status === 'FAIL');
  if (coreFailed.length > 0) {
    console.error(`\nCore infra down: ${coreFailed.map((r) => r.name).join(', ')}`);
    process.exit(1);
  }
  const vendorSkipped = vendorResults.filter((r) => r.status === 'SKIP').length;
  if (vendorSkipped > 0) {
    console.log(
      `\n${vendorSkipped} vendor(s) skipped — fill .env credentials. ` +
        'External setup is tracked in Pre-Launch_Actions.md.',
    );
  }
}

main().catch((error) => {
  console.error('healthcheck failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
