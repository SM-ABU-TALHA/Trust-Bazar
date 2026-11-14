import { z } from 'zod';
import { LANGUAGES, PLATFORMS } from '../constants/enums.js';
import { LIMITS } from '../constants/limits.js';

/** Bangla numerals → ASCII digits (PRD Appendix C: Bangla numerals accepted). */
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

export function normalizeBanglaDigits(input: string): string {
  return input.replace(/[০-৯]/g, (digit) => String(BN_DIGITS.indexOf(digit)));
}

/**
 * Accepts `01712345678`, `8801712345678`, `+880 1712-345678`, Bangla numerals.
 * Always outputs E.164: `+8801XXXXXXXXX`.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => normalizeBanglaDigits(value).replace(/[\s\-()]/g, ''))
  .refine((value) => new RegExp(LIMITS.phone.pattern).test(value), {
    message: 'invalid_bd_mobile',
  })
  .transform((value) => `+880${value.replace(/^\+?880/, '').replace(/^0/, '')}`);

/** Already-normalized storage form. */
export const e164PhoneSchema = z.string().regex(/^\+8801[3-9]\d{8}$/, 'invalid_bd_mobile');

export const otpCodeSchema = z
  .string()
  .trim()
  .transform(normalizeBanglaDigits)
  .refine((value) => /^\d{6}$/.test(value), { message: 'invalid_otp' });

export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'invalid_object_id');

export const idempotencyKeySchema = z.string().uuid('invalid_idempotency_key');

export const platformSchema = z.enum(PLATFORMS);

export const languageSchema = z.enum(LANGUAGES);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITS.pagination.maxLimit)
    .default(LIMITS.pagination.defaultLimit),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const consentVersionSchema = z.enum(['v1']);

/** ISO `YYYY-MM-DD` → Date, enforcing PRD age bounds (≥18). */
export const dateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((date) => !Number.isNaN(date.getTime()), 'invalid_date')
  .refine((date) => {
    const age = ageInYears(date);
    return age >= LIMITS.kyc.minAge && age <= LIMITS.kyc.maxAge;
  }, 'age_requirement');

export function ageInYears(dob: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}
