import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** API base. Android emulator reaches the host machine at 10.0.2.2. Set EXPO_PUBLIC_API_URL for devices. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');

export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const TOKEN_KEY = 'khidmat_token';
let token: string | null = null;

// SecureStore is not available on web; fall back to memory there (web is only used for previews).
export async function loadToken() {
  if (Platform.OS === 'web') return token;
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token;
}
export async function saveToken(t: string | null) {
  token = t;
  if (Platform.OS === 'web') return;
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export const newKey = () => `app-${Crypto.randomUUID()}`;

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { idem?: string; file?: { uri: string; type: string } } = {}): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
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
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: payload, signal: ctrl.signal });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No connection');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) await saveToken(null);
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Something went wrong', data?.error?.details);
  }
  return data as T;
}

/**
 * Booking submission that survives a dropped connection: the request and its Idempotency-Key
 * are saved on the phone first. Retrying sends the same key, so the server returns the same
 * booking instead of creating a second one.
 */
const PENDING_KEY = 'khidmat_pending_booking';
export interface PendingBooking { key: string; body: Record<string, unknown>; media: { uri: string; type: string; kind: 'photo' | 'voice' }[]; saved_at: string }

export async function savePending(p: PendingBooking) { await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(p)); }
export async function getPending(): Promise<PendingBooking | null> {
  const s = await AsyncStorage.getItem(PENDING_KEY);
  return s ? (JSON.parse(s) as PendingBooking) : null;
}
export async function clearPending() { await AsyncStorage.removeItem(PENDING_KEY); }

/** Returns the booking, or throws. Media failures do not undo the booking; they are reported separately. */
export async function submitPending(p: PendingBooking): Promise<{ booking: any; mediaFailed: number }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const booking = await api('POST', '/v1/bookings', p.body, { idem: p.key });
  await clearPending();
  let mediaFailed = 0;
  for (const m of p.media) {
    try { await api('POST', `/v1/bookings/${booking.id}/attachments?kind=${m.kind}`, undefined, { file: m }); } catch { mediaFailed += 1; }
  }
  return { booking, mediaFailed };
}
