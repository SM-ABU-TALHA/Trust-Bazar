# Database Schema Reference — Trust Bazar

**Version:** 1.4
**Date:** 2026-10-18
**Source:** extracted from [database.md](database.md) v1.5 (§2 Schema, §5 Validation, §9 Mongoose Schema) — aligned with [PRD.md](PRD.md) v1.7.1 Appx C · [Architecture.md](Architecture.md) v1.1 §5 · [dfd.md](dfd.md) v1.1
**Changelog v1.1:** drift-fix audit vs database.md — removed phantom `districtId`/`District` ref (district = embedded string, validated against `categories.districts[]`) · removed `location.area` · `notificationPrefs` corrected to `{push, sms, digest, lang}` + added to Mongoose user model · `categories` row corrected (`parentId?`, `priceBaseline:{p25,p50,p75}`, `districts[]`)
**Changelog v1.2:** users validator note `verification.status` → `enforcement.status` · Redis bullmq job list completed (+ offer-expiry/deal-timeout per Arch §7) · audit model made self-contained (auditSchema definition + crypto-helper note)
**Changelog v1.3 (cross-doc enum alignment with database.md v1.5 / PRD):** users `role` (single) → `roles[]` array `["buyer","verifiedBuyer","seller"]` · `enforcement.status` → `enforcement.state` (`none|warned|suspended|banned` + history) · threads state unified to 7 values (`active|soldBanner|buyerBlocked|sellerBlocked|deletedListing|archived|frozen`) · messages add `flags[]` · listings `aiFlags` → `aiScan`, stats add `chatStarts`, boost add `pausedAt/remainingMs` · payments state `succeeded` → `success`
**Scope:** schema definitions only. Indexes → database.md §4 · Aggregations → §6 · Transactions → §7 · ERD → §10.

---

## 1. Full Schemas (core collections)

### 1.1 `users`
| Field | Type | Notes |
|---|---|---|
| phone | string | E.164 `+8801XXXXXXXXX`, unique |
| roles | string[] | subset of `["buyer", "verifiedBuyer", "seller"]` — single account, upgradeable (PRD §3.1.11) |
| **nidHash** | string | HMAC-SHA256(NID, pepper), unique sparse — **identity anchor** (ban/recycle/recovery) |
| nidEnc / nameEnc / dobEnc | string | AES-256-GCM (`iv:ct:tag`), present iff KYC approved |
| profile | `{ displayName, photoMediaId?, memberSince, sellerStats: { activeListings, confirmedDeals, disputes90d } }` | displayName moderated (2–50 chars, PRD Appx C) |
| sellerPrefs | `{ showPhonePublic: bool }` | default true |
| enforcement | `{ state: "none" \| "warned" \| "suspended" \| "banned", until?: Date, reasonCode?: string, history: subdoc[] }` | PRD §3.6 ladder |
| sessions | `[{ id, deviceIdHash, platform ("web"\|"android"\|"ios"), refreshTokenHash, issuedAt, expiresAt, lastUsedAt }]` | max 3, evict oldest |
| notificationPrefs | `{ push: bool, sms: bool, digest: bool, lang: "bn" \| "en" }` | per-category overrides |
| deletedAt / purgeAt | Date \| null | 14-day grace → purge |

### 1.2 `kycSubmissions`
| Field | Type | Notes |
|---|---|---|
| userId / scope (`seller` \| `buyer`) / attempt | refs | |
| status | `pending` \| `approved` \| `rejected` | 24 business-h SLA |
| reasonCode | enum \| null | `UNREADABLE`, `MISMATCH`, `EXPIRED_DOC`, `LIVENESS_FAIL`, `UNDERAGE`, `BLACKLIST` |
| porichoyTxnId | string \| null | cost ledger |
| media | `{ frontId, backId, selfieId, livenessId? }` | → mediaObjects (R2 keys) |
| reviewerId / reviewedAt | | |
| expiresAt | Date \| null | rejected → +90 days (TTL purge) |
| consentVersion | string | → consents |

