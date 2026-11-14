import { Schema } from 'mongoose';

/** `notifications` — durable in-app records + delivery state (PRD Appx D). */
export const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    channels: {
      type: [String],
      enum: ['inApp', 'push', 'sms', 'ops'],
      default: ['inApp'],
    },
    status: {
      type: String,
      enum: ['queued', 'sent', 'failed'],
      default: 'queued',
    },
    /** Idempotency + coalescing key (unique sparse index). */
    dedupeKey: { type: String },
    /** Coalesced event count (chat per thread, digests). */
    count: { type: Number, default: 1, min: 1 },
    lastAt: { type: Date, default: Date.now },
    readAt: { type: Date, default: null },
  },
  { timestamps: true, autoIndex: false },
);

/** `favorites` — saved listings, unique per user+listing. */
export const favoriteSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    listingId: { type: Schema.Types.ObjectId, ref: 'Listing', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, autoIndex: false },
);

/** `savedSearches` — alert preferences per stored query. */
export const savedSearchSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    query: { type: String, required: true },
    filters: { type: Schema.Types.Mixed, default: {} },
    frequency: { type: String, enum: ['instant', 'daily'], default: 'daily' },
    lastNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true, autoIndex: false },
);

/** `operatorAccounts` — staff with 2FA + IP allowlist. Never self-signup. */
export const operatorAccountSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    role: {
      type: String,
      enum: ['kycReviewer', 'moderator', 'seniorModerator', 'superadmin'],
      required: true,
    },
    totpSecretEnc: { type: String, required: true },
    ipAllowlist: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, autoIndex: false },
);

/** `config` — `_id` is the key: minVersion, featureFlags, geoLaunch, consentVersion. */
export const configSchema = new Schema(
  {
    _id: { type: String },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'OperatorAccount', default: null },
  },
  { timestamps: true, autoIndex: false },
);
