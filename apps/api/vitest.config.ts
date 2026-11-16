import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every test file resets and reseeds the same test database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      APP_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://khidmat:khidmat_dev@localhost:5432/khidmat_test',
      SMS_PROVIDER: 'sandbox',
      SANDBOX_OTP_CODE: '123456',
      LOG_LEVEL: 'silent',
    },
  },
});
