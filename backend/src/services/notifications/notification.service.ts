import { Types } from 'mongoose';
import type { KvStore } from '../../lib/kv.js';
import type { Logger } from '../../lib/logger.js';
import type { Repositories } from '../../repositories/index.js';
import type { SmsSender } from '../../lib/sms.js';

export interface NotifyInput {
  userId: string;
  /** Dotted event name, e.g. `boost.activated`, `enforcement.suspension`. */
  event: string;
  payload?: Record<string, unknown>;
  /** Unique key → at most one notification (retries are no-ops). */
  dedupeKey?: string;
  /** Bypasses quiet hours (security/enforcement/payment/ops). */
  critical?: boolean;
  /** Bump `count` on an existing deduped row instead of inserting. */
  coalesce?: boolean;
}

interface UserPrefsDoc {
  notificationPrefs?: { push?: boolean; sms?: boolean; digest?: boolean; lang?: 'bn' | 'en' };
  pushTokens?: { token: string; platform: 'fcm' | 'apns' }[];
}

type Lang = 'bn' | 'en';
type Template = {
  title: Record<Lang, string>;
  body: Record<Lang, (payload: Record<string, unknown>) => string>;
};

const fallback = (payload: Record<string, unknown>): string =>
  typeof payload.message === 'string' ? payload.message : 'Trust Bazar';

