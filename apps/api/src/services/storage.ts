import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.ts';
import { AppError, unprocessable } from '../lib/errors.ts';

/**
 * Private file storage. Files are never public: clients get a signed URL that expires in
 * SIGNED_URL_TTL_SECONDS, issued only after an access check. 'local' keeps files on disk for
 * development; production must use an S3-compatible private bucket (adapter to be wired once
 * the owner approves the storage account).
 */

export interface FileKind { maxBytes: number; types: string[] }

export const KINDS = {
  photo: { maxBytes: 5 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
  voice: { maxBytes: 2 * 1024 * 1024, types: ['audio/mp4', 'audio/m4a', 'audio/aac', 'audio/mpeg'] },
  document: { maxBytes: 5 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
} satisfies Record<string, FileKind>;

/** Checks the file's first bytes, not just the declared type. */
export function sniff(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'audio/mp4';
  if (buf.subarray(0, 3).toString('latin1') === 'ID3' || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
}

const SAME_FAMILY: Record<string, string[]> = {
  'audio/mp4': ['audio/mp4', 'audio/m4a', 'audio/aac'],
};

export function validateUpload(kind: FileKind, declared: string, buf: Buffer): string {
  if (buf.length === 0) throw unprocessable('EMPTY_FILE', 'The file is empty.');
  if (buf.length > kind.maxBytes) throw unprocessable('FILE_TOO_LARGE', `Files must be under ${Math.round(kind.maxBytes / 1024 / 1024)} MB.`);
  const actual = sniff(buf);
  const ok = actual && kind.types.includes(declared) && (actual === declared || (SAME_FAMILY[actual] ?? []).includes(declared));
  if (!ok) throw unprocessable('FILE_TYPE_NOT_ALLOWED', `Allowed: ${kind.types.join(', ')}.`);
  return actual!;
}

const root = () => path.resolve(config.UPLOAD_DIR);
const keyPath = (key: string) => {
  if (!/^[a-z]+\/[A-Za-z0-9_-]{20,}$/.test(key)) throw new AppError(400, 'BAD_KEY', 'Invalid file key');
  return path.join(root(), key);
};

export async function putFile(prefix: 'booking' | 'provider', buf: Buffer): Promise<string> {
  if (config.STORAGE_DRIVER !== 'local') throw new AppError(503, 'STORAGE_NOT_CONFIGURED', 'Object storage is not configured yet.');
  const key = `${prefix}/${randomBytes(24).toString('base64url')}`;
  await mkdir(path.join(root(), prefix), { recursive: true });
  await writeFile(keyPath(key), buf, { mode: 0o600 });
  return key;
}

export async function readStored(key: string): Promise<Buffer> {
  return readFile(keyPath(key));
}

export async function deleteFile(key: string): Promise<void> {
  await rm(keyPath(key), { force: true });
}

const sign = (key: string, exp: number, type: string) =>
  createHmac('sha256', config.FILE_SIGNING_SECRET).update(`${key}|${exp}|${type}`).digest('base64url');

export function signedUrl(key: string, contentType: string, now = Date.now()): { url: string; expires_at: string } {
  const exp = Math.floor(now / 1000) + config.SIGNED_URL_TTL_SECONDS;
  const q = new URLSearchParams({ k: key, e: String(exp), t: contentType, s: sign(key, exp, contentType) });
  return { url: `/v1/files?${q}`, expires_at: new Date(exp * 1000).toISOString() };
}

export function verifySignedUrl(q: { k?: string; e?: string; t?: string; s?: string }): { key: string; type: string } {
  const { k, e, t, s } = q;
  if (!k || !e || !t || !s) throw new AppError(403, 'BAD_SIGNATURE', 'Link is invalid.');
  const expected = Buffer.from(sign(k, Number(e), t));
  const given = Buffer.from(s);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new AppError(403, 'BAD_SIGNATURE', 'Link is invalid.');
  if (Number(e) * 1000 < Date.now()) throw new AppError(403, 'LINK_EXPIRED', 'Link has expired. Open the file again.');
  return { key: k, type: t };
}
