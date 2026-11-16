import type { FastifyInstance } from 'fastify';
import { buildApp, type BuildOptions } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { resetAndSeed } from '../src/setup.ts';
import { DEMO_USERS, ids } from '../src/seed/index.ts';

export { pool, ids, DEMO_USERS };

export async function freshApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  await resetAndSeed(pool, 'test');
  return buildApp({ logLevel: 'silent', ...opts });
}

export interface Res<T = any> { status: number; body: T } // eslint-disable-line @typescript-eslint/no-explicit-any

export function client(app: FastifyInstance, token?: string) {
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
    const res = await app.inject({
      method, url, payload: payload as object | undefined,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, body: unknown = {}, headers?: Record<string, string>) => call('POST', url, body, headers),
    put: (url: string, body: unknown = {}) => call('PUT', url, body),
    patch: (url: string, body: unknown = {}) => call('PATCH', url, body),
    del: (url: string) => call('DELETE', url),
  };
}
export type Client = ReturnType<typeof client>;

export async function login(app: FastifyInstance, phone: string): Promise<Client> {
  const anon = client(app);
  const r1 = await anon.post('/v1/auth/otp/request', { phone });
  if (r1.status !== 200) throw new Error(`otp request failed: ${JSON.stringify(r1.body)}`);
  const r2 = await anon.post('/v1/auth/otp/verify', { phone, code: '123456' });
  if (r2.status !== 200) throw new Error(`otp verify failed: ${JSON.stringify(r2.body)}`);
  return client(app, r2.body.token);
}

export async function loginAll(app: FastifyInstance) {
  const out = {} as Record<keyof typeof DEMO_USERS, Client>;
  for (const [k, u] of Object.entries(DEMO_USERS)) out[k as keyof typeof DEMO_USERS] = await login(app, u.phone);
  return out;
}

/** Tomorrow at HH:MM in Asia/Karachi, as an ISO string with +05:00. */
export function tomorrowAt(hhmm: string): string {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + 24 * 3600_000));
  return `${d}T${hhmm}:00+05:00`;
}

let keyCounter = 0;
export const newKey = (prefix = 'k') => `${prefix}-${Date.now()}-${++keyCounter}-test`;

export const idem = (key = newKey()) => ({ 'idempotency-key': key });

export const LOCALITY = {
  G10: ids.region('ISB-G10'),
  F10: ids.region('ISB-F10'),
  SATELLITE: ids.region('RWP-SATELLITE-TOWN'),
  CHAKLALA: ids.region('RWP-CHAKLALA-III'),
};
export const JOB = (code: string) => ids.job(code);
export const ZONE = (code: string) => ids.zone(code);
export const PROVIDER = (k: keyof typeof DEMO_USERS) => ids.provider(k);

export async function ledgerOf(providerKey: keyof typeof DEMO_USERS) {
  const { rows } = await pool.query(`SELECT entry_type, amount_paisa, booking_id FROM app.ledger_entries WHERE provider_id = $1 ORDER BY id`,
    [ids.provider(providerKey)]);
  return rows as { entry_type: string; amount_paisa: number; booking_id: string | null }[];
}

/** Book, dispatch to the given provider and accept. Returns the booking id. */
export async function bookAndAssign(u: Record<keyof typeof DEMO_USERS, Client>, customer: 'customerIsb' | 'customerRwp',
  provider: keyof typeof DEMO_USERS, body: Record<string, unknown>): Promise<string> {
  const created = await u[customer].post('/v1/bookings', body, idem());
  if (created.status !== 201) throw new Error(`booking failed: ${JSON.stringify(created.body)}`);
  const id = created.body.id as string;
  const offer = await u.dispatcher.post(`/v1/admin/bookings/${id}/offers`, { provider_id: ids.provider(provider) });
  if (offer.status !== 201) throw new Error(`offer failed: ${JSON.stringify(offer.body)}`);
  const acc = await u[provider].post(`/v1/provider/offers/${offer.body.assignment_id}/accept`);
  if (acc.status !== 200) throw new Error(`accept failed: ${JSON.stringify(acc.body)}`);
  return id;
}

export type Users = Awaited<ReturnType<typeof loginAll>>;
