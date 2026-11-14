import { createHmac, randomInt, randomUUID } from 'node:crypto';
import type { Config } from '../../config/index.js';
import { err } from '../../lib/errors.js';
import type { KvStore } from '../../lib/kv.js';
import type { Logger } from '../../lib/logger.js';
import type { SmsSender } from '../../lib/sms.js';

export const OTP_TTL_SEC = 300;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SEC = 60;
const DAILY_LIMIT = 5; // PRD §3.4.1 — 5 OTP per number per day
const FAIL_WINDOW_SEC = 15 * 60;
const FAIL_LIMIT = 5; // API §1.2 — >5 failed verifies / 15 min locks 15 min

interface OtpRecord {
  phone: string;
  codeHash: string;
  attempts: number;
  expiresAt: number;
}

export interface OtpDeps {
  config: Config;
  kv: KvStore;
  sms: SmsSender;
  logger: Logger;
}

export interface OtpChallenge {
  otpId: string;
  expiresInSec: number;
}

/** OTP issue/verify with hashed codes, per-number quotas and lockout. */
export class OtpService {
  constructor(private readonly deps: OtpDeps) {}

  async request(phone: string): Promise<OtpChallenge> {
    const { kv, sms, logger } = this.deps;

    const dayKey = `otp:day:${phone}:${new Date().toISOString().slice(0, 10)}`;
    if (Number((await kv.get(dayKey)) ?? '0') >= DAILY_LIMIT) {
      throw err.rateLimited(secondsUntilUtcMidnight());
    }

    const cooldownRaw = await kv.get(`otp:cooldown:${phone}`);
    if (cooldownRaw) {
      const remainingMs = Number(cooldownRaw) - Date.now();
      if (remainingMs > 0) throw err.rateLimited(Math.ceil(remainingMs / 1000));
    }

    const otpId = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const record: OtpRecord = {
      phone,
      codeHash: this.hashCode(otpId, code),
      attempts: 0,
      expiresAt: Date.now() + OTP_TTL_SEC * 1000,
    };

    // Only one live code per number (a resend invalidates the previous one).
    const previous = await kv.get(`otp:active:${phone}`);
    if (previous) await kv.del(`otp:${previous}`);

    await kv.set(`otp:${otpId}`, JSON.stringify(record), OTP_TTL_SEC);
    await kv.set(`otp:active:${phone}`, otpId, OTP_TTL_SEC);

    try {
      await sms.send({
        to: phone,
        body: `Trust Bazar code: ${code}. Valid for 5 minutes. Never share it.`,
      });
    } catch (error) {
      await kv.del(`otp:${otpId}`);
      await kv.del(`otp:active:${phone}`);
      throw error;
    }

    await kv.set(
      `otp:cooldown:${phone}`,
      String(Date.now() + RESEND_COOLDOWN_SEC * 1000),
      RESEND_COOLDOWN_SEC,
    );
    await kv.incr(dayKey, 86_400);
    logger.info({ otpId }, 'otp issued');

    return { otpId, expiresInSec: OTP_TTL_SEC };
  }

  /** Returns the verified phone; always consumes the code on success. */
  async verify(otpId: string, code: string): Promise<{ phone: string }> {
    const { kv } = this.deps;

    const raw = await kv.get(`otp:${otpId}`);
    if (!raw) throw err.businessRule('otp_expired');

    const record = JSON.parse(raw) as OtpRecord;

    if (Number((await kv.get(`otp:fail:${record.phone}`)) ?? '0') >= FAIL_LIMIT) {
      throw err.rateLimited(FAIL_WINDOW_SEC);
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      await kv.del(`otp:${otpId}`);
      throw err.businessRule('otp_attempts_exhausted');
    }

    if (this.hashCode(otpId, code) !== record.codeHash) {
      record.attempts += 1;
      if (record.attempts >= MAX_ATTEMPTS) {
        await kv.del(`otp:${otpId}`);
      } else {
        const remaining = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
        await kv.set(`otp:${otpId}`, JSON.stringify(record), remaining);
      }
      await kv.incr(`otp:fail:${record.phone}`, FAIL_WINDOW_SEC);
      throw err.businessRule('otp_incorrect');
    }

    await kv.del(`otp:${otpId}`);
    await kv.del(`otp:active:${record.phone}`);
    await kv.del(`otp:fail:${record.phone}`);
    return { phone: record.phone };
  }

  private hashCode(otpId: string, code: string): string {
    return createHmac('sha256', this.deps.config.PEPPER).update(`${otpId}:${code}`).digest('hex');
  }
}

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.ceil((midnight - now.getTime()) / 1000));
}
