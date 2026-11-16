import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

/**
 * Starts two real Khidmat API servers ("A" and "B") on two databases seeded with the same synthetic data,
 * so the same customer has the same account id on both, exactly like two laptops running the test stack.
 */
const API = path.resolve(__dirname, '../../api');

function envFile(): Record<string, string> {
  try {
    return Object.fromEntries(readFileSync(path.resolve(__dirname, '../../../.env'), 'utf8').split('\n')
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  } catch { return {}; }
}

async function ensureDatabase(url: string) {
  const u = new URL(url);
  const name = u.pathname.slice(1);
  const admin = new URL(url); admin.pathname = '/postgres';
  const a = new pg.Client({ connectionString: admin.toString() });
  await a.connect();
  try { await a.query(`CREATE DATABASE ${name}`); } catch { /* exists */ } finally { await a.end(); }
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { await c.query('CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto;'); } catch { /* created by an administrator */ } finally { await c.end(); }
}

export interface TestServer { url: string; db: string; proc: ChildProcess; stop: () => void }

export async function startServers(): Promise<{ A: TestServer; B: TestServer }> {
  const base = process.env.TEST_DATABASE_URL ?? envFile().TEST_DATABASE_URL;
  if (!base) throw new Error('TEST_DATABASE_URL is not set');
  const make = async (label: string, port: number): Promise<TestServer> => {
    const db = base.replace(/_test(\?|$)/, `_${label}_test$1`);
    await ensureDatabase(db);
    const env = { ...process.env, DATABASE_URL: db, APP_ENV: 'test', PORT: String(port), TEST_FAULTS: '1', JOBS_INTERVAL_SECONDS: '0', LOG_LEVEL: 'silent', SMS_PROVIDER: 'sandbox' };
    const r = spawnSync(process.execPath, ['scripts/reset.ts', '--yes'], { cwd: API, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`reset ${label} failed: ${r.stderr}`);
    const proc = spawn(process.execPath, ['src/index.ts'], { cwd: API, env, stdio: 'ignore' });
    const url = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${url}/health`)).ok) break; } catch { /* starting */ }
      await new Promise((res) => setTimeout(res, 100));
    }
    return { url, db, proc, stop: () => proc.kill() };
  };
  return { A: await make('a', 39101), B: await make('b', 39102) };
}

export async function count(db: string, sql: string, params: unknown[] = []): Promise<number> {
  const c = new pg.Client({ connectionString: db });
  await c.connect();
  try { return Number((await c.query(sql, params)).rows[0].n); } finally { await c.end(); }
}
