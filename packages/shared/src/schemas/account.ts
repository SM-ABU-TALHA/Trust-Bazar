import { z } from 'zod';
import { LIMITS } from '../constants/limits.js';
import { languageSchema, objectIdSchema, otpCodeSchema } from './common.js';

export const displayNameSchema = z
  .string()
  .trim()
  .min(LIMITS.profile.displayNameMin, 'too_short')
  .max(LIMITS.profile.displayNameMax, 'too_long')
  .regex(/^[\p{L}\p{M} .'-]+$/u, 'invalid_characters');

export const updateProfileSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    photoMediaId: objectIdSchema.optional(),
  })
  .refine((value) => value.displayName !== undefined || value.photoMediaId !== undefined, {
    message: 'nothing_to_update',
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const sellerPrefsSchema = z.object({
  showPhonePublic: z.boolean(),
});
export type SellerPrefsInput = z.infer<typeof sellerPrefsSchema>;

export const notificationPrefsSchema = z.object({
  push: z.boolean(),
  sms: z.boolean(),
  digest: z.boolean(),
  lang: languageSchema,
});
export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema>;

export const savedSearchSchema = z.object({
  query: z.string().trim().min(1).max(100),
  filters: z
    .object({
      categoryId: objectIdSchema.optional(),
      district: z.string().min(2).max(50).optional(),
      minPrice: z.number().int().min(0).optional(),
      maxPrice: z.number().int().min(0).optional(),
      condition: z.string().optional(),
    })
    .default({}),
  /** database.md v1.6: `instant | daily` (alerts on match vs. one digest). */
  frequency: z.enum(['instant', 'daily']).default('daily'),
});
export type SavedSearchInput = z.infer<typeof savedSearchSchema>;

export const deleteAccountSchema = z.object({
  otpId: z.string().uuid(),
  code: otpCodeSchema,
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
