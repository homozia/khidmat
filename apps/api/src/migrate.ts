import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type pg from 'pg';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

/**
 * Applies versioned SQL files in order, each in its own transaction.
 * A changed checksum on an applied file is an error: write a new migration instead.
 */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS app');
    await client.query(`CREATE TABLE IF NOT EXISTS app.schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const ext = await client.query(`SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'pgcrypto')`);
    if (ext.rowCount !== 2) {
      throw new Error('Extensions postgis and pgcrypto must be created by a superuser first (see README).');
    }
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    const done = new Map(
      (await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM app.schema_migrations'))
        .rows.map((r) => [r.version, r.checksum]),
    );
    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = done.get(file);
      if (previous) {
        if (previous !== checksum) throw new Error(`Migration ${file} was edited after being applied`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL search_path = app, public');
        await client.query(sql);
        await client.query('INSERT INTO app.schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
    return applied;
  } finally {
    client.release();
  }
}

/** Drops every application object. Refused outside development and test. */
export async function resetSchema(pool: pg.Pool, appEnv: string): Promise<void> {
  if (appEnv !== 'development' && appEnv !== 'test') {
    throw new Error(`Refusing to reset the database when APP_ENV=${appEnv}`);
  }
  await pool.query('DROP SCHEMA IF EXISTS app CASCADE');
}
