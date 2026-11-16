import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';

/**
 * SMS adapter for one-time codes.
 *
 * 'sandbox' sends nothing; the fixed SANDBOX_OTP_CODE is accepted instead. It is refused in production,
 * and on staging it works only for numbers in SANDBOX_OTP_ALLOWLIST.
 *
 * 'aggregator' posts JSON to SMS_API_URL with a bearer key:
 *   POST {SMS_API_URL}  { "to": "+923001234567", "from": SMS_SENDER_ID, "text": "..." }
 * Most Pakistani aggregators accept a request of this shape or need a small mapping here; the mapping
 * is the only code that changes when the owner picks a provider (see docs/owner/sms-quote-request.md).
 */

export interface SmsConfig { url: string; key: string; sender: string; timeoutMs: number; appName: string }

export function smsConfigFromEnv(): SmsConfig {
  return { url: config.SMS_API_URL, key: config.SMS_API_KEY, sender: config.SMS_SENDER_ID, timeoutMs: config.SMS_TIMEOUT_MS, appName: config.APP_NAME };
}

export const otpText = (appName: string, code: string) => `${code} is your ${appName} code. It expires in 5 minutes. Never share it.`;

export async function sendViaAggregator(cfg: SmsConfig, phone: string, code: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!cfg.url || !cfg.key) throw new AppError(503, 'SMS_NOT_CONFIGURED', 'SMS sending is not configured.');
  let res: Response;
  try {
    res = await fetchImpl(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ to: phone, from: cfg.sender, text: otpText(cfg.appName, code) }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch {
    throw new AppError(503, 'SMS_UNAVAILABLE', 'We could not send the code right now. Please try again in a minute.');
  }
  if (res.status === 401 || res.status === 403) throw new AppError(503, 'SMS_AUTH_FAILED', 'We could not send the code right now. Please try again later.');
  if (!res.ok) throw new AppError(503, 'SMS_FAILED', 'We could not send the code right now. Please try again in a minute.');
}

export const allowlist = () => new Set(config.SANDBOX_OTP_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean));

/** Decides, per phone, whether the sandbox code applies. Never in production. */
export function usesSandbox(phone: string): boolean {
  if (config.APP_ENV === 'production') return false;
  if (config.APP_ENV === 'staging') return allowlist().has(phone);
  return config.SMS_PROVIDER === 'sandbox' || allowlist().has(phone);
}

export async function sendOtpSms(phone: string, code: string): Promise<void> {
  if (usesSandbox(phone)) return;
  if (config.SMS_PROVIDER === 'sandbox') {
    throw new AppError(403, 'TEST_NUMBERS_ONLY', 'This test server only signs in listed test numbers.');
  }
  await sendViaAggregator(smsConfigFromEnv(), phone, code);
}
