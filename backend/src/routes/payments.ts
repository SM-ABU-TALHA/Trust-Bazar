import { Router } from 'express';
import { z } from 'zod';
import { boostCheckoutSchema } from '@trust/shared/schemas';
import type { Config } from '../config/index.js';
import { ah } from '../lib/async-handler.js';
import type { Logger } from '../lib/logger.js';
import {
  enforcementGate,
  idempotency,
  rateLimit,
  requireRole,
  validate,
  type RateLimitStore,
} from '../middleware/index.js';
import type { IdempotencyStore } from '../middleware/idempotency.js';
import { buildRequireAuth } from '../middleware/require-auth.js';
import type { Repositories } from '../repositories/index.js';
import type { PaymentService } from '../services/payments/payment.service.js';

const idParams = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'invalid_id') });

export interface PaymentRouteDeps {
  config: Config;
  logger: Logger;
  repos: Repositories;
  rateStore: RateLimitStore;
  payments: PaymentService;
  idempotencyStore: IdempotencyStore;
}

export function paymentRoutes(deps: PaymentRouteDeps): Router {
  const router = Router();
  const requireAuth = buildRequireAuth(deps.config, deps.repos);

  router.get(
    '/boost/packages',
    requireAuth,
    ah(async (req, res) => {
      const packages = await deps.payments.listPackages();
      res.json({ data: packages, meta: { requestId: req.id } });
    }),
  );

  router.post(
    '/boost/checkout',
    requireAuth,
    enforcementGate,
    requireRole('seller'),
    rateLimit('boost_purchase', deps.rateStore),
    idempotency(deps.idempotencyStore),
    validate({ body: boostCheckoutSchema }),
    ah(async (req, res) => {
      const idempotencyKey = req.header('idempotency-key') as string;
      const { payment, replay } = await deps.payments.checkout(
        req.user!.id,
        req.body,
        idempotencyKey,
      );
      res.status(201).json({
        data: {
          paymentId: String(payment._id),
          state: payment.state,
          gatewayUrl: payment.gatewayUrl,
          creditApplied: payment.creditApplied,
          amount: payment.amount,
        },
        meta: { requestId: req.id, replay },
      });
    }),
  );

  router.get(
    '/payments/:id',
    requireAuth,
    validate({ params: idParams }),
    ah(async (req, res) => {
      const payment = await deps.payments.getPayment(req.user!.id, req.params.id as string);
      res.json({ data: payment, meta: { requestId: req.id } });
    }),
  );

  router.get(
    '/payments/:id/receipt',
    requireAuth,
    validate({ params: idParams }),
    ah(async (req, res) => {
      const { pdf, filename } = await deps.payments.receipt(req.user!.id, req.params.id as string);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdf);
    }),
  );

  router.get(
    '/me/credits',
    requireAuth,
    ah(async (req, res) => {
      const credits = await deps.payments.credits(req.user!.id);
      res.json({ data: credits, meta: { requestId: req.id } });
    }),
  );

  return router;
}
