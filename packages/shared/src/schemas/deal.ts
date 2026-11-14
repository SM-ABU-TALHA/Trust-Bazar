import { z } from 'zod';

/** `confirmed` is an optional echo (API §6.1) — an empty body is accepted. */
export const confirmDealSchema = z
  .object({ confirmed: z.literal(true).optional() })
  .strict();
export type ConfirmDealInput = z.infer<typeof confirmDealSchema>;

export const declineDealSchema = z.object({
  reason: z.string().trim().min(5, 'too_short').max(500, 'too_long'),
});
export type DeclineDealInput = z.infer<typeof declineDealSchema>;
