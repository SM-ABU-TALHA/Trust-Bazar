# Spec — PROMPT 13–16: Payments · Moderation · Notifications/Jobs · Audit & Ops

**Status:** awaiting approval
**Scope:** money paths (boost + credits + webhooks + recon), moderation/enforcement/appeals/support, notification event bus + 12 job queues, tamper-evident audit and operator API surface.
**Non-goals:** PROMPT 12 (deals/KPI — explicitly skipped, stays ☐), ops console UI (PROMPT 19), mobile/web clients (17–20).

**Source refs:** `prompt.md` PROMPT 13–16 · `API_spec.md` §4, §8–§13 · `database.md` §2.7–2.14, §4 · `PRD.md` §3.3.9, §3.3.11, §3.4.5–3.4.6, §3.6, Appx B, Appx D · `Architecture.md` §4.2, §7, §8.

---

## 0. Cross-cutting decisions

| Topic | Decision |
|---|---|
| Response envelope | `{data, meta:{requestId}}`; 204 for no-body actions; RFC-7807 via existing `err.*`. |
| New error types | `err.upgradeRequired(min)` → 426 `upgrade_required`; `err.pendingApproval(detail)` → 202 semantics handled in service response (not an error). |
| Operator auth | `POST /ops/auth/login {email, totp}` → operator JWT `{sub, role, typ:'ops'}` 15 min, signed with `JWT_ACCESS_SECRET`. `requireOperator(...roles)` rejects non-`ops` tokens, inactive operators and IPs outside the allowlist. No self-signup — accounts exist only via seed/DB. |
| Operator roles | `kycReviewer \| moderator \| seniorModerator \| superadmin` (`OPERATOR_ROLES` gains `superadmin`; model enum aligned). Ban = moderator proposes + seniorModerator/superadmin approves (4-eyes). Audit viewer + config editor = `superadmin`. |
| Webhook ingress | Raw body mounted **before** `express.json` (same pattern as Porichoy): `POST /api/v1/webhooks/payments/:provider`. Signature `HMAC-SHA256(rawBody, <PROVIDER>_WEBHOOK_SECRET)` hex in `x-bkash-signature` / `x-nagad-signature`; optional IP allowlist. Always `200 {received:true}` after raw archive; processing runs async. |
| Idempotency | `notifications.dedupeKey` **unique sparse** is the single dedupe primitive for events, coalescing, digests and job alerts. `webhookEvents (gateway,eventId)` unique is the payment-write dedupe. |
| Job runtime | 12 named queues with schedules (`JOB_SCHEDULES`). When `WORKER=true && REDIS_URL` → BullMQ repeatable jobs; otherwise an in-process scheduler owning the same handlers. Handlers are exported and callable directly (`runJob(name)`) so tests need no Redis. Every handler is idempotent; failures alert ops via `ops.job_failed` notification and are retried on the next tick. |
| Quiet hours | 22:00–08:00 Asia/Dhaka suppress `push`/`sms` for non-critical events; `inApp` is always written. Critical (bypass): `otp`, `security.*`, `enforcement.*`, `ops.*`, `payment.*`. |
| Localisation | Every template has `bn` + `en`; recipient language from `users.notificationPrefs.lang` (default `bn`). |
| Audit | Every operator decision, config change, KYC document view, payment transition and audit view appends to `auditEvents` on the **separate** cluster (`appendAudit`, fail-soft). |

---

## 1. API deltas (implemented contract)

