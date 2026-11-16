import * as FS from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api, ApiError, currentScope, newKey, newRef, scopeKey, type Scope } from './api';

/**
 * One booking submission per (server, account), kept on the phone until the server has it and every file is settled.
 *
 * - The Idempotency-Key and the request body (with the server's price token) are fixed when the customer confirms
 *   and never change, so every retry, from any screen and after a restart, can only return the same booking.
 * - Records live in the encrypted store under a key made of the server address and the account id. Another account,
 *   or the same synthetic account on another test server, never sees or sends it.
 * - Every request a record makes goes to the server it was created for, with that session's token, even if the
 *   tester switches servers while it is running.
 * - Each photo or voice note has a visible state. Files upload after the booking exists, each with its own
 *   client reference, so a retried upload is stored once and a failed one never repeats the booking.
 */

export type OutboxStatus = 'ready' | 'sending' | 'uncertain' | 'created';
export type FileState = 'pending' | 'uploading' | 'uploaded' | 'failed';
export interface OutboxMedia {
  ref: string; uri: string; type: string; kind: 'photo' | 'voice';
  state: FileState;
  /** Why it failed (permanent errors), or why the last try did not finish (connection problems). */
  error?: { code: string; permanent: boolean };
}
export interface Outbox {
  v: 2;
  server: string;
  user_id: string;
  key: string;
  body: Record<string, unknown>;
  summary: { job_name_en: string; job_name_ur: string; total_paisa: number | null; scheduled_start: string | null };
  media: OutboxMedia[];
  status: OutboxStatus;
  booking?: { id: string; ref: string };
  saved_at: string;
  last_error?: { code: string; request_id?: string };
}

/** Upload errors that a retry cannot fix: the tester must replace or remove the file. */
const PERMANENT = new Set(['FILE_TYPE_NOT_ALLOWED', 'FILE_TOO_LARGE', 'EMPTY_FILE', 'UNSUPPORTED_MEDIA', 'TOO_MANY_FILES',
  'BOOKING_FINISHED', 'NOT_FOUND', 'VALIDATION', 'FILE_MISSING']);

const secure = Platform.OS !== 'web';
const memory = new Map<string, string>(); // web previews only
const storeKey = (s: Pick<Scope, 'server' | 'userId'>) => `khidmat_outbox_${scopeKey(s)}`;
const mediaDir = (s: Pick<Scope, 'server' | 'userId'>) => `${FS.documentDirectory}outbox/${scopeKey(s)}/`;
const scopeOf = (o: Outbox) => ({ server: o.server, userId: o.user_id });

const listeners = new Set<() => void>();
export function onOutboxChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

async function write(o: Outbox) {
  const v = JSON.stringify(o);
  if (secure) await SecureStore.setItemAsync(storeKey(scopeOf(o)), v); else memory.set(storeKey(scopeOf(o)), v);
  listeners.forEach((fn) => fn());
}
async function read(s: Pick<Scope, 'server' | 'userId'>): Promise<Outbox | null> {
  const raw = secure ? await SecureStore.getItemAsync(storeKey(s)) : memory.get(storeKey(s)) ?? null;
  if (!raw) return null;
  const o = JSON.parse(raw) as Outbox;
  if (o.v !== 2 || o.user_id !== s.userId || o.server !== s.server) return null;
  return o;
}
async function remove(o: Outbox) {
  if (secure) {
    await SecureStore.deleteItemAsync(storeKey(scopeOf(o)));
    await FS.deleteAsync(mediaDir(scopeOf(o)), { idempotent: true }).catch(() => undefined);
  } else memory.delete(storeKey(scopeOf(o)));
  listeners.forEach((fn) => fn());
}

/** The unfinished booking for the signed-in account on the current server, if any. */
export async function loadOutbox(scope: Scope | null = currentScope()): Promise<Outbox | null> {
  if (!scope) return null;
  const o = await read(scope);
  if (!o) return null;
  // Work interrupted by the app closing: a booking send has an unknown result; a file upload simply starts again.
  if (o.status === 'sending' && !(running.has(storeKey(scope)))) o.status = 'uncertain';
  if (!running.has(storeKey(scope))) for (const m of o.media) if (m.state === 'uploading') m.state = 'pending';
  return o;
}

async function keepFile(scope: Pick<Scope, 'server' | 'userId'>, m: { uri: string; type: string }, ref: string) {
  if (!secure) return m.uri;
  await FS.makeDirectoryAsync(mediaDir(scope), { intermediates: true }).catch(() => undefined);
  const ext = m.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin';
  const to = `${mediaDir(scope)}${ref}.${ext}`;
  try { await FS.copyAsync({ from: m.uri, to }); return to; } catch { return m.uri; }
}

/** Saves the confirmed booking before anything is sent. Returns the unfinished one instead if there is one. */
export async function createOutbox(body: Record<string, unknown>, summary: Outbox['summary'], media: { uri: string; type: string; kind: 'photo' | 'voice' }[]): Promise<Outbox> {
  const scope = currentScope();
  if (!scope) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in again');
  const existing = await loadOutbox(scope);
  if (existing) return existing;
  const kept: OutboxMedia[] = [];
  for (const m of media) {
    const ref = newRef();
    kept.push({ ref, uri: await keepFile(scope, m, ref), type: m.type, kind: m.kind, state: 'pending' });
  }
  const o: Outbox = { v: 2, server: scope.server, user_id: scope.userId, key: newKey(), body: { ...body }, summary, media: kept, status: 'ready', saved_at: new Date().toISOString() };
  await write(o);
  return o;
}

