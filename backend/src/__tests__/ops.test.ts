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
import { appendAudit } from '../services/audit/audit.service.js';
import { runJob } from '../services/jobs/registry.js';
import { NotificationService } from '../services/notifications/notification.service.js';
import { PaymentService } from '../services/payments/payment.service.js';

loadEnvFile();

// Live Atlas round-trips make the 5 s default too tight for multi-login tests.
vi.setConfig({ testTimeout: 20_000 });

const APP_URI = process.env.MONGO_APP_URI;
const canRun = Boolean(APP_URI);
const SECRET = 'JBSWY3DPEHPK3PXP';

function testUri(uri: string): string {
  const parsed = new URL(uri);
  parsed.pathname = '/trust_bazar_test_ops';
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
  // The audit chain lives on the same throwaway cluster for this suite.
  db = createDbContext(conn, conn);
}, 120_000);

afterAll(async () => {
  if (!canRun) return;
  await testDb.dropDatabase();
  await conn.close();
}, 60_000);

function buildApp(cfg: Config): Express {
  return createApp(cfg, createLogger(cfg), {
    appDb: () => testDb,
    repos: db.repos,
    kv,
    sms,
    rateStore: memoryRateLimitStore(),
  });
}

beforeEach(async () => {
  if (!canRun) return;
  for (const model of Object.values(db.models)) {
    await model.deleteMany({});
  }
  // The audit model hook rejects deletes, so wipe it with the native driver.
  await testDb.collection('auditEvents').deleteMany({});
  outbox.length = 0;
  kv = memoryKv();
  app = buildApp(config);
});

function lastCode(): string {
  const message = outbox[outbox.length - 1];
  const match = /code: (\d{6})/.exec(message?.body ?? '');
  if (!match?.[1]) throw new Error('no OTP in the test outbox');
  return match[1];
}

