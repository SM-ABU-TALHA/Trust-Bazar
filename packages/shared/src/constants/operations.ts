/** Cross-cutting operational constants — SLA, jobs, errors, notification events. */

export const SLA = {
  moderationHours: 48,
  appealHours: 72,
  suspensionAppealHours: 24,
  supportHours: 48,
  kycReviewHours: 24,
} as const;

export const JOB_NAMES = [
  'media-pipeline',
  'webhook-drain',
  'recon',
  'lifecycle',
  'expiry-reminders',
  'offer-expiry',
  'deal-timeout',
  'purge',
  'sla-scan',
  'saved-search-alerts',
  'breach-notify',
  'audit-verify',
] as const;
export type JobName = (typeof JOB_NAMES)[number];

/** Queue schedules (Architecture §7). Daily entries are Asia/Dhaka wall time. */
export const JOB_SCHEDULES: Record<JobName, { intervalMs?: number; dailyAt?: string; label: string }> = {
  'media-pipeline': { intervalMs: 60_000, label: 'every 1 min' },
  'webhook-drain': { intervalMs: 60_000, label: 'every 1 min' },
  recon: { dailyAt: '02:00', label: 'nightly 02:00' },
  lifecycle: { intervalMs: 3_600_000, label: 'hourly' },
  'expiry-reminders': { intervalMs: 3_600_000, label: 'hourly' },
  'offer-expiry': { intervalMs: 3_600_000, label: 'hourly' },
  'deal-timeout': { intervalMs: 3_600_000, label: 'hourly' },
  purge: { dailyAt: '03:00', label: 'nightly 03:00' },
  'sla-scan': { intervalMs: 900_000, label: 'every 15 min' },
  'saved-search-alerts': { intervalMs: 3_600_000, label: 'hourly' },
  'breach-notify': { label: 'event-driven' },
  'audit-verify': { dailyAt: '04:00', label: 'daily 04:00' },
};

/** Enforcement ladder (PRD §3.4.6): warn → 7-day suspend → ban (4-eyes). */
export const ENFORCEMENT_LADDER = ['warn', 'suspend', 'ban'] as const;
export const SUSPENSION_DAYS = 7;

/** Roles that may operate the ops console. */
export const OPS_ROLES = ['kycReviewer', 'moderator', 'seniorModerator', 'superadmin'] as const;

/** RFC-7807 `type` values — source: API_spec v1.2 §0.5. */
export const ERROR_TYPES = [
  'validation_failed',
  'bad_request',
  'unauthenticated',
  'token_revoked',
  'step_up_required',
  'forbidden',
  'enforcement_blocked',
  'kyc_required',
  'not_found',
  'version_conflict',
  'idempotency_replay',
  'state_conflict',
  'business_rule',
  'upgrade_required',
  'rate_limited',
  'internal_error',
  'upstream_error',
  'degraded',
] as const;
export type ErrorType = (typeof ERROR_TYPES)[number];

/** Notification events — source: PRD v1.7.1 Appendix D (17 events). */
export const NOTIFICATION_EVENTS = [
  'otp',
  'kyc.submitted',
  'kyc.approved',
  'kyc.rejected',
  'chat.message',
  'offer.received',
  'offer.accepted',
  'offer.declined',
  'offer.countered',
  'offer.expired',
  'listing.flagged',
  'listing.removed',
  'listing.reinstated',
  'enforcement.warning',
  'enforcement.suspension',
  'enforcement.ban',
  'boost.activated',
  'boost.expiring',
  'boost.expired',
  'payment.failed',
  'payment.reconciled_to_credit',
  'report.received',
  'report.updated',
  'report.resolved',
  'deal.confirmation_request',
  'deal.confirmed',
  'deal.declined',
  'deal.timed_out',
  'security.new_device',
  'security.number_changed',
  'account.deletion_scheduled',
  'listing.expiry_reminder',
  'listing.expired',
  'listing.renewed',
  'saved_search.match',
  'listing.sold_notice',
  'support.reply',
  'ops.sla_breach',
  'ops.vendor_outage',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** Audit actions that must always be written. */
export const AUDIT_ACTIONS = [
  'kyc.submit',
  'kyc.approve',
  'kyc.reject',
  'kyc.document_view',
  'enforcement.warn',
  'enforcement.suspend',
  'enforcement.ban',
  'enforcement.lift',
  'payment.webhook',
  'payment.reconcile',
  'support.reply',
  'config.update',
  'audit.view',
  'account.delete',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
