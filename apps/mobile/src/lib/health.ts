/** Checks a server address the way the phone will use it, and says in plain words what is wrong. */
export interface ServerInfo { app: string; env: string; sandbox_sms: boolean; test_faults: boolean }
export type HealthResult =
  | { ok: true; info: ServerInfo; ms: number }
  | { ok: false; reason: 'timeout' | 'unreachable' | 'not_khidmat' | 'not_ready' };

export async function checkServer(url: string, timeoutMs = 8000): Promise<HealthResult> {
  const ctrl = new AbortController();
  let timedOut = false;
  const h = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const started = Date.now();
  try {
    const r = await fetch(`${url}/health`, { signal: ctrl.signal });
    const body = await r.json().catch(() => null);
    if (!body || typeof body.app !== 'string') return { ok: false, reason: 'not_khidmat' };
    if (!r.ok || body.ok !== true) return { ok: false, reason: 'not_ready' };
    return { ok: true, info: { app: body.app, env: body.env, sandbox_sms: !!body.sandbox_sms, test_faults: !!body.test_faults }, ms: Date.now() - started };
  } catch {
    return { ok: false, reason: timedOut ? 'timeout' : 'unreachable' };
  } finally { clearTimeout(h); }
}

/** English keys; Urdu in i18n.tsx. */
export const HEALTH_HELP: Record<Exclude<HealthResult, { ok: true }>['reason'], string[]> = {
  timeout: [
    'The phone could not reach the laptop.',
    'Check that the phone and the laptop are on the same Wi-Fi (not a guest network) and that mobile data is not being used instead.',
    'On the laptop, check that the test server window is still open.',
    'If Windows asked about Node.js and the firewall, allow it on private networks.',
    'The laptop address can change after a restart: run the start command again and use the address it shows.',
  ],
  unreachable: [
    'Nothing answered at this address.',
    'Check the address for typing mistakes (for example 192.168.1.20).',
    'Check that the phone and the laptop are on the same Wi-Fi, and that the test server is running.',
  ],
  not_khidmat: [
    'Something answered at this address, but it is not the Khidmat test server.',
    'Check the port: the server uses 3000 (for example 192.168.1.20:3000), the website uses 5173.',
  ],
  not_ready: [
    'The test server is running but cannot reach its database.',
    'On the laptop, run the start command again; it starts the database first.',
  ],
};
