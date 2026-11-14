/**
 * Canonical enums — source: PRD v1.7.1 §2/§3, database.md v1.5.
 * Never redefine these in apps; import from `@trust/shared/constants`.
 */

export const ROLES = ['buyer', 'verifiedBuyer', 'seller'] as const;
export type Role = (typeof ROLES)[number];

export const OPERATOR_ROLES = [
  'kycReviewer',
  'moderator',
  'seniorModerator',
  'superadmin',
] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

/** Push-token platforms (FCM for Android/web, APNs for iOS). */
export const DEVICE_PLATFORMS = ['fcm', 'apns'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const ENFORCEMENT_STATES = ['none', 'warned', 'suspended', 'banned'] as const;
export type EnforcementState = (typeof ENFORCEMENT_STATES)[number];

export const KYC_STATUSES = ['pending', 'pending-vendor', 'approved', 'rejected'] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const KYC_TYPES = ['buyerNID', 'sellerFull'] as const;
export type KycType = (typeof KYC_TYPES)[number];

export const KYC_REJECTION_REASONS = [
  'blurry',
  'expired_document',
  'info_mismatch',
  'duplicate_nid',
  'underage',
  'forgery_suspected',
  'vendor_unavailable',
  'other',
] as const;
export type KycRejectionReason = (typeof KYC_REJECTION_REASONS)[number];

/**
 * Reason codes stored on `kycSubmissions.reasonCode` (database.md).
 * Porichoy callbacks and ops rejections both use this uppercase set.
 */
export const KYC_REASON_CODES = [
  'UNREADABLE',
  'MISMATCH',
  'EXPIRED_DOC',
  'LIVENESS_FAIL',
  'UNDERAGE',
  'BLACKLIST',
  'DUPLICATE_NID',
  'OTHER',
] as const;
export type KycReasonCode = (typeof KYC_REASON_CODES)[number];

export const LISTING_STATUSES = [
  'draft',
  'active',
  'pendingConfirm',
  'sold',
  'expired',
  'delisted',
  'archived',
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const CONDITIONS = ['new', 'likeNew', 'good', 'refurbished', 'forParts'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const AI_SCAN_STATUSES = ['queued', 'clean', 'flagged'] as const;
export type AiScanStatus = (typeof AI_SCAN_STATUSES)[number];

export const THREAD_STATES = [
  'active',
  'soldBanner',
  'buyerBlocked',
  'sellerBlocked',
  'deletedListing',
  'archived',
  'frozen',
] as const;
export type ThreadState = (typeof THREAD_STATES)[number];

export const MESSAGE_FLAGS = ['offPlatformWarn', 'urlWarn'] as const;
export type MessageFlag = (typeof MESSAGE_FLAGS)[number];

export const OFFER_STATUSES = ['pending', 'accepted', 'declined', 'countered', 'expired'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const DEAL_TYPES = ['confirmed', 'direct', 'unconfirmed'] as const;
export type DealType = (typeof DEAL_TYPES)[number];

export const DEAL_CHANNELS = ['chat', 'phone', 'inPerson'] as const;
export type DealChannel = (typeof DEAL_CHANNELS)[number];

export const PAYMENT_PROVIDERS = ['bkash', 'nagad'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATES = ['initiated', 'pending', 'success', 'failed', 'expired'] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const MODERATION_CASE_STATUSES = ['open', 'claimed', 'closed'] as const;
export type ModerationCaseStatus = (typeof MODERATION_CASE_STATUSES)[number];

export const MODERATION_ACTIONS = ['dismiss', 'warn', 'suspend', 'delist', 'ban'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const REPORT_TARGETS = ['listing', 'user', 'message'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_CATEGORIES = [
  'scam_fraud',
  'fake_listing',
  'wrong_category',
  'prohibited_item',
  'harassment',
  'other',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const APPEAL_TYPES = ['kyc', 'enforcement', 'delisting'] as const;
export type AppealType = (typeof APPEAL_TYPES)[number];

export const APPEAL_OUTCOMES = ['uphold', 'reverse'] as const;
export type AppealOutcome = (typeof APPEAL_OUTCOMES)[number];

export const SUPPORT_TICKET_STATUSES = ['open', 'pending', 'resolved', 'closed'] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export const MEDIA_PURPOSES = ['kyc', 'listing', 'profile'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

export const MEDIA_STATUSES = ['uploaded', 'scanning', 'clean', 'quarantined'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['inApp', 'push', 'sms', 'ops'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const LANGUAGES = ['bn', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const PLATFORMS = ['web', 'android', 'ios'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const AUDIT_ACTORS = ['user', 'operator', 'system'] as const;
export type AuditActor = (typeof AUDIT_ACTORS)[number];

export const SEARCH_SORTS = ['relevance', 'price_asc', 'price_desc', 'date_desc'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];
