import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import mongoose, { type Connection } from 'mongoose';
import type { Express } from 'express';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config/index.js';
import { applyIndexes, applyValidators } from '../db/migrate.js';
import { createDbContext, type DbContext } from '../db/context.js';
import { APP_INDEXES } from '../db/indexes.js';
import { createApp } from '../app.js';
import { loadEnvFile } from '../lib/env.js';
import { memoryKv } from '../lib/kv.js';
import { createLogger } from '../lib/logger.js';
import type { SmsMessage, SmsSender } from '../lib/sms.js';
import { memoryRateLimitStore } from '../middleware/index.js';

loadEnvFile();

const APP_URI = process.env.MONGO_APP_URI;
const canRun = Boolean(APP_URI);
const STORAGE_DIR = resolve(process.cwd(), '.storage-test', `media-${randomUUID()}`);

function testUri(uri: string): string {
  const parsed = new URL(uri);
  parsed.pathname = '/trust_bazar_test_media';
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
  await db.models.User.deleteMany({});
  await db.models.MediaObject.deleteMany({});
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

async function login(phone: string, deviceFp = 'device-media-0001') {
  const otp = await request(app).post('/api/v1/auth/otp/request').send({ phone });
  const res = await request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ otpId: otp.body.data.otpId, code: lastCode(), deviceFp, platform: 'web' });
  expect(res.status).toBe(200);
  return String(res.body.data.accessToken);
}

async function jpeg(width = 800, height = 600, withExif = false) {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } },
  });
  return withExif
    ? image.withMetadata({ exif: { IFD0: { ImageDescription: 'secret-location-tag' } } }).jpeg().toBuffer()
    : image.jpeg().toBuffer();
}

async function sign(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; mediaId: string; uploadUrl: string; body: Record<string, unknown> }> {
  const res = await request(app)
    .post('/api/v1/media/sign')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  const upload = (res.body?.data?.uploads ?? [])[0] ?? {};
  return {
    status: res.status,
    mediaId: String(upload.mediaId ?? ''),
    uploadUrl: String(upload.uploadUrl ?? ''),
    body: res.body,
  };
}

async function upload(uploadUrl: string, bytes: Buffer, contentType: string) {
  const parsed = new URL(uploadUrl);
  return request(app)
    .put(`${parsed.pathname}${parsed.search}`)
    .set('Content-Type', contentType)
    .send(bytes);
}

