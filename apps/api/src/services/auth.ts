import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { config } from '../config.ts';
import { pool, one, many, tx } from '../db.ts';
import { AppError } from '../lib/errors.ts';
import { normalizePkMobile } from '../lib/phone.ts';
import { sendOtpSms } from './sms.ts';

export type Role = 'customer' | 'provider' | 'dispatcher' | 'finance' | 'config_admin' | 'verification' | 'super_admin';

export interface AuthUser {
  id: string;
  roles: Set<Role>;
  providerId: string | null;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const OTP_TTL_MS = 5 * 60_000;
const MAX_OTP_PER_WINDOW = 3;
const OTP_WINDOW_MIN = 15;
const MAX_ATTEMPTS = 5;

export function parsePhone(raw: string): string {
  const phone = normalizePkMobile(raw);
  if (!phone) throw new AppError(422, 'INVALID_PHONE', 'Enter a Pakistani mobile number, for example 0300 1234567');
  return phone;
}

export async function requestOtp(rawPhone: string): Promise<{ expiresInSeconds: number }> {
  const phone = parsePhone(rawPhone);
  const recent = await one<{ n: number }>(pool,
    `SELECT count(*)::int AS n FROM otp_challenges WHERE phone_e164 = $1 AND created_at > now() - make_interval(mins => $2)`,
    [phone, OTP_WINDOW_MIN]);
  if ((recent?.n ?? 0) >= MAX_OTP_PER_WINDOW) {
    throw new AppError(429, 'OTP_RATE_LIMITED', `Too many codes requested. Try again in ${OTP_WINDOW_MIN} minutes.`);
  }
  const code = config.SMS_PROVIDER === 'sandbox' ? config.SANDBOX_OTP_CODE : String(randomInt(0, 1_000_000)).padStart(6, '0');
  await pool.query(`INSERT INTO otp_challenges (phone_e164, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`,
    [phone, sha256(`${phone}:${code}`), OTP_TTL_MS / 1000]);
  await sendOtpSms(phone, code);
  return { expiresInSeconds: OTP_TTL_MS / 1000 };
}

export async function verifyOtp(rawPhone: string, code: string): Promise<{ token: string; userId: string; roles: Role[] }> {
  const phone = parsePhone(rawPhone);
  const result = await tx(async (c) => {
    const ch = await one<{ id: string; code_hash: string; attempts: number }>(c,
      `SELECT id, code_hash, attempts FROM otp_challenges
       WHERE phone_e164 = $1 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [phone]);
    if (!ch) throw new AppError(401, 'OTP_INVALID', 'Code expired or not found. Request a new code.');
    if (ch.attempts >= MAX_ATTEMPTS) throw new AppError(429, 'OTP_LOCKED', 'Too many wrong codes. Request a new code.');
    const expected = Buffer.from(ch.code_hash, 'hex');
    const given = Buffer.from(sha256(`${phone}:${code}`), 'hex');
    if (!timingSafeEqual(expected, given)) {
      // Commit the failed attempt, then report the error outside the transaction.
      await c.query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1', [ch.id]);
      return null;
    }
    await c.query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1', [ch.id]);
    const user = await findOrCreateCustomer(c, phone);
    const token = randomBytes(32).toString('base64url');
    await c.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
      [user.id, sha256(token), config.SESSION_TTL_DAYS]);
    return { token, userId: user.id, roles: user.roles };
  });
  if (!result) throw new AppError(401, 'OTP_INVALID', 'Wrong code.');
  return result;
}

async function findOrCreateCustomer(c: PoolClient, phone: string): Promise<{ id: string; roles: Role[] }> {
  let user = await one<{ id: string; status: string }>(c, 'SELECT id, status FROM users WHERE phone_e164 = $1', [phone]);
  if (user?.status === 'suspended') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support.');
  if (!user) {
    user = await one<{ id: string; status: string }>(c, `INSERT INTO users (phone_e164) VALUES ($1) RETURNING id, status`, [phone]);
    await c.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'customer')`, [user!.id]);
  }
  const roles = await many<{ role: Role }>(c, 'SELECT role FROM user_roles WHERE user_id = $1', [user!.id]);
  return { id: user!.id, roles: roles.map((r) => r.role) };
}

export async function authenticate(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const row = await one<{ user_id: string; roles: Role[]; provider_id: string | null }>(pool,
    `SELECT s.user_id, array_agg(r.role) AS roles, p.id AS provider_id
     FROM sessions s JOIN users u ON u.id = s.user_id AND u.status = 'active'
     LEFT JOIN user_roles r ON r.user_id = s.user_id
     LEFT JOIN providers p ON p.user_id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
     GROUP BY s.user_id, p.id`, [sha256(token)]);
  if (!row) return null;
  return { id: row.user_id, roles: new Set(row.roles.filter(Boolean)), providerId: row.provider_id };
}

export async function logout(token: string): Promise<void> {
  await pool.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [sha256(token)]);
}

/** Staff roles that may act across all bookings. */
export const isStaff = (u: AuthUser, ...roles: Role[]) => u.roles.has('super_admin') || roles.some((r) => u.roles.has(r));
