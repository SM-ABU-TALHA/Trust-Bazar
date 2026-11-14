# Tasks — PROMPT 13–16

**Prereq:** `spec.md` approved.
**Status legend:** ☐ todo · ◐ doing · ☑ done & verified

## A. Shared contracts

- ☑ A1 `enums.ts`: `OPERATOR_ROLES += superadmin`, `DEVICE_PLATFORMS`.
- ☑ A2 `operations.ts`: `JOB_SCHEDULES`, `ENFORCEMENT_LADDER`, `OPS_ROLES`.
- ☑ A3 `limits.ts`: report daily cap, support/payment/credits limits.
- ☑ A4 `schemas/payment.ts`: checkout gains `listingId` + `creditApply`.
- ☑ A5 `schemas/moderation.ts`: report `comment`, `ticketMessageSchema`.
- ☑ A6 `schemas/notifications.ts` + index export.
- ☑ A7 `schemas/ops.ts`: ops login, queue query, reconcile.
- ☑ A8 `pnpm -C packages/shared typecheck` + shared tests (22/22).

## B. Data layer

- ☑ B1 `models/payment.model.ts`: `listingId`, `gatewayUrl`, `receiptNo`, `paidAt`, `failureReason`.
- ☑ B2 `models/platform.model.ts`: notification `dedupeKey/count/lastAt` + `ops` channel; support ticket messages/status; operator role enum.
- ☑ B3 `models/user.model.ts`: `pushTokens`.
- ☑ B4 `models/kyc.model.ts`: `claimedBy`, `lockUntil`.
- ☑ B5 `models/moderation.model.ts`: `pendingBan`, `banApprovals`.
- ☑ B6 `db/indexes.ts`: notification dedupe unique sparse, support user, kyc claim, receipt unique sparse.
- ☑ B7 Repositories: thin methods for notifications/support/payments/operator queries.

## C. Audit & ops auth

- ☑ C1 `lib/totp.ts` + unit sanity via ops test.
- ☑ C2 `services/audit/audit.service.ts`: `verifyChain`, `listAudit`.
- ☑ C3 `middleware/require-operator.ts`; `types/express.d.ts` operator.
- ☑ C4 `services/ops/ops.service.ts` login/TOTP/IP.

## D. Payments (PROMPT 13)

- ☑ D1 `lib/pdf.ts` receipt builder.
- ☑ D2 `services/payments/providers.ts` gateway interface + signature/IP/settlement.
- ☑ D3 `services/payments/payment.service.ts`: packages, checkout, credits FIFO, webhook ingest/process, monotonic transitions, activation, receipt, pause/resume, recon.
- ☑ D4 `routes/payments.ts`; raw webhook mount in `app.ts`.
- ☑ D5 Enforcement pause/resume hook (ban/suspend/lift).

## E. Moderation & support (PROMPT 14)

- ☑ E1 `services/moderation/moderation.service.ts`: reports (+merge, 5/day), case claim, ladder, 4-eyes ban, listings/threads/boost effects.
- ☑ E2 Appeals (SLA 24/72 h, owner-only, reversal audit) + support tickets/messages + ops replies.
- ☑ E3 `routes/moderation.ts`; enforcement allowlist for appeals/support/notifications.
- ☑ E4 KYC ops queue/view/decide (in OpsService) + `kyc.document_view` audit.

## F. Notifications & jobs (PROMPT 15)

- ☑ F1 `services/notifications/notification.service.ts`: templates bn/en, channels, quiet hours, coalescing, digest, list/read/device token.
- ☑ F2 `routes/notifications.ts`.
- ☑ F3 `services/jobs/registry.ts`: 12 handlers (media-pipeline, webhook-drain, recon, lifecycle, expiry-reminders, offer-expiry, deal-timeout, purge, sla-scan, saved-search-alerts, breach-notify, audit-verify) + schedules.
- ☑ F4 Scheduler: BullMQ when `WORKER && REDIS_URL`, else in-process; `server.ts` start/stop.

## G. Ops APIs & platform (PROMPT 16)

- ☑ G1 `routes/ops.ts`: auth, queues, decisions, support, audit, config, reconcile.
- ☑ G2 Config editor + `/config` cache invalidation; audit `config.update`.
- ☑ G3 `middleware/client-version.ts` → 426; geo-launch gate in listing service.
- ☑ G4 Mount routers in `routes/v1.ts`; rate-limit registrations.

## H. Tests

- ☑ H1 `payments.test.ts` (11/11).
- ☑ H2 `moderation.test.ts` (9/9).
- ☑ H3 `notifications.test.ts` (10/10 incl. jobs).
- ☑ H4 `ops.test.ts` (10/10 incl. audit chain/config/426).
- ☑ H5 Full backend suite green (13 files, 130/130).

## I. Docs & verification

- ☑ I1 `API_spec.md` v1.5 changelog + §13.6 deltas.
- ☑ I2 `database.md` v2.0 changelog + new fields/indexes.
- ☑ I3 `prompt.md` rows 13–16 ☑ + checkboxes (PROMPT 12 completed separately in section J).
- ☑ I4 `pnpm typecheck; pnpm lint; pnpm -C backend test`; `migrate.ts` twice → 0 created on run 2.

## J. PROMPT 12 — Deals & KPI

- ☑ J1 Shared `confirmDealSchema` accepts `{}` / `{confirmed:true}`.
- ☑ J2 `DealService.confirm`: buyer-only, message re-check, 7-day window, direct/disputed guards, idempotent double confirm.
- ☑ J3 Confirm effects: deal `confirmed`, listing `sold`, thread `soldBanner`, `confirmedDeals += 1`, audit `deal.confirmed`, one notification.
- ☑ J4 `DealService.decline`: dispute `moderationCases` (48 h SLA), `disputeRef`, `disputes90d += 1`, retry-safe.
- ☑ J5 ≥3 disputes/90 d → `enforcement.history` auto_flag + `seller.auto_flagged` audit + ops alert.
- ☑ J6 `deal-timeout` job: day-3 reminder + 7-day timeout; stays `unconfirmed`, late confirm rejected.
- ☑ J7 KPI: direct deals excluded from confirmed count; `deal.confirmed` audit is the metrics event.
- ☑ J8 `routes/deals.ts` mounted in v1 (auth + enforcement gate).
- ☑ J9 `deals.test.ts` (11/11); full backend 141/141.
- ☑ J10 `API_spec.md` v1.6 §13.7; `prompt.md` row 12 ☑.