### 1.3 `listings`
| Field | Type | Notes |
|---|---|---|
| sellerId / categoryId | refs | |
| title / description | string | 10–100 / 20–5000 chars (PRD Appx C) |
| price | int (BDT) | 1 – 99,999,999 (PRD Appx C) |
| condition | `"new" \| "likeNew" \| "good" \| "refurbished" \| "forParts"` | PRD Appx C enum |
| mediaIds | ObjectId[] → mediaObjects | 1–10 (PRD §3.3.2), first = hero |
| pHashes | string[] | duplicate detection |
| location | `{ district: string, geo: { type:"Point", coordinates:[lng,lat] } }` | district validated against `categories.districts[]`; ≤ ~2 km precision |
| status | `draft \| active \| pendingConfirm \| sold \| expired \| delisted \| archived` | |
| boost | `{ active, packageId?, until, pausedAt?, remainingMs? }` | pause on 7-day suspension (§3.3.9/§3.6) |
| priceFlags | `{ tooLow, tooHigh }` | computed vs baseline |
| stats | `{ views, chatStarts, callTaps, favorites }` | rolling 7d kept for trending |
| expiresAt | Date | 30 days; drafts TTL purge |
| version | int | optimistic concurrency |
| aiScan | `{ status: "queued" \| "clean" \| "flagged", flags: string[] }` | async |

### 1.4 `threads`
| Field | Type | Notes |
|---|---|---|
| listingId / buyerId / sellerId | refs | **unique (listingId, buyerId)** |
| state | `active \| soldBanner \| buyerBlocked \| sellerBlocked \| deletedListing \| archived \| frozen` | frozen = ban/suspension; soldBanner = deal confirmed |
| buyerMsgCount | int | anti-gaming (deal-confirm requires ≥ 1) |
| lastMessageAt / createdAt | Date | createdAt ≤ 90d |

### 1.5 `messages`
| Field | Type | Notes |
|---|---|---|
| threadId / senderId | refs | |
| body | string | ≤ 2000 chars (PRD Appx C) |
| flags | string[] | `offPlatformWarn`, `urlWarn` |
| clientMsgId | uuid | unique (threadId, clientMsgId) — retry-safe |
| readAt | Date \| null | |

### 1.6 `offers`
| Field | Type | Notes |
|---|---|---|
| threadId / buyerId / listingId | refs | listingId denormalized (one-pending-offer index) |
| amount | int | ≤ listing price × 2 |
| status | `pending \| accepted \| rejected \| expired` | 48 h auto-expire |
| expiresAt | Date | |

### 1.7 `deals`
| Field | Type | Notes |
|---|---|---|
| listingId / sellerId / buyerId | refs | buyerId null = Direct Sale |
| type | `confirmed \| direct \| unconfirmed` | KPI denominator = confirmed only |
| channel | `chat \| phone \| inPerson` | |
| markedSoldAt / confirmedAt / expiresAt | Date | confirm window 7d, reminder day 3 |
| disputeRef | ObjectId \| null | → moderationCases |
| undoUntil | Date \| null | 15-min undo window, void after buyer response (PRD §3.3.6/§5.5) |

### 1.8 `payments`
| Field | Type | Notes |
|---|---|---|
| userId / packageId / amount (BDT) | | |
| creditApplied | int | auto-applied credits |
| provider | `bkash \| nagad` | |
| state | `initiated \| pending \| success \| failed \| expired` | pending expires in 15 min |
| idempotencyKey | string | unique |
| gatewayRefs | `{ paymentId?, trxId?, webhookEventIds[] }` | |
| receipt | `{ pdfKey?, vat?, issuedAt }` | 12-month access |

---

## 2. Compact Schemas (remaining collections)

