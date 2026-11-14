import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  deleteAccountSchema,
  notificationPrefsSchema,
  paginationSchema,
  savedSearchSchema,
  sellerPrefsSchema,
  updateProfileSchema,
  type DeleteAccountInput,
  type NotificationPrefsInput,
  type SavedSearchInput,
  type SellerPrefsInput,
  type UpdateProfileInput,
} from '@trust/shared/schemas';
import type { Config } from '../config/index.js';
import { ah } from '../lib/async-handler.js';
import { err } from '../lib/errors.js';
import type { KvStore } from '../lib/kv.js';
import type { Logger } from '../lib/logger.js';
import type { SmsSender } from '../lib/sms.js';
import {
  enforcementGate,
  rateLimit,
  requireRole,
  validate,
  type RateLimitStore,
} from '../middleware/index.js';
import { buildRequireAuth } from '../middleware/require-auth.js';
import type { Repositories } from '../repositories/index.js';
import { AccountService } from '../services/account/account.service.js';
import { OtpService } from '../services/auth/otp.service.js';

export interface AccountRouteDeps {
  config: Config;
  logger: Logger;
  repos: Repositories;
  kv: KvStore;
  sms: SmsSender;
  rateStore: RateLimitStore;
}

const idParams = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'invalid_id') });

export function accountRoutes(deps: AccountRouteDeps): Router {
  const { config, repos } = deps;
  const router = Router();
  const requireAuth = buildRequireAuth(config, repos);
  const otp = new OtpService({ config, kv: deps.kv, sms: deps.sms, logger: deps.logger });
  const service = new AccountService({ repos, otp });

  router.get(
    '/me',
    requireAuth,
    ah(async (req, res) => sendData(req, res, 200, await service.getMe(userId(req)))),
  );

  router.patch(
    '/me',
    requireAuth,
    enforcementGate,
    validate({ body: updateProfileSchema }),
    ah(async (req, res) =>
      sendData(req, res, 200, await service.updateProfile(userId(req), req.body as UpdateProfileInput)),
    ),
  );

  router.patch(
    '/me/seller-prefs',
    requireAuth,
    enforcementGate,
    requireRole('seller'),
    validate({ body: sellerPrefsSchema }),
    ah(async (req, res) =>
      sendData(
        req,
        res,
        200,
        await service.updateSellerPrefs(userId(req), req.body as SellerPrefsInput),
      ),
    ),
  );

  router.patch(
    '/me/notification-prefs',
    requireAuth,
    validate({ body: notificationPrefsSchema }),
    ah(async (req, res) =>
      sendData(
        req,
        res,
        200,
        await service.updateNotificationPrefs(userId(req), req.body as NotificationPrefsInput),
      ),
    ),
  );

  // Deletion is re-OTP protected (PRD §3.1.7); cancel is OTP-based because
  // deletion already revoked every session.
  router.post(
    '/me/delete',
    requireAuth,
    rateLimit('otp_verify', deps.rateStore, { max: 20, window: '15m' }),
    validate({ body: deleteAccountSchema }),
    ah(async (req, res) =>
      sendData(
        req,
        res,
        200,
        await service.requestDeletion(userId(req), req.body as DeleteAccountInput, {
          ip: req.ip,
        }),
      ),
    ),
  );

  router.post(
    '/me/delete/cancel',
    rateLimit('otp_verify', deps.rateStore, { max: 20, window: '15m' }),
    validate({ body: deleteAccountSchema }),
    ah(async (req, res) =>
      sendData(req, res, 200, await service.cancelDeletion(req.body as DeleteAccountInput)),
    ),
  );

  // ── Favorites ────────────────────────────────────────────────────────────
  router.get(
    '/me/favorites',
    requireAuth,
    ah(async (req, res) => {
      const { page, limit } = paginationSchema.parse(req.query);
      sendData(req, res, 200, await service.listFavorites(userId(req), page, limit));
    }),
  );

  router.post(
    '/listings/:id/favorite',
    requireAuth,
    enforcementGate,
    validate({ params: idParams }),
    ah(async (req, res) =>
      sendData(req, res, 200, await service.addFavorite(userId(req), req.params.id as string)),
    ),
  );

  router.delete(
    '/listings/:id/favorite',
    requireAuth,
    validate({ params: idParams }),
    ah(async (req, res) =>
      sendData(req, res, 200, await service.removeFavorite(userId(req), req.params.id as string)),
    ),
  );

  // ── Saved searches ───────────────────────────────────────────────────────
  router.get(
    '/me/saved-searches',
    requireAuth,
    ah(async (req, res) =>
      sendData(req, res, 200, await service.listSavedSearches(userId(req))),
    ),
  );

  router.post(
    '/me/saved-searches',
    requireAuth,
    enforcementGate,
    validate({ body: savedSearchSchema }),
    ah(async (req, res) =>
      sendData(
        req,
        res,
        201,
        await service.createSavedSearch(userId(req), req.body as SavedSearchInput),
      ),
    ),
  );

  router.delete(
    '/me/saved-searches/:id',
    requireAuth,
    validate({ params: idParams }),
    ah(async (req, res) =>
      sendData(req, res, 200, await service.deleteSavedSearch(userId(req), req.params.id as string)),
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
