import { Types } from 'mongoose';
import type { ConfigUpdateInput, KycDecisionInput } from '@trust/shared/schemas';
import type { Config } from '../../config/index.js';
import { err } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { StorageDriver } from '../../lib/storage.js';
import { verifyTotp } from '../../lib/totp.js';
import { isOperatorIpAllowed } from '../../middleware/require-operator.js';
import type { Repositories } from '../../repositories/index.js';
import { appendAudit, listAudit, type AuditQuery } from '../audit/audit.service.js';
import { signOperatorToken } from '../auth/tokens.js';
import type { ModerationService } from '../moderation/moderation.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { PaymentService } from '../payments/payment.service.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const QUEUE_LOCK_MS = 5 * 60_000;

interface OperatorDoc {
  _id: Types.ObjectId;
  email: string;
  role: string;
  totpSecretEnc: string;
  ipAllowlist?: string[];
  active?: boolean;
}

interface KycDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  scope: 'seller' | 'buyer';
  attempt: number;
  status: string;
  reasonCode?: string | null;
  media?: {
    frontId?: Types.ObjectId;
    backId?: Types.ObjectId;
    selfieId?: Types.ObjectId;
    livenessId?: Types.ObjectId;
  };
  claimedBy?: Types.ObjectId | null;
  lockUntil?: Date | null;
  createdAt?: Date;
}

export class OpsService {
  constructor(
    private readonly deps: {
      config: Config;
      logger: Logger;
      repos: Repositories;
      notifications: NotificationService;
      moderation: ModerationService;
      payments: PaymentService;
      storage: StorageDriver;
      invalidateConfig: () => void;
    },
  ) {}

  private get repos(): Repositories {
    return this.deps.repos;
  }

  async login(email: string, totp: string, ip: string | undefined) {
    const operator = (await this.repos.operatorAccounts.findByEmail(
      email,
    )) as unknown as OperatorDoc | null;

    if (
      !operator ||
      operator.active === false ||
      !isOperatorIpAllowed(this.deps.config, operator.ipAllowlist, ip)
    ) {
      throw err.unauthenticated('invalid_operator_credentials');
    }
    if (!verifyTotp(operator.totpSecretEnc, totp)) {
      throw err.unauthenticated('invalid_operator_credentials');
    }

    await this.repos.operatorAccounts.updateOne(
      { _id: operator._id } as never,
      { $set: { lastLoginAt: new Date() } } as never,
    );

    const token = await signOperatorToken(this.deps.config, {
      id: String(operator._id),
      role: operator.role,
    });
    return {
      token,
      role: operator.role,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    };
  }

  // ── KYC queue ──────────────────────────────────────────────────────────────

  async listKycQueue(operatorId: string, status: string | undefined, claim: boolean) {
    const now = new Date();
    const filter: Record<string, unknown> = { status: status ?? 'pending' };
    if (claim) {
      filter.$or = [
        { claimedBy: null },
        { lockUntil: null },
        { lockUntil: { $lt: now } },
        { claimedBy: new Types.ObjectId(operatorId) },
      ];
    }

    const rows = (await this.repos.kycSubmissions.find(filter as never, {
      sort: { createdAt: 1 },
      limit: 50,
    })) as unknown as KycDoc[];

    if (claim) {
      const lockUntil = new Date(Date.now() + QUEUE_LOCK_MS);
      await Promise.all(
        rows.map(async (row) => {
          const updated = (await this.repos.kycSubmissions.findOneAndUpdate(
            { _id: row._id } as never,
            { $set: { claimedBy: new Types.ObjectId(operatorId), lockUntil } } as never,
          )) as unknown as KycDoc | null;
          // Reflect the claim in the response, not just on the next poll.
          if (updated) {
            row.claimedBy = updated.claimedBy ?? new Types.ObjectId(operatorId);
            row.lockUntil = updated.lockUntil ?? lockUntil;
          }
        }),
      );
    }

    return rows.map((row) => ({
      id: String(row._id),
      userId: String(row.userId),
      scope: row.scope,
      attempt: row.attempt,
      status: row.status,
      ageHours: row.createdAt ? Math.floor((Date.now() - row.createdAt.getTime()) / HOUR) : 0,
      claimedBy: row.claimedBy ? String(row.claimedBy) : null,
      lockUntil: row.lockUntil ?? null,
    }));
  }

  async viewKyc(operatorId: string, kycId: string) {
    const row = (await this.repos.kycSubmissions.findById(kycId)) as unknown as KycDoc | null;
    if (!row) throw err.notFound('kyc_not_found');

    const mediaIds: [string, Types.ObjectId][] = [
      ['front', row.media?.frontId],
      ['back', row.media?.backId],
      ['selfie', row.media?.selfieId],
      ['liveness', row.media?.livenessId],
    ].filter((entry): entry is [string, Types.ObjectId] => Boolean(entry[1]));

    const urls: Record<string, string | null> = {
      front: null,
      back: null,
      selfie: null,
      liveness: null,
    };
    for (const [slot, mediaId] of mediaIds) {
      const media = (await this.repos.mediaObjects.findById(String(mediaId))) as unknown as {
        r2Key?: string;
      } | null;
      if (media?.r2Key) {
        urls[slot] = await this.deps.storage.signGet({
          key: media.r2Key,
          purpose: 'kyc',
          ttlSec: 300,
        });
      }
    }

    await appendAudit(this.repos, {
      actor: 'operator',
      actorId: operatorId,
      action: 'kyc.document_view',
      entityType: 'kycSubmission',
      entityId: String(row._id),
      after: { userId: String(row.userId), scope: row.scope },
    });

    return {
      id: String(row._id),
      userId: String(row.userId),
      scope: row.scope,
      attempt: row.attempt,
      status: row.status,
      reasonCode: row.reasonCode ?? null,
      documents: urls,
      createdAt: row.createdAt,
    };
  }

