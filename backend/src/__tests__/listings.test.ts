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
  parsed.pathname = '/trust_bazar_test_listings';
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
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-02',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-02',
  PEPPER: 'test-pepper-0123456789',
  ENCRYPTION_KEY: 'b'.repeat(64),
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

function lastCode(): string {
  const message = outbox[outbox.length - 1];
  const match = /code: (\d{6})/.exec(message?.body ?? '');
  if (!match?.[1]) throw new Error('no OTP in the test outbox');
  return match[1];
}

async function login(phone: string, deviceFp = 'device-listing-0001') {
  await kv.del(`otp:cooldown:${phone}`);
  const otp = await request(app).post('/api/v1/auth/otp/request').send({ phone });
  const res = await request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ otpId: otp.body.data.otpId, code: lastCode(), deviceFp, platform: 'web' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { token: String(res.body.data.accessToken), userId: String(res.body.data.user.id) };
}

/** Login, grant roles in Mongo, then re-login so the JWT snapshot carries them. */
async function makeSeller(phone: string, displayName = 'Rahim Uddin') {
  const first = await login(phone, `device-${phone.slice(-6)}-seller-a`);
  await db.models.User.updateOne(
    { _id: new Types.ObjectId(first.userId) },
    {
      $addToSet: { roles: { $each: ['verifiedBuyer', 'seller'] } },
      $set: { 'profile.displayName': displayName },
    },
  );
  const second = await login(phone, `device-${phone.slice(-6)}-seller-b`);
  return { ...second, displayName };
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function makeCategory(overrides: Record<string, unknown> = {}) {
  const doc = await db.models.Category.create({
    slug: `cat-${new Types.ObjectId().toString()}`,
    name: { bn: 'মোবাইল', en: 'Mobile' },
    districts: ['Dhaka'],
    ...overrides,
  });
  return String(doc._id);
}

async function makeMedia(
  ownerId: string,
  overrides: Record<string, unknown> = {},
) {
  const doc = await db.models.MediaObject.create({
    ownerId: new Types.ObjectId(ownerId),
    purpose: 'listing',
    r2Key: `test/${new Types.ObjectId().toString()}.jpg`,
    status: 'clean',
    width: 1200,
    height: 900,
    ...overrides,
  });
  return String(doc._id);
}

function payload(mediaIds: string[], categoryId: string, overrides: Record<string, unknown> = {}) {
  return {
    title: 'iPhone 12 Pro 128GB excellent condition',
    description: 'Original box and charger included, no scratches at all.',
    price: 45_000,
    condition: 'good',
    categoryId,
    district: 'Dhaka',
    geo: { type: 'Point', coordinates: [90.4125, 23.8103] },
    mediaIds,
    ...overrides,
  };
}

async function createListing(
  token: string,
  mediaIds: string[],
  categoryId: string,
  overrides: Record<string, unknown> = {},
) {
  return request(app)
    .post('/api/v1/listings')
    .set(bearer(token))
    .send(payload(mediaIds, categoryId, overrides));
}

describe.skipIf(!canRun)('listings (live Atlas, trust_bazar_test_listings)', () => {
  it('creates a draft with version 0, queued AI scan and a price flag', async () => {
    const seller = await makeSeller('+8801811111101');
    const category = await makeCategory({ priceBaseline: { p25: 10_000, p50: 20_000, p75: 30_000 } });
    const media = await makeMedia(seller.userId);

    const res = await createListing(seller.token, [media], category);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.version).toBe(0);
    expect(res.body.data.aiScan).toMatchObject({ status: 'queued', flags: [] });
    expect(res.body.data.expiresAt).toBeTruthy();

    const mine = await request(app).get('/api/v1/me/listings').set(bearer(seller.token));
    expect(mine.status).toBe(200);
    expect(mine.body.data.total).toBe(1);
    expect(mine.body.data.items[0].status).toBe('draft');
    // 45,000 is above the p75 baseline — advisory only, never blocking.
    expect(mine.body.data.items[0].priceFlags).toEqual({ tooLow: false, tooHigh: true });
  });

  it('rejects non-leaf categories, foreign media and quarantined media', async () => {
    const seller = await makeSeller('+8801811111102');
    const other = await makeSeller('+8801811111103');
    const parent = await makeCategory();
    const child = await makeCategory({ parentId: new Types.ObjectId(parent) });
    const media = await makeMedia(seller.userId);

    const nonLeaf = await createListing(seller.token, [media], parent);
    expect(nonLeaf.status).toBe(400);
    expect(nonLeaf.body.errors[0].message).toBe('category_not_leaf');

    const missing = await createListing(seller.token, [media], new Types.ObjectId().toString());
    expect(missing.status).toBe(400);
    expect(missing.body.errors[0].message).toBe('invalid_category');

    const foreign = await makeMedia(other.userId);
    const notOwned = await createListing(seller.token, [foreign], child);
    expect(notOwned.status).toBe(400);
    expect(notOwned.body.errors[0].message).toBe('media_not_owned');

    const dirty = await makeMedia(seller.userId, { status: 'quarantined' });
    const quarantined = await createListing(seller.token, [dirty], child);
    expect(quarantined.status).toBe(400);
    expect(quarantined.body.errors[0].message).toBe('media_quarantined');

    const buyer = await login('+8801811111104', 'device-listing-buyer');
    const forbidden = await createListing(buyer.token, [media], child);
    expect(forbidden.status).toBe(403);
  });

  it('publishes drafts, sets a 30-day expiry and enforces the 5-active cap', async () => {
    const seller = await makeSeller('+8801811111105');
    const category = await makeCategory();

    const ids: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const media = await makeMedia(seller.userId);
      const created = await createListing(seller.token, [media], category);
      expect(created.status).toBe(201);
      ids.push(created.body.data.id);
    }

    for (let index = 0; index < 5; index += 1) {
      const published = await request(app)
        .post(`/api/v1/listings/${ids[index]}/publish`)
        .set(bearer(seller.token));
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(published.body.data.status).toBe('active');
      const expiry = new Date(published.body.data.expiresAt).getTime();
      expect(expiry).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    }

    const capped = await request(app)
      .post(`/api/v1/listings/${ids[5]}/publish`)
      .set(bearer(seller.token));
    expect(capped.status).toBe(422);
    expect(capped.body.detail).toBe('active_listing_limit');

    // The blocked publish must not mutate the draft.
    const mine = await request(app)
      .get('/api/v1/me/listings?status=draft')
      .set(bearer(seller.token));
    expect(mine.body.data.total).toBe(1);
  }, 60_000);

  it('refuses to publish until the hero photo is clean', async () => {
    const seller = await makeSeller('+8801811111106');
    const category = await makeCategory();
    const scanning = await makeMedia(seller.userId, { status: 'uploaded' });

    const created = await createListing(seller.token, [scanning], category);
    expect(created.status).toBe(201);

    const res = await request(app)
      .post(`/api/v1/listings/${created.body.data.id}/publish`)
      .set(bearer(seller.token));
    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('hero_not_clean');

    const mine = await request(app).get('/api/v1/me/listings').set(bearer(seller.token));
    expect(mine.body.data.items[0].status).toBe('draft');
  });

  it('rejects a stale version without partially writing', async () => {
    const seller = await makeSeller('+8801811111107');
    const category = await makeCategory();
    const created = await createListing(
      seller.token,
      [await makeMedia(seller.userId)],
      category,
    );
    const id = created.body.data.id as string;

    const updated = await request(app)
      .patch(`/api/v1/listings/${id}`)
      .set(bearer(seller.token))
      .send({ version: 0, title: 'iPhone 12 Pro 256GB excellent condition' });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data.version).toBe(1);

    const stale = await request(app)
      .patch(`/api/v1/listings/${id}`)
      .set(bearer(seller.token))
      .send({ version: 0, price: 1_000 });
    expect(stale.status).toBe(409);
    expect(stale.body.detail).toBe('version_conflict');

    const mine = await request(app).get('/api/v1/me/listings').set(bearer(seller.token));
    expect(mine.body.data.items[0].title).toBe('iPhone 12 Pro 256GB excellent condition');
    expect(mine.body.data.items[0].price).toBe(45_000);
  });

  it('is IDOR-safe for reads and mutations', async () => {
    const owner = await makeSeller('+8801811111108');
    const attacker = await makeSeller('+8801811111109');
    const category = await makeCategory();
    const created = await createListing(
      owner.token,
      [await makeMedia(owner.userId)],
      category,
    );
    const id = created.body.data.id as string;

    const read = await request(app).get(`/api/v1/listings/${id}`);
    expect(read.status).toBe(404); // draft is never public

    for (const path of [
      { method: 'post' as const, url: `/api/v1/listings/${id}/publish`, body: {} },
      { method: 'patch' as const, url: `/api/v1/listings/${id}`, body: { version: 0, price: 999 } },
      { method: 'delete' as const, url: `/api/v1/listings/${id}`, body: {} },
      { method: 'post' as const, url: `/api/v1/listings/${id}/renew`, body: {} },
    ]) {
      const res = await request(app)[path.method](path.url)
        .set(bearer(attacker.token))
        .send(path.body);
      expect(res.status, `${path.method} ${path.url}`).toBe(404);
    }
  }, 60_000);

  it('flags duplicate photos and prohibited terms but never blocks', async () => {
    const first = await makeSeller('+8801811111110');
    const second = await makeSeller('+8801811111111');
    const category = await makeCategory();
    const pHash = 'a1b2c3d4e5f60718';

    const original = await createListing(
      first.token,
      [await makeMedia(first.userId, { pHash })],
      category,
    );
    expect(original.status).toBe(201);
    const published = await request(app)
      .post(`/api/v1/listings/${original.body.data.id}/publish`)
      .set(bearer(first.token));
    expect(published.status).toBe(200);

    const stolen = await createListing(
      second.token,
      [await makeMedia(second.userId, { pHash })],
      category,
    );
    expect(stolen.status).toBe(201);
    expect(stolen.body.data.aiScan.flags).toContain('duplicateImage');

    const banned = await createListing(
      second.token,
      [await makeMedia(second.userId)],
      category,
      {
        title: 'Air pistol replica for sale cheap',
        description: 'Brand new air gun with pellets, delivery all over Dhaka.',
      },
    );
    expect(banned.status).toBe(201);
    expect(banned.body.data.aiScan.flags).toContain('prohibitedTerm:pistol');
    expect(banned.body.data.aiScan.flags).toContain('prohibitedTerm:gun');
  }, 60_000);

  it('delists softly and renews an expired listing', async () => {
    const seller = await makeSeller('+8801811111112');
    const category = await makeCategory();
    const created = await createListing(
      seller.token,
      [await makeMedia(seller.userId)],
      category,
    );
    const id = created.body.data.id as string;

    const published = await request(app)
      .post(`/api/v1/listings/${id}/publish`)
      .set(bearer(seller.token));
    expect(published.status).toBe(200);

    const removed = await request(app)
      .delete(`/api/v1/listings/${id}`)
      .set(bearer(seller.token));
    expect(removed.status).toBe(204);

    const gone = await request(app).get(`/api/v1/listings/${id}`);
    expect(gone.status).toBe(404);

    const notRenewable = await request(app)
      .post(`/api/v1/listings/${id}/renew`)
      .set(bearer(seller.token));
    expect(notRenewable.status).toBe(409);

    // Force the published listing into the `expired` state, then renew it.
    const expiredId = (await request(app)
      .get('/api/v1/me/listings')
      .set(bearer(seller.token))).body.data.items[0].id as string;
    await db.models.Listing.updateOne(
      { _id: new Types.ObjectId(expiredId) },
      { $set: { status: 'expired', expiresAt: new Date(Date.now() - 86_400_000) } },
    );

    const renewed = await request(app)
      .post(`/api/v1/listings/${expiredId}/renew`)
      .set(bearer(seller.token));
    expect(renewed.status, JSON.stringify(renewed.body)).toBe(200);
    expect(renewed.body.data.status).toBe('active');
    expect(new Date(renewed.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it('marks sold via chat: unconfirmed deal with a 15-minute undo', async () => {
    const seller = await makeSeller('+8801811111113');
    const buyer = await login('+8801811111114', 'device-listing-buyer2');
    const category = await makeCategory();
    const created = await createListing(
      seller.token,
      [await makeMedia(seller.userId)],
      category,
    );
    const listingId = created.body.data.id as string;
    await request(app).post(`/api/v1/listings/${listingId}/publish`).set(bearer(seller.token));

    const thread = await db.models.Thread.create({
      listingId: new Types.ObjectId(listingId),
      sellerId: new Types.ObjectId(seller.userId),
      buyerId: new Types.ObjectId(buyer.userId),
      state: 'active',
      buyerMsgCount: 2,
    });

    const sold = await request(app)
      .post(`/api/v1/listings/${listingId}/sold`)
      .set(bearer(seller.token))
      .send({ channel: 'chat', threadId: String(thread._id), buyerId: buyer.userId });
    expect(sold.status, JSON.stringify(sold.body)).toBe(201);
    expect(sold.body.data.type).toBe('unconfirmed');
    expect(sold.body.data.undoUntil).toBeTruthy();

    const pending = await db.models.Listing.findById(listingId).lean();
    expect(pending?.status).toBe('pendingConfirm');

    const undone = await request(app)
      .post(`/api/v1/deals/${sold.body.data.dealId}/undo`)
      .set(bearer(seller.token));
    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    expect(undone.body.data.listing.status).toBe('active');

    const again = await request(app)
      .post(`/api/v1/deals/${sold.body.data.dealId}/undo`)
      .set(bearer(seller.token));
    expect(again.status).toBe(404);
  }, 60_000);

  it('blocks chat sales without a buyer message, and supports direct sales', async () => {
    const seller = await makeSeller('+8801811111115');
    const buyer = await login('+8801811111116', 'device-listing-buyer3');
    const category = await makeCategory();
    const created = await createListing(
      seller.token,
      [await makeMedia(seller.userId)],
      category,
    );
    const listingId = created.body.data.id as string;
    await request(app).post(`/api/v1/listings/${listingId}/publish`).set(bearer(seller.token));

    const silentThread = await db.models.Thread.create({
      listingId: new Types.ObjectId(listingId),
      sellerId: new Types.ObjectId(seller.userId),
      buyerId: new Types.ObjectId(buyer.userId),
      state: 'active',
      buyerMsgCount: 0,
    });
    const blocked = await request(app)
      .post(`/api/v1/listings/${listingId}/sold`)
      .set(bearer(seller.token))
      .send({ channel: 'chat', threadId: String(silentThread._id), buyerId: buyer.userId });
    expect(blocked.status).toBe(422);
    expect(blocked.body.detail).toBe('buyer_message_required');

    const direct = await request(app)
      .post(`/api/v1/listings/${listingId}/sold`)
      .set(bearer(seller.token))
      .send({ channel: 'phone' });
    expect(direct.status, JSON.stringify(direct.body)).toBe(201);
    expect(direct.body.data.type).toBe('direct');
    expect(direct.body.data.undoUntil).toBeNull();

    const sold = await db.models.Listing.findById(listingId).lean();
    expect(sold?.status).toBe('sold');

    // Public detail still renders a sold listing, without any phone number.
    const detail = await request(app).get(`/api/v1/listings/${listingId}`);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toContain('+8801811111115');
    expect(detail.body.data.seller).toMatchObject({ verified: true });

    // A second sale is refused while the deal exists.
    const duplicate = await request(app)
      .post(`/api/v1/listings/${listingId}/sold`)
      .set(bearer(seller.token))
      .send({ channel: 'phone' });
    expect(duplicate.status).toBe(409);
  }, 60_000);

  it('hides listings from banned sellers and counts views', async () => {
    const seller = await makeSeller('+8801811111117');
    const category = await makeCategory();
    const created = await createListing(
      seller.token,
      [await makeMedia(seller.userId)],
      category,
    );
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/listings/${id}/publish`).set(bearer(seller.token));

    const first = await request(app).get(`/api/v1/listings/${id}`);
    expect(first.status).toBe(200);
    expect(first.body.data.stats.views).toBe(1);
    expect(first.body.data.media[0].url).toBeTruthy();

    const second = await request(app).get(`/api/v1/listings/${id}`);
    expect(second.body.data.stats.views).toBe(2);

    await db.models.User.updateOne(
      { _id: new Types.ObjectId(seller.userId) },
      { $set: { 'enforcement.state': 'banned' } },
    );
    const hidden = await request(app).get(`/api/v1/listings/${id}`);
    expect(hidden.status).toBe(404);
  });
});
