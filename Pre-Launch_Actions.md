# Pre-Launch External Actions Pack — Trust Bazar

**Version:** 1.0
**Date:** 2026-10-17
**Source:** [PRD.md](PRD.md) v1.7 §11.3 | [Architecture.md](Architecture.md) v1.0
**Purpose:** Ready-to-send materials for the two external action tracks — Legal and Vendor. Nothing here requires further drafting; fill the `[placeholders]`, send, and track in §C.

---

## A. Legal Pack (for external counsel)

### A.1 Counsel Briefing Memo

> **To:** [Law firm / counsel name]
> **Re:** Trust Bazar — pre-launch legal review request (2 items, 1 launch blocker)
>
> We are launching a verified C2C second-hand marketplace in Bangladesh (Dhaka-first). We need sign-off on **(1) our KYC data-retention & privacy framework** and **(2) our prohibited-items policy (launch blocker)**. Key facts for your review:
>
> **Product model (relevant to liability):**
> - Classifieds only; **no escrow, no in-app deal payment** — buyers/sellers settle in person. Platform revenue = paid ad boosts (bKash/Nagad).
> - Sellers: mandatory NID verification via **Porichoy API** (Election Commission e-KYC gateway) before listing.
> - Buyers: phone OTP to browse; basic NID verification required only to initiate in-app chat.
> - Identity is keyed to a **hashed NID**; permanent ID-based bans are our core anti-fraud mechanism.
>
> **KYC data framework (PRD NFR-05/05a/13):**
> - NID scans & selfies stored in **cloud object storage** (Cloudflare R2 primary, Wasabi archive after 90 days), AES-256 at rest, signed-URL access ≤5 min, every ops view audit-logged.
> - Main DB holds **only encrypted metadata**: `nid_hash` (HMAC-SHA256), encrypted nid_number/name/DOB, verification status, vendor txn id.
> - **Retention schedule:** active accounts → while account alive · rejected submissions → 90 days then purged · banned identities → indefinite (ban enforcement) · deleted accounts → 3 years (consent-disclosed at upload and deletion).
> - Account deletion: 14-day scheduled purge; KYC records retained per above; returning users re-verify via liveness-only.
>
> **Questions we need answered (with your written opinion):**
> 1. Is our retention schedule defensible under the **ICT Act 2006 (amended)**, the **draft Data Protection Act**, and general Bangladeshi data-protection practice — especially **indefinite retention for banned identities** and **3-year retention after deletion**?
> 2. Do we need any additional **consent language or registration** (e.g., with BTRC/NTMC or other bodies) to collect and store NID data via Porichoy at commercial scale?
> 3. Our enforcement model issues **permanent NID-hash bans with an appeal process** (72 business-hour review). Any due-process or consumer-protection exposure?
> 4. Platform liability for **offline cash deals** between users — is our planned disclaimer (ToS: "platform provides introductions only, not a party to transactions") sufficient, and should the safe-meetup guidance carry a specific disclaimer?
> 5. **VAT/tax treatment** of boost revenue (digital service via bKash merchant account) — receipt format requirements?
> 6. Review and approve the **prohibited-items policy** in §A.2 (launch blocker) and consent texts in §A.3.
>
> We have attached the full PRD v1.7 (see §3.1, §3.4.4–3.4.6, §3.6, NFR-04/05/13, Appendix B) on request.

### A.2 Prohibited Items Policy — v1 Draft for Sign-off

**Enforcement mapping:** keyword + image classification at publish (PRD §3.3.14) → violations route to moderation → ladder: warn / 7-day suspension / permanent NID ban (§3.6).

| # | Category | Examples (non-exhaustive) |
|---|---|---|
| 1 | Weapons & explosives | Firearms, ammunition, knives sold as weapons, explosives, fireworks |
| 2 | Drugs & controlled substances | Prescription drugs, narcotics, unregistered supplements |
| 3 | Tobacco & alcohol | Cigarettes, e-cigarettes/vapes, alcohol of any kind |
| 4 | Stolen or illegal goods | Goods without proof of ownership on request, items flagged by police |
| 5 | Currency & financial instruments | Counterfeit currency, valid currency sold as collectible above face without disclosure, cloned cards/devices |
| 6 | Adult & explicit material | Pornography, sexual services, explicit content of any kind |
| 7 | Wildlife & animals | Endangered/protected species, ivory, live animals requiring permits |
| 8 | Human remains & body parts | Any |
| 9 | Personal data & documents | NID/passport copies of others, voter lists, SIM cards registered to others, bank documents |
| 10 | Counterfeit & IP-infringing goods | Fake branded items sold as genuine, pirated software/media |
| 11 | Hazardous materials | Industrial chemicals, medical waste, expired consumables |
| 12 | Government & emergency services items | Police/RAB/military uniforms or insignia, official badges |
| 13 | Gambling & betting | Betting accounts, lottery resale, gambling devices |
| 14 | Services & non-physical listings | Job ads, rental listings, services (out of category scope v1) |
| 15 | Medical devices requiring license | Oxygen concentrators without papers, prescription-only devices |
| 16 | Recalled/unsafe products | Items under manufacturer recall, substandard electricals |

