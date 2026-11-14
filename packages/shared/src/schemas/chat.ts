import { z } from 'zod';
import { REPORT_CATEGORIES } from '../constants/enums.js';
import { LIMITS } from '../constants/limits.js';
import { objectIdSchema } from './common.js';

export const createThreadSchema = z.object({
  listingId: objectIdSchema,
});
export type CreateThreadInput = z.infer<typeof createThreadSchema>;

export const sendMessageSchema = z.object({
  /** Idempotency at the message level — retry-safe sends. */
  clientMsgId: z.string().min(8).max(64),
  body: z
    .string()
    .trim()
    .min(LIMITS.chat.messageMin, 'empty_message')
    .max(LIMITS.chat.messageMax, 'too_long'),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const blockThreadSchema = z.object({
  /** Optional echo of the caller's side; a mismatch is rejected (API §5.6). */
  side: z.enum(['buyer', 'seller']).optional(),
  reason: z.string().trim().max(200).optional(),
});
export type BlockThreadInput = z.infer<typeof blockThreadSchema>;

export const threadReportSchema = z.object({
  category: z.enum(REPORT_CATEGORIES),
  comment: z.string().trim().max(LIMITS.report.commentMax, 'too_long').optional(),
});
export type ThreadReportInput = z.infer<typeof threadReportSchema>;

/** `before` is an opaque message id cursor (API §5.4). */
export const messageListQuerySchema = z.object({
  before: objectIdSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITS.chat.messagePageSize)
    .default(LIMITS.chat.messagePageSize),
});
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;

/** Upper bound is checked in the service, where the listing price is known. */
export const offerAmountSchema = z.object({
  amount: z.number().int('invalid_amount').min(1, 'amount_too_low'),
});
export type OfferAmountInput = z.infer<typeof offerAmountSchema>;

/** Offer amount depends on the listing price (max price × 2). */
export function createOfferSchema(listingPrice: number) {
  return z.object({
    amount: z
      .number()
      .int('invalid_amount')
      .min(1, 'amount_too_low')
      .max(listingPrice * LIMITS.offer.maxPriceMultiplier, 'amount_too_high'),
  });
}
export type CreateOfferInput = { amount: number };

export const respondOfferSchema = z
  .object({
    /** `reject` is accepted as an alias of `decline` (API §5.9). */
    action: z.enum(['accept', 'decline', 'reject', 'counter']),
    counterAmount: z.number().int().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'counter' && value.counterAmount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['counterAmount'],
        message: 'required_for_counter',
      });
    }
  });
export type RespondOfferInput = z.infer<typeof respondOfferSchema>;
