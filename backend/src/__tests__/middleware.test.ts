import express, { type Express } from 'express';
import { SignJWT } from 'jose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  auth,
  enforcementGate,
  errorHandler,
  idempotency,
  memoryIdempotencyStore,
  memoryRateLimitStore,
  notFound,
  rateLimit,
  requestId,
  requireRole,
  validate,
} from '../middleware/index.js';
import { createLogger } from '../lib/logger.js';

const SECRET = 'test-secret-that-is-long-enough-32chars';

/** Chain mounted in the exact Architecture §4.3 order. Fresh stores per build. */
function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(requestId);

  const router = express.Router();
  const chain = [
    rateLimit('listing_create', memoryRateLimitStore(), { max: 3, window: '1m' }),
    auth(SECRET),
    enforcementGate,
    requireRole('seller'),
    idempotency(memoryIdempotencyStore()),
    validate({
      body: z.object({ title: z.string().min(10) }),
    }),
  ];
  router.post('/listings', ...chain, (_req, res) => res.status(201).json({ data: { ok: true } }));
  router.get('/profile', auth(SECRET), enforcementGate, (req, res) =>
    res.json({ data: { id: req.user?.id } }),
  );
  router.get('/boom', (_req, _res) => {
    throw new Error('database credentials are: super-secret');
  });

  app.use('/api/v1', router);
  app.use(notFound);
  app.use(errorHandler(createLogger({ NODE_ENV: 'test' }), true));
  return app;
}

interface TokenOverrides {
  roles?: string[];
  enforcement?: { state: string };
}

function token(overrides: TokenOverrides = {}): Promise<string> {
  return new SignJWT({
    roles: overrides.roles ?? ['seller'],
    enforcement: overrides.enforcement ?? { state: 'none' },
    sid: 'sess-1',
    deviceFp: 'fp',
    platform: 'web',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(SECRET));
}

// Fresh app per test — isolated rate-limit/idempotency stores.
let app: Express;
beforeEach(() => {
  app = buildApp();
});
const VALID = { title: 'Samsung Galaxy A54 5G' };

describe('middleware chain', () => {
  it('404: unknown route → RFC-7807 not_found + requestId', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.type).toBe('https://api.trustbazar.com/errors/not_found');
    expect(res.body.retryable).toBe(false);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('400: zod failure → validation_failed with field errors', async () => {
    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${await token()}`)
      .set('Idempotency-Key', 'val-1')
      .send({ title: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.type).toContain('validation_failed');
    expect(res.body.errors[0]).toMatchObject({ field: 'title' });
  });

  it('400: mutation without Idempotency-Key → bad_request', async () => {
    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${await token()}`)
      .send(VALID);
    expect(res.status).toBe(400);
    expect(res.body.type).toContain('bad_request');
  });

  it('401: missing token → unauthenticated (retryable)', async () => {
    const res = await request(app).get('/api/v1/profile');
    expect(res.status).toBe(401);
    expect(res.body.type).toContain('unauthenticated');
    expect(res.body.retryable).toBe(true);
  });

  it('403: wrong role → forbidden', async () => {
    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${await token({ roles: ['buyer'] })}`)
      .set('Idempotency-Key', 'role-1')
      .send(VALID);
    expect(res.status).toBe(403);
    expect(res.body.type).toContain('forbidden');
  });

  it('403: suspended user → enforcement_blocked', async () => {
    const res = await request(app)
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${await token({ enforcement: { state: 'suspended' } })}`);
    expect(res.status).toBe(403);
    expect(res.body.type).toContain('enforcement_blocked');
  });

  it('429: quota exceeded → rate_limited + Retry-After', async () => {
    const jwt = await token();
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/v1/listings')
        .set('Authorization', `Bearer ${jwt}`)
        .set('Idempotency-Key', `rl-${i}`)
        .send(VALID);
    }
    const res = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${jwt}`)
      .set('Idempotency-Key', 'rl-over')
      .send(VALID);
    expect(res.status).toBe(429);
    expect(res.body.type).toContain('rate_limited');
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.body.retryable).toBe(true);
  });

  it('idempotency: same key+payload replays; different payload → 409', async () => {
    const jwt = await token();
    const first = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${jwt}`)
      .set('Idempotency-Key', 'idem-1')
      .send(VALID);
    expect(first.status).toBe(201);

    const replay = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${jwt}`)
      .set('Idempotency-Key', 'idem-1')
      .send(VALID);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);

    const conflict = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${jwt}`)
      .set('Idempotency-Key', 'idem-1')
      .send({ title: 'A different listing title' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.type).toContain('idempotency_replay');
  });

  it('500: unknown error → internal_error, no internals leaked', async () => {
    const res = await request(app).get('/api/v1/boom');
    expect(res.status).toBe(500);
    expect(res.body.type).toContain('internal_error');
    expect(JSON.stringify(res.body)).not.toContain('super-secret');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
});
