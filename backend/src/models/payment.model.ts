import { Schema } from 'mongoose';

export const PAYMENT_PROVIDERS = ['bkash', 'nagad'] as const;
export const PAYMENT_STATES = ['initiated', 'pending', 'success', 'failed', 'expired'] as const;

/** `payments` — monotonic state machine, idempotencyKey unique (PRD §3.4.5). */
export const paymentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    packageId: { type: String, required: true },
    listingId: { type: Schema.Types.ObjectId, ref: 'Listing', required: true },
    amount: { type: Number, required: true, min: 0 },
    creditApplied: { type: Number, default: 0, min: 0 },
    provider: { type: String, enum: PAYMENT_PROVIDERS, required: true },
    state: { type: String, enum: PAYMENT_STATES, default: 'initiated' },
    idempotencyKey: { type: String, required: true, unique: true },
    gatewayUrl: { type: String, default: null },
    failureReason: { type: String, default: null },
    paidAt: { type: Date, default: null },
    /** Human receipt number `TB-YYYYMM-<seq>`; unique when present. */
    receiptNo: { type: String },
    gatewayRefs: {
      paymentId: String,
      trxId: String,
      webhookEventIds: { type: [String], default: [] },
    },
    receipt: { pdfKey: String, vat: Number, issuedAt: Date },
  },
  { timestamps: true, autoIndex: false },
);

/**
 * `webhookEvents` — raw gateway callbacks archived before processing.
 * Unique (gateway, eventId) makes duplicate delivery a no-op (API §0.5).
 */
export const webhookEventSchema = new Schema(
  {
    gateway: { type: String, enum: PAYMENT_PROVIDERS, required: true },
    eventId: { type: String, required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    signatureOk: { type: Boolean, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    receivedAt: { type: Date, default: Date.now },
    processedAt: { type: Date, default: null },
    processError: { type: String, default: null },
  },
  { timestamps: { createdAt: false, updatedAt: false }, autoIndex: false },
);

/**
 * `idempotencyKeys` — `_id` IS the client key (no separate unique index);
 * TTL 24 h. Matches the middleware store in middleware/idempotency.ts.
 */
export const idempotencyKeySchema = new Schema(
  {
    _id: { type: String },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    endpoint: String,
    payloadHash: { type: String, required: true },
    status: { type: Number, required: true },
    body: { type: Schema.Types.Mixed },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, autoIndex: false },
);

/** `credits` — boost credit ledger, 12-month expiry (PRD §3.3.9). */
export const creditSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 1 },
    remaining: { type: Number, required: true, min: 0 },
    source: {
      type: String,
      enum: ['reconciliation', 'appeal', 'goodwill'],
      required: true,
    },
    reason: String,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, autoIndex: false },
);
