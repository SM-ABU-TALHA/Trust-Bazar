import { Router } from 'express';
import { z } from 'zod';
import { deviceTokenSchema, notificationListQuerySchema } from '@trust/shared/schemas';
import type { Config } from '../config/index.js';
import { ah } from '../lib/async-handler.js';
import { err } from '../lib/errors.js';
import { validate } from '../middleware/index.js';
import { buildRequireAuth } from '../middleware/require-auth.js';
import type { Repositories } from '../repositories/index.js';
import type { NotificationService } from '../services/notifications/notification.service.js';

const idParams = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'invalid_id') });

export interface NotificationRouteDeps {
  config: Config;
  repos: Repositories;
  notifications: NotificationService;
}

export function notificationRoutes(deps: NotificationRouteDeps): Router {
  const router = Router();
  const requireAuth = buildRequireAuth(deps.config, deps.repos);

  router.get(
    '/notifications',
    requireAuth,
    validate({ query: notificationListQuerySchema }),
    ah(async (req, res) => {
      const query = notificationListQuerySchema.parse(req.query);
      const { items, unread } = await deps.notifications.list(req.user!.id, query);
      res.json({
        data: items,
        meta: { requestId: req.id, unread, limit: query.limit },
      });
    }),
  );

  router.post(
    '/notifications/:id/read',
    requireAuth,
    validate({ params: idParams }),
    ah(async (req, res) => {
      const ok = await deps.notifications.markRead(req.user!.id, req.params.id as string);
      if (!ok) throw err.notFound('notification_not_found');
      res.status(204).end();
    }),
  );

  router.post(
    '/notifications/device-token',
    requireAuth,
    validate({ body: deviceTokenSchema }),
    ah(async (req, res) => {
      await deps.notifications.registerDevice(req.user!.id, req.body.token, req.body.platform);
      res.status(204).end();
    }),
  );

  return router;
}
