import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Db } from 'mongodb';
import type { Config } from './config/index.js';
import { ah } from './lib/async-handler.js';
import type { KvStore } from './lib/kv.js';
import type { Logger } from './lib/logger.js';
import type { SmsSender } from './lib/sms.js';
import type { RateLimitStore } from './middleware/index.js';
import { errorHandler, notFound, requestId } from './middleware/index.js';
import type { Repositories } from './repositories/index.js';
import { healthRoutes } from './routes/health.js';
import { v1Routes } from './routes/v1.js';
import { buildKycService } from './services/kyc/kyc.service.js';
import { NotificationService } from './services/notifications/notification.service.js';
import { PaymentService } from './services/payments/payment.service.js';

export interface AppDeps {
  appDb: () => Db | null;
  repos: Repositories;
  kv: KvStore;
  sms: SmsSender;
  rateStore: RateLimitStore;
}

/**
 * Global order (Architecture §4.3):
 *   helmet/cors/parsers → pino → 1 requestId → routes
 * Per-route chain (mounted in each module):
 *   2 rateLimit → 3 auth → 4 enforcementGate → 5 roleGuard
 *   → 6 idempotency → 7 validate → 8 controller → 9 errorHandler
 */
export function createApp(config: Config, logger: Logger, deps: AppDeps): Express {
  const app = express();
  const isProd = config.NODE_ENV === 'production';

  app.set('trust proxy', 1); // behind Cloudflare/LB — needed for req.ip
  app.use(helmet());
  app.use(
    cors({
      origin: ['https://app.trustbazar.com', ...(isProd ? [] : ['http://localhost:3000'])],
      credentials: true, // httpOnly refresh cookies (Architecture §9.2)
    }),
  );
  app.use(compression());
  app.use(requestId);
  app.use(pinoHttp({ logger, customProps: (req) => ({ requestId: (req as express.Request).id }) }));

  // Vendor webhooks sign the raw bytes, so this mount must precede express.json.
  app.use(
    '/api/v1/webhooks/porichoy',
    express.raw({ type: '*/*', limit: '1mb' }),
    ah(async (req, res) => {
      const service = buildKycService(config, logger, deps.repos);
      const result = await service.handleVendorCallback(
        Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        req.header('x-porichoy-signature'),
      );
      res.status(200).json({ data: result, meta: { requestId: req.id } });
    }),
  );

  // Payment webhooks (PROMPT 13) — same raw-body rule; 200 as soon as archived.
  app.use(
    '/api/v1/webhooks/payments/:provider',
    express.raw({ type: '*/*', limit: '1mb' }),
    ah(async (req, res) => {
      const provider = req.params.provider;
      if (provider !== 'bkash' && provider !== 'nagad') {
        res.status(404).json({
          type: 'not_found',
          title: 'Unknown payment provider',
          status: 404,
          requestId: req.id,
        });
        return;
      }

      const notifications = new NotificationService({
        repos: deps.repos,
        kv: deps.kv,
        logger,
      });
      const payments = new PaymentService({ config, logger, repos: deps.repos, notifications });
      const header =
        provider === 'bkash'
          ? req.header('x-bkash-signature')
          : req.header('x-nagad-signature');
      const result = await payments.ingestWebhook(
        provider,
        Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        header,
        req.ip,
      );
      res.status(200).json({ data: result, meta: { requestId: req.id } });
    }),
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.use(healthRoutes(deps.appDb));
  app.use('/api/v1', v1Routes(config, logger, deps));

  app.use(notFound);
  app.use(errorHandler(logger, isProd));
  return app;
}
