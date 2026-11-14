# Requirement Validation Report — Trust Bazar PRD v1.3

**Validated Document:** [PRD.md](PRD.md) v1.3 (2026-10-08)
**Validation Date:** 2026-10-10
**Analyst:** Senior Product / Business Analyst
**Scope:** Missing Flows · Edge Cases · Error Handling · Security · Validation · Permissions · Notifications · Exceptions

---

## 0. How to Read This Report

Each finding has:

| Severity | Meaning |
|---|---|
| **C — Critical** | Blocks build / launch; creates fraud, legal, or data-integrity risk |
| **H — High** | Must be specified before engineering handoff |
| **M — Medium** | Needed within v1; can be resolved in sprint grooming |
| **L — Low** | Polish / nice-to-have |

**Total findings: 118** — Critical: 14 · High: 39 · Medium: 47 · Low: 18

**Top 5 must-fix items:**
1. **MF-01** — Mark-as-Sold is impossible for deals closed via direct SIM call (the PRD's own primary contact path) because buyer selection requires a chat thread.
2. **MF-02** — No appeal/reversal flow for permanent NID bans or KYC rejections.
3. **SEC-03** — OTP-only auth has no SIM-swap / account-takeover mitigation (BD's #1 fintech fraud vector).
4. **SYS-01 / EH-01** — No degraded-mode behavior defined for Porichoy, SMS, R2, payment, or AI outages.
5. **PERM-01** — No permission matrix exists; several capability boundaries are undefined (banned-user screen, pending-seller, operator authority tiers).

---

## 1. Missing Flows

### 1.1 Deal & Marketplace Flows

| ID | Sev | Missing Flow | Gap vs PRD | Recommended Requirement |
|---|---|---|---|---|
| MF-01 | **C** | **Sale closed via phone call / walk-in (no chat thread)** | §3.3.6 forces seller to select the buyer *from the chat thread* on Mark-as-Sold — but §3.2.2 makes direct SIM calls a first-class contact path. A buyer who only called has no thread, so the seller literally cannot record the sale. Breaks KPI data (§1.5). | Mark-as-Sold offers: **(a)** select buyer from chat, or **(b)** "Sold via phone / in person" → recorded as **Direct Sale (Unconfirmed)**, excluded from the confirmed-deal KPI denominator. Show seller an in-chat prompt to invite call-only buyers to confirm. |
| MF-02 | **C** | **Appeal flow for bans / KYC rejections / delistings** | §3.1.7, §5.3 define reject/ban but no appeal. Permanent NID ban with no recourse is a legal/PR risk and offers no correction path for operator error. | Add: in-app "Appeal decision" entry on rejection/ban screen; appeal creates a separate review queue; senior operator re-reviews within 72h; result + reason notified; identity is unblocked on successful appeal (reversal is audit-logged, log stays immutable). |
| MF-03 | H | **Undo/correct "Mark as Sold"** | §5.5 has no correction path for tapping the wrong buyer or accidental sale. | Allow undo within 15 min **and before** buyer responds; later corrections via support request; cancellation voids the pending confirmation and restores listing to Active. |
| MF-04 | H | **Buyer disputes the confirmation** | §5.5 handles confirm/decline/timeout, not "I never bought this." | "No, I didn't buy" opens a dispute record; listing stays Sold; dispute logged as trust signal on seller; repeated false marks reviewed by ops. |
| MF-05 | H | **Listing behavior when seller is banned** | §5.3 bans the identity but says nothing about active listings or live chats. | On ban: all listings immediately hidden/ended (boost forfeited if fraud); open chat threads become read-only with banner "This seller is no longer active"; buyers notified. |
| MF-06 | H | **Chat thread behavior when listing is deleted/sold/expired** | §3.2.1 / §3.3.6 silent. | Thread remains readable with a status banner (Sold / Deleted / Expired); new messages blocked after deletion; offer cards disabled. |
| MF-07 | H | **Offer lifecycle flow** | §3.3.7 mentions offers but no states. | States: Pending → Accepted / Declined / Countered / Expired (TTL **48h**); accepted offer attaches a price-agreed card; notifications on each transition (NOTIF-09). |
| MF-08 | M | **Draft listing save/resume** | §3.3.12 allows drafts but no resume flow. | Drafts auto-saved per field; "Continue listing" card on dashboard; drafts auto-purged after 30 days; one draft per category limit optional. |
| MF-09 | M | **Re-list after expiry (missed renewal)** | §3.3.12 covers renewal prompt only. | Expired listing kept 30 days in dashboard with "Relist" (reuses photos/details, resets timer, treated as new listing with fresh posted-date). |
| MF-10 | M | **Duplicate-listing detection** | Not specified. | Block near-identical active listing from same seller (same title + price + photo-hash); suggest "Renew existing" instead. |
| MF-11 | M | **Edit while boosted / while offers open** | §3.3.6 + §3.3.9 interaction undefined. | Price/photo/category edits on a boosted listing require confirm ("boost continues unchanged"); open offers are auto-cancelled on price edit with notice to buyers. |
| MF-12 | L | **First-run onboarding & empty states** | None. | 3-screen intro, zero-results search suggestions, empty dashboard prompts ("Add your first product"). |
| MF-13 | L | **Deep-link return-after-login flow** | Shared listing links exist implicitly (web). | Guest opening link → login/NID gate → returns to exact listing/chat context. |
| MF-14 | M | **Force-update / maintenance flow** | NFR-03 has uptime but no client gating. | API returns min-supported-version; hard-block screen for below-min; maintenance mode page with retry; web auto-reload. |

### 1.2 Identity & Account Flows

| ID | Sev | Missing Flow | Gap vs PRD | Recommended Requirement |
|---|---|---|---|---|
| MF-15 | **C** | **Lost-SIM / number-recovery flow** | §3.4.2 change-number assumes OTP works on the old SIM. BD users lose SIMs constantly; without recovery the account (and seller reputation) is bricked — driving duplicate accounts that break the NID model. | Change-number with **old SIM alive**: OTP on both old + new. **Old SIM lost**: identity recovery via NID + liveness re-check (Porichoy) → new number bound after 24h cooling period with notice to old number channel. |
| MF-16 | H | **Account-deletion grace & reactivation** | §3.4.4 is immediate purge; App Store allows cancellation; operator mistakes need buffer. | Deletion is a **14-day scheduled purge**; login during window offers one-tap cancel; after purge, phone number is released for reuse; NID records retained per NFR-05 keyed by NID hash, **not** phone. |
| MF-17 | H | **Session management UI** | §3.4.1 limits 3 sessions but no management. | "Active devices" list with model/location/last-used; remote logout; oldest session evicted on 4th login (with push notice). |
| MF-18 | H | **KYC submission resume / retake** | §3.1 assumes one clean pass. | Mid-flow app kill → submission recovered from last completed step; blurry capture rejected client-side with retake guidance before Porichoy call; orphan R2 uploads purged by daily job. |
| MF-19 | H | **Buyer NID reuse on seller upgrade** | §2.1 layering unclear on re-verification. | Verified Buyer upgrading to seller reuses NID data from Porichoy; only document-type expansion (Passport/Smart Card optional) + liveness capture added; no duplicate NID call. |
| MF-20 | M | **Document-expiry handling** | Passports/Smart Cards expire; nothing tracks it. | Store expiry; block seller verification 30 days before/after expiry; prompt re-upload; NID (no expiry) exempt. |
| MF-21 | M | **Warning / temporary-suspension state** | §5.3 operator action "warn" has no defined effect; only permanent ban exists. | Define 3 enforcement levels: **Warning** (notice, no restriction), **7-day suspension** (listings hidden, chat blocked, banner shown), **Permanent ban** (MF-02 appeal applies). |
| MF-22 | M | **Guest reporting** | §2.1 guests can't chat; §3.3.11 doesn't say who can report. | Report action visible to all but **submission requires login** (anti-abuse + reporter traceability). |
| MF-23 | L | **Language selection flow** | NFR-06 promises bilingual UI. | First-launch chooser (default device language), in-profile switch, applies to UI **and** notification templates. |
| MF-24 | L | **Permission-denial flows** | Camera/location/notification OS permissions not handled. | Deny-camera → can't complete KYC/list photos (explain + settings link); deny-location → manual area picker; deny-notifications → in-app center only. |

### 1.3 Payment & Ops Flows

| ID | Sev | Missing Flow | Gap vs PRD | Recommended Requirement |
|---|---|---|---|---|
| MF-25 | **C** | **Payment interrupted / webhook lost** | §3.4.5 covers 15-min expiry but not user-app-closed-after-pay or delayed webhook. | Payment states: `initiated → pending → success / failed / expired`; app polls on reopen; **daily reconciliation job** pulls bKash/Nagad settlement; orphan success-vs-expired cases auto-resolved to boost credits with notice. |
| MF-26 | H | **Boost on a moderation-delisted listing** | §3.3.9 vs §3.3.11 conflict undefined. | Wrongful delist (reversed on appeal) → time-equivalent boost credit; fraud delist → boost **forfeited**; seller-deleted/expired listing → remaining boost not transferable in v1 (state this clearly at purchase). |
| MF-27 | M | **Double-tap / double-charge protection** | Not specified. | Purchase button locked after tap; idempotency key per package+listing+user; duplicate settled payment → automatic boost credit. |
| MF-28 | M | **Receipt access after deletion / download failure** | §3.4.5 receipt exists but lifecycle missing. | Receipts available 12 months in Boost history; downloadable PDF; retry on failure; no email in v1 (no email collected). |
| MF-29 | H | **Operator case-claim / concurrency** | §3.4.6 + manual DB ops will cause double-handling. | Queue item must be **claimed/locked** by an operator (5-min lock); actions on already-resolved cases rejected; senior-operator role can reverse (MF-02). |
| MF-30 | M | **Ops escalation for SLA breach** | §3.1.7 24h SLA unmonitored. | Cases ageing past 80% SLA highlighted; breach creates internal alert (NOTIF-16); business hours defined as Sun–Thu 10:00–18:00 BST (Fri–Sat weekend pauses SLA clock). |

---

## 2. Edge Cases

### 2.1 Auth / Identity (EC-01 – EC-11)

| ID | Sev | Edge Case | Required Behavior |
|---|---|---|---|
| EC-01 | **C** | **SIM-swap attack** — attacker ports victim's number, OTP logs them in | Device-binding signal + step-up (re-liveness or OTP-to-registered-device confirm) on login from new device when KYC-verified; new-device login alert (NOTIF-14); see SEC-03 |
| EC-02 | **C** | **Recycled phone number** — telecom reissues number of a deleted account to a new person | Ban/identity keyed to **NID hash, never phone**; login on a released number creates a fresh empty account; never auto-restores prior profile/KYC |
| EC-03 | H | Banned person tries buyer NID gate with a new phone number | Ban-list check runs at **both** seller KYC and buyer basic-NID (Porichoy) — blocked at first NID use, not at seller upgrade |
| EC-04 | H | Same person legitimately uses 2 phone numbers (one NID) | Policy: **one active identity per NID**; second account KYC is rejected with "already registered" + account-recovery path (MF-15) |
| EC-05 | H | OTP SMS delayed past 5-min expiry / not delivered | "Resend" after 60s; after 2 failed sends, switch to alternate SMS provider; after 3, show "try later" + support link (SYS-02) |
| EC-06 | M | Virtual/VoIP number used at signup | Accept in v1 (BD MNP makes prefixes unreliable) but flag risk; hard-block only known virtual ranges after validation |
| EC-07 | M | OTP brute-force (5 wrong attempts) | Lock verification for 30 min with exponential backoff; alert on repeated attempts per number |
| EC-08 | M | Two phones logged in, 4th new device login | Oldest session evicted (MF-17); in-app notice |
| EC-09 | M | Under-18 NID at verification | Porichoy DOB check; reject with reason "minimum age 18"; no record retained beyond 90 days |
| EC-10 | M | Face mismatch from ageing, glasses, beard, lighting | Score in grey zone → manual review instead of hard reject; max 3 liveness retries per session |
| EC-11 | L | NID name romanization differs from signup name (Rahim vs Rahima spelling, Bangla/English variants) | Name-matched on NID number + DOB; display name free-form; mismatch logged, not rejected |

### 2.2 KYC / Documents (EC-12 – EC-17)

| ID | Sev | Edge Case | Required Behavior |
|---|---|---|---|
| EC-12 | H | Porichoy returns "no match" for a genuine ID (EC data gaps) | Not auto-rejected → manual review queue; show "under review" (never expose vendor mismatch detail publicly) |
| EC-13 | H | Old 13-digit vs new 10-digit NID formats, Smart Card numbering | Accept both per Porichoy specs; validate checksum/length per type; Bangla numerals ০–৯ normalized to 0–9 |
| EC-14 | M | File renamed to .jpg but actually another format / oversized after rename | Server validates **magic bytes**, re-measures dimensions, re-encodes; reject with friendly error |
| EC-15 | M | Expired Passport / corner-case Smart Card | MF-20 expiry rule applies; reject with specific reason |
| EC-16 | M | 3 rejections in 30 days exhausted | Submission locked 30 days; counter shown; fraud-signal cases (forgery) banned immediately regardless of count |
| EC-17 | L | Family sharing one device for KYC | Allowed; re-verification requires fresh liveness each time; no credential caching |

### 2.3 Listings / Search (EC-18 – EC-28)

| ID | Sev | Edge Case | Required Behavior |
|---|---|---|---|
| EC-18 | **C** | **Prohibited-item catalog undefined** (firearms, meds, tobacco, alcohol, animals, gold, illegal goods) | Publish a prohibited-items list before launch (Legal sign-off); keyword + image-classifier block; report category already exists (§3.3.11) |
| EC-19 | H | Absurd prices (৳0, ৳1, ৳99,99,99,999) | Price: integer BDT, range **৳1 – ৳9,99,99,999**; outside-range blocked; anomaly range still passed to AI (§3.2.4) |
| EC-20 | H | Buyer opens link/chat to a listing deleted or delisted | 404-state product page with reason ("no longer available") + similar listings; chat banner (MF-06) |
| EC-21 | H | Seller edits listing during active offer/boost | MF-11 rules |
| EC-22 | M | Stock photo with minor edits to evade AI | Perceptual-hash (pHash) match against stock-image corpus, not pixel match; low-confidence → queue not auto-block |
| EC-23 | M | Photo EXIF leaks home GPS; violent/illegal content | Strip EXIF on upload; server-side content scanning |
| EC-24 | M | Min price > max price / inverted filters | Swap or reject with inline error; radius capped at 100 km |
| EC-25 | M | Area/thana missing from taxonomy | Manual area entry allowed at leaf-level under district; flagged for taxonomy backfill job |
| EC-26 | M | View-count inflation via refresh | One unique view per user per listing per 24h; guest views deduped by device/IP heuristic |
| EC-27 | L | Emoji/script-mixed long title, Bangla+English | Title 10–100 chars, description 20–5000; UTF-8; XSS-neutralized (SEC-12) |
| EC-28 | L | Currency assumption | BDT only in v1; display ৳ / "টাকা" per locale; no FX |

### 2.4 Chat / Deal / Payment (EC-29 – EC-36)

| ID | Sev | Edge Case | Required Behavior |
|---|---|---|---|
| EC-29 | **C** | Users paste phone numbers/links to move deal off-platform (scam + bypass) | Client hint + server pattern scan for numbers/URLs; show safety warning ("keep chats on Trust Bazar"); repeat offenders flagged to moderation |
| EC-30 | H | Message to a user who blocked you / deactivated | Send blocked with state message; unblock restores; no notification to blocker (§3.2.6) |
| EC-31 | H | Duplicate messages on flaky 2G/3G | Client dedupe key + server idempotency; retry indicator; offline queue |
| EC-32 | M | Multiple buyers, one item, seller marks sold | Other active offer senders get auto "item sold" chat notice; threads archived (MF-06) |
| EC-33 | M | Buyer never responds to confirm (7 days) | Unconfirmed per §5.5; one reminder at day 3; no late confirm after expiry (correction via support, MF-03) |
| EC-34 | M | Webhook arrives out of order / twice | Idempotent on payment id; statuses monotonic (success never regresses to pending) |
| EC-35 | M | Insufficient bKash balance / user cancels | `failed` state with reason; package not consumed; user can retry; no penalty |
| EC-36 | L | Offer amount whitespace/Bangla numerals/zero | Normalize; positive integer; cap at listing price ×2 (beyond = anomaly block) |

---

## 3. Error Handling

| ID | Sev | Failure / Error | Required Handling |
|---|---|---|---|
| EH-01 | **C** | **Porichoy API outage/timeout (5xx, >8s)** | Retry with exponential backoff (2 attempts); submission stored as `submitted-pending-vendor`; **manual-review fallback** (already promised in §9 mitigation — make it a requirement); user sees "verification in progress," never a raw error; circuit breaker after sustained failures |
| EH-02 | **C** | **Payment webhook never arrives** | MF-25 state machine + polling + daily reconciliation; settlement mismatches alert finance |
| EH-03 | H | **R2 upload failure mid-KYC / signed URL expired (>10 min)** | Resume from failed file (not whole form); request new signed URL silently; orphan-file purge job nightly |
| EH-04 | H | **OTP provider failure** | Automatic failover to secondary SMS provider (vendor selection = PRD OQ#2); after both fail, friendly "service busy, try in 5 min" |
| EH-05 | H | **AI fraud/price service down at publish** | Do **not** block publish (consistent with §3.2.3); enqueue for scan on recovery; listings scanned retroactively on restart |
| EH-06 | H | **Search service down** | Degrade to category browse + cached popular listings; banner "search temporarily limited" |
| EH-07 | H | **Push (FCM/APNs) delivery failure** | Silent retry; critical events (KYC, ban, deal-confirm) escalate to SMS after 1 failed push; token refresh on app open |
| EH-08 | H | **401 token expiry/refresh failure** | Transparent refresh once; failure → logout to login screen; no data loss on half-completed forms (draft) |
| EH-09 | M | **403 / capability lost mid-session** (e.g., seller banned while app open) | Next API call returns enforcement state; app shows suspension/ban screen with appeal entry (MF-02) |
| EH-10 | M | **429 rate limited** | Standard retry-after UX (countdown); client throttles proactively; log source |
| EH-11 | M | **404 on deep link / shared listing** | Branded not-found page with similar items, never a technical error |
| EH-12 | M | **Image compression failure on low-end device** | Fallback server-side compression; reject only if source itself unreadable |
| EH-13 | M | **Concurrent edit conflict** (same listing, two devices) | Optimistic locking (version field); loser gets "listing was changed, reload" — no silent overwrite |
| EH-14 | M | **Webhook signature invalid / source IP mismatch** | Reject, do not process; security alert fired (possible gateway spoof) |
| EH-15 | M | **Partial multi-photo failure** | Publish allowed with successful photos only if ≥1; failed files clearly marked for retry |
| EH-16 | L | **Generic unknown error** | Bilingual standard copy ("কিছু একটা সমস্যা হয়েছে / Something went wrong") + correlation ID shown; never raw stack traces |
| EH-17 | L | **Offline submission** | Queue + auto-retry on reconnect for chat/listing draft; user-visible pending state |

**Standard required:** every mutating API (listing create/edit/delete, mark-sold, offer, payment, report, block) requires a client-generated **idempotency key**; all errors logged with correlation IDs (ties NFR-09).

---

## 4. Security

| ID | Sev | Finding | Requirement |
|---|---|---|---|
| SEC-01 | **C** | **OTP-only auth is the entire identity boundary** — intercepted OTP = full account takeover | Rate limits (§3.4.1, EC-07) + anti-enumeration: signup/login always return generic "OTP sent" (never "number not registered"); one OTP valid for one exchange; step-up re-OTP for change-number/delete/boost-payment |
| SEC-02 | **C** | **KYC bucket & signed-URL exposure surface** | Private buckets only; signed URL TTL **≤ 5 minutes**; presigned POST constrains content-type & max size; no public ACLs ever; encryption keys in managed KMS (separate from app credentials); quarterly access review |
| SEC-03 | **C** | **SIM-swap / SS7 account takeover** (dominant BD fintech fraud) | New-device login signals + risk-scored step-up (EC-01); verification-event alerts (NOTIF-14); disable SMS-only recovery on high-risk events (require liveness, MF-15); consider bKash-style device binding in v2 |
| SEC-04 | **C** | **Operators see raw NID scans — insider risk** | Operator **2FA mandatory** + IP allowlist + Cloudflare Access; least privilege (reviewer sees only the case's documents, no bulk export, no listing PII beyond case); screenshots blocked on KYC viewer; every document view logged |
| SEC-05 | H | **IDOR / ownership bypass** risk on every resource id | Server-side ownership checks on listing edit/delete, chat thread read, deal confirm, boost, receipt — never rely on hidden UI; tests must cover swapped IDs |
| SEC-06 | H | **4-eyes principle for irreversible bans** | Permanent ban requires reviewer + senior approval (or senior-only role); audit log stores both actors; reversal (MF-02) senior-only |
| SEC-07 | H | **Audit-log tamper protection** | Append-only store in a **separate cloud account/project** from app credentials; hash-chained records; no delete/update API exists |
| SEC-08 | H | **Token storage on device** | Access/refresh tokens in iOS Keychain / Android Keystore-encrypted storage only; not in UserDefaults/SharedPreferences plaintext; tokens bound to app signature |
| SEC-09 | H | **Phone-number reveal endpoint abuse** | Separate `/reveal-number` endpoint (not embedded in listing payload); per-buyer daily cap (value TBD, OQ#5 — propose 20/day); every reveal logged; anomalies auto-throttle |
| SEC-10 | H | **Bot/scraping of public listing data** | Guest & API rate limits (proposed table §4.1); CAPTCHA challenge on anomalous guest search traffic; listing API requires signed device headers on mobile |
| SEC-11 | M | **KYC screen capture / rooted devices** | `FLAG_SECURE` (Android) / screenshot prevention (iOS via liveness SDK guidance) on NID/selfie screens; liveness SDK root/jailbreak detection policy set to warn+review, not hard-block (high false positives) |
| SEC-12 | M | **Stored XSS via name/title/description/chat** (web is in v1 scope) | HTML-escape all user content on render; server sanitization; CSP + secure cookies on web; no `javascript:` in deep links |
| SEC-13 | M | **Sensitive data in logs** | Logs must never contain OTP, NID numbers, tokens, full phone numbers (mask `0171****123`); automated log scanning |
| SEC-14 | M | **TLS / MITM on hostile BD networks** | TLS 1.2+ (NFR-04) + certificate pinning on mobile apps with fallback policy; HSTS on web |
| SEC-15 | M | **Consent evidence** | Versioned consent text; per-user record of version + timestamp for KYC upload and for deletion-retention disclosure (§3.4.4) |
| SEC-16 | M | **Report-system abuse / retaliation** | Rate-limit reports (5/day/user); duplicate open report auto-merged; reporters' identity hidden from reported party |
| SEC-17 | L | **Client secrets** | No gateway keys in app binaries; all payment/KYC calls server-side signed; secret rotation procedure documented |
| SEC-18 | L | **Malware scan on uploads** | Basic AV scan on R2 objects (listing + KYC) via pipeline; infected objects quarantined |

### 4.1 Proposed Rate-Limit Table (to add to PRD)

| Action | Authenticated | Guest |
|---|---|---|
| OTP request | 5 / number / day | — |
| OTP verify | 5 / OTP | — |
| Search | 60 / min | 20 / min per IP |
| Listing create | 10 / day (seller) | — |
| Chat message | 30 / min / thread | — |
| New chat thread | 20 / day | — |
| Phone reveal | 20 / day (SEC-09) | — |
| Offer send | 20 / day | — |
| Report | 5 / day (SEC-16) | blocked (MF-22) |
| Boost purchase | 10 / day | — |

---

## 5. Validation Rules (Recommended PRD Appendix)

All rules enforced **server-side**; client validation is UX-only.

### 5.1 Auth & Profile (VAL-01 – VAL-07)

| Field | Rule |
|---|---|
| Phone (VAL-01) | BD mobile only: 11 digits, regex `^01[3-9]\d{8}$`; normalize `+880`/`8801…` inputs to `01…`; Bangla numerals normalized |
| Name (VAL-02) | 2–50 chars; Bangla/English letters, spaces, `. - '`; cannot be only digits/emoji |
| OTP (VAL-03) | Exactly 6 numeric digits; single-use; 5-min expiry (per §3.4.1) |
| Profile photo (VAL-04) | JPEG/PNG/WebP ≤ 3 MB, min 200×200, square-crop UI; re-encoded server-side |
| Location (VAL-05) | Division + district mandatory; area optional but required for listing/hyper-local; coordinates must lie inside selected district bounds (±sanity margin) |
| Language (VAL-06) | Enum: `bn` / `en` |
| Change phone (VAL-07) | Must pass VAL-01 + OTP; new number must not be in use on another active non-deleted account |

### 5.2 KYC (VAL-08 – VAL-14)

| Field | Rule |
|---|---|
| NID (VAL-08) | Old 13-digit or new 10-digit per Porichoy spec; checksum validation; Bangla numerals accepted |
| DOB (VAL-09) | Valid date; age ≥ 18 on submission date (EC-09) |
| Document file (VAL-10) | JPEG/PNG/WebP/PDF ≤ 5 MB; magic-byte verified (EC-14); min resolution 1080p along long edge for document; grayscale/dark blur rejected client-side with guidance |
| Selfie/liveness (VAL-11) | Live capture only (no gallery upload); JPEG ≤ 5 MB; liveness + match thresholds defined with vendor; grey zone → manual review (EC-10) |
| Passport expiry (VAL-12) | Must be ≥ 30 days in future (MF-20) |
| Re-submission (VAL-13) | ≤ 3 attempts / 30 days (§3.1.7); forgery reason bypasses count → immediate ban path |
| Consent (VAL-14) | Required, versioned, timestamped (SEC-15) before upload enabled |

### 5.3 Listings (VAL-15 – VAL-22)

| Field | Rule |
|---|---|
| Title (VAL-15) | 10–100 chars; prohibited-term list (EC-18); no price/phone-in-title |
| Description (VAL-16) | 20–5000 chars; sanitized (SEC-12); phone/URL patterns allowed but safety-prompted (EC-29) |
| Price (VAL-17) | Integer BDT, ৳1 – ৳9,99,99,999 (EC-19); no decimals (no paisa in practice) |
| Condition (VAL-18) | Enum: **New / Used – Like New / Used – Good / Refurbished / For Parts** (define once; currently missing) |
| Category (VAL-19) | Required leaf-level id from versioned taxonomy (§3.3.1); unknown id rejected |
| Photos (VAL-20) | 1–10; rules per §3.3.2 + magic-byte + EXIF strip (EC-23); pHash dedupe within seller's active listings (MF-10) |
| Location (VAL-21) | Same as VAL-05; GPS within selected district |
| Draft (VAL-22) | Title or ≥1 photo required to save; auto-purge 30 days (MF-08) |

### 5.4 Chat, Offer, Report, Payment (VAL-23 – VAL-27)

| Field | Rule |
|---|---|
| Message (VAL-23) | 1–2000 chars after trim; whitespace-only rejected; duplicate identical message >3/min throttled |
| Offer (VAL-24) | Positive integer ≤ listing price × 2 (EC-36); one active pending offer per buyer per listing; 48h TTL (MF-07) |
| Report (VAL-25) | Category from §3.3.11 enum; description 0–1000 chars; one open report per reporter×entity (SEC-16) |
| Boost package (VAL-26) | Server-defined package id; amount always computed server-side; client-supplied amount ignored |
| Payment idempotency (VAL-27) | UUID key from client; duplicate key returns original result (MF-27) |

---

## 6. Permissions

### 6.1 Permission Matrix (to add to PRD)

| Capability | Guest | Registered Buyer | Verified Buyer | Seller (pending) | Verified Seller | Suspended (7d) | Permanently Banned | Operator |
|---|---|---|---|---|---|---|---|---|
| Browse / search / view details | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (ban screen only) | ✅ (admin surfaces) |
| Save favorites / saved search | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | — |
| Report (submit) | ❌ (MF-22) | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Initiate chat | ❌ | ❌ | ✅ | ✅* | ✅ | ❌ | ❌ | — |
| Reply in existing chat | ❌ | ✅ (own threads) | ✅ | ✅ | ✅ | read-only | read-only | — |
| Reveal/call seller number | ❌ | ❌ | ✅ | ✅* | ✅ | ❌ | ❌ | — |
| Send offer | ❌ | ❌ | ✅ | ✅* | ✅ | ❌ | ❌ | — |
| Start seller upgrade / KYC | — | ✅ | ✅ | — | — | ❌ | ❌ | — |
| Access Seller Dashboard | — | — | — | ✅ read-only (§9) | ✅ | hidden | ❌ | — |
| Create/edit/publish listing | ❌ | ❌ | ❌ | ❌ (blocked per §3.1) | ✅ | ❌ | ❌ | — |
| Mark sold / renew / boost | — | — | — | — | ✅ | ❌ | ❌ | — |
| Purchase boost | — | — | — | — | ✅ | ❌ | ❌ | internal test only |
| Delete own account | — | ✅ | ✅ | ✅ | ✅ | ✅ | via appeal/support | — |
| Review KYC cases | — | — | — | — | — | — | — | reviewer role |
| Warn / delist / 7-day suspend | — | — | — | — | — | — | — | moderator role |
| **Permanent ban** | — | — | — | — | — | — | — | **senior + 4-eyes (SEC-06)** |
| Reverse decision / appeal review | — | — | — | — | — | — | — | senior role |
| View audit log | — | — | — | — | — | — | — | senior role |

\* Pending sellers retain their prior Verified-Buyer capabilities (role layering, §2.1).

### 6.2 Permission Findings

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| PERM-01 | **C** | No permission matrix in PRD; gates described narratively | Adopt §6.1 matrix as PRD appendix; enforce server-side via role middleware |
| PERM-02 | H | What a banned user sees is undefined | Dedicated ban screen: reason category, appeal CTA (MF-02), no data access; API returns `403 ENFORCEMENT_BAN` |
| PERM-03 | H | "Pending seller" capabilities ambiguous | Matrix row: dashboard read-only, listing blocked, buyer capabilities retained (matches §9 mitigation) |
| PERM-04 | H | Operator role tiers undefined | 3 internal roles: **KYC Reviewer, Moderator, Senior Moderator** (ban/reversal/audit access); operator accounts can never hold listings/chats (conflict-of-interest) |
| PERM-05 | M | Seller must never see buyer's NID data | Chat/seller-side buyer card shows display name + verification badge only; NID is platform-visible, never user-visible |
| PERM-06 | M | Which seller name is public — NID name or display name? | Public = display name (VAL-02); NID name kept internal for enforcement |
| PERM-07 | M | Seller number-hide toggle vs Verified-Buyer reveal | §9 promises a seller toggle; define: hidden = no reveal to anyone, chat-only contact; state shown on PDP |
| PERM-08 | L | Buyer public profile shape undefined | Minimal (avatar, display name, member-since, badge); no public listings/history |

---

## 7. Notifications

### 7.1 Notification Event Matrix (to add to PRD §3.4.3)

Channels: **P** = Push (FCM/APNs) · **I** = In-app center · **S** = SMS · **Ops** = internal alert. All templates bilingual (NFR-06), deep-linked, user-mutable where noted.

| # | Event | Audience | Channel | Tap Target | Status in PRD v1.3 |
|---|---|---|---|---|---|
| NOTIF-01 | OTP | Self | S | — | ✅ implied |
| NOTIF-02 | KYC submitted | Self | P + I | Verification status | New explicit |
| NOTIF-03 | KYC approved | Self | P + I | Dashboard/badge | ✅ (§3.4.3) |
| NOTIF-04 | KYC rejected (+reason + retry CTA) | Self | **S + P + I** | Re-submit screen | ✅ |
| NOTIF-05 | New chat message | Recipient | P + I | Thread | ✅ |
| NOTIF-06 | Offer received / accepted / declined / countered / expired | Both parties | P + I | Thread | **Missing (MF-07)** |
| NOTIF-07 | Listing flagged (under review) | Seller | I (+P if hidden) | Listing | Partly ("flagged/removed") |
| NOTIF-08 | Listing removed / reinstated by moderation | Seller | P + I (+S if banned) | Listing/appeal | Partly |
| NOTIF-09 | Warning / suspension / ban (+appeal link) | User | **S + P + I** | Enforcement screen | **Missing (MF-21)** |
| NOTIF-10 | Boost activated / expiring (3d, 1d) / expired | Seller | P + I | Boosted listing | ✅ (3d only — add 1d) |
| NOTIF-11 | Payment failed / reconciled-to-credit | Buyer (seller) | P + I | Boost screen | **Missing (MF-25)** |
| NOTIF-12 | Report received / status update / resolved | Reporter | I + P | Report status | ✅ |
| NOTIF-13 | Deal-confirmation request (buyer); buyer confirmed/declined/timeout (seller) | Both | P + I | Thread | Buyer side ✅; **seller result missing** |
| NOTIF-14 | **Login from new device** (security) | Self | I (+P) | Sessions | **Missing (SEC-03)** |
| NOTIF-15 | Phone number changed / account deleted scheduled | Self | P + I (+S on change) | Profile/support | **Missing (MF-15/16)** |
| NOTIF-16 | SLA breach / queue ageing | Ops | Ops | Queue | **Missing (MF-30)** |
| NOTIF-17 | Listing expiry reminders (3d, same-day) / expired / renewed | Seller | P + I | Listing | 3d in §3.3.12; add same-day + expired |
| NOTIF-18 | Saved-search new match | Buyer | P (digest max 1/day) + I | Search results | ✅ generic — add digest cap |
| NOTIF-19 | "Item sold" notice to other inquiring buyers | Buyers with threads/offers | I | Thread | **Missing (EC-32)** |
| NOTIF-20 | Porichoy degraded / payment-gateway down | Ops | Ops | Status board | **Missing (SYS-01)** |

### 7.2 Notification Findings

| ID | Sev | Finding | Requirement |
|---|---|---|---|
| NOTIF-A | H | Offer, enforcement, security-login, payment-failure events absent from §3.4.3 | Add NOTIF-06/09/11/14 + seller-side deal results |
| NOTIF-B | H | No notification settings/preferences | Per-category toggle (chat, marketing, boosts); quiet hours 22:00–08:00 BST default for non-critical; critical (KYC/ban/OTP) cannot be muted |
| NOTIF-C | M | Push token lifecycle | Refresh on app launch/foreground; multiple devices fan-out; uninstall cleanup after repeated `NotRegistered` |
| NOTIF-D | M | Chat notification collapse/coalesce | One notification per thread, unread count; no sounds for muted threads |
| NOTIF-E | M | SMS cost control | SMS limited to critical list (OTP, KYC reject, ban, security); all else push/in-app |
| NOTIF-F | L | No email channel exists anywhere | Acceptable for v1 (no email collected); receipts stay in-app (MF-28); revisit v2 |
| NOTIF-G | L | Notification deep links must survive app-install | Links route through store if app absent (web fallback) |

---

## 8. Exceptions (System-Level & Business Exceptions)

| ID | Sev | Exception | Required Behavior |
|---|---|---|---|
| SYS-01 | **C** | **Third-party outage: Porichoy** | Degraded mode: submissions accepted into `pending-vendor`, manual review fallback (EH-01); buyer browse unaffected; ops status banner internal |
| SYS-02 | **C** | **SMS/OTP provider outage** | Dual-provider failover (EH-04); health-check dashboard; suppress resend-spam; incident runbook |
| SYS-03 | H | **Payment gateway (bKash/Nagad) outage** | Disable Boost purchase UI with notice; in-flight pending payments reconciled on recovery; no double activation |
| SYS-04 | H | **R2/Wasabi storage outage** | KYC & photo uploads queued client-side; listings with failed hero photo cannot publish; read paths fall back to CDN cache |
| SYS-05 | H | **AI service outage** | EH-05: publish continues, scans backfill; moderation queue shows "AI unavailable" badge |
| SYS-06 | H | **Search index outage** | EH-06 degraded browse; no writes lost (index rebuilt from primary DB) |
| SYS-07 | M | **Database failover** | RPO ≤ 24h / RTO ≤ 8h per NFR-08; read-only mode page if replica-only |
| SYS-08 | M | **SLA clock semantics** | Business hours Sun–Thu 10:00–18:00 BST, Fri–Sat + govt holidays excluded (MF-30); timers stored in UTC, rendered BST (UTC+6) |
| SYS-09 | M | **Two operators act on same case simultaneously** | Claim lock 5 min; stale lock auto-release; conflicting second action rejected with notice (MF-29) |
| SYS-10 | M | **Race: boost purchase vs listing expiry** | If listing expires before payment success → payment auto-credited; pending timer wins ties in favour of credit |
| SYS-11 | M | **Race: duplicate Mark-as-Sold / double confirm** | Idempotent on listing id; state machine Active→PendingConfirm→Sold/Active; duplicate calls return first result |
| SYS-12 | M | **KYC approved while seller is mid-draft** | Approval event lifts gate live; draft publish proceeds without re-login |
| SYS-13 | M | **Web liveness unsupported on older browser** | Detect capability; route web users to "continue on phone" / upload fallback-to-manual review; parity matrix tracks this (NFR-07) |
| SYS-14 | M | **Feature-flag / geo-launch control missing** | §9 promises Dhaka-first city rollout but no capability exists — add launch-city allowlist flag (registration + listing visibility) — *carried from PRD-Analysis G-02, still open* |
| SYS-15 | M | **Orphan-data jobs** | Nightly purge: unreferenced R2 uploads (abandoned KYC), expired drafts (30d), expired reports |
| SYS-16 | M | **Client version fragmentation** | min/forced/optional version config (MF-14); kill-switch flags per feature |
| SYS-17 | L | **Timezone/locale anomalies** | All storage UTC; display Asia/Dhaka; Bangla numeral formatting consistent |
| SYS-18 | L | **Clock skew on device** | Allow ±5 min; beyond → OTP/signature failures with "check device time" message |

---

## 9. Cross-Cutting / Document Defects in PRD v1.3

| ID | Sev | Defect | Fix |
|---|---|---|---|
| DOC-01 | M | §3.4.4 references "**§6.5 retention policy**" — section doesn't exist | Replace with "NFR-05" |
| DOC-02 | M | §3.3.13 phrase "**Both confirmations** record a Confirmed Deal" is contradictory — only the buyer confirms | Reword: "On buyer confirmation, a Confirmed Deal is recorded" |
| DOC-03 | M | §2.3 caps age at **18–55** — no product/legal reason for an upper cap; also unverifiable for NID (no expiry) | Change to "18+"; enforced via Porichoy DOB (VAL-09) |
| DOC-04 | M | Geo-launch control promised in §9 has no FR (SYS-14) | Add FR for launch-city allowlist |
| DOC-05 | L | §3.4.5 says "no refunds, boost credits instead" but credit-trigger cases undefined | Adopt MF-26 policy text |
| DOC-06 | L | Condition enum, prohibited-item list, message length, offer TTL — values used in flows but never defined | Adopt VAL-18, EC-18, VAL-23, MF-07 |
| DOC-07 | L | Header date still 2026-10-08 after 2026-10-10 decisions | Bump to v1.4 when patches land; log decision date |

---

## 10. Consolidated Critical/High Action List (engineering-handoff gate)

| # | Finding | Owner Input Needed |
|---|---|---|
| 1 | MF-01 Direct-sale (phone/walk-in) Mark-as-Sold path | Product confirm |
| 2 | MF-02 Appeal flow + reversals | Product + Legal |
| 3 | MF-15 Lost-SIM recovery policy | Product + Security |
| 4 | MF-25 Payment state machine + reconciliation | Eng + Finance |
| 5 | SEC-01/03 OTP & SIM-swap mitigations | Security sign-off |
| 6 | SEC-02/04 KYC storage access rules + operator 2FA | Security sign-off |
| 7 | SEC-05/06 IDOR tests + 4-eyes ban policy | Eng + Ops |
| 8 | PERM-01 Permission matrix adoption | Product |
| 9 | EC-18 Prohibited-items list | **Legal — launch blocker** |
| 10 | SYS-01/02/03 Degraded-mode matrix + second SMS vendor | Eng + vendor RFPs |
| 11 | EH-01 Porichoy manual fallback operationalized | Ops |
| 12 | MF-21 Warning/suspension/enforcement ladder | Product + Legal |
| 13 | NOTIF-A Missing notification events + preferences | Product |
| 14 | SYS-14 Geo-launch flags (Dhaka-first) | Eng |

## 11. Recommended Next Step

Patch PRD to **v1.4** with: (a) §6.1 permission matrix as Appendix B; (b) §5 validation rules as Appendix C; (c) §7.1 notification matrix folded into §3.4.3; (d) new sub-sections for exception/degraded-mode matrix, appeal flow (MF-02), lost-SIM recovery (MF-15), payment states (MF-25), enforcement ladder (MF-21); (e) DOC-01–07 corrections. Validation rules in §5 of this report are written as ready-to-paste requirement text.
