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
import { generateTotp } from '../lib/totp.js';
import { memoryRateLimitStore } from '../middleware/index.js';

loadEnvFile();

// Live Atlas round-trips make the 5 s default too tight for multi-login tests.
vi.setConfig({ testTimeout: 20_000 });

const APP_URI = process.env.MONGO_APP_URI;
const canRun = Boolean(APP_URI);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

function testUri(uri: string): string {
  const parsed = new URL(uri);
  parsed.pathname = '/trust_bazar_test_moderation';
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
  BKASH_WEBHOOK_SECRET: 'test-bkash-webhook-secret',
  NAGAD_WEBHOOK_SECRET: 'test-nagad-webhook-secret',
  OPS_IP_ALLOWLIST: '',
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
  // Same connection for audit: auditEvents lands in this test DB.
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
  // The audit model's deleteMany pre-hook rejects (append-only), so wipe natively.
  await testDb.collection('auditEvents').deleteMany({});
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

async function login(phone: string, deviceFp = 'device-moderation-0001') {
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

async function seedOperator(role: string, email: string) {
  await db.models.OperatorAccount.create({
    email,
    role,
    totpSecretEnc: TOTP_SECRET,
    active: true,
    ipAllowlist: [],
  });
}

async function operatorToken(email: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/ops/auth/login')
    .send({ email, totp: generateTotp(TOTP_SECRET) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return String(res.body.data.token);
}

function submitReport(
  token: string,
  targetType: 'listing' | 'user' | 'message',
  targetId: string,
  comment = 'This account is running a scam and abusing buyers',
) {
  return request(app)
    .post('/api/v1/reports')
    .set(bearer(token))
    .send({ targetType, targetId, category: 'scam_fraud', comment });
}

function moderate(token: string, caseId: string, action: string, reasonCode = 'SPAM') {
  return request(app)
    .post(`/api/v1/ops/moderation/${caseId}/action`)
    .set(bearer(token))
    .send({ action, reasonCode });
}

function fileAppeal(
  token: string,
  referenceId: string,
  message = 'This enforcement decision should be reviewed by a human',
) {
  return request(app)
    .post('/api/v1/appeals')
    .set(bearer(token))
    .send({ type: 'enforcement', referenceId, message });
}

function createTicket(
  token: string,
  subject = 'Cannot login',
  body = 'I cannot log in to my account at all, please help me',
) {
  return request(app)
    .post('/api/v1/support/tickets')
    .set(bearer(token))
    .send({ subject, body, category: 'account' });
}

describe.skipIf(!canRun)(
  'moderation, enforcement & support (live Atlas, trust_bazar_test_moderation)',
  () => {
    it('merges duplicate reports and rate-limits the sixth report in 24h', async () => {
      const seller = await makeSeller('+8801813000001');
      const listingId = await seedListing(seller.userId);
      const reporterA = await makeBuyer('+8801813000002');

      const first = await submitReport(reporterA.token, 'listing', listingId);
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      expect(first.body.data.merged).toBe(false);

      const second = await submitReport(reporterA.token, 'listing', listingId);
      expect(second.status, JSON.stringify(second.body)).toBe(201);
      expect(second.body.data.merged).toBe(true);
      expect(second.body.data.reportId).toBe(first.body.data.reportId);
      expect(await db.models.Report.countDocuments({})).toBe(1);

      // A separate reporter so the duplicate pair above does not consume this quota.
      const reporterB = await makeBuyer('+8801813000003');
      for (let index = 0; index < 5; index += 1) {
        const targetId = await seedListing(seller.userId);
        const res = await submitReport(reporterB.token, 'listing', targetId);
        expect(res.status, JSON.stringify(res.body)).toBe(201);
      }

      const sixth = await submitReport(
        reporterB.token,
        'listing',
        await seedListing(seller.userId),
      );
      expect(sixth.status, JSON.stringify(sixth.body)).toBe(429);
      expect(sixth.body.type).toContain('rate_limited');
    });

    it('creates a 48h-SLA moderation case without echoing report target details', async () => {
      const seller = await makeSeller('+8801813000010');
      const listingId = await seedListing(seller.userId);
      const reporter = await makeBuyer('+8801813000011');

      const res = await submitReport(reporter.token, 'listing', listingId, 'Stolen photos');
      expect(res.status, JSON.stringify(res.body)).toBe(201);

      const kase = (await db.models.ModerationCase.findById(
        String(res.body.data.caseId),
      ).lean()) as unknown as { createdAt: Date; slaDue: Date };
      const delta = kase.slaDue.getTime() - kase.createdAt.getTime();
      expect(delta).toBeGreaterThan(47 * HOUR);
      expect(delta).toBeLessThan(49 * HOUR);

      expect(JSON.stringify(res.body)).not.toContain(listingId);
    });

    it('blocks a suspended user from writes but still allows appeals and support', async () => {
      const suspended = await makeSeller('+8801813000020');
      const other = await makeSeller('+8801813000021');
      const listingId = await seedListing(other.userId);

      await db.models.User.updateOne(
        { _id: new Types.ObjectId(suspended.userId) },
        {
          $set: {
            'enforcement.state': 'suspended',
            'enforcement.until': new Date(Date.now() + DAY),
          },
        },
      );
      // Enforcement state rides in the access-token snapshot, so mint a fresh one.
      const fresh = await login('+8801813000020', 'device-suspended-0001');

      const report = await submitReport(fresh.token, 'listing', listingId);
      expect(report.status).toBe(403);
      expect(report.body.type).toContain('enforcement_blocked');

      const thread = await request(app)
        .post('/api/v1/chat/threads')
        .set(bearer(fresh.token))
        .send({ listingId });
      expect(thread.status).toBe(403);
      expect(thread.body.type).toContain('enforcement_blocked');

      const checkout = await request(app)
        .post('/api/v1/boost/checkout')
        .set(bearer(fresh.token))
        .send({ listingId, packageId: 'pkg_basic', provider: 'bkash' });
      expect(checkout.status).toBe(403);
      expect(checkout.body.type).toContain('enforcement_blocked');

      const appeal = await fileAppeal(fresh.token, new Types.ObjectId().toString());
      expect(appeal.status, JSON.stringify(appeal.body)).toBe(201);

      const ticket = await createTicket(fresh.token);
      expect(ticket.status, JSON.stringify(ticket.body)).toBe(201);
    });

    it('enforces the 5-minute claim lock and lets an expired lock be reclaimed', async () => {
      const seller = await makeSeller('+8801813000030');
      const reporter = await makeBuyer('+8801813000031');
      const listingId = await seedListing(seller.userId);
      const reported = await submitReport(reporter.token, 'listing', listingId);
      const caseId = String(reported.body.data.caseId);

      await seedOperator('moderator', 'mod-a@trustbazar.test');
      await seedOperator('moderator', 'mod-b@trustbazar.test');
      const operatorA = await operatorToken('mod-a@trustbazar.test');
      const operatorB = await operatorToken('mod-b@trustbazar.test');

      const claimed = await request(app)
        .post(`/api/v1/ops/moderation/${caseId}/claim`)
        .set(bearer(operatorA))
        .send();
      expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);

      const blocked = await moderate(operatorB, caseId, 'warn');
      expect(blocked.status).toBe(409);
      expect(blocked.body.detail).toBe('case_claimed');

      await db.models.ModerationCase.updateOne(
        { _id: new Types.ObjectId(caseId) },
        { $set: { lockUntil: new Date(Date.now() - 5_000) } },
      );

      const reclaimed = await request(app)
        .post(`/api/v1/ops/moderation/${caseId}/claim`)
        .set(bearer(operatorB))
        .send();
      expect(reclaimed.status, JSON.stringify(reclaimed.body)).toBe(200);
      expect(reclaimed.body.data.id).toBe(caseId);
    });

    it('runs warn → suspend, pauses boosts and gives suspended appeals a 24h SLA', async () => {
      const seller = await makeSeller('+8801813000040');
      const buyer = await makeBuyer('+8801813000041');
      await seedOperator('moderator', 'mod-warn@trustbazar.test');
      const moderator = await operatorToken('mod-warn@trustbazar.test');

      const warnListing = await seedListing(seller.userId);
      const warnedReport = await submitReport(buyer.token, 'listing', warnListing);
      const warnCase = String(warnedReport.body.data.caseId);
      const warned = await moderate(moderator, warnCase, 'warn');
      expect(warned.status, JSON.stringify(warned.body)).toBe(200);

      const warnedUser = (await db.models.User.findById(seller.userId).lean()) as unknown as {
        enforcement?: { state?: string };
      };
      expect(warnedUser.enforcement?.state).toBe('warned');
      const warning = await db.models.Notification.findOne({
        userId: new Types.ObjectId(seller.userId),
        type: 'enforcement.warning',
      });
      expect(warning).not.toBeNull();

      const boostListing = await seedListing(seller.userId, {
        boost: {
          active: true,
          packageId: 'pkg_basic',
          until: new Date(Date.now() + 5 * DAY),
          pausedAt: null,
          remainingMs: null,
        },
      });
      const suspendReport = await submitReport(buyer.token, 'listing', boostListing);
      const suspendCase = String(suspendReport.body.data.caseId);
      const suspended = await moderate(moderator, suspendCase, 'suspend');
      expect(suspended.status, JSON.stringify(suspended.body)).toBe(200);

      const suspendedUser = (await db.models.User.findById(seller.userId).lean()) as unknown as {
        enforcement?: { state?: string; until?: Date | null };
      };
      expect(suspendedUser.enforcement?.state).toBe('suspended');
      const untilMs = new Date(suspendedUser.enforcement?.until ?? 0).getTime() - Date.now();
      expect(untilMs).toBeGreaterThan(6.9 * DAY);
      expect(untilMs).toBeLessThan(7.1 * DAY);

      const pausedListing = (await db.models.Listing.findById(boostListing).lean()) as unknown as {
        boost?: { active?: boolean };
      };
      expect(pausedListing.boost?.active).toBe(false);

      const appeal = await fileAppeal(seller.token, suspendCase);
      expect(appeal.status, JSON.stringify(appeal.body)).toBe(201);
      const appealSla = new Date(String(appeal.body.data.slaDue)).getTime() - Date.now();
      expect(appealSla).toBeGreaterThan(23 * HOUR);
      expect(appealSla).toBeLessThan(25 * HOUR);
    });

    it('requires a different senior approver before a ban is applied', async () => {
      const seller = await makeSeller('+8801813000050');
      await db.models.User.updateOne(
        { _id: new Types.ObjectId(seller.userId) },
        { $set: { nidHash: 'abc123' } },
      );
      const boostedListing = await seedListing(seller.userId, {
        boost: { active: true, until: new Date(Date.now() + 10 * DAY) },
      });
      await seedListing(seller.userId);

      const buyer = await makeBuyer('+8801813000051');
      const thread = await request(app)
        .post('/api/v1/chat/threads')
        .set(bearer(buyer.token))
        .send({ listingId: boostedListing });
      expect(thread.status, JSON.stringify(thread.body)).toBe(200);

      const reported = await submitReport(buyer.token, 'listing', boostedListing);
      const caseId = String(reported.body.data.caseId);

      await seedOperator('moderator', 'mod-ban@trustbazar.test');
      await seedOperator('seniorModerator', 'senior-ban@trustbazar.test');
      const moderator = await operatorToken('mod-ban@trustbazar.test');
      const senior = await operatorToken('senior-ban@trustbazar.test');

      const proposed = await moderate(moderator, caseId, 'ban');
      expect(proposed.status, JSON.stringify(proposed.body)).toBe(202);
      expect(proposed.body.data.status).toBe('pending_second_approval');

      const selfish = await moderate(moderator, caseId, 'ban');
      expect(selfish.status).toBe(403);
      expect(selfish.body.detail).toBe('second_approver_required');

      const applied = await moderate(senior, caseId, 'ban');
      expect(applied.status, JSON.stringify(applied.body)).toBe(200);
      expect(applied.body.data.status).toBe('ban_applied');

      const bannedUser = (await db.models.User.findById(seller.userId).lean()) as unknown as {
        nidHash?: string;
        enforcement?: { state?: string };
      };
      expect(bannedUser.enforcement?.state).toBe('banned');
      expect(bannedUser.nidHash).toBe('abc123');

      const listings = (await db.models.Listing.find({
        sellerId: new Types.ObjectId(seller.userId),
      }).lean()) as unknown as { status?: string }[];
      expect(listings.length).toBeGreaterThan(0);
      for (const listing of listings) expect(listing.status).toBe('delisted');

      const threads = (await db.models.Thread.find({
        sellerId: new Types.ObjectId(seller.userId),
      }).lean()) as unknown as { state?: string }[];
      expect(threads.length).toBeGreaterThan(0);
      for (const item of threads) expect(item.state).toBe('frozen');

      const boosted = (await db.models.Listing.findById(boostedListing).lean()) as unknown as {
        boost?: { active?: boolean; until?: Date | null };
      };
      expect(boosted.boost?.active).toBe(false);
      expect(boosted.boost?.until).toBeNull();
    });

    it('keeps appeals owner-only and restores a reversed enforcement decision', async () => {
      const seller = await makeSeller('+8801813000060');
      const buyer = await makeBuyer('+8801813000061');
      const listingId = await seedListing(seller.userId);
      const reported = await submitReport(buyer.token, 'listing', listingId);
      const caseId = String(reported.body.data.caseId);

      await seedOperator('moderator', 'mod-appeal@trustbazar.test');
      await seedOperator('seniorModerator', 'senior-appeal@trustbazar.test');
      const moderator = await operatorToken('mod-appeal@trustbazar.test');
      const senior = await operatorToken('senior-appeal@trustbazar.test');
      const suspended = await moderate(moderator, caseId, 'suspend');
      expect(suspended.status, JSON.stringify(suspended.body)).toBe(200);

      const appeal = await fileAppeal(seller.token, caseId);
      expect(appeal.status, JSON.stringify(appeal.body)).toBe(201);
      const appealId = String(appeal.body.data.appealId);

      const stranger = await makeBuyer('+8801813000062');
      const peek = await request(app)
        .get(`/api/v1/appeals/${appealId}`)
        .set(bearer(stranger.token));
      expect(peek.status).toBe(404);

      const decided = await request(app)
        .post(`/api/v1/ops/appeals/${appealId}/decide`)
        .set(bearer(senior))
        .send({ outcome: 'reverse', reason: 'The evidence does not support a suspension' });
      expect(decided.status, JSON.stringify(decided.body)).toBe(200);

      const restored = (await db.models.User.findById(seller.userId).lean()) as unknown as {
        enforcement?: { state?: string };
      };
      expect(restored.enforcement?.state).toBe('none');

      const auditDocs = await testDb.collection('auditEvents').find({}).toArray();
      const actions = auditDocs.map((doc) => String(doc.action));
      expect(actions).toContain('appeal.create');
      expect(actions).toContain('enforcement.lift');
      expect(actions.filter((action) => action === 'appeal.create')).toHaveLength(1);
    });

    it('keeps support tickets owner-only and moves them to pending on an ops reply', async () => {
      const owner = await makeBuyer('+8801813000070');
      await db.models.User.updateOne(
        { _id: new Types.ObjectId(owner.userId) },
        { $set: { 'enforcement.state': 'banned', 'enforcement.until': null } },
      );

      const created = await createTicket(owner.token);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const ticketId = String(created.body.data.ticketId);

      const list = await request(app)
        .get('/api/v1/me/support/tickets')
        .set(bearer(owner.token));
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].id).toBe(ticketId);

      const stranger = await makeBuyer('+8801813000071');
      const peek = await request(app)
        .get(`/api/v1/support/tickets/${ticketId}/messages`)
        .set(bearer(stranger.token));
      expect(peek.status).toBe(404);

      await seedOperator('moderator', 'mod-support@trustbazar.test');
      const moderator = await operatorToken('mod-support@trustbazar.test');
      const reply = await request(app)
        .post(`/api/v1/ops/support/${ticketId}/reply`)
        .set(bearer(moderator))
        .send({ body: 'Your access has been restored, please try logging in again' });
      expect(reply.status, JSON.stringify(reply.body)).toBe(200);

      const ticket = (await db.models.SupportTicket.findById(ticketId).lean()) as unknown as {
        status?: string;
        messages?: { authorType?: string }[];
      };
      expect(ticket.status).toBe('pending');
      expect(ticket.messages).toHaveLength(2);
      expect(ticket.messages?.[1]?.authorType).toBe('operator');

      const notification = await db.models.Notification.findOne({
        userId: new Types.ObjectId(owner.userId),
        type: 'support.reply',
      });
      expect(notification).not.toBeNull();
    });

    it('never leaks the reporter identity to the reported user', async () => {
      const reported = await makeSeller('+8801813000080');
      const reporter = await makeBuyer('+8801813000081');
      const listingId = await seedListing(reported.userId);

      const report = await submitReport(reporter.token, 'listing', listingId);
      expect(report.status, JSON.stringify(report.body)).toBe(201);
      expect(JSON.stringify(report.body)).not.toContain(reporter.userId);
      const caseId = String(report.body.data.caseId);

      const appeal = await fileAppeal(reported.token, caseId);
      expect(appeal.status, JSON.stringify(appeal.body)).toBe(201);
      const appealView = await request(app)
        .get(`/api/v1/appeals/${String(appeal.body.data.appealId)}`)
        .set(bearer(reported.token));
      expect(appealView.status).toBe(200);
      expect(JSON.stringify(appealView.body)).not.toContain(reporter.userId);

      const ticket = await createTicket(
        reported.token,
        'Reported listing',
        'I want to understand why my listing was reported by someone',
      );
      expect(ticket.status, JSON.stringify(ticket.body)).toBe(201);
      const tickets = await request(app)
        .get('/api/v1/me/support/tickets')
        .set(bearer(reported.token));
      expect(tickets.status).toBe(200);
      expect(JSON.stringify(tickets.body)).not.toContain(reporter.userId);
    });
  },
);
