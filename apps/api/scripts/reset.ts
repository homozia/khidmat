import { config } from '../src/config.ts';
import { pool } from '../src/db.ts';
import { resetAndSeed } from '../src/setup.ts';
import { DEMO_USERS } from '../src/seed/index.ts';

await resetAndSeed(pool, config.APP_ENV);
const counts = await pool.query(`SELECT
  (SELECT count(*) FROM app.categories) AS categories, (SELECT count(*) FROM app.jobs) AS jobs,
  (SELECT count(*) FROM app.service_zones) AS zones, (SELECT count(*) FROM app.users) AS users`);
console.log('Database reset, migrated and seeded with DEMO data:', counts.rows[0]);
console.log(`Demo sign-in: any phone below, OTP code ${config.SANDBOX_OTP_CODE} (sandbox SMS).`);
for (const [key, u] of Object.entries(DEMO_USERS)) console.log(`  ${u.phone}  ${key.padEnd(20)} ${u.roles.join(', ')}`);
await pool.end();
