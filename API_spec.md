# Trust Bazar — API Specification

**Version:** 1.6
**Date:** 2026-11-14
**Changelog:** v1.6 — added §13.7 implementation deltas for PROMPT 12 (buyer confirm/decline, 7-day confirm window, dispute auto-flag, deal KPIs) · v1.5 — added §13.6 implementation deltas for PROMPT 13–16 (payments/boost/credits, moderation & enforcement, notifications & jobs, ops console/audit/config) · v1.4 — added §13.5 implementation deltas for PROMPT 11 (message replay, ObjectId cursor, reveal cap, block `side`, offer `reject` alias + `counterAmount`, Socket.IO auth/rate) · v1.3 — added §13.3 media completion/internal processing + §13.4 implementation deltas for PROMPT 06–10 (account deletion OTP, KYC `DUPLICATE_NID`, listing `geo`/leaf category, atomic `version`, deal anti-gaming, search sort enum + `X-Degraded`, price-baseline sample gate) · v1.2 — added §3.11 trending, §3.12 price baseline, §13.1 public `GET /config`, §13.2 media upload signing (`POST /media/sign`) · confirmed operator config is `PUT /ops/config` (§11.7)
**Base URL:** `https://api.trustbazar.com/api/v1`
**Auth:** Bearer JWT (access token, 15 min) in `Authorization` header. Refresh via `/auth/refresh` (httpOnly cookie).
**Content-Type:** `application/json`
**Idempotency:** All mutating endpoints require `Idempotency-Key` header (client-generated UUID). Stored 24h.
**Conventions:** All timestamps ISO-8601 UTC. Pagination `?page=1&limit=20`. Errors use RFC-7807 shape: `{ type, title, status, detail, requestId }`.
**Rate limits:** See PRD Appendix C / NFR-04b.

---

## 0. Conventions

### 0.1 Auth levels
| Level | Meaning |
|---|---|
| **Public** | No token (guest) |
| **Logged-in** | Valid access token (buyer role, OTP-verified) |
| **Verified Buyer** | Logged-in + `verifiedBuyer` in `roles[]` (NID approved) |
| **Seller** | Logged-in + `seller` in `roles[]` (full KYC approved) |
| **Operator** | Operator account + 2FA (TOTP) |
| **None-suspended** | Token valid AND `enforcement.state != "suspended"|"banned"` |

### 0.2 Standard response envelope
```json
{ "data": { ... }, "meta": { "requestId": "uuid" } }
```
Lists: `{ "data": [...], "meta": { "page": 1, "limit": 20, "total": 142 } }`

### 0.3 Error statuses
`400` validation · `401` unauth · `403` forbidden/role · `404` not found · `409` conflict (idempotency replay / state) · `422` business rule · `429` rate limit · `503` degraded (dependency down)

### 0.4 Version Control

**Path-based versioning** is the primary mechanism: `/api/v1/*`.

| Aspect | Strategy |
|---|---|
| **Major version** | In URL path (`/v1`, `/v2`). Bumped only on breaking changes. |
| **Minor version** | Returned in response header `API-Version: 1.x` (feature additions, non-breaking). Clients ignore. |
| **Breaking change** | New `/v(N+1)` path. Old version supported for ≥6 months with `Sunset` header + deprecation notice in response. |
| **Min client version** | Enforced via `config.minVersion` (per platform). Outdated clients get `426 Upgrade Required` with store link. |
| **Deprecation header** | `Deprecation: true` + `Sunset: <date>` on endpoints scheduled for removal. |
| **Feature flags** | Server-driven (`config.featureFlags`) — clients check `GET /config` (or push) to gate UI. |
| **Schema versioning** | Nested resources include `schemaVersion` field when structure changes within a major version. |

**Breaking-change examples (require `/v2`):**
- Removing/renaming a field or endpoint
- Changing a field type or enum values
- Tightening validation (new required field, stricter range)
- Changing auth/permission requirements

**Non-breaking (stay in `/v1`):**
- Adding optional fields, new endpoints, new enum values, new query params
- Loosening validation
- Performance/internal refactors

### 0.5 Error Handling

**Error envelope** (RFC-7807 Problem Details, `Content-Type: application/problem+json`):
```json
{
  "type": "https://api.trustbazar.com/errors/validation_failed",
  "title": "Validation failed",
  "status": 400,
  "detail": "title must be at least 10 characters",
  "requestId": "req_abc123",
  "errors": [
    { "field": "title", "code": "too_short", "message": "must be ≥ 10 chars" }
  ],
  "retryable": false
}
```

**Error code taxonomy** (`type` field, machine-readable):

| HTTP | Type | Retryable | Cause |
|---|---|---|---|
| 400 | `validation_failed` | No | Request body/query fails zod schema |
| 400 | `bad_request` | No | Malformed JSON / missing headers |
| 401 | `unauthenticated` | Yes (refresh) | Missing/invalid/expired token |
| 401 | `token_revoked` | No | Session killed (refresh-reuse / logout) |
| 401 | `step_up_required` | No | New device — requires liveness re-verify |
| 403 | `forbidden` | No | Insufficient role |
| 403 | `enforcement_blocked` | No | Account suspended/banned |
| 403 | `kyc_required` | No | Verified Buyer / Seller KYC needed |
| 404 | `not_found` | No | Resource missing or soft-deleted |
| 409 | `version_conflict` | Yes (re-read & retry) | Optimistic-lock `version` mismatch |
| 409 | `idempotency_replay` | Yes (return cached) | Same key, different payload |
| 409 | `state_conflict` | No | Invalid state transition (e.g., confirm expired deal) |
| 422 | `business_rule` | No | Domain rule (freemium cap, reveal cap, offer cap) |
| 426 | `upgrade_required` | No | Client below min version |
| 429 | `rate_limited` | Yes (after `Retry-After`) | Rate-limit exceeded; header `Retry-After: sec` |
| 500 | `internal_error` | Yes (idempotent only) | Unhandled server error (logs `requestId`) |
| 502/504 | `upstream_error` | Yes | Gateway timeout |
| 503 | `degraded` | Yes | Dependency down (Porichoy/SMS/bKash/R2/AI/search) |

