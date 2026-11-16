/** Thin client for the Khidmat API. The token lives in sessionStorage (cleared when the tab closes). */

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let token: string | null = null;
try { token = sessionStorage.getItem('khidmat.token'); } catch { /* storage unavailable */ }

export function setToken(t: string | null) {
  token = t;
  try { if (t) sessionStorage.setItem('khidmat.token', t); else sessionStorage.removeItem('khidmat.token'); } catch { /* ignore */ }
}
export const hasToken = () => !!token;

export function newIdempotencyKey(): string {
  return `web-${crypto.randomUUID()}`;
}

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { idem?: string; raw?: Blob; rawType?: string } = {}): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  let payload: BodyInit | undefined;
  if (opts.raw) { headers['content-type'] = opts.rawType ?? opts.raw.type; payload = opts.raw; }
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No connection. Check the internet and try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? `Request failed (${res.status})`, data?.error?.details);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p); // eslint-disable-line @typescript-eslint/no-explicit-any
export const post = <T = any>(p: string, b: unknown = {}, idem?: string) => api<T>('POST', p, b, { idem }); // eslint-disable-line @typescript-eslint/no-explicit-any

/** Opens a private file: asks the API for a short-lived signed link, then opens it. */
export async function openSigned(path: string, body?: unknown) {
  const r = await api<{ url: string }>(body ? 'POST' : 'GET', path, body);
  window.open(`${BASE}${r.url}`, '_blank', 'noopener');
}
