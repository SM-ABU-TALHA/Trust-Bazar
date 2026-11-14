import { z } from 'zod';
import { MEDIA_PURPOSES } from '../constants/enums.js';
import { LIMITS } from '../constants/limits.js';

const allowedImageTypes = new Set<string>(LIMITS.media.allowedImageTypes);

export const mediaSignSchema = z
  .object({
    purpose: z.enum(MEDIA_PURPOSES),
    contentType: z.string().refine((value) => allowedImageTypes.has(value), 'unsupported_media_type'),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(LIMITS.media.imageMaxBytes, 'file_too_large'),
    count: z.number().int().min(1).max(LIMITS.media.maxPerRequest).default(1),
  })
  .superRefine((value, ctx) => {
    if (value.purpose === 'kyc' && value.count > 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['count'],
        message: 'kyc_max_two_files_per_request',
      });
    }
  });
export type MediaSignInput = z.infer<typeof mediaSignSchema>;
