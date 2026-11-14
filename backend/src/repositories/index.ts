import type { Model } from 'mongoose';
import type { AuditModels, Models } from '../models/index.js';
import { BaseRepository } from './base.repository.js';

type AnyDoc = Record<string, unknown>;

/** Binds a model to the generic repository. */
function repo(model: Model<AnyDoc>): BaseRepository<AnyDoc> {
  return new BaseRepository(model);
}

export class UserRepository extends BaseRepository<AnyDoc> {
  findByPhone(phone: string) {
    return this.findOne({ phone } as never);
  }

  findByNidHash(nidHash: string) {
    return this.findOne({ nidHash } as never);
  }

  /** Session registry is capped at 3 — services evict the oldest first. */
  async setSessions(userId: string, sessions: unknown[]): Promise<void> {
    await this.updateOne({ _id: userId } as never, { $set: { sessions } } as never);
  }
}

export class ListingRepository extends BaseRepository<AnyDoc> {
  /** Freemium cap check (5 active listing per seller, PRD §11.2#1). */
  countActiveBySeller(sellerId: string): Promise<number> {
    return this.count({ sellerId, status: 'active' } as never);
  }

  /** Public detail — only non-draft listings are ever served to guests. */
  findPublicById(id: string) {
    return this.findOne({ _id: id, status: { $ne: 'draft' } } as never);
  }
}

export class MessageRepository extends BaseRepository<AnyDoc> {
  /** Retry-safe send: a duplicate (threadId, clientMsgId) is ignored. */
  existsClientMsgId(threadId: string, clientMsgId: string): Promise<boolean> {
    return this.count({ threadId, clientMsgId } as never).then((count) => count > 0);
  }

  latestInThread(threadId: string, limit = 50) {
    return this.find({ threadId } as never, { sort: { createdAt: -1 }, limit });
  }
}

export class OfferRepository extends BaseRepository<AnyDoc> {
  findPending(buyerId: string, listingId: string) {
    return this.findOne({ buyerId, listingId, status: 'pending' } as never);
  }
}

export class NotificationRepository extends BaseRepository<AnyDoc> {
  unreadCount(userId: string): Promise<number> {
    return this.count({ userId, readAt: null } as never);
  }

  findByDedupeKey(dedupeKey: string) {
    return this.findOne({ dedupeKey } as never);
  }
}

export class PaymentRepository extends BaseRepository<AnyDoc> {
  findByIdempotencyKey(idempotencyKey: string) {
    return this.findOne({ idempotencyKey } as never);
  }

  findByReceiptNo(receiptNo: string) {
    return this.findOne({ receiptNo } as never);
  }
}

export class CreditRepository extends BaseRepository<AnyDoc> {
  /** Unexpired grants, soonest-expiring first (FIFO consumption). */
  activeGrants(userId: string) {
    return this.find({ userId, remaining: { $gt: 0 }, expiresAt: { $gt: new Date() } } as never, {
      sort: { expiresAt: 1 },
    });
  }
}

export class SupportTicketRepository extends BaseRepository<AnyDoc> {
  listByUser(userId: string, limit = 50) {
    return this.find({ userId } as never, { sort: { createdAt: -1 }, limit });
  }
}

export class OperatorRepository extends BaseRepository<AnyDoc> {
  findByEmail(email: string) {
    return this.findOne({ email: email.toLowerCase() } as never);
  }
}

export class KycRepository extends BaseRepository<AnyDoc> {
  latestForUser(userId: string) {
    return this.find({ userId } as never, { sort: { createdAt: -1 }, limit: 1 });
  }
}

export interface Repositories {
  users: UserRepository;
  consents: BaseRepository<AnyDoc>;
  securityEvents: BaseRepository<AnyDoc>;
  kycSubmissions: KycRepository;
  listings: ListingRepository;
  categories: BaseRepository<AnyDoc>;
  boostPackages: BaseRepository<AnyDoc>;
  mediaObjects: BaseRepository<AnyDoc>;
  threads: BaseRepository<AnyDoc>;
  messages: MessageRepository;
  offers: OfferRepository;
  deals: BaseRepository<AnyDoc>;
  payments: PaymentRepository;
  webhookEvents: BaseRepository<AnyDoc>;
  idempotencyKeys: BaseRepository<AnyDoc>;
  credits: CreditRepository;
  reports: BaseRepository<AnyDoc>;
  moderationCases: BaseRepository<AnyDoc>;
  appeals: BaseRepository<AnyDoc>;
  supportTickets: SupportTicketRepository;
  notifications: NotificationRepository;
  favorites: BaseRepository<AnyDoc>;
  savedSearches: BaseRepository<AnyDoc>;
  operatorAccounts: OperatorRepository;
  config: BaseRepository<AnyDoc>;
  /** Null while the audit cluster is not provisioned (degraded mode). */
  auditEvents: BaseRepository<AnyDoc> | null;
}

export function createRepositories(
  models: Models,
  auditModels: AuditModels | null = null,
): Repositories {
  return {
    users: new UserRepository(models.User),
    consents: repo(models.Consent),
    securityEvents: repo(models.SecurityEvent),
    kycSubmissions: new KycRepository(models.KycSubmission),
    listings: new ListingRepository(models.Listing),
    categories: repo(models.Category),
    boostPackages: repo(models.BoostPackage),
    mediaObjects: repo(models.MediaObject),
    threads: repo(models.Thread),
    messages: new MessageRepository(models.Message),
    offers: new OfferRepository(models.Offer),
    deals: repo(models.Deal),
    payments: new PaymentRepository(models.Payment),
    webhookEvents: repo(models.WebhookEvent),
    idempotencyKeys: repo(models.IdempotencyKey),
    credits: new CreditRepository(models.Credit),
    reports: repo(models.Report),
    moderationCases: repo(models.ModerationCase),
    appeals: repo(models.Appeal),
    supportTickets: new SupportTicketRepository(models.SupportTicket),
    notifications: new NotificationRepository(models.Notification),
    favorites: repo(models.Favorite),
    savedSearches: repo(models.SavedSearch),
    operatorAccounts: new OperatorRepository(models.OperatorAccount),
    config: repo(models.Config),
    auditEvents: auditModels ? repo(auditModels.AuditEvent) : null,
  };
}