/** Event → bn/en copy (PRD Appendix D). Unknown events fall back to payload.message. */
export const NOTIFICATION_TEMPLATES: Record<string, Template> = {
  'account.welcome': {
    title: { bn: 'স্বাগতম', en: 'Welcome' },
    body: {
      bn: () => 'Trust Bazar-এ আপনার অ্যাকাউন্ট তৈরি হয়েছে।',
      en: () => 'Your Trust Bazar account is ready.',
    },
  },
  'kyc.submitted': {
    title: { bn: 'KYC জমা হয়েছে', en: 'KYC submitted' },
    body: {
      bn: () => 'যাচাই চলছে, সাধারণত ২৪ ঘণ্টার মধ্যে সম্পন্ন হয়।',
      en: () => 'Verification is in progress — usually within 24 hours.',
    },
  },
  'kyc.approved': {
    title: { bn: 'KYC অনুমোদিত', en: 'KYC approved' },
    body: {
      bn: () => 'আপনার পরিচয় যাচাই সম্পন্ন হয়েছে।',
      en: () => 'Your identity verification is complete.',
    },
  },
  'kyc.rejected': {
    title: { bn: 'KYC অনুমোদিত হয়নি', en: 'KYC rejected' },
    body: {
      bn: (p) => `কারণ: ${String(p.reasonCode ?? 'অনুগ্রহ করে আবার চেষ্টা করুন')}`,
      en: (p) => `Reason: ${String(p.reasonCode ?? 'please retry')}`,
    },
  },
  'listing.published': {
    title: { bn: 'বিজ্ঞাপন প্রকাশিত', en: 'Listing published' },
    body: {
      bn: (p) => `${String(p.title ?? '')} এখন লাইভ।`,
      en: (p) => `${String(p.title ?? '')} is now live.`,
    },
  },
  'listing.expired': {
    title: { bn: 'বিজ্ঞাপন মেয়াদোত্তীর্ণ', en: 'Listing expired' },
    body: {
      bn: (p) => `${String(p.title ?? '')} মেয়াদোত্তীর্ণ হয়েছে।`,
      en: (p) => `${String(p.title ?? '')} has expired.`,
    },
  },
  'listing.expiry_reminder': {
    title: { bn: 'বিজ্ঞাপন শীঘ্রই শেষ হবে', en: 'Listing expiring soon' },
    body: {
      bn: (p) => `${String(p.title ?? '')} ${String(p.days ?? 3)} দিনে শেষ হবে।`,
      en: (p) => `${String(p.title ?? '')} expires in ${String(p.days ?? 3)} day(s).`,
    },
  },
  'chat.message': {
    title: { bn: 'নতুন বার্তা', en: 'New message' },
    body: {
      bn: (p) => `${String(p.preview ?? '')}`,
      en: (p) => `${String(p.preview ?? '')}`,
    },
  },
  'chat.offer': {
    title: { bn: 'নতুন অফার', en: 'New offer' },
    body: {
      bn: (p) => `৳${String(p.amount ?? '')} এর অফার এসেছে।`,
      en: (p) => `You received an offer of ৳${String(p.amount ?? '')}.`,
    },
  },
  'chat.offer_response': {
    title: { bn: 'অফার আপডেট', en: 'Offer update' },
    body: {
      bn: (p) => `আপনার অফার ${String(p.status ?? '')} হয়েছে।`,
      en: (p) => `Your offer was ${String(p.status ?? '')}.`,
    },
  },
  'deal.confirmed': {
    title: { bn: 'ডিল নিশ্চিত', en: 'Deal confirmed' },
    body: {
      bn: () => 'উভয় পক্ষ ডিল নিশ্চিত করেছে।',
      en: () => 'Both parties confirmed the deal.',
    },
  },
  'deal.reminder': {
    title: { bn: 'ডিল নিশ্চিত করুন', en: 'Confirm your deal' },
    body: {
      bn: () => 'অনুগ্রহ করে ডিলটি নিশ্চিত করুন।',
      en: () => 'Please confirm the deal.',
    },
  },
  'deal.timeout': {
    title: { bn: 'ডিলের সময় শেষ', en: 'Deal timed out' },
    body: {
      bn: () => 'ডিলটি স্বয়ংক্রিয়ভাবে বাতিল হয়েছে।',
      en: () => 'The deal was cancelled automatically.',
    },
  },
  'deal.declined': {
    title: { bn: 'ডিল নিশ্চিত হয়নি', en: 'Deal not confirmed' },
    body: {
      bn: () => 'ক্রেতা ডিলটি নিশ্চিত করেননি; একটি ডিসপিউট কেস খোলা হয়েছে।',
      en: () => 'The buyer did not confirm; a dispute case was opened.',
    },
  },
  'boost.activated': {
    title: { bn: 'বুস্ট চালু', en: 'Boost active' },
    body: {
      bn: (p) => `আপনার বিজ্ঞাপন ${String(p.days ?? '')} দিনের জন্য বুস্ট হয়েছে।`,
      en: (p) => `Your listing is boosted for ${String(p.days ?? '')} day(s).`,
    },
  },
  'payment.success': {
    title: { bn: 'পেমেন্ট সফল', en: 'Payment successful' },
    body: {
      bn: (p) => `৳${String(p.amount ?? '')} পরিশোধিত।`,
      en: (p) => `৳${String(p.amount ?? '')} received.`,
    },
  },
  'payment.failed': {
    title: { bn: 'পেমেন্ট ব্যর্থ', en: 'Payment failed' },
    body: {
      bn: (p) => `কারণ: ${String(p.reason ?? 'অজানা')}`,
      en: (p) => `Reason: ${String(p.reason ?? 'unknown')}`,
    },
  },
  'payment.reconciled_to_credit': {
    title: { bn: 'পেমেন্ট ক্রেডিট', en: 'Payment credited' },
    body: {
      bn: (p) => `৳${String(p.amount ?? '')} ক্রেডিট যোগ হয়েছে।`,
      en: (p) => `৳${String(p.amount ?? '')} added as credits.`,
    },
  },
  'enforcement.warning': {
    title: { bn: 'সতর্কতা', en: 'Warning' },
    body: {
      bn: (p) => `কারণ: ${String(p.reasonCode ?? '')}`,
      en: (p) => `Reason: ${String(p.reasonCode ?? '')}`,
    },
  },
  'enforcement.suspension': {
    title: { bn: 'অ্যাকাউন্ট স্থগিত', en: 'Account suspended' },
    body: {
      bn: () => 'আপনি আপিল করতে পারেন।',
      en: () => 'You may file an appeal.',
    },
  },
  'enforcement.ban': {
    title: { bn: 'অ্যাকাউন্ট নিষিদ্ধ', en: 'Account banned' },
    body: {
      bn: () => 'নীতি লঙ্ঘনের কারণে অ্যাকাউন্ট নিষিদ্ধ হয়েছে।',
      en: () => 'The account was banned for policy violations.',
    },
  },
  'enforcement.lift': {
    title: { bn: 'অ্যাকাউন্ট পুনরুদ্ধার', en: 'Account restored' },
    body: {
      bn: () => 'আপনার অ্যাকাউন্ট পুনরুদ্ধার করা হয়েছে।',
      en: () => 'Your account has been restored.',
    },
  },
  'appeal.decision': {
    title: { bn: 'আপিলের ফলাফল', en: 'Appeal decision' },
    body: {
      bn: (p) => `ফলাফল: ${String(p.outcome ?? '')}`,
      en: (p) => `Outcome: ${String(p.outcome ?? '')}`,
    },
  },
  'support.reply': {
    title: { bn: 'সাপোর্ট উত্তর', en: 'Support reply' },
    body: {
      bn: () => 'আপনার টিকিটে নতুন উত্তর এসেছে।',
      en: () => 'There is a new reply on your ticket.',
    },
  },
  'report.received': {
    title: { bn: 'রিপোর্ট গৃহীত', en: 'Report received' },
    body: {
      bn: () => 'আমরা আপনার রিপোর্ট পর্যালোচনা করছি।',
      en: () => 'We are reviewing your report.',
    },
  },
  'saved_search.match': {
    title: { bn: 'সেভ করা সার্চে নতুন বিজ্ঞাপন', en: 'New matches for your saved search' },
    body: {
      bn: (p) => `"${String(p.query ?? '')}" — ${String(p.count ?? 0)}টি নতুন বিজ্ঞাপন।`,
      en: (p) => `"${String(p.query ?? '')}" — ${String(p.count ?? 0)} new listing(s).`,
    },
  },
  'listing.renewed': {
    title: { bn: 'বিজ্ঞাপন নবায়ন', en: 'Listing renewed' },
    body: {
      bn: () => 'আপনার বিজ্ঞাপন আবার সক্রিয় হয়েছে।',
      en: () => 'Your listing is active again.',
    },
  },
  'ops.sla_breach': {
    title: { bn: 'SLA লঙ্ঘন', en: 'SLA at risk' },
    body: {
      bn: (p) => `${String(p.queue ?? '')} #${String(p.id ?? '')} SLA ${String(p.state ?? 'breached')}`,
      en: (p) => `${String(p.queue ?? '')} #${String(p.id ?? '')} SLA ${String(p.state ?? 'breached')}`,
    },
  },
  'ops.job_failed': {
    title: { bn: 'জব ব্যর্থ', en: 'Job failed' },
    body: {
      bn: (p) => `${String(p.job ?? '')}: ${String(p.error ?? '')}`,
      en: (p) => `${String(p.job ?? '')}: ${String(p.error ?? '')}`,
    },
  },
  'ops.seller_auto_flagged': {
    title: { bn: 'সেলার ফ্ল্যাগ হয়েছে', en: 'Seller auto-flagged' },
    body: {
      bn: (p) => `৯০ দিনে ${String(p.disputes90d ?? '')}টি ডিসপিউট — পর্যালোচনা প্রয়োজন।`,
      en: (p) => `${String(p.disputes90d ?? '')} disputes in 90 days — review needed.`,
    },
  },
  'ops.audit_chain_broken': {
    title: { bn: 'অডিট চেইন ভাঙা', en: 'Audit chain broken' },
    body: {
      bn: (p) => `seq ${String(p.brokenAt ?? '')}`,
      en: (p) => `seq ${String(p.brokenAt ?? '')}`,
    },
  },
  'security.login_alert': {
    title: { bn: 'নতুন লগইন', en: 'New login' },
    body: {
      bn: () => 'নতুন ডিভাইসে লগইন হয়েছে।',
      en: () => 'A new device signed in.',
    },
  },
};

