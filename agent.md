# Trust Bazar — AI Agent Instructions

**Version:** 1.0
**Date:** 2026-11-10
**Purpose:** First file any AI agent must read before touching this project. It defines where truth lives, what must never be broken, how to make a change safely, and which mistakes were already fixed once (do not reintroduce them).

---

## 0. Start Every Session Like This

1. Read this file fully.
2. Read [prompt.md](prompt.md) — build order and phase plan.
3. Open only the source doc(s) relevant to the task (§2 tells you which one wins).
4. Ask the user which parts are already built before assuming anything is missing.

Do **not** start coding from memory of a previous session. Docs are the contract.

---

## 1. What This Project Is

**Trust Bazar** is a Bangladesh-first, verified classifieds marketplace. Identity is OTP-only at signup; NID-based KYC is mandatory for sellers and gates buyer chat ("100% Verified Interactions"). Deals happen offline in cash, so trust is built through verification, chat, offers, deal confirmation, moderation, and an append-only audit log — not escrow.

- Currency: BDT (৳). Languages: **Bangla (default) + English**.
- Deals: offline cash/in-person. Platform monetises **listing boosts** only (bKash/Nagad).
- Primary KPIs: **fraud rate** and **conversion**, both computed over **Confirmed Deals only** (Direct/Unconfirmed tracked separately).

---

## 2. Document Authority (Resolve Conflicts This Way)

| Topic | Authoritative file |
|---|---|
| Product behaviour, business rules, user stories, KPIs, limits, NFRs, permission matrix | [PRD.md](PRD.md) v1.7.1 |
| System structure, modules, middleware order, jobs, deployment, final tech decisions | [Architecture.md](Architecture.md) v1.1 |
| Collections, indexes, transactions, aggregations, ERD | [database.md](database.md) v1.5 |
| Field-level schema + executable Mongoose models | [database_schema.md](database_schema.md) v1.3 |
| HTTP contract: path, method, auth level, body, response, errors, versioning | [API_spec.md](API_spec.md) v1.2 |
| Data flows, process/store numbering (D1–D12, P1–P8, F01–F36) | [dfd.md](dfd.md) v1.1 |
| Build sequence and phase scope | [prompt.md](prompt.md) |
| Legal/vendor pre-launch work | [Pre-Launch_Actions.md](Pre-Launch_Actions.md) |

**Conflict rule:** PRD wins on *what the product does*; database.md wins on *data shape*; API_spec.md wins on *HTTP details*. When two docs disagree, fix the losing doc — never silently pick one. Numeric validation limits always trace back to **PRD Appendix C**.

---

## 3. Architecture Rules (Non-Negotiable)

- **Layered monolith**, single deployable Express API. Strict one-way dependencies:
  `routes → middleware → controllers → services → repositories → models`
  Controllers do HTTP only. Business rules and state machines live in `services`. Mongo queries live in `repositories`.
- **Vendor adapters behind interfaces** in `integrations/` (`porichoy/`, `sms/`, `bkash/`, `nagad/`, `r2/`, `fcm/`). No vendor SDK calls from services directly.
- **Middleware order is fixed** (Arch §4.3):
  `requestId → rateLimit → auth → enforcementGate → roleGuard → idempotency → validate → controller → errorHandler`
- **Socket.IO runs in the same process**, single instance (sticky sessions not configured). Do not add a second API instance for chat without changing this decision explicitly.
- **Job worker is toggleable** via `WORKER=true|false`; same codebase, same process.
- **Clients:** Next.js App Router (web) and React Native/Expo (mobile) both consume the same `/api/v1`.
- **Monorepo:** `backend`, `web`, `mobile`, `packages/shared`, `packages/config`. zod schemas and enums are imported from `@trust/shared` — **never redefined** per app.
- Web auth uses **httpOnly Secure SameSite=Lax cookies**. Mobile uses Keychain/Keystore + `Authorization` header. Never `localStorage` on web.

---

## 4. Canonical Domain Values (Do Not Drift)

### 4.1 Enums

