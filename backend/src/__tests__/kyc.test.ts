import { createHmac, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import express from 'express';
import mongoose, { Types, type Connection } from 'mongoose';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config/index.js';
import { applyIndexes, applyValidators } from '../db/migrate.js';
import { createDbContext, type DbContext } from '../db/context.js';
import { APP_INDEXES } from '../db/indexes.js';
import { createApp } from '../app.js';
import { decryptPii } from '../lib/crypto.js';
import { loadEnvFile } from '../lib/env.js';
import { memoryKv } from '../lib/kv.js';
import { createLogger } from '../lib/logger.js';
import type { SmsMessage, SmsSender } from '../lib/sms.js';
import { memoryRateLimitStore, errorHandler, requireKyc } from '../middleware/index.js';

loadEnvFile();

const APP_URI = process.env.MONGO_APP_URI;
const canRun = Boolean(APP_URI);
const STORAGE_DIR = resolve(process.cwd(), '.storage-test', `kyc-${randomUUID()}`);
const WEBHOOK_SECRET = 'test-porichoy-webhook-secret';

function testUri(uri: string): string {
  const parsed = new URL(uri);
  parsed.pathname = '/trust_bazar_test_kyc';
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
  STORAGE_DRIVER: 'local',
  MEDIA_LOCAL_DIR: STORAGE_DIR,
  INTERNAL_SECRET: 'test-internal-secret-123456',
  PORICHOY_WEBHOOK_SECRET: WEBHOOK_SECRET,
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
  await rm(STORAGE_DIR, { recursive: true, force: true });
}, 60_000);

beforeEach(async () => {
  if (!canRun) return;
  await Promise.all([
    db.models.User.deleteMany({}),
    db.models.MediaObject.deleteMany({}),
    db.models.KycSubmission.deleteMany({}),
    db.models.Consent.deleteMany({}),
  ]);
  outbox.length = 0;
  app = createApp(config, createLogger(config), {
    appDb: () => testDb,
    repos: db.repos,
    kv: memoryKv(),
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

async function login(phone: string, deviceFp = 'device-kyc-device-01') {
  const otp = await request(app).post('/api/v1/auth/otp/request').send({ phone });
  const res = await request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ otpId: otp.body.data.otpId, code: lastCode(), deviceFp, platform: 'web' });
  expect(res.status, `otp/verify ${phone}: ${JSON.stringify(res.body)}`).toBe(200);
  return { token: String(res.body.data.accessToken), userId: String(res.body.data.user.id) };
}

async function kycMedia(ownerId: string, status = 'clean') {
  const doc = await db.models.MediaObject.create({
    ownerId: new Types.ObjectId(ownerId),
    purpose: 'kyc',
    r2Key: `clean/kyc/${new Types.ObjectId().toString()}.jpg`,
    status,
    contentType: 'image/jpeg',
  });
  return String(doc._id);
}

async function submitSeller(token: string) {
  const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
  const userId = String(me.body.data.id);
  return request(app)
    .post('/api/v1/kyc/seller')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nidFrontMediaId: await kycMedia(userId),
      nidBackMediaId: await kycMedia(userId),
      selfieMediaId: await kycMedia(userId),
      livenessId: 'liveness-session-1',
      consentVersion: 'v1',
    });
}

async function webhook(payload: Record<string, unknown>, signature?: string) {
  // Send the raw JSON string: supertest would JSON-serialize a Buffer, which
  // changes the bytes the signature was computed over.
  const raw = JSON.stringify(payload);
  const sig = signature ?? createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
  return request(app)
    .post('/api/v1/webhooks/porichoy')
    .set('Content-Type', 'application/json')
    .set('x-porichoy-signature', sig)
    .send(raw);
}

function approvedPayload(txnId: string, nid = '1995123456789') {
  return {
    txnId,
    nidNumber: nid,
    name: 'Rahim Uddin',
    dateOfBirth: '1995-04-12',
    photoMatch: true,
    status: 'approved',
  };
}

