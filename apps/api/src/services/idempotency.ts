import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, tx, one } from '../db.ts';
import { AppError, conflict } from '../lib/errors.ts';

export interface StoredResponse { status: number; body: unknown }

/**
 * Runs a write once per (user, route, Idempotency-Key). A retry with the same key and body
 * returns the stored response; the same key with a different body is refused.
 * The key row is inserted first in the same transaction, so a concurrent duplicate waits
 * on the unique index and then reads the stored result instead of running twice.
 */
export async function idempotent(userId: string, route: string, key: string | undefined, body: unknown,
  run: (c: PoolClient) => Promise<StoredResponse>, required = true): Promise<StoredResponse> {
  if (!key) {
    if (required) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header with this request.');
    return tx(run);
  }
  if (!/^[A-Za-z0-9_\-:.]{8,100}$/.test(key)) throw new AppError(400, 'BAD_IDEMPOTENCY_KEY', 'Idempotency-Key must be 8-100 safe characters.');
  const hash = createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');

  const replay = async (): Promise<StoredResponse | null> => {
    const row = await one<{ request_hash: string; response_status: number | null; response_body: unknown }>(pool,
      'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE user_id = $1 AND route = $2 AND key = $3',
      [userId, route, key]);
    if (!row) return null;
    if (row.request_hash !== hash) throw conflict('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used for a different request.');
    if (row.response_status === null) throw conflict('REQUEST_IN_PROGRESS', 'The same request is still being processed.');
    return { status: row.response_status, body: row.response_body };
  };

  const earlier = await replay();
  if (earlier) return earlier;
  try {
    return await tx(async (c) => {
      const claimed = await c.query(
        `INSERT INTO idempotency_keys (user_id, route, key, request_hash) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [userId, route, key, hash]);
      if (claimed.rowCount === 0) throw new Replay();
      const res = await run(c);
      await c.query(`UPDATE idempotency_keys SET response_status = $4, response_body = $5 WHERE user_id = $1 AND route = $2 AND key = $3`,
        [userId, route, key, res.status, JSON.stringify(res.body)]);
      return res;
    });
  } catch (err) {
    if (err instanceof Replay) {
      const again = await replay();
      if (again) return again;
    }
    throw err;
  }
}

class Replay extends Error {}
