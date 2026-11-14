import { pino, type Logger } from 'pino';
import type { Config } from '../config/index.js';

/** PII / secrets that must never reach logs (PRD NFR-16). */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'body.password',
  'body.code',
  'body.nidNumber',
  'body.nid',
  'body.selfieMediaId',
  'body.nidFrontMediaId',
  'body.nidBackMediaId',
  'user.phone',
  'phone',
];

export function createLogger(config: Pick<Config, 'NODE_ENV'>): Logger {
  return pino({
    level: config.NODE_ENV === 'test' ? 'silent' : 'info',
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(config.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
      : {}),
  });
}

export type { Logger };