**Retry guidance (clients):**
- **Retry only if** `retryable: true` OR status `429`/`5xx`/`408`/`409(version)`/`401(unauthenticated after refresh)`.
- **Never retry** `400`/`403`/`404`/`422`/`426`.
- **Backoff:** exponential with jitter (base 200ms, max 10s). For `429` honor `Retry-After`.
- **Idempotent-safe retries:** POST/PATCH with `Idempotency-Key` — safe to retry (server returns cached response).
- **Non-idempotent retries:** POST without key (e.g., some webhooks) — use at-least-once with server-side dedupe.

**Server error contract:**
- Every error includes `requestId` → maps to structured log entry (pino) + trace.
- `500` responses never leak stack traces or internal details in production.
- Audit-critical failures (enforcement, payments, KYC) write `auditEvents` even on error path.

**Webhook error handling:**
- Provider webhooks return `200` immediately after signature verification & raw archive (`webhookEvents`); state transition is async (idempotent). Transient processing failures → retry via `webhook-drain` queue.
- Duplicate webhook (`eventId` seen) → `200` with `processed: true`, no re-transition.

---

## 1. Auth & Sessions

### 1.1 Request OTP
- **POST** `/auth/otp/request`
- **Auth:** Public
- **Body:** `{ "phone": "+8801712345678" }`
- **Response 200:** `{ "data": { "otpId": "uuid", "expiresInSec": 300 } }`
- **Rate:** 5/number/day (PRD NFR-04b), 10/ip/min anti-abuse. On anomaly → CAPTCHA challenge.
- **Notes:** Normalizes to E.164. OTP never returned.

### 1.2 Verify OTP + login
- **POST** `/auth/otp/verify`
- **Auth:** Public
- **Body:** `{ "otpId": "uuid", "code": "123456", "deviceFp": "sha256...", "platform": "web|android|ios" }`
- **Response 200:** `{ "data": { "user": { id, roles, enforcement }, "isNew": true, "stepUpRequired": false, "accessToken": "jwt", "expiresInSec": 900, "refreshExpiresAt": "ISO" } }` + httpOnly refresh cookie (30d rolling).
- **Behavior:** New device on verified buyer/seller → `stepUpRequired:true` + `securityEvents{type:"newDevice"}`. Max 3 sessions; the 4th login evicts the oldest. Banned identity → `403 enforcement_blocked`. Failed >5/15min → lock 15min.
- **422:** `otp_expired` / `otp_incorrect` / `otp_attempts_exhausted` / `otp_phone_mismatch`.

### 1.3 Refresh token
- **POST** `/auth/refresh`
- **Auth:** httpOnly refresh cookie
- **Response 200:** `{ "data": { "accessToken": "jwt", "expiresInSec": 900, "refreshExpiresAt": "ISO" } }` + rotated httpOnly cookie.
- **Security:** Refresh-reuse detection → reuse kills all sessions (SIM-swap signal), writes `securityEvents{type:"refreshReuse"}`, and the access token's session check fails immediately.

### 1.4 Logout (current session)
- **POST** `/auth/logout`
- **Auth:** Logged-in
- **Response 204** — revokes current refresh token.

### 1.5 List active sessions
- **GET** `/auth/sessions`
- **Auth:** Logged-in
- **Response 200:** `{ "data": [{ id, platform, lastUsedAt, issuedAt, current: true }] }`

### 1.6 Revoke session
- **DELETE** `/auth/sessions/:sessionId`
- **Auth:** Logged-in
- **Response 204** — cannot revoke current (use logout).

### 1.7 Change phone number
- **POST** `/account/phone/change`
- **Auth:** Logged-in
- **Body:** `{ "newPhone": "+880...", "otpId", "code", "currentOtpId", "currentCode" }`
- **Response 200:** `{ "data": { "phone": "+880..." } }`
- **Rate:** 5/hour per user.
- **Notes:** Verifies old + new OTP. `nidHash` identity unchanged. `409 state_conflict` when the new number is taken. `securityEvents{type:"phoneChange"}`.

### 1.8 Lost-SIM recovery
- **POST** `/auth/recover`
- **Auth:** Public
- **Body:** `{ "nidFrontMediaId", "nidBackMediaId", "selfieMediaId", "livenessId" }`
- **Response 200:** `{ "data": { "recoveryId": "uuid" } }`
- **Rate:** 3/ip/hour.
- **Behavior:** Registers a `pending-vendor` request (24h TTL). Porichoy NID verify + liveness is completed by the KYC module (PROMPT 08) before a recovery token is issued.

---

## 2. KYC & Identity

### 2.1 Initiate seller KYC
- **POST** `/kyc/seller`
- **Auth:** Logged-in (none-suspended)
- **Body:** `{ "nidFrontMediaId", "nidBackMediaId", "selfieMediaId", "livenessId?", "consentVersion": "v1" }`
- **Response 201:** `{ "data": { "submissionId", "status": "pending|pending-vendor" } }`
- **Rules:** max 3 attempts/30d; banned NID → 403.

### 2.2 Initiate buyer NID verification
- **POST** `/kyc/buyer`
- **Auth:** Logged-in
- **Body:** `{ "nidFrontMediaId", "nidBackMediaId", "consentVersion": "v1" }`
- **Response 201:** `{ "data": { "submissionId", "status": "pending" } }`
- **Notes:** Required before chat. Pending users get "Verification in review" state on Contact button.

### 2.3 Get KYC status
- **GET** `/kyc/status`
- **Auth:** Logged-in
- **Response 200:** `{ "data": { "seller": { status, reasonCode? }, "buyer": { status, reasonCode? } } }`

