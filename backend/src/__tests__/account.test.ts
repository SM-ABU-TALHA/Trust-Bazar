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
  parsed.pathname = '/trust_bazar_test_account';
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
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-01',
  PEPPER: 'test-pepper-0123456789',
  ENCRYPTION_KEY: 'a'.repeat(64),
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

async function requestOtp(phone: string) {
  await kv.del(`otp:cooldown:${phone}`);
  const res = await request(app).post('/api/v1/auth/otp/request').send({ phone });
  return { res, code: lastCode(), otpId: String(res.body?.data?.otpId ?? '') };
}

async function login(phone: string, deviceFp = 'device-account-0001') {
  const { code, otpId } = await requestOtp(phone);
  const res = await request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ otpId, code, deviceFp, platform: 'web' });
  expect(res.status).toBe(200);
  return {
    token: String(res.body.data.accessToken),
    userId: String(res.body.data.user.id),
  };
}

function authGet(token: string, path: string) {
  return request(app).get(path).set('Authorization', `Bearer ${token}`);
}

async function makeMedia(ownerId: string, purpose: string, status: string) {
  const doc = await db.models.MediaObject.create({
    ownerId: new Types.ObjectId(ownerId),
    purpose,
    r2Key: `test/${new Types.ObjectId().toString()}.jpg`,
    status,
  });
  return { _id: String(doc._id) as unknown as Types.ObjectId };
}

async function makeListing(sellerId: string, overrides: Record<string, unknown> = {}) {
  const media = await makeMedia(sellerId, 'listing', 'clean');
  const doc = await db.models.Listing.create({
    sellerId: new Types.ObjectId(sellerId),
    categoryId: new Types.ObjectId(),
    title: 'iPhone 12 Pro 128GB excellent condition',
    description: 'Original box and charger included, no scratches at all.',
    price: 45_000,
    condition: 'good',
    mediaIds: [media._id],
    location: { district: 'Dhaka', geo: { type: 'Point', coordinates: [90.4125, 23.8103] } },
    status: 'active',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    version: 0,
    ...overrides,
  });
  return { _id: doc._id as unknown as Types.ObjectId };
}

