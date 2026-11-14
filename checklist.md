# Checklist — PROMPT 13–16

## Shared contracts & data layer
- ☑ `OPERATOR_ROLES` = `kycReviewer|moderator|seniorModerator|superadmin`; `OPS_ROLES`, `DEVICE_PLATFORMS`, `KYC_REASON_CODES` exported
- ☑ `JOB_SCHEDULES` declares exactly the 12 named jobs; `ENFORCEMENT_LADDER` + `SUSPENSION_DAYS`
- ☑ `schemas/ops.ts`, `schemas/notifications.ts`, `schemas/payment.ts`, `schemas/moderation.ts` exported through `schemas/index.ts`
- ☑ `payments.packageId` / `listings.boost.packageId` are **strings** (`boost-*`) in model, validator and schema
- ☑ `payments` validator accepts string `packageId` + numeric `amount`; `receiptNo`/`dedupeKey` unique **sparse** (no null default)
- ☑ `notifications` has `dedupeKey/count/lastAt` + `ops` channel; `supportTickets.messages[]`; `users.pushTokens`; `kycSubmissions.claimedBy/lockUntil`; `moderationCases.pendingBan/banApprovals`

## Audit & ops auth
- ☑ Audit hash is computed in a **pre-validate** hook (`required:true` passes) and non-new docs are rejected on save/update/delete
- ☑ `verifyChain` ignores Mongoose `__v` and returns `{ok, checked, brokenAt?}`
- ☑ Operator JWT is 15 min (`typ:"ops"`, audience `trustbazar-ops`); TOTP ±1 step; missing secret → 401 (never 500)
- ☑ IP allowlist = global `OPS_IP_ALLOWLIST` ∪ per-operator `ipAllowlist`

## Payments
- ☑ `GET /boost/packages` returns the server catalog (string ids); checkout is seller-only, enforcement-gated, idempotency-key required
- ☑ Credits apply FIFO before the gateway (`amount = price − creditApplied`); `amount:0` completes immediately
- ☑ Webhooks mount with raw body **before** `express.json`, verify HMAC hex + IP, archive every delivery, dedupe `(gateway,eventId)`
- ☑ Payment state machine is monotonic (`success → failed` is a no-op)
- ☑ Success activates boost + issues `receiptNo` + notifies; receipt PDF is 12-month bounded
- ☑ Suspension pauses boost (`pausedAt`/`remainingMs`), resume restores `until = now + remainingMs`
- ☑ Recon: orphan success → credit (`source:"reconciliation"`, `reason:<trxId>`), never an activation

## Moderation & support
- ☑ Reports: 5/24h cap, duplicate open report merges, response never echoes the target/reporter
- ☑ Case SLA 48 h; claim lock 5 min; `409 case_claimed` for a second operator
- ☑ Ladder `warn → suspend(7d) → ban`; ban requires a **different** senior (202 → 403 → 200)
- ☑ Ban delists listings, freezes threads, forfeits boosts, keeps `nidHash`
- ☑ Appeal SLA 24 h (suspended) / 72 h; owner-only; reversal writes `enforcement.lift` without touching `appeal.create`
- ☑ Suspended users can still appeal and open support; support replies append embedded messages + notify owner

## Notifications & jobs
- ☑ `notifications.dedupeKey` unique sparse is the idempotency primitive; `coalesce` bumps `count/lastAt`
- ☑ Quiet hours 22:00–08:00 Asia/Dhaka drop push/sms; enforcement/security/ops bypass
- ☑ List / mark-read / device-token endpoints are owner-scoped (`404` for strangers)
- ☑ All 12 jobs are idempotent on re-run; failures emit `ops.job_failed`
- ☑ Scheduler: BullMQ repeatables when `WORKER && REDIS_URL`, else in-process timers; `server.ts` starts/stops it

## Ops APIs & platform
- ☑ Ops role gates enforced (`kycReviewer` / `moderator` / `seniorModerator` / `superadmin`)
- ☑ KYC: `?claim=true` lock, reject requires `reasonCode`, approve grants roles, reject sets 90-day expiry, view audited
- ☑ `GET /ops/audit` superadmin-only and read-only; `audit-verify` flags tampering and alerts ops inbox
- ☑ `PUT /ops/config` audits before/after and invalidates the `/config` cache in the same request
- ☑ Client-version gate returns `426` but skips `/config` and `/webhooks/`; geo-launch allowlist enforced on listing create/update

## Verification
- ☑ `pnpm typecheck` clean; `pnpm lint` clean; shared tests 22/22
- ☑ New suites: payments 11/11, moderation 9/9, notifications 10/10, ops 10/10
- ☑ Full backend suite 141/141 green (14 files)
- ☑ `migrate.ts` run twice → `0 created` on the second run
- ☑ Docs synced: `API_spec.md` v1.5 §13.6, `database.md` v2.0, `prompt.md` rows 13–16 ☑

## PROMPT 12 — Deals & KPI
- ☑ `POST /deals/:id/confirm` buyer-only; body `{}` or `{confirmed:true}`; `422 buyer_message_required`; `409` for direct/disputed/expired
- ☑ Confirm is atomic and idempotent: deal `confirmed`, listing `sold`, thread `soldBanner`, `confirmedDeals += 1`, one `deal.confirmed` notification + audit
- ☑ Buyer window is 7 days (`deal.expiresAt`); 15-min `undoUntil` only covers seller undo
- ☑ `POST /deals/:id/decline` creates a dispute case (`source:"dispute"`, 48 h SLA), links `disputeRef`, `disputes90d += 1`, retry-safe
- ☑ ≥3 disputes/90 d → `enforcement.history.auto_flag` + `seller.auto_flagged` audit + `ops.seller_auto_flagged`
- ☑ `deal-timeout` job: day-3 reminder (dedupe) and 7-day timeout; deal stays `unconfirmed`, late confirm `409`
- ☑ KPI: direct deals and timed-out `unconfirmed` rows excluded from `confirmedDeals`
- ☑ `deals.test.ts` 11/11; full backend 141/141; typecheck + lint clean
- ☑ Docs: `API_spec.md` v1.6 §13.7; `prompt.md` row 12 + PROMPT 12 checkboxes ☑
