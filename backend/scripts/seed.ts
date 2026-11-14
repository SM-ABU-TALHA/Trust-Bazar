/**
 * seed.ts — idempotent seed for categories, districts, boostPackages, config.
 *
 * Non-destructive by design: anything an operator may later edit through the
 * ops console (prices, baselines, config values, `active`) lives in
 * `$setOnInsert`, so re-running never overwrites live values.
 * Run: pnpm -C backend seed
 */
import { createHash } from 'node:crypto';
import { MongoClient, ObjectId, type AnyBulkWriteOperation } from 'mongodb';
import { CATEGORY_SEED, DISTRICTS } from '@trust/shared/constants';
import { loadEnvFile, requireEnv } from '../src/lib/env.js';

/**
 * Categories use a deterministic ObjectId derived from the slug so
 * `listings.categoryId` (ObjectId) can reference them while upserts stay
 * idempotent. Key/value docs (districts, config) keep string `_id`s.
 */
interface SeedDoc {
  _id: string | ObjectId;
  [key: string]: unknown;
}

function seedId(slug: string): ObjectId {
  return new ObjectId(createHash('sha256').update(slug).digest('hex').slice(0, 24));
}

// TODO(business): placeholder launch prices — confirm before go-live.
const BOOST_PACKAGES = [
  { _id: 'boost-3d', durationDays: 3, priceBdt: 99 },
  { _id: 'boost-7d', durationDays: 7, priceBdt: 199 },
  { _id: 'boost-15d', durationDays: 15, priceBdt: 349 },
] as const;

const CONFIG_DOCS = [
  {
    _id: 'minVersion',
    key: 'minVersion',
    value: { web: '1.0.0', android: '1.0.0', ios: '1.0.0' },
  },
  {
    _id: 'featureFlags',
    key: 'featureFlags',
    value: { savedSearchAlerts: true, boostCheckout: true },
  },
  { _id: 'geoLaunch', key: 'geoLaunch', value: { districts: ['Dhaka'] } },
] as const;

async function main() {
  loadEnvFile();
  const env = requireEnv(['MONGO_APP_URI'] as const);

  const client = new MongoClient(env.MONGO_APP_URI, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  try {
    const db = client.db();
    const now = new Date();

    // ── categories (deterministic ObjectId from slug → listings.categoryId) ──
    const categories = db.collection<SeedDoc>('categories');
    const categoryOps: AnyBulkWriteOperation<SeedDoc>[] = CATEGORY_SEED.map((c) => ({
      updateOne: {
        filter: { _id: seedId(c.slug) },
        update: {
          $set: {
            slug: c.slug,
            name: { bn: c.nameBn, en: c.nameEn },
            parentId: c.parentSlug ? seedId(c.parentSlug) : null,
            updatedAt: now,
          },
          // Manual price baselines (PRD: seeded manually, recalibrated 30d)
          // must survive re-seeds → insert-only.
          $setOnInsert: { priceBaseline: null, createdAt: now },
        },
        upsert: true,
      },
    }));
    // 64 districts live on one meta doc (validated against categories.districts).
    categoryOps.push({
      updateOne: {
        filter: { _id: 'districts' },
        update: {
          $set: { districts: DISTRICTS.map((d) => d.name), updatedAt: now },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    });
    const categoryResult = await categories.bulkWrite(categoryOps, { ordered: false });

    // ── boostPackages ──
    const boostPackages = db.collection<SeedDoc>('boostPackages');
    const boostOps: AnyBulkWriteOperation<SeedDoc>[] = BOOST_PACKAGES.map((p) => ({
      updateOne: {
        filter: { _id: p._id },
        update: {
          $setOnInsert: {
            durationDays: p.durationDays,
            priceBdt: p.priceBdt,
            categoryId: null,
            active: true,
            createdAt: now,
          },
          $set: { updatedAt: now },
        },
        upsert: true,
      },
    }));
    const boostResult = await boostPackages.bulkWrite(boostOps, { ordered: false });

    // ── config (key-value docs; ops edits win over re-seeds) ──
    const config = db.collection<SeedDoc>('config');
    const configOps: AnyBulkWriteOperation<SeedDoc>[] = CONFIG_DOCS.map((doc) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $setOnInsert: { key: doc.key, value: doc.value, createdAt: now },
          $set: { updatedAt: now },
        },
        upsert: true,
      },
    }));
    const configResult = await config.bulkWrite(configOps, { ordered: false });

    const [categoryCount, boostCount, configCount] = await Promise.all([
      categories.countDocuments(),
      boostPackages.countDocuments(),
      config.countDocuments(),
    ]);

    console.log('Seed complete (idempotent — counts stable on re-run):');
    console.log(
      `  categories    ${categoryCount} docs (${CATEGORY_SEED.length} categories + districts meta) ` +
        `[upserted ${categoryResult.upsertedCount}, modified ${categoryResult.modifiedCount}]`,
    );
    console.log(
      `  boostPackages ${boostCount} docs ` +
        `[upserted ${boostResult.upsertedCount}, modified ${boostResult.modifiedCount}]`,
    );
    console.log(
      `  config        ${configCount} docs ` +
        `[upserted ${configResult.upsertedCount}, modified ${configResult.modifiedCount}]`,
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
