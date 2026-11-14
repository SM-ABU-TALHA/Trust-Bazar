import mongoose, { Types, type Connection } from 'mongoose';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config/index.js';
import { applyIndexes, applyValidators } from '../db/migrate.js';
import { createDbContext, type DbContext } from '../db/context.js';
import { APP_INDEXES } from '../db/indexes.js';
import { createApp } from '../app.js';
import { loadEnvFile } from '../lib/env.js';
import { memoryKv, type KvStore } from '../lib/kv.js';
import { createLogger, type Logger } from '../lib/logger.js';
import type { SmsMessage, SmsSender } from '../lib/sms.js';
import { memoryRateLimitStore } from '../middleware/index.js';
import { runJob } from '../services/jobs/registry.js';
import { NotificationService } from '../services/notifications/notification.service.js';
import { PaymentService } from '../services/payments/payment.service.js';

loadEnvFile();

// Live Atlas round-trips make the 5 s default too tight for multi-login tests.
vi.setConfig({ testTimeout: 20_000 });

const APP_URI = process.env.MONGO_APP_URI;
const canRun = Boolean(APP_URI);

const DAY = 86_400_000;

function testUri(uri: string): string {
  const parsed = new URL(uri);
  parsed.pathname = '/trust_bazar_test_deals';
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
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-11',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-11',
  PEPPER: 'test-pepper-0123456789',
  ENCRYPTION_KEY: 'c'.repeat(64),
  ATLAS_SEARCH_ENABLED: false,
  BKASH_WEBHOOK_SECRET: 'k',
  NAGAD_WEBHOOK_SECRET: 'n',
} as unknown as Config;

const logger: Logger = createLogger(config);

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
  db = createDbContext(conn, conn);
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
  // The audit model hook forbids deletes — wipe through the native driver.
  await testDb.collection('auditEvents').deleteMany({});
  outbox.length = 0;
  kv = memoryKv();
  app = createApp(config, logger, {
    appDb: () => testDb,
    repos: db.repos,
    kv,
    sms,
    rateStore: memoryRateLimitStore(),
  });
});

function buildJobDeps() {
  const notifications = new NotificationService({ repos: db.repos, kv, logger });
  const payments = new PaymentService({ config, logger, repos: db.repos, notifications });
  return { config, logger, repos: db.repos, notifications, payments };
}

function lastCode(): string {
  const message = outbox[outbox.length - 1];
  const match = /code: (\d{6})/.exec(message?.body ?? '');
  if (!match?.[1]) throw new Error('no OTP in the test outbox');
  return match[1];
}

async function login(phone: string, deviceFp = 'device-deals-0001') {
  await kv.del(`otp:cooldown:${phone}`);
  const otp = await request(app).post('/api/v1/auth/otp/request').send({ phone });
  const res = await request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ otpId: otp.body.data.otpId, code: lastCode(), deviceFp, platform: 'web' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { token: String(res.body.data.accessToken), userId: String(res.body.data.user.id) };
}

/** Login, grant roles in Mongo, then re-login so the JWT snapshot carries them. */
async function makeUser(phone: string, roles: string[], displayName: string) {
  const first = await login(phone, `device-${phone.slice(-6)}-grant-a`);
  await db.models.User.updateOne(
    { _id: new Types.ObjectId(first.userId) },
    {
      $addToSet: { roles: { $each: roles } },
      $set: { 'profile.displayName': displayName },
    },
  );
  const second = await login(phone, `device-${phone.slice(-6)}-grant-b`);
  return { ...second, displayName };
}

function makeBuyer(phone: string, displayName = 'Karim Ahmed') {
  return makeUser(phone, ['verifiedBuyer'], displayName);
}

