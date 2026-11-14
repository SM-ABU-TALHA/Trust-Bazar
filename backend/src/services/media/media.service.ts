import { Types } from 'mongoose';
import { LIMITS } from '@trust/shared/constants';
import type { MediaSignInput } from '@trust/shared/schemas';
import type { Config } from '../../config/index.js';
import { err } from '../../lib/errors.js';
import {
  IMAGE_EXT,
  analyzeImage,
  containsMalwareSignature,
  detectImageType,
  looksExecutable,
  type ImageMime,
} from '../../lib/image.js';
import type { Logger } from '../../lib/logger.js';
import {
  StorageObjectMissing,
  type StorageDriver,
  type StoragePurpose,
} from '../../lib/storage.js';
import type { Repositories } from '../../repositories/index.js';
import { appendAudit } from '../audit/audit.service.js';

const PURPOSE_MAX_BYTES: Record<StoragePurpose, number> = {
  kyc: LIMITS.kyc.documentMaxBytes,
  listing: LIMITS.media.imageMaxBytes,
  profile: LIMITS.profile.photoMaxBytes,
};

const PURPOSE_MIN_LONG_EDGE: Record<StoragePurpose, number> = {
  kyc: LIMITS.kyc.minLongEdgePx,
  listing: 400,
  profile: LIMITS.profile.photoMinEdgePx,
};

interface MediaDoc {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  purpose: StoragePurpose;
  r2Key: string;
  status: 'uploaded' | 'scanning' | 'clean' | 'quarantined';
  contentType?: string;
  sha256?: string;
  pHash?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  scanProvider?: string;
  scanReason?: string;
}

export interface MediaServiceDeps {
  config: Config;
  repos: Repositories;
  storage: StorageDriver;
  logger: Logger;
}

/**
 * Upload signing + the media trust pipeline (NFR-13):
 * magic-byte sniff → executable/malware tripwire → re-encode (strips EXIF)
 * → size/dimension gate → pHash → incoming/ moved to clean/ or quarantine/.
 */
export class MediaService {
  constructor(private readonly deps: MediaServiceDeps) {}

  async sign(userId: string, input: MediaSignInput) {
    const max = PURPOSE_MAX_BYTES[input.purpose];
    if (input.sizeBytes > max) {
      throw err.businessRule(input.purpose === 'profile' ? 'photo_too_large' : 'file_too_large');
    }

    const uploads = [] as Array<{
      mediaId: string;
      key: string;
      uploadUrl: string;
      expiresInSec: number;
    }>;
    const ext = IMAGE_EXT[input.contentType as ImageMime];

    for (let index = 0; index < input.count; index += 1) {
      const id = new Types.ObjectId();
      const key = `incoming/${input.purpose}/${id.toString()}.${ext}`;
      await this.deps.repos.mediaObjects.insert({
        _id: id,
        ownerId: new Types.ObjectId(userId),
        purpose: input.purpose,
        r2Key: key,
        contentType: input.contentType,
        status: 'uploaded',
      } as never);

      const uploadUrl = await this.deps.storage.signPut({
        key,
        purpose: input.purpose,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        ttlSec: LIMITS.media.signedUrlTtlSeconds,
      });
      uploads.push({
        mediaId: id.toString(),
        key,
        uploadUrl,
        expiresInSec: LIMITS.media.signedUrlTtlSeconds,
      });
    }

    await appendAudit(this.deps.repos, {
      actor: 'user',
      actorId: userId,
      action: 'media.sign',
      entityType: 'mediaObjects',
      entityId: uploads[0]?.mediaId ?? null,
      after: { purpose: input.purpose, count: input.count },
    });

    return { uploads };
  }

  /** Client-driven completion (R2 event replaces this in production). */
  async complete(userId: string, mediaId: string) {
    const media = (await this.deps.repos.mediaObjects.findById(mediaId)) as MediaDoc | null;
    if (!media) throw err.notFound('media_not_found');
    if (media.ownerId.toString() !== userId) throw err.notFound('media_not_found');
    if (media.status === 'clean') return this.view(media);
    if (media.status === 'quarantined') throw err.businessRule('media_quarantined');

    const result = await this.process(mediaId);
    // The client-facing completion fails closed; the internal worker endpoint
    // still gets the quarantined record for its own logging.
    if (result.status === 'quarantined') throw err.businessRule('media_quarantined');
    return result;
  }

