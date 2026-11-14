import { z } from 'zod';
import { DEVICE_PLATFORMS } from '../constants/enums.js';

export const notificationListQuerySchema = z.object({
  read: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const deviceTokenSchema = z.object({
  token: z.string().trim().min(8, 'too_short').max(4096, 'too_long'),
  platform: z.enum(DEVICE_PLATFORMS),
});
export type DeviceTokenInput = z.infer<typeof deviceTokenSchema>;
