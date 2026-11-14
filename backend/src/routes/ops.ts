import { Router } from 'express';
import { z } from 'zod';
import {
  appealDecisionSchema,
  configUpdateSchema,
  kycDecisionSchema,
  moderationActionSchema,
  opsLoginSchema,
  opsQueueQuerySchema,
  ticketMessageSchema,
} from '@trust/shared/schemas';
import type { Config } from '../config/index.js';
import { ah } from '../lib/async-handler.js';
import { rateLimit, validate, type RateLimitStore } from '../middleware/index.js';
import { requireOperator } from '../middleware/require-operator.js';
import type { Repositories } from '../repositories/index.js';
import type { OpsService } from '../services/ops/ops.service.js';

const idParams = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'invalid_id') });

const auditQuerySchema = z.object({
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().regex(/^[a-f\d]{24}$/i, 'invalid_id').optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export interface OpsRouteDeps {
  config: Config;
  repos: Repositories;
  rateStore: RateLimitStore;
  ops: OpsService;
}

export function opsRoutes(deps: OpsRouteDeps): Router {
  const router = Router();
  const asKyc = requireOperator(deps.config, deps.repos, 'kycReviewer', 'superadmin');
  const asModerator = requireOperator(
    deps.config,
    deps.repos,
    'moderator',
    'seniorModerator',
    'superadmin',
  );
  const asSenior = requireOperator(deps.config, deps.repos, 'seniorModerator', 'superadmin');
  const asSuperadmin = requireOperator(deps.config, deps.repos, 'superadmin');

  router.post(
    '/ops/auth/login',
    rateLimit('ops_login', deps.rateStore, { max: 10, window: '5m' }),
    validate({ body: opsLoginSchema }),
    ah(async (req, res) => {
      const result = await deps.ops.login(req.body.email, req.body.totp, req.ip);
      res.json({ data: result, meta: { requestId: req.id } });
    }),
  );

  // ── KYC queue ──────────────────────────────────────────────────────────────
  router.get(
    '/ops/kyc',
    asKyc,
    validate({ query: opsQueueQuerySchema }),
    ah(async (req, res) => {
      const query = opsQueueQuerySchema.parse(req.query);
      const rows = await deps.ops.listKycQueue(
        req.operator!.id,
        query.status,
        query.claim ?? false,
      );
      res.json({ data: rows, meta: { requestId: req.id } });
    }),
  );

  router.get(
    '/ops/kyc/:id',
    asKyc,
    validate({ params: idParams }),
    ah(async (req, res) => {
      const detail = await deps.ops.viewKyc(req.operator!.id, req.params.id as string);
      res.json({ data: detail, meta: { requestId: req.id } });
    }),
  );

  router.post(
    '/ops/kyc/:id/decide',
    asKyc,
    validate({ params: idParams, body: kycDecisionSchema }),
    ah(async (req, res) => {
      const result = await deps.ops.decideKyc(req.operator!.id, req.params.id as string, req.body);
      res.json({ data: result, meta: { requestId: req.id } });
    }),
  );

  // ── Moderation ─────────────────────────────────────────────────────────────
  router.get(
    '/ops/moderation',
    asModerator,
    validate({ query: opsQueueQuerySchema }),
    ah(async (req, res) => {
      const query = opsQueueQuerySchema.parse(req.query);
      const rows = await deps.ops.listCases(
        req.operator!.id,
        query.status,
        query.claim ?? false,
      );
      res.json({ data: rows, meta: { requestId: req.id } });
    }),
  );

  router.post(
    '/ops/moderation/:id/claim',
    asModerator,
    validate({ params: idParams }),
    ah(async (req, res) => {
      const row = await deps.ops.claimCase(req.operator!.id, req.params.id as string);
      res.json({ data: row, meta: { requestId: req.id } });
    }),
  );

  router.post(
    '/ops/moderation/:id/action',
    asModerator,
    validate({ params: idParams, body: moderationActionSchema }),
    ah(async (req, res) => {
      const result = await deps.ops.actCase(
        req.operator!.id,
        req.operator!.role,
        req.params.id as string,
        req.body,
      );
      const status = result.status === 'pending_second_approval' ? 202 : 200;
      res.status(status).json({ data: result, meta: { requestId: req.id } });
    }),
  );

  // ── Appeals ────────────────────────────────────────────────────────────────
  router.get(
    '/ops/appeals',
    asSenior,
    validate({ query: opsQueueQuerySchema }),
    ah(async (req, res) => {
      const query = opsQueueQuerySchema.parse(req.query);
      const rows = await deps.ops.listAppeals(query.status);
      res.json({ data: rows, meta: { requestId: req.id } });
    }),
  );

  router.post(
    '/ops/appeals/:id/decide',
    asSenior,
    validate({ params: idParams, body: appealDecisionSchema }),
    ah(async (req, res) => {
      const result = await deps.ops.decideAppeal(
        req.operator!.id,
        req.params.id as string,
        req.body.outcome,
        req.body.reason,
      );
      res.json({ data: result, meta: { requestId: req.id } });
    }),
  );

  // ── Support ────────────────────────────────────────────────────────────────
  router.get(
    '/ops/support',
    asModerator,
    validate({ query: opsQueueQuerySchema }),
    ah(async (req, res) => {
      const query = opsQueueQuerySchema.parse(req.query);
      const rows = await deps.ops.listSupport(query.status);
      res.json({ data: rows, meta: { requestId: req.id } });
    }),
  );

  router.post(
    '/ops/support/:id/reply',
    asModerator,
    validate({ params: idParams, body: ticketMessageSchema }),
    ah(async (req, res) => {
      const result = await deps.ops.replySupport(req.operator!.id, req.params.id as string, req.body.body);
      res.json({ data: result, meta: { requestId: req.id } });
    }),
  );

  // ── Audit & config ─────────────────────────────────────────────────────────
  router.get(
    '/ops/audit',
    asSuperadmin,
    validate({ query: auditQuerySchema }),
    ah(async (req, res) => {
      const query = auditQuerySchema.parse(req.query);
      const rows = await deps.ops.audit(req.operator!.id, query);
      res.json({ data: rows, meta: { requestId: req.id } });
    }),
  );

  router.get(
    '/ops/config',
    asSuperadmin,
    ah(async (req, res) => {
      const values = await deps.ops.getConfig();
      res.json({ data: values, meta: { requestId: req.id } });
    }),
  );

  router.put(
    '/ops/config',
    asSuperadmin,
    validate({ body: configUpdateSchema }),
    ah(async (req, res) => {
      const values = await deps.ops.updateConfig(req.operator!.id, req.body);
      res.json({ data: values, meta: { requestId: req.id } });
    }),
  );

  router.post(
    '/ops/reconcile/payments',
    asSuperadmin,
    ah(async (req, res) => {
      const summary = await deps.ops.reconcile();
      res.json({ data: summary, meta: { requestId: req.id } });
    }),
  );

  return router;
}
