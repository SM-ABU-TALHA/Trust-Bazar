import { createHmac } from 'node:crypto';
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
import { createLogger } from '../lib/logger.js';
import type { SmsMessage, SmsSender } from '../lib/sms.js';
import { memoryRateLimitStore } from '../middleware/index.js';
import { NotificationService } from '../services/notifications/notification.service.js';
import { PaymentService } from '../services/payments/payment.service.js';

loadEnvFile();

// Live Atlas round-trips make the 5 s default too tight for multi-step flows.
vi.setConfig({ testTimeout: 20_000 });

const APP_URI = process.env.MONGO_APP_URI;
const canRun = Boolean(APP_URI);

const BKASH_SECRET = 'bkash-webhook-secret-test';

function testUri(uri: string): string {
  const parsed = new URL(uri);
  parsed.pathname = '/trust_bazar_test_payments';
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
  BKASH_WEBHOOK_SECRET: BKASH_SECRET,
  NAGAD_WEBHOOK_SECRET: 'nagad-webhook-secret-test',
  RECON_LOOKBACK_DAYS: 3,
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
let logger: ReturnType<typeof createLogger>;

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
    await model.deleteMany({});
  }
  outbox.length = 0;
  kv = memoryKv();
  logger = createLogger(config);
  app = createApp(config, logger, {
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

async function login(phone: string, deviceFp = 'device-payments-0001') {
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
    status: 'active',
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
    version: 0,
    aiScan: { status: 'clean', flags: [] },
    stats: { views: 0, chatStarts: 0, callTaps: 0, favorites: 0 },
    ...overrides,
  });
  return String((doc as unknown as { _id: Types.ObjectId })._id);
}

async function seedPackage() {
  await db.models.BoostPackage.create([
    {
      _id: 'boost-3d',
      name: '3 Days Boost',
      durationDays: 3,
      priceBdt: 100,
      placement: 'category',
      active: true,
    },
    {
      _id: 'boost-7d',
      name: '7 Days Boost',
      durationDays: 7,
      priceBdt: 250,
      placement: 'category',
      active: true,
    },
  ]);
}

function grant(userId: string, amount: number) {
  return db.models.Credit.create({
    userId: new Types.ObjectId(userId),
    amount,
    remaining: amount,
    source: 'goodwill',
    expiresAt: new Date(Date.now() + 365 * 86_400_000),
  });
}

function checkout(token: string, key: string, listingId: string) {
  return request(app)
    .post('/api/v1/boost/checkout')
    .set(bearer(token))
    .set('Idempotency-Key', key)
    .send({ packageId: 'boost-3d', listingId, provider: 'bkash' });
}

function sendWebhook(body: Record<string, unknown>, signature?: string) {
  const raw = JSON.stringify(body);
  const header = signature ?? createHmac('sha256', BKASH_SECRET).update(raw).digest('hex');
  return request(app)
    .post('/api/v1/webhooks/payments/bkash')
    .set('Content-Type', 'application/json')
    .set('x-bkash-signature', header)
    .send(raw);
}