### Payments / boost (PROMPT 13)
| Endpoint | Contract |
|---|---|
| `GET /boost/packages` | Auth: logged-in. `data = [{id,name,durationDays,price,placement,active}]` from `boostPackages` where `active:true`. |
| `POST /boost/checkout` | Auth: `seller`, enforcement gate, `Idempotency-Key` required, rate `boost_checkout`. Body `{packageId, listingId, provider, creditApply?=true}`. Listing must belong to caller and be `active` → else 404 `listing_not_found` / 422 `listing_not_active`. Price from DB only. Credits auto-applied FIFO (`creditApplied = min(balance, price)`), remaining amount charged. Persists `payments{state:'initiated', idempotencyKey, listingId, amount:net, creditApplied, gatewayUrl, provider}`. Returns 201 `{paymentId,state:'initiated',gatewayUrl,creditApplied}`. |
| `POST /webhooks/payments/:provider` | Signature+IP verified → store raw `webhookEvents` (unique dedupe) → 200 immediately → async `applyWebhook`. Invalid signature → 401 `forbidden` (archived with `signatureOk:false`, never processed). |
| `GET /payments/:id` | Owner only (IDOR → 404). `{id,state,amount,creditApplied,provider,receiptNo,paidAt,boostUntil}`. |
| `GET /payments/:id/receipt` | Owner, `success` only, within 12 months of `paidAt`; streams `application/pdf` (hand-rolled minimal PDF, no new dep); missing → 409 `receipt_not_available`. |
| `GET /me/credits` | `{balance, entries:[{id,amount,remaining,source,reason,expiresAt,createdAt}]}`; balance = Σ remaining where `expiresAt>now`. |

State machine (monotonic, enforced in one `applyState`): `initiated → pending|success|failed|expired`, `pending → success|failed|expired`; anything else → `409 state_conflict`. Success activation is a single atomic `findOneAndUpdate({_id, state:{$in:['initiated','pending']}})`; a replay finds no match and is a no-op. A `success→failed` replay is rejected (409) and audited.

On success (single transaction-equivalent sequence, each step idempotent):
1. payment `{state:'success', paidAt, receiptNo, gatewayRefs}`; 2. consume applied credits FIFO; 3. `listings.boost = {active:true, packageId, until: now+durationDays, pausedAt:null, remainingMs:null}`; 4. receipt number `TB-YYYYMM-<seq>`; 5. notifications `boost.activated`; 6. audit `payment.success`.

Suspension/ban pause: `pauseBoosts(userId)` sets `pausedAt=now`, `remainingMs=max(0, until-now)`, `active:false`. `resumeBoosts(userId)` sets `until=now+remainingMs`, clears pause, `active:true` (only when enforcement lifted/expires).

`recon(rows)` (nightly + `POST /ops/reconcile/payments`): rows `{trxId, reference, amount, state, userId?}`. For known payments, missing success is applied through `applyState`; unknown `success` rows with a resolvable user create a `credits` grant (`source:'reconciliation'`, reason = trxId, expiry +12 months) and notification `payment.reconciled_to_credit` — **never** a boost activation. Unresolvable rows → `ops.vendor_outage` style alert.

### Reports / appeals / support (PROMPT 14)
| Endpoint | Contract |
|---|---|
| `POST /reports` | Auth (gate allows reports only when not banned? decision: banned may still report? No — reports require non-banned, appeals/support are the banned escape hatch). Rate override 5/day. Body `{targetType,targetId,category,comment?}`. Same reporter + same target + open report → returns existing `{reportId, merged:true}` (no new case). Otherwise creates `reports` + `moderationCases{source:'report', refId, status:'open', slaDue:+48h, snapshot}`. Reporter identity never returned to the reported party (no endpoint exposes reports). 201 `{reportId}`. |
| `POST /appeals` | Auth; allowed while suspended/banned (gate allowlist). Body `{type, referenceId, message}`. SLA = 24 h when the user is suspended, else 72 h. Duplicate open appeal for same reference → 409 `appeal_open_exists`. 201 `{appealId, slaDue}`. |
| `GET /appeals/:id` | Owner only, else 404. Returns status, slaDue, resolution (never operator identity). |
| `POST /support/tickets` | Auth; allowed while suspended/banned. Body `{category,subject,body,attachmentMediaId?}`; SLA +48 h. 201 `{ticketId,slaDue}`. |
| `GET /me/support/tickets` | Owner list, newest first. |
| `GET /support/tickets/:id/messages` | Owner only (404 otherwise). Returns embedded message thread. |
| `POST /support/tickets/:id/messages` | Owner, ticket not closed; appends user message, re-opens status to `open`. 201. |

### Notifications (PROMPT 15)
| Endpoint | Contract |
|---|---|
| `GET /notifications?read=&limit=` | Own notifications newest first (default 50, max 100); `meta.unread`. |
| `POST /notifications/:id/read` | Own only (404 otherwise), idempotent, 204. |
| `POST /notifications/device-token` | `{token, platform:'fcm'\|'apns'}` appended to `users.pushTokens` (dedupe by token). 204. |

