import { createHmac, timingSafeEqual } from 'node:crypto';
import { Types } from 'mongoose';
import {
  kycVendorResultSchema,
  type KycBuyerInput,
  type KycRecoverInput,
  type KycSellerInput,
  type KycVendorResult,
} from '@trust/shared/schemas';
import type { Config } from '../../config/index.js';
import { encryptPii, hmacHex } from '../../lib/crypto.js';
import { err } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import {
  createPorichoyClient,
  type PorichoyClient,
} from '../../lib/porichoy.js';
import { createStorage, type StorageDriver } from '../../lib/storage.js';
import type { Repositories } from '../../repositories/index.js';
import { KYC_REASON_CODES } from '../../models/kyc.model.js';
import { appendAudit } from '../audit/audit.service.js';

const ATTEMPT_WINDOW_DAYS = 30;
const MAX_ATTEMPTS = 3;
const REJECTED_RETENTION_DAYS = 90;
const APPROVED_RETENTION_DAYS = 365 * 3;

type KycScope = 'seller' | 'buyer';
type ReasonCode = (typeof KYC_REASON_CODES)[number];

interface UserDoc {
  _id: Types.ObjectId;
  phone: string;
  roles?: string[];
  nidHash?: string | null;
  nidEnc?: string | null;
  nameEnc?: string | null;
  dobEnc?: string | null;
  deletedAt?: Date | null;
  enforcement?: { state?: string };
}

interface MediaDoc {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  purpose: string;
  status: string;
  r2Key: string;
}

interface SubmissionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  scope: KycScope;
  attempt: number;
  status: 'pending' | 'pending-vendor' | 'approved' | 'rejected';
  reasonCode?: ReasonCode | null;
  porichoyTxnId?: string | null;
  media: {
    frontId: Types.ObjectId;
    backId: Types.ObjectId;
    selfieId?: Types.ObjectId | null;
    livenessId?: Types.ObjectId | null;
  };
  consentVersion: string;
  expiresAt?: Date | null;
  reviewedAt?: Date | null;
  createdAt?: Date;
}

export interface KycServiceDeps {
  config: Config;
  repos: Repositories;
  logger: Logger;
  storage?: StorageDriver;
  porichoy?: PorichoyClient | null;
}

export class KycService {
  private readonly storage: StorageDriver;
  private readonly porichoy: PorichoyClient | null;

  constructor(private readonly deps: KycServiceDeps) {
    this.storage = deps.storage ?? createStorage(deps.config);
    this.porichoy = deps.porichoy ?? createPorichoyClient(deps.config, deps.logger);
  }

  async submitSeller(userId: string, input: KycSellerInput) {
    return this.submit(userId, 'seller', input);
  }

  async submitBuyer(userId: string, input: KycBuyerInput) {
    return this.submit(userId, 'buyer', input);
  }

