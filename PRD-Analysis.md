# PRD Analysis — Trust Bazar

**Document:** PRD Analysis Report
**Analyzed PRD:** [PRD.md](PRD.md) — Trust Bazar v1.2 (Draft, 2026-10-08)
**Analysis Date:** 2026-10-08
**Role:** Senior Product Analyst / Business Analyst
**Status:** Final — incorporates stakeholder decisions of 2026-10-08

---

## 1. Executive Summary

Trust Bazar is a verified C2C second-hand marketplace for Bangladesh whose core differentiator is a **zero-anonymity selling model**: every seller must pass KYC (NID/Passport/Smart Card + selfie liveness) before listing, while buyers register with phone OTP only.

The PRD (v1.2) is **well-structured for a draft**: it has a clear vision, prioritized features (P0–P2), user stories with acceptance criteria, flows, an explicit out-of-scope list, and a risk register. However, the analysis identified **significant gaps** that must be addressed before engineering handoff:

| Verdict | Summary |
|---|---|
| **Critical gaps** | No Non-Functional Requirements section; no defined admin/moderation operating model (now resolved: minimal tooling in v1); no notification system anywhere in the PRD; no PII/KYC-data protection & retention policy |
| **High gaps** | KYC review workflow undefined; no listing lifecycle (expiry/renewal); payment gateway spec missing; "calls" KPI is technically untrackable for SIM calls; auth & account-management FRs missing |
| **Resolved decisions** | (1) Single account with buyer→seller role upgrade; (2) v1 targets Android + iOS + responsive web; (3) v1 ships with minimal internal tooling / manual ops instead of a full admin console |

**Overall recommendation:** PRD is approved as a *strategic* document but is **not yet engineering-ready**. Section 10 lists the concrete updates required to bring it to v1.3.

---

## 2. Product Goals & Objectives

### 2.1 Explicit Goals (from PRD)

| Goal | Source | Assessment |
|---|---|---|
| Eliminate fraud via 100% verified sellers | §1.1–1.2 | Clear, measurable through verification rate |
| Bikroy-style familiar UX with trust differentiation | §1.1, §7 | Clear positioning |
| Monetization: boosts, freemium limits, premium badges, banner ads | §3.4 | Defined but no pricing/packaging FRs |

### 2.2 KPI Feasibility Assessment (§1.5)

The PRD defines 7 Year-1 KPIs. Several have **measurement problems** because deals settle offline in cash:

| KPI | Target | Measurable? | Issue |
|---|---|---|---|
| Registered buyers | 100,000+ | ✅ Yes | — |
| KYC-verified sellers | 10,000+ | ✅ Yes | — |
| Seller verification completion rate | ≥ 70% | ✅ Yes | Funnel instrumentation needed |
| Fraud report rate | < 0.5% of completed deals | ⚠️ Partial | **"Completed deals" unknown** — deals happen offline; no in-app confirmation exists |
| Listing-to-sale conversion | ≥ 25% in 30 days | ⚠️ Partial | Depends on "Mark as Sold" being mandatory — currently optional |
| Chat response rate | ≥ 80% in 24h | ✅ Yes | In-app chat is fully instrumentable |
| Paid ad/boost attach rate | ≥ 5% | ✅ Yes | — |

> **Finding (G-01):** Two KPIs depend on an offline event ("sale") the platform cannot observe unless "Mark as Sold" is enforced or incentivized. Recommend making **Mark-as-Sold confirmation a tracked metric** (e.g., prompt both parties in chat after negotiation) and redefining the two KPIs around it.

### 2.3 Implicit Goals

- Trust as the brand moat vs. Bikroy/Facebook Marketplace (§7).
- City-by-city cold-start strategy (§8) implies **geo-launch control** capability — no FR exists for limiting launch city or seeding listings (G-02).

---

## 3. User Types & Roles

### 3.1 User Types Identified in PRD

