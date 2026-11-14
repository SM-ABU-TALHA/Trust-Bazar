import { Router } from 'express';
import { z } from 'zod';
import { confirmDealSchema, declineDealSchema } from '@trust/shared/schemas';
import type { Config } from '../config/index.js';
import { ah } from '../lib/async-handler.js';
import { enforcementGate, validate } from '../middleware/index.js';
import { buildRequireAuth } from '../middleware/require-auth.js';
import type { Repositories } from '../repositories/index.js';
import type { DealService } from '../services/deals/deal.service.js';

const idParams = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'invalid_id') });

export interface DealRouteDeps {
  config: Config;
  repos: Repositories;
  deals: DealService;
}

/** PROMPT 12 — buyer confirmation / dispute after the seller marks sold. */
export function dealRoutes(deps: DealRouteDeps): Router {
  const router = Router();
  const requireAuth = buildRequireAuth(deps.config, deps.repos);

  router.post(
    '/deals/:id/confirm',
    requireAuth,
    enforcementGate,
    validate({ params: idParams, body: confirmDealSchema }),
    ah(async (req, res) => {
      const data = await deps.deals.confirm(req.user!.id, req.params.id as string);
      res.json({ data, meta: { requestId: req.id } });
    }),
  );

  router.post(
    '/deals/:id/decline',
    requireAuth,
    enforcementGate,
    validate({ params: idParams, body: declineDealSchema }),
    ah(async (req, res) => {
      const data = await deps.deals.decline(
        req.user!.id,
        req.params.id as string,
        req.body,
      );
      res.json({ data, meta: { requestId: req.id } });
    }),
  );

  return router;
}