/** Ops mailbox user id (seeded `config/opsInbox`); resolved lazily. */
async function resolveOpsRecipient(repos: Repositories): Promise<string | null> {
  const doc = (await repos.config.findOne({ _id: 'opsInbox' } as never)) as unknown as {
    value?: { userId?: string };
  } | null;
  return doc?.value?.userId ?? null;
}

function isCritical(event: string): boolean {
  return (
    event.startsWith('security.') ||
    event.startsWith('enforcement.') ||
    event.startsWith('payment.') ||
    event.startsWith('ops.') ||
    event === 'otp'
  );
}

function isSmsEvent(event: string): boolean {
  return event.startsWith('enforcement.') || event === 'otp';
}

/** 22:00–08:00 Asia/Dhaka (PRD §3.6). */
export function isQuietHours(at: Date = new Date()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Dhaka',
      hour: '2-digit',
      hour12: false,
    }).format(at),
  );
  return hour >= 22 || hour < 8;
}

export class NotificationService {
  constructor(
    private readonly deps: {
      repos: Repositories;
      kv?: KvStore;
      sms?: SmsSender;
      logger?: Logger;
    },
  ) {}

  /** Primary event entry point — every producer goes through this. */
  async emit(input: NotifyInput) {
    const { repos } = this.deps;
    const user = (await repos.users.findById(input.userId)) as unknown as UserPrefsDoc | null;
    if (!user) return null;

    const payload = input.payload ?? {};
    const template = NOTIFICATION_TEMPLATES[input.event];
    const lang: Lang = user.notificationPrefs?.lang === 'en' ? 'en' : 'bn';
    const title = template?.title[lang] ?? input.event;
    const body = template?.body[lang](payload) ?? fallback(payload);

    const critical = input.critical ?? isCritical(input.event);
    const quiet = isQuietHours();
    const channels: string[] = ['inApp'];
    if (user.notificationPrefs?.push !== false && (user.pushTokens?.length ?? 0) > 0) {
      channels.push('push');
    }
    if (user.notificationPrefs?.sms !== false && isSmsEvent(input.event)) channels.push('sms');
    if (quiet && !critical) {
      const idx = channels.indexOf('push');
      if (idx >= 0) channels.splice(idx, 1);
      const smsIdx = channels.indexOf('sms');
      if (smsIdx >= 0) channels.splice(smsIdx, 1);
    }

    const dedupeKey = input.dedupeKey;
    if (dedupeKey) {
      const existing = (await repos.notifications.findByDedupeKey(dedupeKey)) as unknown as {
        _id: Types.ObjectId;
      } | null;
      if (existing) {
        if (input.coalesce) {
          const updated = await repos.notifications.findOneAndUpdate(
            { _id: existing._id } as never,
            {
              $inc: { count: 1 },
              $set: { title, body, payload, channels, readAt: null, lastAt: new Date() },
            } as never,
          );
          return updated;
        }
        return existing;
      }
    }

    try {
      return await repos.notifications.insert({
        userId: new Types.ObjectId(input.userId),
        type: input.event,
        title,
        body,
        payload,
        channels,
        status: 'sent',
        dedupeKey,
        count: 1,
        lastAt: new Date(),
      } as never);
    } catch (error) {
      // Unique dedupe race: another producer won — fetch and return it.
      if ((error as { code?: number }).code === 11000 && dedupeKey) {
        return repos.notifications.findByDedupeKey(dedupeKey);
      }
      throw error;
    }
  }

