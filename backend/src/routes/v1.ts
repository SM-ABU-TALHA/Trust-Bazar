import { Router } from 'express';
import type { Db } from 'mongodb';
import type { Config } from '../config/index.js';
import { ah } from '../lib/async-handler.js';
import type { KvStore } from '../lib/kv.js';
import type { Logger } from '../lib/logger.js';
import type { SmsSender } from '../lib/sms.js';
import { createStorage } from '../lib/storage.js';
import { clientVersionGate } from '../middleware/client-version.js';
import type { RateLimitStore } from '../middleware/index.js';
import { memoryIdempotencyStore, mongoIdempotencyStore } from '../middleware/idempotency.js';
import type { Repositories } from '../repositories/index.js';
import { DealService } from '../services/deals/deal.service.js';
import { ModerationService } from '../services/moderation/moderation.service.js';
import { NotificationService } from '../services/notifications/notification.service.js';
import { OpsService } from '../services/ops/ops.service.js';
import { PaymentService } from '../services/payments/payment.service.js';
import { accountRoutes } from './account.js';
import { authRoutes } from './auth.js';
import { chatRoutes } from './chat.js';
import { dealRoutes } from './deals.js';
import { kycRoutes } from './kyc.js';
import { listingRoutes } from './listings.js';
import { mediaRoutes } from './media.js';
import { moderationRoutes } from './moderation.js';
import { notificationRoutes } from './notifications.js';
import { opsRoutes } from './ops.js';
import { paymentRoutes } from './payments.js';

const CONFIG_CACHE_MS = 60_000;
const API_MINOR_VERSION = '1.5'; // API_spec v1.5 (§0.4 header contract)

interface ConfigDoc {
  _id: string;
  value: unknown;
}

export interface V1Deps {
  appDb: () => Db | null;
  repos: Repositories;
  kv: KvStore;
  sms: SmsSender;
  rateStore: RateLimitStore;
}

interface ConfigSnapshot {
  minVersion: { web: string; android: string; ios: string };
  featureFlags: Record<string, boolean>;
  geoLaunch: string[];
}

const DEFAULT_SNAPSHOT: ConfigSnapshot = {
  minVersion: { web: '1.0.0', android: '1.0.0', ios: '1.0.0' },
  featureFlags: {},
  geoLaunch: [],
};

export function v1Routes(config: Config, logger: Logger, deps: V1Deps): Router {
  const router = Router();
  const storage = createStorage(config);

  // Config cache (API_spec §13.1) — also backs the client-version gate.
  let cache: { body: ConfigSnapshot & { apiVersion: string }; expiresAt: number } | null = null;

  const readConfig = async (): Promise<ConfigSnapshot> => {
    const db = deps.appDb();
    if (!db) return { ...DEFAULT_SNAPSHOT, minVersion: { ...DEFAULT_SNAPSHOT.minVersion } };

    const docs = await db
      .collection<ConfigDoc>('config')
      .find({ _id: { $in: ['minVersion', 'featureFlags', 'geoLaunch'] } as never })
      .toArray();

    const snapshot: ConfigSnapshot = {
      minVersion: { ...DEFAULT_SNAPSHOT.minVersion },
      featureFlags: {},
      geoLaunch: [],
    };
    for (const doc of docs) {
      if (doc._id === 'minVersion') snapshot.minVersion = doc.value as ConfigSnapshot['minVersion'];
      if (doc._id === 'featureFlags') snapshot.featureFlags = doc.value as ConfigSnapshot['featureFlags'];
      if (doc._id === 'geoLaunch') {
        snapshot.geoLaunch = (doc.value as { districts: string[] }).districts;
      }
    }
    return snapshot;
  };

  const invalidateConfigCache = () => {
    cache = null;
  };

  // Services shared by the new routers (single emitter → consistent dedupe).
  const notifications = new NotificationService({ repos: deps.repos, kv: deps.kv, logger });
  const payments = new PaymentService({ config, logger, repos: deps.repos, notifications });
  const deals = new DealService({ repos: deps.repos, notifications });
  const moderation = new ModerationService({
    repos: deps.repos,
    notifications,
    payments,
    logger,
  });
  const ops = new OpsService({
    config,
    logger,
    repos: deps.repos,
    notifications,
    moderation,
    payments,
    storage,
    invalidateConfig: invalidateConfigCache,
  });

  const db = deps.appDb();
  const idempotencyStore = db ? mongoIdempotencyStore(db) : memoryIdempotencyStore();

  router.use(
    clientVersionGate(async () => (await readConfig()).minVersion as unknown as Record<string, string>),
  );

  router.use(
    authRoutes({
      config,
      logger,
      repos: deps.repos,
      kv: deps.kv,
      sms: deps.sms,
      rateStore: deps.rateStore,
    }),
  );

  router.use(
    accountRoutes({
      config,
      logger,
      repos: deps.repos,
      kv: deps.kv,
      sms: deps.sms,
      rateStore: deps.rateStore,
    }),
  );

  router.use(
    mediaRoutes({
      config,
      logger,
      repos: deps.repos,
      storage,
      rateStore: deps.rateStore,
    }),
  );

  router.use(
    kycRoutes({
      config,
      logger,
      repos: deps.repos,
      storage,
      rateStore: deps.rateStore,
    }),
  );

  router.use(
    listingRoutes({
      config,
      logger,
      repos: deps.repos,
      storage,
      kv: deps.kv,
      rateStore: deps.rateStore,
    }),
  );

  router.use(
    chatRoutes({
      config,
      logger,
      repos: deps.repos,
      kv: deps.kv,
      rateStore: deps.rateStore,
    }),
  );

  router.use(dealRoutes({ config, repos: deps.repos, deals }));
  router.use(paymentRoutes({ config, logger, repos: deps.repos, rateStore: deps.rateStore, payments, idempotencyStore }));
  router.use(moderationRoutes({ config, repos: deps.repos, rateStore: deps.rateStore, moderation }));
  router.use(notificationRoutes({ config, repos: deps.repos, notifications }));
  router.use(opsRoutes({ config, repos: deps.repos, rateStore: deps.rateStore, ops }));

  /** GET /config — public client bootstrap (API_spec §13.1). Cached 60s. */
  router.get(
    '/config',
    ah(async (req, res) => {
      res.setHeader('API-Version', API_MINOR_VERSION);

      if (cache && cache.expiresAt > Date.now()) {
        return res.json({ data: cache.body, meta: { requestId: req.id } });
      }

      const snapshot = await readConfig();
      const body = {
        ...snapshot,
        apiVersion: API_MINOR_VERSION,
        serverTime: new Date().toISOString(),
      };
      cache = { body, expiresAt: Date.now() + CONFIG_CACHE_MS };
      res.json({ data: body, meta: { requestId: req.id } });
    }),
  );

  return router;
}

export { API_MINOR_VERSION };