### Ops (PROMPT 16, all operator-gated)
| Endpoint | Role | Contract |
|---|---|---|
| `POST /ops/auth/login` | public | `{email,totp}` → `{token, role, expiresAt}`; bad TOTP/unknown/inactive/IP → 401 (no enumeration detail). |
| `GET /ops/kyc?status=pending&claim=` | kycReviewer | Queue; `claim=true` sets `claimedBy`, `lockUntil=+5min`; rows locked by others excluded. |
| `GET /ops/kyc/:id` | kycReviewer | Detail + signed media URLs; writes `kyc.document_view` audit. |
| `POST /ops/kyc/:id/decide` | kycReviewer | `{decision:'approve'\|'reject', reasonCode?}`; reject requires reasonCode; approve grants `verifiedBuyer` (+`seller` for seller scope); reject sets `expiresAt=+90d`; notifications + audit. |
| `GET /ops/moderation?status=` | moderator | Queue incl. SLA state. |
| `POST /ops/moderation/:id/claim` | moderator | 5-min lock; 409 `case_claimed` when locked by another. |
| `POST /ops/moderation/:id/action` | moderator (ban: 4-eyes) | `{action, reasonCode, note?}`. `warn`→`warned`; `suspend`→`suspended` until +7d + pause boosts; `delist`→listing `delisted`; `dismiss`→close. `ban` first call stores `pendingBan{proposedBy,reasonCode}` → 202 `{status:'pending_second_approval'}`; a different seniorModerator/superadmin repeating `ban` applies: user `banned`, seller listings `delisted`, threads `frozen`, boosts forfeited (`active:false`, `until:null`), NID hash retained for block. Same operator approving own proposal → 403 `second_approver_required`. |
| `GET /ops/appeals`, `POST /ops/appeals/:id/decide` | seniorModerator/superadmin | `{outcome:'uphold'\|'reverse', reason}`; reverse lifts enforcement / re-opens KYC as `pending`; original audit immutable, reversal appended. |
| `GET /ops/support`, `POST /ops/support/:id/reply` | moderator | Reply appends operator message, notification `support.reply`, audit `support.reply`. |
| `GET /ops/audit?entityType=&entityId=&from=&to=` | superadmin | Read-only chain view; writes `audit.view`. |
| `GET/PUT /ops/config` | superadmin | Public config keys (`minVersion`,`featureFlags`,`geoLaunch`); PUT validates `configUpdateSchema`, upserts, audits `config.update` with before/after, invalidates the `/config` cache in the same request. |
| `POST /ops/reconcile/payments` | superadmin | Runs recon on demand, returns summary `{matched,orphanCredits,skipped}`. |

Client-version gate: any `/api/v1/*` request carrying `X-App-Platform` + `X-App-Version` below `config.minVersion` → `426 upgrade_required`. Geo-launch: listing create/update district outside non-empty `geoLaunch` → `422 district_not_launched`.

---

## 2. Files — create

