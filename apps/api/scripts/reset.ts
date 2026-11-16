// `npm run db:reset`: ERASES the test database and loads fresh synthetic data.
// Asks for the database name as confirmation unless --yes is given. Refuses any database not named *_dev/_test/_sandbox.
import { createInterface } from 'node:readline/promises';
import { config } from '../src/config.ts';
import { pool } from '../src/db.ts';
import { resetAndSeed } from '../src/setup.ts';
import { DEMO_USERS } from '../src/seed/index.ts';

const { rows } = await pool.query<{ db: string }>('SELECT current_database() AS db');
const db = rows[0]!.db;
if (!process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\nThis ERASES every booking, file record, refund and ledger entry in "${db}" and loads fresh test data.`);
  const answer = (await rl.question(`Type the database name (${db}) to continue, or press Enter to cancel: `)).trim();
  rl.close();
  if (answer !== db) {
    console.log('Cancelled. Nothing was changed.');
    await pool.end();
    process.exit(0);
  }
}
try {
  await resetAndSeed(pool, config.APP_ENV);
} catch (e) {
  console.error((e as Error).message);
  await pool.end();
  process.exit(1);
}
const counts = await pool.query(`SELECT
  (SELECT count(*) FROM app.categories) AS categories, (SELECT count(*) FROM app.jobs) AS jobs,
  (SELECT count(*) FROM app.service_zones) AS zones, (SELECT count(*) FROM app.users) AS users`);
console.log('Database reset, migrated and seeded with DEMO data:', counts.rows[0]);
console.log(`Demo sign-in: any phone below, OTP code ${config.SANDBOX_OTP_CODE} (sandbox SMS).`);
for (const [key, u] of Object.entries(DEMO_USERS)) console.log(`  ${u.phone}  ${key.padEnd(20)} ${u.roles.join(', ')}`);
await pool.end();
