import { Router, type Request, type Response } from 'express';
import {
  kycBuyerSchema,
  kycRecoverSchema,
  kycSellerSchema,
  type KycBuyerInput,
  type KycRecoverInput,
  type KycSellerInput,
} from '@trust/shared/schemas';
import type { Config } from '../config/index.js';
import { ah } from '../lib/async-handler.js';
import { err } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { StorageDriver } from '../lib/storage.js';
import { enforcementGate, rateLimit, type RateLimitStore } from '../middleware/index.js';
import { buildRequireAuth } from '../middleware/require-auth.js';
import { validate } from '../middleware/validate.js';
import type { Repositories } from '../repositories/index.js';
import { KycService } from '../services/kyc/kyc.service.js';

export interface KycRouteDeps {
  config: Config;
  logger: Logger;
  repos: Repositories;
  storage: StorageDriver;
  rateStore: RateLimitStore;
}

export function kycRoutes(deps: KycRouteDeps): Router {
  const { config } = deps;
  const router = Router();
  const requireAuth = buildRequireAuth(config, deps.repos);
  const service = new KycService({
    config,
    repos: deps.repos,
    logger: deps.logger,
    storage: deps.storage,
  });

  router.post(
    '/kyc/seller',
    requireAuth,
    enforcementGate,
    rateLimit('kyc_submit', deps.rateStore, { max: 5, window: '1d' }),
    validate({ body: kycSellerSchema }),
    ah(async (req, res) => {
      sendData(res, req, 202, await service.submitSeller(userId(req), req.body as KycSellerInput));
    }),
  );

  router.post(
    '/kyc/buyer',
    requireAuth,
    enforcementGate,
    rateLimit('kyc_submit', deps.rateStore, { max: 5, window: '1d' }),
    validate({ body: kycBuyerSchema }),
    ah(async (req, res) => {
      sendData(res, req, 202, await service.submitBuyer(userId(req), req.body as KycBuyerInput));
    }),
  );

  router.get(
    '/kyc/status',
    requireAuth,
    ah(async (req, res) => {
      sendData(res, req, 200, await service.status(userId(req)));
    }),
  );

  router.post(
    '/kyc/recover',
    requireAuth,
    enforcementGate,
    rateLimit('kyc_submit', deps.rateStore, { max: 5, window: '1d' }),
    validate({ body: kycRecoverSchema }),
    ah(async (req, res) => {
      sendData(res, req, 200, await service.recover(userId(req), req.body as KycRecoverInput));
    }),
  );

  return router;
}

function sendData(res: Response, req: Request, status: number, data: unknown): void {
  res.status(status).json({ data, meta: { requestId: req.id } });
}

function userId(req: Request): string {
  if (!req.user) throw err.unauthenticated('Missing access token');
  return req.user.id;
}
