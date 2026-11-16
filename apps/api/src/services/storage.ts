import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
const KEY_RE = /^[a-z]+\/[A-Za-z0-9_-]{20,}$/;
const keyPath = (key: string) => {
  if (!KEY_RE.test(key)) throw new AppError(400, 'BAD_KEY', 'Invalid file key');
  return path.join(root(), key);
};

/** One private file store. 'local' is for development and phone testing; 's3' for staging and production. */
export interface StorageDriver {
  name: string;
  put(key: string, buf: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  url(key: string, contentType: string): Promise<{ url: string; expires_at: string }>;
}

export const localDriver: StorageDriver = {
  name: 'local',
  async put(key, buf) {
    await mkdir(path.dirname(keyPath(key)), { recursive: true });
    await writeFile(keyPath(key), buf, { mode: 0o600 });
  },
  get: (key) => readFile(keyPath(key)),
  remove: (key) => rm(keyPath(key), { force: true }),
  async url(key, type) { return signedUrl(key, type); },
};

/** Private S3-compatible bucket (Cloudflare R2, AWS S3, MinIO). Downloads use presigned links that expire. */
export function s3Driver(cfg: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle?: boolean }): StorageDriver {
  const client = new S3Client({
    endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: cfg.forcePathStyle ?? true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) throw new AppError(404, 'NOT_FOUND', 'File not found');
      if (e.$metadata?.httpStatusCode === 403 || e.name === 'InvalidAccessKeyId' || e.name === 'SignatureDoesNotMatch') {
        throw new AppError(503, 'STORAGE_AUTH_FAILED', 'File storage rejected our credentials.');
      }
      throw new AppError(503, 'STORAGE_UNAVAILABLE', 'File storage is not reachable. Try again shortly.');
    }
  };
  return {
    name: 's3',
    put: (key, buf, contentType) => wrap(async () => { await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: buf, ContentType: contentType })); }),
    get: (key) => wrap(async () => {
      const r = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    }),
    remove: (key) => wrap(async () => { await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key })); }),
    url: (key, contentType) => wrap(async () => {
      const ttl = config.SIGNED_URL_TTL_SECONDS;
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key, ResponseContentType: contentType }), { expiresIn: ttl });
      return { url, expires_at: new Date(Date.now() + ttl * 1000).toISOString() };
    }),
  };
}

let driver: StorageDriver = config.STORAGE_DRIVER === 's3'
  ? s3Driver({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, bucket: config.S3_BUCKET, accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY })
  : localDriver;
export const setStorageDriver = (d: StorageDriver) => { driver = d; };
export const storageDriver = () => driver;

export async function putFile(prefix: 'booking' | 'provider', buf: Buffer, contentType = 'application/octet-stream'): Promise<string> {
  const key = `${prefix}/${randomBytes(24).toString('base64url')}`;
  await driver.put(key, buf, contentType);
  return key;
}
export const readStored = (key: string) => driver.get(key);
export const deleteFile = (key: string) => driver.remove(key);
export const fileUrl = (key: string, contentType: string) => driver.url(key, contentType);

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
