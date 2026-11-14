import { Schema } from 'mongoose';

export const LISTING_CONDITIONS = ['new', 'likeNew', 'good', 'refurbished', 'forParts'] as const;
export const LISTING_STATUSES = [
  'draft',
  'active',
  'pendingConfirm',
  'sold',
  'expired',
  'delisted',
  'archived',
] as const;

/** `listings` — ad content, lifecycle, boost state, counter cache (PRD §3.3). */
export const listingSchema = new Schema(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    title: { type: String, required: true, minlength: 10, maxlength: 100 },
    description: { type: String, required: true, minlength: 20, maxlength: 5000 },
    price: { type: Number, required: true, min: 1, max: 99_999_999 },
    condition: { type: String, enum: LISTING_CONDITIONS, required: true },
    mediaIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'MediaObject' }],
      validate: {
        validator: (ids: unknown[]) => ids.length >= 1 && ids.length <= 10,
        message: 'mediaIds must contain 1–10 entries',
      },
    },
    pHashes: { type: [String], default: [] },
    location: {
      district: { type: String, required: true },
      geo: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], required: true },
      },
    },
    status: { type: String, enum: LISTING_STATUSES, default: 'draft' },
    boost: {
      active: { type: Boolean, default: false },
      packageId: { type: String, default: null },
      until: Date,
      pausedAt: Date,
      remainingMs: Number,
    },
    priceFlags: { tooLow: Boolean, tooHigh: Boolean },
    stats: {
      views: { type: Number, default: 0 },
      chatStarts: { type: Number, default: 0 },
      callTaps: { type: Number, default: 0 },
      favorites: { type: Number, default: 0 },
    },
    expiresAt: Date,
    version: { type: Number, default: 0 },
    aiScan: {
      status: { type: String, enum: ['queued', 'clean', 'flagged'], default: 'queued' },
      flags: { type: [String], default: [] },
    },
  },
  { timestamps: true, autoIndex: false },
);
// NB: no `optimisticConcurrency` — the app owns the custom `version` field.

/** `categories` — seeded taxonomy, districts list, manual price baselines. */
export const categorySchema = new Schema(
  {
    name: {
      bn: { type: String, required: true },
      en: { type: String, required: true },
    },
    slug: { type: String, required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    priceBaseline: {
      p25: Number,
      p50: Number,
      p75: Number,
    },
    districts: { type: [String], default: [] },
  },
  { timestamps: true, autoIndex: false },
);

/** `boostPackages` — server-managed catalog (never hard-coded in clients). */
export const boostPackageSchema = new Schema(
  {
    _id: { type: String },
    name: { type: String, required: true },
    durationDays: { type: Number, required: true, min: 1 },
    priceBdt: { type: Number, required: true, min: 1 },
    placement: { type: String, enum: ['category', 'search', 'home'], default: 'category' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, autoIndex: false },
);

/** `mediaObjects` — every upload: owner, purpose, lifecycle, scan state (NFR-13). */
export const mediaObjectSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: ['kyc', 'listing', 'profile'], required: true },
    r2Key: { type: String, required: true },
    sha256: String,
    pHash: String,
    contentType: String,
    scanProvider: String,
    scanReason: String,
    status: {
      type: String,
      enum: ['uploaded', 'scanning', 'clean', 'quarantined'],
      default: 'uploaded',
    },
    sizeBytes: Number,
    width: Number,
    height: Number,
  },
  { timestamps: true, autoIndex: false },
);
