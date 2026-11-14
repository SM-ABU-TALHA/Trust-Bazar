import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  blockThreadSchema,
  createThreadSchema,
  messageListQuerySchema,
  offerAmountSchema,
  respondOfferSchema,
  sendMessageSchema,
  threadReportSchema,
  type BlockThreadInput,
  type OfferAmountInput,
  type RespondOfferInput,
  type SendMessageInput,
  type ThreadReportInput,
} from '@trust/shared/schemas';
import type { Config } from '../config/index.js';
import { ah } from '../lib/async-handler.js';
import { err } from '../lib/errors.js';
import type { KvStore } from '../lib/kv.js';
import type { Logger } from '../lib/logger.js';
import {
  enforcementGate,
  rateLimit,
  requireKyc,
  requireRole,
  validate,
  type RateLimitStore,
} from '../middleware/index.js';
import { buildRequireAuth } from '../middleware/require-auth.js';
import type { Repositories } from '../repositories/index.js';
import { ChatService } from '../services/chat/chat.service.js';

export interface ChatRouteDeps {
  config: Config;
  logger: Logger;
  repos: Repositories;
  kv: KvStore;
  rateStore: RateLimitStore;
}

const idParams = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'invalid_id') });

export function chatRoutes(deps: ChatRouteDeps): Router {
  const router = Router();
  const requireAuth = buildRequireAuth(deps.config, deps.repos);
  const service = new ChatService({ repos: deps.repos, kv: deps.kv });

  // ── Threads (API §5.1–5.2) ───────────────────────────────────────────────

  router.post(
    '/chat/threads',
    requireAuth,
    enforcementGate,
    rateLimit('thread_create', deps.rateStore),
    requireKyc('buyer'),
    validate({ body: createThreadSchema }),
    ah(async (req, res) =>
      sendData(
        req,
        res,
        200,
        await service.createThread(userId(req), (req.body as { listingId: string }).listingId),
      ),
    ),
  );

  router.get(
    '/chat/threads',
    requireAuth,
    ah(async (req, res) => sendData(req, res, 200, await service.listThreads(userId(req)))),
  );

  // ── Messages (API §5.3–5.4) ──────────────────────────────────────────────

  router.post(
    '/chat/threads/:id/messages',
    requireAuth,
    enforcementGate,
    rateLimit('chat_message', deps.rateStore),
    validate({ params: idParams, body: sendMessageSchema }),
    ah(async (req, res) =>
      sendData(
        req,
        res,
        201,
        await service.sendMessage(
          userId(req),
          req.params.id as string,
          req.body as SendMessageInput,
        ),
      ),
    ),
  );

  router.get(
    '/chat/threads/:id/messages',
    requireAuth,
    validate({ params: idParams }),
    ah(async (req, res) => {
      const query = messageListQuerySchema.parse(req.query);
      const result = await service.listMessages(userId(req), req.params.id as string, query);
      res.json({
        data: result.items,
        meta: { requestId: req.id, nextCursor: result.nextCursor },
      });
    }),
  );

  // ── Safety (API §5.5–5.7) ────────────────────────────────────────────────

  router.post(
    '/chat/threads/:id/reveal',
    requireAuth,
    enforcementGate,
    requireKyc('buyer'),
    validate({ params: idParams }),
    ah(async (req, res) =>
      sendData(req, res, 200, await service.revealPhone(userId(req), req.params.id as string)),
    ),
  );

  router.post(
    '/chat/threads/:id/block',
    requireAuth,
    enforcementGate,
    validate({ params: idParams, body: blockThreadSchema }),
    ah(async (req, res) => {
      await service.blockThread(
        userId(req),
        req.params.id as string,
        req.body as BlockThreadInput,
      );
      res.status(204).end();
    }),
  );

  router.post(
    '/chat/threads/:id/report',
    requireAuth,
    enforcementGate,
    validate({ params: idParams, body: threadReportSchema }),
    ah(async (req, res) =>
      sendData(
        req,
        res,
        201,
        await service.reportThread(
          userId(req),
          req.params.id as string,
          req.body as ThreadReportInput,
        ),
      ),
    ),
  );

  // ── Offers (API §5.8–5.9) ────────────────────────────────────────────────

  router.post(
    '/chat/threads/:id/offers',
    requireAuth,
    enforcementGate,
    rateLimit('offer_send', deps.rateStore),
    requireKyc('buyer'),
    validate({ params: idParams, body: offerAmountSchema }),
    ah(async (req, res) =>
      sendData(
        req,
        res,
        201,
        await service.createOffer(
          userId(req),
          req.params.id as string,
          req.body as OfferAmountInput,
        ),
      ),
    ),
  );

  router.post(
    '/offers/:id/respond',
    requireAuth,
    enforcementGate,
    requireRole('seller'),
    validate({ params: idParams, body: respondOfferSchema }),
    ah(async (req, res) =>
      sendData(
        req,
        res,
        200,
        await service.respondOffer(
          userId(req),
          req.params.id as string,
          req.body as RespondOfferInput,
        ),
      ),
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
