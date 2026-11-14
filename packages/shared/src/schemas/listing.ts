import { z } from 'zod';
import { CONDITIONS, DEAL_CHANNELS, LISTING_STATUSES, SEARCH_SORTS } from '../constants/enums.js';
import { DISTRICT_NAMES } from '../constants/geography.js';
import { LIMITS } from '../constants/limits.js';
import { objectIdSchema, paginationSchema } from './common.js';

const phoneLike = /(?:\+?880|0)1[3-9]\d{8}/;
const priceLike = /(?:৳|tk\.?|taka)\s*\d|\d+\s*(?:৳|tk\.?|taka)/i;

/** PRD Appendix C: no phone or price inside the title. */
export const listingTitleSchema = z
  .string()
  .trim()
  .min(LIMITS.listing.titleMin, 'too_short')
  .max(LIMITS.listing.titleMax, 'too_long')
  .refine((value) => !phoneLike.test(value.replace(/[\s-]/g, '')), 'phone_in_title')
  .refine((value) => !priceLike.test(value), 'price_in_title');

export const listingDescriptionSchema = z
  .string()
  .trim()
  .min(LIMITS.listing.descriptionMin, 'too_short')
  .max(LIMITS.listing.descriptionMax, 'too_long');

export const listingPriceSchema = z
  .number()
  .int('invalid_price')
  .min(LIMITS.listing.priceMin, 'price_too_low')
  .max(LIMITS.listing.priceMax, 'price_too_high');

export const conditionSchema = z.enum(CONDITIONS);

export const districtSchema = z
  .string()
  .trim()
  .refine((value) => DISTRICT_NAMES.has(value), 'invalid_district');

export const geoPointSchema = z.object({
  type: z.literal('Point').default('Point'),
  coordinates: z.tuple([
    z.number().min(88).max(93), // longitude (Bangladesh bbox)
    z.number().min(20).max(27), // latitude
  ]),
});
export type GeoPointInput = z.infer<typeof geoPointSchema>;

export const mediaIdsSchema = z
  .array(objectIdSchema)
  .min(LIMITS.listing.mediaMin, 'media_required')
  .max(LIMITS.listing.mediaMax, 'too_many_media');

export const createListingSchema = z.object({
  title: listingTitleSchema,
  description: listingDescriptionSchema,
  price: listingPriceSchema,
  condition: conditionSchema,
  categoryId: objectIdSchema,
  district: districtSchema,
  // Required by the `listings` $jsonSchema validator (location.geo) and the
  // 2dsphere index used by "nearest" search.
  geo: geoPointSchema,
  mediaIds: mediaIdsSchema,
});
export type CreateListingInput = z.infer<typeof createListingSchema>;

export const updateListingSchema = z
  .object({
    version: z.number().int().min(0),
    title: listingTitleSchema.optional(),
    description: listingDescriptionSchema.optional(),
    price: listingPriceSchema.optional(),
    condition: conditionSchema.optional(),
    categoryId: objectIdSchema.optional(),
    district: districtSchema.optional(),
    geo: geoPointSchema.optional(),
    mediaIds: mediaIdsSchema.optional(),
  })
  .refine(
    (value) =>
      [
        'title',
        'description',
        'price',
        'condition',
        'categoryId',
        'district',
        'geo',
        'mediaIds',
      ].some((key) => value[key as keyof typeof value] !== undefined),
    { message: 'nothing_to_update' },
  );
export type UpdateListingInput = z.infer<typeof updateListingSchema>;

export const markSoldSchema = z
  .object({
    channel: z.enum(DEAL_CHANNELS),
    buyerId: objectIdSchema.optional(),
    threadId: objectIdSchema.optional(),
    finalPrice: listingPriceSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.channel === 'chat') {
      if (!value.threadId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['threadId'], message: 'required' });
      }
      if (!value.buyerId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['buyerId'], message: 'required' });
      }
    }
    if (value.channel !== 'chat' && value.threadId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['threadId'],
        message: 'only_valid_for_chat_channel',
      });
    }
  });
export type MarkSoldInput = z.infer<typeof markSoldSchema>;

/** `GET /me/listings?status=` — seller's own listings (API §3.10). */
export const myListingsQuerySchema = paginationSchema.merge(
  z.object({ status: z.enum(LISTING_STATUSES).optional() }),
);
export type MyListingsQuery = z.infer<typeof myListingsQuerySchema>;

export const searchQuerySchema = paginationSchema.merge(
  z.object({
    q: z.string().trim().max(100).optional(),
    categoryId: objectIdSchema.optional(),
    district: districtSchema.optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    condition: conditionSchema.optional(),
    sort: z.enum(SEARCH_SORTS).default('relevance'),
  }),
);
export type SearchQuery = z.infer<typeof searchQuerySchema>;