| User Type | Registration | KYC | Capabilities (v1) | Defined in PRD? |
|---|---|---|---|---|
| **Guest / Visitor** | None | — | Browse, search, view listing details; **never** sees seller phone number | ⚠️ Implied only (§3.2.2, §4 rule) |
| **Registered Buyer** | Phone OTP | Not required | Everything guests can + see/call seller number, in-app chat, report, favorites | ✅ §4.1 |
| **Verified Seller** | Phone OTP + KYC | **Mandatory before listing** | Everything buyers can + dashboard, add/edit/delete listings, boosts | ✅ §4.2 |
| **Platform Operator / Admin** | — | — | KYC review, moderation queue, warn/delist/ban actions | ❌ **Persona never defined** — only referenced in flows (§5.3) |

### 3.2 Role Model — ✅ RESOLVED (Stakeholder Decision 2026-10-08)

**Decision: Single account with role upgrade.**
- One identity per person. A user registers as **Buyer** (phone OTP).
- Any buyer can later upgrade to **Seller** by completing KYC — the seller role *unlocks* on approval.
- KYC result is bound permanently to that identity (supports the NID/Passport permanent-ban rule, §3.1.4).

**Impact on PRD:**
- US-S01 ("Sign up as a new seller") must be reframed as **"Buyer upgrades to seller"** — the seller-side flow (§5.2) starts from an existing account, not a fresh signup.
- A new user story is implied: *"As a buyer, I want to upgrade my account to a seller by verifying my identity, so that I can start listing."* (US-B08 / US-S10 — see §5.4).
- Bans block the identity, not an "account type" — consistent with single-account model.

### 3.3 Persona Assessment

- Personas A/B/C (§2.1) are realistic and Bangladesh-appropriate.
- **Missing Persona D — Internal Operator** (KYC reviewer / moderator). Even with minimal tooling (see 3.4), the PRD should define who performs reviews, expected volume, and SLA expectations.

### 3.4 Admin/Moderation Model — ✅ RESOLVED (Stakeholder Decision 2026-10-08)

**Decision: Minimal tooling / manual ops for v1.**
- No full admin GUI in v1. KYC review and report moderation run on a **basic internal queue** (or manual DB operations) operated by the founding team.
- **Consequence requirement (G-03):** The data model must still capture full **audit trails** (who acted, when, what action) from day one, so a proper admin console can be layered on later without re-engineering.

---

## 4. Platform Scope — ✅ RESOLVED (Stakeholder Decision 2026-10-08)

**Decision: v1 targets Android + iOS apps + responsive web.**

| Platform | v1 Scope Notes |
|---|---|
| **Android app** | Primary (Bangladesh is Android-dominant) |
| **iOS app** | In v1 scope — increases cost; KYC document capture (camera, liveness) must work on both |
| **Responsive web** | In v1 scope — at minimum: browse, search, listing details, login, contact chat, phone-number reveal. **Open sub-question:** is KYC upload supported on web in v1, or app-only? (A-09, §8) |

**Impact on PRD:** §6.7 ("Desktop-first experience out of scope") remains valid, but the wording should state explicitly that iOS and responsive web are **in** v1 scope. Cross-platform NFRs added (§6.9).

---

## 5. Functional Requirements Analysis

### 5.1 Requirements Coverage from PRD (by Pillar)

**Pillar 1 — Mandatory Seller KYC (§3.1)** — coverage good; workflow gaps noted.

