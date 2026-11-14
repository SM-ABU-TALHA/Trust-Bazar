import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';

/** sha256 hex digest — used by the audit hash chain and file integrity checks. */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Deterministic JSON — key-sorted, so the same document always produces the
 * same digest regardless of insertion order (audit `prevHash + canonical(doc)`).
 */
export function canonical(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (key === '__v') continue;
      out[key] = sortValue(source[key]);
    }
    return out;
  }
  return value;
}

/**
 * AES-256-GCM envelope for PII at rest (NFR-13). Format:
 * `v1.<iv>.<authTag>.<ciphertext>` with base64url segments.
 */
export function encryptPii(plain: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptPii(payload: string, keyHex: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !dataPart) {
    throw new Error('malformed PII envelope');
  }
  const key = Buffer.from(keyHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Keyed one-way identity anchor — the NID hash survives SIM swaps. */
export function hmacHex(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}
