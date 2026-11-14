import { Router } from 'express';
import type { Db } from 'mongodb';
import { getRedis } from '../lib/redis.js';
import { ah } from '../lib/async-handler.js';

/**
 * Liveness + readiness. 200 only when every hard dependency is up
 * (Mongo app cluster; Redis), 503 otherwise — matches k8s probe semantics.
 */
export function healthRoutes(appDb: () => Db | null): Router {
  const router = Router();

  router.get(
    '/healthz',
    ah(async (_req, res) => {
      const mongo = await appDb()
        ?.command({ ping: 1 })
        .then(() => true)
        .catch(() => false) ?? false;
      const redisClient = getRedis();
      const redis = redisClient
        ? await redisClient
            .ping()
            .then((pong) => pong === 'PONG')
            .catch(() => false)
        : false;

      const healthy = mongo && redis;
      res.status(healthy ? 200 : 503).json({
        data: {
          status: healthy ? 'healthy' : 'degraded',
          checks: { mongo, redis },
          uptime: Math.round(process.uptime()),
        },
      });
    }),
  );

  return router;
}
