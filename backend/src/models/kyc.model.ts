import { Schema } from 'mongoose';

export const KYC_REASON_CODES = [
  'UNREADABLE',
  'MISMATCH',
  'EXPIRED_DOC',
  'LIVENESS_FAIL',
  'UNDERAGE',
  'BLACKLIST',
  'DUPLICATE_NID',
] as const;

/** `kycSubmissions` — state machine + Porichoy transaction refs (PRD §3.1). */
export const kycSubmissionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    scope: { type: String, enum: ['seller', 'buyer'], required: true },
    attempt: { type: Number, required: true, min: 1, max: 3 },
    status: {
      type: String,
      enum: ['pending', 'pending-vendor', 'approved', 'rejected'],
      default: 'pending',
    },
    reasonCode: { type: String, enum: [...KYC_REASON_CODES], default: null },
    porichoyTxnId: { type: String, default: null },
    media: {
      frontId: { type: Schema.Types.ObjectId, ref: 'MediaObject', required: true },
      backId: { type: Schema.Types.ObjectId, ref: 'MediaObject', required: true },
      selfieId: { type: Schema.Types.ObjectId, ref: 'MediaObject', default: null },
      livenessId: { type: Schema.Types.ObjectId, ref: 'MediaObject', default: null },
    },
    reviewerId: { type: Schema.Types.ObjectId, ref: 'OperatorAccount', default: null },
    /** Ops queue claim lock (5 minutes). */
    claimedBy: { type: Schema.Types.ObjectId, ref: 'OperatorAccount', default: null },
    lockUntil: { type: Date, default: null },
    reviewedAt: Date,
    /** Media purge timestamp (retention job, PRD §3.3.4). */
    purgedAt: { type: Date, default: null },
    /** Rejected submissions purge 90 days after review (TTL). */
    expiresAt: { type: Date, default: null },
    consentVersion: { type: String, required: true },
  },
  { timestamps: true, autoIndex: false },
);
