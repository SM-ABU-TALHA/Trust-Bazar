import mongoose, { Types, type Connection } from 'mongoose';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config/index.js';
import { applyIndexes, applyValidators } from '../db/migrate.js';
import { createDbContext, type DbContext } from '../db/context.js';
import { APP_INDEXES } from '../db/indexes.js';
import { createApp } from '../app.js';
import { sha256 } from '../lib/crypto.js';
import { loadEnvFile } from '../lib/env.js';
import { memoryKv, type KvStore } from '../lib/kv.js';
import { createLogger } from '../lib/logger.js';
import type { SmsMessage, SmsSender } from '../lib/sms.js';
import { memoryRateLimitStore } from '../middleware/index.js';
import { REFRESH_COOKIE } from '../services/auth/tokens.js';

loadEnvFile();

const APP_URI = process.env.MONGO_APP_URI;
const canRun = Boolean(APP_URI);

/** Never touch the real database — always redirect to a throwaway DB. */
function testUri(uri: string): string {
  const parsed = new URL(uri);
  parsed.pathname = '/trust_bazar_test_auth';
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
  await db.models.User.deleteMany({});
  await db.models.SecurityEvent.deleteMany({});
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

async function login(
  phone: string,
  deviceFp = 'device-fingerprint-0001',
  platform: 'web' | 'android' | 'ios' = 'web',
) {
  const { res: otpRes, code, otpId } = await requestOtp(phone);
  expect(otpRes.status).toBe(200);
  return request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ otpId, code, deviceFp, platform });
}

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  const pair = list
    .map((cookie) => cookie.split(';')[0] ?? '')
    .find((entry) => entry.startsWith(`${REFRESH_COOKIE}=`));
  if (!pair) throw new Error('refresh cookie missing');
  return pair.slice(REFRESH_COOKIE.length + 1);
}

function refresh(token: string) {
  return request(app).post('/api/v1/auth/refresh').set('Cookie', `${REFRESH_COOKIE}=${token}`);
}

