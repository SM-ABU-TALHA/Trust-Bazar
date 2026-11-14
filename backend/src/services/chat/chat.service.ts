import { Types } from 'mongoose';
import { LIMITS, type MessageFlag } from '@trust/shared/constants';
import {
  createOfferSchema,
  type BlockThreadInput,
  type MessageListQuery,
  type OfferAmountInput,
  type RespondOfferInput,
  type SendMessageInput,
  type ThreadReportInput,
} from '@trust/shared/schemas';
import { err } from '../../lib/errors.js';
import type { KvStore } from '../../lib/kv.js';
import type { Repositories } from '../../repositories/index.js';
import { appendAudit } from '../audit/audit.service.js';

const UNDO_REVEAL_TTL_SEC = 2 * 86_400;
const MODERATION_SLA_MS = 24 * 60 * 60 * 1000;
const TRANSCRIPT_LIMIT = 100;

interface ThreadDoc {
  _id: Types.ObjectId;
  listingId: Types.ObjectId;
  buyerId: Types.ObjectId;
  sellerId: Types.ObjectId;
  state: string;
  buyerMsgCount?: number;
  lastMessageAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface MessageDoc {
  _id: Types.ObjectId;
  threadId: Types.ObjectId;
  senderId: Types.ObjectId;
  body: string;
  clientMsgId: string;
  flags?: string[];
  readAt?: Date | null;
  createdAt?: Date;
}

interface OfferDoc {
  _id: Types.ObjectId;
  threadId: Types.ObjectId;
  buyerId: Types.ObjectId;
  listingId: Types.ObjectId;
  amount: number;
  status: string;
  counterAmount?: number | null;
  expiresAt: Date;
  createdAt?: Date;
}

interface ListingDoc {
  _id: Types.ObjectId;
  sellerId: Types.ObjectId;
  title?: string;
  price?: number;
  status?: string;
  stats?: { chatStarts?: number; callTaps?: number };
}

interface UserDoc {
  _id: Types.ObjectId;
  phone?: string;
  roles?: string[];
  sellerPrefs?: { showPhonePublic?: boolean };
  profile?: { displayName?: string; photoMediaId?: Types.ObjectId | null };
  enforcement?: { state?: string };
  deletedAt?: Date | null;
}

export interface ChatServiceDeps {
  repos: Repositories;
  kv: KvStore;
}

/**
 * Chat & offers domain logic (API_spec §5). Every read/write goes through
 * `getParticipantThread`, so a stranger always gets the same 404 as a
 * missing thread (IDOR-safe).
 */
export class ChatService {
  constructor(private readonly deps: ChatServiceDeps) {}

  // ── Threads ──────────────────────────────────────────────────────────────

  async createThread(buyerId: string, listingId: string) {
    const { repos } = this.deps;
    const listing = (await repos.listings.findById(listingId)) as ListingDoc | null;
    if (!listing) throw err.notFound('listing_not_found');
    if (listing.status !== 'active') throw err.forbidden('listing_not_chat_available');
    if (listing.sellerId.toString() === buyerId) throw err.businessRule('cannot_chat_own_listing');

    const seller = (await repos.users.findById(listing.sellerId.toString())) as UserDoc | null;
    if (!seller || seller.deletedAt) throw err.forbidden('seller_unavailable');

    const sellerState = seller.enforcement?.state ?? 'none';
    if (sellerState === 'suspended') throw err.forbidden('seller_suspended');
    const banned = sellerState === 'banned';

    const buyerObjectId = new Types.ObjectId(buyerId);
    const filter = { listingId: listing._id, buyerId: buyerObjectId };
    const existing = (await repos.threads.findOne(filter as never)) as ThreadDoc | null;

    if (existing) {
      if (banned && existing.state !== 'frozen') {
        await repos.threads.updateOne({ _id: existing._id } as never, {
          $set: { state: 'frozen' },
        } as never);
        existing.state = 'frozen';
      }
      return { threadId: existing._id.toString(), state: existing.state };
    }

    const result = await repos.threads.raw.updateOne(
      filter,
      {
        $setOnInsert: {
          listingId: listing._id,
          buyerId: buyerObjectId,
          sellerId: listing.sellerId,
          state: banned ? 'frozen' : 'active',
          buyerMsgCount: 0,
          lastMessageAt: null,
        },
      },
      { upsert: true },
    );
    const thread = (await repos.threads.findOne(filter as never)) as ThreadDoc | null;
    if (!thread) throw err.notFound('thread_not_found');

    if (result.upsertedCount > 0) {
      await repos.listings.updateOne(
        { _id: listing._id } as never,
        { $inc: { 'stats.chatStarts': 1 } } as never,
      );
      await appendAudit(repos, {
        actor: 'user',
        actorId: buyerId,
        action: 'chat.threadCreated',
        entityType: 'threads',
        entityId: thread._id.toString(),
        after: { listingId, state: thread.state },
      });
    }

    return { threadId: thread._id.toString(), state: thread.state };
  }

