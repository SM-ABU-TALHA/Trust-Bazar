import { Types } from 'mongoose';
import { LIMITS } from '@trust/shared/constants';
import type { BoostCheckoutInput } from '@trust/shared/schemas';
import type { Config } from '../../config/index.js';
import { err } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { buildReceiptPdf } from '../../lib/pdf.js';
import type { Repositories } from '../../repositories/index.js';
import { appendAudit } from '../audit/audit.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import { createGateway, type PaymentProvider, type SettlementRow } from './providers.js';

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  initiated: ['pending', 'success', 'failed', 'expired'],
  pending: ['success', 'failed', 'expired'],
  success: [],
  failed: [],
  expired: [],
};

const MONTHLY_MS = 30 * 86_400_000;

interface PaymentDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  packageId: string;
  listingId: Types.ObjectId;
  amount: number;
  creditApplied: number;
  provider: PaymentProvider;
  state: string;
  idempotencyKey: string;
  gatewayUrl?: string | null;
  failureReason?: string | null;
  paidAt?: Date | null;
  receiptNo?: string | null;
  gatewayRefs?: { paymentId?: string; trxId?: string; webhookEventIds?: string[] };
}

interface ListingDoc {
  _id: Types.ObjectId;
  sellerId: Types.ObjectId;
  status: string;
  title: string;
  boost?: {
    active?: boolean;
    packageId?: string | null;
    until?: Date | null;
    pausedAt?: Date | null;
    remainingMs?: number | null;
  };
}

interface PackageDoc {
  _id: string;
  name: string;
  durationDays: number;
  priceBdt: number;
  placement: string;
  active: boolean;
}

interface GrantDoc {
  _id: Types.ObjectId;
  remaining: number;
}

function parseWebhook(raw: Buffer): {
  eventId: string;
  paymentId: string;
  trxId: string;
  state: 'success' | 'failed';
  amount?: number;
} {
  const body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
  const state = body.state === 'success' || body.state === 'failed' ? body.state : null;
  if (!body.eventId || !body.paymentId || !state) throw new Error('malformed_webhook');
  return {
    eventId: String(body.eventId),
    paymentId: String(body.paymentId),
    trxId: String(body.trxId ?? body.eventId),
    state,
    amount: typeof body.amount === 'number' ? body.amount : undefined,
  };
}

export class PaymentService {
  constructor(
    private readonly deps: {
      config: Config;
      logger: Logger;
      repos: Repositories;
      notifications: NotificationService;
    },
  ) {}

  private get repos(): Repositories {
    return this.deps.repos;
  }

  async listPackages() {
    const packages = (await this.repos.boostPackages.find({ active: true } as never, {
      sort: { durationDays: 1 },
    })) as unknown as PackageDoc[];
    return packages.map((pkg) => ({
      id: String(pkg._id),
      name: pkg.name,
      durationDays: pkg.durationDays,
      price: pkg.priceBdt,
      placement: pkg.placement,
      active: pkg.active,
    }));
  }

  /** Credits auto-applied FIFO; the gateway is only asked for the remainder. */
  async checkout(userId: string, input: BoostCheckoutInput, idempotencyKey: string) {
    const existing = (await this.repos.payments.findByIdempotencyKey(
      idempotencyKey,
    )) as unknown as PaymentDoc | null;
    if (existing) {
      const same =
        String(existing.userId) === userId &&
        String(existing.listingId) === String(input.listingId) &&
        existing.packageId === input.packageId &&
        existing.provider === input.provider;
      if (!same) throw err.idempotencyReplay();
      return { payment: existing, replay: true };
    }

    const pkg = (await this.repos.boostPackages.findOne({
      _id: input.packageId,
    } as never)) as unknown as PackageDoc | null;
    if (!pkg || !pkg.active) throw err.notFound('package_not_found');

    const listing = (await this.repos.listings.findById(
      String(input.listingId),
    )) as unknown as ListingDoc | null;
    if (!listing || String(listing.sellerId) !== userId) throw err.notFound('listing_not_found');
    if (listing.status !== 'active') throw err.conflict('listing_not_active');

    const credits = input.creditApply ? await this.creditBalance(userId) : 0;
    const creditApplied = Math.min(credits, pkg.priceBdt);
    const amount = pkg.priceBdt - creditApplied;

    const paymentId = new Types.ObjectId();
    const gateway = createGateway(this.deps.config, input.provider);
    await this.repos.payments.insert({
      _id: paymentId,
      userId: new Types.ObjectId(userId),
      packageId: pkg._id,
      listingId: listing._id,
      amount,
      creditApplied,
      provider: input.provider,
      state: 'initiated',
      idempotencyKey,
      gatewayUrl: gateway.checkoutUrl(String(paymentId), amount),
      gatewayRefs: { paymentId: String(paymentId) },
    } as never);

    await appendAudit(this.repos, {
      actor: 'user',
      actorId: userId,
      action: 'payment.checkout',
      entityType: 'payment',
      entityId: String(paymentId),
      after: { packageId: pkg._id, amount, creditApplied, provider: input.provider },
    });

    // Fully covered by credits → nothing to charge, complete immediately.
    if (amount === 0) await this.complete(paymentId);

    const current = (await this.repos.payments.findById(String(paymentId))) as unknown as PaymentDoc;
    return { payment: current, replay: false };
  }