### 2.4 Re-verify after account deletion (retained KYC)
- **POST** `/kyc/recover`
- **Auth:** Logged-in (liveness token)
- **Body:** `{ "selfieMediaId", "livenessId" }`
- **Response 200:** `{ "data": { "verified": true } }`
- **Notes:** Uses retained KYC (3y) — liveness only, no new Porichoy call.

---

## 3. Listings

### 3.1 Create listing (draft)
- **POST** `/listings`
- **Auth:** Seller (none-suspended)
- **Body:** `{ "title", "description", "price", "condition", "categoryId", "district", "geo": { "coordinates": [lng,lat] }, "mediaIds": ["oid"...], "pHashes": [...] }`
- **Response 201:** `{ "data": { "id", "status": "draft", "expiresAt", "aiScan": { "status": "queued" } } }`
- **Rules:** 1–10 images, hero = mediaIds[0]. Freemium cap = 5 active (PRD §11.2#1). Title 10–100, desc 20–5000, price 1–99,999,999.

### 3.2 Publish listing
- **POST** `/listings/:id/publish`
- **Auth:** Seller (owner, none-suspended)
- **Body:** none
- **Response 200:** `{ "data": { "id", "status": "active", "expiresAt" } }`
- **Rules:** hero photo scan must be `clean`; price baseline flags non-blocking; `aiScan` must be clean or flagged-but-not-blocked category.

### 3.3 Update listing
- **PATCH** `/listings/:id`
- **Auth:** Seller (owner, none-suspended)
- **Body:** partial of fields (title, price, description, mediaIds, ...)
- **Response 200:** `{ "data": {...} }`
- **Rules:** price/condition editable; if status active, re-runs price-baseline flag. Optimistic `version` required → 409 on mismatch.

### 3.4 Delete listing
- **DELETE** `/listings/:id`
- **Auth:** Seller (owner)
- **Response 204** — soft-delete (status `delisted`); media purged by job.

### 3.5 Renew listing
- **POST** `/listings/:id/renew`
- **Auth:** Seller (owner)
- **Response 200:** `{ "data": { "expiresAt" } }` — resets 30d.

### 3.6 Mark as sold (deal start)
- **POST** `/listings/:id/sold`
- **Auth:** Seller (owner, none-suspended)
- **Body:** `{ "channel": "chat|phone|inPerson", "buyerId": "oid|null", "threadId": "oid|null" }`
- **Response 201:** `{ "data": { "dealId", "type", "undoUntil" } }`
- **Rules:**
  - `chat` + `threadId` → buyer derived, type `unconfirmed` (buyer must confirm); `undoUntil` = now+15min.
  - `phone|inPerson` → `buyerId` optional, type `direct`; bypasses chat-thread requirement (MF-01 fix).
  - Anti-gaming: `chat` confirm requires `buyerMsgCount ≥ 1`.

### 3.7 Undo mark-sold
- **POST** `/deals/:id/undo`
- **Auth:** Seller (owner)
- **Response 200:** `{ "data": { "listing": { "status": "active" } } }`
- **Rules:** only within `undoUntil` AND buyer has not responded.

### 3.8 Get listing detail
- **GET** `/listings/:id`
- **Auth:** Public
- **Response 200:** `{ "data": { id, title, price, condition, media, seller: { id, displayName, memberSince, verified }, stats: { views }, boost: { active } } }`
- **Notes:** boosts inject above organic. Deleted/archived → 404. Banned seller listings hidden.

### 3.9 Search listings
- **GET** `/listings/search?q=&categoryId=&district=&minPrice=&maxPrice=&condition=&sort=price|date|relevance`
- **Auth:** Public (logged-in for personalized)
- **Response 200:** `{ "data": [...], "meta": { page, limit, total } }`
- **Notes:** Atlas Search (bn/en). Pagination capped 50. Cached popular listings as degraded fallback (Arch §3.7).

### 3.10 Seller's own listings
- **GET** `/me/listings?status=`
- **Auth:** Seller
- **Response 200:** `{ "data": [...], "meta": {...} }`

### 3.11 Trending listings
- **GET** `/listings/trending?district=&limit=10`
- **Auth:** Public
- **Response 200:** `{ "data": [{ id, title, price, heroMediaUrl, district, boosted }] }`
- **Notes:** cached 10 min per district (Redis). Used on home page and category landing. Degraded → last cached snapshot.

### 3.12 Price baseline
- **GET** `/listings/price-baseline?categoryId=&condition=`
- **Auth:** Public
- **Response 200:** `{ "data": { "p25": 12000, "p50": 18000, "p75": 25000, "sampleSize": 412, "updatedAt": "..." } }`
- **Notes:** reads `categories.priceBaseline {p25,p50,p75}`. Advisory only — never blocks publish (PRD §3.3.4). `sampleSize < 20` → `{ "data": null }`.

---

## 4. Boost & Payments

### 4.1 List boost packages
- **GET** `/boost/packages`
- **Auth:** Logged-in
- **Response 200:** `{ "data": [{ id, name, durationDays, price, placement, active }] }`

### 4.2 Initiate boost payment
- **POST** `/boost/checkout`
- **Auth:** Seller (none-suspended)
- **Body:** `{ "packageId", "listingId", "provider": "bkash|nagad", "creditApply": true }`
- **Response 201:** `{ "data": { "paymentId", "state": "pending", "gatewayUrl", "creditApplied" } }`
- **Rules:** idempotency key required. Price resolved server-side (no client trust). Credits auto-applied.

### 4.3 Payment callback (gateway webhook)
- **POST** `/webhooks/payments/:provider`
- **Auth:** Provider signature + source-IP allowlist
- **Body:** raw gateway payload
- **Response 200:** `{ "received": true }`
- **Behavior:** Verify signature → store `webhookEvents` (raw) → idempotent state transition → on success: activate boost, issue receipt, notify. Reconciliation job handles missed webhooks.

### 4.4 Get payment status
- **GET** `/payments/:id`
- **Auth:** Seller (owner)
- **Response 200:** `{ "data": { id, state, receiptNo } }`

### 4.5 Download receipt
- **GET** `/payments/:id/receipt`
- **Auth:** Seller (owner)
- **Response 200:** PDF stream
- **Notes:** 12-month access; post-deletion via support within retention window.

### 4.6 Credits balance & history
- **GET** `/me/credits`
- **Auth:** Logged-in
- **Response 200:** `{ "data": { "balance": 120, "entries": [...] } }`

---

## 5. Chat & Offers

### 5.1 Get/create thread (Contact seller)
- **POST** `/chat/threads`
- **Auth:** Verified Buyer (none-suspended)
- **Body:** `{ "listingId" }`
- **Response 200:** `{ "data": { "threadId", "state" } }`
- **Rules:** returns existing if present. Blocked/suspended seller → 403 with state message. Seller banned → frozen thread.

### 5.2 List my threads
- **GET** `/chat/threads`
- **Auth:** Logged-in
- **Response 200:** `{ "data": [{ id, listingId, otherParty, lastMessage, unread, state }] }`

### 5.3 Send message
- **POST** `/chat/threads/:id/messages`
- **Auth:** Logged-in (thread participant, none-suspended)
- **Body:** `{ "clientMsgId": "uuid", "body": "..." }`
- **Response 201:** `{ "data": { id, createdAt, flags: [] } }`
- **Rules:** body 1–2000 chars; idempotent on (threadId, clientMsgId); rate 30 msg/min. Pattern scan flags `offPlatformWarn`/`urlWarn`. Buyer message increments `buyerMsgCount`.

### 5.4 List messages
- **GET** `/chat/threads/:id/messages?before=`
- **Auth:** Participant
- **Response 200:** `{ "data": [...], "meta": { nextCursor } }`

### 5.5 Reveal seller phone
- **POST** `/chat/threads/:id/reveal`
- **Auth:** Verified Buyer
- **Response 200:** `{ "data": { "phone": "+880...", "revealCountToday": 3 } }`
- **Rules:** cap 20/day (PRD Appx C). Seller can hide via `sellerPrefs.showPhonePublic=false`. Logged as `callTaps` source.

### 5.6 Block user
- **POST** `/chat/threads/:id/block`
- **Auth:** Participant
- **Body:** `{ "side": "buyer|seller" }`
- **Response 204** — thread state `buyerBlocked`/`sellerBlocked`; number reveal hidden.

### 5.7 Report conversation
- **POST** `/chat/threads/:id/report`
- **Auth:** Participant
- **Body:** `{ "category", "comment?" }`
- **Response 201:** `{ "data": { "reportId" } }` — creates moderation case with transcript.

### 5.8 Submit offer
- **POST** `/chat/threads/:id/offers`
- **Auth:** Buyer
- **Body:** `{ "amount": 50000 }`
- **Response 201:** `{ "data": { "offerId", "status": "pending", "expiresAt" } }`
- **Rules:** amount ≤ listing.price×2; one pending offer per buyer per listing (partial-unique index). 48h TTL.

### 5.9 Respond to offer
- **POST** `/offers/:id/respond`
- **Auth:** Seller
- **Body:** `{ "action": "accept|reject", "counterAmount?" }`
- **Response 200:** `{ "data": { "status" } }`
- **Notes:** acceptance is non-binding (listing stays active).

---

## 6. Deals & Confirmation

### 6.1 Confirm deal (buyer)
- **POST** `/deals/:id/confirm`
- **Auth:** Buyer (the selected buyer)
- **Body:** `{ "confirmed": true }`
- **Response 200:** `{ "data": { "type": "confirmed", "confirmedAt" } }`
- **Rules:** closes listing (`sold`), thread `soldBanner`. Confirmed Deals only count in fraud KPI.

### 6.2 Decline deal confirmation (dispute)
- **POST** `/deals/:id/decline`
- **Auth:** Buyer
- **Body:** `{ "reason": "..." }`
- **Response 200:** `{ "data": { "disputeRef": "oid" } }`
- **Rules:** creates moderation case; seller's `disputes90d` increments. ≥3 disputes/90d → auto-flag (PRD P4).

### 6.3 Deal timeout (system)
- Internal job (`offer-expiry` queue) — marks `unconfirmed` after 7d with day-3 reminder.

---

## 7. User Profile & Account

### 7.1 Get my profile
- **GET** `/me`
- **Auth:** Logged-in
- **Response 200:** `{ "data": { id, phone, roles, profile, enforcement, notificationPrefs } }`

### 7.2 Update profile
- **PATCH** `/me`
- **Auth:** Logged-in
- **Body:** `{ "displayName": "...", "photoMediaId": "oid" }`
- **Response 200:** `{ "data": {...} }`
- **Rules:** displayName 2–50, moderated (profanity/impersonation); photo must be `clean` scan.

### 7.3 Seller preferences
- **PATCH** `/me/seller-prefs`
- **Auth:** Seller
- **Body:** `{ "showPhonePublic": true }`

### 7.4 Notification preferences
- **PATCH** `/me/notification-prefs`
- **Auth:** Logged-in
- **Body:** `{ "push", "sms", "digest", "lang" }`

### 7.5 Request account deletion
- **POST** `/me/delete`
- **Auth:** Logged-in + re-OTP
- **Body:** `{ "reason?" }`
- **Response 200:** `{ "data": { "purgeAt": "2026-11-12T..." } }` — 14-day grace; downloadable receipts prompt.

### 7.6 Cancel deletion
- **POST** `/me/delete/cancel`
- **Auth:** Logged-in
- **Response 200**

### 7.7 Saved searches
- **POST/GET/DELETE** `/me/saved-searches`
- **Auth:** Logged-in — CRUD with `query`, `filters`, `frequency`.

### 7.8 Favorites
- **POST/DELETE** `/listings/:id/favorite`
- **Auth:** Logged-in
- **GET** `/me/favorites`

---

## 8. Notifications

### 8.1 List notifications
- **GET** `/notifications?read=false`
- **Auth:** Logged-in
- **Response 200:** `{ "data": [...] }`

### 8.2 Mark read
- **POST** `/notifications/:id/read`
- **Auth:** Logged-in
- **Response 204**

### 8.3 Register push token
- **POST** `/notifications/device-token`
- **Auth:** Logged-in
- **Body:** `{ "token", "platform": "fcm|apns" }`

---

## 9. Reports & Appeals

### 9.1 Report listing/user/message
- **POST** `/reports`
- **Auth:** Logged-in
- **Body:** `{ "targetType": "listing|user|message", "targetId", "category", "comment?" }`
- **Response 201:** `{ "data": { "reportId" } }` — moderation case opened, SLA 48h.

### 9.2 Submit appeal
- **POST** `/appeals`
- **Auth:** Logged-in
- **Body:** `{ "type": "kyc|enforcement", "caseId", "body" }`
- **Response 201:** `{ "data": { "appealId", "slaDue" } }` — 72h (24h for suspension).

### 9.3 Appeal status
- **GET** `/appeals/:id`
- **Auth:** Owner

---

## 10. Support

### 10.1 Create support ticket
- **POST** `/support/tickets`
- **Auth:** Logged-in (banned users allowed — PRD P1)
- **Body:** `{ "category", "subject", "body", "attachmentMediaId?" }`
- **Response 201:** `{ "data": { "ticketId", "slaDue" } }` — 48h SLA.

### 10.2 List my tickets
- **GET** `/me/support/tickets`
- **Auth:** Logged-in

### 10.3 Ticket messages
- **GET/POST** `/support/tickets/:id/messages`
- **Auth:** Owner

---

## 11. Operator Console (role-gated)

All require **Operator** auth + TOTP + IP allowlist.

### 11.1 KYC review queue
- **GET** `/ops/kyc?status=pending&claim=true`
- **Auth:** Operator (kycReviewer)
- **Response 200:** `{ "data": [...] }` — claim-locks for 5 min.

### 11.2 KYC decision
- **POST** `/ops/kyc/:id/decide`
- **Body:** `{ "decision": "approve|reject", "reasonCode?" }`
- **Rules:** 4-eyes for ban; audit-logged.

### 11.3 Moderation queue
- **GET** `/ops/moderation?status=open`
- **POST** `/ops/moderation/:id/action`
- **Body:** `{ "action": "dismiss|warn|suspend|delist|ban", "reasonCode" }`
- **Rules:** ban → 4-eyes (senior). Audit + notification fired.

### 11.4 Appeal review
- **GET** `/ops/appeals`
- **POST** `/ops/appeals/:id/decide`
- **Body:** `{ "outcome": "uphold|reverse", "reason" }`
- **Rules:** senior ≠ original actor. Reversal audit-logged.

### 11.5 Support tickets
- **GET** `/ops/support` / **POST** `/ops/support/:id/reply`

### 11.6 Audit log viewer
- **GET** `/ops/audit?entityType=&entityId=&from=&to=`
- **Auth:** Superadmin
- **Response 200:** read-only, every access logged.

### 11.7 Config / feature flags
- **GET/PUT** `/ops/config`
- **Auth:** Superadmin — `featureFlags`, `geoLaunch`, `minVersion`, `boostPackages`.

---

## 12. Internal / Infra

### 12.1 Health
- **GET** `/healthz`
- **Auth:** Public
- **Response 200:** `{ "status": "ok", "deps": { "mongo": "up", "redis": "up", "porichoy": "degraded" } }`

### 12.2 Porichoy callback (vendor)
- **POST** `/webhooks/porichoy`
- **Auth:** Vendor signature
- **Behavior:** KYC state transition `pending-vendor → approved/rejected`.

### 12.3 Media scan callback (worker)
- Internal — updates `mediaObjects.status` (`clean`/`quarantined`) + listing `aiScan`.

### 12.4 Reconciliation trigger (manual ops)
- **POST** `/ops/reconcile/payments`
- **Auth:** Superadmin — triggers nightly recon on demand.

---

## 13. Platform & Media

### 13.1 Public platform config
- **GET** `/config`
- **Auth:** Public
- **Response 200:**
```json
{
  "data": {
    "apiVersion": "1.2",
    "minVersion": { "web": "1.0.0", "android": "1.0.0", "ios": "1.0.0" },
    "featureFlags": { "savedSearchAlerts": true, "boostCheckout": true },
    "geoLaunch": ["Dhaka"],
    "serverTime": "2026-11-10T10:00:00Z"
  }
}
```
- **Notes:** cached 60 s (Redis). Clients call once on boot; when their build is below `minVersion`, server returns `426 upgrade_required` on any API call. Managed by `PUT /ops/config` (§11.7).

### 13.2 Media upload signing
- **POST** `/media/sign`
- **Auth:** Logged-in (none-suspended)
- **Body:** `{ "purpose": "kyc|listing|profile", "contentType": "image/jpeg", "sizeBytes": 245760, "count": 1 }`
- **Response 201:** `{ "data": { "uploads": [{ "mediaId", "key", "uploadUrl", "expiresInSec": 300 }] } }`
- **Rules:**
  - `count` 1–10; listing images ≤ 10 MB each; JPEG/PNG/WebP only.
  - Creates `mediaObjects { ownerId, purpose, r2Key, status: "uploaded" }`.
  - `uploadUrl` is a presigned R2 `PUT` valid 5 min — the file **never** passes through the API server (NFR-13).
  - Bucket is chosen server-side by `purpose` (`trustbazar-kyc` / `trustbazar-listings` / `trustbazar-profile`).
  - Listing publish is blocked until the hero media reaches `clean` (via §12.3 callback).
- **Errors:** `422 business_rule` (size/type/count cap), `429 rate_limited` (sign cap per user), `503 degraded` (R2 unavailable).

### 13.3 Media completion & processing (implemented in PROMPT 07)
- **POST** `/media/:id/complete` — client calls after the direct upload; owner-only, runs the pipeline synchronously in dev (magic bytes → malware tripwire → sharp re-encode → pHash). **200** with `{ mediaId, status: "clean"|"quarantined", width, height }`; quarantined uploads answer **422 `media_quarantined`** (the object is never readable).
- **POST** `/internal/media/:id/process` — server-to-server worker endpoint, `x-internal-secret`. **404** when `INTERNAL_SECRET` is unset.
- **PUT/GET** `/media/blob` — local storage driver only (`STORAGE_DRIVER=local`); HMAC-signed, 12 MB body cap. In production `uploadUrl`/`url` point at R2 signed URLs instead.

---

## 13.4 Implementation deltas (PROMPT 06–10)

These refine the endpoints above; where they differ, implementation behaviour below wins.

| Topic | Delta |
|---|---|
| Saved-search frequency | `frequency: "instant" \| "daily"` (default `daily`). |
| `POST /me/delete` | Body requires OTP re-auth `{ "otpId", "code" }`; the OTP must belong to the account phone (`422 otp_phone_mismatch`). Clears sessions, delists active/pending listings, archives threads. |
| `POST /me/delete/cancel` | OTP-based (sessions are already revoked), `422 account_not_pending_deletion` when no grace is active. |
| KYC reason codes | Fixed enum now includes `DUPLICATE_NID` (§2.4). Buyer submissions carry NID only (`selfieId` optional). |
| KYC callback | `POST /webhooks/porichoy` is signed over the **raw** bytes (`x-porichoy-signature`, `sha256=<hex>`); replays are idempotent. |
| Listing create | `geo` is required (`{ "type": "Point", "coordinates": [lng, lat] }`) — enforced by the `listings` validator and the 2dsphere index. `categoryId` must be a **leaf** ObjectId (`400 category_not_leaf`). |
| Listing publish errors | `422 active_listing_limit` (6th active), `422 hero_not_clean`, `422 media_required`, `409 already_published` / `listing_not_publishable` / `listing_state_changed`. |
| Listing update | `version` is compared inside the atomic filter — stale writes return `409 version_conflict` and never partially apply. |
| Mark sold | `chat` requires `threadId` + `buyerId`, and `thread.buyerMsgCount ≥ 1` (`422 buyer_message_required`). `phone\|inPerson` stores `buyerId=null`, `undoUntil=null`. |
| Undo | `409 undo_window_expired` after 15 min, `409 deal_already_responded` once confirmed/disputed. |
| Search sort | `sort = relevance \| price_asc \| price_desc \| date_desc` (default `relevance`). |
| Search degraded | If Atlas Search is disabled or fails, the endpoint serves the regex fallback with `X-Degraded: search` (never 500). `page/limit` max 50. |
| Trending | `?district=&limit=` (≤ 50, default 10), cached 10 min per district in KV. |
| Price baseline | `?categoryId=&condition=` → `{ data: null }` when the active sample is **< 20**; otherwise `{ p25, p50, p75, sampleSize, updatedAt }`. Advisory only. |

---

## 13.5 Implementation deltas (PROMPT 11 — chat & offers)

These refine §5; where they differ, implementation behaviour below wins.

| Topic | Delta |
|---|---|
| Thread create | Buyer requires `verifiedBuyer` (`403 kyc_required`). Only `status:"active"` listings are chat-open (`403 listing_not_chat_available`); own listing `422 cannot_chat_own_listing`; suspended seller `403 seller_suspended`; banned seller persists the thread with `state:"frozen"` (200). New thread increments `stats.chatStarts` and writes `chat.threadCreated`. |
| Thread list | Max 50, sorted `lastMessageAt` desc. Item adds `listing:{id,title,price,status}`; `unread` counts counterpart messages with `readAt:null`. |
| Message read | Opening `GET .../messages` marks all counterpart messages `readAt:now` (single 1:1 read marker). |
| Message cursor | `before` is an opaque message ObjectId; page size 1–50 (default 50), returned ascending, `meta.nextCursor` = oldest id only when more rows exist. |
| Send idempotency | Replay — including a duplicate-key race — returns the original message with `replayed:true`, HTTP 201, no duplicate row. |
| Send gate | `frozen` → `403 enforcement_blocked`; `soldBanner\|buyerBlocked\|sellerBlocked\|deletedListing\|archived` → `409 state_conflict` with `detail = state`. |
| Reveal | Fixed 20/day window per buyer (Asia/Dhaka, KV); 21st → `422 reveal_cap_exceeded`; `sellerPrefs.showPhonePublic=false` → `422 phone_hidden`; non-buyer → `403 buyer_only`. Success increments `stats.callTaps` and writes `chat.phoneRevealed`. |
| Block | Body `side` is optional but must match the caller's side (`403 side_mismatch`). |
| Report | `comment` becomes the report `details` (fallback `"conversation report"`); `moderationCases.snapshot` stores the last 100 messages. |
| Offers | `action` accepts `reject` as an alias of `decline`; `counter` requires `counterAmount ≤ price×2`; response is `{status, counterAmount}`. Expired-on-read persists `expired`, then returns `409 offer_expired`. Acceptance is non-binding (listing stays `active`). |
| Socket.IO | Same HTTP JWT in `auth.token` + active-session check; default namespace at `/socket.io`; per-connection 30 msg/min → `chat:error {type:"rate_limited"}`; `message:new` fans out to room `thread:{id}`. |

---

## 13.6 Implementation deltas (PROMPT 13–16)

These refine §4, §8–§11 and §12.4; where they differ, implementation behaviour below wins.

| Topic | Delta |
|---|---|
| Boost packages | Catalog `_id` is a human-readable **string** (`boost-3d` / `boost-7d` / `boost-15d`), not an ObjectId. Response `{ id, name, durationDays, price, placement, active }` (only `active:true`). |
| Checkout | Seller only (`403` for buyers). `400` when `Idempotency-Key` is missing. Credits applied FIFO (soonest expiry first) before the gateway: `amount = priceBdt − creditApplied`. Created payment is `state:"initiated"`; `amount:0` completes immediately. |
| Checkout idempotency | Replay of the same key + same `{listingId, packageId, provider}` returns the original payment (`Idempotency-Replayed: true`); a changed payload → `409 idempotency_replay`. |
| Checkout guards | Listing must be `active` (`409 listing_not_active`); someone else's / unknown listing → `404 listing_not_found`; suspended/banned seller → `403 enforcement_blocked`; unknown package → `404 package_not_found`. |
| Webhooks | `POST /webhooks/payments/:provider` (`bkash|nagad`). HMAC-SHA256 **hex** over the raw body in `x-bkash-signature` / `x-nagad-signature`, plus `BKASH_WEBHOOK_IPS` / `NAGAD_WEBHOOK_IPS` source allowlists. Every delivery is archived in `webhookEvents` **before** processing (`uq (gateway,eventId)`); duplicate `eventId` → `{ duplicate: true }`. Bad signature → `401`, archived with `signatureOk:false`, payment untouched. Response is `{ data: { received: true, eventId, duplicate } }`. |
| Payment state machine | Monotonic `initiated→pending→success|failed|expired`; terminal states reject later transitions (a late `failed` after `success` is a no-op). Success activates the boost and issues `receiptNo`. |
| Receipt | `GET /payments/:id/receipt` streams a generated PDF; available to the owner for 12 months from `paidAt` → otherwise `409 receipt_not_available`. `GET /payments/:id` adds `listingId`, `paidAt`, `failureReason`. |
| Credits | `GET /me/credits` → `{ balance, entries[] }`, entries include `remaining`, `source` (`goodwill`/`reconciliation`/…), `expiresAt`; grants expire 12 months after issue. |
| Boost pause/resume | Enforcement suspension pauses a live boost (`boost.active:false`, `pausedAt`, `remainingMs`); lifting enforcement resumes it with `until = now + remainingMs`. |
| Reconciliation | Nightly job + `POST /ops/reconcile/payments` (superadmin). Unmatched gateway success rows become credits (`source:"reconciliation"`, `reason:<trxId>`) plus a `payment.reconciled_to_credit` notification; matched rows complete the payment. Response `{ matched, orphanCredits, skipped }`. |
| Reports | `comment` (optional, ≤1000) stored as report `details` (fallback = category). Max **5 reports / 24h per reporter** (`429`). Re-reporting the same target while a report is `open|reviewing` returns the existing `reportId` with `merged:true`. Response `{ reportId, caseId, merged }` and never echoes the target. |
| Cases | One open case per reported target; `slaDue = createdAt + 48h`. Ops claim locks the case for **5 min**; another operator acting meanwhile → `409 case_claimed`. |
| Enforcement ladder | `dismiss` → `warn` → `suspend` (7 days) → `ban`. `warn` sets `enforcement.state:"warned"`; `suspend` sets `suspended` + `until`. Ban is **4-eyes**: operator `ban` → `202 { status:"pending_second_approval" }`; the proposer repeating → `403 second_approver_required`; a different `seniorModerator|superadmin` → `200 { status:"ban_applied" }`. |
| Ban effects | Sets `banned`, delists all listings, freezes threads, forfeits boosts (`active:false`, `until:null`), and keeps `nidHash` (re-registration block). |
| Suspended-user gates | Writes blocked with `403 enforcement_blocked` (listings, chat, boost checkout, reports); **appeals and support tickets stay open**. |
| Appeals | `type: kyc|enforcement|delisting`; appeal SLA is **24h** for suspended users and **72h** otherwise. Owner-only reads (`404` for strangers). `reverse` lifts enforcement, restores state and writes an `enforcement.lift` audit entry (the original `appeal.create` entry is kept). |
| Support | `{ subject, body, category, attachmentMediaId? }`; messages are embedded (`messages[]`), owner-only reads. Ops reply appends `authorType:"operator"`, moves the ticket to `pending`, and notifies the owner (`support.reply`). |
| Notifications list | `GET /notifications?read=true|false&limit=1..100` (default 50), newest first, `meta.unread`. `POST /notifications/:id/read` → `204` (idempotent, owner-scoped `404`). `POST /notifications/device-token { token(min 8), platform:"fcm"|"apns" }` → `204` (deduped `users.pushTokens`). |
| Notification idempotency | `notifications.dedupeKey` is unique-sparse; a repeated event returns the existing row, `coalesce:true` bumps `count`/`lastAt` (chat per thread). Quiet hours **22:00–08:00 Asia/Dhaka** drop `push`/`sms`; `enforcement.*`, `security.*` and ops alerts bypass. |
| Ops sessions | `POST /ops/auth/login { email, totp }` → 15-min operator JWT (`typ:"ops"`, audience `trustbazar-ops`). TOTP is RFC-6238 ±1 step; unknown operator, bad code, missing secret or IP not allowlisted all answer `401`. IP allowlist is the union of global `OPS_IP_ALLOWLIST` and per-operator `ipAllowlist`. |
| Ops role gates | `kycReviewer` → KYC; `moderator` → moderation/appeals/support read + actions; `seniorModerator` → ban approval/appeal decisions; `superadmin` → audit, config, reconciliation, all of the above. |
| KYC decision | Queue `?status=&claim=true` (5-min lock; the claiming response already carries `claimedBy`). `reject` **requires** `reasonCode` (`400` otherwise). Approve grants roles (`verifiedBuyer` for buyer scope, `seller` for seller scope); reject sets `kycSubmissions.expiresAt = now + 90d`. `GET /ops/kyc/:id` returns signed `documents` URLs and writes a `kyc.document_view` audit entry. |
| Audit | Append-only `auditEvents` with `hash = sha256(prevHash + canonical(doc))` chained by `seq`. `GET /ops/audit?entityType=&entityId=&from=&to=&limit=` (superadmin) is read-only. `audit-verify` job re-walks the chain → `{ ok, checked, brokenAt? }`; a break raises `ops.audit_chain_broken`. Model `updateOne`/`deleteOne` are rejected. |
| Config | `PUT /ops/config` merges a partial patch, writes `config.update` with `before`/`after`, and invalidates the 60-s `GET /config` cache immediately. `GET /config` is exempt from the version gate; payload carries `apiVersion:"1.5"` + `serverTime`. |
| Client-version gate | `X-App-Platform` + `X-App-Version` compared with `config.minVersion[platform]` → `426 upgrade_required` (skipped for `/config` and `/webhooks/`). |
| Jobs | 12 named jobs: `media-pipeline`, `webhook-drain` (60 s), `reconciliation` (02:00), `lifecycle`, `expiry-reminders`, `offer-expiry`, `deal-timeout`, `saved-search-alerts` (hourly), `purge` (03:00), `sla-scan` (15 min), `breach-notify` (event), `audit-verify` (04:00). BullMQ repeatables when `WORKER && REDIS_URL`, otherwise in-process timers. A failing job emits `ops.job_failed`. |

---

## 13.7 Implementation deltas (PROMPT 12)

| Topic | Delta |
|---|---|
| Confirm | `POST /deals/:id/confirm` is buyer-only (any authenticated user who is not `deal.buyerId` → `404 deal_not_found`). Body is optional: `{}` or `{"confirmed": true}`. Response `{ data: { dealId, type:"confirmed", confirmedAt } }`. |
| Confirm guards | `buyerMsgCount ≥ 1` is re-checked at confirm time (`422 buyer_message_required`); `type:"direct"` → `409 deal_not_confirmable`; disputed deal → `409 deal_disputed`; past `expiresAt` → `409 deal_confirm_window_expired`; concurrent state change → `409 deal_state_changed`. |
| Confirm window | The buyer has **7 days** from mark-sold (`deal.expiresAt`). The 15-minute `undoUntil` only governs the seller's undo and does **not** shorten confirmation. |
| Confirm effects | Atomic `unconfirmed → confirmed` update, listing `pendingConfirm → sold`, thread `active → soldBanner`, seller `profile.sellerStats.confirmedDeals += 1`, audit `deal.confirmed`, and a single `deal.confirmed` notification (dedupe `deal.confirmed:<dealId>`). |
| Idempotency | A second confirm returns the same `confirmedAt` with **no** extra notification, audit row or KPI increment. |
| Decline | `POST /deals/:id/decline { reason(5..500) }` creates a `moderationCases` row (`source:"dispute"`, `refId = deal._id`, 48 h SLA, frozen snapshot), links `deal.disputeRef`, increments seller `profile.sellerStats.disputes90d`, audits `deal.disputed`, and notifies the seller (`deal.declined`). Retry returns the same `disputeRef` (one case only). |
| Auto-flag | `disputes90d ≥ 3` appends `enforcement.history: { action:"auto_flag", reasonCode:"DISPUTE_THRESHOLD" }`, writes `seller.auto_flagged` audit and sends `ops.seller_auto_flagged` to the ops inbox. |
| Timeout job | `deal-timeout` sends a day-3 reminder to the buyer (`deal.reminder`, dedupe per deal) and, after `expiresAt`, `deal.timeout` to both parties. The deal **stays `unconfirmed`** and can never be confirmed late. |
| KPI | Only `type:"confirmed"` rows count. Direct deals (`type:"direct"`) and timed-out `unconfirmed` rows are excluded; direct sales are counted by querying `type:"direct"` ("sold directly"). The `deal.confirmed` audit entry doubles as the metrics event. |

---

## Appendix A: Auth matrix (summary)

| Endpoint group | Public | Logged-in | Verified Buyer | Seller | Operator |
|---|---|---|---|---|---|
| Auth (OTP/refresh) | ✅ | | | | |
| KYC | | ✅ | | | |
| Listings read | ✅ | ✅ | ✅ | | |
| Listings write | | | | ✅ | |
| Chat | | | ✅ | | |
| Deals confirm | | | ✅ | | |
| Boost/Payments | | | | ✅ | |
| Me/Account | | ✅ | | | |
| Reports/Appeals | | ✅ | | | |
| Support | | ✅ (incl. banned) | | | |
| Platform config read | ✅ | ✅ | ✅ | ✅ | ✅ |
| Media signing | | ✅ | ✅ | ✅ | ✅ |
| Ops | | | | | ✅ |

## Appendix B: Idempotency & Concurrency

- `Idempotency-Key` required on POST/PATCH/PUT mutating calls. 24h TTL; replay returns stored response with 409 if method/body differ.
- Listings mutations require `version` field (optimistic lock); mismatch → 409.
- Payment state machine monotonic (initiated→pending→success|failed|expired); webhook replays safe via `webhookEvents.eventId` dedupe.

## Appendix C: Degraded mode (Arch §3.7)

When external dependency down:
- **Porichoy:** KYC submissions held at `pending-vendor`; users see delayed notice.
- **SMS/OTP:** fallback provider; if both down, login blocked with maintenance message.
- **bKash/Nagad:** checkout disabled, credits still usable, pending payments reconciled on recovery.
- **R2:** uploads blocked; existing images served via CDN cache.
- **AI scan:** listings publish after scan-result fallback to manual review queue.
- **Search:** Atlas Search down → cached popular listings + basic text-index fallback.