async function login(phone: string, deviceFp = 'device-ops-0000001') {
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

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function seedOperator(input: { role: string; email: string; ipAllowlist?: string[] }) {
  const doc = await db.models.OperatorAccount.create({
    email: input.email,
    role: input.role,
    totpSecretEnc: SECRET,
    active: true,
    ipAllowlist: input.ipAllowlist ?? [],
  });
  return String((doc as unknown as { _id: unknown })._id);
}

function postOpsLogin(target: Express, email: string, totp: string) {
  return request(target).post('/api/v1/ops/auth/login').send({ email, totp });
}

async function opsLogin(email: string) {
  const res = await postOpsLogin(app, email, generateTotp(SECRET));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return String(res.body.data.token);
}

/** A 6-digit code that is guaranteed different from the current valid code. */
function wrongTotp(secret: string): string {
  const valid = generateTotp(secret);
  const last = Number(valid[5]);
  return `${valid.slice(0, 5)}${(last + 1) % 10}`;
}

async function seedKyc(userId: string) {
  const doc = await db.models.KycSubmission.create({
    userId: new Types.ObjectId(userId),
    scope: 'seller',
    attempt: 1,
    status: 'pending',
    media: { frontId: new Types.ObjectId(), backId: new Types.ObjectId() },
    consentVersion: 'v1',
  });
  return String((doc as unknown as { _id: unknown })._id);
}

describe.skipIf(!canRun)('ops console (live Atlas, trust_bazar_test_ops)', () => {
  it('rejects missing, non-operator and under-privileged callers', async () => {
    const anonymous = await request(app).get('/api/v1/ops/kyc');
    expect(anonymous.status).toBe(401);

    const user = await makeUser('+8801910000001', ['buyer'], 'Ops Outsider');
    const asUser = await request(app).get('/api/v1/ops/kyc').set(bearer(user.token));
    expect(asUser.status).toBe(401);

    const moderatorEmail = 'moderator@trust.local';
    await seedOperator({ role: 'moderator', email: moderatorEmail });
    const moderatorToken = await opsLogin(moderatorEmail);

    const audit = await request(app).get('/api/v1/ops/audit').set(bearer(moderatorToken));
    expect(audit.status).toBe(403);
    expect(audit.body.detail).toBe('operator_role_required');
  });

  it('authenticates operators with TOTP and never 500s on a broken secret', async () => {
    const email = 'reviewer@trust.local';
    await seedOperator({ role: 'kycReviewer', email });

    const unknown = await postOpsLogin(app, 'ghost@trust.local', generateTotp(SECRET));
    expect(unknown.status).toBe(401);
    expect(unknown.body.detail).toBe('invalid_operator_credentials');

    const wrong = await postOpsLogin(app, email, wrongTotp(SECRET));
    expect(wrong.status).toBe(401);
    expect(wrong.body.detail).toBe('invalid_operator_credentials');

    const ok = await postOpsLogin(app, email, generateTotp(SECRET));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(typeof ok.body.data.token).toBe('string');
    expect(ok.body.data.role).toBe('kycReviewer');
    expect(ok.body.data.expiresAt).toBeTruthy();

    // `totpSecretEnc` is `required`, so an empty secret needs a raw insert.
    await db.models.OperatorAccount.collection.insertOne({
      email: 'broken@trust.local',
      role: 'superadmin',
      totpSecretEnc: '',
      active: true,
      ipAllowlist: [],
    });
    const broken = await postOpsLogin(app, 'broken@trust.local', wrongTotp(''));
    expect(broken.status).toBe(401);
  });

  it('enforces the global and per-operator IP allowlists at login', async () => {
    const email = 'ip-locked@trust.local';
    await seedOperator({ role: 'superadmin', email });

    const lockedApp = buildApp({
      ...config,
      OPS_IP_ALLOWLIST: '10.0.0.1',
    } as unknown as Config);
    const blocked = await postOpsLogin(lockedApp, email, generateTotp(SECRET));
    expect(blocked.status).toBe(401);

    const perOperatorEmail = 'ip-locked-2@trust.local';
    await seedOperator({ role: 'superadmin', email: perOperatorEmail, ipAllowlist: ['10.9.9.9'] });
    const blockedPerOperator = await postOpsLogin(app, perOperatorEmail, generateTotp(SECRET));
    expect(blockedPerOperator.status).toBe(401);
  });

  it('claims the KYC queue, decides approvals and requires a reject reason', async () => {
    const reviewerEmail = 'kyc@trust.local';
    const operatorId = await seedOperator({ role: 'kycReviewer', email: reviewerEmail });
    const token = await opsLogin(reviewerEmail);

    const applicant = await login('+8801910000011');
    const kycId = await seedKyc(applicant.userId);

    const first = await request(app).get('/api/v1/ops/kyc?claim=true').set(bearer(token));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.data[0].id).toBe(kycId);

    const claimedDoc = (await db.models.KycSubmission.findById(kycId).lean()) as unknown as {
      claimedBy?: Types.ObjectId | null;
    };
    expect(String(claimedDoc.claimedBy)).toBe(operatorId);

    // Re-reading the queue surfaces the claim made by the first pass.
    const second = await request(app).get('/api/v1/ops/kyc?claim=true').set(bearer(token));
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.data[0].claimedBy).toBe(operatorId);

    const approved = await request(app)
      .post(`/api/v1/ops/kyc/${kycId}/decide`)
      .set(bearer(token))
      .send({ decision: 'approve' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.data.status).toBe('approved');

    const applicantDoc = (await db.models.User.findById(applicant.userId).lean()) as unknown as {
      roles: string[];
    };
    expect(applicantDoc.roles).toEqual(expect.arrayContaining(['verifiedBuyer', 'seller']));

    const other = await login('+8801910000012');
    const rejectId = await seedKyc(other.userId);

    const noReason = await request(app)
      .post(`/api/v1/ops/kyc/${rejectId}/decide`)
      .set(bearer(token))
      .send({ decision: 'reject' });
    expect(noReason.status).toBe(400);

    const rejected = await request(app)
      .post(`/api/v1/ops/kyc/${rejectId}/decide`)
      .set(bearer(token))
      .send({ decision: 'reject', reasonCode: 'UNREADABLE' });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect(rejected.body.data.status).toBe('rejected');

    const rejectedDoc = (await db.models.KycSubmission.findById(rejectId).lean()) as unknown as {
      expiresAt: Date;
    };
    const days = (rejectedDoc.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
  });

  it('returns KYC documents and audits every document view', async () => {
    const reviewerEmail = 'viewer@trust.local';
    await seedOperator({ role: 'kycReviewer', email: reviewerEmail });
    const token = await opsLogin(reviewerEmail);

    const applicant = await login('+8801910000021');
    const kycId = await seedKyc(applicant.userId);

    const res = await request(app).get(`/api/v1/ops/kyc/${kycId}`).set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.documents).toBeTruthy();
    expect(typeof res.body.data.documents).toBe('object');

    const audit = (await db.repos.auditEvents!.findOne({
      action: 'kyc.document_view',
    })) as unknown as { entityId?: unknown } | null;
    expect(audit).toBeTruthy();
    expect(String(audit?.entityId)).toBe(kycId);
  });

  it('keeps auditEvents append-only through the model hooks', async () => {
    await appendAudit(db.repos, { actor: 'system', action: 'chain.one', entityType: 'test' });
    await appendAudit(db.repos, { actor: 'system', action: 'chain.two', entityType: 'test' });

    await expect(
      db.repos.auditEvents!.raw.updateOne({}, { $set: { action: 'x' } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.repos.auditEvents!.raw.deleteOne({})).rejects.toThrow(/append-only/);

    expect(await db.repos.auditEvents!.count({})).toBe(2);
  });

  it('detects a tampered audit chain and alerts the ops inbox', async () => {
    const opsUser = await login('+8801910000031');
    await db.models.Config.create({ _id: 'opsInbox', value: { userId: opsUser.userId } });

    await appendAudit(db.repos, { actor: 'system', action: 'chain.one', entityType: 'test' });
    await appendAudit(db.repos, { actor: 'system', action: 'chain.two', entityType: 'test' });

    // Bypass the append-only hooks the same way an out-of-band attacker would.
    await testDb.collection('auditEvents').updateOne({ seq: 1 }, { $set: { action: 'tampered' } });

    const logger = createLogger(config);
    const notifications = new NotificationService({ repos: db.repos, kv, logger });
    const payments = new PaymentService({ config, logger, repos: db.repos, notifications });

    const result = await runJob('audit-verify', {
      config,
      logger,
      repos: db.repos,
      notifications,
      payments,
    });
    expect(result).toMatchObject({ ok: false, brokenAt: 1 });

    const alert = (await db.models.Notification.findOne({
      type: 'ops.audit_chain_broken',
    }).lean()) as unknown as { userId?: unknown } | null;
    expect(alert).toBeTruthy();
    expect(String(alert?.userId)).toBe(opsUser.userId);
  });

  it('updates config, audits before/after and invalidates the bootstrap cache', async () => {
    const email = 'root@trust.local';
    await seedOperator({ role: 'superadmin', email });
    const token = await opsLogin(email);

    // Seed the current value so the audit entry has a non-empty `before`
    // (Mongoose minimises empty objects away before persisting).
    await db.models.Config.create({
      _id: 'minVersion',
      value: { web: '1.0.0', android: '1.0.0', ios: '1.0.0' },
    });

    const before = await request(app).get('/api/v1/config');
    expect(before.status).toBe(200);
    expect(before.body.data.minVersion.web).toBe('1.0.0');

    const put = await request(app)
      .put('/api/v1/ops/config')
      .set(bearer(token))
      .send({ minVersion: { web: '9.9.9', android: '9.9.9', ios: '9.9.9' } });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.data.minVersion.web).toBe('9.9.9');

    const audit = (await db.repos.auditEvents!.findOne({
      action: 'config.update',
    })) as unknown as {
      before?: { minVersion?: { web?: string } };
      after?: { minVersion?: { web?: string } };
    } | null;
    expect(audit).toBeTruthy();
    expect(audit?.after?.minVersion?.web).toBe('9.9.9');
    expect(audit?.before?.minVersion?.web).toBe('1.0.0');

    const after = await request(app).get('/api/v1/config');
    expect(after.status).toBe(200);
    expect(after.body.data.minVersion.web).toBe('9.9.9');
  });

  it('runs the manual payment reconciliation with numeric counters', async () => {
    const email = 'recon@trust.local';
    await seedOperator({ role: 'superadmin', email });
    const token = await opsLogin(email);

    const res = await request(app).post('/api/v1/ops/reconcile/payments').set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(typeof res.body.data.matched).toBe('number');
    expect(typeof res.body.data.orphanCredits).toBe('number');
    expect(typeof res.body.data.skipped).toBe('number');
  });

  it('gates old clients by minVersion but keeps bootstrap reachable', async () => {
    const email = 'gate@trust.local';
    await seedOperator({ role: 'superadmin', email });
    const token = await opsLogin(email);

    const put = await request(app)
      .put('/api/v1/ops/config')
      .set(bearer(token))
      .send({ minVersion: { web: '2.0.0', android: '2.0.0', ios: '2.0.0' } });
    expect(put.status, JSON.stringify(put.body)).toBe(200);

    const oldClient = await request(app)
      .get('/api/v1/boost/packages')
      .set('x-app-platform', 'web')
      .set('x-app-version', '1.0.0');
    expect(oldClient.status).toBe(426);

    const currentClient = await request(app)
      .get('/api/v1/boost/packages')
      .set('x-app-platform', 'web')
      .set('x-app-version', '2.0.0');
    expect(currentClient.status).not.toBe(426);

    const headerless = await request(app).get('/api/v1/boost/packages');
    expect(headerless.status).not.toBe(426);

    const bootstrap = await request(app)
      .get('/api/v1/config')
      .set('x-app-platform', 'web')
      .set('x-app-version', '1.0.0');
    expect(bootstrap.status).toBe(200);
  });
});