function makeSeller(phone: string, displayName = 'Rahim Uddin') {
  return makeUser(phone, ['verifiedBuyer', 'seller'], displayName);
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function seedListing(sellerId: string, overrides: Record<string, unknown> = {}) {
  const doc = await db.models.Listing.create({
    sellerId: new Types.ObjectId(sellerId),
    categoryId: new Types.ObjectId(),
    title: 'iPhone 12 Pro 128GB excellent condition',
    description: 'Original box and charger included, no scratches at all.',
    price: 45_000,
    condition: 'good',
    mediaIds: [new Types.ObjectId()],
    location: {
      district: 'Dhaka',
      geo: { type: 'Point', coordinates: [90.4125, 23.8103] },
    },
    status: 'pendingConfirm',
    expiresAt: new Date(Date.now() + 30 * DAY),
    version: 0,
    aiScan: { status: 'clean', flags: [] },
    stats: { views: 0, chatStarts: 0, callTaps: 0, favorites: 0 },
    ...overrides,
  });
  return String((doc as unknown as { _id: Types.ObjectId })._id);
}

async function seedThread(
  listingId: string,
  sellerId: string,
  buyerId: string,
  buyerMsgCount = 1,
) {
  const doc = await db.models.Thread.create({
    listingId: new Types.ObjectId(listingId),
    sellerId: new Types.ObjectId(sellerId),
    buyerId: new Types.ObjectId(buyerId),
    state: 'active',
    buyerMsgCount,
  });
  return String((doc as unknown as { _id: Types.ObjectId })._id);
}

/** One listing + one deal (the `listingId` unique index means one deal per listing). */
async function seedDeal(
  sellerId: string,
  buyerId: string | null,
  overrides: Record<string, unknown> = {},
): Promise<{ dealId: string; listingId: string }> {
  const listingId = await seedListing(sellerId, {
    status: (overrides.listingStatus as string | undefined) ?? 'pendingConfirm',
  });
  const doc = await db.models.Deal.create({
    listingId: new Types.ObjectId(listingId),
    sellerId: new Types.ObjectId(sellerId),
    buyerId: buyerId ? new Types.ObjectId(buyerId) : null,
    type: 'unconfirmed',
    channel: 'chat',
    markedSoldAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * DAY),
    confirmedAt: null,
    disputeRef: null,
    undoUntil: new Date(Date.now() + 15 * 60_000),
    ...overrides,
  });
  return { dealId: String((doc as unknown as { _id: Types.ObjectId })._id), listingId };
}

function confirmDeal(token: string | null, dealId: string, body: Record<string, unknown> = {}) {
  const req = request(app).post(`/api/v1/deals/${dealId}/confirm`);
  if (token) req.set(bearer(token));
  return req.send(body);
}

function declineDeal(token: string | null, dealId: string, reason: string) {
  const req = request(app).post(`/api/v1/deals/${dealId}/decline`);
  if (token) req.set(bearer(token));
  return req.send({ reason });
}

async function readDeal(dealId: string) {
  return (await db.models.Deal.findById(dealId).lean()) as unknown as {
    type?: string;
    confirmedAt?: Date | null;
    disputeRef?: Types.ObjectId | null;
  } | null;
}

async function readSeller(sellerId: string) {
  return (await db.models.User.findById(sellerId).lean()) as unknown as {
    profile?: { sellerStats?: { confirmedDeals?: number; disputes90d?: number } };
    enforcement?: { history?: { action?: string; reasonCode?: string }[] };
  } | null;
}