  /** Fan-out to the ops inbox (job failures, SLA, audit chain). */
  async notifyOps(input: Omit<NotifyInput, 'userId'>) {
    const userId = await resolveOpsRecipient(this.deps.repos);
    if (!userId) {
      this.deps.logger?.warn({ event: input.event }, 'ops inbox not configured');
      return null;
    }
    return this.emit({ ...input, userId, critical: true });
  }

  async list(userId: string, query: { read?: boolean; limit: number }) {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    if (query.read === true) filter.readAt = { $ne: null };
    if (query.read === false) filter.readAt = null;

    const [items, unread] = await Promise.all([
      this.deps.repos.notifications.find(filter as never, {
        sort: { createdAt: -1 },
        limit: query.limit,
      }),
      this.deps.repos.notifications.unreadCount(userId),
    ]);
    return { items, unread };
  }

  async markRead(userId: string, id: string): Promise<boolean> {
    const updated = await this.deps.repos.notifications.findOneAndUpdate(
      { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) } as never,
      { $set: { readAt: new Date() } } as never,
    );
    return Boolean(updated);
  }

  async registerDevice(userId: string, token: string, platform: 'fcm' | 'apns'): Promise<void> {
    await this.deps.repos.users.raw.updateOne(
      { _id: new Types.ObjectId(userId) },
      {
        $pull: { pushTokens: { token } },
      },
    );
    await this.deps.repos.users.raw.updateOne(
      { _id: new Types.ObjectId(userId) },
      {
        $push: { pushTokens: { token, platform, at: new Date() } },
      },
    );
  }
}
