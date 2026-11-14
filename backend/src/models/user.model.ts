import { Schema } from 'mongoose';

const SESSION_LIMIT = 3;

const sessionSchema = new Schema(
  {
    id: { type: String, required: true },
    deviceIdHash: { type: String, required: true },
    platform: { type: String, enum: ['web', 'android', 'ios'], required: true },
    refreshTokenHash: { type: String, required: true },
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, required: true },
  },
  { _id: false },
);

/** `users` — identity anchor + encrypted PII + sessions + enforcement (PRD §3.1). */
export const userSchema = new Schema(
  {
    phone: { type: String, required: true, unique: true, match: /^\+8801[3-9]\d{8}$/ },
    roles: {
      type: [String],
      enum: ['buyer', 'verifiedBuyer', 'seller'],
      default: ['buyer'],
    },
    nidHash: { type: String, unique: true, sparse: true },
    nidEnc: String,
    nameEnc: String,
    dobEnc: String,
    profile: {
      displayName: { type: String, minlength: 2, maxlength: 50 },
      photoMediaId: { type: Schema.Types.ObjectId, ref: 'MediaObject' },
      memberSince: { type: Date, default: Date.now },
      sellerStats: {
        activeListings: { type: Number, default: 0 },
        confirmedDeals: { type: Number, default: 0 },
        disputes90d: { type: Number, default: 0 },
      },
    },
    sellerPrefs: { showPhonePublic: { type: Boolean, default: true } },
    notificationPrefs: {
      push: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      digest: { type: Boolean, default: false },
      lang: { type: String, enum: ['bn', 'en'], default: 'bn' },
    },
    enforcement: {
      state: {
        type: String,
        enum: ['none', 'warned', 'suspended', 'banned'],
        default: 'none',
      },
      until: Date,
      reasonCode: String,
      history: [
        {
          _id: false,
          action: String,
          reasonCode: String,
          by: Schema.Types.ObjectId,
          at: { type: Date, default: Date.now },
        },
      ],
    },
    sessions: {
      type: [sessionSchema],
      default: [],
      validate: {
        validator: (sessions: unknown[]) => sessions.length <= SESSION_LIMIT,
        message: `sessions must contain at most ${SESSION_LIMIT} entries`,
      },
    },
    /** FCM/APNs push tokens registered by clients (PROMPT 15). */
    pushTokens: {
      type: [
        new Schema(
          {
            token: { type: String, required: true },
            platform: { type: String, enum: ['fcm', 'apns'], required: true },
            at: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    deletedAt: Date,
    purgeAt: Date,
  },
  { timestamps: true, autoIndex: false },
);

/** `consents` — versioned consent records (NFR-05). */
export const consentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    doc: { type: String, enum: ['kyc', 'privacy', 'deletion'], required: true },
    version: { type: String, required: true },
    grantedAt: { type: Date, default: Date.now },
    ip: String,
  },
  { timestamps: true, autoIndex: false },
);

/** `securityEvents` — new-device, step-up, refresh-reuse, brute-force (PRD §3.4.2). */
export const securityEventSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: [
        'newDevice',
        'stepUp',
        'refreshReuse',
        'bruteForce',
        'recovery',
        'phoneChange',
        'accountDelete',
        'accountRestore',
      ],
      required: true,
    },
    meta: { type: Schema.Types.Mixed, default: {} },
    at: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: false, updatedAt: false }, autoIndex: false },
);
