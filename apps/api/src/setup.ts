import type pg from 'pg';
import { migrate, resetSchema } from './migrate.ts';
import { seed } from './seed/index.ts';

/** Drop, migrate and seed. Development and test only. */
export async function resetAndSeed(pool: pg.Pool, appEnv: string): Promise<void> {
  await resetSchema(pool, appEnv);
  await migrate(pool);
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