  async creditBalance(userId: string): Promise<number> {
    const grants = (await this.repos.credits.activeGrants(
      userId,
    )) as unknown as GrantDoc[];
    return grants.reduce((sum, grant) => sum + grant.remaining, 0);
  }

  async credits(userId: string) {
    const grants = (await this.repos.credits.find({ userId } as never, {
      sort: { createdAt: -1 },
      limit: 100,
    })) as unknown as {
      _id: Types.ObjectId;
      amount: number;
      remaining: number;
      source: string;
      reason?: string;
      expiresAt: Date;
      createdAt: Date;
    }[];
    const balance = grants
      .filter((grant) => grant.expiresAt.getTime() > Date.now())
      .reduce((sum, grant) => sum + grant.remaining, 0);
    return {
      balance,
      entries: grants.map((grant) => ({
        id: String(grant._id),
        amount: grant.amount,
        remaining: grant.remaining,
        source: grant.source,
        reason: grant.reason ?? null,
        expiresAt: grant.expiresAt,
        createdAt: grant.createdAt,
      })),
    };
  }

  /** Archives every webhook first (unique gateway+eventId), returns `received`. */
  async ingestWebhook(
    provider: PaymentProvider,
    raw: Buffer,
    signature: string | undefined,
    ip: string | undefined,
  ): Promise<{ eventId: string; duplicate: boolean }> {
    const gateway = createGateway(this.deps.config, provider);
    if (!gateway.allowIp(ip)) throw err.unauthenticated('ip_not_allowed');

    let parsed: ReturnType<typeof parseWebhook> | null = null;
    try {
      parsed = parseWebhook(raw);
    } catch {
      parsed = null;
    }

    const signatureOk = gateway.verifySignature(raw, signature);
    let eventId = parsed?.eventId ?? `invalid-${Date.now()}`;

    const existing = await this.repos.webhookEvents.findOne({
      gateway: provider,
      eventId,
    } as never);
    if (existing) return { eventId, duplicate: true };

    if (!signatureOk) {
      // Archived for forensics but never processed (acceptance: no state change).
      await this.repos.webhookEvents.insert({
        gateway: provider,
        eventId,
        paymentId: parsed?.paymentId ? new Types.ObjectId(parsed.paymentId) : null,
        signatureOk: false,
        payload: { raw: raw.toString('utf8') },
        processedAt: null,
        processError: 'invalid_signature',
      } as never);
      throw err.unauthenticated('invalid_signature');
    }

    if (!parsed) {
      eventId = `malformed-${Date.now()}`;
      await this.repos.webhookEvents.insert({
        gateway: provider,
        eventId,
        signatureOk: true,
        payload: { raw: raw.toString('utf8') },
        processedAt: null,
        processError: 'malformed_webhook',
      } as never);
      return { eventId, duplicate: false };
    }

    const event = (await this.repos.webhookEvents.insert({
      gateway: provider,
      eventId,
      paymentId: new Types.ObjectId(parsed.paymentId),
      signatureOk: true,
      payload: parsed,
      processedAt: null,
    } as never)) as unknown as { _id: Types.ObjectId };

    void this.processWebhookEvent(String(event._id)).catch((error: unknown) => {
      this.deps.logger.error({ err: error, eventId }, 'payment webhook processing failed');
    });

    return { eventId, duplicate: false };
  }

