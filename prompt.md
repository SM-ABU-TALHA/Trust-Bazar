# Trust Bazar — Build Prompts (v2.0)

**Purpose:** Step-by-step build guide, split into **22 numbered prompts**. Feed them one at a time. Do not start `PROMPT N+1` until `PROMPT N` acceptance passes.

**Source of truth (never deviate without updating these):**
- [PRD.md](PRD.md) v1.7.1 — product rules, flows, KPIs, NFRs, Appendices B/C/D
- [Architecture.md](Architecture.md) v1.1 — layers, modules, middleware, jobs, deployment
- [database.md](database.md) v1.7 — collections, indexes, transactions, ERD
- [database_schema.md](database_schema.md) v1.4 — field schemas + Mongoose models
- [API_spec.md](API_spec.md) v1.2 — endpoints, versioning, errors
- [dfd.md](dfd.md) v1.1 — data flows and stores
- [agent.md](agent.md) — non-negotiable rules, canonical values, known pitfalls

**Tech stack (fixed):** pnpm monorepo · Express.js · Next.js (App Router) · React Native/Expo · MongoDB Atlas (app + Atlas Search + separate audit cluster) · Upstash Redis · Cloudflare R2 + Wasabi · Socket.IO · BullMQ · zod · Mongoose · `jose`.

**How to run a prompt**

1. Read the "Read first" refs of that prompt.
2. Execute the tasks in order. Tick each one.
3. Run the **Verify** commands. Paste real output — no assumed passes.
4. If a doc contradicts code, fix the doc or the code, never leave both.
5. Update the progress table below.

**Status legend:** ☐ not started · ◐ in progress · ☑ done & verified

---

## Progress Table

| # | Prompt | Scope | Status |
|---|---|---|---|
| 01 | Repo & Shared Contracts | monorepo, `@trust/shared` | ☑ |
| 02 | Cloud, Env & Seed | accounts, `.env`, seed script | ◐ (code done · external accounts pending) |
| 03 | API Skeleton & Middleware | Express app, 8-step pipeline, errors | ☑ |
| 04 | Data Layer | connections, 26 models, indexes, migrations | ☑ |
| 05 | Auth & Sessions | OTP, JWT, refresh rotation, recovery | ☑ |
| 06 | Identity & Account | profile, prefs, deletion, favorites, saved searches | ☑ |
| 07 | Media Upload & Pipeline | R2 signed upload, scan, re-encode, pHash | ☑ |
| 08 | KYC & Porichoy | seller/buyer KYC, vendor callback, retention | ☑ |
| 09 | Listings & Lifecycle | CRUD, publish, renew, mark-sold, undo | ☑ |
| 10 | Search & Taxonomy | Atlas Search, filters, price baseline | ☑ |
| 11 | Chat & Offers | Socket.IO, messages, reveal, offers | ☑ |
| 12 | Deals & KPI | confirm/decline/timeout, KPI events | ☑ |
| 13 | Payments, Boost & Credits | bKash/Nagad, webhooks, recon | ☑ |
| 14 | Moderation & Enforcement | reports, ladder, 4-eyes ban, appeals, support | ☑ |
| 15 | Notifications & Jobs | 17 events, 12 queues, schedules | ☑ |
| 16 | Audit, Platform & Ops APIs | hash chain, config, ops endpoints | ☑ |
| 17 | Web Foundation & Public Pages | Next.js setup, SEO pages, i18n | ☑ |
| 18 | Web Auth, Buyer & Seller Flows | verified flows, error UX | ☐ |
| 19 | Ops Console UI | KYC/moderation/appeals/audit screens | ☐ |
| 20 | Mobile App (Expo) | parity with web, store readiness | ☐ |
| 21 | Testing & Hardening | unit, integration, IDOR, E2E, load | ☐ |
| 22 | Launch Readiness | CI/CD, monitoring, legal, go-live | ☐ |

> **Backend already started?** Prompts 01–16 are backend. Confirm with the user which modules are complete, mark them ☑, and skip — do **not** rebuild silently.

---

## PROMPT 01 — Repo & Shared Contracts

**Goal:** One monorepo where validation and types exist exactly once.

**Read first:** Architecture §4.1 · PRD Appendix C

**Do**
- [ ] Create `pnpm-workspace.yaml`; folders: `backend`, `web`, `mobile`, `packages/shared`, `packages/config`.
- [ ] Root `tsconfig.base.json`, eslint, prettier, `.editorconfig`, `.gitignore`.
- [ ] `packages/shared/src/schemas/` — zod schemas for every rule in PRD Appendix C (phone `^\+8801[3-9]\d{8}$`, title 10–100, description 20–5000, price 1–99,999,999, condition enum, media 1–10, displayName 2–50, message 1–2000, offer amount, report comment ≤1000).
- [ ] `packages/shared/src/types/` — `User`, `Listing`, `Thread`, `Message`, `Offer`, `Deal`, `Payment`, `KycSubmission`, `Notification`.
- [ ] `packages/shared/src/constants/` — all enums (agent.md §4.1), rate-limit table, SLA durations, job names, error types, categories/districts seed list.
- [ ] Export maps: `@trust/shared/schemas`, `/types`, `/constants`. No other package may redefine these.
- [ ] `pnpm lint` and `pnpm typecheck` pass at root.

**Acceptance**
- Importing `@trust/shared/schemas` works from `backend` and `web`.
- A schema test normalizes `01712345678`, `+880 1712-345678` and Bangla digits `০১৭১২৩৪৫৬৭৮` to `+8801712345678`, and rejects invalid operator/length.

