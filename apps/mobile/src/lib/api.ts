import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { apiUrl } from './config';

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

/* ---- Credentials: kept in the phone's encrypted store, removed on every sign-out ---- */
const TOKEN_KEY = 'khidmat_token';
const USER_KEY = 'khidmat_user_id';
let token: string | null = null;
let userId: string | null = null;
const secure = Platform.OS !== 'web'; // web is only used for screenshots; nothing is persisted there

export async function loadSession() {
  if (secure) {
    token = await SecureStore.getItemAsync(TOKEN_KEY);
    userId = await SecureStore.getItemAsync(USER_KEY);
  }
  return token && userId ? { token, userId } : null;
}
export async function saveSession(t: string, uid: string) {
  token = t; userId = uid;
  if (secure) { await SecureStore.setItemAsync(TOKEN_KEY, t); await SecureStore.setItemAsync(USER_KEY, uid); }
}
export async function clearSession() {
  token = null; userId = null;
  if (secure) { await SecureStore.deleteItemAsync(TOKEN_KEY); await SecureStore.deleteItemAsync(USER_KEY); }
}
export const currentUserId = () => userId;

/** Ends the session on the server when online, then always clears this phone's credentials. */
export async function signOutEverywhere() {
  try { if (token) await api('POST', '/v1/auth/logout'); } catch { /* offline: the server session expires on its own */ }
  await clearSession();
}

export const newKey = () => `app-${Crypto.randomUUID()}`;
export const newRef = () => Crypto.randomUUID().replace(/-/g, '');

let onSignedOut: (() => void) | null = null;
export const setSignedOutHandler = (fn: () => void) => { onSignedOut = fn; };

export async function api<T = any>(method: string, path: string, body?: unknown, // eslint-disable-line @typescript-eslint/no-explicit-any
  opts: { idem?: string; file?: { uri: string; type: string }; timeoutMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
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
    res = await fetch(`${apiUrl()}${path}`, { method, headers, body: payload, signal: ctrl.signal });
  } catch {
    throw new ApiError(0, timedOut ? 'TIMEOUT' : 'NETWORK', timedOut ? 'The server did not answer in time' : 'No connection');
  } finally {
    clearTimeout(timer);
  }
  const requestId = res.headers.get('x-request-id') ?? undefined;
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) { await clearSession(); onSignedOut?.(); }
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Something went wrong', data?.error?.details, data?.error?.request_id ?? requestId);
  }
  return data as T;
}