  async listThreads(userId: string) {
    const { repos } = this.deps;
    const uid = new Types.ObjectId(userId);
    const threads = (await repos.threads.find(
      { $or: [{ buyerId: uid }, { sellerId: uid }] } as never,
      { sort: { lastMessageAt: -1, createdAt: -1 }, limit: 50 },
    )) as unknown as ThreadDoc[];
    if (threads.length === 0) return [];

    const threadIds = threads.map((thread) => thread._id);
    const listingIds = [...new Set(threads.map((thread) => thread.listingId.toString()))].map(
      (id) => new Types.ObjectId(id),
    );
    const otherIds = [
      ...new Set(
        threads.map((thread) =>
          (thread.buyerId.equals(uid) ? thread.sellerId : thread.buyerId).toString(),
        ),
      ),
    ].map((id) => new Types.ObjectId(id));

    const [lastRows, unreadRows, listings, users] = await Promise.all([
      repos.messages.aggregate<{ _id: Types.ObjectId; doc: MessageDoc }>([
        { $match: { threadId: { $in: threadIds } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$threadId', doc: { $first: '$$ROOT' } } },
      ]),
      repos.messages.aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            threadId: { $in: threadIds },
            senderId: { $ne: uid },
            readAt: null,
          },
        },
        { $group: { _id: '$threadId', count: { $sum: 1 } } },
      ]),
      repos.listings.find({ _id: { $in: listingIds } } as never) as unknown as Promise<
        ListingDoc[]
      >,
      repos.users.find({ _id: { $in: otherIds } } as never) as unknown as Promise<UserDoc[]>,
    ]);

    const lastByThread = new Map(lastRows.map((row) => [row._id.toString(), row.doc]));
    const unreadByThread = new Map(unreadRows.map((row) => [row._id.toString(), row.count]));
    const listingById = new Map(listings.map((listing) => [listing._id.toString(), listing]));
    const userById = new Map(users.map((user) => [user._id.toString(), user]));