  async processWebhookEvent(eventDocId: string): Promise<void> {
    const event = (await this.repos.webhookEvents.findById(eventDocId)) as unknown as {
      _id: Types.ObjectId;
      processedAt?: Date | null;
      payload?: { paymentId?: string; trxId?: string; state?: 'success' | 'failed' };
    } | null;
    if (!event || event.processedAt) return;

    try {
      const payload = event.payload ?? {};
      if (!payload.paymentId || !payload.state) throw new Error('malformed_event');

      if (payload.state === 'success') {
        await this.complete(new Types.ObjectId(payload.paymentId), payload.trxId, eventDocId);
      } else {
        await this.applyState(payload.paymentId, 'failed', {
          failureReason: 'gateway_failed',
          trxId: payload.trxId,
          eventId: eventDocId,
        });
      }

      await this.repos.webhookEvents.updateOne(
        { _id: event._id } as never,
        { $set: { processedAt: new Date(), processError: null } } as never,
      );
    } catch (error) {
      await this.repos.webhookEvents.updateOne(
        { _id: event._id } as never,
        { $set: { processError: (error as Error).message } } as never,
      );
      throw error;
    }
  }

  /** Monotonic transition; `success` is terminal so replays are rejected. */
  async applyState(
    paymentId: string,
    next: string,
    meta: { failureReason?: string; trxId?: string; eventId?: string } = {},
  ): Promise<{ changed: boolean; state: string }> {
    const payment = (await this.repos.payments.findById(paymentId)) as unknown as PaymentDoc | null;
    if (!payment) throw err.notFound('payment_not_found');
    if (payment.state === next) return { changed: false, state: payment.state };

    const allowed = ALLOWED_TRANSITIONS[payment.state] ?? [];
    if (!allowed.includes(next)) throw err.conflict('invalid_state_transition');

    const set: Record<string, unknown> = { state: next };
    if (next === 'failed') set.failureReason = meta.failureReason ?? 'gateway_failed';
    if (next === 'success') set.paidAt = new Date();

    const updated = await this.repos.payments.findOneAndUpdate(
      { _id: payment._id, state: payment.state } as never,
      { $set: set } as never,
    );
    if (!updated) return { changed: false, state: 'concurrent' };

    return { changed: true, state: next };
  }

  /** Success path: state → credits consumed → boost → receipt → notify → audit. */
  async complete(paymentId: Types.ObjectId | string, trxId?: string, eventId?: string) {
    const payment = (await this.repos.payments.findById(
      String(paymentId),
    )) as unknown as PaymentDoc | null;
    if (!payment) throw err.notFound('payment_not_found');
    if (payment.state === 'success') return { changed: false };

    const transition = await this.applyState(String(payment._id), 'success', { trxId });
    if (!transition.changed) return { changed: false };

    await this.consumeCredits(String(payment.userId), payment.creditApplied);
    const pkg = (await this.repos.boostPackages.findOne({
      _id: payment.packageId,
    } as never)) as unknown as PackageDoc | null;
    const days = pkg?.durationDays ?? 3;
    const until = new Date(Date.now() + days * 86_400_000);

    await this.repos.listings.raw.updateOne(
      { _id: payment.listingId },
      {
        $set: {
          'boost.active': true,
          'boost.packageId': payment.packageId,
          'boost.until': until,
          'boost.pausedAt': null,
          'boost.remainingMs': null,
        },
      },
    );

    const receiptNo = await this.issueReceiptNo();
    await this.repos.payments.updateOne(
      { _id: payment._id } as never,
      {
        $set: {
          receiptNo,
          gatewayRefs: {
            ...(payment.gatewayRefs ?? {}),
            trxId: trxId ?? payment.gatewayRefs?.trxId,
            webhookEventIds: eventId
              ? [...new Set([...(payment.gatewayRefs?.webhookEventIds ?? []), eventId])]
              : (payment.gatewayRefs?.webhookEventIds ?? []),
          },
        },
      } as never,
    );

    await this.deps.notifications.emit({
      userId: String(payment.userId),
      event: 'boost.activated',
      payload: { days, listingId: String(payment.listingId) },
      dedupeKey: `boost.activated:${String(payment._id)}`,
    });
    await this.deps.notifications.emit({
      userId: String(payment.userId),
      event: 'payment.success',
      payload: { amount: payment.amount, receiptNo },
      dedupeKey: `payment.success:${String(payment._id)}`,
    });
    await appendAudit(this.repos, {
      actor: 'system',
      action: 'payment.success',
      entityType: 'payment',
      entityId: String(payment._id),
      after: { state: 'success', amount: payment.amount, receiptNo, trxId },
    });

    return { changed: true, receiptNo };
  }

