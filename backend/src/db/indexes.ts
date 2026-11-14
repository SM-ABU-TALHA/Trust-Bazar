/**
 * Index specs — the single source for migrate.ts AND the data-layer tests.
 * Mirrors database.md §4. TTL indexes MUST be single-field: MongoDB rejects
 * `expireAfterSeconds` on compound keys, so draft expiry uses a partial
 * filter on a single-field index instead.
 */
export type IndexKeys = Record<string, 1 | -1 | '2dsphere'>;

export interface IndexDef {
  readonly name: string;
  readonly keys: IndexKeys;
  readonly unique?: boolean;
  readonly sparse?: boolean;
  readonly partialFilterExpression?: Record<string, unknown>;
  readonly expireAfterSeconds?: number;
}

export const APP_INDEXES: Record<string, readonly IndexDef[]> = {
  users: [
    { name: 'uq_users_phone', keys: { phone: 1 }, unique: true },
    { name: 'uq_users_nidHash', keys: { nidHash: 1 }, unique: true, sparse: true },
    {
      name: 'idx_users_purgeAt',
      keys: { purgeAt: 1 },
      partialFilterExpression: { deletedAt: { $exists: true } },
    },
  ],
  kycSubmissions: [
    { name: 'idx_kyc_user_created', keys: { userId: 1, createdAt: -1 } },
    { name: 'idx_kyc_status_created', keys: { status: 1, createdAt: 1 } },
    { name: 'idx_kyc_claim', keys: { claimedBy: 1, lockUntil: 1 } },
    {
      name: 'ttl_kyc_rejected_expiry',
      keys: { expiresAt: 1 },
      expireAfterSeconds: 0,
      partialFilterExpression: { status: 'rejected' },
    },
  ],
  listings: [
    { name: 'idx_listings_seller_status', keys: { sellerId: 1, status: 1 } },
    { name: 'idx_listings_cat_status_created', keys: { categoryId: 1, status: 1, createdAt: -1 } },
    {
      name: 'idx_listings_district_status_price',
      keys: { 'location.district': 1, status: 1, price: 1 },
    },
    { name: 'geo_listings_geo', keys: { 'location.geo': '2dsphere' } },
    { name: 'idx_listings_expiresAt', keys: { expiresAt: 1 } },
    {
      name: 'ttl_listings_draft_expiresAt',
      keys: { expiresAt: 1 },
      expireAfterSeconds: 0,
      partialFilterExpression: { status: 'draft' },
    },
    { name: 'idx_listings_boost_until', keys: { 'boost.until': 1 } },
    { name: 'idx_listings_pHashes', keys: { pHashes: 1 } },
  ],
  categories: [
    { name: 'uq_categories_slug', keys: { slug: 1 }, unique: true },
    { name: 'idx_categories_parent', keys: { parentId: 1 } },
  ],
  threads: [
    { name: 'uq_threads_listing_buyer', keys: { listingId: 1, buyerId: 1 }, unique: true },
    { name: 'idx_threads_buyer_lastMsg', keys: { buyerId: 1, lastMessageAt: -1 } },
    { name: 'idx_threads_seller_lastMsg', keys: { sellerId: 1, lastMessageAt: -1 } },
  ],
  messages: [
    { name: 'idx_messages_thread_created', keys: { threadId: 1, createdAt: 1 } },
    {
      name: 'uq_messages_thread_clientMsgId',
      keys: { threadId: 1, clientMsgId: 1 },
      unique: true,
    },
  ],
  offers: [
    { name: 'idx_offers_thread_status', keys: { threadId: 1, status: 1 } },
    { name: 'idx_offers_expiresAt', keys: { expiresAt: 1 } },
    {
      name: 'uq_offers_pending_buyer_listing',
      keys: { buyerId: 1, listingId: 1 },
      unique: true,
      partialFilterExpression: { status: 'pending' },
    },
  ],
  deals: [
    { name: 'uq_deals_listing', keys: { listingId: 1 }, unique: true },
    { name: 'idx_deals_seller_type', keys: { sellerId: 1, type: 1 } },
    { name: 'idx_deals_buyer_created', keys: { buyerId: 1, createdAt: -1 } },
  ],
  payments: [
    { name: 'uq_payments_idempotencyKey', keys: { idempotencyKey: 1 }, unique: true },
    { name: 'idx_payments_user_created', keys: { userId: 1, createdAt: -1 } },
    { name: 'idx_payments_state_updated', keys: { state: 1, updatedAt: 1 } },
    { name: 'idx_payments_listing', keys: { listingId: 1 } },
    { name: 'uq_payments_receiptNo', keys: { receiptNo: 1 }, unique: true, sparse: true },
  ],
  webhookEvents: [
    { name: 'uq_webhooks_gateway_eventId', keys: { gateway: 1, eventId: 1 }, unique: true },
    { name: 'idx_webhooks_gateway_processed', keys: { gateway: 1, processedAt: 1 } },
    { name: 'idx_webhooks_paymentId', keys: { paymentId: 1 } },
  ],
  idempotencyKeys: [{ name: 'ttl_idem_expiresAt', keys: { expiresAt: 1 }, expireAfterSeconds: 0 }],
  credits: [
    { name: 'idx_credits_user_expiry', keys: { userId: 1, expiresAt: 1 } },
    { name: 'idx_credits_expiresAt', keys: { expiresAt: 1 } },
  ],
  reports: [
    { name: 'idx_reports_target', keys: { targetType: 1, targetId: 1 } },
    { name: 'idx_reports_status_created', keys: { status: 1, createdAt: 1 } },
  ],
  moderationCases: [
    { name: 'idx_mod_claim_lock', keys: { claimedBy: 1, lockUntil: 1 } },
    { name: 'idx_mod_slaDue', keys: { slaDue: 1 } },
  ],
  appeals: [
    { name: 'idx_appeals_user', keys: { userId: 1 } },
    { name: 'idx_appeals_slaDue', keys: { slaDue: 1 } },
  ],
  supportTickets: [
    { name: 'idx_support_status_sla', keys: { status: 1, slaDue: 1 } },
    { name: 'idx_support_user_created', keys: { userId: 1, createdAt: -1 } },
  ],
  notifications: [
    { name: 'idx_notif_user_read', keys: { userId: 1, readAt: 1 } },
    { name: 'idx_notif_user_created', keys: { userId: 1, createdAt: -1 } },
    { name: 'uq_notif_dedupe', keys: { dedupeKey: 1 }, unique: true, sparse: true },
  ],
  favorites: [{ name: 'uq_favorites_user_listing', keys: { userId: 1, listingId: 1 }, unique: true }],
  savedSearches: [{ name: 'idx_savedSearches_user', keys: { userId: 1, createdAt: -1 } }],
  mediaObjects: [
    { name: 'idx_media_owner', keys: { ownerId: 1 } },
    { name: 'idx_media_status_created', keys: { status: 1, createdAt: 1 } },
    { name: 'idx_media_pHash', keys: { pHash: 1 } },
  ],
  securityEvents: [{ name: 'idx_sec_user_at', keys: { userId: 1, at: -1 } }],
  operatorAccounts: [{ name: 'uq_operator_email', keys: { email: 1 }, unique: true }],
};

/** Audit cluster — separate connection, append-only. */
export const AUDIT_INDEXES: Record<string, readonly IndexDef[]> = {
  auditEvents: [
    { name: 'uq_audit_seq', keys: { seq: 1 }, unique: true },
    { name: 'idx_audit_entity', keys: { entityType: 1, entityId: 1, at: 1 } },
    { name: 'idx_audit_actor', keys: { actorId: 1, at: 1 } },
  ],
};
