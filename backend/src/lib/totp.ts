import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

/** RFC 4648 base32 decode (padding optional) — TOTP secrets are stored base32. */
export function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('invalid_base32_secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(key: Buffer, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', key).update(buffer).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    ((digest[offset] ?? 0) & 0x7f) << 24 |
    ((digest[offset + 1] ?? 0) & 0xff) << 16 |
    ((digest[offset + 2] ?? 0) & 0xff) << 8 |
    ((digest[offset + 3] ?? 0) & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** Current TOTP code (exported so tests and seed tooling can mint codes). */
export function generateTotp(secret: string, at: number = Date.now()): string {
  return hotp(base32Decode(secret), Math.floor(at / 1000 / STEP_SECONDS));
}

/** Verifies a 6-digit code with a ±1 step (30 s) clock-skew window. */
export function verifyTotp(secret: string, code: string, window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);

  const expected = Buffer.from(code);
  for (let step = -window; step <= window; step += 1) {
    const candidate = Buffer.from(hotp(key, counter + step));
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}