    return threads.map((thread) => {
      const listing = listingById.get(thread.listingId.toString());
      const iAmBuyer = thread.buyerId.equals(uid);
      const otherId = (iAmBuyer ? thread.sellerId : thread.buyerId).toString();
      const other = userById.get(otherId);
      const last = lastByThread.get(thread._id.toString());

      return {
        id: thread._id.toString(),
        listingId: thread.listingId.toString(),
        listing: listing
          ? {
              id: listing._id.toString(),
              title: listing.title ?? '',
              price: listing.price ?? 0,
              status: listing.status ?? 'active',
            }
          : null,
        otherParty: {
          id: otherId,
          displayName: other?.profile?.displayName ?? null,
          photoMediaId: other?.profile?.photoMediaId?.toString() ?? null,
        },
        lastMessage: last
          ? {
              body: last.body,
              senderId: last.senderId.toString(),
              createdAt: last.createdAt?.toISOString() ?? null,
            }
          : null,
        unread: unreadByThread.get(thread._id.toString()) ?? 0,
        state: thread.state,
        createdAt: thread.createdAt?.toISOString() ?? null,
        updatedAt: thread.updatedAt?.toISOString() ?? null,
      };
    });
  }

  // ── Messages ─────────────────────────────────────────────────────────────

  async sendMessage(userId: string, threadId: string, input: SendMessageInput) {
    const thread = await this.getParticipantThread(userId, threadId);
    assertSendable(thread);

    const uid = new Types.ObjectId(userId);
    const existing = (await this.deps.repos.messages.findOne({
      threadId: thread._id,
      clientMsgId: input.clientMsgId,
    } as never)) as MessageDoc | null;
    if (existing) return { ...toMessageView(existing), replayed: true };

    const flags = scanMessageFlags(input.body);
    const now = new Date();

    let message: MessageDoc;
    try {
      message = (await this.deps.repos.messages.insert({
        threadId: thread._id,
        senderId: uid,
        body: input.body,
        clientMsgId: input.clientMsgId,
        flags,
        readAt: null,
        createdAt: now,
      } as never)) as unknown as MessageDoc;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const raced = (await this.deps.repos.messages.findOne({
          threadId: thread._id,
          clientMsgId: input.clientMsgId,
        } as never)) as MessageDoc | null;
        if (raced) return { ...toMessageView(raced), replayed: true };
      }
      throw error;
    }

    const isBuyer = thread.buyerId.equals(uid);
    await this.deps.repos.threads.updateOne(
      { _id: thread._id } as never,
      {
        $set: { lastMessageAt: now },
        ...(isBuyer ? { $inc: { buyerMsgCount: 1 } } : {}),
      } as never,
    );

    return { ...toMessageView(message), replayed: false };
  }

  async listMessages(userId: string, threadId: string, query: MessageListQuery) {
    const thread = await this.getParticipantThread(userId, threadId);
    const { repos } = this.deps;

    const filter: Record<string, unknown> = { threadId: thread._id };
    // ObjectId is globally monotonic, so it is a stable cursor even when two
    // messages share the same millisecond timestamp.
    if (query.before) filter._id = { $lt: new Types.ObjectId(query.before) };

    const rows = (await repos.messages.find(filter as never, {
      sort: { _id: -1 },
      limit: query.limit + 1,
    })) as unknown as MessageDoc[];

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    page.reverse(); // chronological for the client

    const uid = new Types.ObjectId(userId);
    await repos.messages.raw.updateMany(
      { threadId: thread._id, senderId: { $ne: uid }, readAt: null },
      { $set: { readAt: new Date() } },
    );

    return {
      items: page.map((message) => toMessageView(message)),
      nextCursor: hasMore && page.length > 0 ? (page[0]?._id.toString() ?? null) : null,
    };
  }

  // ── Phone reveal ─────────────────────────────────────────────────────────

  async revealPhone(buyerId: string, threadId: string) {
    const { repos, kv } = this.deps;
    const thread = await this.getParticipantThread(buyerId, threadId);
    if (!thread.buyerId.equals(new Types.ObjectId(buyerId))) throw err.forbidden('buyer_only');
    if (!['active', 'soldBanner'].includes(thread.state)) throw err.conflict(thread.state);

    const seller = (await repos.users.findById(thread.sellerId.toString())) as UserDoc | null;
    if (!seller) throw err.notFound('seller_not_found');
    if (seller.sellerPrefs?.showPhonePublic === false) throw err.businessRule('phone_hidden');

    const key = `reveal:${buyerId}:${todayDhaka()}`;
    const revealCountToday = await kv.incr(key, UNDO_REVEAL_TTL_SEC);
    if (revealCountToday > LIMITS.chat.revealDailyCap) {
      throw err.businessRule('reveal_cap_exceeded');
    }

    await repos.listings.updateOne(
      { _id: thread.listingId } as never,
      { $inc: { 'stats.callTaps': 1 } } as never,
    );
    await appendAudit(repos, {
      actor: 'user',
      actorId: buyerId,
      action: 'chat.phoneRevealed',
      entityType: 'threads',
      entityId: thread._id.toString(),
      after: { revealCountToday },
    });

    return { phone: seller.phone ?? null, revealCountToday };
  }

  // ── Block / report ───────────────────────────────────────────────────────

  async blockThread(userId: string, threadId: string, input: BlockThreadInput): Promise<void> {
    const { repos } = this.deps;
    const thread = await this.getParticipantThread(userId, threadId);
    const uid = new Types.ObjectId(userId);
    const side = thread.buyerId.equals(uid) ? 'buyer' : 'seller';

    if (input.side && input.side !== side) throw err.forbidden('side_mismatch');
    if (['archived', 'frozen', 'deletedListing', 'soldBanner'].includes(thread.state)) {
      throw err.conflict(thread.state);
    }

    const state = side === 'buyer' ? 'buyerBlocked' : 'sellerBlocked';
    await repos.threads.updateOne({ _id: thread._id } as never, { $set: { state } } as never);
    await appendAudit(repos, {
      actor: 'user',
      actorId: userId,
      action: 'chat.blocked',
      entityType: 'threads',
      entityId: thread._id.toString(),
      after: { state },
    });
  }

  async reportThread(userId: string, threadId: string, input: ThreadReportInput) {
    const { repos } = this.deps;
    const thread = await this.getParticipantThread(userId, threadId);
    const uid = new Types.ObjectId(userId);
    const otherId = thread.buyerId.equals(uid) ? thread.sellerId : thread.buyerId;

    const rows = (await repos.messages.find(
      { threadId: thread._id } as never,
      { sort: { createdAt: -1 }, limit: TRANSCRIPT_LIMIT },
    )) as unknown as MessageDoc[];
    const transcript = rows.reverse().map((message) => ({
      senderId: message.senderId.toString(),
      body: message.body,
      createdAt: message.createdAt?.toISOString() ?? null,
    }));

    const report = (await repos.reports.insert({
      reporterId: uid,
      targetType: 'user',
      targetId: otherId,
      category: input.category,
      details: input.comment?.trim() || 'conversation report',
      status: 'open',
    } as never)) as unknown as { _id: Types.ObjectId };

    await repos.moderationCases.insert({
      source: 'report',
      refId: report._id,
      status: 'open',
      slaDue: new Date(Date.now() + MODERATION_SLA_MS),
      snapshot: { threadId: thread._id.toString(), state: thread.state, messages: transcript },
    } as never);

    await appendAudit(repos, {
      actor: 'user',
      actorId: userId,
      action: 'chat.reported',
      entityType: 'reports',
      entityId: report._id.toString(),
      after: { threadId, category: input.category },
    });

    return { reportId: report._id.toString() };
  }

  // ── Offers ───────────────────────────────────────────────────────────────

  async createOffer(buyerId: string, threadId: string, input: OfferAmountInput) {
    const { repos } = this.deps;
    const thread = await this.getParticipantThread(buyerId, threadId);
    if (!thread.buyerId.equals(new Types.ObjectId(buyerId))) throw err.forbidden('buyer_only');
    if (thread.state !== 'active') throw err.conflict(thread.state);

    const listing = (await repos.listings.findById(thread.listingId.toString())) as ListingDoc | null;
    if (!listing) throw err.notFound('listing_not_found');
    if (listing.status !== 'active') throw err.conflict('listing_not_available');

    const parsed = createOfferSchema(listing.price ?? 0).safeParse({ amount: input.amount });
    if (!parsed.success) {
      throw err.validation(
        parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'amount',
          code: issue.code,
          message: issue.message,
        })),
      );
    }

    const pending = await repos.offers.findOne({
      buyerId: new Types.ObjectId(buyerId),
      listingId: listing._id,
      status: 'pending',
    } as never);
    if (pending) throw err.conflict('offer_pending_exists');

    const expiresAt = new Date(Date.now() + LIMITS.offer.ttlHours * 3_600_000);
    let offer: OfferDoc;
    try {
      offer = (await repos.offers.insert({
        threadId: thread._id,
        buyerId: new Types.ObjectId(buyerId),
        listingId: listing._id,
        amount: input.amount,
        status: 'pending',
        counterAmount: null,
        expiresAt,
      } as never)) as unknown as OfferDoc;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw err.conflict('offer_pending_exists');
      throw error;
    }

    await appendAudit(repos, {
      actor: 'user',
      actorId: buyerId,
      action: 'offer.created',
      entityType: 'offers',
      entityId: offer._id.toString(),
      after: { amount: input.amount, listingId: listing._id.toString() },
    });

    return {
      offerId: offer._id.toString(),
      status: 'pending',
      expiresAt: expiresAt.toISOString(),
    };
  }

  async respondOffer(sellerId: string, offerId: string, input: RespondOfferInput) {
    const { repos } = this.deps;
    const offer = (await repos.offers.findById(offerId)) as OfferDoc | null;
    if (!offer) throw err.notFound('offer_not_found');

    const thread = (await repos.threads.findById(offer.threadId.toString())) as ThreadDoc | null;
    if (!thread || !thread.sellerId.equals(new Types.ObjectId(sellerId))) {
      throw err.notFound('offer_not_found');
    }
    if (offer.status !== 'pending') throw err.conflict('offer_not_pending');
    if (offer.expiresAt.getTime() <= Date.now()) {
      await repos.offers.updateOne({ _id: offer._id } as never, {
        $set: { status: 'expired' },
      } as never);
      throw err.conflict('offer_expired');
    }

    let status: string = 'accepted';
    let counterAmount: number | null = null;

    if (input.action === 'decline' || input.action === 'reject') {
      status = 'declined';
    } else if (input.action === 'counter') {
      const listing = (await repos.listings.findById(offer.listingId.toString())) as ListingDoc | null;
      const max = (listing?.price ?? 0) * LIMITS.offer.maxPriceMultiplier;
      if (!input.counterAmount || input.counterAmount > max) {
        throw err.validation([
          { field: 'counterAmount', code: 'custom', message: 'amount_too_high' },
        ]);
      }
      status = 'countered';
      counterAmount = input.counterAmount;
    }

    await repos.offers.updateOne({ _id: offer._id } as never, {
      $set: { status, counterAmount },
    } as never);
    await appendAudit(repos, {
      actor: 'user',
      actorId: sellerId,
      action: 'offer.responded',
      entityType: 'offers',
      entityId: offer._id.toString(),
      after: { status, counterAmount },
    });

    return { status, counterAmount };
  }

  // ── Shared guard ─────────────────────────────────────────────────────────

  async getParticipantThread(userId: string, threadId: string): Promise<ThreadDoc> {
    const thread = (await this.deps.repos.threads.findById(threadId)) as ThreadDoc | null;
    const uid = new Types.ObjectId(userId);
    if (!thread || (!thread.buyerId.equals(uid) && !thread.sellerId.equals(uid))) {
      throw err.notFound('thread_not_found');
    }
    return thread;
  }
}