describe.skipIf(!canRun)('deals confirmation & disputes (live Atlas, trust_bazar_test_deals)', () => {
  it('confirms a deal, closes the listing/thread and bumps the KPI', async () => {
    const seller = await makeSeller('+8801812100001');
    const buyer = await makeBuyer('+8801812100002');
    const { dealId, listingId } = await seedDeal(seller.userId, buyer.userId);
    const threadId = await seedThread(listingId, seller.userId, buyer.userId, 1);

    const res = await confirmDeal(buyer.token, dealId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.dealId).toBe(dealId);
    expect(res.body.data.type).toBe('confirmed');
    expect(res.body.data.confirmedAt).toBeTruthy();

    const listing = (await db.models.Listing.findById(listingId).lean()) as unknown as {
      status?: string;
    };
    expect(listing.status).toBe('sold');

    const thread = (await db.models.Thread.findById(threadId).lean()) as unknown as {
      state?: string;
    };
    expect(thread.state).toBe('soldBanner');

    const sellerDoc = await readSeller(seller.userId);
    expect(sellerDoc?.profile?.sellerStats?.confirmedDeals).toBe(1);

    expect(
      await db.models.Notification.countDocuments({ type: 'deal.confirmed' }),
    ).toBe(1);
    const audit = await testDb
      .collection('auditEvents')
      .findOne({ action: 'deal.confirmed' });
    expect(audit).toBeTruthy();
  });

  it('requires a buyer message before confirmation', async () => {
    const seller = await makeSeller('+8801812100011');
    const buyer = await makeBuyer('+8801812100012');
    const { dealId, listingId } = await seedDeal(seller.userId, buyer.userId);

    const noThread = await confirmDeal(buyer.token, dealId);
    expect(noThread.status).toBe(422);
    expect(noThread.body.detail).toBe('buyer_message_required');

    await seedThread(listingId, seller.userId, buyer.userId, 0);
    const noMessages = await confirmDeal(buyer.token, dealId);
    expect(noMessages.status).toBe(422);
    expect(noMessages.body.detail).toBe('buyer_message_required');
  });

  it('hides the deal from anyone who is not the buyer', async () => {
    const seller = await makeSeller('+8801812100021');
    const buyer = await makeBuyer('+8801812100022');
    const stranger = await makeBuyer('+8801812100023');
    const { dealId, listingId } = await seedDeal(seller.userId, buyer.userId);
    await seedThread(listingId, seller.userId, buyer.userId, 1);

    const asStranger = await confirmDeal(stranger.token, dealId);
    expect(asStranger.status).toBe(404);
    expect(asStranger.body.detail).toBe('deal_not_found');

    const asSeller = await confirmDeal(seller.token, dealId);
    expect(asSeller.status).toBe(404);
    expect(asSeller.body.detail).toBe('deal_not_found');
  });

  it('refuses to confirm a direct sale and keeps it out of the KPI', async () => {
    const seller = await makeSeller('+8801812100031');
    const buyer = await makeBuyer('+8801812100032');
    const { dealId, listingId } = await seedDeal(seller.userId, buyer.userId, {
      type: 'direct',
      channel: 'inPerson',
    });
    await seedThread(listingId, seller.userId, buyer.userId, 1);

    const res = await confirmDeal(buyer.token, dealId);
    expect(res.status).toBe(409);
    expect(res.body.detail).toBe('deal_not_confirmable');

    const sellerDoc = await readSeller(seller.userId);
    expect(sellerDoc?.profile?.sellerStats?.confirmedDeals ?? 0).toBe(0);
  });

  it('rejects confirmation after the 7-day window', async () => {
    const seller = await makeSeller('+8801812100041');
    const buyer = await makeBuyer('+8801812100042');
    const { dealId, listingId } = await seedDeal(seller.userId, buyer.userId, {
      markedSoldAt: new Date(Date.now() - 8 * DAY),
      expiresAt: new Date(Date.now() - 60_000),
    });
    await seedThread(listingId, seller.userId, buyer.userId, 1);

    const res = await confirmDeal(buyer.token, dealId);
    expect(res.status).toBe(409);
    expect(res.body.detail).toBe('deal_confirm_window_expired');
    expect((await readDeal(dealId))?.confirmedAt).toBeNull();
  });

  it('treats a repeated confirmation as idempotent', async () => {
    const seller = await makeSeller('+8801812100051');
    const buyer = await makeBuyer('+8801812100052');
    const { dealId, listingId } = await seedDeal(seller.userId, buyer.userId);
    await seedThread(listingId, seller.userId, buyer.userId, 1);

    const first = await confirmDeal(buyer.token, dealId, { confirmed: true });
    const second = await confirmDeal(buyer.token, dealId, {});
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.data.confirmedAt).toBe(first.body.data.confirmedAt);

    expect(await db.models.Notification.countDocuments({ type: 'deal.confirmed' })).toBe(1);
    expect((await readSeller(seller.userId))?.profile?.sellerStats?.confirmedDeals).toBe(1);
  });

  it('opens a dispute case on decline and counts it against the seller', async () => {
    const seller = await makeSeller('+8801812100061');
    const buyer = await makeBuyer('+8801812100062');
    const { dealId, listingId } = await seedDeal(seller.userId, buyer.userId);
    await seedThread(listingId, seller.userId, buyer.userId, 1);

    const res = await declineDeal(buyer.token, dealId, 'seller never shipped the phone');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.dealId).toBe(dealId);
    expect(res.body.data.disputeRef).toBeTruthy();
    expect(res.body.data.sellerDisputes90d).toBe(1);

    const kase = (await db.models.ModerationCase.findOne({
      source: 'dispute',
    }).lean()) as unknown as { refId?: Types.ObjectId } | null;
    expect(kase).toBeTruthy();
    expect(String(kase?.refId)).toBe(dealId);
    expect(await db.models.ModerationCase.countDocuments({})).toBe(1);

    const deal = await readDeal(dealId);
    expect(String(deal?.disputeRef)).toBe(res.body.data.disputeRef);
    expect((await readSeller(seller.userId))?.profile?.sellerStats?.disputes90d).toBe(1);

    expect(await db.models.Notification.countDocuments({ type: 'deal.declined' })).toBe(1);
  });

  it('returns the same dispute when decline is retried', async () => {
    const seller = await makeSeller('+8801812100071');
    const buyer = await makeBuyer('+8801812100072');
    const { dealId, listingId } = await seedDeal(seller.userId, buyer.userId);
    await seedThread(listingId, seller.userId, buyer.userId, 1);

    const first = await declineDeal(buyer.token, dealId, 'the item was not as described');
    const second = await declineDeal(buyer.token, dealId, 'the item was not as described');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.data.disputeRef).toBe(first.body.data.disputeRef);

    expect(await db.models.ModerationCase.countDocuments({ source: 'dispute' })).toBe(1);
    expect((await readSeller(seller.userId))?.profile?.sellerStats?.disputes90d).toBe(1);
  });

  it('auto-flags a seller on the third dispute in 90 days', async () => {
    const seller = await makeSeller('+8801812100081');
    const buyer = await makeBuyer('+8801812100082');
    const ops = await login('+8801812100083', 'device-deals-ops');
    await db.models.Config.create({ _id: 'opsInbox', value: { userId: ops.userId } });

    // Two prior disputes already on record → this decline is the third.
    await testDb
      .collection('users')
      .updateOne(
        { _id: new Types.ObjectId(seller.userId) },
        { $set: { 'profile.sellerStats.disputes90d': 2 } },
      );

    const { dealId, listingId } = await seedDeal(seller.userId, buyer.userId);
    await seedThread(listingId, seller.userId, buyer.userId, 1);

    const res = await declineDeal(buyer.token, dealId, 'buyer paid but never received the item');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.sellerDisputes90d).toBe(3);

    const sellerDoc = await readSeller(seller.userId);
    expect(
      sellerDoc?.enforcement?.history?.some((entry) => entry.action === 'auto_flag'),
    ).toBe(true);

    const audit = await testDb
      .collection('auditEvents')
      .findOne({ action: 'seller.auto_flagged' });
    expect(audit).toBeTruthy();

    expect(
      await db.models.Notification.countDocuments({
        type: 'ops.seller_auto_flagged',
        userId: new Types.ObjectId(ops.userId),
      }),
    ).toBe(1);
  });

  it('reminds on day 3 and times out after 7 days without duplicating notifications', async () => {
    const seller = await makeSeller('+8801812100091');
    const buyer = await makeBuyer('+8801812100092');
    const deps = buildJobDeps();

    const { dealId } = await seedDeal(seller.userId, buyer.userId, {
      markedSoldAt: new Date(Date.now() - 4 * DAY),
      expiresAt: new Date(Date.now() + 3 * DAY),
    });

    const first = await runJob('deal-timeout', deps);
    expect(first.reminded).toBe(1);
    expect(
      await db.models.Notification.countDocuments({
        type: 'deal.reminder',
        userId: new Types.ObjectId(buyer.userId),
      }),
    ).toBe(1);

    await runJob('deal-timeout', deps);
    expect(await db.models.Notification.countDocuments({ type: 'deal.reminder' })).toBe(1);

    const expired = await seedDeal(seller.userId, buyer.userId, {
      markedSoldAt: new Date(Date.now() - 8 * DAY),
      expiresAt: new Date(Date.now() - 60_000),
    });
    await seedThread(expired.listingId, seller.userId, buyer.userId, 1);

    const timedOut = await runJob('deal-timeout', deps);
    expect(timedOut.timedOut).toBe(1);
    // Seller + buyer each get one timeout notice.
    expect(await db.models.Notification.countDocuments({ type: 'deal.timeout' })).toBe(2);

    const late = await confirmDeal(buyer.token, expired.dealId);
    expect(late.status).toBe(409);
    expect(late.body.detail).toBe('deal_confirm_window_expired');
    expect((await readDeal(dealId))?.type).toBe('unconfirmed');
  });

  it('requires authentication for confirm and decline', async () => {
    const dealId = new Types.ObjectId().toString();

    const confirm = await confirmDeal(null, dealId);
    expect(confirm.status).toBe(401);

    const decline = await declineDeal(null, dealId, 'not authenticated');
    expect(decline.status).toBe(401);
  });
});
