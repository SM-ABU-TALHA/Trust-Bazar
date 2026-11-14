import { z } from 'zod';
import {
  APPEAL_OUTCOMES,
  KYC_REASON_CODES,
  MODERATION_ACTIONS,
  PLATFORMS,
} from '../constants/enums.js';
import { LIMITS } from '../constants/limits.js';
import { districtSchema } from './listing.js';

export const kycDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reasonCode: z.enum(KYC_REASON_CODES).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'reject' && value.reasonCode === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasonCode'],
        message: 'required_for_rejection',
      });
    }
  });
export type KycDecisionInput = z.infer<typeof kycDecisionSchema>;

export const moderationActionSchema = z.object({
  action: z.enum(MODERATION_ACTIONS),
  reasonCode: z.string().trim().min(3, 'too_short').max(64, 'too_long'),
  note: z.string().trim().max(500, 'too_long').optional(),
});
export type ModerationActionInput = z.infer<typeof moderationActionSchema>;

export const appealDecisionSchema = z.object({
  outcome: z.enum(APPEAL_OUTCOMES),
  reason: z
    .string()
    .trim()
    .min(LIMITS.appeal.reasonMin, 'too_short')
    .max(LIMITS.appeal.reasonMax, 'too_long'),
});
export type AppealDecisionInput = z.infer<typeof appealDecisionSchema>;

export const configUpdateSchema = z
  .object({
    minVersion: z.record(z.enum(PLATFORMS), z.string().max(20)).optional(),
    featureFlags: z.record(z.string(), z.boolean()).optional(),
    geoLaunch: z.array(districtSchema).optional(),
  })
  .refine(
    (value) =>
      value.minVersion !== undefined ||
      value.featureFlags !== undefined ||
      value.geoLaunch !== undefined,
    { message: 'nothing_to_update' },
  );
export type ConfigUpdateInput = z.infer<typeof configUpdateSchema>;

export const opsLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('invalid_email').max(120),
  totp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'invalid_totp'),
});
export type OpsLoginInput = z.infer<typeof opsLoginSchema>;

export const opsQueueQuerySchema = z.object({
  status: z.string().trim().max(32).optional(),
  claim: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type OpsQueueQuery = z.infer<typeof opsQueueQuerySchema>;

/** Manual reconciliation takes no body; extra keys are ignored by design. */
export const reconcileSchema = z.object({}).passthrough();
export type ReconcileInput = z.infer<typeof reconcileSchema>;
