import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config/index.js';
import { err } from './errors.js';
import type { Logger } from './logger.js';

export interface SmsMessage {
  readonly to: string;
  readonly body: string;
}

export interface SmsSender {
  /** Sends or throws `503 degraded` — callers must not retry in a loop. */
  send(message: SmsMessage): Promise<{ provider: string }>;
}

interface Provider {
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly senderId: string;
}

const TIMEOUT_MS = 5_000;
const DEV_OUTBOX = '.dev-sms-outbox.jsonl';

/** PRD §3.4.1: primary aggregator first, secondary on any failure. */
function configuredProviders(config: Config): Provider[] {
  const list: Provider[] = [];
  if (config.SMS_PRIMARY_BASE_URL && config.SMS_PRIMARY_API_KEY) {
    list.push({
      name: 'primary',
      baseUrl: config.SMS_PRIMARY_BASE_URL,
      apiKey: config.SMS_PRIMARY_API_KEY,
      senderId: config.SMS_PRIMARY_SENDER_ID ?? 'TrustBazar',
    });
  }
  if (config.SMS_SECONDARY_BASE_URL && config.SMS_SECONDARY_API_KEY) {
    list.push({
      name: 'secondary',
      baseUrl: config.SMS_SECONDARY_BASE_URL,
      apiKey: config.SMS_SECONDARY_API_KEY,
      senderId: config.SMS_SECONDARY_SENDER_ID ?? 'TrustBazar',
    });
  }
  return list;
}

async function post(provider: Provider, message: SmsMessage): Promise<void> {
  const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/send-sms`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      to: message.to,
      message: message.body,
      senderId: provider.senderId,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${provider.name} sms gateway responded ${response.status}`);
  }
}

/**
 * Local-development sink: with no aggregator credentials the OTP is appended
 * to a gitignored outbox file so a developer can complete login. Never used
 * in production and never written to application logs.
 */
async function writeDevOutbox(message: SmsMessage, logger: Logger): Promise<void> {
  const file = path.resolve(process.cwd(), DEV_OUTBOX);
  await appendFile(
    file,
    `${JSON.stringify({ at: new Date().toISOString(), to: message.to, body: message.body })}\n`,
    'utf8',
  );
  logger.warn({ file }, 'sms not configured — OTP written to dev outbox');
}

export function createSmsSender(config: Config, logger: Logger): SmsSender {
  const providers = configuredProviders(config);

  return {
    async send(message) {
      for (const provider of providers) {
        try {
          await post(provider, message);
          return { provider: provider.name };
        } catch (error) {
          logger.error(
            { provider: provider.name, err: error instanceof Error ? error.message : String(error) },
            'sms provider failed',
          );
        }
      }

      if (providers.length === 0) {
        if (config.NODE_ENV === 'production') throw err.degraded('sms');
        await writeDevOutbox(message, logger);
        return { provider: 'dev-outbox' };
      }

      throw err.degraded('sms');
    },
  };
}
