import { buildApp } from './app.ts';
import { config } from './config.ts';
import { pool } from './db.ts';
import { runJobsOnce } from './services/jobs.ts';

const app = await buildApp();
await app.listen({ port: config.PORT, host: '0.0.0.0' });

// Background housekeeping (offer expiry, no-provider, auto-close, media retention).
if (config.JOBS_INTERVAL_SECONDS > 0) {
  const timer = setInterval(() => {
    runJobsOnce().catch((err) => app.log.error({ err: { message: (err as Error).message } }, 'jobs failed'));
  }, config.JOBS_INTERVAL_SECONDS * 1000);
  timer.unref();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
