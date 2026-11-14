/**
 * migrate.ts — indexes (database.md §4) + $jsonSchema validators (§5).
 * Idempotent: a second run creates 0 indexes and prunes nothing.
 * Run: pnpm -C backend migrate
 */
import { MongoClient } from 'mongodb';
import { loadEnvFile, requireEnv } from '../src/lib/env.js';
import { AUDIT_INDEXES, APP_INDEXES, applyIndexes, applyValidators } from '../src/db/migrate.js';

async function withDb(uri: string, fn: (db: ReturnType<MongoClient['db']>) => Promise<void>) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  try {
    await fn(client.db());
  } finally {
    await client.close();
  }
}

async function main() {
  loadEnvFile();
  const env = requireEnv(['MONGO_APP_URI', 'MONGO_AUDIT_URI'] as const);

  console.log('App cluster — indexes (database.md §4)...');
  let appIndexes = { created: 0, existed: 0, pruned: [] as string[] };
  await withDb(env.MONGO_APP_URI, async (db) => {
    appIndexes = await applyIndexes(db, APP_INDEXES);
  });
  console.log(`app indexes: ${appIndexes.created} created, ${appIndexes.existed} present, ${appIndexes.pruned.length} pruned`);

  console.log('App cluster — $jsonSchema validators (database.md §5)...');
  let validators: string[] = [];
  await withDb(env.MONGO_APP_URI, async (db) => {
    validators = await applyValidators(db);
  });
  console.log(`validators applied: ${validators.join(', ')}`);

  console.log('Audit cluster — indexes...');
  try {
    let auditIndexes = { created: 0, existed: 0, pruned: [] as string[] };
    await withDb(env.MONGO_AUDIT_URI, async (db) => {
      auditIndexes = await applyIndexes(db, AUDIT_INDEXES);
    });
    console.log(
      `audit indexes: ${auditIndexes.created} created, ${auditIndexes.existed} present, ${auditIndexes.pruned.length} pruned`,
    );
  } catch (error) {
    // Audit cluster is optional in dev — boot runs degraded until it exists.
    console.warn(
      `audit cluster skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  console.log('Done. Safe to re-run any time.');
}

main().catch((error) => {
  console.error('migrate failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
