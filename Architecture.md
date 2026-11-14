# Trust Bazar — System Architecture

**Version:** 1.1 (Final)
**Date:** 2026-10-17
**Based on:** [PRD.md](PRD.md) v1.7.1 · [database.md](database.md) v1.2
**Changelog v1.1:** OTP store moved to Redis (was wrongly listed as Mongo collection) · `credits`, `categories`, `supportTickets` collections added · TTL list corrected (idempotencyKeys added, otps removed)
**Style:** Layered Monolith · Next.js (web) · Express.js (API) · MongoDB Atlas (data)

---

## 1. Overview & Drivers

Single deployable backend (layered monolith) serving web + mobile clients. Key PRD drivers shaping this architecture:

- OTP-only auth, NID-hash-keyed identity, SIM-swap step-up, 3-device sessions (§3.4.1–3.4.2)
- KYC via Porichoy with files in Cloudflare R2 (direct signed-URL upload) → Wasabi archive; encrypted metadata only in DB (NFR-05/05a/13)
- NID-gated chat, 20/day number-reveal endpoint, offer state machine (§3.2, §3.3.7)
- bKash/Nagad webhooks, idempotency, monotonic payment states, nightly reconciliation (§3.4.5)
- Moderation queues with claim-locks, 4-eyes bans, hash-chained append-only audit log (§3.4.6, §3.6, NFR-04c)
- Degraded modes for every third-party outage (§3.7, NFR-14)
- Idempotency keys on all mutations, optimistic locking, rate-limit table (NFR-15, NFR-04b)

## 2. System Context

```
┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐
│  Web (Next.js)     │   │  Mobile (Android/  │   │  Ops Console       │
│  responsive, SSR   │   │  iOS — see §10)    │   │  (internal, v1     │
│  + PWA optional    │   │                    │   │  minimal UI)       │
└─────────┬──────────┘   └─────────┬──────────┘   └─────────┬──────────┘
          │ HTTPS /api/v1          │                        │
          └────────────────────────┼────────────────────────┘
                                   ▼
              ┌────────────────────────────────────────────┐
              │        Express.js API (Layered Monolith)    │
              │  Routes → Middleware → Controllers →        │
              │  Services → Repositories → Models           │
              │  + Socket.IO gateway (chat)                 │
              │  + Job worker (same process, toggleable)    │
              └───┬───────┬────────┬────────┬───────┬──────┘
                  │       │        │        │       │
        ┌─────────▼──┐ ┌──▼─────┐ ┌▼───────┐┌▼─────┐└▼─────────────┐
        │ MongoDB    │ │ Redis  │ │Cloudflare│ │Wasabi││ External APIs│
        │ Atlas (app │ │ cache/ │ │ R2 (KYC  │ │archive││ Porichoy ·  │
        │ + sessions │ │ queue/ │ │ +listing │ │ 90d   ││ SMS×2 ·     │
        │ + search)  │ │ rate-  │ │ images)  │ │lifecycle│ bKash ·    │
        └────────────┘ │ limit  │ └──────────┘ └───────┘│ Nagad · FCM│
                       └────────┘                       │ /APNs      │
        ┌────────────────┐                              └────────────┘
        │ MongoDB Atlas  │  ◀ separate cluster/db, append-only user,
        │ AUDIT (hash-   │    hash-chained, no update/delete rights
        │ chained log)   │
        └────────────────┘
```

## 3. Client Tier — Next.js (Web)

- **Next.js (App Router), TypeScript.** SSR/SSG for SEO-critical public pages (listing details, category landing) — classifieds live on search traffic; CSR for authenticated areas (dashboard, chat, KYC).
- Responsive web is in PRD scope (NFR-07); mobile apps (Expo, §10) consume the same `/api/v1`.
- Auth tokens: web = `httpOnly, Secure, SameSite=Lax` cookies (access short-lived + refresh rotation); never localStorage on web (XSS, NFR-16).
- Direct-to-R2 uploads via signed URLs from API (files never proxied through API server, NFR-13).
- Bangla/English i18n (next-intl), ৳ formatting, quiet-hours-aware notification center UI.
- Sentry/crash reporting, correlation-ID propagation (NFR-09).

## 4. API Tier — Express.js Layered Monolith

### 4.1 Layers (strict one-way dependency)