| Entity | Field | Values |
|---|---|---|
| users | `roles[]` | `buyer`, `verifiedBuyer`, `seller` |
| users | `enforcement.state` | `none`, `warned`, `suspended`, `banned` |
| kycSubmissions | `status` | `pending`, `pending-vendor`, `approved`, `rejected` |
| listings | `status` | `draft`, `active`, `pendingConfirm`, `sold`, `expired`, `delisted`, `archived` |
| listings | `condition` | `new`, `likeNew`, `good`, `refurbished`, `forParts` |
| listings | `aiScan.status` | `queued`, `clean`, `flagged` |
| threads | `state` | `active`, `soldBanner`, `buyerBlocked`, `sellerBlocked`, `deletedListing`, `archived`, `frozen` |
| messages | `flags[]` | `offPlatformWarn`, `urlWarn` |
| offers | `status` | `pending`, `accepted`, `declined`, `countered`, `expired` |
| deals | `type` | `confirmed`, `direct`, `unconfirmed` |
| deals | `channel` | `chat`, `phone`, `inPerson` |
| payments | `provider` | `bkash`, `nagad` |
| payments | `state` | `initiated`, `pending`, `success`, `failed`, `expired` |
| moderationCases | `status` | `open`, `claimed`, `closed` |
| auditEvents | `actor` | `user`, `operator`, `system` |
| notificationPrefs | `lang` | `bn`, `en` |
| mediaObjects | `purpose` | `kyc`, `listing`, `profile` |

### 4.2 Numeric limits (source: PRD Appendix C)

| Rule | Value |
|---|---|
| Phone | `^\+8801[3-9]\d{8}$` (E.164) |
| Listing title / description | 10–100 / 20–5000 chars |
| Price | 1–99,999,999 BDT |
| Listing media | 1–10 images (hero = `mediaIds[0]`) |
| Display name | 2–50 chars |
| Message body | 1–2000 chars |
| Report comment | ≤ 1000 chars |
| Freemium | 5 active listings per seller |
| OTP | 6 digits, 5 min TTL, 5/min per phone |
| Sessions | max 3 devices, access 15 min, refresh 30 d rolling |
| KYC attempts | 3 per 30 days |
| KYC rejected file retention | 90 days |
| Retained KYC for deleted accounts | 3 years |
| Account deletion grace | 14 days |
| Offer TTL | 48 hours |
| Deal confirmation window | 7 days (day-3 reminder) |
| Deal undo window | 15 minutes |
| Number reveal cap | 20/day |
| Chat rate | 30 messages/min |
| Reports | max 5/day |
| Moderation SLA | 48 business hours |
| Appeal SLA | 72 business hours (24 h for 7-day suspensions) |
| Permanent ban | 4-eyes (Moderator proposes, Senior approves) |

If a new rule is needed, add it to PRD Appendix C first, then propagate.

---

## 5. Data Rules

- Collection names: **camelCase plural** exactly as in `database.md §1` (26 collections). `auditEvents` lives on a **separate cluster**.
- Primary key is always `_id: ObjectId`. All collections use `timestamps: true` unless stated.
- **TTL indexes must be single-field.** MongoDB rejects compound TTL. Use `partialFilterExpression` to narrow:
  `listingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { status: "draft" } })`
- **Do not enable `optimisticConcurrency`** — the app manages the custom `version` field manually; enabling it creates a conflicting `__v`.
- Partial unique index for offers: `{ buyerId, listingId }` where `status: "pending"` (one pending offer per buyer per listing).
- `messages`: unique `{ threadId, clientMsgId }`; `deals`: unique `listingId`; `users`: unique `phone`, unique sparse `nidHash`.
- **OTPs and rate-limit counters live in Redis**, never in Mongo (`otp:{phone}`, `rl:{bucket}:{id}`).
- **KYC files never go in the DB.** R2 (direct signed-URL upload) → Wasabi archive after 90 days. DB holds only: `user_id`, `nid_number_encrypted`, `name_encrypted`, `dob_encrypted`, `verification_status`, `porichoy_txn_id`, `storage_path`, `audit_log_id`.
- Sensitive PII is encrypted with **AES-256-GCM** (`nidEnc`, `nameEnc`, `dobEnc`). Identity lookups use `nidHash = HMAC-SHA256(nid, PEPPER)`. Never log raw PII.
- District is an **embedded string** validated against `categories.districts[]`. There is no `districts` collection and no `districtId`.
- Index creation goes through a **migration script**, not `autoIndex` in production.
- State-machine monotonicity is enforced in **service code**, not in `$jsonSchema` (validators cannot compare old vs new).

---

## 6. State Machines (Forward-Only)

| Machine | Transitions |
|---|---|
| Payment | `initiated → pending → success \| failed \| expired`. Never backwards on webhook replay. |
| Offer | `pending → accepted \| declined \| countered \| expired` (48 h), one pending at a time. |
| Deal | `unconfirmed` (chat path) → `confirmed` (buyer confirms) or stays `unconfirmed` after 7 d; `direct` from phone/in-person. Undo ≤ 15 min and before buyer response. |
| Listing | `draft → active → pendingConfirm → sold`; side exits `expired`, `delisted`, `archived`. |
| KYC | `pending → pending-vendor → approved \| rejected`; rejection → appeal → re-verify (attempt cap 3/30 d). |
| Enforcement | `none → warned → suspended (7 d) → banned`. Ban requires 4-eyes; NID-hash blocked; listings ended; threads `frozen`. |

