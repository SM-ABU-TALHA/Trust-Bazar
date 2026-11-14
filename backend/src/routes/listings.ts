import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  conditionSchema,
  createListingSchema,
  districtSchema,
  markSoldSchema,
  myListingsQuerySchema,
  objectIdSchema,
  searchQuerySchema,
  updateListingSchema,
  type CreateListingInput,
  type MarkSoldInput,
  type MyListingsQuery,
  type UpdateListingInput,
} from '@trust/shared/schemas';
import type { Config } from '../config/index.js';
import { ah } from '../lib/async-handler.js';
import { err } from '../lib/errors.js';
import type { KvStore } from '../lib/kv.js';
import type { Logger } from '../lib/logger.js';
import type { StorageDriver } from '../lib/storage.js';
import {
  enforcementGate,
  rateLimit,
  requireRole,
  validate,
  type RateLimitStore,
} from '../middleware/index.js';
import { buildRequireAuth } from '../middleware/require-auth.js';
import type { Repositories } from '../repositories/index.js';
import { ListingService } from '../services/listings/listing.service.js';
import { SearchService } from '../services/search/search.service.js';

export interface ListingRouteDeps {
  config: Config;
  logger: Logger;
  repos: Repositories;
  storage: StorageDriver;
  kv: KvStore;
  rateStore: RateLimitStore;
}

const idParams = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'invalid_id') });

const trendingQuerySchema = z.object({
  district: districtSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const priceBaselineQuerySchema = z.object({
  categoryId: objectIdSchema,
  condition: conditionSchema.optional(),
});

export function listingRoutes(deps: ListingRouteDeps): Router {
  const { config, repos } = deps;
  const router = Router();
  const requireAuth = buildRequireAuth(config, repos);
  const service = new ListingService({ repos, storage: deps.storage });
  const search = new SearchService({
    config,
    repos,
    kv: deps.kv,
    storage: deps.storage,
    logger: deps.logger,
  });

  // ── Static paths are registered before `/listings/:id` (API §3.9/3.11/3.12)
  router.get(
    '/listings/search',
    validate({ query: searchQuerySchema }),
    ah(async (req, res) => {
      // `validate` cannot replace Express' read-only `req.query`, so re-parse
      // to get the coerced numbers (page/limit/minPrice/maxPrice).
      const query = searchQuerySchema.parse(req.query);
      const result = await search.search(query);
      if (result.degraded) res.setHeader('X-Degraded', 'search');
      res.json({
        data: result.items,
        meta: {
          requestId: req.id,
          page: result.page,
          limit: result.limit,
          total: result.total,
        },
      });
    }),
  );

  router.get(
    '/listings/trending',
    validate({ query: trendingQuerySchema }),
    ah(async (req, res) => {
      const { district, limit } = trendingQuerySchema.parse(req.query);
      sendData(req, res, 200, await search.trending(district, limit));
    }),
  );

  router.get(
    '/listings/price-baseline',
    validate({ query: priceBaselineQuerySchema }),
    ah(async (req, res) => {
      const { categoryId, condition } = priceBaselineQuerySchema.parse(req.query);
      sendData(req, res, 200, await search.priceBaseline(categoryId, condition));
    }),
  );

  router.get(
    '/me/listings',
    requireAuth,
    requireRole('seller'),
    validate({ query: myListingsQuerySchema }),
    ah(async (req, res) =>
      sendData(
        req,
        res,
        200,
        await service.listMine(userId(req), req.query as unknown as MyListingsQuery),
      ),
    ),
  );

  router.post(
    '/listings',
    requireAuth,
    enforcementGate,
    requireRole('seller'),
    rateLimit('listing_create', deps.rateStore, { max: 10, window: '1d' }),
    validate({ body: createListingSchema }),
    ah(async (req, res) =>
      sendData(req, res, 201, await service.create(userId(req), req.body as CreateListingInput)),
    ),
  );

  router.get(
    '/listings/:id',
    validate({ params: idParams }),
    ah(async (req, res) =>
      sendData(req, res, 200, await service.getPublic(req.params.id as string)),
    ),
  );

  router.post(
    '/listings/:id/publish',
    requireAuth,
    enforcementGate,
    requireRole('seller'),
    validate({ params: idParams }),
    ah(async (req, res) =>
      sendData(req, res, 200, await service.publish(userId(req), req.params.id as string)),
    ),
  );

  router.patch(
    '/listings/:id',
    requireAuth,
    enforcementGate,
    requireRole('seller'),
    validate({ params: idParams, body: updateListingSchema }),
    ah(async (req, res) =>
      sendData(
        req,
        res,
        200,
        await service.update(
          userId(req),
          req.params.id as string,
          req.body as UpdateListingInput,
        ),
      ),
    ),
  );

  router.delete(
    '/listings/:id',
    requireAuth,
    enforcementGate,
    requireRole('seller'),
    validate({ params: idParams }),
    ah(async (req, res) => {
      await service.delist(userId(req), req.params.id as string);
      res.status(204).end();
    }),
  );

  router.post(
    '/listings/:id/renew',
    requireAuth,
    enforcementGate,
    requireRole('seller'),
    validate({ params: idParams }),
    ah(async (req, res) =>
      sendData(req, res, 200, await service.renew(userId(req), req.params.id as string)),
    ),
  );

  router.post(
    '/listings/:id/sold',
    requireAuth,
    enforcementGate,
    requireRole('seller'),
    validate({ params: idParams, body: markSoldSchema }),
    ah(async (req, res) =>
      sendData(
        req,
        res,
        201,
        await service.markSold(userId(req), req.params.id as string, req.body as MarkSoldInput),
      ),
    ),
  );

  router.post(
    '/deals/:id/undo',
    requireAuth,
    enforcementGate,
    requireRole('seller'),
    validate({ params: idParams }),
    ah(async (req, res) =>
      sendData(req, res, 200, await service.undoDeal(userId(req), req.params.id as string)),
    ),
  );

  return router;
}

function sendData(req: Request, res: Response, status: number, data: unknown): void {
  res.status(status).json({ data, meta: { requestId: req.id } });
}

function userId(req: Request): string {
  if (!req.user) throw err.unauthenticated('Missing access token');
  return req.user.id;
}
