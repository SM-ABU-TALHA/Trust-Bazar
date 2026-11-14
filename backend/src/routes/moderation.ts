import { Router } from 'express';
import { z } from 'zod';
import {
  appealSchema,
  reportSchema,
  supportTicketSchema,
  ticketMessageSchema,
} from '@trust/shared/schemas';
import type { Config } from '../config/index.js';
import { ah } from '../lib/async-handler.js';
import { enforcementGate, rateLimit, validate, type RateLimitStore } from '../middleware/index.js';
import { buildRequireAuth } from '../middleware/require-auth.js';
import type { Repositories } from '../repositories/index.js';
import type { ModerationService } from '../services/moderation/moderation.service.js';

const idParams = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'invalid_id') });

export interface ModerationRouteDeps {
  config: Config;
  repos: Repositories;
  rateStore: RateLimitStore;
  moderation: ModerationService;
}

export function moderationRoutes(deps: ModerationRouteDeps): Router {
  const router = Router();
  const requireAuth = buildRequireAuth(deps.config, deps.repos);

  router.post(
    '/reports',
    requireAuth,
    enforcementGate,
    rateLimit('report_create', deps.rateStore),
    validate({ body: reportSchema }),
    ah(async (req, res) => {
      const result = await deps.moderation.createReport(req.user!.id, req.body);
      res.status(201).json({ data: result, meta: { requestId: req.id } });
    }),
  );

  router.post(
    '/appeals',
    requireAuth,
    rateLimit('appeal_create', deps.rateStore, { max: 5, window: '1d' }),
    validate({ body: appealSchema }),
    ah(async (req, res) => {
      const result = await deps.moderation.createAppeal(req.user!.id, req.body);
      res.status(201).json({ data: result, meta: { requestId: req.id } });
    }),
  );

  router.get(
    '/appeals/:id',
    requireAuth,
    validate({ params: idParams }),
    ah(async (req, res) => {
      const appeal = await deps.moderation.getAppeal(req.user!.id, req.params.id as string);
      res.json({ data: appeal, meta: { requestId: req.id } });
    }),
  );

  router.post(
    '/support/tickets',
    requireAuth,
    rateLimit('support_create', deps.rateStore, { max: 5, window: '1d' }),
    validate({ body: supportTicketSchema }),
    ah(async (req, res) => {
      const result = await deps.moderation.createTicket(req.user!.id, req.body);
      res.status(201).json({ data: result, meta: { requestId: req.id } });
    }),
  );

  router.get(
    '/me/support/tickets',
    requireAuth,
    ah(async (req, res) => {
      const tickets = await deps.moderation.listTickets(req.user!.id);
      res.json({ data: tickets, meta: { requestId: req.id } });
    }),
  );

  router.get(
    '/support/tickets/:id/messages',
    requireAuth,
    validate({ params: idParams }),
    ah(async (req, res) => {
      const messages = await deps.moderation.listTicketMessages(req.user!.id, req.params.id as string);
      res.json({ data: messages, meta: { requestId: req.id } });
    }),
  );

  router.post(
    '/support/tickets/:id/messages',
    requireAuth,
    validate({ params: idParams, body: ticketMessageSchema }),
    ah(async (req, res) => {
      const result = await deps.moderation.postTicketMessage(req.user!.id, req.params.id as string, req.body);
      res.status(201).json({ data: result, meta: { requestId: req.id } });
    }),
  );

  return router;
}
