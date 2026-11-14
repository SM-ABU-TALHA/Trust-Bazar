import { Redis } from 'ioredis';

let client: Redis | null = null;

/** Fail-soft: Redis outage → degraded mode (rate-limit/idempotency fall back to memory). */
export function initRedis(url: string, onFailure: (message: string) => void): Redis | null {
  client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 4_000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  });
  client.on('error', () => undefined); // handled via connection promise
  client.connect().catch((error: unknown) => {
    onFailure(error instanceof Error ? error.message : String(error));
    client?.disconnect();
    client = null;
  });
  return client;
}

export function getRedis(): Redis | null {
  return client;
}

export async function closeRedis(): Promise<void> {
  client?.disconnect();
  client = null;
}