```
src/
├── config/          # env parsing + typed config (no secrets in code)
├── routes/          # Express routers, path + method only
├── middleware/      # auth, role guard, rate-limit, idempotency, validation, error, audit
├── controllers/     # HTTP in/out, no business logic
├── services/        # business logic, state machines, transactions
├── repositories/    # Mongo queries only (Mongoose models behind them)
├── models/          # Mongoose schemas
├── integrations/    # porichoy/, sms/, bkash/, nagad/, r2/, fcm/ — vendor adapters behind interfaces
├── jobs/            # scheduled + queue workers (see §7)
├── realtime/        # Socket.IO gateway (chat events)
└── lib/             # crypto, hashing, pagination, errors, logger
```

### 4.2 Modules (bounded contexts inside the monolith)

| Module | Responsibility | Key PRD refs |
|---|---|---|
| `auth` | OTP issue/verify (dual SMS failover), refresh-token rotation, session registry (3 devices, eviction), new-device step-up, anti-enumeration | §3.4.1 |
| `identity` | User profile, role layering, NID-hash identity keying, number change/recovery, deletion (14-day scheduled purge) | §2.1, §3.1.9, §3.4.4 |
| `kyc` | Submission state machine (pending→approved/rejected, pending-vendor), Porichoy adapter, duplicate-ID check, R2 signed-URL issuing, retention jobs | §3.1, NFR-13 |
| `listings` | CRUD, drafts, lifecycle (30d expiry/renew/relist/archive), optimistic locking, duplicate pHash check, prohibited-item pre-check | §3.3 |
| `search` | Query API → Atlas Search; degraded fallback to category browse + cached popular | §3.3.5, §3.7 |
| `chat` | Threads, messages (idempotent send), offer cards + 48h state machine, block/mute, off-platform pattern detection | §3.2 |
| `deals` | Mark-as-Sold dual path (chat-confirmed / direct), dispute records, undo window, KPI events | §3.3.13, §5.5 |
| `payments` | Boost packages, bKash/Nagad adapters, webhook ingestion (signature + IP + idempotency, raw body), monotonic state machine, credits, receipts | §3.4.5 |
| `moderation` | Report intake, claim-locked queues, enforcement ladder (warn/suspend/ban 4-eyes), appeals, SLA clocks (business hours) | §3.3.11, §3.4.6, §3.6 |
| `notifications` | Event bus consumer, template rendering (bn/en), channel router (FCM/APNs/SMS), preferences, quiet hours, coalescing | §3.4.3, Appx D |
| `audit` | Append-only hash-chained writer to separate audit cluster; every sensitive action + KYC document view | NFR-04c |
| `media` | Post-upload pipeline: R2 event → magic-byte verify → AV scan → EXIF strip → re-encode → pHash → clean/quarantine (§5.4) | §3.3.2, NFR-04b/16 |
| `platform` | Feature flags, geo-launch allowlist, client-version gating, rate-limit config | §3.7 |

### 4.3 Cross-cutting middleware (order matters)

1. `requestId` (correlation ID) → 2. `rateLimit` (Redis-backed, per NFR-04b table) → 3. `auth` (JWT verify + device binding) → 4. `enforcementGate` (suspended/banned short-circuit per Appendix B) → 5. `roleGuard` (capability matrix) → 6. `idempotency` (client key → stored result replay) → 7. `validate` (zod schemas = Appendix C rules) → 8. controller → 9. central `errorHandler` (bilingual safe messages, correlation ID, no stack traces).

### 4.4 API Surface Map (v1 route prefixes)

Full OpenAPI spec is generated at build from route definitions; web + mobile clients consume typed contracts.

| Prefix | Module coverage |
|---|---|
| `/api/v1/auth/*` | request-otp, verify-otp, refresh, logout, sessions, recovery |
| `/api/v1/kyc/*` | submit, status, resume, reverify |
| `/api/v1/listings/*` | CRUD, drafts, publish, mark-sold, renew/relist, boost |
| `/api/v1/search/*` | keyword search, filters, trending, price baseline |
| `/api/v1/chat/*` | threads, messages, offers, deal-confirm, block/mute |
| `/api/v1/payments/*` | create, status, receipts, credits (+ `/webhooks/bkash`, `/webhooks/nagad`) |
| `/api/v1/notifications/*` | list, preferences, device tokens |
| `/api/v1/reports`, `/api/v1/appeals`, `/api/v1/support/*` | report intake, appeal submission, support tickets |
| `/api/v1/account/*` | profile, favorites, saved-searches, deletion, devices |
| `/api/v1/ops/*` | KYC queue, moderation cases, bans, appeals, audit (operator JWT + 2FA) |

