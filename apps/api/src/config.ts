import { z } from 'zod';

const schema = z.object({
  APP_NAME: z.string().default('Khidmat'),
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  SMS_PROVIDER: z.enum(['sandbox', 'aggregator']).default('sandbox'),
  SANDBOX_OTP_CODE: z.string().regex(/^\d{6}$/).default('123456'),
  DEFAULT_COMMISSION_BPS: z.coerce.number().int().min(0).max(5000).default(800),
  OFFER_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  OVERDUE_BALANCE_LIMIT_PAISA: z.coerce.number().int().nonnegative().default(500_000),
  OVERDUE_DAYS: z.coerce.number().int().positive().default(14),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  FILE_SIGNING_SECRET: z.string().min(16).default('dev-only-file-signing-secret-change-me'),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),
  MEDIA_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  NO_PROVIDER_AFTER_MINUTES: z.coerce.number().int().positive().default(30),
  JOBS_INTERVAL_SECONDS: z.coerce.number().int().nonnegative().default(60),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(env);
  if (config.APP_ENV === 'production' && config.SMS_PROVIDER === 'sandbox') {
    throw new Error('SMS_PROVIDER=sandbox is not allowed when APP_ENV=production');
  }
  if (config.APP_ENV === 'production' && config.FILE_SIGNING_SECRET.startsWith('dev-only')) {
    throw new Error('Set FILE_SIGNING_SECRET to a random value in production');
  }
  if (config.APP_ENV === 'production' && config.STORAGE_DRIVER === 'local') {
    throw new Error('Use private object storage (STORAGE_DRIVER=s3) in production');
  }
  return config;
}

export const config = loadConfig();