  /** Internal worker entry point — no ownership check (trusted caller). */
  async process(mediaId: string) {
    const { repos, storage, logger } = this.deps;
    const media = (await repos.mediaObjects.findById(mediaId)) as MediaDoc | null;
    if (!media) throw err.notFound('media_not_found');

    await repos.mediaObjects.raw.updateOne(
      { _id: media._id },
      { $set: { status: 'scanning' } },
    );

    let buffer: Buffer = Buffer.alloc(0);
    try {
      buffer = await storage.read({ key: media.r2Key, purpose: media.purpose });
    } catch (error) {
      if (error instanceof StorageObjectMissing) throw err.businessRule('upload_missing');
      throw error;
    }

    const quarantine = async (reason: string) => {
      const toKey = media.r2Key.replace(/^incoming\//, 'quarantine/');
      await storage.move({ fromKey: media.r2Key, toKey, purpose: media.purpose }).catch((error) => {
        logger.warn({ err: error, mediaId }, 'media quarantine move failed');
      });
      const updated = await repos.mediaObjects.raw.findOneAndUpdate(
        { _id: media._id },
        {
          $set: {
            status: 'quarantined',
            r2Key: toKey,
            scanProvider: 'builtin',
            scanReason: reason,
            sizeBytes: buffer.length,
          },
        },
        { new: true },
      );
      return this.view(updated as unknown as MediaDoc);
    };

    if (buffer.length > PURPOSE_MAX_BYTES[media.purpose]) return quarantine('file_too_large');
    if (looksExecutable(buffer)) return quarantine('executable_content');
    if (containsMalwareSignature(buffer)) return quarantine('malware_detected');

    const declared = media.contentType as ImageMime | undefined;
    const detected = detectImageType(buffer);
    if (!detected) return quarantine('unsupported_media_type');
    if (!declared || detected !== declared) return quarantine('content_type_mismatch');

    let analyzed;
    try {
      analyzed = await analyzeImage(buffer, declared);
    } catch (error) {
      return quarantine((error as Error).message === 'content_type_mismatch'
        ? 'content_type_mismatch'
        : 'unreadable_image');
    }
    if (analyzed.longEdge < PURPOSE_MIN_LONG_EDGE[media.purpose]) return quarantine('image_too_small');

    const cleanKey = media.r2Key.replace(/^incoming\//, 'clean/');
    await storage
      .move({ fromKey: media.r2Key, toKey: cleanKey, purpose: media.purpose })
      .catch(() => undefined);
    // The re-encoded bytes replace whatever the client uploaded, stripping
    // all metadata and any appended payload.
    await storage.write({ key: cleanKey, purpose: media.purpose, body: analyzed.reencoded });

    const updated = await this.deps.repos.mediaObjects.raw.findOneAndUpdate(
      { _id: media._id },
      {
        $set: {
          status: 'clean',
          r2Key: cleanKey,
          sha256: analyzed.sha256,
          pHash: analyzed.pHash,
          width: analyzed.width,
          height: analyzed.height,
          sizeBytes: analyzed.reencoded.length,
          contentType: analyzed.format,
          scanProvider: 'builtin',
          scanReason: null,
        },
      },
      { new: true },
    );
    return this.view(updated as unknown as MediaDoc);
  }

  /** Only clean media ever gets a URL — quarantined bytes stay unreachable. */
  async signedUrl(mediaId: string, ttlSec = 3600): Promise<string | null> {
    const media = (await this.deps.repos.mediaObjects.findById(mediaId)) as MediaDoc | null;
    if (!media || media.status !== 'clean') return null;
    return this.deps.storage.signGet({ key: media.r2Key, purpose: media.purpose, ttlSec });
  }

  private view(media: MediaDoc) {
    return {
      id: media._id.toString(),
      status: media.status,
      width: media.width ?? null,
      height: media.height ?? null,
      pHash: media.pHash ?? null,
      reason: media.scanReason ?? null,
    };
  }
}