*Grey-zone rule: moderators err toward delist + warn; seller can appeal with proof (§3.6).*

### A.3 Consent Text Drafts (bilingual — for counsel polish)

**KYC upload consent (shown before document capture, versioned):**
> EN: "I consent to Trust Bazar collecting my ID document and selfie, verifying them via the Porichoy gateway, and storing them encrypted in secure cloud storage. If my verification is rejected, my documents are deleted within 90 days. If my account is banned for fraud, my identity record may be retained indefinitely to prevent re-registration. If I delete my account, my identity record is kept for up to 3 years as disclosed, then deleted."
> BN: "আমি সম্মতি দিচ্ছি যে, Trust Bazar আমার পরিচয়পত্র ও সেলফি সংগ্রহ করে Porichoy গেটওয়ের মাধ্যমে যাচাই করবে এবং এনক্রিপ্ট করে নিরাপদ ক্লাউড স্টোরেজে সংরক্ষণ করবে। যাচাই বাতিল হলে ৯০ দিনের মধ্যে আমার ডকুমেন্ট মুছে ফেলা হবে। জালিয়াতির কারণে অ্যাকাউন্ট নিষিদ্ধ হলে পুনরায় নিবন্ধন ঠেকাতে আমার পরিচয় রেকর্ড অনির্দিষ্টকাল সংরক্ষণ করা হতে পারে। অ্যাকাউন্ট মুছলে পরিচয় রেকর্ড সর্বোচ্চ ৩ বছর সংরক্ষণের পর মুছে ফেলা হবে।"

**Deletion confirmation (re-disclosure):**
> EN: "Deleting your account removes your profile, listings, and chats after a 14-day grace period. Your verification record (not your documents' public copies) is retained for up to 3 years for fraud prevention, as you consented at verification. Download your payment receipts before proceeding — after deletion they are only available via support."
> BN: "অ্যাকাউন্ট মুছলে ১৪ দিনের গ্রেস পিরিয়ড শেষে আপনার প্রোফাইল, লিস্টিং ও চ্যাট মুছে যাবে। জালিয়াতি প্রতিরোধে আপনার ভেরিফিকেশন রেকর্ড সর্বোচ্চ ৩ বছর সংরক্ষণ করা হবে, যা আপনি ভেরিফিকেশনের সময় সম্মতি দিয়েছেন। এগিয়ে যাওয়ার আগে পেমেন্ট রশিদ ডাউনলোড করুন — মুছে গেলে রশিদ শুধু সাপোর্টের মাধ্যমে পাওয়া যাবে।"

### A.4 Legal Deliverable Checklist
- [ ] Written opinion on retention schedule (Q1–Q2)
- [ ] Written opinion on ban/appeal model (Q3)
- [ ] ToS + offline-deal disclaimer text (Q4)
- [ ] VAT receipt format confirmation (Q5)
- [ ] Signed prohibited-items policy (§A.2)
- [ ] Approved consent texts (§A.3)

---

## B. Vendor Pack

### B.1 Porichoy (e-KYC) — Outreach + POC

**Inquiry email (send to Porichoy/EC vendor contact):**

> Subject: Commercial e-KYC integration inquiry — Trust Bazar (C2C marketplace, Dhaka)
>
> Dear [Team],
> We are building a verified C2C marketplace launching Dhaka-first (Year-1 target: 100K users, ~50K verification requests). We request:
> 1. Commercial onboarding process, required documents, and timeline
> 2. **Per-call pricing** and volume tiers (OTP-style NID check vs full e-KYC with face match)
> 3. **Rate limits / quotas** and burst policy
> 4. SLA: uptime %, response-time p95, support channel
> 5. Sandbox/test environment access
> 6. API response schema (fields returned for NID verify: name, DOB, photo match score?)
> 7. Data-use terms: what response fields we may store (encrypted) and for how long
> 8. Liveness/face-match capability details and accuracy (FAR/FRR)
> 9. Fallback/manual-review support when your service is degraded
> 10. Contract term, minimum commitment, and exit terms
>
> We can share a one-page product brief on request. Target POC date: [date].
> Regards, [Name, phone]