| Collection | Fields (beyond _id / createdAt / updatedAt) |
|---|---|
| `mediaObjects` | ownerId, purpose (`kyc`\|`listing`\|`profile`), r2Key (`incoming/`→`clean/`→`quarantine/`), sha256, pHash, status (`pendingScan`\|`clean`\|`quarantined`), sizeBytes, width/height |
| `categories` | name (bn/en), slug, parentId?, priceBaseline: `{ p25, p50, p75 }`, districts: string[] |
| `favorites` | userId, listingId — **unique compound** |
| `savedSearches` | userId, query, filters, frequency (`instant`\|`daily`), lastNotifiedAt |
| `boostPackages` | name, durationDays, price, placement, active (server-editable catalog) |
| `credits` | userId, amount, remaining, source (`reconciliation`\|`appeal`\|`goodwill`), expiresAt (12 mo) |
| `reports` | reporterId, target (`listing`\|`user`\|`message`), targetId, category, details, status |
| `moderationCases` | source (`report`\|`ai`\|`dispute`\|`appeal`), refId, status (`open`\|`claimed`\|`closed`), claimedBy, lockUntil (5m), slaDue, action, reasonCode |
| `appeals` | userId, caseId, type (`kyc`\|`enforcement`), body, status, resolvedBy, slaDue (72h/24h) |
| `supportTickets` | userId, category, subject, body, attachmentMediaId?, status, slaDue (48h) |
| `notifications` | userId, type, payload, channels (`inApp`\|`push`\|`sms`), status, readAt |
| `consents` | userId, doc (`kyc`\|`privacy`\|`deletion`), version, grantedAt, ip |
| `webhookEvents` | gateway (`bkash`\|`nagad`), eventId, signatureOk, payload (raw), paymentId?, receivedAt, processedAt, processError — unique (`gateway`, `eventId`) |
| `operatorAccounts` | email (unique), role (`kycReviewer`\|`moderator`\|`senior`), totpSecretEnc, ipAllowlist[], active |
| `securityEvents` | userId, type (new-device, step-up, brute-force…), meta, at |
| `idempotencyKeys` | `_id` (= client Idempotency-Key), userId?, endpoint?, payloadHash, status, body, expiresAt — TTL 24 h |
| `config` | key, value (minVersion, consentVersion, featureFlags, geoAllowlist, districtPriorities) |
| `auditEvents` **(separate cluster)** | seq (unique), actor (`user`\|`operator`\|`system`), actorId, action, entityType, entityId, before/after digests, prevHash, **hash**, at — append-only |

### Redis keys (ephemeral)
`otp:{phone}` (hash+attempts, TTL 5m) · `rate:{key}` sliding windows · `presence:{userId}` TTL 60s · `threadLock:{listingId}:{buyerId}` TTL 10s · `bullmq:*` (jobs — Arch §7: media-pipeline, webhook-drain, recon, lifecycle, expiry-reminders, offer-expiry/deal-timeout, breach-notify, purge, sla-scan, saved-search-alerts, audit-verify)

---

## 3. MongoDB `$jsonSchema` Validators (last-line defense)

Primary validation = zod (API layer, PRD Appx C). Enforce at Mongo with `validationLevel: "moderate"`, `validationAction: "error"`.

**`listings` (full example):**
```javascript
db.createCollection("listings", {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["sellerId", "categoryId", "title", "description", "price",
               "condition", "status", "mediaIds", "version"],
    properties: {
      sellerId:    { bsonType: "objectId" },
      title:       { bsonType: "string", minLength: 10, maxLength: 100 },
      description: { bsonType: "string", minLength: 20, maxLength: 5000 },
      price:       { bsonType: "int", minimum: 1, maximum: 99999999 },
      condition:   { enum: ["new", "likeNew", "good", "refurbished", "forParts"] },
      status:      { enum: ["draft", "active", "pendingConfirm", "sold",
                            "expired", "delisted", "archived"] },
      mediaIds:    { bsonType: "array", minItems: 1, maxItems: 10 },
      version:     { bsonType: "int" }
    }
  } }
});
```

**Rules for other collections (compact):**
- `users`: phone matches `^\+8801[3-9]\d{8}$`; roles/`enforcement.state` enums; sessions maxItems 3
- `kycSubmissions`: status enum; reasonCode enum when status=rejected; attempt 1–3
- `threads`: state enum (`active|soldBanner|buyerBlocked|sellerBlocked|deletedListing|archived|frozen`); buyerMsgCount int ≥ 0
- `messages`: body 1–2000; clientMsgId string
- `offers`: amount int ≥ 1; status enum
- `deals`: type enum; channel enum
- `payments`: provider enum; state enum; amount int ≥ 1

