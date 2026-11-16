import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { apiUrl, serverScope } from './config';
import { recordFailure, takeFault } from './diagnostics';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  requestId?: string;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>, requestId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
  /** True when the request may or may not have reached the server: the result is unknown, not failed. */
  get uncertain() { return this.code === 'NETWORK' || this.code === 'TIMEOUT' || this.status >= 500; }
}

/* ---- Credentials: one session, for one server, in the phone's encrypted store. Removed on every sign-out. ---- */
const TOKEN_KEY = 'khidmat_token';
const USER_KEY = 'khidmat_user_id';
const SERVER_KEY = 'khidmat_session_server';
let token: string | null = null;
let userId: string | null = null;
let sessionServer: string | null = null;
const secure = Platform.OS !== 'web'; // web is only used for screenshots; nothing is persisted there

export async function loadSession() {
  if (secure) {
    token = await SecureStore.getItemAsync(TOKEN_KEY);
    userId = await SecureStore.getItemAsync(USER_KEY);
    sessionServer = await SecureStore.getItemAsync(SERVER_KEY);
  }
  // A session belongs to the server that issued it. If the server address changed, sign in again.
  if (token && sessionServer !== apiUrl()) { await clearSession(); return null; }
  return token && userId ? { token, userId } : null;
}
export async function saveSession(t: string, uid: string) {
  token = t; userId = uid; sessionServer = apiUrl();
  if (secure) {
    await SecureStore.setItemAsync(TOKEN_KEY, t);
    await SecureStore.setItemAsync(USER_KEY, uid);
    await SecureStore.setItemAsync(SERVER_KEY, sessionServer);
  }
}
export async function clearSession() {
  token = null; userId = null; sessionServer = null;
  if (secure) {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    await SecureStore.deleteItemAsync(SERVER_KEY);
  }
}
export const currentUserId = () => userId;

/** The (server, account) pair that owns unsent bookings and files. Null when signed out. */
export interface Scope { server: string; userId: string; token: string }
export const currentScope = (): Scope | null => (token && userId && sessionServer ? { server: sessionServer, userId, token } : null);
export const scopeKey = (s: Pick<Scope, 'server' | 'userId'>) => `${serverScope(s.server)}_${s.userId}`;

/** Ends the session on the server that issued it when reachable, then always clears this phone's credentials. */
export async function signOutEverywhere() {
  const s = currentScope();
  if (s) { try { await api('POST', '/v1/auth/logout', undefined, { base: s.server, token: s.token, timeoutMs: 6000 }); } catch { /* offline: it expires on its own */ } }
  await clearSession();
}

export const newKey = () => `app-${Crypto.randomUUID()}`;
export const newRef = () => Crypto.randomUUID().replace(/-/g, '');

let onSignedOut: (() => void) | null = null;
export const setSignedOutHandler = (fn: () => void) => { onSignedOut = fn; };

export interface ApiOpts {
  idem?: string;
  file?: { uri: string; type: string };
  timeoutMs?: number;
  /** Send to this server with this token instead of the current ones, so a request started before a server switch stays bound to its original server. */
  base?: string;
  token?: string | null;
  fault?: 'booking' | 'upload';
}

export async function api<T = any>(method: string, path: string, body?: unknown, opts: ApiOpts = {}): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const base = opts.base ?? apiUrl();
  const auth = opts.token !== undefined ? opts.token : token;
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = `Bearer ${auth}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  if (opts.fault && takeFault(opts.fault)) headers['x-khidmat-test-fault'] = 'drop-reply';
  let payload: BodyInit | undefined;
  if (opts.file) {
    payload = await (await fetch(opts.file.uri)).blob();
    headers['content-type'] = opts.file.type;
  } else if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body ?? {});
  }
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, opts.timeoutMs ?? 20000);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method, headers, body: payload, signal: ctrl.signal });
  } catch {
    const code = timedOut ? 'TIMEOUT' : 'NETWORK';
    recordFailure({ method, path, status: 0, code });
    throw new ApiError(0, code, timedOut ? 'The server did not answer in time' : 'No connection');
  } finally {
    clearTimeout(timer);
  }
  const requestId = res.headers.get('x-request-id') ?? undefined;
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Something went wrong', data?.error?.details, data?.error?.request_id ?? requestId);
    recordFailure({ method, path, status: res.status, code: err.code, request_id: err.requestId });
    // Only the current session's own rejection signs the phone out; a stale request to an old server never does.
    if (res.status === 401 && auth && auth === token && base === sessionServer) { await clearSession(); onSignedOut?.(); }
    throw err;
  }
  return data as T;
}
