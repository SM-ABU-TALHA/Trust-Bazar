import { z } from 'zod';
import { PAYMENT_PROVIDERS } from '../constants/enums.js';
import { objectIdSchema } from './common.js';

export const boostCheckoutSchema = z.object({
  packageId: z.string().trim().min(1).max(40),
  listingId: objectIdSchema,
  provider: z.enum(PAYMENT_PROVIDERS),
  creditApply: z.boolean().default(true),
});
export type BoostCheckoutInput = z.infer<typeof boostCheckoutSchema>;