| File | Content |
|---|---|
| `backend/src/lib/totp.ts` | `generateTotp(secret, at?)`, `verifyTotp(secret, code, window=1)` — base32 decode + HMAC-SHA1, 30 s step, ±1 step. |
| `backend/src/lib/pdf.ts` | `buildReceiptPdf(lines: string[]): Buffer` — valid single-page PDF 1.4, no dependencies. |
| `backend/src/services/payments/providers.ts` | `interface PaymentGateway { checkoutUrl(payment): string; verifySignature(raw, header): boolean; allowIp(ip): boolean; fetchSettlement(): Promise<SettlementRow[]> }`; `createGateway(config, provider)`; sandbox URLs from `BKASH_BASE_URL`/`NAGAD_BASE_URL` with deterministic fallback; `fetchSettlement()` returns `[]` in degraded mode. |
| `backend/src/services/payments/payment.service.ts` | `PaymentService` — `listPackages`, `checkout`, `ingestWebhook`, `processWebhookEvent`, `applyState`, `getPayment`, `receipt`, `credits`, `reconcile`, `pauseBoosts`, `resumeBoosts`; `ALLOWED_TRANSITIONS`; `emit` via NotificationService; audit `payment.*`. |
| `backend/src/services/moderation/moderation.service.ts` | `ModerationService` — `createReport`, `claimCase`, `act`, `applyBan`, `createAppeal`, `getAppeal`, `decideAppeal`, `createTicket`, `listTickets`, `listTicketMessages`, `postTicketMessage`, `opsReply`, queue readers; enforcement ladder + 4-eyes; notifications + audit. |
| `backend/src/services/notifications/notification.service.ts` | `NotificationService.emit(event, {userId,payload,dedupeKey?,critical?})`, `list`, `markRead`, `registerDevice`; `TEMPLATES` bn/en; quiet hours; chat coalescing; saved-search digest. |
| `backend/src/services/jobs/registry.ts` | `JOB_SCHEDULES` (12 names → `{intervalMs}` or `{dailyAt:'HH:mm'}`), `JOB_HANDLERS` map, `runJob(name, deps)`, `startScheduler(deps)`, `stopScheduler()`. |
| `backend/src/services/ops/ops.service.ts` | `OpsService` — operator login/TOTP/IP, KYC queue+view+decide, moderation/appeals/support queues (delegating to ModerationService), audit query + view audit, config get/put + cache invalidation, recon trigger. |
| `backend/src/middleware/require-operator.ts` | `requireOperator(...roles)` — bearer `typ:'ops'`, operator active, IP allowlist (operator list ∪ `OPS_IP_ALLOWLIST`; empty = allow), attaches `req.operator`. |
| `backend/src/middleware/client-version.ts` | `clientVersionGate(getMinVersion)` → 426. |
| `backend/src/routes/payments.ts` | `/boost/packages`, `/boost/checkout` (idempotency), `/payments/:id`, `/payments/:id/receipt`, `/me/credits`; webhook handler factory `paymentWebhook(config, logger, deps)`. |
| `backend/src/routes/moderation.ts` | `/reports`, `/appeals`, `/appeals/:id`, `/support/tickets*`, `/me/support/tickets`. |
| `backend/src/routes/notifications.ts` | §Notifications. |
| `backend/src/routes/ops.ts` | `/ops/auth/login` + all §Ops (operator-gated per row). |
| `backend/src/types/express.d.ts` | add `operator?: {id:string; role:string}` (edit if file exists). |
| `backend/src/__tests__/payments.test.ts` | Live Atlas `trust_bazar_test_payments`; harness copied from `chat.test.ts`. |
| `backend/src/__tests__/moderation.test.ts` | Live Atlas `trust_bazar_test_moderation`. |
| `backend/src/__tests__/notifications.test.ts` | Live Atlas `trust_bazar_test_notifications` (notifications + jobs). |
| `backend/src/__tests__/ops.test.ts` | Live Atlas `trust_bazar_test_ops` (operator auth, KYC decide, audit chain, config). |

## 3. Files — modify

