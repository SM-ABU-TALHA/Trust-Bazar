import type { Types } from 'mongoose';
import { JOB_SCHEDULES, type JobName } from '@trust/shared/constants';
import type { Config } from '../../config/index.js';
import type { Logger } from '../../lib/logger.js';
import type { Repositories } from '../../repositories/index.js';
import { verifyChain } from '../audit/audit.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { PaymentService } from '../payments/payment.service.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface JobDeps {
  config: Config;
  logger: Logger;
  repos: Repositories;
  notifications: NotificationService;
  payments: PaymentService;
  media?: { process(mediaId: string): Promise<unknown> };
}

type JobResult = Record<string, unknown>;

const JOBS: JobName[] = Object.keys(JOB_SCHEDULES) as JobName[];

function dayKey(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/** Every handler is idempotent: reruns must not duplicate notifications/drift. */
export async function runJob(name: JobName, deps: JobDeps): Promise<JobResult> {
  try {
    return await HANDLERS[name](deps);
  } catch (error) {
    deps.logger.error({ err: error, job: name }, 'job failed');
    await deps.notifications.notifyOps({
      event: 'ops.job_failed',
      payload: { job: name, error: (error as Error).message },
      dedupeKey: `job.failed:${name}:${dayKey()}`,
    });
    return { ok: false, error: (error as Error).message };
  }
}

const HANDLERS: Record<JobName, (deps: JobDeps) => Promise<JobResult>> = {
  async 'media-pipeline'(deps) {
    if (!deps.media) return { skipped: 'media_service_unavailable' };
    const stale = new Date(Date.now() - 60_000);
    const media = (await deps.repos.mediaObjects.find(
      { status: { $in: ['uploaded', 'scanning'] }, createdAt: { $lte: stale } } as never,
      { limit: 20 },
    )) as unknown as { _id: Types.ObjectId }[];
    for (const item of media) await deps.media.process(String(item._id));
    return { processed: media.length };
  },

  async 'webhook-drain'(deps) {
    const stale = new Date(Date.now() - 60_000);
    const events = (await deps.repos.webhookEvents.find(
      {
        processedAt: null,
        signatureOk: true,
        processError: { $ne: 'malformed_webhook' },
        receivedAt: { $lte: stale },
      } as never,
      { limit: 20, sort: { receivedAt: 1 } },
    )) as unknown as { _id: Types.ObjectId }[];
    for (const event of events) await deps.payments.processWebhookEvent(String(event._id));
    return { retried: events.length };
  },

  async recon(deps) {
    return deps.payments.reconcile();
  },

  async lifecycle(deps) {
    const expired = (await deps.repos.listings.find(
      { status: 'active', expiresAt: { $lt: new Date() } } as never,
      { limit: 200 },
    )) as unknown as { _id: Types.ObjectId; sellerId: Types.ObjectId; title: string }[];

    for (const listing of expired) {
      await deps.repos.listings.raw.updateOne(
        { _id: listing._id, status: 'active' },
        { $set: { status: 'expired' } },
      );
      await deps.notifications.emit({
        userId: String(listing.sellerId),
        event: 'listing.expired',
        payload: { title: listing.title, listingId: String(listing._id) },
        dedupeKey: `listing.expired:${String(listing._id)}`,
      });
    }
    return { expired: expired.length };
  },

  async 'expiry-reminders'(deps) {
    const now = Date.now();
    const soon = new Date(now + 3 * DAY);
    const listings = (await deps.repos.listings.find(
      {
        status: 'active',
        expiresAt: { $gte: new Date(now), $lte: soon },
      } as never,
      { limit: 200 },
    )) as unknown as { _id: Types.ObjectId; sellerId: Types.ObjectId; title: string; expiresAt: Date }[];

    for (const listing of listings) {
      const days = Math.max(1, Math.ceil((listing.expiresAt.getTime() - now) / DAY));
      await deps.notifications.emit({
        userId: String(listing.sellerId),
        event: 'listing.expiry_reminder',
        payload: { title: listing.title, days, listingId: String(listing._id) },
        dedupeKey: `listing.expiry:${String(listing._id)}:${dayKey()}`,
      });
    }
    return { reminded: listings.length };
  },

  async 'offer-expiry'(deps) {
    const due = (await deps.repos.offers.find(
      { status: 'pending', expiresAt: { $lt: new Date() } } as never,
      { limit: 200 },
    )) as unknown as {
      _id: Types.ObjectId;
      buyerId: Types.ObjectId;
      listingId: Types.ObjectId;
      amount: number;
    }[];

    for (const offer of due) {
      const updated = await deps.repos.offers.findOneAndUpdate(
        { _id: offer._id, status: 'pending' } as never,
        { $set: { status: 'expired' } } as never,
      );
      if (!updated) continue;
      await deps.notifications.emit({
        userId: String(offer.buyerId),
        event: 'chat.offer_response',
        payload: { status: 'expired', amount: offer.amount },
        dedupeKey: `offer.expired:${String(offer._id)}`,
      });
    }
    return { expired: due.length };
  },

  /**
   * Day-3 reminder → 7-day timeout. Timed-out deals stay `unconfirmed` and
   * never enter the confirmed-deal KPI (PRD §1.5, §3.3.6).
   */
  async 'deal-timeout'(deps) {
    const now = new Date();
    const open = (await deps.repos.deals.find(
      {
        type: 'unconfirmed',
        confirmedAt: null,
        disputeRef: null,
        expiresAt: { $gt: new Date(0) },
      } as never,
      { limit: 200 },
    )) as unknown as {
      _id: Types.ObjectId;
      sellerId: Types.ObjectId;
      buyerId?: Types.ObjectId | null;
      markedSoldAt?: Date | null;
      expiresAt?: Date | null;
    }[];

    let reminded = 0;
    let timedOut = 0;

    for (const deal of open) {
      const dealId = String(deal._id);
      const buyerId = deal.buyerId ? String(deal.buyerId) : null;

      if (deal.expiresAt && now.getTime() >= deal.expiresAt.getTime()) {
        const recipients = [String(deal.sellerId), buyerId].filter(Boolean) as string[];
        for (const userId of recipients) {
          await deps.notifications.emit({
            userId,
            event: 'deal.timeout',
            payload: { dealId },
            dedupeKey: `deal.timeout:${dealId}:${userId}`,
          });
        }
        timedOut += 1;
        continue;
      }

      const dayThree = (deal.markedSoldAt?.getTime() ?? 0) + 3 * DAY;
      if (buyerId && deal.markedSoldAt && now.getTime() >= dayThree) {
        await deps.notifications.emit({
          userId: buyerId,
          event: 'deal.reminder',
          payload: { dealId },
          dedupeKey: `deal.reminder:${dealId}`,
        });
        reminded += 1;
      }
    }
    return { reminded, timedOut };
  },

  async purge(deps) {
    const kycBefore = new Date(Date.now() - 90 * DAY);
    const kyc = await deps.repos.kycSubmissions.raw.updateMany(
      { status: 'rejected', updatedAt: { $lt: kycBefore } },
      {
        $set: { purgedAt: new Date() },
        $unset: { media: '' },
      },
    );

    const accountsBefore = new Date(Date.now() - 14 * DAY);
    const users = (await deps.repos.users.find(
      { deletedAt: { $lt: accountsBefore } } as never,
      { limit: 50 },
    )) as unknown as { _id: Types.ObjectId }[];

    for (const user of users) {
      await Promise.all([
        deps.repos.listings.raw.deleteMany({ sellerId: user._id }),
        deps.repos.threads.raw.deleteMany({ $or: [{ buyerId: user._id }, { sellerId: user._id }] }),
        deps.repos.offers.raw.deleteMany({ $or: [{ buyerId: user._id }, { sellerId: user._id }] }),
        deps.repos.notifications.raw.deleteMany({ userId: user._id }),
      ]);
      await deps.repos.users.raw.deleteOne({ _id: user._id });
    }

    return { kycPurged: kyc.modifiedCount ?? 0, accountsPurged: users.length };
  },

  async 'sla-scan'(deps) {
    const now = new Date();
    const [cases, appeals, tickets] = await Promise.all([
      deps.repos.moderationCases.find(
        { status: { $ne: 'closed' }, slaDue: { $lt: now } } as never,
        { limit: 100 },
      ),
      deps.repos.appeals.find({ status: 'open', slaDue: { $lt: now } } as never, { limit: 100 }),
      deps.repos.supportTickets.find(
        { status: { $in: ['open', 'pending'] }, slaDue: { $lt: now } } as never,
        { limit: 100 },
      ),
    ]);

    const queues: [string, { _id: Types.ObjectId }[]][] = [
      ['moderation', cases as unknown as { _id: Types.ObjectId }[]],
      ['appeal', appeals as unknown as { _id: Types.ObjectId }[]],
      ['support', tickets as unknown as { _id: Types.ObjectId }[]],
    ];

    let alerts = 0;
    for (const [queue, rows] of queues) {
      for (const row of rows) {
        await deps.notifications.notifyOps({
          event: 'ops.sla_breach',
          payload: { queue, id: String(row._id), state: 'breached' },
          dedupeKey: `sla.breach:${queue}:${String(row._id)}:${dayKey()}`,
        });
        alerts += 1;
      }
    }
    return { alerts };
  },

  async 'saved-search-alerts'(deps) {
    const searches = (await deps.repos.savedSearches.find({} as never, {
      limit: 100,
      sort: { lastNotifiedAt: 1 },
    })) as unknown as {
      _id: Types.ObjectId;
      userId: Types.ObjectId;
      query: string;
    }[];

    let sent = 0;
    for (const search of searches) {
      const pattern = new RegExp(search.query.trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const count = await deps.repos.listings.count({
        status: 'active',
        title: pattern,
      } as never);
      if (count === 0) continue;

      await deps.notifications.emit({
        userId: String(search.userId),
        event: 'saved_search.match',
        payload: { query: search.query, count },
        dedupeKey: `saved.search:${String(search._id)}:${dayKey()}`,
      });
      await deps.repos.savedSearches.updateOne(
        { _id: search._id } as never,
        { $set: { lastNotifiedAt: new Date() } } as never,
      );
      sent += 1;
    }
    return { sent };
  },

  async 'breach-notify'(deps) {
    // Event-driven fan-out point (called with an explicit payload by ops tools).
    return { ok: true, note: 'fan-out is triggered by ops notifications', deps: Boolean(deps) };
  },

  async 'audit-verify'(deps) {
    const result = await verifyChain(deps.repos);
    if (!result.ok) {
      await deps.notifications.notifyOps({
        event: 'ops.audit_chain_broken',
        payload: { brokenAt: result.brokenAt, checked: result.checked },
        dedupeKey: `audit.broken:${result.brokenAt}:${dayKey()}`,
      });
    }
    return result;
  },
};

export { JOBS };

let timers: NodeJS.Timeout[] = [];
let bullCleanup: (() => Promise<void>) | null = null;

function redisConnection(redisUrl: string) {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

/**
 * One owner per schedule (Architecture §7): BullMQ repeatables when Redis is
 * configured, otherwise in-process timers. Both call the same `runJob`.
 */
export async function startScheduler(deps: JobDeps): Promise<void> {
  if (timers.length > 0 || bullCleanup) return;

  if (deps.config.WORKER && deps.config.REDIS_URL) {
    const { Queue, Worker } = await import('bullmq');
    const connection = redisConnection(deps.config.REDIS_URL);
    const queue = new Queue('trust-jobs', { connection });
    const worker = new Worker(
      'trust-jobs',
      async (job) => runJob(job.name as JobName, deps),
      { connection },
    );
    worker.on('failed', (job, error) => {
      deps.logger.error({ err: error, job: job?.name }, 'bullmq job failed');
    });

    for (const name of JOBS) {
      const schedule = JOB_SCHEDULES[name];
      if (schedule.intervalMs) {
        await queue.upsertJobScheduler(name, { every: schedule.intervalMs }, { name, data: {} });
      } else if (schedule.dailyAt) {
        const [hour, minute] = schedule.dailyAt.split(':');
        await queue.upsertJobScheduler(
          name,
          { pattern: `${Number(minute)} ${Number(hour)} * * *`, tz: 'Asia/Dhaka' },
          { name, data: {} },
        );
      }
    }

    bullCleanup = async () => {
      await worker.close();
      await queue.close();
      bullCleanup = null;
    };
    return;
  }

  for (const name of JOBS) {
    const schedule = JOB_SCHEDULES[name];
    if (schedule.intervalMs) {
      timers.push(
        setInterval(() => {
          void runJob(name, deps);
        }, schedule.intervalMs),
      );
      continue;
    }
    if (schedule.dailyAt) {
      const [hourRaw, minuteRaw] = schedule.dailyAt.split(':');
      const hour = Number(hourRaw ?? 0);
      const minute = Number(minuteRaw ?? 0);
      const arm = () => {
        const now = new Date();
        const next = new Date(now);
        next.setHours(hour, minute, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        timers.push(
          setTimeout(() => {
            void runJob(name, deps);
            arm();
          }, next.getTime() - now.getTime()),
        );
      };
      arm();
    }
  }
}

export async function stopScheduler(): Promise<void> {
  for (const timer of timers) clearTimeout(timer);
  timers = [];
  if (bullCleanup) await bullCleanup();
}