/** Thread state gate — frozen is enforcement, the rest are plain conflicts. */
function assertSendable(thread: ThreadDoc): void {
  if (thread.state === 'active') return;
  if (thread.state === 'frozen') throw err.enforcementBlocked('frozen');
  throw err.conflict(thread.state);
}

function toMessageView(message: MessageDoc) {
  return {
    id: message._id.toString(),
    senderId: message.senderId.toString(),
    body: message.body,
    clientMsgId: message.clientMsgId,
    flags: message.flags ?? [],
    readAt: message.readAt?.toISOString() ?? null,
    createdAt: message.createdAt?.toISOString() ?? null,
  };
}

/** Off-platform / URL nudges (PRD §3.2.4). Never blocks the send. */
export function scanMessageFlags(body: string): MessageFlag[] {
  const flags = new Set<MessageFlag>();
  const compact = body.replace(/[\s-]/g, '');
  if (/(?:\+?880|0)1[3-9]\d{8}/.test(compact)) flags.add('offPlatformWarn');
  if (/\b(whats\s?app|imo|telegram|viber|messenger|facebook|fb)\b/i.test(body)) {
    flags.add('offPlatformWarn');
  }
  if (/(?:https?:\/\/|www\.)\S+/i.test(body)) flags.add('urlWarn');
  return [...flags];
}

/** Asia/Dhaka calendar day (reveal quota resets at local midnight). */
function todayDhaka(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
}
