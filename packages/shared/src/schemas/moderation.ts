import { z } from 'zod';
import {
  APPEAL_TYPES,
  REPORT_CATEGORIES,
  REPORT_TARGETS,
  SUPPORT_TICKET_STATUSES,
} from '../constants/enums.js';
import { LIMITS } from '../constants/limits.js';
import { objectIdSchema } from './common.js';

export const reportSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: objectIdSchema,
  category: z.enum(REPORT_CATEGORIES),
  comment: z.string().trim().max(LIMITS.report.commentMax, 'too_long').optional(),
});
export type ReportInput = z.infer<typeof reportSchema>;

export const appealSchema = z.object({
  type: z.enum(APPEAL_TYPES),
  referenceId: objectIdSchema,
  message: z
    .string()
    .trim()
    .min(LIMITS.appeal.messageMin, 'too_short')
    .max(LIMITS.appeal.messageMax, 'too_long'),
});
export type AppealInput = z.infer<typeof appealSchema>;

export const supportTicketSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(LIMITS.support.subjectMin, 'too_short')
    .max(LIMITS.support.subjectMax, 'too_long'),
  body: z
    .string()
    .trim()
    .min(LIMITS.support.messageMin, 'too_short')
    .max(LIMITS.support.messageMax, 'too_long'),
  category: z.enum(['account', 'kyc', 'payment', 'listing', 'safety', 'other']),
  attachmentMediaId: objectIdSchema.optional(),
});
export type SupportTicketInput = z.infer<typeof supportTicketSchema>;

export const ticketMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'too_short')
    .max(LIMITS.support.messageMax, 'too_long'),
});
export type TicketMessageInput = z.infer<typeof ticketMessageSchema>;

export const supportTicketStatusSchema = z.enum(SUPPORT_TICKET_STATUSES);
export type SupportTicketStatusInput = z.infer<typeof supportTicketStatusSchema>;