describe.skipIf(!canRun)('auth (live Atlas, trust_bazar_test_auth)', () => {
  it('issues an OTP without ever returning or logging the code', async () => {
    const res = await request(app)
      .post('/api/v1/auth/otp/request')
      .send({ phone: '01712345678' });

    expect(res.status).toBe(200);
    expect(res.body.data.expiresInSec).toBe(300);
    expect(res.body.data.otpId).toMatch(/^[0-9a-f-]{36}$/);

    const code = lastCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(res.body)).not.toContain(code);
    expect(outbox[0]?.to).toBe('+8801712345678');
  });

  it('enforces the 60-second resend cooldown', async () => {
    const first = await request(app)
      .post('/api/v1/auth/otp/request')
      .send({ phone: '+8801712345678' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/v1/auth/otp/request')
      .send({ phone: '+8801712345678' });
    expect(second.status).toBe(429);
    expect(second.headers['retry-after']).toBeDefined();
  });

  it('caps OTP requests at 5 per number per day', async () => {
    for (let i = 0; i < 5; i++) {
      const { res } = await requestOtp('+8801712345678');
      expect(res.status).toBe(200);
    }
    const blocked = await request(app)
      .post('/api/v1/auth/otp/request')
      .send({ phone: '+8801712345678' });
    expect(blocked.status).toBe(429);
  });

  it('rejects a wrong code and still accepts the right one', async () => {
    const { otpId, code } = await requestOtp('+8801712345678');
    const wrongCode = code === '000000' ? '111111' : '000000';

    const wrong = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ otpId, code: wrongCode, deviceFp: 'device-fingerprint-0001', platform: 'web' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.detail).toBe('otp_incorrect');

    const ok = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ otpId, code, deviceFp: 'device-fingerprint-0001', platform: 'web' });
    expect(ok.status).toBe(200);
  });

  it('creates the user on first login and reuses it afterwards', async () => {
    const first = await login('+8801712345678');
    expect(first.status).toBe(200);
    expect(first.body.data.isNew).toBe(true);
    expect(first.body.data.user.roles).toEqual(['buyer']);
    expect(first.body.data.accessToken).toBeTypeOf('string');
    expect(String(first.headers['set-cookie'])).toContain('HttpOnly');

    const second = await login('+8801712345678');
    expect(second.status).toBe(200);
    expect(second.body.data.isNew).toBe(false);
    expect(second.body.data.stepUpRequired).toBe(false);

    expect(await db.models.User.countDocuments({ phone: '+8801712345678' })).toBe(1);
  });

  it('evicts the oldest session on the 4th login', async () => {
    const phones = '+8801712345678';
    const fingerprints = ['fp-device-one-0001', 'fp-device-two-0002', 'fp-device-three-03', 'fp-device-four-0004'];

    for (const fingerprint of fingerprints) {
      const res = await login(phones, fingerprint, 'web');
      expect(res.status).toBe(200);
    }

    const user = await db.models.User.findOne({ phone: phones }).lean<{
      sessions: Array<{ deviceIdHash: string }>;
    }>();
    expect(user?.sessions).toHaveLength(3);
    const hashes = (user?.sessions ?? []).map((session) => session.deviceIdHash);
    expect(hashes).not.toContain(sha256(fingerprints[0] as string));
    expect(hashes).toContain(sha256(fingerprints[3] as string));
  });

  it('flags step-up for a new device on a KYC-verified account', async () => {
    await login('+8801712345678', 'fp-known-device-0001');
    await db.models.User.updateOne(
      { phone: '+8801712345678' },
      { $set: { roles: ['buyer', 'verifiedBuyer'] } },
    );

    const known = await login('+8801712345678', 'fp-known-device-0001');
    expect(known.body.data.stepUpRequired).toBe(false);

    const newDevice = await login('+8801712345678', 'fp-brand-new-device-2');
    expect(newDevice.body.data.stepUpRequired).toBe(true);

    const events = await db.models.SecurityEvent.find({ type: 'newDevice' }).lean();
    expect(events).toHaveLength(1);
  });

  it('rotates refresh tokens and wipes all sessions on reuse', async () => {
    const loginRes = await login('+8801712345678', 'fp-device-one-0001');
    const original = cookieFrom(loginRes);

    const rotated = await refresh(original);
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.accessToken).toBeTypeOf('string');
    const next = cookieFrom(rotated);
    expect(next).not.toBe(original);

    const replay = await refresh(original);
    expect(replay.status).toBe(401);
    expect(replay.body.type).toContain('token_revoked');
    expect(outbox.some((message) => message.body.includes('security alert'))).toBe(true);

    const user = await db.models.User.findOne({ phone: '+8801712345678' }).lean<{
      sessions: unknown[];
    }>();
    expect(user?.sessions).toHaveLength(0);

    // The rotated token is dead too — every session was killed.
    const afterKill = await refresh(next);
    expect(afterKill.status).toBe(401);
  });

  it('revokes the session on logout immediately', async () => {
    const loginRes = await login('+8801712345678', 'fp-device-one-0001');
    const accessToken = String(loginRes.body.data.accessToken);

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(logout.status).toBe(204);

    const sessions = await request(app)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(sessions.status).toBe(401);
    expect(sessions.body.type).toContain('token_revoked');
  });

  it('lists sessions, refuses to revoke the current one, revokes another', async () => {
    const phone = '+8801712345678';
    const first = await login(phone, 'fp-device-one-0001');
    const second = await login(phone, 'fp-device-two-0002', 'android');
    const token = String(second.body.data.accessToken);

    const list = await request(app)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(list.body.data[0]).not.toHaveProperty('refreshTokenHash');

    const currentId = list.body.data.find((s: { current: boolean }) => s.current).id;
    const otherId = list.body.data.find((s: { current: boolean }) => !s.current).id;

    const refuse = await request(app)
      .delete(`/api/v1/auth/sessions/${currentId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(refuse.status).toBe(409);

    const revoke = await request(app)
      .delete(`/api/v1/auth/sessions/${otherId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(revoke.status).toBe(204);

    const firstToken = String(first.body.data.accessToken);
    const dead = await request(app)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${firstToken}`);
    expect(dead.status).toBe(401);
  });

  it('changes phone after both OTPs and keeps the NID hash intact', async () => {
    const loginRes = await login('+8801712345678', 'fp-device-one-0001');
    const accessToken = String(loginRes.body.data.accessToken);
    const userId = String(loginRes.body.data.user.id);

    await db.models.User.updateOne({ _id: userId }, { $set: { nidHash: 'nid-hash-abc123' } });

    const oldOtp = await requestOtp('+8801712345678');
    const newOtp = await requestOtp('+8801712987654');

    const changed = await request(app)
      .post('/api/v1/account/phone/change')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        newPhone: '+8801712987654',
        otpId: newOtp.otpId,
        code: newOtp.code,
        currentOtpId: oldOtp.otpId,
        currentCode: oldOtp.code,
      });

    expect(changed.status).toBe(200);
    expect(changed.body.data.phone).toBe('+8801712987654');

    const user = await db.models.User.findById(new Types.ObjectId(userId)).lean<{
      phone: string;
      nidHash: string;
    }>();
    expect(user?.phone).toBe('+8801712987654');
    expect(user?.nidHash).toBe('nid-hash-abc123');
  });

  it('accepts a lost-SIM recovery request as pending vendor verification', async () => {
    const res = await request(app)
      .post('/api/v1/auth/recover')
      .send({
        nidFrontMediaId: '66f1a2b3c4d5e6f708192a01',
        nidBackMediaId: '66f1a2b3c4d5e6f708192a02',
        selfieMediaId: '66f1a2b3c4d5e6f708192a03',
        livenessId: 'liveness-session-1',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.recoveryId).toMatch(/^[0-9a-f-]{36}$/);

    const stored = await kv.get(`recovery:${res.body.data.recoveryId}`);
    expect(JSON.parse(String(stored)).status).toBe('pending-vendor');
  });
});