async function complete(token: string, mediaId: string) {
  return request(app)
    .post(`/api/v1/media/${mediaId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
}

describe.skipIf(!canRun)('media (live Atlas + local storage driver)', () => {
  it('signs, uploads, scans and re-encodes a clean image', async () => {
    const token = await login('+8801811111111');
    const bytes = await jpeg();

    const signed = await sign(token, {
      purpose: 'listing',
      contentType: 'image/jpeg',
      sizeBytes: bytes.length,
      count: 1,
    });
    expect(signed.status).toBe(201);
    expect(signed.mediaId).toMatch(/^[a-f\d]{24}$/);

    const put = await upload(signed.uploadUrl, bytes, 'image/jpeg');
    expect(put.status).toBe(204);

    const done = await complete(token, signed.mediaId);
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('clean');
    expect(done.body.data.width).toBe(800);
    expect(done.body.data.height).toBe(600);
    expect(done.body.data.pHash).toMatch(/^[a-f\d]{16}$/);

    const media = await db.models.MediaObject.findById(signed.mediaId);
    expect(media?.status).toBe('clean');
    expect(String(media?.r2Key).startsWith('clean/listing/')).toBe(true);
    expect(media?.sha256).toMatch(/^[a-f\d]{64}$/);
  });

  it('quarantines an executable renamed to .jpg', async () => {
    const token = await login('+8801811111112');
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(600, 0x90)]);

    const signed = await sign(token, {
      purpose: 'listing',
      contentType: 'image/jpeg',
      sizeBytes: exe.length,
    });
    expect((await upload(signed.uploadUrl, exe, 'image/jpeg')).status).toBe(204);

    const done = await complete(token, signed.mediaId);
    expect(done.status).toBe(422);
    expect(done.body.detail).toBe('media_quarantined');

    const media = await db.models.MediaObject.findById(signed.mediaId);
    expect(media?.status).toBe('quarantined');
    expect(media?.scanReason).toBe('executable_content');
    expect(String(media?.r2Key).startsWith('quarantine/listing/')).toBe(true);
  });

  it('quarantines a mismatched content type and plain text', async () => {
    const token = await login('+8801811111113');
    const png = await sharp({
      create: { width: 500, height: 500, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();

    const signed = await sign(token, {
      purpose: 'listing',
      contentType: 'image/jpeg',
      sizeBytes: png.length,
    });
    await upload(signed.uploadUrl, png, 'image/jpeg');
    const mismatch = await complete(token, signed.mediaId);
    expect(mismatch.status).toBe(422);
    expect((await db.models.MediaObject.findById(signed.mediaId))?.scanReason).toBe(
      'content_type_mismatch',
    );

    const text = Buffer.from('not an image at all, just text');
    const second = await sign(token, {
      purpose: 'listing',
      contentType: 'image/jpeg',
      sizeBytes: text.length,
    });
    await upload(second.uploadUrl, text, 'image/jpeg');
    expect((await complete(token, second.mediaId)).status).toBe(422);
    expect((await db.models.MediaObject.findById(second.mediaId))?.scanReason).toBe(
      'unsupported_media_type',
    );
  });

  it('strips EXIF metadata by re-encoding', async () => {
    const token = await login('+8801811111114');
    const bytes = await jpeg(900, 700, true);
    expect((await sharp(bytes).metadata()).exif).toBeTruthy();

    const signed = await sign(token, {
      purpose: 'listing',
      contentType: 'image/jpeg',
      sizeBytes: bytes.length,
    });
    await upload(signed.uploadUrl, bytes, 'image/jpeg');
    expect((await complete(token, signed.mediaId)).status).toBe(200);

    const media = await db.models.MediaObject.findById(signed.mediaId);
    const stored = await sharp(resolve(STORAGE_DIR, String(media?.r2Key))).metadata();
    expect(stored.exif).toBeUndefined();
  });

  it('enforces per-purpose size caps and count limits', async () => {
    const token = await login('+8801811111115');

    const tooBig = await sign(token, {
      purpose: 'profile',
      contentType: 'image/jpeg',
      sizeBytes: 4 * 1024 * 1024,
    });
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.detail).toBe('photo_too_large');

    const overCap = await sign(token, {
      purpose: 'listing',
      contentType: 'image/jpeg',
      sizeBytes: 1000,
      count: 11,
    });
    expect(overCap.status).toBe(400);

    const kycCap = await sign(token, {
      purpose: 'kyc',
      contentType: 'image/jpeg',
      sizeBytes: 1000,
      count: 3,
    });
    expect(kycCap.status).toBe(400);

    const batch = await sign(token, {
      purpose: 'listing',
      contentType: 'image/jpeg',
      sizeBytes: 1000,
      count: 10,
    });
    expect(batch.status).toBe(201);
    expect(batch.body.data).toBeTruthy();
    expect(await db.models.MediaObject.countDocuments({})).toBe(10);
  });

  it('refuses to complete another user’s upload', async () => {
    const owner = await login('+8801811111116');
    const attacker = await login('+8801811111117', 'device-media-attacker');
    const signed = await sign(owner, {
      purpose: 'listing',
      contentType: 'image/jpeg',
      sizeBytes: 1000,
    });

    const res = await complete(attacker, signed.mediaId);
    expect(res.status).toBe(404);
  });

  it('rejects an upload with a tampered signature', async () => {
    const token = await login('+8801811111118');
    const signed = await sign(token, {
      purpose: 'listing',
      contentType: 'image/jpeg',
      sizeBytes: 1000,
    });
    const parsed = new URL(signed.uploadUrl);
    parsed.searchParams.set('sig', 'deadbeef');

    const res = await request(app)
      .put(`${parsed.pathname}${parsed.search}`)
      .set('Content-Type', 'image/jpeg')
      .send(await jpeg(400, 400));
    expect(res.status).toBe(403);
  });

  it('processes through the internal worker endpoint with the shared secret', async () => {
    const token = await login('+8801811111119');
    const bytes = await jpeg(600, 400);
    const signed = await sign(token, {
      purpose: 'listing',
      contentType: 'image/jpeg',
      sizeBytes: bytes.length,
    });
    await upload(signed.uploadUrl, bytes, 'image/jpeg');

    const denied = await request(app).post(
      `/api/v1/internal/media/${signed.mediaId}/process`,
    );
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .post(`/api/v1/internal/media/${signed.mediaId}/process`)
      .set('x-internal-secret', 'test-internal-secret-123456');
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('clean');
  });

  it('fails closed when the upload never landed', async () => {
    const token = await login('+8801811111120');
    const signed = await sign(token, {
      purpose: 'listing',
      contentType: 'image/jpeg',
      sizeBytes: 1000,
    });

    const res = await complete(token, signed.mediaId);
    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('upload_missing');
  });
});
