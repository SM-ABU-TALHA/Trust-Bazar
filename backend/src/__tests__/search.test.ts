import mongoose, { Types, type Connection } from 'mongoose';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config/index.js';
import { applyIndexes, applyValidators } from '../db/migrate.js';
import { createDbContext, type DbContext } from '../db/context.js';
import { APP_INDEXES } from '../db/indexes.js';
import { createApp } from '../app.js';
import { loadEnvFile } from '../lib/env.js';
import { memoryKv, type KvStore } from '../lib/kv.js';
import { createLogger } from '../lib/logger.js';
import type { SmsMessage, SmsSender } from '../lib/sms.js';
import { memoryRateLimitStore } from '../middleware/index.js';

loadEnvFile();

const APP_URI = process.env.MONGO_APP_URI;
const canRun = Boolean(APP_URI);

function testUri(uri: string): string {
  const parsed = new URL(uri);
  parsed.pathname = '/trust_bazar_test_search';
  return parsed.toString();
}

const config = {
  NODE_ENV: 'test',
  PORT: 0,
  APP_BASE_URL: 'http://localhost:4000',
  WORKER: false,
  COOKIE_DOMAIN: 'localhost',
  MONGO_APP_URI: APP_URI ?? '',
  MONGO_AUDIT_URI: '',
  REDIS_URL: '',
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-03',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-03',
  PEPPER: 'test-pepper-0123456789',
  ENCRYPTION_KEY: 'c'.repeat(64),
  ATLAS_SEARCH_ENABLED: false,
  ATLAS_SEARCH_INDEX: 'listings_search',
} as unknown as Config;

const outbox: SmsMessage[] = [];
const sms: SmsSender = {
  async send(message) {
    outbox.push(message);
    return { provider: 'test' };
  },
};

let conn: Connection;
let testDb: NonNullable<Connection['db']>;
let db: DbContext;
let kv: KvStore;
let app: Express;

beforeAll(async () => {
  if (!APP_URI) return;
  conn = mongoose.createConnection(testUri(APP_URI), {
    autoIndex: false,
    serverSelectionTimeoutMS: 10_000,
  });
  await conn.asPromise();
  const native = conn.db;
  if (!native) throw new Error('test connection has no native Db handle');
  testDb = native;

  await testDb.dropDatabase();
  await applyIndexes(testDb, APP_INDEXES);
  await applyValidators(testDb);
  db = createDbContext(conn);
}, 120_000);

afterAll(async () => {
  if (!canRun) return;
  await testDb.dropDatabase();
  await conn.close();
}, 60_000);

beforeEach(async () => {
  if (!canRun) return;
  for (const model of Object.values(db.models)) {
    if (model.collection.collectionName !== 'auditEvents') {
      await model.deleteMany({});
    }
  }
  outbox.length = 0;
  kv = memoryKv();
  app = createApp(config, createLogger(config), {
    appDb: () => testDb,
    repos: db.repos,
    kv,
    sms,
    rateStore: memoryRateLimitStore(),
  });
});

async function makeCategory(overrides: Record<string, unknown> = {}) {
  const doc = await db.models.Category.create({
    slug: `cat-${new Types.ObjectId().toString()}`,
    name: { bn: 'মোবাইল', en: 'Mobile' },
    districts: ['Dhaka'],
    ...overrides,
  });
  return String(doc._id);
}

async function makeMedia(): Promise<Types.ObjectId> {
  const doc = await db.models.MediaObject.create({
    ownerId: new Types.ObjectId(),
    purpose: 'listing',
    r2Key: `test/${new Types.ObjectId().toString()}.jpg`,
    status: 'clean',
    width: 1200,
    height: 900,
  });
  return doc._id as unknown as Types.ObjectId;
}

async function makeListing(
  categoryId: string,
  overrides: Record<string, unknown> = {},
  mediaId?: Types.ObjectId,
) {
  const media = mediaId ?? (await makeMedia());
  const doc = await db.models.Listing.create({
    sellerId: new Types.ObjectId(),
    categoryId: new Types.ObjectId(categoryId),
    title: 'iPhone 12 Pro 128GB excellent condition',
    description: 'Original box and charger included, no scratches at all.',
    price: 45_000,
    condition: 'good',
    mediaIds: [media],
    location: { district: 'Dhaka', geo: { type: 'Point', coordinates: [90.4125, 23.8103] } },
    status: 'active',
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
    version: 0,
    stats: { views: 0, chatStarts: 0, callTaps: 0, favorites: 0 },
    ...overrides,
  });
  return String(doc._id);
}

function search(query: Record<string, string | number>) {
  return request(app).get('/api/v1/listings/search').query(query);
}

