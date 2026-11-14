import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import mongoose, { Types, type Connection } from 'mongoose';
import type { Express } from 'express';
import request from 'supertest';
import { io as ioClient, type Socket } from 'socket.io-client';
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
import { attachRealtime } from '../realtime/socket.js';
import { ChatService } from '../services/chat/chat.service.js';

loadEnvFile();

// Live Atlas round-trips make the 5 s default too tight for multi-login tests.
vi.setConfig({ testTimeout: 20_000 });

const APP_URI = process.env.MONGO_APP_URI;
const canRun = Boolean(APP_URI);

function testUri(uri: string): string {
  const parsed = new URL(uri);
  parsed.pathname = '/trust_bazar_test_chat';
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

async function login(phone: string, deviceFp = 'device-chat-0001') {
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

function createThread(token: string, listingId: string) {
  return request(app).post('/api/v1/chat/threads').set(bearer(token)).send({ listingId });
}

async function threadFor(
  buyerToken: string,
  sellerId: string,
  _phone: string,
): Promise<{ threadId: string; listingId: string }> {
  const listingId = await seedListing(sellerId);
  const res = await createThread(buyerToken, listingId);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { threadId: String(res.body.data.threadId), listingId };
}

function send(token: string, threadId: string, body: string, clientMsgId: string) {
  return request(app)
    .post(`/api/v1/chat/threads/${threadId}/messages`)
    .set(bearer(token))
    .send({ clientMsgId, body });
}

function getMessages(token: string, threadId: string, query = '') {
  return request(app)
    .get(`/api/v1/chat/threads/${threadId}/messages${query}`)
    .set(bearer(token));
}

function reveal(token: string, threadId: string) {
  return request(app).post(`/api/v1/chat/threads/${threadId}/reveal`).set(bearer(token));
}

async function readThread(threadId: string) {
  return (await db.models.Thread.findById(threadId).lean()) as unknown as {
    state: string;
    buyerMsgCount: number;
    lastMessageAt?: Date | null;
  };
}

describe.skipIf(!canRun)('chat & offers (live Atlas, trust_bazar_test_chat)', () => {
  it('blocks unverified buyers from opening a thread', async () => {
    const seller = await makeSeller('+8801812000001');
    const listingId = await seedListing(seller.userId);
    const buyer = await login('+8801812000002');

    const res = await createThread(buyer.token, listingId);
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('kyc_required');
  });

  it('get-or-creates one thread per (listing,buyer) and honours listing/seller gates', async () => {
    const seller = await makeSeller('+8801812000010');
    const buyer = await makeBuyer('+8801812000011');
    const listingId = await seedListing(seller.userId);

    const first = await createThread(buyer.token, listingId);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data.state).toBe('active');

    const second = await createThread(buyer.token, listingId);
    expect(second.body.data.threadId).toBe(first.body.data.threadId);
    expect(await db.models.Thread.countDocuments({})).toBe(1);

    const listing = (await db.models.Listing.findById(listingId).lean()) as unknown as {
      stats?: { chatStarts?: number };
    };
    expect(listing.stats?.chatStarts).toBe(1);

    const ownListing = await seedListing(buyer.userId);
    const own = await createThread(buyer.token, ownListing);
    expect(own.status).toBe(422);
    expect(own.body.detail).toBe('cannot_chat_own_listing');

    const soldListing = await seedListing(seller.userId, { status: 'sold' });
    const sold = await createThread(buyer.token, soldListing);
    expect(sold.status).toBe(403);
    expect(sold.body.detail).toBe('listing_not_chat_available');

    const bannedSeller = await makeSeller('+8801812000012');
    await db.models.User.updateOne(
      { _id: new Types.ObjectId(bannedSeller.userId) },
      { $set: { 'enforcement.state': 'banned' } },
    );
    const bannedListing = await seedListing(bannedSeller.userId);
    const frozen = await createThread(buyer.token, bannedListing);
    expect(frozen.status).toBe(200);
    expect(frozen.body.data.state).toBe('frozen');
  });

  it('flags off-platform contacts and increments buyerMsgCount', async () => {
    const seller = await makeSeller('+8801812000020');
    const buyer = await makeBuyer('+8801812000021');
    const { threadId } = await threadFor(buyer.token, seller.userId, '+8801812000020');

    const res = await send(
      buyer.token,
      threadId,
      'Call 01712345678 or visit https://evil.example now',
      'msg-flags-0001',
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.flags).toEqual(
      expect.arrayContaining(['offPlatformWarn', 'urlWarn']),
    );

    const thread = await readThread(threadId);
    expect(thread.buyerMsgCount).toBe(1);
    expect(thread.lastMessageAt).toBeTruthy();
  });

  it('replays the original message for a repeated clientMsgId', async () => {
    const seller = await makeSeller('+8801812000030');
    const buyer = await makeBuyer('+8801812000031');
    const { threadId } = await threadFor(buyer.token, seller.userId, '+8801812000030');

    const first = await send(buyer.token, threadId, 'hello there', 'msg-repeat-0001');
    const second = await send(buyer.token, threadId, 'hello there', 'msg-repeat-0001');

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.replayed).toBe(true);
    expect(await db.models.Message.countDocuments({ threadId })).toBe(1);
  });

  it('lists threads with unread counts and clears them on read', async () => {
    const seller = await makeSeller('+8801812000040');
    const buyer = await makeBuyer('+8801812000041');
    const { threadId } = await threadFor(buyer.token, seller.userId, '+8801812000040');

    await send(buyer.token, threadId, 'is this still available?', 'msg-unread-0001');

    const buyerList = await request(app).get('/api/v1/chat/threads').set(bearer(buyer.token));
    expect(buyerList.status).toBe(200);
    expect(buyerList.body.data).toHaveLength(1);
    expect(buyerList.body.data[0].unread).toBe(0);
    expect(buyerList.body.data[0].otherParty.displayName).toBe('Rahim Uddin');

    const sellerList = await request(app).get('/api/v1/chat/threads').set(bearer(seller.token));
    expect(sellerList.body.data[0].unread).toBe(1);
    expect(sellerList.body.data[0].lastMessage.body).toBe('is this still available?');

    const opened = await getMessages(seller.token, threadId);
    expect(opened.status).toBe(200);
    expect(opened.body.data).toHaveLength(1);

    const after = await request(app).get('/api/v1/chat/threads').set(bearer(seller.token));
    expect(after.body.data[0].unread).toBe(0);
  });

  it('pages messages backwards with an opaque cursor', async () => {
    const seller = await makeSeller('+8801812000050');
    const buyer = await makeBuyer('+8801812000051');
    const { threadId } = await threadFor(buyer.token, seller.userId, '+8801812000050');

    for (let index = 0; index < 3; index += 1) {
      const res = await send(
        buyer.token,
        threadId,
        `message number ${index}`,
        `msg-cursor-000${index}`,
      );
      expect(res.status).toBe(201);
    }

    const all = await getMessages(seller.token, threadId);
    expect(all.body.data.map((item: { body: string }) => item.body)).toEqual([
      'message number 0',
      'message number 1',
      'message number 2',
    ]);

    const before = all.body.data[2].id as string;
    const page = await getMessages(seller.token, threadId, `?before=${before}`);
    expect(page.body.data.map((item: { body: string }) => item.body)).toEqual([
      'message number 0',
      'message number 1',
    ]);
    expect(page.body.meta.nextCursor).toBeNull();
  });

  it('caps phone reveals at 20 per day and respects showPhonePublic', async () => {
    const seller = await makeSeller('+8801812000060');
    const buyer = await makeBuyer('+8801812000061');
    const { threadId } = await threadFor(buyer.token, seller.userId, '+8801812000060');

    const first = await reveal(buyer.token, threadId);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data.phone).toBe('+8801812000060');
    expect(first.body.data.revealCountToday).toBe(1);

    const sellerCall = await reveal(seller.token, threadId);
    expect(sellerCall.status).toBe(403);
    expect(sellerCall.body.detail).toBe('buyer_only');

    await db.models.User.updateOne(
      { _id: new Types.ObjectId(seller.userId) },
      { $set: { 'sellerPrefs.showPhonePublic': false } },
    );
    const hidden = await reveal(buyer.token, threadId);
    expect(hidden.status).toBe(422);
    expect(hidden.body.detail).toBe('phone_hidden');

    await db.models.User.updateOne(
      { _id: new Types.ObjectId(seller.userId) },
      { $set: { 'sellerPrefs.showPhonePublic': true } },
    );

    for (let index = 0; index < 19; index += 1) {
      const ok = await reveal(buyer.token, threadId);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    }

    const over = await reveal(buyer.token, threadId);
    expect(over.status).toBe(422);
    expect(over.body.detail).toBe('reveal_cap_exceeded');
  });

  it('blocks a thread and rejects sends/reveals afterwards', async () => {
    const seller = await makeSeller('+8801812000070');
    const buyer = await makeBuyer('+8801812000071');
    const { threadId } = await threadFor(buyer.token, seller.userId, '+8801812000070');

    const mismatch = await request(app)
      .post(`/api/v1/chat/threads/${threadId}/block`)
      .set(bearer(seller.token))
      .send({ side: 'buyer' });
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.detail).toBe('side_mismatch');

    const blocked = await request(app)
      .post(`/api/v1/chat/threads/${threadId}/block`)
      .set(bearer(seller.token))
      .send({ side: 'seller' });
    expect(blocked.status).toBe(204);
    expect((await readThread(threadId)).state).toBe('sellerBlocked');

    const sendAfter = await send(buyer.token, threadId, 'hello?', 'msg-blocked-0001');
    expect(sendAfter.status).toBe(409);
    expect(sendAfter.body.detail).toBe('sellerBlocked');

    const revealAfter = await reveal(buyer.token, threadId);
    expect(revealAfter.status).toBe(409);
  });

  it('enforces the thread-state send gate', async () => {
    const seller = await makeSeller('+8801812000080');
    const buyer = await makeBuyer('+8801812000081');
    const { threadId } = await threadFor(buyer.token, seller.userId, '+8801812000080');

    await db.models.Thread.updateOne({ _id: new Types.ObjectId(threadId) }, { $set: { state: 'frozen' } });
    const frozen = await send(buyer.token, threadId, 'still there?', 'msg-state-0001');
    expect(frozen.status).toBe(403);
    expect(frozen.body.type).toContain('enforcement_blocked');

    for (const [index, state] of ['archived', 'soldBanner', 'deletedListing'].entries()) {
      await db.models.Thread.updateOne(
        { _id: new Types.ObjectId(threadId) },
        { $set: { state } },
      );
      const res = await send(buyer.token, threadId, 'still there?', `msg-state-000${index + 2}`);
      expect(res.status, state).toBe(409);
      expect(res.body.detail).toBe(state);
    }
  });

  it('runs the 48h offer state machine with one pending per listing', async () => {
    const seller = await makeSeller('+8801812000090');
    const buyer = await makeBuyer('+8801812000091');
    const { threadId, listingId } = await threadFor(buyer.token, seller.userId, '+8801812000090');

    const tooHigh = await request(app)
      .post(`/api/v1/chat/threads/${threadId}/offers`)
      .set(bearer(buyer.token))
      .send({ amount: 90_001 });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.errors[0].message).toBe('amount_too_high');

    const created = await request(app)
      .post(`/api/v1/chat/threads/${threadId}/offers`)
      .set(bearer(buyer.token))
      .send({ amount: 40_000 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.status).toBe('pending');
    expect(created.body.data.expiresAt).toBeTruthy();

    const duplicate = await request(app)
      .post(`/api/v1/chat/threads/${threadId}/offers`)
      .set(bearer(buyer.token))
      .send({ amount: 39_000 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.detail).toBe('offer_pending_exists');

    const accepted = await request(app)
      .post(`/api/v1/offers/${created.body.data.offerId}/respond`)
      .set(bearer(seller.token))
      .send({ action: 'accept' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe('accepted');

    const listing = (await db.models.Listing.findById(listingId).lean()) as unknown as {
      status?: string;
    };
    expect(listing.status).toBe('active'); // acceptance is non-binding

    const again = await request(app)
      .post(`/api/v1/chat/threads/${threadId}/offers`)
      .set(bearer(buyer.token))
      .send({ amount: 42_000 });
    expect(again.status).toBe(201);

    const missingCounter = await request(app)
      .post(`/api/v1/offers/${again.body.data.offerId}/respond`)
      .set(bearer(seller.token))
      .send({ action: 'counter' });
    expect(missingCounter.status).toBe(400);
    expect(missingCounter.body.errors[0].message).toBe('required_for_counter');

    const countered = await request(app)
      .post(`/api/v1/offers/${again.body.data.offerId}/respond`)
      .set(bearer(seller.token))
      .send({ action: 'counter', counterAmount: 41_000 });
    expect(countered.status).toBe(200);
    expect(countered.body.data).toEqual({ status: 'countered', counterAmount: 41_000 });

    const expiredOffer = await db.models.Offer.create({
      threadId: new Types.ObjectId(threadId),
      buyerId: new Types.ObjectId(buyer.userId),
      listingId: new Types.ObjectId(listingId),
      amount: 30_000,
      status: 'pending',
      expiresAt: new Date(Date.now() - 1_000),
    });
    const expired = await request(app)
      .post(
        `/api/v1/offers/${String((expiredOffer as unknown as { _id: Types.ObjectId })._id)}/respond`,
      )
      .set(bearer(seller.token))
      .send({ action: 'accept' });
    expect(expired.status).toBe(409);
    expect(expired.body.detail).toBe('offer_expired');
  });

  it('reports a conversation with a transcript snapshot', async () => {
    const seller = await makeSeller('+8801812000100');
    const buyer = await makeBuyer('+8801812000101');
    const { threadId } = await threadFor(buyer.token, seller.userId, '+8801812000100');
    await send(buyer.token, threadId, 'abusive message', 'msg-report-0001');

    const res = await request(app)
      .post(`/api/v1/chat/threads/${threadId}/report`)
      .set(bearer(buyer.token))
      .send({ category: 'harassment', comment: 'seller is abusive' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.reportId).toBeTruthy();
    expect(await db.models.Report.countDocuments({})).toBe(1);

    const kase = (await db.models.ModerationCase.findOne({}).lean()) as unknown as {
      source: string;
      snapshot?: { messages?: unknown[] };
    };
    expect(kase.source).toBe('report');
    expect(kase.snapshot?.messages).toHaveLength(1);
  });

  it('hides threads and messages from non-participants', async () => {
    const seller = await makeSeller('+8801812000110');
    const buyer = await makeBuyer('+8801812000111');
    const stranger = await makeBuyer('+8801812000112');
    const { threadId } = await threadFor(buyer.token, seller.userId, '+8801812000110');

    const read = await getMessages(stranger.token, threadId);
    expect(read.status).toBe(404);
    expect(read.body.detail).toBe('thread_not_found');

    const write = await send(stranger.token, threadId, 'hey', 'msg-idor-0001');
    expect(write.status).toBe(404);
  });

  it('authenticates Socket.IO handshakes, fans out messages and rate-limits sends', async () => {
    const seller = await makeSeller('+8801812000120');
    const buyer = await makeBuyer('+8801812000121');
    const { threadId } = await threadFor(buyer.token, seller.userId, '+8801812000120');

    const httpServer = createServer(app);
    const realtime = attachRealtime(httpServer, {
      config,
      logger: createLogger(config),
      repos: db.repos,
      chat: new ChatService({ repos: db.repos, kv }),
    });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}`;

    const open = (token: string): Socket =>
      ioClient(url, {
        path: '/socket.io',
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });

    const buyerSocket = open(buyer.token);
    const sellerSocket = open(seller.token);
    const badSocket = open('not-a-real-token');

    try {
      await expect(waitConnect(badSocket)).rejects.toBeTruthy();

      await Promise.all([waitConnect(buyerSocket), waitConnect(sellerSocket)]);

      const buyerJoin = await emitAck(buyerSocket, 'thread:join', { threadId });
      const sellerJoin = await emitAck(sellerSocket, 'thread:join', { threadId });
      expect(buyerJoin.ok).toBe(true);
      expect(sellerJoin.ok).toBe(true);

      const received = once<{ body: string; threadId: string }>(sellerSocket, 'message:new');
      const first = await emitAck(buyerSocket, 'message:send', {
        threadId,
        clientMsgId: 'socket-msg-0001',
        body: 'hello over socket',
      });
      expect(first.ok).toBe(true);
      const event = await received;
      expect(event.body).toBe('hello over socket');
      expect(event.threadId).toBe(threadId);

      let limited = false;
      for (let index = 0; index < 30; index += 1) {
        const ack = await emitAck(buyerSocket, 'message:send', {
          threadId,
          clientMsgId: `socket-bulk-${String(index).padStart(4, '0')}`,
          body: `bulk ${index}`,
        });
        if (!ack.ok) {
          limited = true;
          break;
        }
      }
      expect(limited).toBe(true);
    } finally {
      buyerSocket.close();
      sellerSocket.close();
      badSocket.close();
      realtime.close();
      await new Promise<void>((resolve) => {
        if (!httpServer.listening) return resolve();
        httpServer.close(() => resolve());
      });
    }
  }, 45_000);
});

function waitConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 10_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), 10_000);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function emitAck(
  socket: Socket,
  event: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; message?: unknown; error?: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), 10_000);
    socket.emit(event, payload, (ack: { ok: boolean; message?: unknown; error?: string }) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}
