# Product Requirements Document (PRD)
## Trust Bazar — Verified C2C Second-Hand Marketplace for Bangladesh

**Version:** 1.7.1
**Date:** 2026-10-17
**Status:** Final — engineering handoff ready; external legal/vendor actions pending (§11.3)
**Source:** [idea.md](idea.md) | **Analysis:** [PRD-Analysis.md](PRD-Analysis.md) | **Validation:** [Requirement_validation.md](Requirement_validation.md)

---

## 1. Project Overview

### 1.1 Vision
A Next-Generation C2C (Customer-to-Customer) second-hand product marketplace for Bangladesh that eliminates fraud and builds absolute trust between individual buyers and sellers. Familiar, Bikroy.com-style usability — but with a zero-anonymity interaction model.

### 1.2 Mission
> "Trade Second-Hand with 100% Peace of Mind — Every Interaction Verified, Every Deal Safe."

### 1.3 Problem Statement
Existing C2C platforms in Bangladesh (Bikroy, Facebook Marketplace) suffer from:
- Advance payment scams
- Fake / disposable profiles
- Stolen or misrepresented goods
- Misleading ads and unrealistic prices
- Phone number harvesting and spam

There is no platform where every participant is identity-verified and legally accountable.

### 1.4 Solution
A classifieds marketplace with a **Phase-1 Hybrid / Soft Onboarding** trust model:

