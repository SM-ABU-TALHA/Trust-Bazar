import { z } from 'zod';
import {
  consentVersionSchema,
  dateOfBirthSchema,
  normalizeBanglaDigits,
  objectIdSchema,
} from './common.js';

/**
 * NID: 13 or 10 digits (PRD Appendix C). Porichoy checksum is verified
 * vendor-side — keep local validation to shape + obvious-forgery signals.
 */
export const nidNumberSchema = z
  .string()
  .trim()
  .transform(normalizeBanglaDigits)
  .refine((value) => /^(\d{10}|\d{13})$/.test(value), { message: 'invalid_nid' })
  .refine((value) => !/^(\d)\1+$/.test(value), { message: 'invalid_nid' });

export const kycSellerSchema = z.object({
  nidFrontMediaId: objectIdSchema,
  nidBackMediaId: objectIdSchema,
  selfieMediaId: objectIdSchema,
  livenessId: z.string().min(1).max(128).optional(),
  consentVersion: consentVersionSchema,
});
export type KycSellerInput = z.infer<typeof kycSellerSchema>;

export const kycBuyerSchema = z.object({
  nidFrontMediaId: objectIdSchema,
  nidBackMediaId: objectIdSchema,
  consentVersion: consentVersionSchema,
});
export type KycBuyerInput = z.infer<typeof kycBuyerSchema>;

export const kycRecoverSchema = z.object({
  selfieMediaId: objectIdSchema,
  livenessId: z.string().min(1).max(128),
});
export type KycRecoverInput = z.infer<typeof kycRecoverSchema>;

/** Vendor payload (Porichoy) — validated at the boundary, never trusted blindly. */
export const kycVendorResultSchema = z.object({
  txnId: z.string().min(1),
  nidNumber: nidNumberSchema,
  name: z.string().min(1).max(120),
  dateOfBirth: dateOfBirthSchema,
  photoMatch: z.boolean(),
  status: z.enum(['approved', 'rejected']),
  reasonCode: z.string().max(64).optional(),
});
export type KycVendorResult = z.infer<typeof kycVendorResultSchema>;
