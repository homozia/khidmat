import { z } from 'zod';

const schema = z.object({
  APP_NAME: z.string().default('Khidmat'),
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  SMS_PROVIDER: z.enum(['sandbox', 'aggregator']).default('sandbox'),
  SANDBOX_OTP_CODE: z.string().regex(/^\d{6}$/).default('123456'),
  /** Staging only: comma-separated synthetic numbers allowed to use the sandbox code. */
  SANDBOX_OTP_ALLOWLIST: z.string().default(''),
  SMS_API_URL: z.string().default(''),
  SMS_API_KEY: z.string().default(''),
  SMS_SENDER_ID: z.string().default(''),
  SMS_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  DEFAULT_COMMISSION_BPS: z.coerce.number().int().min(0).max(5000).default(800),
  OFFER_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  OVERDUE_BALANCE_LIMIT_PAISA: z.coerce.number().int().nonnegative().default(500_000),
  OVERDUE_DAYS: z.coerce.number().int().positive().default(14),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  QUOTE_SIGNING_SECRET: z.string().min(16).default('dev-only-quote-signing-secret-change-me'),
  FILE_SIGNING_SECRET: z.string().min(16).default('dev-only-file-signing-secret-change-me'),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),
  MEDIA_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  NO_PROVIDER_AFTER_MINUTES: z.coerce.number().int().positive().default(30),
  JOBS_INTERVAL_SECONDS: z.coerce.number().int().nonnegative().default(60),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** Test stack only: lets the field-test app ask the server to drop its reply after saving (see PHONE_TEST_CHECKLIST.md). */
  TEST_FAULTS: z.enum(['0', '1']).default('0').transform((v) => v === '1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(env);
  if (config.APP_ENV === 'production' && config.SMS_PROVIDER === 'sandbox') {
    throw new Error('SMS_PROVIDER=sandbox is not allowed when APP_ENV=production');
  }
  if (config.APP_ENV === 'production' && config.SANDBOX_OTP_ALLOWLIST) {
    throw new Error('SANDBOX_OTP_ALLOWLIST must be empty in production');
  }
  if (config.APP_ENV === 'staging' && config.SMS_PROVIDER === 'sandbox' && !config.SANDBOX_OTP_ALLOWLIST) {
    throw new Error('On staging the sandbox code works only for listed test numbers: set SANDBOX_OTP_ALLOWLIST');
  }
  if (config.SMS_PROVIDER === 'aggregator' && (!config.SMS_API_URL.startsWith('https://') && config.APP_ENV !== 'test')) {
    throw new Error('SMS_API_URL must be an https:// URL');
  }
  if (config.STORAGE_DRIVER === 's3' && (!config.S3_ENDPOINT || !config.S3_BUCKET || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY)) {
    throw new Error('STORAGE_DRIVER=s3 needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
  }
  if (config.APP_ENV === 'production' || config.APP_ENV === 'staging') {
    for (const k of ['FILE_SIGNING_SECRET', 'QUOTE_SIGNING_SECRET'] as const) {
      if (config[k].startsWith('dev-only')) throw new Error(`Set ${k} to a random value when APP_ENV=${config.APP_ENV}`);
    }
  }
  if (config.TEST_FAULTS && (config.APP_ENV === 'staging' || config.APP_ENV === 'production')) {
    throw new Error(`TEST_FAULTS must be off when APP_ENV=${config.APP_ENV}`);
  }
  if (config.APP_ENV === 'production' && config.STORAGE_DRIVER === 'local') {
    throw new Error('Use private object storage (STORAGE_DRIVER=s3) in production');
  }
  return config;
}

export const config = loadConfig();
