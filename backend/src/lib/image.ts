import { createHash } from 'node:crypto';
import sharp from 'sharp';

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageAnalysis {
  format: ImageMime;
  width: number;
  height: number;
  longEdge: number;
  reencoded: Buffer;
  pHash: string;
  sha256: string;
}

const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** Sniff the real container from magic bytes — never trust the client header. */
export function detectImageType(buffer: Buffer): ImageMime | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Executables / archives are never valid images even if renamed. */
export function looksExecutable(buffer: Buffer): boolean {
  if (buffer.length < 4) return true;
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) return true; // MZ (PE)
  if (buffer[0] === 0x7f && buffer.toString('ascii', 1, 4) === 'ELF') return true;
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return true; // ZIP / JAR / APK
  }
  return false;
}

/** Dev/CI malware tripwire. Production swaps this for ClamAV in PROMPT 15. */
export function containsMalwareSignature(buffer: Buffer): boolean {
  return buffer.includes(Buffer.from(EICAR, 'ascii'));
}

/** 64-bit difference hash (perceptual) as 16 hex chars. */
async function differenceHash(input: Buffer): Promise<string> {
  const { data } = await sharp(input)
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = '';
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = data[y * 9 + x] ?? 0;
      const right = data[y * 9 + x + 1] ?? 0;
      bits += left < right ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/**
 * Re-encodes the image, which drops every EXIF/GPS/trailer block — the
 * canonical defence against metadata leaks (NFR-13). Throws for anything
 * that is not a decodable JPEG/PNG/WebP.
 */
export async function analyzeImage(
  buffer: Buffer,
  declared: ImageMime,
): Promise<ImageAnalysis> {
  const detected = detectImageType(buffer);
  if (!detected) throw new Error('unrecognised_image');
  if (detected !== declared) throw new Error('content_type_mismatch');

  const pipeline = sharp(buffer, { failOn: 'error' }).rotate();
  const meta = await pipeline.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 1 || height < 1) throw new Error('unreadable_image');

  const reencoded =
    detected === 'image/png'
      ? await sharp(buffer).rotate().png({ compressionLevel: 9 }).toBuffer()
      : detected === 'image/webp'
        ? await sharp(buffer).rotate().webp({ quality: 82 }).toBuffer()
        : await sharp(buffer).rotate().jpeg({ quality: 82, mozjpeg: true }).toBuffer();

  return {
    format: detected,
    width,
    height,
    longEdge: Math.max(width, height),
    reencoded,
    pHash: await differenceHash(reencoded),
    sha256: createHash('sha256').update(reencoded).digest('hex'),
  };
}

export const IMAGE_EXT: Record<ImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
