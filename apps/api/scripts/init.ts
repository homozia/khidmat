// `npm run db:init`: apply new migrations; load demo data only into an empty database. Safe to re-run.
import { config } from '../src/config.ts';
import { pool } from '../src/db.ts';
import { initDatabase } from '../src/setup.ts';

try {
  const r = await initDatabase(pool);
  console.log(r.applied.length ? `Database updated: ${r.applied.join(', ')}` : 'Database structure is up to date.');
  console.log(r.seeded
    ? `Loaded the synthetic test data. Test sign-in code: ${config.SANDBOX_OTP_CODE}.`
    : 'Existing data kept (bookings, files, refunds and ledger are unchanged). To start again from scratch, run the reset command.');
} catch (e) {
  console.error(`Could not prepare the database: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
