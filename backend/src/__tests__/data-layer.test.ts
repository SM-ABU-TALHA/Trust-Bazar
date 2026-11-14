import mongoose, { Types, type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnvFile } from '../lib/env.js';
import { APP_INDEXES } from '../db/indexes.js';
import { applyIndexes, applyValidators } from '../db/migrate.js';
import { createDbContext, type DbContext } from '../db/context.js';
import { createAuditModels } from '../models/index.js';

loadEnvFile();

const APP_URI = process.env.MONGO_APP_URI;
const canRun = Boolean(APP_URI);

/** Never touch the real database — always redirect to a throwaway DB. */
function testUri(uri: string): string {
  const parsed = new URL(uri);
  parsed.pathname = '/trust_bazar_test_data';
  return parsed.toString();
}

let conn: Connection;
let testDb: NonNullable<Connection['db']>;
let db: DbContext;

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

describe.skipIf(!canRun)('data layer (live Atlas, trust_bazar_test_data)', () => {
  it('rejects a duplicate phone', async () => {
    const phone = '+8801711111111';
    await db.models.User.create({ phone });
    await expect(db.models.User.create({ phone })).rejects.toMatchObject({ code: 11000 });
  });

  it('rejects a duplicate (threadId, clientMsgId) but allows it in another thread', async () => {
    const sellerId = new Types.ObjectId();
    const buyerId = new Types.ObjectId();
    const threadA = await db.models.Thread.create({
      listingId: new Types.ObjectId(),
      buyerId,
      sellerId,
    });
    const threadB = await db.models.Thread.create({
      listingId: new Types.ObjectId(),
      buyerId,
      sellerId,
    });

    const base = { senderId: buyerId, body: 'Still available?', clientMsgId: 'cmid-1' };
    await db.models.Message.create({ ...base, threadId: threadA._id });
    await expect(
      db.models.Message.create({ ...base, threadId: threadA._id }),
    ).rejects.toMatchObject({ code: 11000 });

    await expect(db.models.Message.create({ ...base, threadId: threadB._id })).resolves.toBeDefined();
  });

  it('allows only ONE pending offer per buyer per listing', async () => {
    const buyerId = new Types.ObjectId();
    const listingId = new Types.ObjectId();
    const threadId = new Types.ObjectId();
    const expiresAt = new Date(Date.now() + 48 * 3_600_000);

    const first = await db.models.Offer.create({
      threadId,
      buyerId,
      listingId,
      amount: 5_000,
      status: 'pending',
      expiresAt,
    });
    await expect(
      db.models.Offer.create({ threadId, buyerId, listingId, amount: 4_900, expiresAt }),
    ).rejects.toMatchObject({ code: 11000 });

    // Once the first offer is no longer pending, a new one is allowed.
    first.status = 'accepted';
    await first.save();
    await expect(
      db.models.Offer.create({ threadId, buyerId, listingId, amount: 4_800, expiresAt }),
    ).resolves.toBeDefined();
  });

  it('allows only ONE deal per listing', async () => {
    const listingId = new Types.ObjectId();
    const sellerId = new Types.ObjectId();
    await db.models.Deal.create({ listingId, sellerId, type: 'direct', channel: 'phone' });
    await expect(
      db.models.Deal.create({ listingId, sellerId, type: 'direct', channel: 'phone' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('$jsonSchema blocks an invalid users document at the DB layer', async () => {
    await expect(
      testDb.collection('users').insertOne({ phone: '01711111111', roles: ['buyer'] }),
    ).rejects.toMatchObject({ code: 121 });
  });

  it('$jsonSchema blocks a listing title shorter than 10 chars', async () => {
    await expect(
      testDb.collection('listings').insertOne({
        sellerId: new Types.ObjectId(),
        categoryId: new Types.ObjectId(),
        title: 'short',
        description: 'a description that is definitely long enough',
        price: 1_000,
        condition: 'good',
        location: { district: 'Dhaka', geo: { type: 'Point', coordinates: [90.4, 23.8] } },
        mediaIds: [new Types.ObjectId()],
        status: 'draft',
        version: 0,
      }),
    ).rejects.toMatchObject({ code: 121 });
  });

  it('every TTL index is single-field (no compound TTL anywhere)', async () => {
    const collections = await testDb.listCollections().toArray();
    for (const { name } of collections) {
      if (!name || name.startsWith('system.')) continue;
      const indexes = await testDb.collection(name).indexes();
      for (const index of indexes) {
        if (index.expireAfterSeconds === undefined) continue;
        expect(Object.keys(index.key)).toHaveLength(1);
        expect(index.name).toBeDefined();
      }
    }

    const ttl = APP_INDEXES.listings?.find((index) => index.expireAfterSeconds !== undefined);
    expect(ttl?.keys).toEqual({ expiresAt: 1 });
    expect(ttl?.partialFilterExpression).toEqual({ status: 'draft' });
  });

  it('applies exactly the declared indexes', async () => {
    for (const [collection, declared] of Object.entries(APP_INDEXES)) {
      const names = (await testDb.collection(collection).indexes())
        .map((index) => index.name)
        .filter((name): name is string => Boolean(name));
      const allowed = new Set(['_id_', ...declared.map((index) => index.name)]);
      for (const name of names) expect(allowed.has(name)).toBe(true);
    }
  });

  it('auditEvents is append-only', async () => {
    const audit = createAuditModels(conn);
    const event = await audit.AuditEvent.create({
      seq: 1,
      actor: 'system',
      action: 'test.append',
      prevHash: 'genesis',
      hash: 'placeholder',
    });
    expect(event.hash).not.toBe('placeholder');

    event.action = 'test.tampered';
    await expect(event.save()).rejects.toThrow(/append-only/);
  });
});