| File | Change |
|---|---|
| `packages/shared/src/constants/enums.ts` | `OPERATOR_ROLES += 'superadmin'`; add `DEVICE_PLATFORMS = ['fcm','apns']`. |
| `packages/shared/src/constants/operations.ts` | add `JOB_SCHEDULES` (name, schedule label), `ENFORCEMENT_LADDER` (`warn→suspend`, `suspend→ban`), `OPS_ROLES`. |
| `packages/shared/src/constants/limits.ts` | `report.dailyCap:5`, `support.messageMax:2000`, `payment.receiptMonths:12`, `credits.expiryMonths:12`. |
| `packages/shared/src/schemas/payment.ts` | `boostCheckoutSchema = {packageId, listingId, provider, creditApply: z.boolean().default(true)}`. |
| `packages/shared/src/schemas/moderation.ts` | `reportSchema.comment` (≤1000, replaces `description`); `ticketMessageSchema {body 1..2000}`. |
| `packages/shared/src/schemas/notifications.ts` | new: `notificationListQuerySchema`, `deviceTokenSchema`. |
| `packages/shared/src/schemas/ops.ts` | `opsLoginSchema {email, totp:/^\d{6}$/}`, `opsQueueQuerySchema {status?, claim?}`, `reconcileSchema` (empty optional). |
| `packages/shared/src/schemas/index.ts` | export `./notifications.js`. |
| `backend/src/config/index.ts` | add optional `BKASH_WEBHOOK_SECRET`, `NAGAD_WEBHOOK_SECRET`, `BKASH_WEBHOOK_IPS`, `NAGAD_WEBHOOK_IPS`, `OPS_IP_ALLOWLIST`, `BKASH_WEBHOOK_SECRET` etc.; `RECON_LOOKBACK_DAYS` default 3. |
| `backend/src/models/payment.model.ts` | `payments += {listingId(ref Listing, required), gatewayUrl, receiptNo (unique sparse), paidAt, failureReason}`; `credits += {consumedAt?}` not needed — grants only. |
| `backend/src/models/platform.model.ts` | `notifications += {dedupeKey, count, lastAt}` and channels enum `['inApp','push','sms','ops']`; `supportTickets.messages[] {authorType:'user'\|'operator', authorId, body, at}`, `lastReplyAt`, status enum `open\|pending\|resolved\|closed`; `operatorAccounts.role` enum incl. `seniorModerator`,`superadmin`. |
| `backend/src/models/user.model.ts` | `pushTokens: [{token, platform:'fcm'\|'apns', at}]`. |
| `backend/src/models/kyc.model.ts` | `claimedBy`, `lockUntil` for the ops queue. |
| `backend/src/models/moderation.model.ts` | `moderationCase += {pendingBan:{proposedBy,reasonCode}, banApprovals:[{by,at}]}`. |
| `backend/src/db/indexes.ts` | `uq_notifications_dedupe {dedupeKey:1} unique sparse`; `idx_support_user_created {userId:1,createdAt:-1}`; `idx_kyc_claim {claimedBy:1,lockUntil:1}`; `uq_payments_receiptNo` unique sparse. |
| `backend/src/db/validators.ts` | offers already fixed; ensure `supportTickets`/`notifications`/`payments` validators keep `additionalProperties` open (no strict enum on new fields). |
| `backend/src/services/audit/audit.service.ts` | add `verifyChain(repos): Promise<{ok:boolean;checked:number;brokenAt?:number}>`, `listAudit(repos, filter)`; keep `appendAudit` fail-soft. |
| `backend/src/services/listings/listing.service.ts` | geo-launch gate on create/update district; expose nothing else. |
| `backend/src/middleware/enforcement-gate.ts` | allowlist += `POST /api/v1/appeals`, `GET /api/v1/appeals/*`, `/api/v1/support/tickets*`, `GET /api/v1/me/support/tickets`, `GET /api/v1/notifications*`, `POST /api/v1/notifications/*`. |
| `backend/src/middleware/rate-limit.ts` | register override actions used by new routes (`report_create`, `boost_checkout`, `appeal_create`, `support_create`). |
| `backend/src/routes/v1.ts` | mount new routers; export `invalidateConfigCache()`; apply `clientVersionGate`. |
| `backend/src/app.ts` | raw-body payment webhook mount before `express.json`. |
| `backend/src/server.ts` | `startScheduler`/`stopScheduler` when `WORKER`; no change to HTTP boot order. |
| `backend/package.json` | add `bullmq` (only loaded when `WORKER && REDIS_URL`). |
| `API_spec.md` | new §4.7 credits note, §8 device token, §9 report body `comment`, §10 ticket messages, §11 ops login + claim/decide/audit/config/reconcile, §12.4 recon; changelog v1.5. |
| `database.md` | changelog v2.0: notifications dedupe/count, payments listing/receipt, support ticket messages, KYC claim lock, case pendingBan/approvals, new indexes. |
| `prompt.md` | PROMPT 13–16 checkboxes ☑ + progress rows 13–16 ☑ (only after verification). PROMPT 12 untouched. |

---

## 4. Test matrix

### `payments.test.ts`
1. Packages list is server-driven from `boostPackages`.
2. Checkout without `Idempotency-Key` → 400; buyer (non-seller) → 403; foreign listing → 404.
3. Checkout success → 201, `state:'initiated'`, price from DB, `creditApplied` from grant.
4. Same idempotency key + same payload → replay (same paymentId); different payload → 409 `idempotency_replay`.
5. Webhook bad signature → 401, no state change, event archived with `signatureOk:false`.
6. Valid webhook twice → exactly one activation, one boost window, one `boost.activated` notification.
7. Failed payment → `state:'failed'`, boost not active, credits remain (`remaining` unchanged).
8. `success → failed` replay rejected 409; DB still `success`.
9. Receipt: 200 `application/pdf`, starts `%PDF`; non-success → 409; 12-month expiry → 409.
10. Suspension pauses boost (`remainingMs>0`, `active:false`); lift resumes with ~same remaining.
11. Recon orphan → credit grant, **no** activation; known pending success → activated.