- **Sellers** — mandatory NID KYC (via **Porichoy API**, Bangladesh's official e-KYC gateway integrated with Election Commission data) **before posting any listing**.
- **Buyers** — register with mobile-number OTP only; can browse, search, and view listing details freely. To **initiate an in-app chat** with a seller, a buyer must complete basic NID verification. This preserves the **"100% Verified Interactions"** positioning without forcing NID on passive browsers (which typically cuts signup conversion by 60–70%).

Buyers can also contact verified sellers by a **direct SIM call to the seller's shown phone number** (visible only to logged-in, verified buyers). Deals closed by call or in person are recorded as **Direct Sales** (§3.3.13). AI fraud/price detection and safe meetup suggestions make deals traceable and safe.

### 1.5 Success Metrics (KPIs)
| Metric | Target (Year 1) | Measurement Notes |
|---|---|---|
| Registered users (phone-verified) | 100,000+ | Direct |
| KYC-verified sellers | 10,000+ | Direct |
| NID-verified buyers (chat-enabled) | 40,000+ | Direct |
| Seller verification completion rate | ≥ 70% of seller-upgrade starts | Funnel instrumentation |
| Fraud report rate | < 0.5% of confirmed deals | Denominator = **Confirmed Deals only** (buyer-confirmed per §3.3.13). Direct Sales are reported separately, not in this denominator |
| Listing-to-sale conversion | ≥ 25% within 30 days of listing | Numerator = listings marked Sold (Confirmed + Direct Sales) |
| Chat response rate (sellers) | ≥ 80% within 24h | In-app instrumentation |
| Call-button taps (logged-in verified buyers) | Tracked (no Year-1 target) | Replaces unmeasurable "calls" metric — SIM call outcomes are not observable |
| Paid ad/boost attach rate | ≥ 5% of active listings | Direct |

---

## 2. Target Users

### 2.1 User Types, Roles & Enforcement States

Trust Bazar uses a **single-account model**: every user registers once with a phone number (OTP). Roles are layered on the same identity.

**Capability roles:**

| Role | How Attained | KYC | Capabilities |
|---|---|---|---|
| **Guest / Visitor** | No registration | — | Browse, search, view listing details. Never sees seller phone number; cannot chat or submit reports |
| **Registered User (Buyer)** | Phone OTP | Not required for browsing | Everything guests can + favorites, saved searches, report listings |
| **Verified Buyer** | Phone OTP + basic NID verification | NID (via Porichoy) | Everything buyers can + **initiate in-app chat** + view/call seller phone number |
| **Verified Seller** | Verified Buyer + full KYC (NID/Passport/Smart Card + selfie liveness) | **Mandatory before listing** | Everything buyers can + Seller Dashboard, add/edit/delete listings, boosts |
| **Platform Operator** | Internal assignment | — | KYC review queue, report moderation, enforcement actions (tiers per §3.4.6) |

**Enforcement states** (can apply to any capability role — full matrix in Appendix B):

| State | Effect |
|---|---|
| **Active** | Normal |
| **Warning** | Notice only; no capability restriction |
| **Suspended (7 days)** | Listings hidden, chat blocked, boost purchase blocked; browse remains; enforcement screen shown |
| **Permanently Banned** | Identity (NID hash) blocked platform-wide; ban screen + appeal CTA only; active listings ended, chats frozen (§3.6) |

Identity is keyed to the **NID hash, never the phone number**, so bans and verification survive SIM loss and telecom number recycling. A banned identity is **permanently blocked** — no disposable re-registration (§3.1.4).

### 2.2 Primary Personas

**Persona A — The Everyday Seller (e.g., Rahim, 28, Dhaka)**
- Wants to sell used phone, furniture, or bike quickly
- Frustrated by time-wasters, fake buyers, lowball scams
- Needs: genuine buyers, fast sales, optional ad boosting

**Persona B — The Cautious Buyer (e.g., Nusrat, 24, Chattogram)**
- Wants a used laptop/phone at a fair price
- Fears advance-payment fraud, fake listings, unsafe meetups
- Needs: verified sellers, authentic listings, safe meetup guidance
- **Registration friction tolerance:** willing to do NID only when serious enough to contact a seller

**Persona C — The High-Volume C2C Seller (e.g., Karim, 35, reseller)**
- Lists dozens of items monthly
- Needs: bulk tools, seller dashboard, premium store badge
- Falls under freemium category limits / paid tiers

**Persona D — Platform Operator (internal)**
- Reviews KYC submissions within SLA
- Handles reported listings/users (dismiss, warn, suspend, delist, ban)
- Works on a basic internal queue in v1; all actions are audit-logged

### 2.3 User Characteristics
- Bangladesh-based, **18+ years old** (enforced via Porichoy DOB at verification; no upper age cap)
- Smartphone-first users (Android dominant)
- Comfortable with bKash/Nagad-style digital flows but transacting mostly cash-on-meetup today
- Buyers need a valid mobile number (OTP registration); sellers must hold a valid NID, Passport, or Smart Card (mandatory before listing); buyers wishing to chat must complete basic NID verification

---

## 3. Core Features

### 3.1 Pillar 1 — Identity Verification (Seller KYC + Buyer NID Gate)

| # | Feature | Description | Priority |
|---|---|---|---|
| 3.1.1 | Seller Document Verification | NID, Passport, or Smart Card upload + OCR validation, **verified against Porichoy API** (official e-KYC gateway, Election Commission data). Old 13-digit and new 10-digit NID formats both accepted; Bangla numerals normalized | P0 |
| 3.1.2 | Seller Selfie Liveness Check | Live face-matching against the submitted ID photo. Grey-zone match scores route to manual review rather than hard rejection | P0 |
| 3.1.3 | Verification Badge | Visible trust badge on verified seller profiles & listings | P0 |
| 3.1.4 | Permanent ID Ban + Duplicate-ID Detection | Banned identity permanently blocks the associated NID/Passport. **KYC submission (both buyer NID gate and seller KYC) automatically checks for duplicate NID/Passport already registered or banned** — rejects with "already registered" + account-recovery path (§3.1.9), or flags banned-identity attempt | P0 |
| 3.1.5 | Premium Trust Badges | Optional paid premium seller badge / store profile | P2 |
| 3.1.6 | Buyer Basic NID Verification | Phone-registered user completes basic NID check (Porichoy) to become a **Verified Buyer**, unlocking in-app chat initiation and seller-phone-number reveal. While a buyer NID review is **pending**, the Contact button shows a "Verification in review" state — chat initiation stays blocked without a hard error | P0 |
| 3.1.7 | KYC Review Workflow | Submission → **Pending** → **Approved / Rejected** (reason codes: unreadable document, face mismatch, duplicate ID, suspected forgery, underage, vendor no-match→manual). Rejected users may re-submit (max 3 attempts in 30 days; forgery bypasses the count → immediate ban path). Manual review by operators in v1; SLA **≤ 24 business hours** (business hours defined in §3.4.6). Every rejection is appealable (§3.6) | P0 |
| 3.1.8 | Document Expiry Handling | Passport/Smart Card expiry tracked; verification blocked if expired or expiring within 30 days; re-upload prompt. NID (no expiry) exempt | P0 |
| 3.1.9 | Account Recovery (Lost SIM / Number Change) | **Old SIM alive:** OTP on old + new number. **Old SIM lost:** NID + fresh liveness re-check (Porichoy) → 24-hour cooling period → new number bound; notice sent through available channels. Prevents duplicate accounts after SIM loss (BD-common) | P0 |
| 3.1.10 | KYC Submission Resilience | Mid-flow interruption resumes from last completed step; blurry capture rejected client-side with retake guidance before vendor call; orphan uploads purged nightly | P0 |
| 3.1.11 | Buyer NID Reuse on Seller Upgrade | A Verified Buyer upgrading to seller reuses existing Porichoy NID data; only liveness re-capture (+ optional document type) is added — no duplicate vendor call | P0 |
| 3.1.12 | Re-registration After Deletion | A returning user (account deleted, KYC records retained per NFR-05) re-verifies with **liveness-only** — no new document upload, no new Porichoy data pull; prior verification status is restored on match. Banned NID hashes remain permanently blocked | P0 |

**Business rules:**
- A **new seller cannot add/list any product until seller verification is approved**.
- A **registered buyer cannot initiate an in-app chat until basic NID verification is approved**; browsing and search remain open without NID.
- Buyers register with phone OTP only; KYC is not required to browse, search, or save favorites in v1.
- **One active identity per NID.**

### 3.2 Pillar 2 — Anti-Fraud & Safe Communication

| # | Feature | Description | Priority |
|---|---|---|---|
| 3.2.1 | Contact Button (In-App Chat) | "Contact" button opens in-app chat. **Requires Verified Buyer status to initiate**; replies within an existing thread remain open while accounts are Active. **Threads exist only on listings** — no arbitrary user-to-user messaging | P0 |
| 3.2.2 | Seller Phone Number (Verified Buyers Only) + Direct SIM Call | Seller phone number visible **only to logged-in Verified Buyers**; others see "Verify to view number / Login to continue". Number served via a separate `/reveal-number` endpoint (never embedded in listing payload), capped at 20 reveals/day/buyer, every reveal logged. Sellers may **toggle number visibility off** (chat-only). Tap-to-call via dialer/SIM; dashboard tracks **call taps**, not outcomes | P0 |
| 3.2.3 | AI Fraud Detection | Image analysis (incl. perceptual-hash / pHash stock-photo matching) runs async after publish; flagged listings enter moderation — **publish is not blocked**; low-confidence flags queue rather than auto-block. If the AI service is down, publish continues and scans backfill on recovery | P1 |
| 3.2.4 | AI Price Anomaly Detection | Flags unrealistic prices vs. category medians. Baselines seeded from category median prices (manual seed → 30-day telemetry recalibration per §11.2#3) | P1 |
| 3.2.5 | Safe Meetup Suggestions | Recommend public locations (fuel stations, mall lobbies, police box areas) | P2 |
| 3.2.6 | Chat Management | Block user (mutual thread + number reveal hidden; unblock restores; blocker not notified), report conversation (creates moderation case with transcript), unread counts, per-thread mute. **No image sharing in v1**. Messages sent to blocked/deactivated/suspended users are rejected with a state message | P0 |
| 3.2.7 | Thread State on Listing Changes | Thread stays readable when listing is Sold/Deleted/Expired/Delisted, with a status banner; new messages blocked after deletion/delist; offer cards disabled. When an item is sold, other buyers with threads/offers receive an automatic "Item sold" notice | P0 |
| 3.2.8 | Off-Platform Contact Detection | Phone numbers/URLs pasted in chat trigger a safety warning ("keep conversations on Trust Bazar"); repeat attempts flagged to moderation. Duplicate messages deduped (client key + server idempotency) for 2G/3G reliability | P0 |

### 3.3 Pillar 3 — Marketplace Core (Bikroy-Style C2C)

| # | Feature | Description | Priority |
|---|---|---|---|
| 3.3.1 | Multi-Category Listings | Mobile phones, electronics, vehicles, furniture, fashion, household appliances, hobbies. Taxonomy managed from a versioned config (no admin UI in v1) | P0 |
| 3.3.2 | Listing Creation (Add Product) | Photos, title, description, price, condition, location — **blocked until seller verified**. Photo rules: 1–10, JPEG/PNG/WebP, ≤5 MB, min 800×600; magic-byte verified server-side, EXIF stripped, auto-compressed client-side with server fallback | P0 |
| 3.3.3 | Product Details Page | Photos, title, description, price, condition, location, posted date; **seller card (display name + badge, member-since, other listings)**; **Contact** (NID-gated); **phone reveal** (Verified Buyers only). Unavailable listings show a branded state page + similar items | P0 |
| 3.3.4 | Location-Based Discovery | Hyper-local search, distance filter (radius ≤100 km), division/district/area filters; 64 districts + thana-level areas from a versioned dataset; missing areas allow manual leaf entry (flagged for backfill); coordinates sanity-checked against district bounds | P0 |
| 3.3.5 | Search & Filters | Keyword, category, price range, condition, verification status, recency. Sort: Newest, Price ↑/↓, Nearest. Cursor pagination (20/page). Inverted ranges rejected inline. Search-service outage degrades to category browse + cached popular listings | P0 |
| 3.3.6 | Listing Management — Edit / Delete / Mark as Sold | Edit/delete own listings (optimistic-lock version field prevents concurrent-overwrite). **Mark-as-Sold offers two paths (§5.5): (a) select buyer from chat thread → buyer confirmation flow; (b) "Sold via phone/in person" → Direct Sale (unconfirmed).** Undo available within 15 min and before buyer response | P0 |
| 3.3.7 | Offer & Price Negotiation | Offer states: **Pending → Accepted / Declined / Countered / Expired (48h TTL)**; one active pending offer per buyer per listing; positive integer ≤ listing price ×2; accepted offer attaches a price-agreed card; price edits auto-cancel open offers with notice; notifications on every transition. **Accepted-offer semantics:** acceptance does not reserve the listing — it stays Active and purchasable by anyone; other offer-makers are not auto-notified; the seller may still Mark-as-Sold to any buyer (disclosed in offer UI copy) | P1 |
| 3.3.8 | Seller Dashboard | Verification status, listings, views (unique per user/listing/24h), chats, **call taps**, boosts, stats. Pending-seller dashboard is read-only | P0 |
| 3.3.9 | Ad Boosting / Featured Ads | Paid top-of-category promotion. **Edit/moderation interactions:** price/photo/category edits while boosted require confirmation; wrongfully-delisted boosts are restored as time-equivalent credit after appeal, fraud delist forfeits boost, seller-deleted/expired boosts are non-transferable (stated at purchase). **Suspension interaction:** an active boost is **paused** for the duration of a 7-day suspension (clock stops, resumes automatically on release); permanent ban = boost forfeited. **Catalog:** boost packages (e.g., 3/7/15-day top-placement) are server-configured per category — price/duration changes ship without an app release. **Credits:** auto-applied at checkout, partial use allowed, 12-month expiry, non-transferable; balance visible in Boost history. Package prices are set pre-launch in the server catalog; freemium cap = **5 active listings free** (§11.2#1) | P1 |
| 3.3.10 | Favorites & Saved Searches | Favorites require login; saved-search alerts delivered as push + in-app, **digest-capped at 1/day** | P2 |
| 3.3.11 | Report & Moderation | Report target = **listing, user, or chat message**. Categories: Scam/Fraud, Fake listing, Wrong category, Prohibited item, Harassment, Other. **Submission requires login** (guests prompted to log in); max 5 reports/day; duplicate open reports auto-merged; reporter identity hidden. Operator SLA ≤ 48h | P0 |
| 3.3.12 | Listing Lifecycle | Active listings auto-expire after **30 days**; reminders at 3 days and same-day; one-tap renew (unlimited) resets window. Expired listings retained 30 days with **Relist** (fresh posted-date). Sold listings auto-archive after 7 days. **Drafts** allowed (title or ≥1 photo required to save), auto-purged after 30 days, resumable. Near-duplicate active listings (same title + price + photo pHash) blocked with "renew existing" prompt | P0 |
| 3.3.13 | Deal Confirmation | **(a) Chat sale:** seller selects the buyer → buyer notified *"Did you purchase [Item] from [Seller]?"* → on confirmation a **Confirmed Deal** is recorded (drives §1.5 fraud-rate KPI); decline opens a dispute record (trust signal, listing stays Sold); no response in 7 days (one reminder at day 3) → **Unconfirmed**, late confirmation via support. **(b) Direct Sale (phone/walk-in):** recorded immediately, excluded from the confirmed-deal denominator; seller is prompted to invite the buyer into chat for confirmation. State machine: Active → PendingConfirm → Sold/Active (idempotent). **Dispute consequence:** ≥3 dispute records in 90 days auto-flag the seller to the moderation queue. **Anti-gaming:** a chat-path confirmation counts as a Confirmed Deal only if the thread had ≥1 buyer-initiated message before Mark-as-Sold; abnormal patterns (repeated same-buyer confirmations, high confirm volume linked to new accounts) auto-flag the seller for review. **Mutual 1–5★ ratings + tags are v2** (§10) | P0 |
| 3.3.14 | Prohibited Items Policy | Published prohibited-items list (firearms/weapons, prescription drugs, tobacco, alcohol, illegal wildlife/animals, stolen goods, counterfeit currency, explicit material, etc. — **Legal sign-off required before launch**); enforced via keyword + image classification at publish; violations route to moderation and may trigger suspension/ban | P0 |
| 3.3.15 | Onboarding, Empty States & Deep Links | 3-screen first-run intro; zero-results suggestions; empty-dashboard "Add your first product"; guest deep-link → auth/gate → return to exact listing/chat context; web links fall back to store install if app absent | P1 |

### 3.4 Pillar 4 — Platform Services (Foundation)

| # | Feature | Description | Priority |
|---|---|---|---|
| 3.4.1 | Authentication | Phone OTP is the **only** auth method (no passwords). OTP: 6 digits, 5-min expiry, 5 attempts, 60s resend cooldown, 5 OTP/number/day; **dual SMS-provider failover**. Generic "OTP sent" response on both signup and login (anti-enumeration). Refresh-token sessions, 30-day rolling expiry, max 3 active devices. **SIM-swap/new-device protection:** login from a new device on a KYC-verified account triggers risk-scored step-up (device signal + re-OTP, liveness for high-risk) and a security notification; OTP interception rate-limited per §6 NFR rate-limit table | P0 |
| 3.4.2 | Account & Session Management | Edit profile (display name 2–50 chars, photo, division/district) — **display name and profile photo pass the same moderation gates as listings** (name: profanity/impersonation check; photo: media pipeline + AI scan; rejected items revert to the previous value with notice); change number (§3.1.9), logout, delete account (§3.4.4). **"Active devices" screen** (model, location, last used) with remote logout; 4th login evicts oldest session with notice | P0 |
| 3.4.3 | Notification System | Push (FCM/APNs) + in-app center; SMS only for critical events (OTP, KYC rejection, suspension/ban, high-risk security). **Full event/channel matrix: Appendix D.** Per-category settings + default quiet hours 22:00–08:00 BST for non-critical; critical events cannot be muted. Tokens refreshed on app launch; uninstall cleanup; one coalesced notification per chat thread. All templates bilingual | P0 |
| 3.4.4 | Account Deletion & Data Handling | Self-serve deletion as a **14-day scheduled purge** (login in window offers one-tap cancel); after purge the phone number is released (login creates a fresh empty account — never auto-restores prior identity); listings removed, chats anonymized, profile purged. **KYC records retained per NFR-05, keyed by NID hash** to preserve ban enforcement — disclosed in versioned consent at both upload and deletion. Returning users re-verify via liveness-only (§3.1.12). **Payment receipts:** the user is prompted to download receipts before confirming deletion; post-deletion copies are retrievable only via Support within the data-retention window. App Store/Play compliant | P0 |
| 3.4.5 | Payments (Boosts) | **bKash merchant API (primary) + Nagad (secondary)**; cards v2. Payment states: `initiated → pending → success / failed / expired`; button locked after tap; client idempotency key; webhooks signature-verified, source-IP checked, idempotent and monotonic; pending expires in 15 min; app polls on reopen; **daily settlement reconciliation** auto-resolves orphan successes to **boost credits**; credits also issued for wrongful delist (3.3.9); insufficient-balance/cancel = retryable failure, no penalty. Receipt: in-app PDF, available 12 months in Boost history; receipt format carries VAT/tax fields per Bangladesh regulation (final format pending legal review, §11.3) | P1 |
| 3.4.6 | Internal Operations (Minimal Tooling) | Basic queue + manual ops in v1. **Operator tiers: KYC Reviewer · Moderator (warn/delist/suspend) · Senior Moderator (permanent ban with 4-eyes second approval, reversals/appeals, audit-log access).** Queue items are claim-locked (5 min); stale locks auto-release; conflicting actions rejected. Immutable audit record per action (actor(s), timestamp, action, entity, reason) in an append-only separate store. **SLA clock:** business hours Sun–Thu 10:00–18:00 BST excluding Fri–Sat and govt holidays; timers stored UTC, rendered BST; ageing past 80% SLA highlights + alerts ops. Operator accounts can never hold listings/chats | P0 |
| 3.4.7 | Support Channel (Minimal) | In-app **"Contact Support"** form (categories: Payment, Account/Login, KYC, Deal issue, Report follow-up, Other; free text ≤1000 chars + optional screenshot) → creates a ticket in the same minimal ops queue; replies appear in-app with push notification; SLA **≤ 48 business hours**. Entry points deep-linked from receipts, enforcement screens, appeals, and profile. **Banned users retain access to Support + Appeal only.** Live chat / call center out of scope | P0 |

### 3.5 Monetization Features
- Featured & boosted ads (paid — bKash/Nagad in v1)
- Freemium listing limits; fees for high-volume/commercial C2C sellers
- Premium verification badges / store profiles
- Targeted, non-intrusive banner ads (electronics, repair, logistics partners)

### 3.6 Enforcement & Appeals

**Enforcement ladder** (actions audit-logged; Permanent ban requires Moderator + Senior Moderator — 4-eyes):

| Level | Trigger | Effect |
|---|---|---|
| **Warning** | Minor first offence | Notice; no restriction |
| **7-day Suspension** | Repeated/mid offence; some prohibited-item cases | Listings hidden, chat/boost purchase blocked, **active boosts paused — clock stops, resumes on release (§3.3.9)**, browse retained; suspension screen; NOTIF-09 |
| **Permanent Ban** | Fraud, forgery, severe violations | NID-hash block platform-wide; all listings ended (boost forfeited for fraud); open chats frozen with "user no longer active" banner; counterparties notified; ban screen with reason category + appeal CTA |

**Appeal flow:** every rejection (KYC), suspension, delisting, and ban offers an in-app **Appeal** entry → separate appeal queue → Senior Moderator re-reviews within **72 business hours** (**≤ 24 business hours for 7-day-suspension appeals**, since the suspension auto-expires) → outcome + reason notified; successful appeal reverses the action (reversal itself audit-logged; the original log stays immutable).

**Ban effects on assets:** active listings hidden immediately; boosts handled per §3.3.9; chat threads become read-only; verified buyers who revealed the number before ban are not retroactively messaged (counterparties get the frozen-thread notice instead).

### 3.7 Resilience & Degraded Modes

| Dependency Fails | User-Visible Behavior |
|---|---|
| **Porichoy API** | Submissions accepted as `pending-vendor`; manual-review fallback; "verification in progress" — never a raw error; circuit breaker + backoff |
| **SMS/OTP provider** | Automatic second-provider failover; after both fail, friendly "try in 5 minutes"; no resend spam |
| **bKash / Nagad** | Boost purchase disabled with notice; in-flight pending reconciled on recovery; no double activation |
| **R2 / Wasabi** | Uploads queued client-side; listings with failed hero photo can't publish; reads fall back to CDN cache |
| **AI services** | Publish continues; scans backfill on restart; queue shows "AI unavailable" |
| **Search** | Category browse + cached popular listings; "search temporarily limited" banner |
| **Push (FCM/APNs)** | Retry; critical events escalate to SMS after one failed push |
| **Database failover** | Read-only mode page; RPO ≤ 24h, RTO ≤ 8h (NFR-08) |

Plus: feature flags + **geo-launch allowlist** for the Dhaka-first rollout (registration + listing visibility); min/forced/optional client-version config with hard-update screen; nightly orphan-data purge (abandoned uploads, 30-day drafts).

---

## 4. User Stories

The platform serves **Buyers, Sellers, and internal Operators**.

### 4.1 Buyer User Stories

| ID | As a buyer, I want to… | So that… | Acceptance Criteria |
|---|---|---|---|
| US-B01 | Register with my phone (OTP) | I can start quickly | Name + phone; OTP per §3.4.1; generic response whether or not number exists; existing user logs in |
| US-B02 | Search/browse by preference | I find the item I want | Filters + sorting work; cards show photo, price, title, seller badge |
| US-B03 | Open a Product Details page | I can inspect details | Full details incl. condition, location, posted date; unavailable listings show branded state |
| US-B04 | See seller information | I can judge trustworthiness | Display name, badge, member-since, other listings (never seller's NID data) |
| US-B05 | Complete basic NID verification | I can unlock chat/numbers | Porichoy → approved → badge + access; rejected with reason, retry allowed, appealable |
| US-B06 | Tap **Contact** | I can chat with the seller | Verified → thread with product reference; unverified → NID prompt; blocked/suspended users rejected with state message |
| US-B07 | See/call the seller's number (Verified Buyer) | I can phone immediately | Reveal endpoint, 20/day cap, logged; hidden if seller toggled off; tap = native dialer |
| US-B08 | Report a listing/user | Others are protected | Login required; category + details; ≤5/day; status notifications |
| US-B09 | Save favorites | I revisit items | Login required; list in profile |
| US-B10 | Delete my account | I control my data | 14-day scheduled purge; cancel by login; KYC-retention disclosure confirmed |
| US-B11 | Confirm or dispute a deal | Purchase counts accurately | Confirm/decline notification; decline = dispute record; 7-day timeout = Unconfirmed; day-3 reminder |
| US-B12 | Appeal a rejection/suspension/ban | Wrong decisions can be reversed | Appeal entry on enforcement screen; senior review ≤72h; outcome notified |
| US-B13 | Recover my account after losing my SIM | I keep my identity/reputation | NID + liveness recovery, 24h cooling, number rebound |
| US-B14 | Manage my active sessions | My account stays secure | Device list, remote logout, new-device alerts |
| US-B15 | Contact support from the app | I get help with payments, account, or deal issues | Category + details; ticket created in ops queue; reply pushed in-app; accessible even when banned |

### 4.2 Seller User Stories

| ID | As a seller, I want to… | So that… | Acceptance Criteria |
|---|---|---|---|
| US-S01 | Upgrade my buyer account | I can start selling | "Become a Seller" → KYC (single account, role upgrade) |
| US-S02 | Complete seller verification | I'm allowed to list | Pending (≤24 business h) → approved/rejected; reason codes; ≤3 re-submits/30d; duplicate-ID auto-rejected; appealable; NID reused from buyer verification |
| US-S03 | Log in directly | No repeat verification | Verified seller lands on dashboard |
| US-S04 | See my Seller Dashboard | I manage everything | Status, listings, views, chats, call taps, boosts; read-only while pending |
| US-S05 | Add/list a product | Buyers discover it | Rules per §3.3.2; live only when approved; async AI scan; prohibited-item checks |
| US-S06 | Edit my listing | I update details | Optimistic locking; open offers auto-cancel on price edit; boosted-edit confirmation |
| US-S07 | Delete my listing | I remove items | Confirmation; threads freeze with banner |
| US-S08 | Mark as Sold (chat buyer OR phone/in person) | Stats & deals are recorded | Buyer-select → confirmation flow, or Direct Sale; undo within 15 min |
| US-S09 | Receive chats and calls | I negotiate & close | Push notifications; call taps tracked |
| US-S10 | Boost a listing | Faster sale | bKash/Nagad per §3.4.5; featured placement; receipt; credit on failures/delisting per policy |
| US-S11 | Renew/relist | My listing stays live | Renewal reminders (3d/same-day); one-tap renew; 30-day relist window after expiry |
| US-S12 | Toggle my phone visibility | I control my exposure | Hidden = chat-only contact; PDP reflects state |
| US-S13 | Save and resume drafts | I finish listings later | Auto-saved; resume from dashboard; 30-day purge |

**Gate rule:** Add/Edit-publish disabled until seller verification is **approved**.

**Visibility rule:** Seller phone numbers are **never public**; reveal/initiate-chat require **Verified Buyer** status.

### 4.3 Operator User Stories

| ID | As an operator, I want to… | So that… | Acceptance Criteria |
|---|---|---|---|
| US-OP01 | Review KYC queue | Fast, accurate verification | Oldest-first; claim-lock; approve/reject with reason; ≤24 business h; audit-logged |
| US-OP02 | Handle reports | Fraud is removed | AI evidence attached; dismiss/warn/suspend/delist; ≤48h; audit-logged |
| US-OP03 | Impose permanent bans (Senior) | Severe fraud is stopped | 4-eyes (Moderator + Senior); NID-hash block; asset effects per §3.6 |
| US-OP04 | Review appeals | Wrong decisions are corrected | Separate queue; senior-only; ≤72 business h (≤24 for suspension appeals); reversal audit-logged |
| US-OP05 | See the audit trail | Accountability & future console | Append-only, hash-chained, separate account; actor/timestamp/action/entity/reason |

---

## 5. User Flows

### 5.1 Buyer Flow — Register, Browse, Verify, Contact
```
Open App
  → New: Register (name, phone → OTP, dual-provider failover) | Existing: Login
      • new-device login on KYC account → step-up check + security alert
  → Browse/search (no NID)
  → Product Details Page
      • [Contact]: unverified → NID gate (Porichoy) | Verified → chat thread
      • Phone: guest/unverified → "Verify to view number"
              Verified → reveal endpoint (20/day) → tap → SIM call (logged)
  → Chat / call / offer (Pending→Accepted/Declined/Countered/Expired 48h)
  → Deal offline (cash)
      • Chat sale  → seller marks Sold, selects buyer → buyer confirms/disputes
      • Phone/walk-in sale → seller marks "Sold via phone/in person" (Direct Sale)
  → (Optional) Report
```

### 5.2 Seller Flow — Upgrade, Verify, List, Sell
```
Login (existing buyer) → "Become a Seller"
  → KYC via Porichoy (NID reused if buyer-verified; duplicate-ID check; expiry check)
  → Pending (read-only dashboard) → Approved | Rejected (reason → re-submit / appeal)
  → Add Product (draft auto-save) → Publish → async AI + prohibited-item scan
  → Manage: Edit (lock + offer cancel) · Delete · Mark Sold (chat/direct) · Renew/Relist
  → Boost optional (bKash/Nagad; states; reconciliation; receipts)
  → Listing: 30-day expiry → reminders → renew / 30-day relist window
```

### 5.3 Trust & Safety Flow
```
Report (logged-in, category) or AI flag → moderation queue (claim-locked)
  → AI evidence attached → SLA 48h
  → Dismiss | Warn | 7-day Suspend | Delist | Permanent Ban (4-eyes)
  → Ban: NID-hash block, listings ended, chats frozen, counterparties notified
  → Appeal available → senior review ≤72h → reversal or upheld
  → All actions + reversals → immutable hash-chained audit log
```

### 5.4 Monetization Flow (Boost)
```
Select listing → package → bKash/Nagad (amount computed server-side)
  → initiated → pending (webhook, signature + IP + idempotency)
  → success → boost active → receipt; expiring notices (3d, 1d), expired
  → failed/cancel → retryable; pending >15 min → expired
  → app-reopen poll + nightly reconciliation → orphan success = boost credit
```

### 5.5 Deal Confirmation Flow
```
Chat path: Mark Sold → select buyer from thread
  → Buyer: "Did you purchase [Item] from [Seller]?"
       Confirm      → CONFIRMED DEAL (fraud-rate KPI denominator)
       Decline      → dispute record; trust signal on seller; listing stays Sold
       No response  → day-3 reminder → 7-day timeout = UNCONFIRMED
  → Seller undo: within 15 min & before buyer response (restores Active)
Direct path: "Sold via phone/in person"
  → DIRECT SALE (immediate; conversion KPI only; excluded from fraud denominator)
  → Prompt: invite buyer into chat to upgrade it to a Confirmed Deal
  v2: ratings 1–5★ + tags → Trust Score Badge (§10)
```

### 5.6 Appeal Flow
```
Enforcement screen / KYC rejection → "Appeal" → reason + optional evidence
  → Appeal queue (separate) → Senior Moderator ≤72 business hours
  → Upheld (state unchanged) | Reversed (action undone, rights restored, audit-logged)
  → Outcome pushed + in-app (+ SMS for bans)
```

### 5.7 Account Recovery Flow (Lost SIM)
```
Change number:
  Old SIM alive → OTP old + new → rebound immediately
  Old SIM lost  → NID + fresh liveness (Porichoy)
       match → 24h cooling (notice attempt) → new number bound
       no match / banned NID → blocked
```

---

## 6. Non-Functional Requirements

| # | Category | Requirement |
|---|---|---|
| NFR-01 | Performance | p95 API < 500 ms; search p95 < 1 s; images via CDN |
| NFR-02 | Scalability | 100K users / 10K sellers Year-1 with ×3 headroom; stateless horizontal API tier |
| NFR-03 | Availability | ≥ 99.5% monthly; maintenance windows off-peak BST; forced-version & maintenance-mode config |
| NFR-04 | Security — transport/auth | TLS 1.2+; mobile cert pinning (with fallback policy); web HSTS + CSP; OTP anti-enumeration & rate limits; step-up on new-device/high-risk; tokens in Keychain/Keystore-backed storage, bound to app signature |
| NFR-04a | Security — authorization | Server-side ownership checks on every resource (no IDOR reliance); role middleware enforcing Appendix B; full swapped-ID test coverage; reviewer access scoped to open cases only, no bulk export, screenshot-blocked KYC viewer; operator 2FA + IP allowlist |
| NFR-04b | Security — abuse | Rate-limit table below; guest CAPTCHA on anomalous search; report rate limits; signed device headers on mobile; AV scan on all uploads; secrets never shipped in binaries |
| NFR-04c | Security — audit | Append-only, hash-chained audit log in a separate cloud account; no update/delete API; permanent bans 4-eyes; every KYC document view logged |
| NFR-05 | PII & KYC Data Protection | KYC artifacts in cloud object storage, **not** the main DB; AES-256 at rest in private isolated buckets; signed-URL TTL ≤ 5 min with content-type/size constraints; KMS-managed keys; ops-only logged time-bound access. **Retention:** active — while alive; rejected — 90 days then purged; banned — indefinite; deleted accounts — 3 years (consent-disclosed). Versioned consent records at upload and deletion. Logs never contain OTP/NID/token/full number (masked). Legal review vs Bangladesh ICT Act/data-protection law before launch |
| NFR-05a | KYC Metadata in DB | Only: `user_id`, `nid_hash`, `nid_number_encrypted`, `name_encrypted`, `dob_encrypted`, `verification_status`, `porichoy_txn_id`, `storage_path`, `audit_log_id` |
| NFR-06 | Localization | Bangla + English; first-launch chooser (device default), in-profile switch; UI **and** notification templates bilingual; BDT ৳ / টাকা display; UTF-8; all timestamps stored UTC, rendered Asia/Dhaka |
| NFR-07 | Platform | Android + iOS + responsive web; parity matrix; native camera capture on mobile, upload on web with "continue on phone" fallback where liveness unsupported |
| NFR-08 | Reliability / DR | Daily backups; RPO ≤24h, RTO ≤8h; read-only failover page |
| NFR-09 | Observability | Crash reporting, structured logs, correlation IDs on all errors, KPI instrumentation, error/latency alerts; never raw stack traces to users |
| NFR-10 | Network Resilience | 2G/3G degradation; lazy/adaptive images; offline listing draft + chat queue with idempotent retry; ±5-min device clock-skew tolerance |
| NFR-11 | Accessibility | WCAG 2.1 AA baseline: contrast, labels, scalable fonts |
| NFR-12 | Store Compliance | In-app deletion, privacy policy, data-safety disclosures |
| NFR-13 | KYC Storage Architecture | **Cloudflare R2** primary ($0 egress, Dhaka PoP, direct signed-URL uploads); **Wasabi** archive ($6.99/TB) with 90-day lifecycle; nightly orphan purge; ~$2/month at Year-1 scale |
| NFR-14 | Resilience Modes | Degraded-mode matrix per §3.7; circuit breakers + retries for Porichoy/SMS/payments; dual SMS provider; nightly payment reconciliation; backfill queues for AI/search |
| NFR-15 | Idempotency & Concurrency | Client idempotency keys on all mutating APIs (listing, sold, offer, payment, report, block, chat send); monotonic payment states; optimistic-lock version on listings; queue claim-locks for ops |
| NFR-16 | Input Validation | All Appendix C rules enforced **server-side**; client validation is UX-only; server HTML-escape/sanitize all user content (stored XSS); magic-byte file verification; EXIF stripping |

**Rate-limit table (per NFR-04b):**

| Action | Authenticated | Guest |
|---|---|---|
| OTP request | 5 / number / day | — |
| OTP verify | 5 / OTP | — |
| Search | 60 / min | 20 / min / IP (+CAPTCHA threshold) |
| Listing create | 10 / day / seller | — |
| Chat message | 30 / min / thread | — |
| New chat thread | 20 / day | — |
| Phone reveal | 20 / day | blocked |
| Offer send | 20 / day | — |
| Report | 5 / day | blocked |
| Boost purchase | 10 / day | — |

---

## 7. Out of Scope (v1)

1. **In-app payment / escrow** — in-person settlement; escrow v2.
2. **Logistics / delivery integration**.
3. **B2C / business storefronts** — C2C only; commercial sellers via freemium caps.
4. **Auction / bidding** — fixed price + negotiation only.
5. **Public ratings/reviews** — deal confirmation ships v1; mutual 1–5★ ratings + tags + Trust Score Badge in v2.
6. **International users / cross-border trade** — Bangladesh-only.
7. **Desktop-first experience** — mobile first; responsive web for browse/search/details/contact.
8. **AI-generated listings** — detection only.
9. **Rental/services categories** — physical second-hand goods.
10. **Number masking / VoIP** — real number to Verified Buyers only; masking v2.
11. **Full admin console GUI** — minimal tooling + audit-ready data model; console v2.
12. **Card payments** — bKash/Nagad only.
13. **Image sharing in chat** — text + offer cards only.
14. **Email channel** — no email collected; in-app receipts; email v2.
15. **Hard device-binding** — risk-scored step-up in v1; full binding v2.

---

## 8. Competitive Positioning

| Feature | Bikroy.com | Facebook Marketplace | **Trust Bazar** |
|---|---|---|---|
| User Identity Check | Optional / Partial | None | **Mandatory seller KYC (Porichoy); NID gate for buyer chat** |
| Fraud Prevention | Moderate | Very Low | **High — KYC + AI + enforced ladder + appealable permanent ID bans** |
| Platform Trust | Diluted by scams | Low | **High (Zero-Anonymity Interactions)** |
| Buyer Contact | Phone/chat | Messenger only | **NID-gated chat + direct call (Verified Buyers only)** |
| Ease of Listing | Easy | Very Easy | **Easy & Secure** |

---

## 9. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Seller KYC friction | 2-minute UX; read-only dashboard during pending; resume support (3.1.10) |
| Buyer NID-gate friction | Hybrid model; NID only at chat intent; <2-min Porichoy flow |
| Porichoy dependency | Commercial agreement early; `pending-vendor` + manual fallback; circuit breaker |
| SMS delivery failure | Dual-provider failover (§11.2#2) |
| SIM-swap / OTP account takeover | New-device step-up, security alerts, NID+liveness recovery, full device-binding v2 |
| Recycled phone numbers | Identity keyed to NID hash; released numbers start fresh (§3.4.4) |
| Number spam/harassment | Reveal endpoint + 20/day cap, logging, anomaly throttle, seller toggle, report/block |
| Off-platform deal scams | In-chat warnings for shared numbers/links; moderation flags (3.2.8) |
| Storage cost growth | R2 + Wasabi lifecycle; ~$2/mo Year-1; review at 100K users |
| Cold-start liquidity | Geo-launch allowlist, Dhaka first, seeded categories, free boosts |
| KYC data breach / insider | AES-256, private buckets, ≤5-min URLs, KMS, scoped ops access, 2FA, view logging, hash-chained audit, incident plan |
| Payment webhook failure | Idempotency, polling, nightly reconciliation, credits, monotonic states |
| Prohibited-item liability | Legal-approved policy + automated classification pre-launch (3.3.14) |
| Wrongful enforcement | Warning→suspend→ban ladder, 4-eyes bans, 72h appeals with reversal |

---

## 10. Roadmap Notes (v2)

- Mutual ratings & Trust Score (built on §5.5).
- Escrow / in-app deal payments.
- Number masking / VoIP; full device-binding.
- Full admin console (data already audit-ready).
- Card payments; email channel; image sharing in chat (with AI screening).

---

## 11. Decisions & Open Questions

### 11.1 Resolved
**2026-10-08:** Single account + role upgrade · Android+iOS+responsive web · Minimal ops tooling · Porichoy as KYC vendor · Hybrid buyer NID gate · Ratings v2.
**2026-10-10 (v1.4 — validation remediation):** Identity keyed to NID hash (not phone) · Direct Sale recording path · Appeal flow & enforcement ladder · 14-day deletion grace · Lost-SIM recovery (NID+liveness) · Payment state machine + nightly reconciliation · Cloudflare R2 + Wasabi storage · Call taps replace "calls" KPI · Offer 48h lifecycle · 30-day listing expiry + relist · Permission matrix, validation rules, notification matrix adopted (Appendices B–D) · Degraded-mode matrix · Prohibited-items policy mandatory pre-launch · Number reveal cap 20/day · Age policy 18+ (no upper cap).
**2026-10-17 (v1.5 — business-logic round 2):** In-app support channel (§3.4.7) · active boost **pauses** during 7-day suspension · liveness-only re-verification for returning deleted users (§3.1.12) · dispute threshold ≥3/90 days → moderation auto-flag · deal-confirmation anti-gaming rules (thread-activity requirement + abnormal-pattern flagging).
**2026-10-17 (v1.6 — business-logic round 3):** Boost catalog server-configured + credit rules (auto-apply, partial use, 12-month expiry) · VAT/tax fields on receipts · expedited appeal ≤24 business h for suspensions · accepted-offer semantics (no reservation) · profile name/photo moderation gates · report targets (listing/user/message) · listing-bound threads only · buyer-NID pending UX · receipt handling across account deletion.
**2026-10-17 (v1.7 — finalized):** Freemium default (5 active listings/seller free) · SMS dual-provider shortlist for commercial eval · price-baseline seeding plan (manual seed → 30-day telemetry recalibration) · caps confirmed at 20/day pending telemetry · remaining items moved to external pre-launch actions (§11.3). **Status: Final for engineering handoff.**

### 11.2 Final Business Decisions (2026-10-17)
1. **Freemium threshold:** 5 active listings free per seller; beyond that a paid seller package applies (price set in the server-managed catalog before launch; tunable without app release, §3.3.9).
2. **SMS providers:** dual BD aggregator contracts before launch — shortlist for commercial evaluation: SSL Wireless (primary candidate), Alpha SMS / BulkSMSBD (secondary); §3.4.1 failover applies.
3. **Category price baselines:** seeded manually from public marketplace medians at launch; auto-recalibrated from first-party sold-listing telemetry after 30 days.
4. **Reveal/call-tap caps:** 20/day confirmed at launch; reviewed against telemetry at day 30.

### 11.3 External Pre-Launch Actions (not doc-decidable)
**Ready-to-send materials: [Pre-Launch_Actions.md](Pre-Launch_Actions.md)** — counsel briefing memo, prohibited-items policy draft, consent texts, vendor inquiry emails, POC checklists, action tracker.
- **Legal (launch blocker):** KYC retention schedule (NFR-05) + prohibited-items list sign-off — external counsel.
- **Vendors:** Porichoy commercial agreement + POC (cost/quota/SLA); bKash/Nagad merchant onboarding; SMS aggregator contracts (§11.2#2).

---

## Appendix A — Decision Log

| Date | Decision |
|---|---|
| 2026-10-08 | Project named **Trust Bazar**; single account + role upgrade; v1 platforms; minimal ops; Porichoy; hybrid onboarding; ratings v2 |
| 2026-10-08 | R2 + Wasabi KYC storage; encrypted metadata-only DB fields |
| 2026-10-10 | PRD v1.4 adopts all Requirement_validation.md critical/high findings (see §11.1) |
| 2026-10-17 | PRD v1.5: support channel, boost-pause on suspension, liveness-only re-verification, dispute threshold, deal anti-gaming (P1–P5 remediation) |
| 2026-10-17 | PRD v1.6: boost catalog & credit rules, VAT receipts, expedited suspension appeals, offer semantics, profile moderation, report targets, pending-NID UX, receipt retention (P6–P12 remediation) |
| 2026-10-17 | PRD v1.7 finalized for engineering handoff; business defaults set (§11.2); external legal/vendor actions listed (§11.3) |

## Appendix B — Permission Matrix

| Capability | Guest | Buyer | Verified Buyer | Pending Seller | Verified Seller | Suspended (7d) | Banned | KYC Reviewer | Moderator | Senior Moderator |
|---|---|---|---|---|---|---|---|---|---|---|
| Browse/search/details | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ban screen | ✅ | ✅ | ✅ |
| Favorites/saved search | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | — | — | — |
| Submit report | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Initiate chat | ❌ | ❌ | ✅ | ✅* | ✅ | ❌ | ❌ | — | — | — |
| Reply in existing thread | ❌ | ✅ | ✅ | ✅ | ✅ | read-only | read-only | — | — | — |
| Reveal/call number | ❌ | ❌ | ✅ | ✅* | ✅ | ❌ | ❌ | — | — | — |
| Send offer | ❌ | ❌ | ✅ | ✅* | ✅ | ❌ | ❌ | — | — | — |
| Start seller upgrade | — | ✅ | ✅ | — | — | ❌ | ❌ | — | — | — |
| Seller dashboard | — | — | — | read-only | ✅ | hidden | ❌ | — | — | — |
| Create/publish listing | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | — | — | — |
| Mark sold / renew / boost | — | — | — | — | ✅ | ❌ | ❌ | — | — | — |
| Delete own account | — | ✅ | ✅ | ✅ | ✅ | ✅ | via appeal | — | — | — |
| Contact support | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (support/appeal only) | ✅ | ✅ | ✅ |
| Review KYC cases | — | — | — | — | — | — | — | ✅ | ❌ | ❌ |
| Warn / delist / suspend | — | — | — | — | — | — | — | — | ✅ | ✅ |
| Permanent ban (4-eyes) | — | — | — | — | — | — | — | — | propose | approve |
| Appeal review / reversal | — | — | — | — | — | — | — | — | ❌ | ✅ |
| View audit log | — | — | — | — | — | — | — | ❌ | ❌ | ✅ |

\* Pending sellers retain prior Verified-Buyer capabilities. Enforcement overrides capability roles where they conflict. Operator accounts can never hold listings or chats.

## Appendix C — Validation Rules (server-enforced)

**Auth/profile:** Phone — BD mobile `^01[3-9]\d{8}$`, normalize `+880`/`8801…` and Bangla numerals · Name 2–50 chars (Bangla/English, spaces, `. - '`) · OTP 6 digits, single-use, 5 min · Profile photo JPEG/PNG/WebP ≤3 MB, ≥200×200, server re-encoded · Division+district mandatory, coordinates within district bounds · language enum `bn/en` · new number must not be bound to another active account.

**KYC:** NID 13- or 10-digit per Porichoy spec with checksum; Bangla numerals accepted · age ≥18 from DOB · documents JPEG/PNG/WebP/PDF ≤5 MB, magic-byte checked, ≥1080p long edge · selfie live-capture only ≤5 MB; grey-zone → manual · passport expiry ≥30 days future · ≤3 attempts/30 days (forgery → ban path) · versioned consent before upload.

**Listings:** Title 10–100 chars (no price/phone-in-title, prohibited-term scan) · Description 20–5000 sanitized chars · Price integer BDT ৳1–৳9,99,99,999 · Condition enum: New / Used–Like New / Used–Good / Refurbished / For Parts · leaf category id required · photos 1–10 per §3.3.2 with EXIF strip + pHash duplicate check · draft needs title or ≥1 photo.

**Chat/offer/report/payment:** Message 1–2000 trimmed chars; identical-message burst throttled · offer positive integer ≤ price×2, one pending/buyer/listing, 48h TTL · report category enum + description ≤1000, one open report/reporter×entity · boost package id server-priced (client amount ignored) · payment idempotency UUID required.

## Appendix D — Notification Matrix

P=Push · I=In-app · S=SMS · Ops=internal. Critical events non-mutable; quiet hours 22:00–08:00 BST otherwise.

| Event | Audience | Channels |
|---|---|---|
| OTP | self | S |
| KYC submitted / approved | self | P + I |
| KYC rejected (+reason) | self | S + P + I |
| New chat message | recipient | P + I (coalesced per thread) |
| Offer transitions (received/accepted/declined/countered/expired) | both | P + I |
| Listing flagged / removed / reinstated | seller | I (+P if hidden; +S if banned) |
| Warning / suspension / ban (+appeal link) | user | S + P + I |
| Boost activated / expiring (3d, 1d) / expired | seller | P + I |
| Payment failed / reconciled-to-credit | seller | P + I |
| Report received / updated / resolved | reporter | I + P |
| Deal confirmation request; buyer result (confirm/decline/timeout) | buyer / seller | P + I |
| New-device login; number changed; deletion scheduled | self | I + P (+S on number change) |
| Listing expiry reminders (3d, same-day) / expired / renewed | seller | P + I |
| Saved-search match | buyer | P digest ≤1/day + I |
| "Item sold" notice to other inquiring buyers | buyers | I |
| Support reply received | user | P + I |
| SLA ageing/breach; vendor outages | ops | Ops |
