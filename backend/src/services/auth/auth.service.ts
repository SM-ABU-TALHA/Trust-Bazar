import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { ChangePhoneInput, VerifyOtpInput } from '@trust/shared/schemas';
import type { Config } from '../../config/index.js';
import { sha256 } from '../../lib/crypto.js';
import { err } from '../../lib/errors.js';
import type { KvStore } from '../../lib/kv.js';
import type { SmsSender } from '../../lib/sms.js';
import type { Repositories } from '../../repositories/index.js';
import type { OtpService } from './otp.service.js';
import {
  ACCESS_TTL_SEC,
  REFRESH_TTL_SEC,
  hashRefreshToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type SessionRecord,
  type SessionUser,
} from './tokens.js';

const SESSION_LIMIT = 3;
const STEP_UP_ROLES = new Set(['verifiedBuyer', 'seller']);
const RECOVERY_TTL_SEC = 24 * 60 * 60;

interface UserDoc {
  _id: Types.ObjectId;
  phone: string;
  roles: string[];
  nidHash?: string | null;
  deletedAt?: Date | null;
  enforcement?: { state: string; until?: Date };
  sessions?: SessionRecord[];
}

export interface AuthServiceDeps {
  config: Config;
  repos: Repositories;
  otp: OtpService;
  kv: KvStore;
  sms: SmsSender;
}