**POC checklist (pass/fail before contract):**
- [ ] Sandbox verify works for old 13-digit + new 10-digit NID formats
- [ ] Name/DOB returned in parseable form (Bangla + English?)
- [ ] Face-match/liveness available via API with score threshold control
- [ ] p95 response < 5s at 10 rps sustained
- [ ] Error codes distinguishable: no-match vs service-down vs throttled
- [ ] Cost at 50K verifications/month within budget — **fill after quote: ৳[ ]**
- [ ] Data-storage terms compatible with NFR-05 retention schedule
- [ ] Graceful degradation confirmed (our `pending-vendor` mode, PRD §3.7)

### B.2 bKash / Nagad — Merchant Onboarding

**Document checklist (typical — confirm with provider):**
- [ ] Trade license (updated)
- [ ] TIN certificate + BIN (VAT) registration
- [ ] Bank account (business) details + cancelled cheque
- [ ] NID of proprietor/authorized signatory
- [ ] Website/app live URL + product description
- [ ] Expected monthly volume & average ticket (boosts: est. ৳100–1,000/txn)
- [ ] Refund/cancellation policy page (our no-refund/credit policy, PRD §3.4.5)

**Integration notes (per Architecture §8):** tokenized checkout (no PAN storage), webhook with raw-body signature verification + source-IP allowlist, idempotent handlers, monotonic payment states, nightly settlement reconciliation. **Ask both providers:** webhook retry policy, settlement file format/API, sandbox availability, merchant discount rate (MDR) for digital services (expect ~1.5–2%).

**Status:** bKash merchant application — [ ] started / [ ] sandbox received · Nagad — [ ] started / [ ] sandbox received

### B.3 SMS Aggregators — Comparison & Inquiry

| Criterion | SSL Wireless (primary candidate) | Alpha SMS | BulkSMSBD |
|---|---|---|---|
| Masking (sender ID) support + cost | fill | fill | fill |
| Price/SMS at 50K/mo (BDT) | fill | fill | fill |
| Delivery rate claim / OTP route quality | fill | fill | fill |
| API: REST + delivery receipts (DLR) | fill | fill | fill |
| Latency to all 4 MNOs (GP/Robi/BL/TT) | fill | fill | fill |
| DND/NDNC filter handling | fill | fill | fill |
| Failover-friendly (multi-account, credits portability) | fill | fill | fill |
| Contract terms / minimum commitment | fill | fill | fill |

**Inquiry template:**
> Subject: OTP SMS route inquiry — 50K msgs/month, transactional
> We need a transactional OTP route (6-digit codes, <30s delivery target) across all MNOs, masking sender ID "TrustBazar", REST API with DLR webhooks. Please quote: per-SMS price at 25K/50K/100K tiers, masking registration process & fee, API docs, delivery-rate stats for GP/Robi/BL/TT, and failover SLA. Volume may scale to 100K+/month within 12 months.

**Requirement reminder (PRD §3.4.1):** two providers under contract before launch; automatic failover; OTP route must support high-priority transactional delivery (not promotional).

---

## C. Action Tracker

| # | Action | Owner | Status | Target date |
|---|---|---|---|---|
| 1 | Engage counsel; send §A.1 memo + §A.2/A.3 | [name] | ☐ | [date] |
| 2 | Prohibited-items policy signed off | Counsel | ☐ **LAUNCH BLOCKER** | [date] |
| 3 | KYC retention opinion received | Counsel | ☐ | [date] |
| 4 | Porichoy inquiry sent → POC scheduled | [name] | ☐ | [date] |
| 5 | Porichoy POC passed (§B.1 checklist) | [name] | ☐ | [date] |
| 6 | bKash + Nagad merchant applications | [name] | ☐ | [date] |
| 7 | SMS dual contracts signed (§B.3) | [name] | ☐ | [date] |
| 8 | ToS + disclaimers published | Counsel + dev | ☐ | [date] |
