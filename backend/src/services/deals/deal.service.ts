import { Types } from 'mongoose';
import type { DeclineDealInput } from '@trust/shared/schemas';
import { err } from '../../lib/errors.js';
import type { Repositories } from '../../repositories/index.js';
import { appendAudit } from '../audit/audit.service.js';
import type { NotificationService } from '../notifications/notification.service.js';

/** PRD P4 — three disputes in 90 days auto-flags the seller for review. */
const DISPUTE_FLAG_THRESHOLD = 3;
const CASE_SLA_MS = 48 * 3_600_000;

interface DealDoc {
  _id: Types.ObjectId;
  listingId: Types.ObjectId;
  sellerId: Types.ObjectId;
  buyerId?: Types.ObjectId | null;
  type: string;
  channel: string;
  markedSoldAt?: Date | null;
  confirmedAt?: Date | null;
  expiresAt?: Date | null;
  disputeRef?: Types.ObjectId | null;
  undoUntil?: Date | null;
}

interface ThreadDoc {
  _id: Types.ObjectId;
  buyerMsgCount?: number;
}

interface SellerDoc {
  _id: Types.ObjectId;
  profile?: { sellerStats?: { disputes90d?: number } };
}

export interface DealServiceDeps {
  repos: Repositories;
  notifications: NotificationService;
}

/**
 * PROMPT 12 — buyer deal confirmation. Only `confirmed` rows feed the KPI;
 * direct sales and 7-day timeouts are deliberately excluded.
 */
export class DealService {
  constructor(private readonly deps: DealServiceDeps) {}

  private get repos(): Repositories {
    return this.deps.repos;
  }

  private async requireBuyerDeal(buyerId: string, dealId: string): Promise<DealDoc> {
    const deal = (await this.repos.deals.findById(dealId)) as unknown as DealDoc | null;
    if (!deal || !deal.buyerId || String(deal.buyerId) !== buyerId) {
      throw err.notFound('deal_not_found');
    }
    return deal;
  }

  private confirmed(deal: DealDoc) {
    return {
      dealId: String(deal._id),
      type: 'confirmed',
      confirmedAt: deal.confirmedAt ? deal.confirmedAt.toISOString() : null,
    };
  }

  async confirm(buyerId: string, dealId: string) {
    const deal = await this.requireBuyerDeal(buyerId, dealId);

    // Confirmation is only meaningful for the chat flow; direct sales are
    // never part of the confirmed-deal KPI.
    if (deal.type === 'direct') throw err.conflict('deal_not_confirmable');
    if (deal.confirmedAt) return this.confirmed(deal);
    if (deal.disputeRef) throw err.conflict('deal_disputed');

    const now = new Date();
    if (!deal.expiresAt || now.getTime() > deal.expiresAt.getTime()) {
      throw err.conflict('deal_confirm_window_expired');
    }

    // Same anti-gaming rule as mark-sold: a real conversation must exist.
    const thread = (await this.repos.threads.findOne({
      listingId: deal.listingId,
      buyerId: deal.buyerId,
    } as never)) as unknown as ThreadDoc | null;
    if (!thread || (thread.buyerMsgCount ?? 0) < 1) {
      throw err.businessRule('buyer_message_required');
    }

    const updated = (await this.repos.deals.findOneAndUpdate(
      {
        _id: deal._id,
        type: 'unconfirmed',
        confirmedAt: null,
        disputeRef: null,
      } as never,
      { $set: { type: 'confirmed', confirmedAt: now } } as never,
    )) as unknown as DealDoc | null;

    if (!updated) {
      // A concurrent confirm wins; surface it idempotently instead of 409.
      const current = (await this.repos.deals.findById(dealId)) as unknown as DealDoc | null;
      if (current?.confirmedAt) return this.confirmed(current);
      throw err.conflict('deal_state_changed');
    }

    await this.repos.listings.updateOne(
      { _id: deal.listingId, status: 'pendingConfirm' } as never,
      { $set: { status: 'sold' }, $inc: { version: 1 } } as never,
    );
    await this.repos.threads.updateOne(
      { _id: thread._id, state: 'active' } as never,
      { $set: { state: 'soldBanner' } } as never,
    );
    await this.repos.users.updateOne(
      { _id: deal.sellerId } as never,
      { $inc: { 'profile.sellerStats.confirmedDeals': 1 } } as never,
    );

    await appendAudit(this.repos, {
      actor: 'user',
      actorId: buyerId,
      action: 'deal.confirmed',
      entityType: 'deals',
      entityId: String(deal._id),
      after: {
        type: 'confirmed',
        confirmedAt: now.toISOString(),
        listingId: String(deal.listingId),
      },
    });

    await this.deps.notifications.emit({
      userId: String(deal.sellerId),
      event: 'deal.confirmed',
      payload: { dealId: String(deal._id) },
      dedupeKey: `deal.confirmed:${String(deal._id)}`,
    });

    return this.confirmed(updated);
  }