Anti-gaming: a chat-path deal confirmation requires `buyerMsgCount ≥ 1`; abnormal patterns get flagged.

---

## 7. API Contract Rules

- Base path `/api/v1`. Path-based versioning; non-breaking changes stay in v1 and bump the `API-Version` response header.
- Success envelope: `{ data, meta: { requestId } }`. Lists add `page`, `limit`, `total`.
- Errors: **RFC-7807** `application/problem+json` with `type`, `title`, `status`, `detail`, `requestId`, optional `errors[]`, `retryable`. Error `type` values are fixed in `API_spec.md §0.5` — reuse them, do not invent new ones casually.
- **Idempotency-Key required on all mutating endpoints** (stored 24 h, response replay).
- Auth levels: Public, Logged-in, Verified Buyer, Seller, Operator (+2FA), None-suspended. Enforcement gate runs before role checks.
- Outdated clients get `426 Upgrade Required`; deprecated endpoints send `Deprecation` + `Sunset`.
- Webhooks: verify signature/IP → archive raw body in `webhookEvents` → return 200 → transition asynchronously via `webhook-drain`; dedupe on `eventId`.
- Degraded responses use `503 degraded` with `retryable: true`, never a silent wrong result.

---

## 8. Security, Privacy, and Audit

- Never log phone numbers, NID values, tokens, or full request bodies containing PII. Mask phone in logs.
- Refresh-token **reuse kills all sessions** (SIM-swap defence) and writes a `securityEvents` record.
- Raw KYC documents are **view-only** through a logged ops endpoint; no download.
- Every sensitive action writes an `auditEvents` entry: KYC decisions, enforcement, payments, support replies, config changes, audit-log views. Chain: `hash = sha256(prevHash + canonical(payload))`; the collection rejects updates/deletes.
- Rate limits are Redis-backed per the NFR-04b table (OTP, chat, reveal, reports, boosts).
- Degraded-mode behaviour must exist for every vendor (Porichoy, SMS, bKash, Nagad, R2, FCM, Atlas Search). Never let one vendor outage fully stop the product.

---

## 9. Coding Conventions

- TypeScript strict everywhere. No `any` at module boundaries; validate with zod there.
- Validation schemas come from `@trust/shared/schemas`. Controllers only call `validate(schema)`.
- Repository functions return plain data; services throw typed domain errors that `errorHandler` maps to RFC-7807.
- Layer-first layout: `backend/src/{controllers,services,repositories,routes,middleware,models,integrations,jobs,realtime,lib,config}/<module>.*.ts` — no `modules/` folder (Architecture §4.1).
- Never import `models` from a controller. Never write raw `req.body` into Mongo.
- Money is stored as integers (BDT, no decimals). Dates are stored UTC, rendered in Asia/Dhaka.
- All user-facing strings exist in **bn + en**. Notification templates are versioned.
- Tests colocated: `*.test.ts` for units, `tests/integration/*` for Mongo-backed flows.

---

## 10. How to Make a Change (Required Sequence)

1. **Read** the relevant section of the authoritative doc. Do not infer behaviour.
2. **Decide the source:** if behaviour changes, edit `PRD.md` first (add a changelog line + bump version).
3. **Propagate in order:** PRD → database.md → database_schema.md → API_spec.md → dfd.md → Architecture.md (only if structural) → prompt.md (only if build order/scope changes).
4. **Grep for stale values** after editing. Patterns worth checking: `9,999,999`, `10–80`, `"fair"`, `plus24h`, `optimisticConcurrency`, `enforcement.status`, `role:` (singular), `API_spce`, `otps` (as a collection), old queue names.
5. **Verify** by re-reading the edited lines and running the relevant tests/build. Never claim a check passed without running it.
6. **Report**: what changed, which docs were touched, what was verified, what remains unverified. If a doc conflicts remain, say so explicitly.

Never leave two docs contradicting each other. "No mistakes accepted" — the user expects a full cross-document audit, not a partial fix.

---

## 11. Known Pitfalls — Never Reintroduce