---

## 4. Mongoose Models (executable)

```javascript
// models/user.js
const userSchema = new Schema({
  phone:  { type: String, required: true, unique: true,
            match: /^\+8801[3-9]\d{8}$/ },
  roles:  { type: [String], enum: ["buyer", "verifiedBuyer", "seller"],
            default: ["buyer"] },
  nidHash: { type: String, unique: true, sparse: true, index: true },
  nidEnc: String, nameEnc: String, dobEnc: String,       // AES-256-GCM
  profile: {
    displayName: { type: String, minlength: 2, maxlength: 50 },   // PRD Appx C
    photoMediaId: { type: Schema.Types.ObjectId, ref: "MediaObject" },
    memberSince: { type: Date, default: Date.now },
    sellerStats: { activeListings: { type: Number, default: 0 },
                   confirmedDeals: { type: Number, default: 0 },
                   disputes90d:    { type: Number, default: 0 } }
  },
  sellerPrefs: { showPhonePublic: { type: Boolean, default: true } },
  notificationPrefs: {
    push:   { type: Boolean, default: true },
    sms:    { type: Boolean, default: true },
    digest: { type: Boolean, default: false },
    lang:   { type: String, enum: ["bn", "en"], default: "bn" }
  },
  enforcement: {
    state:    { type: String, enum: ["none", "warned", "suspended", "banned"],
                default: "none" },
    until:    Date,
    reasonCode: String,
    history:  [{ action: String, reasonCode: String, by: Schema.Types.ObjectId,
                 at: { type: Date, default: Date.now } }]
  },
  sessions: { type: [{
    _id: false, id: String, deviceIdHash: String,
    platform: { type: String, enum: ["web", "android", "ios"] },
    refreshTokenHash: String, issuedAt: Date, expiresAt: Date, lastUsedAt: Date
  }], validate: v => v.length <= 3 },
  deletedAt: Date, purgeAt: Date
}, { timestamps: true });

// models/listing.js
const listingSchema = new Schema({
  sellerId:   { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
  title:      { type: String, required: true, minlength: 10, maxlength: 100 },
  description:{ type: String, required: true, minlength: 20, maxlength: 5000 },
  price:      { type: Number, required: true, min: 1, max: 99999999 },
  condition:  { type: String, enum: ["new", "likeNew", "good", "refurbished", "forParts"], required: true },
  mediaIds:   { type: [{ type: Schema.Types.ObjectId, ref: "MediaObject" }],
                validate: v => v.length >= 1 && v.length <= 10 },
  pHashes: [String],
  location: {
    district: { type: String, required: true },   // validated against categories.districts[]
    geo: { type: { type: String, enum: ["Point"], default: "Point" },
           coordinates: { type: [Number], required: true } }   // [lng, lat]
  },
  status: { type: String, enum: ["draft", "active", "pendingConfirm", "sold",
                                 "expired", "delisted", "archived"], default: "draft" },
  boost: {
    active: { type: Boolean, default: false }, packageId: Schema.Types.ObjectId,
    until: Date, pausedAt: Date, remainingMs: Number   // suspension pause
  },
  priceFlags: { tooLow: Boolean, tooHigh: Boolean },
  stats: { views: { type: Number, default: 0 },
           chatStarts: { type: Number, default: 0 },
           callTaps: { type: Number, default: 0 },
           favorites: { type: Number, default: 0 } },
  expiresAt: Date,
  version: { type: Number, default: 0 },
  aiScan: { status: { type: String, enum: ["queued", "clean", "flagged"], default: "queued" },
            flags: [String] }
}, { timestamps: true });
// NB: no optimisticConcurrency option — app manages the custom `version` field
// explicitly; enabling it would create a conflicting Mongoose `__v`.
listingSchema.index({ "location.geo": "2dsphere" });
listingSchema.index({ categoryId: 1, status: 1, createdAt: -1 });
// TTL indexes MUST be single-field (MongoDB rejects compound TTL):
listingSchema.index({ expiresAt: 1 },
                    { expireAfterSeconds: 0,
                      partialFilterExpression: { status: "draft" } });

// models/thread.js
const threadSchema = new Schema({
  listingId: { type: Schema.Types.ObjectId, ref: "Listing", required: true },
  buyerId:   { type: Schema.Types.ObjectId, ref: "User", required: true },
  sellerId:  { type: Schema.Types.ObjectId, ref: "User", required: true },
  state:     { type: String, enum: ["active", "soldBanner", "buyerBlocked",
               "sellerBlocked", "deletedListing", "archived", "frozen"],
               default: "active" },
  buyerMsgCount: { type: Number, default: 0 },
  lastMessageAt: Date
}, { timestamps: true });
threadSchema.index({ listingId: 1, buyerId: 1 }, { unique: true });

// models/message.js
const messageSchema = new Schema({
  threadId:    { type: Schema.Types.ObjectId, ref: "Thread", required: true, index: true },
  senderId:    { type: Schema.Types.ObjectId, ref: "User", required: true },
  body:        { type: String, required: true, maxlength: 2000 },
  clientMsgId: { type: String, required: true },
  flags:       [String],   // offPlatformWarn, urlWarn
  readAt: Date
}, { timestamps: { createdAt: true, updatedAt: false } });
messageSchema.index({ threadId: 1, createdAt: 1 });
messageSchema.index({ threadId: 1, clientMsgId: 1 }, { unique: true });   // retry-safe

// models/deal.js
const dealSchema = new Schema({
  listingId: { type: Schema.Types.ObjectId, ref: "Listing", required: true, unique: true },
  sellerId:  { type: Schema.Types.ObjectId, ref: "User", required: true },
  buyerId:   { type: Schema.Types.ObjectId, ref: "User", default: null },
  type:      { type: String, enum: ["confirmed", "direct", "unconfirmed"], required: true },
  channel:   { type: String, enum: ["chat", "phone", "inPerson"], required: true },
  markedSoldAt: Date, confirmedAt: Date, expiresAt: Date,
  disputeRef: { type: Schema.Types.ObjectId, ref: "ModerationCase", default: null },
  undoUntil: Date
}, { timestamps: true });

// models/payment.js
const paymentSchema = new Schema({
  userId:   { type: Schema.Types.ObjectId, ref: "User", required: true },
  packageId:{ type: Schema.Types.ObjectId, ref: "BoostPackage", required: true },
  amount:   { type: Number, required: true, min: 1 },
  creditApplied: { type: Number, default: 0 },
  provider: { type: String, enum: ["bkash", "nagad"], required: true },
  state:    { type: String, enum: ["initiated", "pending", "success",
              "failed", "expired"], default: "initiated" },
  idempotencyKey: { type: String, required: true, unique: true },
  gatewayRefs: { paymentId: String, trxId: String, webhookEventIds: [String] },
  receipt: { pdfKey: String, vat: Number, issuedAt: Date }
}, { timestamps: true });

// models/auditEvent.js (separate audit cluster — append-only)
const auditSchema = new Schema({
  seq:       { type: Number, required: true },              // unique, chain order
  actor:     { type: String, enum: ["user", "operator", "system"], required: true },
  actorId:   Schema.Types.ObjectId,
  action:    { type: String, required: true },
  entityType: String, entityId: Schema.Types.ObjectId,
  before: Schema.Types.Mixed, after: Schema.Types.Mixed,   // digests
  prevHash: { type: String, required: true },
  hash:     { type: String, required: true },
  at:       { type: Date, default: Date.now }
}, { timestamps: false, autoIndex: false });
// sha256 + canonical() = shared crypto helpers (lib/crypto.ts)
auditSchema.pre("save", function (next) {
  if (!this.isNew) return next(new Error("auditEvents is append-only"));
  this.hash = sha256(this.prevHash + canonical(this.toObject({ versionKey: false })));
  next();
});
```

---

*For indexes (database.md §4), aggregation pipelines (§6), transaction flows (§7), sample data (§8), and the ERD (§10), see [database.md](database.md).*
