import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';

/**
 * SMS adapter. 'sandbox' sends nothing (the fixed SANDBOX_OTP_CODE is accepted instead) and is
 * refused in production by config validation. 'aggregator' is a placeholder: it needs a contracted
 * PTA-compliant aggregator, an approved sender ID and owner-approved credentials before it is wired.
 */
export async function sendOtpSms(_phone: string, _code: string): Promise<void> {
  if (config.SMS_PROVIDER === 'sandbox') return;
  throw new AppError(503, 'SMS_NOT_CONFIGURED', 'Live SMS is not configured yet (owner approval required).');
}