describe.skipIf(!canRun)('kyc (live Atlas, vendor stubbed at the boundary)', () => {
  it('parks a seller submission as pending-vendor when Porichoy is not configured', async () => {
    const seller = await login('+8801911111111');
    const res = await submitSeller(seller.token);

    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('pending-vendor');
    expect(res.body.data.attempt).toBe(1);

    const submission = await db.models.KycSubmission.findById(res.body.data.submissionId);
    expect(submission?.status).toBe('pending-vendor');
    expect(String(submission?.porichoyTxnId).startsWith('tb-')).toBe(true);
    expect(await db.models.Consent.countDocuments({ doc: 'kyc' })).toBe(1);
  });

  it('rejects KYC media that is not clean or not owned', async () => {
    const seller = await login('+8801911111112');
    const other = await login('+8801911111113', 'device-kyc-other-01');

    const foreign = await kycMedia(other.userId);
    const notMine = await request(app)
      .post('/api/v1/kyc/buyer')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ nidFrontMediaId: foreign, nidBackMediaId: await kycMedia(seller.userId), consentVersion: 'v1' });
    expect(notMine.status).toBe(400);

    const quarantined = await kycMedia(seller.userId, 'quarantined');
    const dirty = await request(app)
      .post('/api/v1/kyc/buyer')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ nidFrontMediaId: quarantined, nidBackMediaId: await kycMedia(seller.userId), consentVersion: 'v1' });
    expect(dirty.status).toBe(400);
    expect(dirty.body.errors[0].message).toBe('media_not_clean');
  });

  it('caps a user at three attempts per 30 days', async () => {
    const seller = await login('+8801911111114');
    for (let index = 0; index < 3; index += 1) {
      expect((await submitSeller(seller.token)).status).toBe(202);
    }
    const fourth = await submitSeller(seller.token);
    expect(fourth.status).toBe(422);
    expect(fourth.body.detail).toBe('kyc_attempt_limit');
  }, 60_000);

  it('approves on a signed webhook: roles, encrypted PII and the NID hash', async () => {
    const seller = await login('+8801911111115');
    const submitted = await submitSeller(seller.token);
    const submission = await db.models.KycSubmission.findById(submitted.body.data.submissionId);
    const txnId = String(submission?.porichoyTxnId);

    const res = await webhook(approvedPayload(txnId));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');

    const user = await db.models.User.findById(seller.userId);
    expect(user?.nidHash).toMatch(/^[a-f\d]{64}$/);
    expect(decryptPii(String(user?.nidEnc), config.ENCRYPTION_KEY)).toBe('1995123456789');
    expect(decryptPii(String(user?.nameEnc), config.ENCRYPTION_KEY)).toBe('Rahim Uddin');
    expect(user?.roles).toEqual(expect.arrayContaining(['verifiedBuyer', 'seller']));

    const approved = await db.models.KycSubmission.findById(submitted.body.data.submissionId);
    expect(approved?.status).toBe('approved');
    expect(approved?.expiresAt).toBeTruthy();

    const duplicate = await webhook(approvedPayload(txnId));
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data.duplicate).toBe(true);
  });

  it('rejects a second account that reuses the same NID', async () => {
    const first = await login('+8801911111116');
    const second = await login('+8801911111117', 'device-kyc-second-01');

    const firstSubmission = await submitSeller(first.token);
    const firstTxn = String(
      (await db.models.KycSubmission.findById(firstSubmission.body.data.submissionId))?.porichoyTxnId,
    );
    expect((await webhook(approvedPayload(firstTxn))).body.data.status).toBe('approved');

    const secondSubmission = await submitSeller(second.token);
    const secondTxn = String(
      (await db.models.KycSubmission.findById(secondSubmission.body.data.submissionId))?.porichoyTxnId,
    );
    const duplicate = await webhook(approvedPayload(secondTxn));
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data.status).toBe('rejected');
    expect(duplicate.body.data.reasonCode).toBe('DUPLICATE_NID');

    const blocked = await db.models.KycSubmission.findById(secondSubmission.body.data.submissionId);
    expect(blocked?.status).toBe('rejected');
    expect(blocked?.reasonCode).toBe('DUPLICATE_NID');
    expect(blocked?.expiresAt).toBeTruthy();
  });

  it('rejects a failed liveness / photo match', async () => {
    const buyer = await login('+8801911111118');
    const media = [
      await kycMedia(buyer.userId),
      await kycMedia(buyer.userId),
    ];
    const submitted = await request(app)
      .post('/api/v1/kyc/buyer')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ nidFrontMediaId: media[0], nidBackMediaId: media[1], consentVersion: 'v1' });
    expect(submitted.status).toBe(202);

    const submission = await db.models.KycSubmission.findById(submitted.body.data.submissionId);
    const res = await webhook({
      ...approvedPayload(String(submission?.porichoyTxnId)),
      photoMatch: false,
    });

    expect(res.body.data.status).toBe('rejected');
    expect(res.body.data.reasonCode).toBe('MISMATCH');
    const fresh = await db.models.KycSubmission.findById(submitted.body.data.submissionId);
    expect(fresh?.status).toBe('rejected');
  });

  it('rejects an unsigned or wrongly signed webhook', async () => {
    const bad = await webhook({}, 'deadbeef');
    expect(bad.status).toBe(403);
    expect(bad.body.detail).toBe('invalid_signature');

    const missing = await request(app)
      .post('/api/v1/webhooks/porichoy')
      .set('Content-Type', 'application/json')
      .send('{}');
    expect(missing.status).toBe(403);
  });

  it('recovers a lost SIM with liveness only, never re-collecting the NID', async () => {
    const seller = await login('+8801911111119');
    const submitted = await submitSeller(seller.token);
    const submission = await db.models.KycSubmission.findById(submitted.body.data.submissionId);
    await webhook(approvedPayload(String(submission?.porichoyTxnId)));

    const res = await request(app)
      .post('/api/v1/kyc/recover')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ selfieMediaId: await kycMedia(seller.userId), livenessId: 'liveness-retry-1' });

    expect(res.status).toBe(200);
    expect(res.body.data.verified).toBe(true);

    const recovered = await db.models.KycSubmission.findOne({ consentVersion: 'recovery-v1' });
    expect(recovered?.status).toBe('approved');
    const recoveredFront = (recovered?.media as { frontId?: unknown } | undefined)?.frontId;
    const originalFront = (submission?.media as { frontId?: unknown } | undefined)?.frontId;
    expect(String(recoveredFront)).toBe(String(originalFront));
  });

  it('blocks a banned identity from starting KYC', async () => {
    const banned = await login('+8801911111120');
    await db.models.User.updateOne(
      { _id: new Types.ObjectId(banned.userId) },
      { $set: { enforcement: { state: 'banned' } } },
    );

    const res = await submitSeller(banned.token);
    expect(res.status).toBe(403);
    expect(res.body.type).toContain('enforcement_blocked');
  });

  it('exposes KYC status and gates capabilities with 403 kyc_required', async () => {
    const buyer = await login('+8801911111121');
    const status = await request(app)
      .get('/api/v1/kyc/status')
      .set('Authorization', `Bearer ${buyer.token}`);
    expect(status.status).toBe(200);
    expect(status.body.data.verified).toBe(false);
    expect(status.body.data.submission).toBeNull();

    const mini = express();
    mini.get('/chat', (req, _res, next) => {
      req.user = { id: buyer.userId, roles: ['buyer'], enforcement: { state: 'none' } } as never;
      next();
    }, requireKyc('buyer'), (_req, res) => {
      res.json({ ok: true });
    });
    mini.use(errorHandler(createLogger(config), false));
    const denied = await request(mini).get('/chat');
    expect(denied.status).toBe(403);
    expect(denied.body.detail).toBe('kyc_required');
  });
});