  private async consumeCredits(userId: string, amount: number): Promise<number> {
    if (amount <= 0) return 0;
    const grants = (await this.repos.credits.activeGrants(
      userId,
    )) as unknown as GrantDoc[];

    let left = amount;
    for (const grant of grants) {
      if (left <= 0) break;
      const take = Math.min(grant.remaining, left);
      if (take <= 0) continue;
      const ok = await this.repos.credits.findOneAndUpdate(
        { _id: grant._id, remaining: { $gte: take } } as never,
        { $inc: { remaining: -take } } as never,
      );
      if (ok) left -= take;
    }
    return amount - left;
  }

  private async issueReceiptNo(): Promise<string> {
    const now = new Date();
    const prefix = `TB-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}-`;
    const count = await this.repos.payments.count({
      state: 'success',
      receiptNo: { $ne: null },
    } as never);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const candidate = `${prefix}${String(count + attempt).padStart(5, '0')}`;
      const clash = await this.repos.payments.findByReceiptNo(candidate);
      if (!clash) return candidate;
    }
    return `${prefix}${String(Date.now()).slice(-5)}`;
  }

  async getPayment(userId: string, paymentId: string) {
    const payment = (await this.repos.payments.findById(
      paymentId,
    )) as unknown as PaymentDoc | null;
    if (!payment || String(payment.userId) !== userId) throw err.notFound('payment_not_found');

    const listing = (await this.repos.listings.findById(
      String(payment.listingId),
    )) as unknown as ListingDoc | null;

    return {
      id: String(payment._id),
      state: payment.state,
      amount: payment.amount,
      creditApplied: payment.creditApplied,
      provider: payment.provider,
      packageId: payment.packageId,
      receiptNo: payment.receiptNo ?? null,
      paidAt: payment.paidAt ?? null,
      boostUntil: listing?.boost?.until ?? null,
      failureReason: payment.failureReason ?? null,
    };
  }

  async receipt(
    userId: string,
    paymentId: string,
  ): Promise<{ pdf: Buffer; filename: string }> {
    const payment = (await this.repos.payments.findById(
      paymentId,
    )) as unknown as PaymentDoc | null;
    if (!payment || String(payment.userId) !== userId) throw err.notFound('payment_not_found');
    if (payment.state !== 'success' || !payment.paidAt || !payment.receiptNo) {
      throw err.conflict('receipt_not_available');
    }
    const windowMs = (LIMITS.payment?.receiptMonths ?? 12) * MONTHLY_MS;
    if (Date.now() - payment.paidAt.getTime() > windowMs) throw err.conflict('receipt_not_available');

    const user = (await this.repos.users.findById(userId)) as unknown as {
      phone?: string;
      profile?: { displayName?: string };
    } | null;
    const listing = (await this.repos.listings.findById(
      String(payment.listingId),
    )) as unknown as ListingDoc | null;

    const pdf = buildReceiptPdf([
      'TRUST BAZAR',
      'Payment receipt',
      '',
      `Receipt no: ${payment.receiptNo}`,
      `Date: ${payment.paidAt.toISOString().slice(0, 10)}`,
      `Account: ${user?.profile?.displayName ?? ''} (${user?.phone ?? ''})`,
      `Listing: ${listing?.title ?? ''}`,
      `Package: ${payment.packageId}`,
      `Amount paid: BDT ${payment.amount}`,
      `Credits applied: BDT ${payment.creditApplied}`,
      `Provider: ${payment.provider}`,
      `Payment id: ${String(payment._id)}`,
      '',
      'This is a system-generated receipt.',
    ]);

    return { pdf, filename: `${payment.receiptNo}.pdf` };
  }

  /** A suspension/ban must not keep buying exposure. */
  async pauseBoosts(userId: string): Promise<number> {
    const now = Date.now();
    const listings = (await this.repos.listings.find({
      sellerId: new Types.ObjectId(userId),
      'boost.active': true,
    } as never)) as unknown as ListingDoc[];

    let paused = 0;
    for (const listing of listings) {
      const until = listing.boost?.until ? new Date(listing.boost.until).getTime() : now;
      const remainingMs = Math.max(0, until - now);
      await this.repos.listings.raw.updateOne(
        { _id: listing._id },
        {
          $set: {
            'boost.active': false,
            'boost.pausedAt': new Date(now),
            'boost.remainingMs': remainingMs,
          },
        },
      );
      paused += 1;
    }
    return paused;
  }

  async resumeBoosts(userId: string): Promise<number> {
    const now = Date.now();
    const listings = (await this.repos.listings.find({
      sellerId: new Types.ObjectId(userId),
      'boost.pausedAt': { $ne: null },
    } as never)) as unknown as ListingDoc[];

    let resumed = 0;
    for (const listing of listings) {
      const remainingMs = listing.boost?.remainingMs ?? 0;
      if (remainingMs <= 0) continue;
      await this.repos.listings.raw.updateOne(
        { _id: listing._id },
        {
          $set: {
            'boost.active': true,
            'boost.until': new Date(now + remainingMs),
            'boost.pausedAt': null,
            'boost.remainingMs': null,
          },
        },
      );
      resumed += 1;
    }
    return resumed;
  }

  /**
   * Settlement reconciliation (PROMPT 13 acceptance): unknown successful rows
   * become credits for a resolvable user — never a boost activation.
   */
  async reconcile(rows?: SettlementRow[]): Promise<{
    matched: number;
    orphanCredits: number;
    skipped: number;
  }> {
    const settlement =
      rows ??
      (await Promise.all([
        createGateway(this.deps.config, 'bkash').fetchSettlement(),
        createGateway(this.deps.config, 'nagad').fetchSettlement(),
      ])).flat();

    let matched = 0;
    let orphanCredits = 0;
    let skipped = 0;

    for (const row of settlement) {
      const payment = (await this.repos.payments.findOne({
        $or: [
          { 'gatewayRefs.trxId': row.trxId },
          { 'gatewayRefs.paymentId': row.reference },
          { _id: Types.ObjectId.isValid(row.reference) ? new Types.ObjectId(row.reference) : null },
        ],
      } as never)) as unknown as PaymentDoc | null;

      if (payment) {
        if (row.state === 'success' && payment.state !== 'success') {
          await this.complete(payment._id, row.trxId);
          matched += 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      if (row.state === 'success' && row.userId) {
        const existing = await this.repos.credits.findOne({
          userId: new Types.ObjectId(row.userId),
          reason: row.trxId,
        } as never);
        if (existing) {
          skipped += 1;
          continue;
        }
        const expiresAt = new Date(
          Date.now() + (LIMITS.credits?.expiryMonths ?? 12) * MONTHLY_MS,
        );
        await this.repos.credits.insert({
          userId: new Types.ObjectId(row.userId),
          amount: Math.max(1, Math.round(row.amount)),
          remaining: Math.max(1, Math.round(row.amount)),
          source: 'reconciliation',
          reason: row.trxId,
          expiresAt,
        } as never);
        await this.deps.notifications.emit({
          userId: row.userId,
          event: 'payment.reconciled_to_credit',
          payload: { amount: row.amount, trxId: row.trxId },
          dedupeKey: `recon:${row.trxId}`,
        });
        orphanCredits += 1;
        continue;
      }

      await this.deps.notifications.notifyOps({
        event: 'ops.vendor_outage',
        payload: { message: `orphan settlement ${row.trxId}` },
        dedupeKey: `recon:orphan:${row.trxId}`,
      });
      skipped += 1;
    }

    await appendAudit(this.repos, {
      actor: 'system',
      action: 'payment.reconcile',
      entityType: 'payment',
      after: { rows: settlement.length, matched, orphanCredits, skipped },
    });

    return { matched, orphanCredits, skipped };
  }
}