## 5. Data Tier — MongoDB Atlas

### 5.1 Why it fits

Document model matches listings/threads; **Atlas Search** (Lucene) removes a separate Elasticsearch cluster (monolith-friendly); **TTL indexes** give free expiry for drafts and orphaned uploads (OTPs live in Redis with native TTL; pending-payment expiry is enforced by the payment state machine + jobs); **change streams** feed notifications; transactions cover multi-doc writes (deal state + listing state).

### 5.2 Core collections

| Collection | Notes |
|---|---|
| `users` | `nidHash` (unique, sparse), encrypted PII fields only (NFR-05a), roles[], enforcement{state,until}, sessions[] (max 3, device fingerprint) |
| `credits` | boost credit ledger: source (reconciliation/appeal/goodwill), remaining, 12-month expiry — §3.3.9 |
| `kycSubmissions` | state machine, porichoyTxnId, storage paths (R2 keys), attempt count, appeal ref |
| `listings` | `version` (optimistic lock), status enum (draft/active/pendingConfirm/sold/expired/delisted/archived), expiresAt, pHashes[], boost{until,package} |
| `threads` / `messages` | thread state banner fields; `clientMsgId` unique per sender (idempotent send) |
| `offers` | TTL-style expiry job at 48h; one-pending index (partial unique) |
| `deals` | type (confirmed/direct/unconfirmed), dispute ref — KPI source |
| `payments` | state machine, idempotencyKey unique, gateway refs, credit ledger |
| `reports` / `moderationCases` | claim-lock fields (`claimedBy, lockUntil`), SLA timestamps |
| `appeals` | separate queue, senior-only resolution |
| `notifications` | in-app center records; push delivery state |
| `idempotencyKeys` | key → response snapshot, TTL 24h |
| `mediaObjects` | every upload: owner, purpose (kyc/listing/profile), status (uploaded/scanning/clean/quarantined), pHash, scan results (§5.4) |
| `consents` | versioned consent records per user (KYC upload, deletion) — NFR-05 mandatory |
| `webhookEvents` | raw gateway payloads + signature/processing status — reconciliation & dispute evidence |
| `boostPackages` | server-managed catalog (duration × price × category) — price changes without deploy (§3.3.9) |
| `favorites` / `savedSearches` | saved items & alert configs (digest ≤1/day) |
| `operatorAccounts` | separate from `users`: tier, 2FA ref, IP allowlist |
| `securityEvents` | new-device logins, step-ups, refresh-reuse kills — feeds security notifications |
| `config` | minVersion, privacyConsentVersion, feature flags, geo allowlist |
| `categories` | seeded taxonomy (bn/en), 64-district dataset, price baselines (§11.2#3) |
| `supportTickets` | Contact-Support tickets → same ops queue, 48 business-h SLA (§3.4.7) |
| `auditEvents` (separate cluster) | hash chain: `prevHash`, `hash=sha256(prevHash+payload)` |

*OTPs are NOT a Mongo collection — they live in Redis (`otp:{phone}`, TTL 5 min, hashed, attempts counter) per database.md §1.*

### 5.3 Indexes (critical)

`users.nidHash` unique · `listings: {status, category, location 2dsphere, boost.until}` · `messages: {threadId, createdAt}` · `offers` partial unique (buyer+listing+pending) · `payments.idempotencyKey` unique · TTLs on `kycSubmissions.rejected` (90d), drafts (30d), `idempotencyKeys` (24h); OTPs are Redis TTL keys (`otp:{phone}`, 5 min, hashed + attempts).

### 5.4 Media Processing Pipeline (post-upload)

Direct-to-R2 upload bypasses the API, so all file validation happens **after** upload via an event-driven worker:

```
Client → R2 signed URL → object lands in "incoming/" prefix
  → R2 event notification → media worker downloads object
  → magic-byte verify → AV scan → EXIF strip → re-encode (sharp) → pHash compute
  → PASS: move to "clean/" + mediaObjects{status: clean} → usable in listing/profile
  → FAIL: move to "quarantine/" + mediaObjects{status: quarantined, reason}
          → client notified to re-upload
```

- New `mediaObjects` collection tracks every uploaded object: owner, purpose (`kyc` / `listing` / `profile`), status (`uploaded/scanning/clean/quarantined`), pHash, scan results.
- **Publish gate:** a listing can publish only when its hero photo is `clean` (aligns with PRD §3.7 degraded mode); remaining photos may finish scanning post-publish.
- Same pipeline serves KYC documents (no pHash step), listing photos, and profile photos; orphan `incoming/` objects purged nightly (§7).
- If the pipeline is down, uploads queue in `incoming/` and publishing pauses with a friendly notice — reads/CDN unaffected.
- Profile photos use a separate bucket/prefix (`public-profile/`) through the same pipeline; the KYC bucket stays private with signed-URL-only access.
- Wasabi archive retrievals (e.g., banned-identity evidence for appeals) are rare, ops-initiated, and audit-logged; hours-level retrieval latency is acceptable for that flow.

## 6. Realtime — Chat

- **Socket.IO** embedded in the same Node process (monolith-true); Mongo persistence is source of truth; socket only pushes.
- v1 is **pinned to a single API instance** — Socket.IO without an adapter requires exactly one node. Any scale-out must add the Redis adapter **first** (documented, not built); only then may the instance count increase.
- Push (FCM/APNs) is the offline fallback; in-app center is the durable record.
- Message send = REST POST (idempotent) → socket emit to recipients → push if offline.
- Socket connections authenticate with the same JWT (rejected for banned/restricted sessions); per-connection event rate limit mirrors the REST chat limits (30 msg/min, NFR-04b).

## 7. Background Jobs

**BullMQ + Redis** (Redis already needed for rate-limits/sockets later). Jobs:

| Job | Schedule |
|---|---|
| Payment reconciliation (bKash/Nagad settlement pull → credits) | nightly |
| Listing expiry + renewal reminders (3d, same-day) | hourly |
| Offer expiry (48h), deal-confirm timeout (7d, day-3 reminder) | hourly |
| R2→Wasabi lifecycle verify + orphan upload purge | nightly |
| KYC rejected-retention purge (90d), deleted-account purge (after 14d grace, KYC 3y) | nightly |
| SLA ageing scan (80% highlight, breach alert) | 15 min (business hours) |
| AI async scan dispatch + backfill on recovery | continuous |
| Media scan worker (incoming → clean/quarantine; §5.4) | continuous (event-driven) |
| Audit-chain verification | daily |

Worker runs in the same deployable (env toggle `WORKER=true`); can be split to a second instance without code change.

## 8. Security & Compliance Architecture

- JWT access (15 min, `jose`) + rotating refresh (30d rolling); **refresh-reuse detection** → kill all sessions (SIM-swap/theft signal).
- New-device login on KYC-verified account → risk step-up (device fingerprint + re-OTP; liveness for high-risk) + security notification.
- R2: private buckets, signed-URL TTL ≤ 5 min with content-type/size constraints; KYC bucket separate from listing-images bucket; ops access via Cloudflare Access + logged viewer endpoint (every view audited).
- Field-level encryption (AES-256-GCM, KMS-managed key) for `nid_number`, `name`, `dob`; `nidHash = HMAC-SHA256(nid, serverPepper)` for lookups/bans.
- Webhook endpoints: raw-body signature verification (bKash/Nagad), source-IP allowlist, idempotent handlers, monotonic state guards.
- Operator accounts: separate login with mandatory 2FA + IP allowlist; 4-eyes ban = two signed approvals on one audit record.
- Logs: structured, PII-masked (`0171****123`), no OTP/NID/token ever; CSP/HSTS/cert-pinning per NFR-04.
- **Secrets management:** platform-injected env vars (Doppler/1Password Connect or host secrets); nothing secret in the repo or client binaries; KMS-managed data-encryption keys with annual rotation; R2 API tokens scoped per bucket with delete-protection.
- **Logging & alerting:** structured JSON logs (pino) → hosted sink (30-day retention); Sentry on API + web; uptime checks on `/healthz`; ops-channel alerts for job failures, reconciliation mismatches, queue backlog, socket-disconnect spikes (NFR-09).

## 9. Deployment Topology (v1)

```
Vercel (or VPS+nginx)        Render/Railway/VPS (Docker)
┌────────────────┐          ┌──────────────────────────────┐
│ Next.js web    │ ───────▶ │ API container (Express+Socket│
└────────────────┘          │  + worker, 1 instance (§6))  │
                            └───────┬──────────┬───────────┘
                            MongoDB Atlas M10 │ Redis (Upstash/
                            (app + Atlas Search)│ managed)
                            MongoDB Atlas M0/M2 AUDIT (separate)
```

Single region closest to BD (Singapore/Mumbai); Cloudflare in front (WAF, CDN, Dhaka PoP); daily Atlas backups (RPO 24h / RTO 8h, NFR-08).

### 9.1 Indicative Monthly Cost (Year-1 scale)

| Item | Est. (USD) |
|---|---|
| Vercel (web) | $0–20 |
| API + worker container (1 instance, pinned §6) | $7–25 |
| MongoDB Atlas M10 (app + Atlas Search) | ~$60 |
| Atlas M0/M2 (audit, separate) | $0–9 |
| Upstash Redis (rate-limit + BullMQ) | $0–10 |
| Cloudflare R2 + Wasabi | ~$2 |
| FCM/APNs | $0 |
| **Fixed infra subtotal** | **~$70–125** |
| SMS OTP (largest variable — e.g., 50K OTP/mo via BD aggregator) | ~$100–250 |
| Porichoy KYC calls | per-call vendor pricing (POC pending) |
| bKash/Nagad fees | ~1.5–2% per boost transaction |

### 9.2 Web↔API Cookie & Domain Config

Web and API sit behind the same parent domain (`app.trustbazar.com` + `api.trustbazar.com`) via Cloudflare; auth cookies are scoped to the parent domain (`Domain=.trustbazar.com; Secure; SameSite=Lax; httpOnly`). Vercel preview deployments use an Authorization-header token fallback instead of cookies.

### 9.3 Environments & CI/CD

- **Environments:** dev → staging → prod; staging mirrors prod with sandbox vendors (bKash sandbox, test SMS route, R2 dev bucket).
- **Pipeline (GitHub Actions):** lint → typecheck → unit tests → API integration tests (Mongo in-memory + mocked vendors) → build → deploy (web: Vercel, API: Docker) → smoke test on `/healthz`.
- **DB changes** via versioned migration scripts (indexes + backfills) at deploy time, never by hand; seed scripts for categories/districts/boost packages.
- **Testing baseline:** swapped-ID/IDOR suite (NFR-04a), webhook idempotency replay suite, state-machine transition tests (payment, offer, deal, KYC), media-pipeline fixtures.

## 10. Final Decisions (2026-10-17)

1. **Mobile: React Native + Expo.** One TypeScript codebase for Android+iOS; shares types/zod schemas with web+API via the monorepo; Expo EAS for OTA updates (BD users update slowly); native modules cover Keychain/Keystore, FCM/APNs, camera/liveness. Responsive web remains as the PWA fallback, not the primary mobile channel.
2. **Monorepo: pnpm workspaces.** `web` (Next.js) · `mobile` (Expo) · `backend` (Express) · `packages/shared` (types, zod schemas = PRD Appendix C rules, constants) · `packages/config` (eslint/tsconfig). Single source of truth for client↔API contracts; one CI pipeline.
3. **Chat: embedded Socket.IO** (confirmed). Pinned single API instance in v1; Redis adapter is the pre-requisite for any scale-out (§6).
4. **Bangla search: POC gate before build freeze.** Test Atlas Search Bengali handling on real listing fixtures; if quality is insufficient, ship the fallback = transliteration/keyword field + text index, and re-evaluate dedicated search infra at scale trigger.
5. **Ops console: role-gated `/ops` UI inside Next.js.** Minimal scope: KYC queue with screenshot-blocked viewer, moderation cases, ban 4-eyes flow, appeals, audit view, support tickets. Operator JWT + 2FA + IP allowlist, same RBAC matrix as the API. Raw DB/scripts remain emergency fallback only.
