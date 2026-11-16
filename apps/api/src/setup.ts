import type pg from 'pg';
import { migrate, resetSchema } from './migrate.ts';
import { seed } from './seed/index.ts';

async function seedInTransaction(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seed(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Safe to run any number of times: applies new migrations, and loads the synthetic demo data only when the
 * database has no data yet. Existing bookings, files, refunds and ledger entries are never touched.
 */
export async function initDatabase(pool: pg.Pool): Promise<{ applied: string[]; seeded: boolean }> {
  const applied = await migrate(pool);
  const { rows } = await pool.query<{ n: number }>('SELECT (SELECT count(*) FROM app.users)::int + (SELECT count(*) FROM app.regions)::int AS n');
  if (rows[0]!.n > 0) return { applied, seeded: false };
  await seedInTransaction(pool);
  return { applied, seeded: true };
}

/** Drop, migrate and seed. Erases everything. Development and test databases only. */
export async function resetAndSeed(pool: pg.Pool, appEnv: string): Promise<void> {
  await resetSchema(pool, appEnv);
  await migrate(pool);
  await seedInTransaction(pool);
}
