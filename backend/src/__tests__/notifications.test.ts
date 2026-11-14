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
import { appendAudit } from '../services/audit/audit.service.js';
import { runJob } from '../services/jobs/registry.js';
import { NotificationService } from '../services/notifications/notification.service.js';
import { PaymentService } from '../services/payments/payment.service.js';

loadEnvFile();

// Live Atlas round-trips make the 5 s default too tight.
vi.setConfig({ testTimeout: 20_000 });

const APP_URI = process.env.MONGO_APP_URI;
const canRun = Boolean(APP_URI);

function testUri(uri: string): string {
  const parsed = new URL(uri);
  parsed.pathname = '/trust_bazar_test_notifications';
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
    await model.deleteMany({});
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

function buildServices() {
  const notifications = new NotificationService({ repos: db.repos, kv, logger });
  const payments = new PaymentService({ config, logger, repos: db.repos, notifications });
  return { notifications, payments };
}

function buildJobDeps() {
  const { notifications, payments } = buildServices();
  return { config, logger, repos: db.repos, notifications, payments };
}

function lastCode(): string {
  const message = outbox[outbox.length - 1];
  const match = /code: (\d{6})/.exec(message?.body ?? '');
  if (!match?.[1]) throw new Error('no OTP in the test outbox');
  return match[1];
}

async function login(phone: string, deviceFp = 'device-notify-0001') {
  await kv.del(`otp:cooldown:${phone}`);
  const otp = await request(app).post('/api/v1/auth/otp/request').send({ phone });
  const res = await request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ otpId: otp.body.data.otpId, code: lastCode(), deviceFp, platform: 'web' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { token: String(res.body.data.accessToken), userId: String(res.body.data.user.id) };
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

let phoneSeq = 0;
function nextPhone(): string {
  phoneSeq += 1;
  return `+88018${String(10_000_000 + phoneSeq)}`;
}

/** Direct user seed for service-level tests (no OTP round-trip needed). */
async function seedUser(overrides: Record<string, unknown> = {}): Promise<string> {
  const doc = await db.models.User.create({
    phone: nextPhone(),
    roles: ['verifiedBuyer', 'seller'],
    ...overrides,
  });
  return String((doc as unknown as { _id: Types.ObjectId })._id);
}

async function seedListing(
  sellerId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
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

describe.skipIf(!canRun)(
  'notifications & jobs (live Atlas, trust_bazar_test_notifications)',
  () => {
    it('dedupes by key and coalesces a repeated emit', async () => {
      const userId = await seedUser();
      const { notifications } = buildServices();
      const dedupeKey = 'dedupe:test:1';

      const first = (await notifications.emit({
        userId,
        event: 'listing.published',
        payload: { title: 'iPhone' },
        dedupeKey,
      })) as unknown as { count?: number } | null;
      expect(first?.count).toBe(1);

      const second = (await notifications.emit({
        userId,
        event: 'listing.published',
        payload: { title: 'iPhone' },
        dedupeKey,
      })) as unknown as { count?: number } | null;
      expect(second?.count).toBe(1);
      expect(await db.models.Notification.countDocuments({ dedupeKey })).toBe(1);

      const third = (await notifications.emit({
        userId,
        event: 'listing.published',
        payload: { title: 'iPhone' },
        dedupeKey,
        coalesce: true,
      })) as unknown as { count?: number } | null;
      expect(third?.count).toBe(2);
      expect(await db.models.Notification.countDocuments({})).toBe(1);
    });

    it('suppresses push/sms in quiet hours but lets critical events through', async () => {
      const userId = await seedUser({
        pushTokens: [{ token: 't1', platform: 'fcm' }],
      });
      const { notifications } = buildServices();

      try {
        vi.useFakeTimers({ toFake: ['Date'] });
        // 18:00 UTC = 00:00 Asia/Dhaka (quiet window 22:00–08:00).
        vi.setSystemTime(new Date('2026-01-01T18:00:00Z'));

        await notifications.emit({
          userId,
          event: 'listing.published',
          payload: { title: 'iPhone' },
          dedupeKey: 'quiet:normal:1',
        });
        await notifications.emit({
          userId,
          event: 'enforcement.warning',
          payload: { reasonCode: 'spam' },
          dedupeKey: 'quiet:critical:1',
        });
      } finally {
        vi.useRealTimers();
      }

      const normal = (await db.models.Notification.findOne({
        dedupeKey: 'quiet:normal:1',
      }).lean()) as unknown as { channels?: string[] } | null;
      expect(normal?.channels).toContain('inApp');
      expect(normal?.channels).not.toContain('push');

      const critical = (await db.models.Notification.findOne({
        dedupeKey: 'quiet:critical:1',
      }).lean()) as unknown as { channels?: string[] } | null;
      expect(critical?.channels).toEqual(expect.arrayContaining(['push', 'sms']));
    });

    it('coalesces chat messages per thread and keeps the latest preview', async () => {
      const userId = await seedUser();
      const { notifications } = buildServices();
      const dedupeKey = `chat.message:${new Types.ObjectId().toString()}`;

      await notifications.emit({
        userId,
        event: 'chat.message',
        payload: { preview: 'first' },
        dedupeKey,
        coalesce: true,
      });
      await notifications.emit({
        userId,
        event: 'chat.message',
        payload: { preview: 'latest' },
        dedupeKey,
        coalesce: true,
      });

      const docs = (await db.models.Notification.find({}).lean()) as unknown as {
        count?: number;
        payload?: { preview?: string };
      }[];
      expect(docs).toHaveLength(1);
      expect(docs[0]?.count).toBe(2);
      expect(docs[0]?.payload?.preview).toBe('latest');
    });

    it('sends one saved-search digest per day', async () => {
      const userId = await seedUser();
      await db.models.SavedSearch.create({
        userId: new Types.ObjectId(userId),
        query: 'iPhone',
      });
      await seedListing(userId);

      const deps = buildJobDeps();
      const first = await runJob('saved-search-alerts', deps);
      expect(first).toEqual({ sent: 1 });
      await runJob('saved-search-alerts', deps);

      const matches = await db.models.Notification.find({ type: 'saved_search.match' }).lean();
      expect(matches).toHaveLength(1);
    });

    it('serves list/read/device-token over HTTP and scopes reads per user', async () => {
      const user = await login('+8801812000501');
      const other = await login('+8801812000502', 'device-notify-0002');
      const { notifications } = buildServices();

      await notifications.emit({
        userId: user.userId,
        event: 'listing.published',
        payload: { title: 'iPhone' },
        dedupeKey: 'http:1',
      });
      await notifications.emit({
        userId: user.userId,
        event: 'listing.published',
        payload: { title: 'Pixel' },
        dedupeKey: 'http:2',
      });

      const list = await request(app).get('/api/v1/notifications').set(bearer(user.token));
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      expect(list.body.data).toHaveLength(2);
      expect(list.body.meta.unread).toBe(2);

      const firstId = String(list.body.data[0]._id);
      const secondId = String(list.body.data[1]._id);
      const read = await request(app)
        .post(`/api/v1/notifications/${firstId}/read`)
        .set(bearer(user.token));
      expect(read.status).toBe(204);

      const afterRead = await request(app)
        .get('/api/v1/notifications')
        .set(bearer(user.token));
      expect(afterRead.body.meta.unread).toBe(1);

      const device = await request(app)
        .post('/api/v1/notifications/device-token')
        .set(bearer(user.token))
        .send({ token: 'dev-token-1', platform: 'fcm' });
      expect(device.status, JSON.stringify(device.body)).toBe(204);
      const stored = (await db.models.User.findById(user.userId).lean()) as unknown as {
        pushTokens?: { token: string }[];
      } | null;
      expect(stored?.pushTokens).toHaveLength(1);
      expect(stored?.pushTokens?.[0]?.token).toBe('dev-token-1');

      const foreign = await request(app)
        .post(`/api/v1/notifications/${secondId}/read`)
        .set(bearer(other.token));
      expect(foreign.status).toBe(404);
    });

    it('expires past-due listings once and re-runs as a no-op', async () => {
      const sellerId = await seedUser();
      const listingId = await seedListing(sellerId, {
        expiresAt: new Date(Date.now() - 60_000),
      });

      const deps = buildJobDeps();
      const first = await runJob('lifecycle', deps);
      expect(first).toEqual({ expired: 1 });

      const listing = (await db.models.Listing.findById(listingId).lean()) as unknown as {
        status?: string;
      } | null;
      expect(listing?.status).toBe('expired');
      expect(await db.models.Notification.countDocuments({ type: 'listing.expired' })).toBe(1);

      const second = await runJob('lifecycle', deps);
      expect(second).toEqual({ expired: 0 });
      expect(await db.models.Notification.countDocuments({ type: 'listing.expired' })).toBe(1);
    });

    it('expires pending offers and notifies the buyer once', async () => {
      const buyerId = await seedUser();
      const sellerId = await seedUser();
      const listingId = await seedListing(sellerId);

      const offer = await db.models.Offer.create({
        threadId: new Types.ObjectId(),
        buyerId: new Types.ObjectId(buyerId),
        listingId: new Types.ObjectId(listingId),
        amount: 1_000,
        status: 'pending',
        expiresAt: new Date(Date.now() - 1_000),
      });

      const deps = buildJobDeps();
      const first = await runJob('offer-expiry', deps);
      expect(first).toEqual({ expired: 1 });

      const updated = (await db.models.Offer.findById(
        (offer as unknown as { _id: Types.ObjectId })._id,
      ).lean()) as unknown as { status?: string } | null;
      expect(updated?.status).toBe('expired');
      expect(
        await db.models.Notification.countDocuments({ type: 'chat.offer_response' }),
      ).toBe(1);

      const second = await runJob('offer-expiry', deps);
      expect(second).toEqual({ expired: 0 });
      expect(
        await db.models.Notification.countDocuments({ type: 'chat.offer_response' }),
      ).toBe(1);
    });

    it('drains stale webhook events and replays as a no-op', async () => {
      const userId = await seedUser();
      const listingId = await seedListing(userId);
      const paymentId = new Types.ObjectId();

      // Native insert: boost package ids are strings (`boost-3d`), not ObjectIds.
      await testDb.collection('payments').insertOne({
        _id: paymentId,
        userId: new Types.ObjectId(userId),
        packageId: 'boost-3d',
        listingId: new Types.ObjectId(listingId),
        amount: 1_000,
        creditApplied: 0,
        provider: 'bkash',
        state: 'initiated',
        idempotencyKey: 'webhook-drain-1',
        gatewayUrl: null,
        gatewayRefs: { paymentId: String(paymentId), webhookEventIds: [] },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await testDb.collection('webhookEvents').insertOne({
        gateway: 'bkash',
        eventId: 'drain-1',
        paymentId,
        signatureOk: true,
        payload: { paymentId: String(paymentId), trxId: 't1', state: 'success' },
        receivedAt: new Date(Date.now() - 120_000),
        processedAt: null,
        processError: null,
      });

      const deps = buildJobDeps();
      const first = await runJob('webhook-drain', deps);
      expect(first).toEqual({ retried: 1 });

      const event = (await testDb
        .collection('webhookEvents')
        .findOne({ eventId: 'drain-1' })) as unknown as { processedAt?: Date | null } | null;
      expect(event?.processedAt).toBeTruthy();

      const payment = (await testDb
        .collection('payments')
        .findOne({ _id: paymentId })) as unknown as { state?: string } | null;
      expect(payment?.state).toBe('success');

      const second = await runJob('webhook-drain', deps);
      expect(second).toEqual({ retried: 0 });
    });

    it('alerts the ops inbox once when an SLA is breached', async () => {
      const opsUserId = await seedUser();
      await db.models.Config.create({
        _id: 'opsInbox',
        value: { userId: opsUserId },
      });
      await db.models.ModerationCase.create({
        source: 'report',
        refId: new Types.ObjectId(),
        status: 'open',
        slaDue: new Date(Date.now() - 60_000),
      });

      const deps = buildJobDeps();
      const first = await runJob('sla-scan', deps);
      expect(first).toEqual({ alerts: 1 });
      await runJob('sla-scan', deps);

      const alerts = await db.models.Notification.find({
        type: 'ops.sla_breach',
        userId: new Types.ObjectId(opsUserId),
      }).lean();
      expect(alerts).toHaveLength(1);
    });

    it('verifies an intact audit chain', async () => {
      await appendAudit(db.repos, { actor: 'system', action: 'test.one', entityType: 'test' });
      await appendAudit(db.repos, { actor: 'system', action: 'test.one', entityType: 'test' });

      const result = await runJob('audit-verify', buildJobDeps());
      expect(result).toEqual({ ok: true, checked: 2 });
    });
  },
);
