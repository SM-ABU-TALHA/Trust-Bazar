/**
 * `$jsonSchema` validators — last-line DB defence for core collections
 * (database.md §5). Primary validation stays in zod at the API layer.
 * Applied by migrate.ts with `validationLevel: "strict"`.
 */
export interface ValidatorSpec {
  readonly collection: string;
  readonly jsonSchema: Record<string, unknown>;
}

const objectId = { bsonType: 'objectId' } as const;

export const VALIDATORS: readonly ValidatorSpec[] = [
  {
    collection: 'users',
    jsonSchema: {
      bsonType: 'object',
      required: ['phone', 'roles'],
      properties: {
        phone: { bsonType: 'string', pattern: '^\\+8801[3-9]\\d{8}$' },
        roles: {
          bsonType: 'array',
          items: { enum: ['buyer', 'verifiedBuyer', 'seller'] },
        },
        nidHash: { bsonType: ['string', 'null'] },
        nidEnc: { bsonType: ['string', 'null'] },
        nameEnc: { bsonType: ['string', 'null'] },
        dobEnc: { bsonType: ['string', 'null'] },
        sessions: { bsonType: 'array', maxItems: 3 },
        enforcement: {
          bsonType: 'object',
          properties: {
            state: { enum: ['none', 'warned', 'suspended', 'banned'] },
          },
        },
        deletedAt: { bsonType: ['date', 'null'] },
      },
    },
  },
  {
    collection: 'kycSubmissions',
    jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'scope', 'attempt', 'status', 'consentVersion'],
      properties: {
        userId: objectId,
        scope: { enum: ['seller', 'buyer'] },
        attempt: { bsonType: 'int', minimum: 1, maximum: 3 },
        status: { enum: ['pending', 'pending-vendor', 'approved', 'rejected'] },
        reasonCode: {
          enum: [
            'UNREADABLE',
            'MISMATCH',
            'EXPIRED_DOC',
            'LIVENESS_FAIL',
            'UNDERAGE',
            'BLACKLIST',
            'DUPLICATE_NID',
            null,
          ],
        },
      },
    },
  },
  {
    collection: 'listings',
    jsonSchema: {
      bsonType: 'object',
      required: [
        'sellerId',
        'categoryId',
        'title',
        'description',
        'price',
        'condition',
        'location',
        'mediaIds',
        'status',
        'version',
      ],
      properties: {
        sellerId: objectId,
        categoryId: objectId,
        title: { bsonType: 'string', minLength: 10, maxLength: 100 },
        description: { bsonType: 'string', minLength: 20, maxLength: 5000 },
        price: { bsonType: 'int', minimum: 1, maximum: 99_999_999 },
        condition: { enum: ['new', 'likeNew', 'good', 'refurbished', 'forParts'] },
        status: {
          enum: ['draft', 'active', 'pendingConfirm', 'sold', 'expired', 'delisted', 'archived'],
        },
        mediaIds: { bsonType: 'array', minItems: 1, maxItems: 10 },
        location: {
          bsonType: 'object',
          required: ['district', 'geo'],
          properties: { district: { bsonType: 'string' } },
        },
        version: { bsonType: 'int', minimum: 0 },
      },
    },
  },
  {
    collection: 'threads',
    jsonSchema: {
      bsonType: 'object',
      required: ['listingId', 'buyerId', 'sellerId', 'state'],
      properties: {
        listingId: objectId,
        buyerId: objectId,
        sellerId: objectId,
        state: {
          enum: [
            'active',
            'soldBanner',
            'buyerBlocked',
            'sellerBlocked',
            'deletedListing',
            'archived',
            'frozen',
          ],
        },
        buyerMsgCount: { bsonType: 'int', minimum: 0 },
      },
    },
  },
  {
    collection: 'messages',
    jsonSchema: {
      bsonType: 'object',
      required: ['threadId', 'senderId', 'body', 'clientMsgId'],
      properties: {
        threadId: objectId,
        senderId: objectId,
        body: { bsonType: 'string', minLength: 1, maxLength: 2000 },
        clientMsgId: { bsonType: 'string', minLength: 1 },
      },
    },
  },
  {
    collection: 'offers',
    jsonSchema: {
      bsonType: 'object',
      required: ['threadId', 'buyerId', 'listingId', 'amount', 'status', 'expiresAt'],
      properties: {
        threadId: objectId,
        buyerId: objectId,
        listingId: objectId,
        amount: { bsonType: 'int', minimum: 1 },
        status: { enum: ['pending', 'accepted', 'declined', 'countered', 'expired'] },
        expiresAt: { bsonType: 'date' },
      },
    },
  },
  {
    collection: 'deals',
    jsonSchema: {
      bsonType: 'object',
      required: ['listingId', 'sellerId', 'type', 'channel'],
      properties: {
        listingId: objectId,
        sellerId: objectId,
        buyerId: { bsonType: ['objectId', 'null'] },
        type: { enum: ['confirmed', 'direct', 'unconfirmed'] },
        channel: { enum: ['chat', 'phone', 'inPerson'] },
      },
    },
  },
  {
    collection: 'payments',
    jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'packageId', 'amount', 'provider', 'state', 'idempotencyKey'],
      properties: {
        userId: objectId,
        // Boost package ids are human-readable strings (`boost-3d`), not ObjectIds.
        packageId: { bsonType: 'string', minLength: 1 },
        amount: { bsonType: ['int', 'double', 'long', 'decimal'], minimum: 0 },
        creditApplied: { bsonType: ['int', 'double', 'long', 'decimal'], minimum: 0 },
        provider: { enum: ['bkash', 'nagad'] },
        state: { enum: ['initiated', 'pending', 'success', 'failed', 'expired'] },
        idempotencyKey: { bsonType: 'string', minLength: 1 },
      },
    },
  },
  {
    collection: 'reports',
    jsonSchema: {
      bsonType: 'object',
      required: ['reporterId', 'targetType', 'targetId', 'category', 'details', 'status'],
      properties: {
        reporterId: objectId,
        targetType: { enum: ['listing', 'user', 'message'] },
        targetId: objectId,
        category: { bsonType: 'string', minLength: 1 },
        details: { bsonType: 'string', minLength: 1, maxLength: 1000 },
        status: { enum: ['open', 'reviewing', 'resolved', 'rejected'] },
      },
    },
  },
];
