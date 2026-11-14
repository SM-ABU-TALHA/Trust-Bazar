import { Schema } from 'mongoose';

export const REPORT_TARGETS = ['listing', 'user', 'message'] as const;
export const MODERATION_CASE_STATUSES = ['open', 'claimed', 'closed'] as const;

/** `reports` — user-submitted reports (listing / user / message). */
export const reportSchema = new Schema(
  {
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: REPORT_TARGETS, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    category: { type: String, required: true },
    details: { type: String, required: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ['open', 'reviewing', 'resolved', 'rejected'],
      default: 'open',
    },
  },
  { timestamps: true, autoIndex: false },
);

/** `moderationCases` — claim-locked ops queue with SLA clock (PRD §3.4.6). */
export const moderationCaseSchema = new Schema(
  {
    source: { type: String, enum: ['report', 'ai', 'dispute', 'appeal'], required: true },
    refId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: MODERATION_CASE_STATUSES, default: 'open' },
    claimedBy: { type: Schema.Types.ObjectId, ref: 'OperatorAccount', default: null },
    /** 5-minute claim lock; expired locks are re-claimable. */
    lockUntil: { type: Date, default: null },
    slaDue: { type: Date, required: true },
    action: String,
    reasonCode: String,
    /** Frozen evidence for report-based cases (e.g. chat transcript). */
    snapshot: { type: Schema.Types.Mixed, default: null },
    /** 4-eyes ban: first action proposes, a different senior approves. */
    pendingBan: {
      proposedBy: { type: Schema.Types.ObjectId, ref: 'OperatorAccount', default: null },
      reasonCode: { type: String, default: null },
      proposedAt: { type: Date, default: null },
    },
    banApprovals: {
      type: [
        new Schema(
          {
            by: { type: Schema.Types.ObjectId, ref: 'OperatorAccount', required: true },
            at: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'OperatorAccount', default: null },
    resolvedAt: Date,
  },
  { timestamps: true, autoIndex: false },
);

/** `appeals` — separate queue, senior-only resolution (PRD §3.6). */
export const appealSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    caseId: { type: Schema.Types.ObjectId, ref: 'ModerationCase', default: null },
    /** What is being appealed: case id (enforcement) or kyc submission id. */
    referenceId: { type: Schema.Types.ObjectId, default: null },
    type: { type: String, enum: ['kyc', 'enforcement', 'delisting'], required: true },
    body: { type: String, required: true, maxlength: 2000 },
    status: { type: String, enum: ['open', 'resolved', 'rejected'], default: 'open' },
    outcome: { type: String, enum: ['uphold', 'reverse'], default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'OperatorAccount', default: null },
    resolutionNote: String,
    resolvedAt: Date,
    slaDue: { type: Date, required: true },
  },
  { timestamps: true, autoIndex: false },
);

/** `supportTickets` — contact-support tickets with embedded message thread. */
export const supportTicketSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: String, required: true },
    subject: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 1000 },
    attachmentMediaId: { type: Schema.Types.ObjectId, ref: 'MediaObject', default: null },
    status: {
      type: String,
      enum: ['open', 'pending', 'resolved', 'closed'],
      default: 'open',
    },
    messages: {
      type: [
        new Schema(
          {
            authorType: { type: String, enum: ['user', 'operator'], required: true },
            authorId: { type: Schema.Types.ObjectId, required: true },
            body: { type: String, required: true, maxlength: 2000 },
            at: { type: Date, default: Date.now },
          },
          { _id: true },
        ),
      ],
      default: [],
    },
    lastReplyAt: { type: Date, default: null },
    slaDue: { type: Date, required: true },
  },
  { timestamps: true, autoIndex: false },
);