### `moderation.test.ts`
1. Report twice → one report, second `merged:true`; 6th report/day → 429.
2. Report creates case with 48 h SLA; target detail not leaked back.
3. Suspended user: chat/listing/boost → 403; appeal + support succeed.
4. Claim lock: operator A claims; operator B action → 409 `case_claimed`; after lock expiry B can claim.
5. Warn → `warned` + notification; suspend → `suspended` + boosts paused + 24 h appeal SLA.
6. Ban first call → 202 pending approval; same operator second call → 403; different senior → banned, listings delisted, threads frozen, boosts forfeited, NID hash retained.
7. Appeal ownership: stranger GET → 404; decide reverse lifts suspension and appends audit (original intact).
8. Support: ticket created while banned; owner lists; stranger messages → 404; ops reply adds operator message + `support.reply` notification.
9. Reporter identity absent from every reported-user-visible payload.

### `notifications.test.ts`
1. `emit` writes one record with `dedupeKey`; repeat emit → same record (`count` bumped where coalescing).
2. Quiet hours: push channel dropped, inApp kept; `enforcement.*` bypasses.
3. Chat messages coalesce per thread (one row, count increments).
4. Saved-search digest deduped per day.
5. List/mark-read/device-token flows; foreign notification read → 404.
6. `lifecycle` job: expired listing → `expired` + notification; run twice → no duplicate/drift.
7. `offer-expiry` job: past-due pending offer → `expired` + notification; rerun idempotent.
8. `webhook-drain` retries an unprocessed event exactly once per run.
9. `sla-scan` flags overdue case → `ops.sla_breach` once.
10. `audit-verify` on untampered chain → `{ok:true}`.

### `ops.test.ts`
1. `/ops/*` without operator token → 401; user token → 401.
2. Login wrong TOTP → 401; correct TOTP → token with role; operator missing TOTP secret → 401.
3. IP allowlist rejects a non-listed IP.
4. KYC queue claim + decide approve grants roles; reject requires reasonCode (400), sets 90-day `expiresAt`.
5. KYC document view writes `kyc.document_view` audit.
6. Audit append-only: `updateOne`/`deleteOne` on `auditEvents` throws.
7. Mutate a doc + `audit-verify` → `{ok:false,brokenAt}` + ops notification.
8. `PUT /ops/config` writes `config.update` audit in the same request; `/config` reflects within 60 s (cache invalidated).
9. `POST /ops/reconcile/payments` returns summary.
10. Client-version gate: old header → 426; current/missing → normal.

---

## 5. Verification

```powershell
pnpm install
pnpm -C backend typecheck
pnpm -C backend lint
pnpm -C backend test -- payments
pnpm -C backend test -- moderation
pnpm -C backend test -- notifications
pnpm -C backend test -- ops
pnpm -C backend test
pnpm typecheck; pnpm lint; pnpm test
pnpm -C backend tsx scripts/migrate.ts   # idempotent: 0 created on second run
```

Acceptance = the four suites green on live Atlas + full backend suite (existing 90 + new) green + root typecheck/lint + migrate idempotent + docs synced.

---

## 6. Approval checklist

- [ ] Accept in-process scheduler fallback (BullMQ only when `WORKER=true && REDIS_URL`) — tests need no Redis.
- [ ] Accept operator JWT login endpoint (`POST /ops/auth/login`) and `superadmin` role addition.
- [ ] Accept hand-rolled PDF (no `pdfkit` dependency) and HTTP-only webhook signature contract (no real bKash/Nagad sandbox calls).
- [ ] Accept embedded `supportTickets.messages[]` (no new collection) and `notifications.dedupeKey` unique sparse index.
- [ ] Accept enforcement-gate allowlist expansion (appeals/support/notifications for suspended/banned users).
- [ ] Approve implementation order and docs sync; PROMPT 12 remains untouched.
