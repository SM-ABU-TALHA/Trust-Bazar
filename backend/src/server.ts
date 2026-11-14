import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config/index.js';
import { createLogger } from './lib/logger.js';
import { loadEnvFile } from './lib/env.js';
import { createKv } from './lib/kv.js';
import { connectMongo, type MongoHandle } from './lib/mongo.js';
import { attachRealtime } from './realtime/socket.js';
import { ChatService } from './services/chat/chat.service.js';
import { closeRedis, initRedis } from './lib/redis.js';
import { createSmsSender } from './lib/sms.js';
import { createStorage } from './lib/storage.js';
import { createRateLimitStore } from './middleware/index.js';
import { initDbContext } from './db/context.js';
import { MediaService } from './services/media/media.service.js';
import { NotificationService } from './services/notifications/notification.service.js';
import { PaymentService } from './services/payments/payment.service.js';
import { startScheduler, stopScheduler } from './services/jobs/registry.js';

/** Boot order (Architecture §9): env → config → mongo → redis → http → jobs(WORKER). */
async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  const logger = createLogger(config);

  let mongo: MongoHandle;
  try {
    mongo = await connectMongo(config.MONGO_APP_URI, config.MONGO_AUDIT_URI, (message) =>
      logger.error({ err: message }, 'audit cluster unreachable — running degraded'),
    );
  } catch (error) {
    logger.fatal({ err: error }, 'app cluster connection failed — aborting boot');
    process.exit(1);
  }

  initRedis(config.REDIS_URL, (message) =>
    logger.error({ err: message }, 'redis unreachable — degraded mode (memory fallbacks)'),
  );

  const db = initDbContext(mongo.app, mongo.audit);
  logger.info(
    { collections: Object.keys(db.models).length, audit: db.audit !== null },
    'db context ready',
  );

  const kv = createKv();
  const app = createApp(config, logger, {
    appDb: () => mongo.appDb,
    repos: db.repos,
    kv,
    sms: createSmsSender(config, logger),
    rateStore: createRateLimitStore(),
  });
  const server = createServer(app);
  const realtime = attachRealtime(server, {
    config,
    logger,
    repos: db.repos,
    chat: new ChatService({ repos: db.repos, kv }),
  });
  server.listen(config.PORT, () => {
    logger.info({ port: config.PORT, worker: config.WORKER }, 'api listening');
  });

  // Jobs (PROMPT 15): one scheduler owner; HTTP and workers share handlers.
  if (config.WORKER) {
    const storage = createStorage(config);
    const notifications = new NotificationService({ repos: db.repos, kv, logger });
    const payments = new PaymentService({ config, logger, repos: db.repos, notifications });
    const media = new MediaService({ config, repos: db.repos, storage, logger });
    await startScheduler({
      config,
      logger,
      repos: db.repos,
      notifications,
      payments,
      media,
    });
  }

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    realtime.close();
    void stopScheduler();
    server.close(() => {
      Promise.allSettled([mongo.close(), closeRedis()]).then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  process.stderr.write(`boot failure: ${String(error)}\n`);
  process.exit(1);
});
