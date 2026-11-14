import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config/index.js';

export type StoragePurpose = 'kyc' | 'listing' | 'profile';

export class StorageObjectMissing extends Error {
  constructor(key: string) {
    super(`storage object missing: ${key}`);
  }
}

export interface StorageDriver {
  readonly kind: 'local' | 'r2';
  signPut(params: {
    key: string;
    purpose: StoragePurpose;
    contentType: string;
    sizeBytes: number;
    ttlSec: number;
  }): Promise<string>;
  signGet(params: { key: string; purpose: StoragePurpose; ttlSec: number }): Promise<string>;
  read(params: { key: string; purpose: StoragePurpose }): Promise<Buffer>;
  write(params: { key: string; purpose: StoragePurpose; body: Buffer }): Promise<void>;
  move(params: {
    fromKey: string;
    toKey: string;
    purpose: StoragePurpose;
  }): Promise<void>;
}

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`unsafe storage key: ${key}`);
  }
}

export function localSignature(
  secret: string,
  method: 'PUT' | 'GET',
  key: string,
  expires: number,
): string {
  return createHmac('sha256', secret)
    .update(`${method}:${key}:${expires}`)
    .digest('hex')
    .slice(0, 48);
}

export function verifyLocalSignature(
  secret: string,
  method: 'PUT' | 'GET',
  key: string,
  expires: number,
  signature: string,
): boolean {
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = Buffer.from(localSignature(secret, method, key, expires));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Dev/test driver. Presigned URLs point at this API's own blob endpoint so
 * the upload path is exercised end-to-end without cloud credentials.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly kind = 'local' as const;

  constructor(
    private readonly root: string,
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}

  async signPut(params: {
    key: string;
    purpose: StoragePurpose;
    contentType: string;
    sizeBytes: number;
    ttlSec: number;
  }): Promise<string> {
    assertSafeKey(params.key);
    return this.url('PUT', params.key, params.ttlSec);
  }

  async signGet(params: {
    key: string;
    purpose: StoragePurpose;
    ttlSec: number;
  }): Promise<string> {
    assertSafeKey(params.key);
    return this.url('GET', params.key, params.ttlSec);
  }

  async read(params: { key: string; purpose: StoragePurpose }): Promise<Buffer> {
    try {
      return await readFile(this.pathFor(params.key));
    } catch {
      throw new StorageObjectMissing(params.key);
    }
  }

  async write(params: {
    key: string;
    purpose: StoragePurpose;
    body: Buffer;
  }): Promise<void> {
    const target = this.pathFor(params.key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, params.body);
  }

  async move(params: {
    fromKey: string;
    toKey: string;
    purpose: StoragePurpose;
  }): Promise<void> {
    const from = this.pathFor(params.fromKey);
    const to = this.pathFor(params.toKey);
    await mkdir(dirname(to), { recursive: true });
    try {
      await rename(from, to);
    } catch {
      await writeFile(to, await this.read({ key: params.fromKey, purpose: params.purpose }));
      await unlink(from).catch(() => undefined);
    }
  }

  private url(method: 'PUT' | 'GET', key: string, ttlSec: number): string {
    const expires = Date.now() + ttlSec * 1000;
    const signature = localSignature(this.secret, method, key, expires);
    const query = new URLSearchParams({ key, expires: String(expires), sig: signature });
    return `${this.baseUrl}/api/v1/media/blob?${query.toString()}`;
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(resolve(this.root) + sep)) {
      throw new Error(`storage key escapes root: ${key}`);
    }
    return full;
  }
}

/** Cloudflare R2 driver (S3-compatible) — used whenever STORAGE_DRIVER=r2. */
export class R2StorageDriver implements StorageDriver {
  readonly kind = 'r2' as const;
  private readonly client: S3Client;

  constructor(
    private readonly config: {
      accountId: string;
      accessKeyId: string;
      secretAccessKey: string;
      buckets: Record<StoragePurpose, string>;
    },
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  signPut(params: {
    key: string;
    purpose: StoragePurpose;
    contentType: string;
    sizeBytes: number;
    ttlSec: number;
  }): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket(params.purpose),
        Key: params.key,
        ContentType: params.contentType,
        ContentLength: params.sizeBytes,
      }),
      { expiresIn: params.ttlSec },
    );
  }

  signGet(params: { key: string; purpose: StoragePurpose; ttlSec: number }): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket(params.purpose), Key: params.key }),
      { expiresIn: params.ttlSec },
    );
  }

  async read(params: { key: string; purpose: StoragePurpose }): Promise<Buffer> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket(params.purpose), Key: params.key }),
      );
      if (!result.Body) throw new StorageObjectMissing(params.key);
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof StorageObjectMissing) throw error;
      if ((error as { name?: string }).name === 'NoSuchKey') {
        throw new StorageObjectMissing(params.key);
      }
      throw error;
    }
  }

  async write(params: {
    key: string;
    purpose: StoragePurpose;
    body: Buffer;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket(params.purpose),
        Key: params.key,
        Body: params.body,
      }),
    );
  }

  async move(params: {
    fromKey: string;
    toKey: string;
    purpose: StoragePurpose;
  }): Promise<void> {
    const bucket = this.bucket(params.purpose);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: params.toKey,
        CopySource: `${bucket}/${encodeURIComponent(params.fromKey)}`,
      }),
    );
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: params.fromKey }));
  }

  private bucket(purpose: StoragePurpose): string {
    return this.config.buckets[purpose];
  }
}

export function createStorage(config: Config): StorageDriver {
  if (config.STORAGE_DRIVER === 'r2') {
    const required = {
      accountId: config.R2_ACCOUNT_ID,
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
      kyc: config.R2_BUCKET_KYC,
      listing: config.R2_BUCKET_LISTINGS,
      profile: config.R2_BUCKET_PROFILE,
    };
    const missing = Object.entries(required)
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`STORAGE_DRIVER=r2 but missing: ${missing.join(', ')}`);
    }
    return new R2StorageDriver({
      accountId: required.accountId as string,
      accessKeyId: required.accessKeyId as string,
      secretAccessKey: required.secretAccessKey as string,
      buckets: {
        kyc: required.kyc as string,
        listing: required.listing as string,
        profile: required.profile as string,
      },
    });
  }

  const root = config.MEDIA_LOCAL_DIR ?? resolve(process.cwd(), '.storage');
  return new LocalStorageDriver(root, config.APP_BASE_URL, config.JWT_ACCESS_SECRET);
}
