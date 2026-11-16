import pg from 'pg';
import { config } from './config.ts';

// int8 (bigint) columns hold paisa amounts and ids; all stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
// numeric -> number (quantities, ratings)
pg.types.setTypeParser(1700, (v) => Number(v));

export type Db = pg.Pool | pg.PoolClient;

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  options: '-c search_path=app,public -c timezone=UTC',
});

/** Runs fn inside one transaction. Rolls back on any error. */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function one<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const res = await db.query<T>(sql, params);
  return res.rows[0];
}

export async function many<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query<T>(sql, params);
  return res.rows;
}