| Ref | Requirement | Priority | Analysis Note |
|---|---|---|---|
| FR-KYC-01 | Document upload + OCR validation (NID/Passport/Smart Card) | P0 | Vendor undefined (PRD OQ#1). Manual review fallback needed in v1 |
| FR-KYC-02 | Selfie liveness + face match | P0 | Same vendor dependency |
| FR-KYC-03 | Verification badge on profile & listings | P0 | Clear |
| FR-KYC-04 | Permanent ID-based ban (no disposable profiles) | P0 | Requires **duplicate-ID detection** at KYC submission — FR not written (G-04) |
| FR-KYC-05 | Premium trust badges / store profile | P2 | Deferred fine |

**Pillar 2 — Anti-Fraud & Communication (§3.2)** — core differentiator; several sub-FRs missing.

| Ref | Requirement | Priority | Analysis Note |
|---|---|---|---|
| FR-COM-01 | In-app Contact chat | P0 | No chat sub-features spec'd: blocking, reporting, media, retention (G-05) |
| FR-COM-02 | Seller number visible to logged-in buyers only; tap-to-call | P0 | Clear + solid visibility rule (§4) |
| FR-FRD-01 | AI fraud image detection (stock photos) | P1 | Pipeline/tresholds undefined; must not block publish (async flag → moderation) |
| FR-FRD-02 | AI price anomaly detection | P1 | Needs category price-baseline data; no FR for baseline seeding |
| FR-SAF-01 | Safe meetup suggestions | P2 | Clear |

**Pillar 3 — Marketplace Core (§3.3)** — coverage good.

| Ref | Requirement | Priority | Analysis Note |
|---|---|---|---|
| FR-MKT-01 | Multi-category listings | P0 | Taxonomy source undefined (G-06) |
| FR-MKT-02 | Add listing (blocked until verified) | P0 | Photo limits/rules undefined (G-07) |
| FR-MKT-03 | Product details page (seller card, contact, gated number) | P0 | Clear |
| FR-MKT-04 | Location-based discovery | P0 | Divisions/districts/areas data source undefined |
| FR-MKT-05 | Search & filters | P0 | Sorting/pagination undefined (G-08) |
| FR-MKT-06 | Edit / delete / mark-sold | P0 | Clear |
| FR-MKT-07 | Offer & counter-offer in chat | P1 | Flow not detailed |
| FR-MKT-08 | Seller dashboard (views/chats/calls/boosts) | P0 | ⚠️ "Calls" stat is not technically measurable for SIM calls (G-09) |
| FR-MKT-09 | Ad boosting / featured | P1 | Payment FR missing (G-10) |
| FR-MKT-10 | Favorites & saved searches | P2 | Alert delivery channel undefined (ties to G-11) |
| FR-MKT-11 | Report & moderation | P0 | Moderation workflow undefined (G-03/G-12) |

### 5.2 Missing Functional Requirements (New — must be added to PRD)

**Authentication & Account Management (entirely absent — G-13):**
- OTP request/verify/resend rules, rate limits, expiry.
- Session management, logout, multi-device policy.
- Profile edit (name, photo), change phone number.
- **Account deletion** (mandatory for App Store / Play Store policy).
- Passwordless confirmation: is OTP the *only* auth method? Specify.

**Notifications (entirely absent — G-11):** at minimum, events requiring delivery:
- KYC submitted / approved / rejected (+ reason).
- New chat message (push).
- Listing flagged / removed by moderation.
- Boost purchased / expiring / expired.
- Report status updates.
- Channels: push (app), SMS fallback (Bangladesh-relevant). In-app notification center.

**KYC Review Workflow (G-14):** submission → pending → approved/rejected (+ reason codes), re-submission rules & limits, reviewer SLA (manual review in v1 per resolved decision), escalations.

**PII / KYC Data Lifecycle (G-15 — critical):** encrypted upload & storage, restricted access (ops-only), retention period (while active + X days after deletion/ban), consent capture, deletion/ban data-handling rules. This is both an FR and an NFR (§6.5).

**Listing Lifecycle (G-16):** expiry/renewal policy (classifieds standard), auto-archive sold items, draft state, re-listing rules.

**Payments (G-10):** bKash/Nagad/card gateway selection, boost purchase flow FR, receipts/invoices, refund & failure handling. (PRD flow §5.4 assumes this exists.)

**Chat Management (G-05):** block user, report conversation, image sharing (yes/no), message retention policy, unread counts.

**Call Tracking Redefinition (G-09):** SIM-call *outcomes* are untrackable. Propose: track **"Call button taps"** as the dashboard metric and label it accordingly; optionally a post-call "Did you connect?" prompt. Dashboard KPI "calls" must be redefined to "call taps".

### 5.3 User Story Traceability

All 16 user stories (US-B01–B07, US-S01–S09) map cleanly to features in §3.1–3.3. Two adjustments required:

| Story | Required Change |
|---|---|
| US-S01 | Reframe as **buyer→seller upgrade** (single-account decision) |
| US-S08 | "direct phone calls" receipt is unmeasurable — reword to "receives call taps / calls to shown number" |

**Missing stories to add:**
- **US-B/S10:** Buyer upgrades to seller via KYC (from resolved decision §3.2).
- **US-OP-01:** Operator reviews KYC submission within SLA and approves/rejects with reason.
- **US-OP-02:** Operator handles reports (dismiss/warn/delist/ban) with audit log.
- **US-B08:** User deletes own account and data.

### 5.4 Flow Gaps

- §5.2 Seller Flow starts at "Sign up" — must be updated to start at "Buyer account → Upgrade to seller".
- §5.3 Trust flow: admin actions exist but no actor/tooling defined (resolved: minimal ops; PRD text should say so).
- No flow for **notifications** or **account deletion**.

---

## 6. Non-Functional Requirements Analysis

### 6.1 Finding (G-17 — Critical): The PRD contains **zero NFRs**. No performance, security, availability, scalability, or compliance targets exist anywhere in the document.

### 6.2 Proposed NFR Baseline (to be ratified in PRD v1.3)

| # | Category | Proposed Requirement (v1) |
|---|---|---|
| NFR-01 | Performance | p95 API response < 500 ms; listing search p95 < 1 s; listing images served via CDN |
| NFR-02 | Scalability | Support 100K registered users / ~10K DAU (Year-1 KPI) with headroom ×3 |
| NFR-03 | Availability | ≥ 99.5% monthly uptime for buyer-facing surfaces; planned maintenance windows off-peak |
| NFR-04 | Security | TLS 1.2+ in transit; **AES-256 at rest for all KYC documents & PII**; OTP rate-limiting & anti-enumeration; RBAC on KYC data access (ops-only); full audit logs for moderation/KYC actions |
| NFR-05 | Privacy/Compliance | Bangladesh ICT Act awareness + data-retention policy for NID/passport images; explicit user consent at upload; data-handling rules on ban/deletion (PRD OQ#5 → promote to requirement) |
| NFR-06 | Localization | Bangla + English UI (PRD §6.6 states bilingual scope; no FR exists) |
| NFR-07 | Cross-platform | Android + iOS + responsive web (per resolved decision §4); feature parity matrix required |
| NFR-08 | Reliability/DR | Daily automated backups; defined RPO ≤ 24h, RTO ≤ 8h |
| NFR-09 | Observability | Crash reporting, structured logging, KPI event instrumentation (§2.2 depends on it) |
| NFR-10 | Network resilience | Graceful degradation on low-bandwidth/2G-3G conditions (Bangladesh context) |
| NFR-11 | Accessibility | Baseline accessibility (contrast, screen-reader labels) — WCAG 2.1 AA aspiration |
| NFR-12 | App Store Compliance | Account deletion in-app; privacy policy; data-safety disclosures (esp. KYC data) |

---

## 7. Gap Register (Consolidated)

| ID | Gap | Severity | Where |
|---|---|---|---|
| G-01 | KPI measurement impossible for offline sales ("completed deals", conversion) | High | PRD §1.5 |
| G-02 | No geo-launch control (city-by-city strategy unsupported) | Medium | PRD §8 |
| G-03 | Moderation workflow & audit trail undefined | Critical | PRD §5.3 |
| G-04 | Duplicate-ID detection for permanent-ban rule | High | PRD §3.1.4 |
| G-05 | Chat sub-features (block/report/media/retention) | High | PRD §3.2.1 |
| G-06 | Category taxonomy source/management | Medium | PRD §3.3.1 |
| G-07 | Photo upload rules (count, size, formats) | Medium | PRD §3.3.2 |
| G-08 | Search sorting/pagination spec | Medium | PRD §3.3.5 |
| G-09 | "Calls" metric untrackable — redefine as call taps | High | PRD §3.3.8 |
| G-10 | Payment gateway FRs for boosts | High | PRD §5.4 |
| G-11 | Notification system entirely absent | Critical | Whole PRD |
| G-12 | Report categories & handling SLA | Medium | PRD §3.3.11 |
| G-13 | Auth & account management FRs (incl. deletion) | Critical | Whole PRD |
| G-14 | KYC review workflow (manual v1) | High | PRD §3.1 |
| G-15 | PII/KYC data protection & retention | Critical | Whole PRD |
| G-16 | Listing lifecycle (expiry/renewal) | High | PRD §3.3 |
| G-17 | No NFR section | Critical | Whole PRD |

**Critical = blocks engineering handoff. High = blocks realistic launch. Medium = needed within v1 hardening.**

---

## 8. Ambiguity & Confusion Register

### 8.1 Resolved This Session (2026-10-08)

| ID | Question | Decision |
|---|---|---|
| A-01 | Can one person be buyer AND seller? | ✅ **Single account; buyer upgrades to seller via KYC** |
| A-02 | v1 platform scope? | ✅ **Android + iOS + responsive web** |
| A-03 | Admin console in v1? | ✅ **Minimal tooling / manual ops; design data model for future console** |

### 8.2 Carried from PRD §9 (Unresolved)

| ID | Open Question (PRD) |
|---|---|
| A-04 | Which KYC vendor / NID API, at what cost? (OQ#1) |
| A-05 | Buyer KYC in later phase? Changes "100% verified" positioning. (OQ#2) |
| A-06 | Free listing limit threshold before freemium fees? (OQ#3) |
| A-07 | Mutual rating prompt in v2? (OQ#4) |
| A-08 | Legal framework for permanent ID bans — retention & privacy (OQ#5) → now partially covered by NFR-05 |

### 8.3 New Open Questions Raised by This Analysis

| ID | Question |
|---|---|
| A-09 | Is KYC upload supported on responsive web in v1, or app-only (camera/liveness simpler on native)? |
| A-10 | How is "Mark as Sold" enforced/incentivized so offline-sale KPIs (G-01) become measurable? |
| A-11 | Which SMS/OTP provider for Bangladesh (delivery reliability)? |
| A-12 | Which payment gateway (bKash merchant API / Nagad / card aggregator) for boosts? |
| A-13 | Chat: is image sharing allowed in v1? (fraud surface area) |
| A-14 | Should guests be able to save favorites (local-only) or is login required? |

---

## 9. PRD Strengths & Weaknesses

### Strengths
1. Sharp, defensible differentiator (mandatory seller KYC + zero-anonymity) vs. Bikroy/FB Marketplace.
2. Consistent priority discipline (P0/P1/P2) and a firm out-of-scope list (§6) — rare in drafts.
3. Acceptance criteria present on every user story.
4. Honest risk register (§8) including the KYC-friction conversion tradeoff.
5. Phone-number visibility rule (§4) is unambiguous — good security-minded writing.

### Weaknesses
1. No NFRs at all (G-17) — the single biggest deficiency.
2. No notification, auth, or account-management FRs (G-11, G-13).
3. Sensitive PII (NID scans, selfies) has no protection/retention spec (G-15) — legal & reputational exposure.
4. KPIs 4–5 are unmeasurable as written (G-01).
5. "Calls" dashboard stat is technically impossible as defined (G-09).
6. Seller flow assumes separate signup; role model was undefined (now resolved — PRD text needs updating).

---

## 10. Recommendations & Next Steps

1. **Update PRD to v1.3** incorporating: single-account/role-upgrade model (§3.2), Android+iOS+web scope (§4), minimal-ops moderation model (§3.4), NFR section (§6.2), and gap-register items G-01–G-17.
2. **Fix KPIs:** redefine fraud-rate and conversion KPIs around an observable "Mark as Sold" confirmation event (A-10).
3. **Redefine call metric:** "Call taps" on dashboard; optional post-call connect prompt (G-09).
4. **Vendor RFPs (parallel track):** KYC/NID verification, SMS-OTP, payment gateway (A-04, A-11, A-12).
5. **PII policy first:** draft KYC-data retention/consent policy before writing KYC code (G-15, A-08) — consult on Bangladesh ICT Act / draft data-protection law.
6. **Add operator personas & audit-logging requirement** even for minimal ops (G-03).
7. After PRD v1.3: proceed to technical specification (architecture, data model, API contracts), then detailed backlog grooming.

---

## Appendix A — Decision Log

| Date | Decision | Rationale (stakeholder) |
|---|---|---|
| 2026-10-08 | Project renamed **Trust Bazar**; PRD title updated | Stakeholder |
| 2026-10-08 | Single account + buyer→seller role upgrade | Smoother UX, industry standard |
| 2026-10-08 | v1 = Android + iOS + responsive web | Full coverage from launch |
| 2026-10-08 | Minimal tooling / manual ops for moderation in v1 | Small launch volume, faster time-to-market |
