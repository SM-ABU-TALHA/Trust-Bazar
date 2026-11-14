import { Schema } from 'mongoose';
import { canonical, sha256 } from '../lib/crypto.js';

/**
 * `auditEvents` — append-only, hash-chained, on the SEPARATE audit cluster.
 * Every write sets `hash = sha256(prevHash + canonical(doc))`; updates and
 * deletes are rejected by the schema hook and (in production) by the DB user
 * grants (Architecture §8).
 */
export const auditEventSchema = new Schema(
  {
    /** Monotonic chain position — unique, gaps are a tamper signal. */
    seq: { type: Number, required: true },
    actor: { type: String, enum: ['user', 'operator', 'system'], required: true },
    actorId: { type: Schema.Types.ObjectId, default: null },
    action: { type: String, required: true },
    entityType: String,
    entityId: { type: Schema.Types.ObjectId, default: null },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false, autoIndex: false },
);

// Runs BEFORE Mongoose validation, so the required `hash` is always populated.
auditEventSchema.pre('validate', function (next) {
  if (!this.isNew) return next(new Error('auditEvents is append-only'));
  this.hash = sha256(this.prevHash + canonical(this.toObject({ versionKey: false })));
  next();
});

auditEventSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('auditEvents is append-only'));
  next();
});

auditEventSchema.pre('updateOne', function (next) {
  next(new Error('auditEvents is append-only'));
});
auditEventSchema.pre('deleteOne', function (next) {
  next(new Error('auditEvents is append-only'));
});
auditEventSchema.pre('deleteMany', function (next) {
  next(new Error('auditEvents is append-only'));
});