  async decline(buyerId: string, dealId: string, input: DeclineDealInput) {
    const deal = await this.requireBuyerDeal(buyerId, dealId);

    if (deal.type === 'direct') throw err.conflict('deal_not_confirmable');
    if (deal.confirmedAt) throw err.conflict('deal_already_confirmed');
    if (deal.disputeRef) {
      // Retry-safe: the same dispute is returned, never duplicated.
      return this.disputed(deal, deal.disputeRef);
    }

    const now = new Date();
    const caseId = new Types.ObjectId();
    await this.repos.moderationCases.insert({
      _id: caseId,
      source: 'dispute',
      refId: deal._id,
      status: 'open',
      slaDue: new Date(now.getTime() + CASE_SLA_MS),
      snapshot: {
        dealId: String(deal._id),
        listingId: String(deal.listingId),
        sellerId: String(deal.sellerId),
        buyerId: String(deal.buyerId),
        type: deal.type,
        channel: deal.channel,
        reason: input.reason,
        markedSoldAt: deal.markedSoldAt ?? null,
        expiresAt: deal.expiresAt ?? null,
      },
    } as never);

    const linked = (await this.repos.deals.findOneAndUpdate(
      { _id: deal._id, confirmedAt: null, disputeRef: null } as never,
      { $set: { disputeRef: caseId } } as never,
    )) as unknown as DealDoc | null;
    if (!linked) {
      const current = (await this.repos.deals.findById(dealId)) as unknown as DealDoc | null;
      if (current?.disputeRef) return this.disputed(current, current.disputeRef);
      throw err.conflict('deal_state_changed');
    }

    const seller = (await this.repos.users.findOneAndUpdate(
      { _id: deal.sellerId } as never,
      { $inc: { 'profile.sellerStats.disputes90d': 1 } } as never,
    )) as unknown as SellerDoc | null;
    const disputes90d = seller?.profile?.sellerStats?.disputes90d ?? 1;

    await appendAudit(this.repos, {
      actor: 'user',
      actorId: buyerId,
      action: 'deal.disputed',
      entityType: 'deals',
      entityId: String(deal._id),
      after: { caseId: String(caseId), reason: input.reason, sellerDisputes90d: disputes90d },
    });

    if (disputes90d >= DISPUTE_FLAG_THRESHOLD) {
      await this.repos.users.updateOne(
        { _id: deal.sellerId } as never,
        {
          $push: {
            'enforcement.history': {
              action: 'auto_flag',
              reasonCode: 'DISPUTE_THRESHOLD',
              at: now,
            },
          },
        } as never,
      );
      await appendAudit(this.repos, {
        actor: 'system',
        action: 'seller.auto_flagged',
        entityType: 'users',
        entityId: String(deal.sellerId),
        after: { disputes90d, threshold: DISPUTE_FLAG_THRESHOLD },
      });
      await this.deps.notifications.notifyOps({
        event: 'ops.seller_auto_flagged',
        payload: { sellerId: String(deal.sellerId), disputes90d },
        dedupeKey: `ops.seller_auto_flagged:${String(deal.sellerId)}:${now.toISOString().slice(0, 10)}`,
      });
    }

    await this.deps.notifications.emit({
      userId: String(deal.sellerId),
      event: 'deal.declined',
      payload: { dealId: String(deal._id) },
      dedupeKey: `deal.declined:${String(deal._id)}`,
    });

    return {
      dealId: String(deal._id),
      disputeRef: String(caseId),
      sellerDisputes90d: disputes90d,
    };
  }

  private disputed(deal: DealDoc, disputeRef: Types.ObjectId) {
    return {
      dealId: String(deal._id),
      disputeRef: String(disputeRef),
      sellerDisputes90d: null,
    };
  }
}