export interface SendResult { booking: { id: string; ref: string }; filesPending: number; filesFailed: number }
const running = new Map<string, Promise<SendResult>>();
const stopping = new Set<string>();

/**
 * Before the tester switches server or signs out: let the request already on its way finish (it stays bound to its
 * server and session), stop before the next one, and wait. Files not yet started stay pending for later.
 */
export async function settleCurrentWork(timeoutMs = 60000) {
  const scope = currentScope();
  if (!scope) return;
  const k = storeKey(scope);
  const p = running.get(k);
  if (!p) return;
  stopping.add(k);
  try { await Promise.race([p.catch(() => undefined), new Promise((r) => setTimeout(r, timeoutMs))]); } finally { stopping.delete(k); }
}

/**
 * Sends the saved booking (same key, same body) to its own server, then every file not yet uploaded.
 * Calls for the same record share one attempt, so a double tap or two screens cannot send twice in parallel.
 * Throws ApiError: an uncertain result keeps the record for "Check again"; a definite refusal (for example
 * PRICE_CHANGED) removes it, because nothing was created.
 */
export function sendOutbox(scope: Scope | null = currentScope()): Promise<SendResult> {
  if (!scope) return Promise.reject(new ApiError(401, 'UNAUTHENTICATED', 'Sign in again'));
  const k = storeKey(scope);
  let p = running.get(k);
  if (!p) {
    p = run(scope).finally(() => { running.delete(k); });
    running.set(k, p);
  }
  return p;
}

async function run(scope: Scope): Promise<SendResult> {
  const o = await loadOutbox(scope);
  if (!o) throw new ApiError(0, 'NOTHING_TO_SEND', 'Nothing to send');
  // Only one run per record exists, so an "uploading" file at the start of a run was interrupted: start it again.
  for (const m of o.media) if (m.state === 'uploading') m.state = 'pending';
  const bound = { base: o.server, token: scope.token }; // fixed for the whole run, whatever the tester does meanwhile
  if (!o.booking) {
    o.status = 'sending';
    await write(o);
    try {
      const b = await api<{ id: string; ref: string }>('POST', '/v1/bookings', o.body, { ...bound, idem: o.key, timeoutMs: 30000, fault: 'booking' });
      o.booking = { id: b.id, ref: b.ref };
      o.status = 'created';
      delete o.last_error;
      await write(o);
    } catch (e) {
      const err = e as ApiError;
      if (err.uncertain || err.code === 'REQUEST_IN_PROGRESS') {
        o.status = 'uncertain';
        o.last_error = { code: err.code, request_id: err.requestId };
        await write(o);
      } else {
        await remove(o);
      }
      throw err;
    }
  }
  for (const m of o.media.filter((x) => x.state === 'pending')) {
    // Stop if the tester signed out or switched server: the rest waits for this account on this server.
    const now = currentScope();
    if (stopping.has(storeKey(scope)) || !now || now.server !== o.server || now.userId !== o.user_id) break;
    m.state = 'uploading';
    delete m.error;
    await write(o);
    try {
      await api('POST', `/v1/bookings/${o.booking.id}/attachments?kind=${m.kind}&client_ref=${m.ref}`, undefined, { ...bound, file: m, timeoutMs: 60000, fault: 'upload' });
      m.state = 'uploaded';
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'FILE_MISSING';
      const permanent = PERMANENT.has(code) || (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 408 && e.status !== 429);
      m.state = permanent ? 'failed' : 'pending';
      m.error = { code, permanent };
    }
    await write(o);
  }
  return finish(o);
}

async function finish(o: Outbox): Promise<SendResult> {
  const filesPending = o.media.filter((x) => x.state === 'pending' || x.state === 'uploading').length;
  const filesFailed = o.media.filter((x) => x.state === 'failed').length;
  const booking = o.booking!;
  if (filesPending === 0 && filesFailed === 0) await remove(o);
  return { booking, filesPending, filesFailed };
}

async function editFiles(fn: (o: Outbox) => Promise<void> | void) {
  const scope = currentScope();
  const o = scope && await loadOutbox(scope);
  if (!o) return;
  await fn(o);
  await write(o);
  if (o.booking) await finish(o);
}

/** Try a file again (after a connection problem, or once the cause is fixed). */
export const retryFile = (ref: string) => editFiles((o) => { const m = o.media.find((x) => x.ref === ref); if (m) { m.state = 'pending'; delete m.error; } });
/** Give up on a file. The booking itself is unaffected. */
export const removeFile = (ref: string) => editFiles((o) => { o.media = o.media.filter((x) => x.ref !== ref); });
/** Swap a failed file for another one (for example a photo instead of an unsupported file). */
export const replaceFile = (ref: string, file: { uri: string; type: string; kind: 'photo' | 'voice' }) => editFiles(async (o) => {
  const i = o.media.findIndex((x) => x.ref === ref);
  if (i < 0) return;
  const nref = newRef();
  o.media[i] = { ref: nref, uri: await keepFile(scopeOf(o), file, nref), type: file.type, kind: file.kind, state: 'pending' };
});

/** Discarding is only offered when nothing can have been created, or after the customer confirms they understand. */
export async function discardOutbox() {
  const o = await loadOutbox();
  if (o) await remove(o);
}
