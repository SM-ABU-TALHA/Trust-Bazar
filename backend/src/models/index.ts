import type { Connection, Model, Schema } from 'mongoose';
import { auditEventSchema } from './audit.model.js';
import { messageSchema, offerSchema, threadSchema } from './chat.model.js';
import { dealSchema } from './deal.model.js';
import { kycSubmissionSchema } from './kyc.model.js';
import {
  boostPackageSchema,
  categorySchema,
  listingSchema,
  mediaObjectSchema,
} from './listing.model.js';
import {
  appealSchema,
  moderationCaseSchema,
  reportSchema,
  supportTicketSchema,
} from './moderation.model.js';
import {
  creditSchema,
  idempotencyKeySchema,
  paymentSchema,
  webhookEventSchema,
} from './payment.model.js';
import {
  configSchema,
  favoriteSchema,
  notificationSchema,
  operatorAccountSchema,
  savedSearchSchema,
} from './platform.model.js';
import { consentSchema, securityEventSchema, userSchema } from './user.model.js';

/** Structural document type — repositories add per-collection methods on top. */
type AnyDoc = Record<string, unknown>;

/**
 * Binds every model to a connection with its EXPLICIT collection name
 * (Mongoose pluralization would otherwise turn KycSubmission into
 * `kycsubmissions`). Safe to call repeatedly — existing models are reused.
 */
export function createModels(conn: Connection) {
  const bind = (name: string, collection: string, schema: Schema): Model<AnyDoc> => {
    const existing = conn.models[name];
    if (existing) return existing as unknown as Model<AnyDoc>;
    const bound = conn.model(name, schema as unknown as Schema<AnyDoc>, collection);
    return bound as unknown as Model<AnyDoc>;
  };

  return {
    User: bind('User', 'users', userSchema),
    Consent: bind('Consent', 'consents', consentSchema),
    SecurityEvent: bind('SecurityEvent', 'securityEvents', securityEventSchema),
    KycSubmission: bind('KycSubmission', 'kycSubmissions', kycSubmissionSchema),
    Listing: bind('Listing', 'listings', listingSchema),
    Category: bind('Category', 'categories', categorySchema),
    BoostPackage: bind('BoostPackage', 'boostPackages', boostPackageSchema),
    MediaObject: bind('MediaObject', 'mediaObjects', mediaObjectSchema),
    Thread: bind('Thread', 'threads', threadSchema),
    Message: bind('Message', 'messages', messageSchema),
    Offer: bind('Offer', 'offers', offerSchema),
    Deal: bind('Deal', 'deals', dealSchema),
    Payment: bind('Payment', 'payments', paymentSchema),
    WebhookEvent: bind('WebhookEvent', 'webhookEvents', webhookEventSchema),
    IdempotencyKey: bind('IdempotencyKey', 'idempotencyKeys', idempotencyKeySchema),
    Credit: bind('Credit', 'credits', creditSchema),
    Report: bind('Report', 'reports', reportSchema),
    ModerationCase: bind('ModerationCase', 'moderationCases', moderationCaseSchema),
    Appeal: bind('Appeal', 'appeals', appealSchema),
    SupportTicket: bind('SupportTicket', 'supportTickets', supportTicketSchema),
    Notification: bind('Notification', 'notifications', notificationSchema),
    Favorite: bind('Favorite', 'favorites', favoriteSchema),
    SavedSearch: bind('SavedSearch', 'savedSearches', savedSearchSchema),
    OperatorAccount: bind('OperatorAccount', 'operatorAccounts', operatorAccountSchema),
    Config: bind('Config', 'config', configSchema),
  } as const;
}

export type Models = ReturnType<typeof createModels>;

/** Audit models live on the separate audit cluster (append-only). */
export function createAuditModels(conn: Connection) {
  const existing = conn.models.AuditEvent;
  const AuditEvent =
    (existing as unknown as Model<AnyDoc> | undefined) ??
    (conn.model('AuditEvent', auditEventSchema as unknown as Schema<AnyDoc>, 'auditEvents') as unknown as Model<AnyDoc>);
  return { AuditEvent } as const;
}

export type AuditModels = ReturnType<typeof createAuditModels>;