  async decideKyc(operatorId: string, kycId: string, input: KycDecisionInput) {
    const row = (await this.repos.kycSubmissions.findById(kycId)) as unknown as KycDoc | null;
    if (!row) throw err.notFound('kyc_not_found');
    if (row.claimedBy && String(row.claimedBy) !== operatorId && row.lockUntil && row.lockUntil > new Date()) {
      throw err.conflict('kyc_claimed');
    }
    if (!['pending', 'pending-vendor'].includes(row.status)) {
      throw err.conflict('kyc_already_decided');
    }

    const approved = input.decision === 'approve';
    const status = approved ? 'approved' : 'rejected';
    const expiresAt = approved ? null : new Date(Date.now() + 90 * DAY);

    const updated = await this.repos.kycSubmissions.findOneAndUpdate(
      { _id: row._id, status: row.status } as never,
      {
        $set: {
          status,
          reasonCode: approved ? null : (input.reasonCode ?? null),
          reviewerId: new Types.ObjectId(operatorId),
          reviewedAt: new Date(),
          expiresAt,
          claimedBy: null,
          lockUntil: null,
        },
      } as never,
    );
    if (!updated) throw err.conflict('kyc_already_decided');

    if (approved) {
      const roles = row.scope === 'seller' ? ['verifiedBuyer', 'seller'] : ['verifiedBuyer'];
      await this.repos.users.updateOne(
        { _id: row.userId } as never,
        { $addToSet: { roles: { $each: roles } } } as never,
      );
      await this.deps.notifications.emit({
        userId: String(row.userId),
        event: 'kyc.approved',
        payload: { scope: row.scope },
        dedupeKey: `kyc.approved:${String(row._id)}`,
        critical: true,
      });
    } else {
      await this.deps.notifications.emit({
        userId: String(row.userId),
        event: 'kyc.rejected',
        payload: { reasonCode: input.reasonCode },
        dedupeKey: `kyc.rejected:${String(row._id)}`,
        critical: true,
      });
    }

    await appendAudit(this.repos, {
      actor: 'operator',
      actorId: operatorId,
      action: approved ? 'kyc.approve' : 'kyc.reject',
      entityType: 'kycSubmission',
      entityId: String(row._id),
      before: { status: row.status },
      after: { status, reasonCode: input.reasonCode ?? null },
    });

    return { status, kycId: String(row._id) };
  }

  // ── Delegated moderation queues ────────────────────────────────────────────

  listCases(operatorId: string, status: string | undefined, claim: boolean) {
    return this.deps.moderation.listCases(operatorId, status, claim);
  }

  claimCase(operatorId: string, caseId: string) {
    return this.deps.moderation.claimCase(operatorId, caseId);
  }

  actCase(
    operatorId: string,
    operatorRole: string,
    caseId: string,
    input: { action: string; reasonCode: string; note?: string },
  ) {
    return this.deps.moderation.act(operatorId, operatorRole, caseId, input);
  }

  listAppeals(status: string | undefined) {
    return this.deps.moderation.listAppeals(status);
  }

  decideAppeal(
    operatorId: string,
    appealId: string,
    outcome: 'uphold' | 'reverse',
    reason: string,
  ) {
    return this.deps.moderation.decideAppeal(operatorId, appealId, outcome, reason);
  }

  listSupport(status: string | undefined) {
    return this.deps.moderation.listOpsTickets(status);
  }

  replySupport(operatorId: string, ticketId: string, body: string) {
    return this.deps.moderation.opsReply(operatorId, ticketId, { body });
  }

  // ── Audit & config ─────────────────────────────────────────────────────────

  async audit(operatorId: string, query: AuditQuery) {
    const rows = await listAudit(this.repos, query);
    await appendAudit(this.repos, {
      actor: 'operator',
      actorId: operatorId,
      action: 'audit.view',
      entityType: 'auditEvent',
      after: { filter: query, rows: rows.length },
    });
    return rows;
  }

  async getConfig() {
    const docs = await this.repos.config.find({
      _id: { $in: ['minVersion', 'featureFlags', 'geoLaunch'] },
    } as never);
    const values: Record<string, unknown> = {};
    for (const doc of docs as unknown as { _id: string; value: unknown }[]) {
      values[doc._id] = doc.value;
    }
    return values;
  }

  async updateConfig(operatorId: string, input: ConfigUpdateInput) {
    const before = await this.getConfig();
    const entries = Object.entries(input).filter(([, value]) => value !== undefined);

    for (const [key, value] of entries) {
      await this.repos.config.raw.updateOne(
        { _id: key },
        { $set: { value, updatedBy: new Types.ObjectId(operatorId) } },
        { upsert: true },
      );
    }

    // Drop the `/config` bootstrap cache so the change is visible immediately.
    this.deps.invalidateConfig();

    await appendAudit(this.repos, {
      actor: 'operator',
      actorId: operatorId,
      action: 'config.update',
      entityType: 'config',
      before,
      after: input,
    });

    return this.getConfig();
  }

  reconcile() {
    return this.deps.payments.reconcile();
  }
}