export interface LoginResult {
  user: { id: string; roles: string[]; enforcement: { state: string; until?: string } };
  isNew: boolean;
  stepUpRequired: boolean;
  accessToken: string;
  expiresInSec: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface RefreshResult {
  accessToken: string;
  expiresInSec: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface SessionView {
  id: string;
  platform: string;
  lastUsedAt: Date;
  issuedAt: Date;
  current: boolean;
}

/** Login, refresh rotation, session registry, phone change, recovery hand-off. */
export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  async login(input: VerifyOtpInput, context: { ip?: string }): Promise<LoginResult> {
    const { config, repos, otp } = this.deps;
    const { phone } = await otp.verify(input.otpId, input.code);

    const existing = (await repos.users.findByPhone(phone)) as UserDoc | null;
    let user: UserDoc;
    let isNew = false;

    if (existing) {
      user = existing;
    } else {
      const created = await repos.users.raw.create({
        phone,
        roles: ['buyer'],
        profile: { memberSince: new Date() },
      });
      user = created.toObject() as unknown as UserDoc;
      isNew = true;
    }

    this.assertNotBanned(user);

    const deviceIdHash = sha256(input.deviceFp);
    const knownDevice = (user.sessions ?? []).some(
      (session) => session.deviceIdHash === deviceIdHash,
    );
    const stepUpRequired =
      !isNew && user.roles.some((role) => STEP_UP_ROLES.has(role)) && !knownDevice;

    const now = new Date();
    const session: SessionRecord = {
      id: randomUUID(),
      deviceIdHash,
      platform: input.platform,
      refreshTokenHash: '',
      issuedAt: now,
      expiresAt: new Date(now.getTime() + REFRESH_TTL_SEC * 1000),
      lastUsedAt: now,
    };
    const refreshToken = await signRefreshToken(
      config,
      user._id.toString(),
      session.id,
      session.expiresAt,
    );
    session.refreshTokenHash = hashRefreshToken(refreshToken);

    // `$slice: -3` keeps the newest three sessions (4th login evicts the oldest).
    await repos.users.raw.updateOne(
      { _id: user._id },
      { $push: { sessions: { $each: [session], $slice: -SESSION_LIMIT } } },
    );

    if (stepUpRequired) {
      await this.recordSecurityEvent(user._id.toString(), 'newDevice', {
        platform: input.platform,
        ip: context.ip,
      });
    }

    return {
      user: publicUser(user),
      isNew,
      stepUpRequired,
      accessToken: await signAccessToken(config, toSessionUser(user), session),
      expiresInSec: ACCESS_TTL_SEC,
      refreshToken,
      refreshExpiresAt: session.expiresAt,
    };
  }

  async refresh(token: string, context: { ip?: string }): Promise<RefreshResult> {
    const { config, repos } = this.deps;
    const { sub, sid } = await verifyRefreshToken(config, token);

    const user = (await repos.users.findById(sub)) as UserDoc | null;
    if (!user) throw err.tokenRevoked('Session no longer exists');
    this.assertNotBanned(user);

    const session = (user.sessions ?? []).find((entry) => entry.id === sid);
    if (!session) throw err.tokenRevoked('Session revoked');

    if (session.refreshTokenHash !== hashRefreshToken(token)) {
      // Reuse of a rotated token = theft/SIM-swap signal → kill every session.
      await repos.users.raw.updateOne({ _id: user._id }, { $set: { sessions: [] } });
      await this.recordSecurityEvent(sub, 'refreshReuse', { sessionId: sid, ip: context.ip });
      await this.sendSecurityAlert(
        user.phone,
        'Trust Bazar security alert: a session was revoked. If this was not you, contact support.',
      );
      throw err.tokenRevoked('Refresh token reuse detected — all sessions revoked');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + REFRESH_TTL_SEC * 1000);
    const rotated = await signRefreshToken(config, sub, sid, expiresAt);

    await repos.users.raw.updateOne(
      { _id: user._id, 'sessions.id': sid },
      {
        $set: {
          'sessions.$.refreshTokenHash': hashRefreshToken(rotated),
          'sessions.$.lastUsedAt': now,
          'sessions.$.expiresAt': expiresAt,
        },
      },
    );

    const updated: SessionRecord = { ...session, lastUsedAt: now, expiresAt };

    return {
      accessToken: await signAccessToken(config, toSessionUser(user), updated),
      expiresInSec: ACCESS_TTL_SEC,
      refreshToken: rotated,
      refreshExpiresAt: expiresAt,
    };
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.deps.repos.users.raw.updateOne(
      { _id: userId },
      { $pull: { sessions: { id: sessionId } } },
    );
  }

  async listSessions(userId: string, currentSessionId: string): Promise<SessionView[]> {
    const user = (await this.deps.repos.users.findById(userId)) as UserDoc | null;
    if (!user) throw err.tokenRevoked('User no longer exists');

    return (user.sessions ?? []).map((session) => ({
      id: session.id,
      platform: session.platform,
      lastUsedAt: session.lastUsedAt,
      issuedAt: session.issuedAt,
      current: session.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string, currentSessionId: string): Promise<void> {
    if (sessionId === currentSessionId) {
      throw err.conflict('Cannot revoke the current session — use logout');
    }

    const user = (await this.deps.repos.users.findById(userId)) as UserDoc | null;
    if (!user) throw err.tokenRevoked('User no longer exists');
    if (!(user.sessions ?? []).some((session) => session.id === sessionId)) {
      throw err.notFound('Session not found');
    }

    await this.deps.repos.users.raw.updateOne(
      { _id: userId },
      { $pull: { sessions: { id: sessionId } } },
    );
  }

  async changePhone(userId: string, input: ChangePhoneInput): Promise<{ phone: string }> {
    const { repos, otp } = this.deps;

    const user = (await repos.users.findById(userId)) as UserDoc | null;
    if (!user) throw err.tokenRevoked('User no longer exists');

    const current = await otp.verify(input.currentOtpId, input.currentCode);
    if (current.phone !== user.phone) throw err.businessRule('otp_phone_mismatch');

    const next = await otp.verify(input.otpId, input.code);
    if (next.phone !== input.newPhone) throw err.businessRule('otp_phone_mismatch');

    if (await repos.users.findByPhone(input.newPhone)) {
      throw err.conflict('phone_in_use');
    }

    try {
      await repos.users.raw.updateOne({ _id: user._id }, { $set: { phone: input.newPhone } });
    } catch (error) {
      if (isDuplicateKey(error)) throw err.conflict('phone_in_use');
      throw error;
    }

    await this.recordSecurityEvent(userId, 'phoneChange', {
      from: maskPhone(user.phone),
      to: maskPhone(input.newPhone),
    });

    // `nidHash` is deliberately untouched — identity is keyed to NID, not phone.
    return { phone: input.newPhone };
  }

  /**
   * Lost-SIM recovery: registers a pending recovery request. Porichoy NID
   * verification + liveness runs in the KYC module (PROMPT 08).
   */
  async startRecovery(
    input: {
      nidFrontMediaId: string;
      nidBackMediaId: string;
      selfieMediaId: string;
      livenessId: string;
    },
    context: { ip?: string },
  ): Promise<{ recoveryId: string }> {
    const recoveryId = randomUUID();
    await this.deps.kv.set(
      `recovery:${recoveryId}`,
      JSON.stringify({
        ...input,
        status: 'pending-vendor',
        ip: context.ip,
        createdAt: new Date().toISOString(),
      }),
      RECOVERY_TTL_SEC,
    );
    return { recoveryId };
  }

  private assertNotBanned(user: UserDoc): void {
    // Deleted accounts stay in the 14-day grace window; login is blocked and
    // the user restores through the OTP-only cancellation endpoint.
    if (user.deletedAt) {
      throw err.forbidden('account_deleted');
    }
    if (user.enforcement?.state === 'banned') {
      throw err.enforcementBlocked('banned', user.enforcement.until);
    }
  }

  /** Best-effort alert: a failed SMS must never mask the 401. */
  private async sendSecurityAlert(phone: string, body: string): Promise<void> {
    try {
      await this.deps.sms.send({ to: phone, body });
    } catch {
      // first-class delivery is the securityEvents record; SMS is secondary
    }
  }

  private async recordSecurityEvent(
    userId: string,
    type: 'newDevice' | 'stepUp' | 'refreshReuse' | 'bruteForce' | 'recovery' | 'phoneChange',
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.repos.securityEvents.insert({
      userId: new Types.ObjectId(userId),
      type,
      meta,
      at: new Date(),
    });
  }
}

function toSessionUser(user: UserDoc): SessionUser {
  return {
    id: user._id.toString(),
    roles: user.roles,
    enforcement: {
      state: user.enforcement?.state ?? 'none',
      ...(user.enforcement?.until ? { until: user.enforcement.until } : {}),
    },
  };
}

function publicUser(user: UserDoc) {
  return {
    id: user._id.toString(),
    roles: user.roles,
    enforcement: {
      state: user.enforcement?.state ?? 'none',
      ...(user.enforcement?.until ? { until: user.enforcement.until.toISOString() } : {}),
    },
  };
}

/** `+8801712345678` → `+880171****678` (logs/security events keep no full PII). */
function maskPhone(phone: string): string {
  return `${phone.slice(0, 7)}****${phone.slice(-3)}`;
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}
