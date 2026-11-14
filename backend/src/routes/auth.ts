import { Router, type CookieOptions, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  changePhoneSchema,
  recoverAccountSchema,
  requestOtpSchema,
  verifyOtpSchema,
  type ChangePhoneInput,
  type RecoverAccountInput,
  type RequestOtpInput,
  type VerifyOtpInput,
} from '@trust/shared/schemas';
import type { Config } from '../config/index.js';
import { ah } from '../lib/async-handler.js';
import { err } from '../lib/errors.js';
import type { KvStore } from '../lib/kv.js';
import type { Logger } from '../lib/logger.js';
import type { SmsSender } from '../lib/sms.js';
import {
  auth,
  enforcementGate,
  rateLimit,
  validate,
  type RateLimitStore,
} from '../middleware/index.js';
import type { Repositories } from '../repositories/index.js';
import { AuthService } from '../services/auth/auth.service.js';
import { OtpService } from '../services/auth/otp.service.js';
import { REFRESH_COOKIE, REFRESH_TTL_SEC } from '../services/auth/tokens.js';

export interface AuthRouteDeps {
  config: Config;
  logger: Logger;
  repos: Repositories;
  kv: KvStore;
  sms: SmsSender;
  rateStore: RateLimitStore;
}

const sessionIdParams = z.object({ sessionId: z.string().uuid() });

export function authRoutes(deps: AuthRouteDeps): Router {
  const { config, repos, rateStore } = deps;
  const router = Router();

  const otp = new OtpService({ config, kv: deps.kv, sms: deps.sms, logger: deps.logger });
  const service = new AuthService({ config, repos, otp, kv: deps.kv, sms: deps.sms });

  const requireAuth = auth(config.JWT_ACCESS_SECRET, {
    isSessionActive: async (userId, sessionId) => {
      const user = await repos.users.findById(userId);
      const sessions = (user?.sessions as Array<{ id?: string }> | undefined) ?? [];
      return sessions.some((session) => session.id === sessionId);
    },
  });

  const cookieOptions = refreshCookieOptions(config);

  router.post(
    '/auth/otp/request',
    rateLimit('otp_request', rateStore, { max: 10, window: '1m' }),
    validate({ body: requestOtpSchema }),
    ah(async (req, res) => {
      const { phone } = req.body as RequestOtpInput;
      const challenge = await otp.request(phone);
      sendData(req, res, 200, challenge);
    }),
  );

  router.post(
    '/auth/otp/verify',
    rateLimit('otp_verify', rateStore, { max: 20, window: '15m' }),
    validate({ body: verifyOtpSchema }),
    ah(async (req, res) => {
      const result = await service.login(req.body as VerifyOtpInput, { ip: req.ip });
      res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
      const { refreshToken: _refreshToken, ...data } = result;
      sendData(req, res, 200, data);
    }),
  );

  router.post(
    '/auth/refresh',
    rateLimit('auth_refresh', rateStore, { max: 60, window: '1m' }),
    ah(async (req, res) => {
      const token = readRefreshToken(req);
      if (!token) throw err.unauthenticated('Missing refresh cookie');

      try {
        const result = await service.refresh(token, { ip: req.ip });
        res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
        const { refreshToken: _refreshToken, ...data } = result;
        sendData(req, res, 200, data);
      } catch (error) {
        clearRefreshCookie(res, config);
        throw error;
      }
    }),
  );

  router.post(
    '/auth/logout',
    requireAuth,
    ah(async (req, res) => {
      const user = currentUser(req);
      await service.logout(user.id, user.sessionId);
      clearRefreshCookie(res, config);
      res.status(204).end();
    }),
  );

  router.get(
    '/auth/sessions',
    requireAuth,
    ah(async (req, res) => {
      const user = currentUser(req);
      sendData(req, res, 200, await service.listSessions(user.id, user.sessionId));
    }),
  );

  router.delete(
    '/auth/sessions/:sessionId',
    requireAuth,
    validate({ params: sessionIdParams }),
    ah(async (req, res) => {
      const user = currentUser(req);
      const { sessionId } = req.params as { sessionId: string };
      await service.revokeSession(user.id, sessionId, user.sessionId);
      res.status(204).end();
    }),
  );

  router.post(
    '/auth/recover',
    rateLimit('auth_recover', rateStore, { max: 3, window: '1h' }),
    validate({ body: recoverAccountSchema }),
    ah(async (req, res) => {
      const result = await service.startRecovery(req.body as RecoverAccountInput, { ip: req.ip });
      sendData(req, res, 200, result);
    }),
  );

  router.post(
    '/account/phone/change',
    rateLimit('phone_change', rateStore, { max: 5, window: '1h' }),
    requireAuth,
    enforcementGate,
    validate({ body: changePhoneSchema }),
    ah(async (req, res) => {
      const user = currentUser(req);
      sendData(req, res, 200, await service.changePhone(user.id, req.body as ChangePhoneInput));
    }),
  );

  return router;
}

function sendData(req: Request, res: Response, status: number, data: unknown): void {
  res.status(status).json({ data, meta: { requestId: req.id } });
}

function currentUser(req: Request) {
  if (!req.user) throw err.unauthenticated('Missing access token');
  return req.user;
}

function readRefreshToken(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[REFRESH_COOKIE];
}

/**
 * httpOnly cookie scoped to the auth endpoints. `.trustbazar.com` only in
 * production — browsers on localhost reject a cross-site parent domain.
 */
function refreshCookieOptions(config: Config): CookieOptions {
  const domain = config.COOKIE_DOMAIN;
  const useDomain =
    config.NODE_ENV === 'production' && domain !== '' && !['localhost', '127.0.0.1'].includes(domain);

  return {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/v1/auth',
    ...(useDomain ? { domain } : {}),
    maxAge: REFRESH_TTL_SEC * 1000,
  };
}

function clearRefreshCookie(res: Response, config: Config): void {
  const { maxAge: _maxAge, ...options } = refreshCookieOptions(config);
  res.clearCookie(REFRESH_COOKIE, options);
}
