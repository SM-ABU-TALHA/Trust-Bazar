/**
 * atlas-search.ts — install/update the `listings_search` Atlas Search index.
 *
 * Atlas Admin API uses HTTP Digest auth with programmatic API keys, so this
 * script performs the 401 challenge + digest retry itself (no extra deps).
 *
 * Required env: ATLAS_PUBLIC_KEY, ATLAS_PRIVATE_KEY, ATLAS_GROUP_ID,
 *               ATLAS_CLUSTER_NAME (e.g. "Cluster0")
 * Run: pnpm -C backend atlas:search
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadEnvFile, requireEnv } from '../src/lib/env.js';

const BASE = 'https://cloud.mongodb.com/api/atlas/v1.0';

async function main() {
  loadEnvFile();
  const env = requireEnv([
    'ATLAS_PUBLIC_KEY',
    'ATLAS_PRIVATE_KEY',
    'ATLAS_GROUP_ID',
    'ATLAS_CLUSTER_NAME',
  ] as const);

  const specFile = fileURLToPath(new URL('./atlas-search-index.json', import.meta.url));
  const spec = JSON.parse(await readFile(specFile, 'utf8')) as {
    name: string;
    database: string;
    collectionName: string;
  };
  const indexesUrl =
    `${BASE}/groups/${env.ATLAS_GROUP_ID}/clusters/${encodeURIComponent(env.ATLAS_CLUSTER_NAME)}` +
    `/fts/indexes`;
  const auth = { user: env.ATLAS_PUBLIC_KEY, pass: env.ATLAS_PRIVATE_KEY };

  const existing = (await digestFetch(indexesUrl, auth)) as { indexID: string; name: string }[];
  const current = existing.find((index) => index.name === spec.name);

  if (current) {
    await digestFetch(`${indexesUrl}/${current.indexID}`, auth, 'PATCH', spec);
    console.log(`Atlas Search index "${spec.name}" updated (${current.indexID}).`);
  } else {
    const created = (await digestFetch(indexesUrl, auth, 'POST', spec)) as { indexID: string };
    console.log(`Atlas Search index "${spec.name}" created (${created.indexID}).`);
  }
  console.log('Index builds in the background — check status in the Atlas UI.');
}

interface Credentials {
  user: string;
  pass: string;
}

/** Digest-auth fetch: unauthenticated probe → 401 challenge → signed retry. */
async function digestFetch(
  url: string,
  auth: Credentials,
  method = 'GET',
  body?: unknown,
): Promise<unknown> {
  const probe = await fetch(url, { method });
  if (probe.status !== 401) {
    if (!probe.ok) throw new Error(`Atlas API ${probe.status}: ${await probe.text()}`);
    return probe.status === 204 ? null : probe.json();
  }

  const challenge = parseChallenge(probe.headers.get('www-authenticate') ?? '');
  const userHash = md5(`${auth.user}:${challenge.realm}:${auth.pass}`);
  const uri = new URL(url).pathname + new URL(url).search;
  const requestHash = md5(`${method}:${uri}`);
  const nc = '00000001';
  const cnonce = randomBytes(8).toString('hex');
  const response = md5(
    [userHash, challenge.nonce, nc, cnonce, challenge.qop, requestHash].join(':'),
  );

  const header =
    `Digest username="${auth.user}", realm="${challenge.realm}", nonce="${challenge.nonce}", ` +
    `uri="${uri}", qop=${challenge.qop}, nc=${nc}, cnonce="${cnonce}", response="${response}", ` +
    `algorithm=MD5`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: header,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`Atlas API ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

function parseChallenge(header: string): { realm: string; nonce: string; qop: string } {
  const pick = (key: string) =>
    new RegExp(`${key}="?([^",]+)"?`).exec(header)?.[1] ?? '';
  const qop = pick('qop').split(',')[0]?.trim() || 'auth';
  return { realm: pick('realm'), nonce: pick('nonce'), qop };
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

main().catch((error) => {
  console.error('atlas-search failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