| # | Pitfall | Correct state |
|---|---|---|
| 1 | Compound TTL index `{status, expiresAt}` | Single-field `expiresAt` + `partialFilterExpression` |
| 2 | `optimisticConcurrency: true` alongside custom `version` | Option removed; version handled in service code |
| 3 | Index on `district` / phantom `District` collection | `location.district` string only |
| 4 | 24-hour deal undo window | 15 minutes |
| 5 | Storing OTPs in a Mongo `otps` collection | Redis `otp:{phone}` |
| 6 | `user.role` (singular) | `roles[]` |
| 7 | `enforcement.status` | `enforcement.state` |
| 8 | `payments.state = "succeeded"` | `success` |
| 9 | Thread states `active\|soldBanner\|frozen` only | 7-value enum (§4.1) |
| 10 | Queue names `media-scan`, `notify` | 12 canonical queues (§11 below) |
| 11 | Price max `9,999,999` | `99,999,999` |
| 12 | Title 10–80 / condition `"fair"` | 10–100 / `refurbished`, `forParts` |
| 13 | `notificationPrefs {push, sms, inApp}` | `{push, sms, digest, lang}` |
| 14 | Claiming Mermaid diagrams in Architecture.md | They are ASCII; dfd.md has the Mermaid |
| 15 | Filename `API_spce.md` | Renamed to `API_spec.md` |
| 16 | Counting all sold listings in fraud/conversion KPIs | Confirmed Deals only |
| 17 | Writing `buyerId` as required on direct deals | Nullable (`channel: phone\|inPerson`) |
| 18 | `districtId` + `ref: "District"` in schemas | Removed |
| 19 | `moderationCases.status` missing while transactions set it | `open\|claimed\|closed` present |
| 20 | Adding `area` to `location` | Not part of the model |

**Canonical BullMQ queues:** `media-pipeline`, `webhook-drain`, `recon`, `lifecycle`, `expiry-reminders`, `offer-expiry`, `deal-timeout`, `breach-notify`, `purge`, `sla-scan`, `saved-search-alerts`, `audit-verify`.

---

## 12. Testing Expectations

- **Unit:** every state machine (payment, offer, deal, KYC, enforcement), zod boundaries, idempotency replay, refresh-reuse.
- **Integration (Mongo in-memory, vendors mocked):** OTP → login → refresh → reuse detection; listing lifecycle; payment webhook replay; **IDOR suite** (user A cannot touch user B's listing/thread/deal); deal anti-gaming (confirm without message → reject).
- **E2E (Playwright):** signup → buyer NID → chat → offer → mark sold → confirm; seller KYC → listing → boost payment (sandbox); report → suspend → appeal.
- **Load/resilience:** 1000 concurrent chat sockets; webhook burst replay; each vendor mocked down to prove degraded mode.

---

## 13. Definition of Done (Per Feature)

- [ ] Endpoint matches `API_spec.md` exactly (path, method, auth, body, response, status codes).
- [ ] zod validation from `@trust/shared` (values match PRD Appendix C).
- [ ] Auth + role + enforcement gate applied.
- [ ] Idempotency on mutations; optimistic lock where `version` exists.
- [ ] Service implements the state machine with a transaction when multi-doc.
- [ ] Mongoose model + indexes from `database.md §4`.
- [ ] Audit event written if sensitive.
- [ ] bn/en strings present for any user-facing output.
- [ ] Unit + integration tests; E2E where a user flow changed.
- [ ] Docs updated (PRD changelog + affected docs) if behaviour changed.

---

## 14. Current Project State

- **Docs:** PRD v1.7.1 · Architecture v1.1 · database v1.5 · database_schema v1.3 · API_spec v1.1 · dfd v1.1 · prompt v1.0 — all cross-checked.
- **Code:** backend build has started. **Ask the user which modules are actually complete** before treating `prompt.md` phases 1–2 as done.
- **Not built:** web, mobile, ops console, integration/load tests.
- **Blocked on humans:** legal counsel sign-off (prohibited-items policy, consent text, retention) and vendor contracts (Porichoy, bKash, Nagad, dual SMS). See [Pre-Launch_Actions.md](Pre-Launch_Actions.md). Item #2 (Porichoy) is a launch blocker.
- **Stack is fixed:** do not swap Express, Next.js, MongoDB Atlas, R2/Wasabi, Upstash Redis, Socket.IO, BullMQ, zod, Mongoose, `jose` without an explicit user decision.

---

## 15. Working With This User

- The user writes in **Banglish** (Bengali in Latin script + English technical terms). Reply in the same style, concise.
- Preferred pattern: **state findings first, wait for approval, then fix** — except when the user says "update koro" / "fix koro", then fix immediately and report.
- The user demands exhaustive consistency ("no mistake accepted"). Verify with tools; never claim something is checked when it is not.
- When editing docs: bump the version and add a changelog line.
- Use relative markdown links (`[PRD.md](PRD.md)`) inside docs; keep file names exact.
