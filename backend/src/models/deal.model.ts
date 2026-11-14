import { Schema } from 'mongoose';

export const DEAL_TYPES = ['confirmed', 'direct', 'unconfirmed'] as const;
export const DEAL_CHANNELS = ['chat', 'phone', 'inPerson'] as const;

/**
 * `deals` — one per listing. `confirmed` is the only KPI denominator
 * (PRD §1.5). `direct` = seller closed off-platform (buyerId null).
 */
export const dealSchema = new Schema(
  {
    listingId: { type: Schema.Types.ObjectId, ref: 'Listing', required: true, unique: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    type: { type: String, enum: DEAL_TYPES, required: true },
    channel: { type: String, enum: DEAL_CHANNELS, required: true },
    markedSoldAt: Date,
    confirmedAt: Date,
    /** Buyer confirmation window: 7 days, reminder on day 3. */
    expiresAt: Date,
    disputeRef: { type: Schema.Types.ObjectId, ref: 'ModerationCase', default: null },
    /** 15-minute undo, void once the buyer responds (PRD §3.3.6). */
    undoUntil: { type: Date, default: null },
  },
  { timestamps: true, autoIndex: false },
);