describe.skipIf(!canRun)('search (live Atlas, trust_bazar_test_search)', () => {
  it('returns only active listings and finds Bangla queries (degraded)', async () => {
    const category = await makeCategory();
    await makeListing(category, { title: 'মোবাইল ফোন iPhone 12 128GB', description: 'ভালো অবস্থায় আছে, কোনো সমস্যা নেই।' });
    await makeListing(category, { title: 'মোবাইল ফোন iPhone 12 draft', status: 'draft' });
    await makeListing(category, { title: 'মোবাইল ফোন iPhone 12 sold', status: 'sold' });
    await makeListing(category, { title: 'মোবাইল ফোন iPhone 12 delisted', status: 'delisted' });

    const bangla = await search({ q: 'মোবাইল' });
    expect(bangla.status, JSON.stringify(bangla.body)).toBe(200);
    expect(bangla.headers['x-degraded']).toBe('search');
    expect(bangla.body.meta.total).toBe(1);
    expect(bangla.body.data[0].title).toContain('iPhone 12');

    const english = await search({ q: 'iphone' });
    expect(english.body.meta.total).toBe(1);

    const elsewhere = await search({ q: 'iPhone', district: 'Chattogram' });
    expect(elsewhere.body.meta.total).toBe(0);
  }, 60_000);

  it('filters by category, condition and price range', async () => {
    const mobile = await makeCategory();
    const laptop = await makeCategory({ slug: 'laptops', name: { bn: 'ল্যাপটপ', en: 'Laptop' } });

    await makeListing(mobile, { price: 10_000, condition: 'new' });
    await makeListing(mobile, { price: 20_000, condition: 'good' });
    await makeListing(mobile, { price: 30_000, condition: 'good' });
    await makeListing(laptop, { price: 20_000, condition: 'good' });

    const ranged = await search({ minPrice: 15_000, maxPrice: 25_000 });
    expect(ranged.body.meta.total).toBe(2);
    expect(ranged.body.data.map((item: { price: number }) => item.price)).toEqual([20_000, 20_000]);

    const inMobile = await search({ categoryId: mobile, minPrice: 15_000, maxPrice: 25_000 });
    expect(inMobile.body.meta.total).toBe(1);

    const onlyNew = await search({ condition: 'new' });
    expect(onlyNew.body.meta.total).toBe(1);
  }, 60_000);

  it('injects boosted listings above organic results', async () => {
    const category = await makeCategory();
    await makeListing(category, { title: 'Organic listing one for sale' });
    const boostedId = await makeListing(category, {
      title: 'Boosted listing two for sale',
      boost: { active: true, until: new Date(Date.now() + 86_400_000) },
    });
    await makeListing(category, { title: 'Organic listing three for sale' });

    const res = await search({ q: 'listing', sort: 'date_desc' });
    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(boostedId);
    expect(res.body.data[0].boosted).toBe(true);
  });

  it('paginates and rejects an out-of-range limit', async () => {
    const category = await makeCategory();
    const media = await makeMedia();
    await Promise.all(
      Array.from({ length: 12 }, () =>
        makeListing(category, { title: 'iPhone 12 Pro 128GB excellent condition' }, media),
      ),
    );

    const page2 = await search({ q: 'iPhone', page: 2, limit: 5, sort: 'price_asc' });
    expect(page2.status).toBe(200);
    expect(page2.body.data).toHaveLength(5);
    expect(page2.body.meta).toMatchObject({ page: 2, limit: 5, total: 12 });

    const tooBig = await search({ limit: 500 });
    expect(tooBig.status).toBe(400);
  }, 60_000);

  it('caches trending per district for 10 minutes', async () => {
    const category = await makeCategory();
    await makeListing(category, { title: 'Dhaka mobile one for sale', stats: { views: 10 } });
    await makeListing(category, { title: 'Dhaka mobile two for sale', stats: { views: 5 } });
    await makeListing(category, {
      title: 'Chattogram mobile three for sale',
      location: { district: 'Chattogram', geo: { type: 'Point', coordinates: [91.8, 22.3] } },
      stats: { views: 100 },
    });

    const first = await request(app).get('/api/v1/listings/trending?district=Dhaka&limit=5');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.data.map((item: { district: string }) => item.district)).toEqual([
      'Dhaka',
      'Dhaka',
    ]);

    // A new listing appears, but the 10-minute snapshot is still served.
    await makeListing(category, { title: 'Dhaka mobile four for sale' });
    const cached = await request(app).get('/api/v1/listings/trending?district=Dhaka&limit=5');
    expect(cached.body.data).toHaveLength(2);
  }, 60_000);

  it('returns null price baseline below 20 samples, percentiles above', async () => {
    const category = await makeCategory({
      priceBaseline: { p25: 12_000, p50: 18_000, p75: 25_000 },
    });
    const media = await makeMedia();
    await Promise.all(
      Array.from({ length: 3 }, () => makeListing(category, { price: 18_000 }, media)),
    );

    const sparse = await request(app).get(
      `/api/v1/listings/price-baseline?categoryId=${category}`,
    );
    expect(sparse.status, JSON.stringify(sparse.body)).toBe(200);
    expect(sparse.body.data).toBeNull();

    await Promise.all(
      Array.from({ length: 20 }, () => makeListing(category, { price: 18_000 }, media)),
    );
    const full = await request(app).get(`/api/v1/listings/price-baseline?categoryId=${category}`);
    expect(full.status).toBe(200);
    expect(full.body.data).toMatchObject({
      p25: 12_000,
      p50: 18_000,
      p75: 25_000,
      sampleSize: 23,
    });
  }, 60_000);

  it('treats regex metacharacters in the query as plain text', async () => {
    const category = await makeCategory();
    await makeListing(category, { title: 'iPhone (12) Pro 128GB excellent condition' });

    const res = await search({ q: 'iPhone (12)' });
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
  });
});
