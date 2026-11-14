import { z } from 'zod';
import { objectIdSchema, otpCodeSchema, phoneSchema, platformSchema } from './common.js';

export const requestOtpSchema = z.object({
  phone: phoneSchema,
});
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  otpId: z.string().uuid(),
  code: otpCodeSchema,
  deviceFp: z.string().min(16).max(128),
  platform: platformSchema,
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const changePhoneSchema = z.object({
  newPhone: phoneSchema,
  otpId: z.string().uuid(),
  code: otpCodeSchema,
  currentOtpId: z.string().uuid(),
  currentCode: otpCodeSchema,
});
export type ChangePhoneInput = z.infer<typeof changePhoneSchema>;

export const recoverAccountSchema = z.object({
  nidFrontMediaId: objectIdSchema,
  nidBackMediaId: objectIdSchema,
  selfieMediaId: objectIdSchema,
  livenessId: z.string().min(1).max(128),
});
export type RecoverAccountInput = z.infer<typeof recoverAccountSchema>;
