import { Schema } from 'mongoose';

export const THREAD_STATES = [
  'active',
  'soldBanner',
  'buyerBlocked',
  'sellerBlocked',
  'deletedListing',
  'archived',
  'frozen',
] as const;

/** `threads` — listing-scoped conversation, one per (listing, buyer). */
export const threadSchema = new Schema(
  {
    listingId: { type: Schema.Types.ObjectId, ref: 'Listing', required: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    state: { type: String, enum: THREAD_STATES, default: 'active' },
    /** Anti-gaming: confirmed deal requires ≥ 1 buyer message (PRD §3.3.13). */
    buyerMsgCount: { type: Number, default: 0, min: 0 },
    lastMessageAt: Date,
  },
  { timestamps: true, autoIndex: false },
);

/** `messages` — retry-safe via (threadId, clientMsgId) unique index. */
export const messageSchema = new Schema(
  {
    threadId: { type: Schema.Types.ObjectId, ref: 'Thread', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, minlength: 1, maxlength: 2000 },
    clientMsgId: { type: String, required: true },
    flags: { type: [String], default: [] },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, autoIndex: false },
);

export const OFFER_STATUSES = ['pending', 'accepted', 'rejected', 'expired'] as const;

/** `offers` — 48 h TTL state machine; one pending offer per buyer per listing. */
export const offerSchema = new Schema(
  {
    threadId: { type: Schema.Types.ObjectId, ref: 'Thread', required: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Denormalized so the one-pending-offer partial unique index works. */
    listingId: { type: Schema.Types.ObjectId, ref: 'Listing', required: true },
    amount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: OFFER_STATUSES, default: 'pending' },
    /** Seller's counter amount when `status === 'countered'` (API §5.9). */
    counterAmount: { type: Number, default: null, min: 1 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, autoIndex: false },
);