  async status(userId: string) {
    const { repos } = this.deps;
    const user = await this.requireActiveUser(userId);
    const latest = ((await repos.kycSubmissions.find({ userId: user._id } as never, {
      sort: { createdAt: -1 },
      limit: 1,
    })) as unknown as SubmissionDoc[])[0] ?? null;

    return {
      verified: Boolean(user.nidHash) && (user.roles ?? []).includes('verifiedBuyer'),
      roles: user.roles ?? [],
      submission: latest
        ? {
            id: latest._id.toString(),
            scope: latest.scope,
            status: latest.status,
            attempt: latest.attempt,
            reasonCode: latest.reasonCode ?? null,
            expiresAt: latest.expiresAt?.toISOString() ?? null,
            createdAt: latest.createdAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  /**
   * Lost-SIM recovery: the NID hash already anchors this identity, so a
   * liveness selfie alone is enough — the NID is never re-collected.
   */
  async recover(userId: string, input: KycRecoverInput) {
    const { repos } = this.deps;
    const user = await this.requireActiveUser(userId);
    if (!user.nidHash || !user.nameEnc) throw err.businessRule('kyc_not_found');

    const selfie = await this.requireCleanMedia(userId, input.selfieMediaId);
    const previous = ((await repos.kycSubmissions.find(
      { userId: user._id, status: 'approved' } as never,
      { sort: { createdAt: -1 }, limit: 1 },
    )) as unknown as SubmissionDoc[])[0] ?? null;
    if (!previous) throw err.businessRule('kyc_not_found');

    const now = new Date();
    const submission = await repos.kycSubmissions.insert({
      userId: user._id,
      scope: previous.scope,
      attempt: 1,
      status: 'approved',
      reasonCode: null,
      porichoyTxnId: null,
      media: {
        frontId: previous.media.frontId,
        backId: previous.media.backId,
        selfieId: selfie._id,
        livenessId: null,
      },
      consentVersion: 'recovery-v1',
      reviewedAt: now,
      expiresAt: new Date(now.getTime() + APPROVED_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    } as never);

    await this.grantRoles(user._id, previous.scope);
    await appendAudit(repos, {
      actor: 'user',
      actorId: userId,
      action: 'kyc.recovered',
      entityType: 'kycSubmissions',
      entityId: String((submission as { _id?: unknown })._id ?? ''),
    });

    return { verified: true, scope: previous.scope };
  }

  /** Webhook body is signed over the raw bytes by Porichoy. */
  async handleVendorCallback(raw: Buffer, signature: string | undefined) {
    const secret = this.deps.config.PORICHOY_WEBHOOK_SECRET;
    if (!secret) throw err.degraded('porichoy_webhook_secret');
    if (!signature) throw err.forbidden('missing_signature');

    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const actual = signature.replace(/^sha256=/, '');
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(actual);
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      throw err.forbidden('invalid_signature');
    }

    let payload: KycVendorResult;
    try {
      payload = kycVendorResultSchema.parse(JSON.parse(raw.toString('utf8')));
    } catch {
      throw err.validation([{ field: 'body', code: 'custom', message: 'invalid_vendor_payload' }]);
    }

    const { repos } = this.deps;
    const submission = (await repos.kycSubmissions.findOne({
      porichoyTxnId: payload.txnId,
    } as never)) as SubmissionDoc | null;
    if (!submission) throw err.notFound('kyc_submission_not_found');

    if (submission.status === 'approved' || submission.status === 'rejected') {
      return { received: true, duplicate: true, status: submission.status };
    }

    if (payload.status === 'rejected' || !payload.photoMatch) {
      const reason = this.mapReason(payload.reasonCode ?? (payload.photoMatch ? null : 'MISMATCH'));
      await this.reject(submission, reason);
      return { received: true, status: 'rejected', reasonCode: reason };
    }

    return this.approve(submission, payload);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async submit(
    userId: string,
    scope: KycScope,
    input: KycSellerInput | KycBuyerInput,
  ) {
    const { repos } = this.deps;
    const user = await this.requireActiveUser(userId);
    if (user.enforcement?.state === 'banned') throw err.enforcementBlocked('banned');
    if (user.deletedAt) throw err.forbidden('account_deleted');

    const front = await this.requireCleanMedia(userId, input.nidFrontMediaId);
    const back = await this.requireCleanMedia(userId, input.nidBackMediaId);
    const sellerInput = scope === 'seller' ? (input as KycSellerInput) : null;
    const selfie = sellerInput ? await this.requireCleanMedia(userId, sellerInput.selfieMediaId) : null;

    const since = new Date(Date.now() - ATTEMPT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const recent = await repos.kycSubmissions.count({
      userId: user._id,
      scope,
      createdAt: { $gte: since },
    } as never);
    if (recent >= MAX_ATTEMPTS) throw err.businessRule('kyc_attempt_limit');

    const txnId = `tb-${new Types.ObjectId().toString()}`;
    const submission = await repos.kycSubmissions.insert({
      userId: user._id,
      scope,
      attempt: recent + 1,
      status: 'pending',
      reasonCode: null,
      porichoyTxnId: txnId,
      media: {
        frontId: front._id,
        backId: back._id,
        selfieId: selfie?._id ?? null,
        livenessId: null,
      },
      consentVersion: input.consentVersion,
    } as never);

    await repos.consents.insert({
      userId: user._id,
      doc: 'kyc',
      version: input.consentVersion,
      grantedAt: new Date(),
    } as never);

    let status: SubmissionDoc['status'] = 'pending-vendor';

    if (this.porichoy) {
      try {
        const [nidFrontUrl, nidBackUrl, selfieUrl] = await Promise.all([
          this.storage.signGet({ key: front.r2Key, purpose: 'kyc', ttlSec: 900 }),
          this.storage.signGet({ key: back.r2Key, purpose: 'kyc', ttlSec: 900 }),
          selfie ? this.storage.signGet({ key: selfie.r2Key, purpose: 'kyc', ttlSec: 900 }) : null,
        ]);
        await this.porichoy.submit({
          txnId,
          nidFrontUrl,
          nidBackUrl,
          ...(selfieUrl ? { selfieUrl } : {}),
          ...(sellerInput?.livenessId ? { livenessId: sellerInput.livenessId } : {}),
        });
        status = 'pending';
      } catch (error) {
        this.deps.logger.warn({ err: error, txnId }, 'porichoy unavailable — pending-vendor');
      }
    }

    await repos.kycSubmissions.raw.updateOne(
      { _id: (submission as { _id?: unknown })._id },
      { $set: { status } },
    );
    await appendAudit(repos, {
      actor: 'user',
      actorId: userId,
      action: 'kyc.submitted',
      entityType: 'kycSubmissions',
      entityId: String((submission as { _id?: unknown })._id ?? ''),
      after: { scope, attempt: recent + 1, status },
    });

    return {
      submissionId: String((submission as { _id?: unknown })._id ?? ''),
      status,
      attempt: recent + 1,
    };
  }

  private async approve(submission: SubmissionDoc, payload: KycVendorResult) {
    const { repos, config } = this.deps;
    const user = (await repos.users.findById(submission.userId.toString())) as UserDoc | null;
    if (!user) throw err.notFound('user_not_found');
    if (user.enforcement?.state === 'banned') {
      await this.reject(submission, 'BLACKLIST');
      return { received: true, status: 'rejected', reasonCode: 'BLACKLIST' };
    }

    const nidHash = hmacHex(payload.nidNumber, config.PEPPER);
    const duplicate = await repos.users.findOne({
      nidHash,
      _id: { $ne: user._id },
    } as never);
    if (duplicate) {
      await this.reject(submission, 'DUPLICATE_NID');
      await appendAudit(repos, {
        actor: 'system',
        action: 'kyc.duplicate_nid',
        entityType: 'kycSubmissions',
        entityId: submission._id.toString(),
        after: { nidHash },
      });
      return { received: true, status: 'rejected', reasonCode: 'DUPLICATE_NID' };
    }

    const now = new Date();
    await repos.users.raw.updateOne(
      { _id: user._id },
      {
        $set: {
          nidHash,
          nidEnc: encryptPii(payload.nidNumber, config.ENCRYPTION_KEY),
          nameEnc: encryptPii(payload.name, config.ENCRYPTION_KEY),
          dobEnc: encryptPii(
            payload.dateOfBirth.toISOString().slice(0, 10),
            config.ENCRYPTION_KEY,
          ),
        },
      },
    );
    await this.grantRoles(user._id, submission.scope);
    await repos.kycSubmissions.raw.updateOne(
      { _id: submission._id },
      {
        $set: {
          status: 'approved',
          reasonCode: null,
          porichoyTxnId: payload.txnId,
          reviewedAt: now,
          expiresAt: new Date(now.getTime() + APPROVED_RETENTION_DAYS * 24 * 60 * 60 * 1000),
        },
      },
    );
    await appendAudit(repos, {
      actor: 'system',
      action: 'kyc.approved',
      entityType: 'kycSubmissions',
      entityId: submission._id.toString(),
      after: { scope: submission.scope, txnId: payload.txnId },
    });

    return { received: true, status: 'approved' };
  }

  private async reject(submission: SubmissionDoc, reasonCode: ReasonCode | null) {
    const now = new Date();
    await this.deps.repos.kycSubmissions.raw.updateOne(
      { _id: submission._id },
      {
        $set: {
          status: 'rejected',
          reasonCode,
          reviewedAt: now,
          expiresAt: new Date(now.getTime() + REJECTED_RETENTION_DAYS * 24 * 60 * 60 * 1000),
        },
      },
    );
    await appendAudit(this.deps.repos, {
      actor: 'system',
      action: 'kyc.rejected',
      entityType: 'kycSubmissions',
      entityId: submission._id.toString(),
      after: { reasonCode },
    });
  }

  private async grantRoles(userId: Types.ObjectId, scope: KycScope) {
    const roles = scope === 'seller' ? ['verifiedBuyer', 'seller'] : ['verifiedBuyer'];
    await this.deps.repos.users.raw.updateOne(
      { _id: userId },
      { $addToSet: { roles: { $each: roles } } },
    );
  }

  private async requireActiveUser(userId: string): Promise<UserDoc> {
    const user = (await this.deps.repos.users.findById(userId)) as UserDoc | null;
    if (!user) throw err.tokenRevoked('User no longer exists');
    return user;
  }

  private async requireCleanMedia(userId: string, mediaId: string): Promise<MediaDoc> {
    const media = (await this.deps.repos.mediaObjects.findById(mediaId)) as MediaDoc | null;
    if (!media || media.ownerId.toString() !== userId || media.purpose !== 'kyc') {
      throw err.validation([{ field: 'mediaId', code: 'custom', message: 'media_not_found' }]);
    }
    if (media.status !== 'clean') {
      throw err.validation([{ field: 'mediaId', code: 'custom', message: 'media_not_clean' }]);
    }
    return media;
  }

  private mapReason(code: string | null | undefined): ReasonCode | null {
    if (!code) return null;
    return (KYC_REASON_CODES as readonly string[]).includes(code)
      ? (code as ReasonCode)
      : 'MISMATCH';
  }
}

/** Convenience for the raw-body webhook mount in `app.ts`. */
export function buildKycService(config: Config, logger: Logger, repos: Repositories): KycService {
  return new KycService({ config, repos, logger });
}