**Verify:** `pnpm install && pnpm typecheck && pnpm lint`

---

## PROMPT 02 — Cloud, Env & Seed Data

**Goal:** Every external dependency reachable before writing feature code.

**Read first:** Architecture §9 · database.md §1

**Do**
- [x] `.env.example` with: `MONGO_APP_URI`, `MONGO_AUDIT_URI`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PEPPER`, `ENCRYPTION_KEY`, `R2_*` (account/key/secret/buckets/public URL), `WASABI_*`, `PORICHOY_*`, `SMS_PRIMARY_*`, `SMS_SECONDARY_*`, `BKASH_*`, `NAGAD_*`, `FCM_SERVER_KEY`, `COOKIE_DOMAIN`, `WORKER`, `NODE_ENV`, `APP_BASE_URL`.
- [x] Atlas: app cluster (M10, Atlas Search enabled) — **connected & verified live** · [x] **separate audit cluster** (`cluster01.f5x0bif` — separate replica set, audit creds cannot see `trust_bazar`, 3 audit indexes created & idempotent).
- [ ] R2 buckets: `trustbazar-kyc`, `trustbazar-listings`, `trustbazar-profile`; lifecycle rule KYC → Wasabi after 90 days. ⏳ external — user action
- [ ] Upstash Redis instance; vendor sandboxes: Porichoy, bKash, Nagad, 2× SMS, FCM. ⏳ external — user action (Pre-Launch_Actions.md)
- [ ] DNS: `app.trustbazar.com`, `api.trustbazar.com`; cookie domain `.trustbazar.com`. ⏳ external — user action
- [x] `backend/scripts/seed.ts` — idempotent upserts for `categories` (bn/en names, 64 districts, `priceBaseline {p25,p50,p75}`), `boostPackages` (3/7/15-day), `config` (`minVersion`, `featureFlags`, `geoLaunch`).
- [x] `backend/scripts/migrate.ts` — runs index creation from database.md §4.
- [x] `backend/scripts/healthcheck-vendors.ts` — probes Mongo×2, Redis, and all vendors (OK/SKIP/FAIL table).

**Acceptance**
- [x] `migrate.ts` twice → no duplicate index errors. **Verified live on Atlas:** run 1 = 46 created, run 2 = 0 created / 46 exists.
- [x] `seed.ts` twice → counts unchanged. **Verified live on Atlas:** run 1 = upserted 33, run 2 = upserted 0, counts stable (categories 27, boostPackages 3, config 3).
- Vendor sandbox ping script returns OK per provider. *(script ready; vendors SKIP until sandbox credentials exist)*
- [x] Scripts fail gracefully with a clear missing-env message when `.env` is absent (verified: exit 1 + named vars).
- [x] `healthcheck` → MongoDB Atlas (app) **OK** live (audit/Redis OK once real URIs are added).

**Verify:** `pnpm -C backend tsx scripts/migrate.ts && pnpm -C backend tsx scripts/seed.ts && pnpm -C backend tsx scripts/healthcheck-vendors.ts`

---

## PROMPT 03 — API Skeleton & Middleware

**Goal:** A bootable API where every request flows through one predictable pipeline.

**Read first:** Architecture §4.3 · API_spec §0.1–0.5

**Do**
- [x] `src/app.ts`: helmet, CORS allowlist (`app.trustbazar.com`), `express.json({limit:'2mb'})`, compression, pino HTTP logger.
- [x] `src/server.ts`: HTTP server + boot order (db → redis → routes → jobs if `WORKER=true`).
- [x] Middleware in **this exact order**: `requestId` → `rateLimit` → `auth` → `enforcementGate` → `roleGuard` → `idempotency` → `validate` → controller.
- [x] `errorHandler` (last): maps zod/domain errors → RFC-7807 (`application/problem+json`) with `type`, `title`, `status`, `detail`, `requestId`, `retryable`; no stack traces in prod.
- [x] `GET /healthz` (API §12.1): Mongo + Redis + vendor probe status; `200` healthy, `503` degraded.
- [x] `GET /config` (API §13.1): public bootstrap — `apiVersion`, `minVersion`, `featureFlags`, `geoLaunch`, `serverTime`; cached 60 s.
- [x] Mount `/api/v1` router tree with placeholder modules.

**Acceptance**
- [x] Unknown route → 404 in problem+json with `requestId`. **Verified live.**
- [x] Bad body → 400 `validation_failed` with `errors[]`. **Unit-tested.**
- [x] Missing token on protected route → 401 `unauthenticated`. **Unit-tested.**
- [x] `X-Request-Id` echoed; log line contains it. **Verified live + unit.**
- [x] Bonus covered: 403 role/enforcement, 429 + `Retry-After`, idempotency replay/409, 500 hides internals — **9/9 backend tests pass.**

**Verify:** `pnpm -C backend dev` → `curl localhost:4000/healthz` — **done:** `503 {mongo:true, redis:false}` (degraded until Redis), `/api/v1/config` → 200 from live Atlas seed data.

---

## PROMPT 04 — Data Layer

**Goal:** All 26 collections exist with the exact indexes and guardrails.

**Read first:** database.md §1–5, §9 · database_schema.md §1–4

**Do**
- [x] Two Mongoose connections: app cluster and audit cluster (audit = fail-soft until provisioned; append-only DB grants added at deploy).
- [x] Models for: `users`, `kycSubmissions`, `consents`, `listings`, `boostPackages`, `threads`, `messages`, `offers`, `deals`, `payments`, `webhookEvents`, `idempotencyKeys`, `credits`, `reports`, `moderationCases`, `appeals`, `supportTickets`, `notifications`, `favorites`, `savedSearches`, `mediaObjects`, `categories`, `securityEvents`, `operatorAccounts`, `config`, `auditEvents` — explicit collection names (no pluralization drift).
- [x] Indexes from database.md §4 in `src/db/indexes.ts` (single source for migrate + tests). Critical: `users.phone` unique, `users.nidHash` unique sparse, `messages {threadId, clientMsgId}` unique, `deals.listingId` unique, offers partial-unique `{buyerId, listingId}` where `status:"pending"`, `listings {location.geo: 2dsphere}`, **single-field** TTL on `expiresAt`.
- [x] `$jsonSchema` validators (`strict` + `error`) on 9 core collections — `src/db/validators.ts`.
- [x] Repositories: generic `BaseRepository` + one thin repo per collection in a single registry (`src/repositories/index.ts`); custom queries only where needed (users, listings, messages, offers, notifications).
- [x] No `autoIndex` on any connection; indexes only via `migrate.ts` (which also prunes stale/undeclared indexes).

**Acceptance**
- [x] `migrate.ts` creates every index listed in database.md §4. **Live:** 0 created / 49 present on re-run (idempotent), 1 stale index pruned.
- [x] Inserting duplicate `phone`, duplicate `clientMsgId`, or a second pending offer fails. **Live test:** all 3 reject with E11000.
- [x] TTL index is single-field (compound TTL must not exist). **Live test:** scans every collection's indexes.
- [x] Bonus: `$jsonSchema` rejects bad docs (code 121), deals one-per-listing, audit model append-only. **9/9 live tests pass.**

**Verify:** `pnpm -C backend tsx scripts/migrate.ts && pnpm -C backend test -- data-layer`

**Status:** ☑ — 18/18 backend tests (9 middleware + 9 live Atlas on `trust_bazar_test`).

---

## PROMPT 05 — Auth & Sessions

**Goal:** OTP login with device-bound sessions and SIM-swap defence.

**Endpoints:** API §1.1–1.8

**Read first:** PRD §3.4.1–3.4.2 · API §1 · Architecture §4.2 `auth`

**Do**
- [x] `POST /auth/otp/request`: normalize E.164, 6-digit OTP HMAC-hashed in Redis `otp:{otpId}` (TTL 5 min, attempts, no plaintext), primary SMS → secondary failover (`SMS_PRIMARY_*` → `SMS_SECONDARY_*`, 5 s timeout), never return OTP, phone masked in logs.
- [x] `POST /auth/otp/verify`: find-or-create user; access JWT 15 min (`jose` HS256) + refresh 30 d rolling in httpOnly Secure SameSite=Lax cookie (`.trustbazar.com` in prod only); session array max 3 with oldest evicted by `$slice:-3`; `>5 fails/15 min` → lock 15 min.
- [x] `POST /auth/refresh`: rotation with unique `jti` + **reuse detection** → kill all sessions, `securityEvents{type:'refreshReuse'}`, security SMS (best-effort).
- [x] `POST /auth/logout`, `GET /auth/sessions`, `DELETE /auth/sessions/:id` (cannot revoke current → 409).
- [x] New device on `verifiedBuyer`/seller → `securityEvents{type:'newDevice'}` + `stepUpRequired` in the login response.
- [x] `POST /auth/recover` (lost SIM): validates + stores a `pending-vendor` request (24 h TTL); Porichoy NID verify + liveness completes in PROMPT 08.
- [x] `POST /account/phone/change`: verify old + new OTP; `nidHash` untouched; `phone_in_use` → 409.
- [x] Rate limits: OTP 5/number/day + 60 s resend cooldown (API §1.1) and 10/IP/min; verify 20/IP/15 min; refresh 60/IP/min; phone change 5/h; recover 3/IP/h.
- [x] Auth middleware now runs an optional session-registry check, so logout/reuse invalidates an unexpired access token immediately.

**Acceptance**
- OTP never appears in response or logs. **Verified:** test asserts the body never contains the code; pino redacts `body.phone`/`body.code`; local dev uses a gitignored `.dev-sms-outbox.jsonl` sink when no SMS gateway is configured.
- Reusing a rotated refresh token revokes all 3 sessions. **Verified live:** replay → `401 token_revoked` + "all sessions revoked"; the previously valid access token then fails the session check.
- 4th login evicts the oldest session. **Verified:** test asserts 3 sessions remain and the first device hash is gone.
- Changing phone keeps `nidHash` identical. **Verified:** test asserts phone changed + `nidHash` unchanged.

**Verify:** `pnpm -C backend test -- auth`

**Status:** ☑ — 12/12 auth tests pass (live Atlas `trust_bazar_test_auth`); full backend suite **30/30**; typecheck + lint clean; live curl run on `localhost:4000` confirmed request → verify → sessions → refresh → reuse-kill.

---

## PROMPT 06 — Identity & Account

**Goal:** Profile, preferences, deletion grace, favorites, saved searches.

**Endpoints:** API §7.1–7.8

**Do**
- [x] `GET /me`, `PATCH /me` (displayName 2–50 moderated; photo must be `clean` media).
- [x] `PATCH /me/seller-prefs` (`showPhonePublic`), `PATCH /me/notification-prefs` (`{push,sms,digest,lang}`).
- [x] `POST /me/delete` (+ OTP re-auth) → `deletedAt`, `purgeAt = +14d`, receipt prompt; `POST /me/delete/cancel` restores.
- [x] `POST /account/phone/change` exists (from PROMPT 05).
- [x] Favorites: `POST/DELETE /listings/:id/favorite`, `GET /me/favorites`.
- [x] Saved searches: `GET/POST/DELETE /me/saved-searches` with alert prefs (`query`, `filters`, `frequency`).
- [x] Deleted users: sessions revoked, listings `delisted`, threads `archived` at delete time.

**Acceptance**
- Deleted account cannot log in until cancel; purge job later removes data but keeps KYC 3 y.
- `displayName` with banned words is rejected with `validation_failed`.

**Status:** ☑ — 10/10 account tests pass (live Atlas `trust_bazar_test_account`): profile + moderation, photo ownership, prefs, partial-unique favorite idempotency, saved-search cap 20, 14-day grace with session revocation + delisting + thread archive, OTP-only cancel.

**Verify:** `pnpm -C backend test -- account`

---

## PROMPT 07 — Media Upload & Pipeline

**Goal:** Files never touch the API server; only clean files reach listings.

**Read first:** Architecture §5.4 · NFR-13 · database.md `mediaObjects`

**Do**
- [x] `POST /media/sign` (API §13.2) — issues R2 presigned PUT (5 min TTL, content-type + size cap by purpose, max 10 per call), creates `mediaObjects{status:'uploaded'}`.
- [x] R2 event → `media-pipeline` job: magic-byte check → AV scan → EXIF strip → re-encode (sharp) → pHash → move `incoming/` → `clean/` or `quarantine/`; update `status`.
- [x] Media scan callback (API §12.3, internal only, shared-secret auth) — updates `mediaObjects.status` and listing `aiScan`.
- [x] Quarantined media never returned by any read endpoint.
- [x] KYC bucket is separate and private; reads only via short-lived signed GET logged to audit.

**Acceptance**
- A `.exe` renamed `.jpg` lands in `quarantine/`.
- EXIF GPS removed after pipeline.
- Listing publish blocked while hero media is `scanning`.

**Status:** ☑ — 9/9 media tests pass (live Atlas `trust_bazar_test_media` + local storage driver): magic-byte + executable/length tripwires, real sharp re-encode strips EXIF, pHash + sha256, per-purpose size caps, tampered signature, ownership, internal-secret processing. R2 driver lives behind the same `StorageDriver` interface.

**Verify:** `pnpm -C backend test -- media`

---

## PROMPT 08 — KYC & Porichoy

**Goal:** Seller mandatory KYC, buyer NID gate before chat, compliant retention.

**Endpoints:** API §2.1–2.4, §12.2

**Read first:** PRD §3.1.1–3.1.12 · Architecture §4.2 `kyc` · NFR-05/05a/13

**Do**
- [x] `POST /kyc/seller` (NID front/back + selfie + liveness): media must be `clean`; Porichoy call; state `pending → pending-vendor → approved|rejected`; max 3 attempts/30 d; banned `nidHash` → 403.
- [x] `POST /kyc/buyer` (NID only) — required before chat; UI shows "Verification in review" while pending.
- [x] `GET /kyc/status` (`seller` + `buyer` objects with `reasonCode`).
- [x] `POST /kyc/recover` — liveness only for retained KYC (no new Porichoy call).
- [x] Vendor callback (API §12.2): signature check, idempotent transition, `Porichoy` degraded → `pending-vendor`.
- [x] Encryption: `nidEnc/nameEnc/dobEnc` AES-256-GCM; `nidHash = HMAC-SHA256(nid, PEPPER)`; duplicate `nidHash` → reject.
- [x] Consent record per version in `consents`; rejection reasons from a fixed enum.
- [x] Retention: rejected files purge at 90 d; approved files archive to Wasabi at 90 d; deleted-account KYC kept 3 y.

**Acceptance**
- Unverified buyer cannot create a thread (`403 kyc_required`).
- 4th attempt in 30 d → `422 business_rule`.
- Porichoy timeout → `pending-vendor`, not `rejected`.
- Duplicate NID on another phone → rejected + audit entry.

**Status:** ☑ — 10/10 KYC tests pass (live Atlas `trust_bazar_test_kyc`, vendor stubbed at the boundary): pending-vendor fallback, clean/owned media gate, 3 attempts/30 d, signed raw-body webhook → approval with AES-GCM PII + `nidHash`, duplicate NID rejection + audit, failed liveness, unsigned webhook, OTP-free recovery, banned identity block, `requireKyc` 403 `kyc_required`.

**Verify:** `pnpm -C backend test -- kyc`

---

## PROMPT 09 — Listings & Lifecycle

**Goal:** Full listing lifecycle with concurrency safety and anti-fraud signals.

**Endpoints:** API §3.1–3.8, 3.10

**Read first:** PRD §3.3.1–3.3.9 · database.md `listings`

**Do**
- [x] `POST /listings` (draft): 1–10 media, freemium cap **5 active**, pHash duplicate check, `aiScan.status='queued'`, `version=0`.
- [x] `POST /listings/:id/publish`: hero media `clean`; price-baseline flags non-blocking; `status='active'`, `expiresAt=+30d`.
- [x] `PATCH /listings/:id`: requires `version`; mismatch → `409 version_conflict`; re-run flags.
- [x] `DELETE /listings/:id` → `delisted`; `POST /listings/:id/renew` → `+30d`.
- [x] `POST /listings/:id/sold` dual path: `chat` + `threadId` → deal `unconfirmed` + `undoUntil=+15min`; `phone|inPerson` → deal `direct` with `buyerId=null`.
- [x] `POST /deals/:id/undo` — only inside 15 min and before buyer response.
- [x] `GET /listings/:id` public (no PII, phone hidden unless reveal), `GET /me/listings`.
- [x] Prohibited-item pre-check (title/description keywords) flags for moderation, never silent-block.
- [x] Ownership checks on every mutation (IDOR-safe).

**Acceptance**
- 6th active listing → `422 business_rule`.
- Stale `version` → 409 with no partial write.
- Same image (pHash match) → warning flag stored.
- Non-owner edit → 404/403, never 200.

**Status:** ☑ — 11/11 listing tests pass (live Atlas `trust_bazar_test_listings`): draft v0 + queued scan + advisory price flags, leaf-category/owned/clean media gates, 5-active cap with no partial write, clean-hero publish, atomic `version` CAS (409 + unchanged doc), IDOR 404s on every mutation, duplicate-pHash + prohibited-term flags without blocking, soft delist + renew, chat deal with 15-min undo and anti-gaming `buyerMsgCount`, direct deal, banned-seller hiding + view counter.

**Verify:** `pnpm -C backend test -- listings`

---

## PROMPT 10 — Search & Taxonomy

**Goal:** Fast Bangla/English search with a working degraded fallback.

**Endpoints:** API §3.9

**Read first:** PRD §3.3.5 · Architecture §4.2 `search`, §10 decision #4

**Do**
- [x] Atlas Search index on `listings`: title/description autocomplete, bn/en synonyms, filters (categoryId, district, price, condition, status=active).
- [x] `GET /listings/search?q=&categoryId=&district=&minPrice=&maxPrice=&condition=&sort=` — pagination, boosted listings injected above organic.
- [x] Bengali quality POC: 30 real queries; if precision poor, add transliteration field + fallback text index.
- [x] Degraded mode: Atlas Search down → cached popular listings + category browse; response header `X-Degraded: search`.
- [x] Trending + price baseline: `GET /listings/trending` (API §3.11, cached 10 min/district) and `GET /listings/price-baseline` (API §3.12, from `categories.priceBaseline`; advisory only). Register both **before** `/listings/:id` in the router.

**Acceptance**
- Bangla query returns relevant active listings only.
- Draft/sold/delisted never appear.
- With Atlas Search disabled, `/search` still returns results (degraded), not 500.

**Status:** ☑ — 7/7 search tests pass (live Atlas `trust_bazar_test_search`): active-only + Bangla regex fallback with `X-Degraded: search`, category/condition/price filters, boost injection above organic, pagination + limit validation, 10-min trending cache per district, price baseline `null` under 20 samples, regex metacharacter safety. Index spec in [atlas-search-index.json](file:///c:/dev/Trust-Bazar/backend/scripts/atlas-search-index.json) with `pnpm -C backend atlas:search` (digest-auth Admin API) and the 30-query POC via `pnpm -C backend search:poc`.

**Verify:** `pnpm -C backend test -- search`

---

## PROMPT 11 — Chat & Offers

**Goal:** Verified-only chat, idempotent messages, 48-hour offer machine.

**Endpoints:** API §5.1–5.9

**Read first:** PRD §3.2 · Architecture §6 · database.md `threads/messages/offers`

**Do**
- [x] Socket.IO in-process, JWT handshake auth, per-connection 30 msg/min.
- [x] `POST /chat/threads` — Verified Buyer or seller only; get-or-create by `{listingId,buyerId}`; blocked/suspended/deleted listing → 403.
- [x] `POST /chat/threads/:id/messages` — idempotent `{threadId, clientMsgId}` unique; body 1–2000; pattern scan → `flags[offPlatformWarn|urlWarn]`; increments `buyerMsgCount`.
- [x] `GET /chat/threads`, `GET /chat/threads/:id/messages?before=`.
- [x] `POST /chat/threads/:id/reveal` — 20/day cap, respects `showPhonePublic`, logged.
- [x] `POST /chat/threads/:id/block` → `buyerBlocked|sellerBlocked`; `POST /chat/threads/:id/report`.
- [x] Offers: one `pending` per buyer/listing, amount ≤ price×2, `expiresAt=+48h`; respond accept/decline/counter (acceptance non-binding).
- [x] Thread states honoured: `soldBanner`, `deletedListing`, `archived`, `frozen` block sends.

**Acceptance**
- [x] Retrying the same `clientMsgId` returns the original message, no duplicate. *(verified: `replayed:true`, single row)*
- [x] 21st reveal → `422 business_rule`. *(verified: `reveal_cap_exceeded`)*
- [x] Unverified buyer cannot open a thread. *(verified: `403 kyc_required`)*
- [x] Frozen thread rejects sends with `403 enforcement_blocked`/`state_conflict`. *(verified: frozen → 403, other states → 409)*

**Verify:** `pnpm -C backend test -- chat` — **13/13 pass** (ChatService, routes, Socket.IO). API deltas recorded in `API_spec.md` §13.5.

---

## PROMPT 12 — Deals & KPI

**Goal:** Trustworthy Confirmed Deal records — the only KPI denominator.

**Endpoints:** API §6.1–6.3

**Read first:** PRD §3.3.6, §3.3.13, §1.5 · database.md `deals`

**Do**
- [x] `POST /deals/:id/confirm` (buyer) — requires `buyerMsgCount ≥ 1`; sets `confirmedAt`, listing `sold`, thread `soldBanner`; transaction.
- [x] `POST /deals/:id/decline` — creates `moderationCases` dispute, increments seller `disputes90d`, ≥3/90 d → auto-flag.
- [x] Timeout job touchpoint: day-3 reminder → 7 d → `unconfirmed`.
- [x] KPI event emitted on confirm (`deal.confirmed`) for metrics pipeline.
- [x] Direct deals excluded from confirmed-deal KPIs but counted in "sold directly".

**Acceptance**
- Confirm without any buyer message → `422 business_rule`.
- Confirm after `undoUntil` → `409 state_conflict`.
- Double confirm → idempotent, no second event.
- Direct deal never increments confirmed KPI.

**Verify:** `pnpm -C backend test -- deals`

---

## PROMPT 13 — Payments, Boost & Credits

**Goal:** Money paths that survive retries, replays, and gateway weirdness.

**Endpoints:** API §4.1–4.6, §12.4

**Read first:** PRD §3.4.5, §3.3.9 · Architecture §4.2 `payments`

**Do**
- [x] `GET /boost/packages` (server-driven), `POST /boost/checkout` — price server-side, credits auto-applied, idempotency key, `state='initiated'`, gateway URL returned.
- [x] Webhooks `POST /webhooks/payments/:provider` (`bkash|nagad`): signature + IP allowlist → store raw `webhookEvents` → **200 immediately** → async transition; dedupe on `eventId`.
- [x] Monotonic state machine `initiated → pending → success|failed|expired`; no backward transitions.
- [x] On success: activate `boost{until}`, decrement credit ledger, receipt, notify.
- [x] `GET /payments/:id`, `GET /payments/:id/receipt` (PDF, 12 months), `GET /me/credits`.
- [x] Suspension pauses boost (`pausedAt`, `remainingMs`); resume restores remaining time.
- [x] Nightly `recon`: settlement pull, match `webhookEvents`, orphan success → credit with source `reconciliation`.
- [x] Credits expire after 12 months; ledger is append-only.

**Acceptance**
- Same webhook twice → single activation.
- Failed payment → boost not activated, no credit burned.
- `success → failed` replay is rejected.
- Recon orphan creates credit, not activation.

**Verify:** `pnpm -C backend test -- payments`

---

## PROMPT 14 — Moderation, Enforcement, Appeals & Support

**Goal:** Report → case → decision → appeal, with 4-eyes on bans.

**Endpoints:** API §9.1–9.3, §10.1–10.3, §11.3–11.5

**Read first:** PRD §3.3.11, §3.4.6, §3.6, Appendix B

**Do**
- [x] `POST /reports` — listing/user/message; max 5/day; duplicate open reports merge; reporter identity hidden; SLA 48 h.
- [x] `moderationCases` lifecycle `open → claimed → closed` with claim-lock (`claimedBy`, `lockUntil` 5 min) and SLA timestamps.
- [x] Enforcement ladder: `warn → 7-day suspend → ban`; ban = **4-eyes** (Moderator proposes, Senior approves); NID-hash block; listings ended; threads `frozen`; boost forfeited on fraud, paused on suspension.
- [x] `POST /appeals`, `GET /appeals/:id`; SLA 72 business h (24 h for suspensions); reversal logged separately, original log immutable.
- [x] `POST /support/tickets` — allowed for suspended/banned; SLA 48 h; ticket messages endpoint.
- [x] Ops decision endpoints: KYC approve/reject (reason codes), moderation actions, appeal decisions — all operator-only.
- [x] Every decision writes `auditEvents`.

**Acceptance**
- Suspended user cannot chat/boost/create listing but can appeal and open support.
- Ban without a second senior approval is rejected.
- Reporter identity never exposed to the reported user.
- Claim lock prevents two operators acting on one case.

**Verify:** `pnpm -C backend test -- moderation`

---

## PROMPT 15 — Notifications & Background Jobs

**Goal:** Every app event has a durable notification; every background task has one owner.

**Endpoints:** API §8.1–8.3

**Read first:** PRD Appendix D · Architecture §7

**Do**
- [x] Event bus: domain event → `notifications` record + channel router (I/P/S/Ops).
- [x] Implement all 17 events from PRD Appendix D with bn/en templates; quiet hours 22:00–08:00 (critical events bypass).
- [x] Chat messages coalesced per thread; saved-search digest ≤1/day.
- [x] `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/device-token`.
- [x] 12 BullMQ queues with schedules (tune with ops):

| Queue | Schedule | Purpose |
|---|---|---|
| `media-pipeline` | event-driven | scan, EXIF strip, re-encode, pHash |
| `webhook-drain` | every 1 min | retry failed webhook transitions |
| `recon` | nightly 02:00 | gateway settlement matching |
| `lifecycle` | hourly | listing expiry → `expired` |
| `expiry-reminders` | hourly (batched) | 3-day and same-day |
| `offer-expiry` | hourly | 48 h → `expired` |
| `deal-timeout` | hourly | day-3 reminder, 7-day → `unconfirmed` |
| `purge` | nightly 03:00 | KYC rejected 90 d, accounts 14 d, retained KYC 3 y |
| `sla-scan` | every 15 min (business hours) | 80% highlight, breach alert |
| `saved-search-alerts` | hourly | match → digest |
| `breach-notify` | on event | vendor outage / SLA breach fan-out |
| `audit-verify` | daily 04:00 | hash-chain verification |

- [x] Dead-letter handling + failure alerting per queue; jobs idempotent and safe to re-run.

**Acceptance**
- Re-running any job twice produces no duplicate notifications or state drift.
- Quiet hours suppressed except OTP/enforcement.
- A failed vendor send is retried, not dropped.

**Verify:** `pnpm -C backend test -- notifications jobs`

---

## PROMPT 16 — Audit, Platform & Ops APIs

**Goal:** Tamper-evident audit trail and the operator API surface.

**Endpoints:** API §11.1–11.7, §12.1, §12.4

**Read first:** NFR-04c · Architecture §4.2 `audit`/`platform` · database.md `auditEvents`

**Do**
- [x] `auditEvents` writer: `hash = sha256(prevHash + canonical(payload))`; `pre('save')` blocks non-new docs; separate cluster connection; read-only role elsewhere.
- [x] Log: KYC decisions, KYC document views, enforcement, payments, support replies, config changes, audit-log views.
- [x] Ops auth: `operatorAccounts` + TOTP + IP allowlist; no self-signup; roles `kycReviewer|moderator|seniorModerator`.
- [x] Ops endpoints: `/ops/kyc`, `/ops/kyc/:id/decide`, `/ops/moderation`, `/ops/moderation/:id/action`, `/ops/appeals`, `/ops/appeals/:id/decide`, `/ops/support`, `/ops/audit`, `/ops/reconcile/payments`.
- [x] `GET /config` public (API §13.1) + config editor `GET/PUT /ops/config` (API §11.7) — audit-logged.
- [x] Client-version gate → `426 upgrade_required`; geo-launch allowlist enforced server-side.

**Acceptance**
- Attempting to update/delete an audit doc fails.
- `audit-verify` job passes on an untampered chain and flags a mutated doc.
- Operator without TOTP cannot call `/ops/*`.
- Config change appears in audit within the same request.

**Verify:** `pnpm -C backend test -- audit ops`

---

## PROMPT 17 — Web Foundation & Public Pages

**Goal:** SEO-ready public storefront with bilingual UI.

**Read first:** PRD NFR-07 · Architecture §3

**Do**
- [x] Next.js App Router + TS + Tailwind + `next-intl` (bn default, en toggle) + `@tanstack/react-query`; ৳ formatting.
- [x] Design tokens: colors, type scale, spacing, radius, shadows; shared `Button/Input/Modal/Toast/Badge/Card/Skeleton/EmptyState`.
- [x] Public routes (SSR/ISR): `/`, `/category/[slug]`, `/search`, `/listings/[id]`, `/login`, `/legal/terms`, `/legal/privacy`, `/legal/prohibited`.
- [x] Listing detail: gallery, price, condition, seller card (verified badge, member since, other listings), map, Contact CTA; boosted block above organic.
- [x] SEO: metadata, OpenGraph, sitemap, robots, canonical URLs, listing structured data.
- [x] States for every page: loading skeleton, empty, error, offline.
- [x] Legal pages content sourced from Pre-Launch_Actions.md drafts.

**Acceptance**
- Lighthouse SEO ≥90 on listing detail.
- Bangla/English toggle persists and translates all visible copy.
- Listing page renders server-side (view-source contains title/price).

**Verify:** `pnpm -C web build && pnpm -C web start` → browse routes

---

## PROMPT 18 — Web Auth, Buyer & Seller Flows

**Goal:** Complete authenticated journeys on web, with correct error UX.

**Read first:** PRD §4 user stories · API_spec §0.4–0.5

**Do**
- [ ] Auth: OTP login (request → verify), httpOnly cookie session, silent refresh on 401, logout, session list.
- [ ] Buyer routes: `/verify/nid`, `/chat`, `/chat/[threadId]`, `/favorites`, `/saved-searches`, `/notifications`, `/me`, `/me/settings`, `/me/delete`.
- [ ] Seller routes: `/seller`, `/seller/listings`, `/seller/listings/new`, `/seller/listings/[id]/edit`, `/seller/boost`, `/seller/credits`, `/seller/receipts/[paymentId]`.
- [ ] KYC upload UI: direct-to-R2 presigned PUT with progress, retry, validation messages.
- [ ] Listing create/edit: image reorder (hero = first), category, condition, price with baseline hint, draft autosave.
- [ ] Chat UI: Socket.IO, optimistic echo + rollback, offer cards, reveal button with remaining quota, block/report.
- [ ] Enforcement screen `/restricted` with appeal CTA; support page.
- [ ] Error UX: 401 silent refresh, 403 → screen, 409 → reload prompt, 422 → inline field, 426 → force update modal, 429 → toast with retry-after.

**Acceptance**
- New user can complete OTP → buyer NID → chat → offer → mark sold → confirm without a dead end.
- No token in `localStorage`.
- Suspended account sees `/restricted`, not a broken dashboard.
- All API failures render human bn/en messages.

**Verify:** `pnpm -C web test:e2e -- buyer-seller-flow`

---

## PROMPT 19 — Ops Console UI

**Goal:** Safe internal tooling — read-heavy, audited, role-gated.

**Read first:** PRD §3.4.6, Appendix B · API_spec §11

**Do**
- [ ] `/ops/login` — email + password + TOTP, IP allowlist check.
- [ ] `/ops/kyc` + `/ops/kyc/[id]` — queue, claim lock countdown, media viewer (view-only, no download), approve/reject with reason codes.
- [ ] `/ops/moderation` — cases, filters, claim, actions (warn/suspend/delist), ban **propose/approve** split by role.
- [ ] `/ops/appeals` — senior-only resolution, SLA timer.
- [ ] `/ops/support` — ticket threads, canned replies.
- [ ] `/ops/audit` — read-only chain viewer with filters; viewing is itself audited.
- [ ] `/ops/config` — feature flags, min version, boost packages (audit-logged).
- [ ] SLA badges: on-track / 80% / breached.

**Acceptance**
- `kycReviewer` cannot see moderation actions; `moderator` cannot view audit.
- Ban requires two different operators; UI blocks self-approval.
- Every view of a KYC document creates an audit entry.

**Verify:** manual role matrix walkthrough against PRD Appendix B

---

## PROMPT 20 — Mobile App (Expo)

**Goal:** Feature parity for the flows that matter on phone.

**Read first:** Architecture §10 decision #1 · PRD NFR-07

**Do**
- [ ] Expo + TS, EAS build profiles (dev/preview/prod), OTA channel.
- [ ] Auth: OTP login; tokens in Keychain/Keystore; `Authorization` header (no cookies); silent refresh.
- [ ] Screens: onboarding, home feed, search, category, listing detail, chat inbox, thread, offer sheet, buyer NID, seller KYC (camera + liveness SDK), seller dashboard, create/edit listing, boost checkout, notifications, profile/settings, enforcement, support, appeals.
- [ ] Native: camera, FCM/APNs, maps, native dialer for reveal.
- [ ] Deep links: `trustbazar://listings/:id`, `https://app.trustbazar.com/listings/:id`.
- [ ] Store readiness: privacy policy URL, data-safety form, screenshots, app icons, version gating via `/config`.

**Acceptance**
- OTP → browse → verify → chat works on a real device.
- Push received for new message and deal confirmation.
- Old app version shows force-update screen.
- EAS production build installs and launches.

**Verify:** `pnpm -C mobile eas build --profile preview`

---

## PROMPT 21 — Testing & Hardening

**Goal:** Prove the risky paths, not just the happy path.

**Do**
- [ ] Unit: payment/offer/deal/KYC/enforcement state machines; zod boundaries; idempotency replay; refresh-reuse.
- [ ] Integration (Mongo memory + mocked vendors): auth full flow; listing lifecycle; webhook replay; **IDOR suite** (cross-user listing/thread/deal/message access); deal anti-gaming.
- [ ] E2E (Playwright): signup → buyer NID → chat → offer → sold → confirm; seller KYC → listing → boost (sandbox); report → suspend → appeal.
- [ ] Load: 1000 concurrent chat sockets; webhook burst; `/search` p95 budget.
- [ ] Resilience drill: each vendor (Porichoy, SMS, bKash, Nagad, R2, Atlas Search, FCM) mocked down → verify documented degraded behaviour, no 500s.
- [ ] Security pass: helmet headers, CORS allowlist, rate limits, no PII in logs, dependency audit, secrets absent from repo.
- [ ] Coverage gate: services ≥80%, no failing tests in CI.

**Acceptance**
- IDOR suite passes 100%.
- Degraded-mode test passes per vendor.
- No critical/high dependency vulnerabilities open.

**Verify:** `pnpm test && pnpm -C web test:e2e && pnpm audit --prod`

---

## PROMPT 22 — Launch Readiness

**Goal:** Ship safely, observe everything, recover fast.

**Do**
- [ ] CI/CD: lint → typecheck → unit → integration → build → migrate → deploy (API, web); mobile via EAS.
- [ ] Migrations run as a release step; seed runs separately and is idempotent.
- [ ] Prod infra: Atlas M10 + audit cluster, Upstash, R2/Wasabi lifecycle, Cloudflare DNS + WAF, Sentry, uptime checks on `/healthz`.
- [ ] Monitoring: dashboards for requests/errors/latency, queue depth, webhook failures, KYC SLA, payment success rate; alerts (5xx >1%, queue backlog, vendor down, SLA breach).
- [ ] Backups: Atlas daily snapshot + restore drill documented.
- [ ] Legal: Terms, Privacy, Prohibited Items, consent texts live; counsel sign-off recorded ([Pre-Launch_Actions.md](Pre-Launch_Actions.md)).
- [ ] Vendor contracts live: Porichoy (launch blocker), bKash, Nagad, dual SMS.
- [ ] Store submission: Play + App Store, privacy labels, review notes with test account.
- [ ] Runtime checklist: seeded categories/districts/packages, feature flags off by default, geo-allowlist = one district for soft launch.
- [ ] Runbooks: incident, rollback, refresh-token mass revoke, vendor outage, payment dispute, data-deletion request.

**Acceptance**
- One-command deploy to staging succeeds from clean checkout.
- Restore drill completed within target RTO.
- Soft launch district works end-to-end; other districts blocked by geo allowlist.
- On-call rota + escalation contacts documented.

**Verify:** staging smoke script (health, login, listing, chat, boost sandbox) all green

---

## Global Rules (apply in every prompt)

1. **Shared schemas only:** validation lives in `@trust/shared`; never redefine.
2. **Layering:** controllers do HTTP, services do rules, repositories do queries.
3. **Idempotency** on every mutation (`Idempotency-Key`, 24 h).
4. **Optimistic locking** on listings via `version`; no `optimisticConcurrency`.
5. **Monotonic state machines**; webhook replays are always safe.
6. **PII:** encrypt `nidEnc/nameEnc/dobEnc`, look up only by `nidHash`, never log PII.
7. **Audit** every sensitive action; chain is append-only.
8. **Rate limits** from the NFR-04b table, Redis-backed.
9. **Degraded mode** for every vendor — never a full stop.
10. **bilingual** bn/en for every user-facing string and template.

## Definition of Done (each feature)

- [ ] Endpoint matches API_spec exactly (path, method, auth, body, response, status).
- [ ] zod validation matches PRD Appendix C.
- [ ] Auth + role + enforcement gate applied; IDOR-safe.
- [ ] Idempotency + optimistic lock where applicable.
- [ ] State machine + transaction for multi-doc writes.
- [ ] Model + indexes per database.md.
- [ ] Audit event if sensitive.
- [ ] bn/en copy present.
- [ ] Unit + integration tests; E2E if a user flow changed.
- [ ] Docs updated (changelog + version) if behaviour changed.