/** Webhook processing is fire-and-forget: poll instead of asserting inline. */
async function waitFor<T>(
  probe: () => Promise<T | false | null | undefined>,
  timeoutMs = 8_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

interface PaymentView {
  state: string;
  amount: number;
  creditApplied: number;
  receiptNo?: string | null;
  paidAt?: Date | null;
}

interface ListingView {
  boost?: {
    active?: boolean;
    packageId?: string | null;
    until?: Date | null;
    pausedAt?: Date | null;
    remainingMs?: number | null;
  };
}

async function readPayment(paymentId: string): Promise<PaymentView | null> {
  return (await db.models.Payment.findById(paymentId).lean()) as unknown as PaymentView | null;
}

async function readListing(listingId: string): Promise<ListingView | null> {
  return (await db.models.Listing.findById(listingId).lean()) as unknown as ListingView | null;
}

function paymentService() {
  return new PaymentService({
    config,
    logger,
    repos: db.repos,
    notifications: new NotificationService({ repos: db.repos, kv, logger }),
  });
}

function collectBuffer(res: unknown, callback: (error: Error | null, body?: Buffer) => void): void {
  const stream = res as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe.skipIf(!canRun)('payments, boost & webhooks (live Atlas, trust_bazar_test_payments)', () => {
  it('lists active boost packages for signed-in users and rejects guests', async () => {
    await seedPackage();
    const buyer = await makeBuyer('+8801910000001');

    const res = await request(app).get('/api/v1/boost/packages').set(bearer(buyer.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].id).toBe('boost-3d');
    expect(res.body.data[0].price).toBe(100);

    const guest = await request(app).get('/api/v1/boost/packages');
    expect(guest.status).toBe(401);
  });

  it('guards checkout: missing key, non-seller and someone else\u2019s listing', async () => {
    await seedPackage();
    const seller = await makeSeller('+8801910000010');
    const otherSeller = await makeSeller('+8801910000011');
    const buyer = await makeBuyer('+8801910000012');
    const listingId = await seedListing(seller.userId);
    const foreignListing = await seedListing(otherSeller.userId);

    const missingKey = await request(app)
      .post('/api/v1/boost/checkout')
      .set(bearer(seller.token))
      .send({ packageId: 'boost-3d', listingId, provider: 'bkash' });
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.type).toContain('bad_request');

    const notSeller = await checkout(buyer.token, 'key-buyer-1', listingId);
    expect(notSeller.status).toBe(403);

    const foreign = await checkout(seller.token, 'key-foreign-1', foreignListing);
    expect(foreign.status).toBe(404);
    expect(foreign.body.detail).toBe('listing_not_found');
  });

  it('creates an initiated payment and auto-applies credits FIFO', async () => {
    await seedPackage();
    const seller = await makeSeller('+8801910000020');
    const listingId = await seedListing(seller.userId);

    const plain = await checkout(seller.token, 'key-plain-1', listingId);
    expect(plain.status, JSON.stringify(plain.body)).toBe(201);
    expect(plain.body.data.state).toBe('initiated');
    expect(plain.body.data.amount).toBe(100);
    expect(plain.body.data.creditApplied).toBe(0);
    expect(String(plain.body.data.gatewayUrl)).toContain(String(plain.body.data.paymentId));

    await grant(seller.userId, 40);
    const withCredits = await checkout(seller.token, 'key-credit-1', listingId);
    expect(withCredits.status, JSON.stringify(withCredits.body)).toBe(201);
    expect(withCredits.body.data.creditApplied).toBe(40);
    expect(withCredits.body.data.amount).toBe(60);
  });

  it('replays an identical checkout and rejects a changed payload for the same key', async () => {
    await seedPackage();
    const seller = await makeSeller('+8801910000030');
    const listingId = await seedListing(seller.userId);
    const anotherListing = await seedListing(seller.userId);

    const first = await checkout(seller.token, 'key-idem-1', listingId);
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    // The middleware caches the response after it is sent — wait for the write.
    await waitFor(async () => {
      const cached = await testDb
        .collection('idempotencyKeys')
        .countDocuments({ _id: 'key-idem-1' as never });
      return cached === 1;
    });

    const replay = await checkout(seller.token, 'key-idem-1', listingId);
    expect(replay.status).toBe(201);
    expect(replay.body.data.paymentId).toBe(first.body.data.paymentId);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(await db.models.Payment.countDocuments({})).toBe(1);

    const changed = await checkout(seller.token, 'key-idem-1', anotherListing);
    expect(changed.status).toBe(409);
    expect(changed.body.type).toContain('idempotency_replay');
  });

  it('archives a bad signature once and never mutates the payment', async () => {
    await seedPackage();
    const seller = await makeSeller('+8801910000040');
    const listingId = await seedListing(seller.userId);
    const created = await checkout(seller.token, 'key-bad-sig-1', listingId);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const paymentId = String(created.body.data.paymentId);

    const res = await sendWebhook(
      { eventId: 'evt-bad-1', paymentId, trxId: 'trx-bad-1', state: 'success', amount: 100 },
      'deadbeef',
    );
    expect(res.status).toBe(401);
    expect(res.body.detail).toBe('invalid_signature');

    const archived = await db.models.WebhookEvent.find({ gateway: 'bkash' }).lean();
    expect(archived).toHaveLength(1);
    expect(archived[0]?.signatureOk).toBe(false);
    expect((await readPayment(paymentId))?.state).toBe('initiated');
  });

  it('activates the boost exactly once when a success webhook is delivered twice', async () => {
    await seedPackage();
    const seller = await makeSeller('+8801910000050');
    const listingId = await seedListing(seller.userId);
    const created = await checkout(seller.token, 'key-success-1', listingId);
    const paymentId = String(created.body.data.paymentId);
    const body = { eventId: 'evt-ok-1', paymentId, trxId: 'trx-ok-1', state: 'success', amount: 100 };

    const first = await sendWebhook(body);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data.duplicate).toBe(false);

    const second = await sendWebhook(body);
    expect(second.status).toBe(200);
    expect(second.body.data.duplicate).toBe(true);

    await waitFor(async () => (await readPayment(paymentId))?.state === 'success');
    await waitFor(async () => (await readListing(listingId))?.boost?.active === true);

    const listing = await readListing(listingId);
    expect(listing?.boost?.packageId).toBe('boost-3d');

    // Boosting is applied before the emitter runs — wait for the notification too.
    await waitFor(
      async () => (await db.models.Notification.countDocuments({ type: 'boost.activated' })) === 1,
    );
    expect(await db.models.Notification.countDocuments({ type: 'boost.activated' })).toBe(1);
    expect(
      await db.models.Notification.countDocuments({
        dedupeKey: `boost.activated:${paymentId}`,
      }),
    ).toBe(1);
  });

  it('marks a failed webhook without touching boosts or credit grants', async () => {
    await seedPackage();
    const seller = await makeSeller('+8801910000060');
    const listingId = await seedListing(seller.userId);
    await grant(seller.userId, 40);

    const created = await checkout(seller.token, 'key-fail-1', listingId);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.creditApplied).toBe(40);
    const paymentId = String(created.body.data.paymentId);

    const res = await sendWebhook({
      eventId: 'evt-fail-1',
      paymentId,
      trxId: 'trx-fail-1',
      state: 'failed',
      amount: 60,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    await waitFor(async () => (await readPayment(paymentId))?.state === 'failed');
    const listing = await readListing(listingId);
    expect(listing?.boost?.active ?? false).toBe(false);

    const credit = await db.models.Credit.findOne({
      userId: new Types.ObjectId(seller.userId),
    }).lean();
    expect(credit?.remaining).toBe(40);
  });

  it('keeps success terminal when a later failed webhook arrives', async () => {
    await seedPackage();
    const seller = await makeSeller('+8801910000070');
    const listingId = await seedListing(seller.userId);
    const created = await checkout(seller.token, 'key-terminal-1', listingId);
    const paymentId = String(created.body.data.paymentId);

    const ok = await sendWebhook({
      eventId: 'evt-terminal-ok',
      paymentId,
      trxId: 'trx-terminal-ok',
      state: 'success',
      amount: 100,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    await waitFor(async () => (await readPayment(paymentId))?.state === 'success');

    const late = await sendWebhook({
      eventId: 'evt-terminal-fail',
      paymentId,
      trxId: 'trx-terminal-fail',
      state: 'failed',
      amount: 100,
    });
    expect(late.status, JSON.stringify(late.body)).toBe(200);

    // The 409 conflict is swallowed asynchronously and recorded on the event.
    await waitFor(async () => {
      const event = await db.models.WebhookEvent.findOne({
        eventId: 'evt-terminal-fail',
      }).lean();
      return Boolean((event as unknown as { processError?: string | null } | null)?.processError);
    });
    expect((await readPayment(paymentId))?.state).toBe('success');
  });

  it('serves a PDF receipt inside the 12-month window and hides other users\u2019 payments', async () => {
    await seedPackage();
    const seller = await makeSeller('+8801910000080');
    const stranger = await makeBuyer('+8801910000081', 'Nadia Islam');
    const listingId = await seedListing(seller.userId);
    const created = await checkout(seller.token, 'key-receipt-1', listingId);
    const paymentId = String(created.body.data.paymentId);

    const ok = await sendWebhook({
      eventId: 'evt-receipt-ok',
      paymentId,
      trxId: 'trx-receipt-ok',
      state: 'success',
      amount: 100,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    await waitFor(async () => {
      const payment = await readPayment(paymentId);
      return payment?.state === 'success' && Boolean(payment.receiptNo);
    });

    const receipt = await request(app)
      .get(`/api/v1/payments/${paymentId}/receipt`)
      .set(bearer(seller.token))
      .buffer(true)
      .parse(collectBuffer);
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(200);
    expect(String(receipt.headers['content-type'])).toContain('application/pdf');
    const pdf = receipt.body as Buffer;
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString('utf8')).toBe('%PDF');

    const hiddenPayment = await request(app)
      .get(`/api/v1/payments/${paymentId}`)
      .set(bearer(stranger.token));
    expect(hiddenPayment.status).toBe(404);
    expect(hiddenPayment.body.detail).toBe('payment_not_found');

    const hiddenReceipt = await request(app)
      .get(`/api/v1/payments/${paymentId}/receipt`)
      .set(bearer(stranger.token));
    expect(hiddenReceipt.status).toBe(404);

    const pending = await checkout(seller.token, 'key-receipt-pending', listingId);
    const unavailable = await request(app)
      .get(`/api/v1/payments/${String(pending.body.data.paymentId)}/receipt`)
      .set(bearer(seller.token));
    expect(unavailable.status).toBe(409);
    expect(unavailable.body.detail).toBe('receipt_not_available');

    await testDb.collection('payments').updateOne(
      { _id: new Types.ObjectId(paymentId) },
      { $set: { paidAt: new Date(Date.now() - 400 * 86_400_000) } },
    );
    const expired = await request(app)
      .get(`/api/v1/payments/${paymentId}/receipt`)
      .set(bearer(seller.token));
    expect(expired.status).toBe(409);
    expect(expired.body.detail).toBe('receipt_not_available');
  });

  it('pauses and resumes an active boost while preserving remaining time', async () => {
    await seedPackage();
    const seller = await makeSeller('+8801910000090');
    const listingId = await seedListing(seller.userId);
    const created = await checkout(seller.token, 'key-pause-1', listingId);
    const paymentId = String(created.body.data.paymentId);

    const ok = await sendWebhook({
      eventId: 'evt-pause-ok',
      paymentId,
      trxId: 'trx-pause-ok',
      state: 'success',
      amount: 100,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    await waitFor(async () => (await readListing(listingId))?.boost?.active === true);

    const service = paymentService();
    expect(await service.pauseBoosts(seller.userId)).toBe(1);

    const paused = await readListing(listingId);
    expect(paused?.boost?.active).toBe(false);
    expect(paused?.boost?.pausedAt).toBeTruthy();
    const remainingMs = paused?.boost?.remainingMs ?? 0;
    expect(remainingMs).toBeGreaterThan(0);

    expect(await service.resumeBoosts(seller.userId)).toBe(1);

    const resumed = await readListing(listingId);
    expect(resumed?.boost?.active).toBe(true);
    expect(resumed?.boost?.pausedAt).toBeNull();
    const until = new Date(resumed?.boost?.until ?? 0).getTime();
    expect(Math.abs(until - (Date.now() + remainingMs))).toBeLessThan(5_000);
  });

  it('reconciles settlement rows into credits or a matched activation', async () => {
    await seedPackage();
    const seller = await makeSeller('+8801910000100');
    const listingId = await seedListing(seller.userId);
    const service = paymentService();

    const orphan = await service.reconcile([
      { trxId: 'orphan-1', reference: 'no-such-payment', amount: 75, state: 'success', userId: seller.userId },
    ]);
    expect(orphan.orphanCredits).toBe(1);
    expect(orphan.matched).toBe(0);

    const credit = await db.models.Credit.findOne({
      source: 'reconciliation',
      reason: 'orphan-1',
    }).lean();
    expect(credit).toBeTruthy();
    expect(credit?.amount).toBe(75);
    expect(await db.models.Notification.countDocuments({ type: 'payment.reconciled_to_credit' })).toBe(1);
    expect((await readListing(listingId))?.boost?.active ?? false).toBe(false);

    const created = await checkout(seller.token, 'key-recon-1', listingId);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const paymentId = String(created.body.data.paymentId);
    const amount = Number(created.body.data.amount);

    const matched = await service.reconcile([
      { trxId: 't2', reference: paymentId, amount, state: 'success' },
    ]);
    expect(matched.matched).toBe(1);
    expect((await readPayment(paymentId))?.state).toBe('success');
    expect((await readListing(listingId))?.boost?.active).toBe(true);
  });
});