describe.skipIf(!canRun)('account (live Atlas, trust_bazar_test_account)', () => {
  it('returns the profile and updates the display name', async () => {
    const { token } = await login('+8801711111111');

    const me = await authGet(token, '/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.data.phone).toBe('+8801711111111');
    expect(me.body.data.notificationPrefs).toMatchObject({ lang: 'bn' });
    expect(me.body.data.deletion).toBeNull();

    const updated = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Rahim Uddin' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.profile.displayName).toBe('Rahim Uddin');
  });

  it('rejects impersonating display names with validation_failed', async () => {
    const { token } = await login('+8801711111112');

    const res = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Trust Bazar Support' });

    expect(res.status).toBe(400);
    expect(res.body.type).toContain('validation_failed');
    expect(res.body.errors[0]).toMatchObject({ field: 'displayName' });
  });

  it('only accepts an owned, clean profile photo', async () => {
    const owner = await login('+8801711111113');
    const other = await login('+8801711111114');

    const foreign = await makeMedia(other.userId, 'profile', 'clean');
    const notMine = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ photoMediaId: foreign._id.toString() });
    expect(notMine.status).toBe(404);

    const quarantined = await makeMedia(owner.userId, 'profile', 'quarantined');
    const dirty = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ photoMediaId: quarantined._id.toString() });
    expect(dirty.status).toBe(422);
    expect(dirty.body.detail).toBe('media_not_clean');

    const clean = await makeMedia(owner.userId, 'profile', 'clean');
    const ok = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ photoMediaId: clean._id.toString() });
    expect(ok.status).toBe(200);
    expect(ok.body.data.profile.photoMediaId).toBe(clean._id.toString());
  });

  it('persists notification preferences and gates seller prefs by role', async () => {
    const { token, userId } = await login('+8801711111115');

    const prefs = await request(app)
      .patch('/api/v1/me/notification-prefs')
      .set('Authorization', `Bearer ${token}`)
      .send({ push: false, sms: true, digest: true, lang: 'en' });
    expect(prefs.status).toBe(200);
    expect(prefs.body.data.notificationPrefs).toEqual({
      push: false,
      sms: true,
      digest: true,
      lang: 'en',
    });

    const blocked = await request(app)
      .patch('/api/v1/me/seller-prefs')
      .set('Authorization', `Bearer ${token}`)
      .send({ showPhonePublic: false });
    expect(blocked.status).toBe(403);

    await db.models.User.updateOne({ _id: new Types.ObjectId(userId) }, { $push: { roles: 'seller' } });
    const sellerLogin = await login('+8801711111115', 'device-account-0001');
    const ok = await request(app)
      .patch('/api/v1/me/seller-prefs')
      .set('Authorization', `Bearer ${sellerLogin.token}`)
      .send({ showPhonePublic: false });
    expect(ok.status).toBe(200);
    expect(ok.body.data.sellerPrefs.showPhonePublic).toBe(false);
  });

  it('favorites a listing idempotently and keeps the counter correct', async () => {
    const { token } = await login('+8801711111116');
    const seller = await login('+8801711111117', 'device-account-seller');
    const listing = await makeListing(seller.userId);

    const first = await request(app)
      .post(`/api/v1/listings/${listing._id.toString()}/favorite`)
      .set('Authorization', `Bearer ${token}`);
    const second = await request(app)
      .post(`/api/v1/listings/${listing._id.toString()}/favorite`)
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await db.models.Favorite.countDocuments({})).toBe(1);

    const fresh = await db.models.Listing.findById(listing._id);
    expect((fresh?.stats as { favorites?: number } | undefined)?.favorites).toBe(1);

    const list = await authGet(token, '/api/v1/me/favorites');
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0].id).toBe(listing._id.toString());

    const removed = await request(app)
      .delete(`/api/v1/listings/${listing._id.toString()}/favorite`)
      .set('Authorization', `Bearer ${token}`);
    expect(removed.status).toBe(200);
    const after = await db.models.Listing.findById(listing._id);
    expect((after?.stats as { favorites?: number } | undefined)?.favorites).toBe(0);
  });

  it('creates, lists and deletes saved searches', async () => {
    const { token } = await login('+8801711111118');

    const created = await request(app)
      .post('/api/v1/me/saved-searches')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'iphone', filters: { district: 'Dhaka' }, frequency: 'instant' });
    expect(created.status).toBe(201);
    expect(created.body.data.frequency).toBe('instant');

    const listed = await authGet(token, '/api/v1/me/saved-searches');
    expect(listed.body.data).toHaveLength(1);

    const invalid = await request(app)
      .post('/api/v1/me/saved-searches')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'iphone', frequency: 'off' });
    expect(invalid.status).toBe(400);

    const removed = await request(app)
      .delete(`/api/v1/me/saved-searches/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(removed.status).toBe(200);
    expect(await db.models.SavedSearch.countDocuments({})).toBe(0);
  });

  it('caps saved searches at 20 per user', async () => {
    const { token } = await login('+8801711111119');
    for (let index = 0; index < 20; index += 1) {
      const res = await request(app)
        .post('/api/v1/me/saved-searches')
        .set('Authorization', `Bearer ${token}`)
        .send({ query: `query ${index}` });
      expect(res.status).toBe(201);
    }
    const blocked = await request(app)
      .post('/api/v1/me/saved-searches')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'one too many' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.detail).toBe('saved_search_limit');
  }, 60_000);

  it('deletes with a 14-day grace, delists listings, archives threads and blocks login', async () => {
    const seller = await login('+8801711111120');
    const buyer = await login('+8801711111121', 'device-account-buyer');
    const listing = await makeListing(seller.userId);
    await db.models.Thread.create({
      listingId: listing._id,
      buyerId: new Types.ObjectId(buyer.userId),
      sellerId: new Types.ObjectId(seller.userId),
      state: 'active',
      buyerMsgCount: 1,
      lastMessageAt: new Date(),
    });

    const { code, otpId } = await requestOtp('+8801711111120');
    const deleted = await request(app)
      .post('/api/v1/me/delete')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ otpId, code });
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.graceDays).toBe(14);

    const purgeAt = new Date(deleted.body.data.purgeAt).getTime();
    expect(purgeAt - Date.now()).toBeGreaterThan(13.9 * 24 * 60 * 60 * 1000);

    const user = await db.models.User.findById(seller.userId);
    expect(user?.deletedAt).toBeTruthy();
    expect(user?.sessions).toHaveLength(0);

    const freshListing = await db.models.Listing.findById(listing._id);
    expect(freshListing?.status).toBe('delisted');
    const thread = await db.models.Thread.findOne({ listingId: listing._id });
    expect(thread?.state).toBe('archived');

    // Login is blocked during the grace window.
    const retry = await requestOtp('+8801711111120');
    const blocked = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ otpId: retry.otpId, code: retry.code, deviceFp: 'device-account-0001', platform: 'web' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.detail).toBe('account_deleted');

    // OTP-only cancellation restores the account.
    const restore = await requestOtp('+8801711111120');
    const cancelled = await request(app)
      .post('/api/v1/me/delete/cancel')
      .send({ otpId: restore.otpId, code: restore.code });
    expect(cancelled.status).toBe(200);

    const restored = await login('+8801711111120');
    expect(restored.token).toBeTypeOf('string');
  });

  it('refuses to cancel when no deletion is pending', async () => {
    await login('+8801711111122');
    const { code, otpId } = await requestOtp('+8801711111122');

    const res = await request(app).post('/api/v1/me/delete/cancel').send({ otpId, code });
    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('account_not_pending_deletion');
  });

  it('rejects a deletion when the OTP belongs to another phone', async () => {
    const victim = await login('+8801711111123');
    const attackerPhone = '+8801711111124';
    await login(attackerPhone, 'device-account-attacker');
    const { code, otpId } = await requestOtp(attackerPhone);

    const res = await request(app)
      .post('/api/v1/me/delete')
      .set('Authorization', `Bearer ${victim.token}`)
      .send({ otpId, code });
    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('otp_phone_mismatch');
  });
});
