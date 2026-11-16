import * as FS from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api, ApiError, currentUserId, newKey, newRef } from './api';

/**
 * One booking submission per account, kept on the phone until the server has it.
 *
 * - The Idempotency-Key and the request body (including the server's price token) are fixed when the customer
 *   confirms, and never change. Every retry, from any screen and after a restart, sends exactly the same request,
 *   so the server returns the same booking instead of creating a second one.
 * - The record is stored in the encrypted store under the signed-in account's id. Another account on the same
 *   phone does not see it, and the server would refuse it anyway (keys and price tokens are tied to the account).
 * - Photos and the voice note are copied into app storage and uploaded after the booking exists, each with its
 *   own reference, so a retried upload is stored once and a failed upload never blocks or repeats the booking.
 */

export type OutboxStatus = 'ready' | 'sending' | 'uncertain' | 'created';
export interface OutboxMedia { ref: string; uri: string; type: string; kind: 'photo' | 'voice'; uploaded: boolean }
export interface Outbox {
  v: 1;
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

const secure = Platform.OS !== 'web';
let memory: Outbox | null = null; // web previews only
const storeKey = (uid: string) => `khidmat_outbox_${uid}`;
const mediaDir = (uid: string) => `${FS.documentDirectory}outbox/${uid}/`;

async function write(o: Outbox) {
  if (!secure) { memory = o; return; }
  await SecureStore.setItemAsync(storeKey(o.user_id), JSON.stringify(o));
}

export async function loadOutbox(): Promise<Outbox | null> {
  const uid = currentUserId();
  if (!uid) return null;
  if (!secure) return memory?.user_id === uid ? memory : null;
  const raw = await SecureStore.getItemAsync(storeKey(uid));
  if (!raw) return null;
  const o = JSON.parse(raw) as Outbox;
  if (o.user_id !== uid) return null;
  // A send interrupted by the app closing has an unknown result.
  if (o.status === 'sending') o.status = 'uncertain';
  return o;
}

async function remove(o: Outbox) {
  if (!secure) { memory = null; return; }
  await SecureStore.deleteItemAsync(storeKey(o.user_id));
  await FS.deleteAsync(mediaDir(o.user_id), { idempotent: true }).catch(() => undefined);
}

/** Saves the confirmed booking before anything is sent. Returns the unfinished one instead if there is one. */
export async function createOutbox(body: Record<string, unknown>, summary: Outbox['summary'], media: { uri: string; type: string; kind: 'photo' | 'voice' }[]): Promise<Outbox> {
  const uid = currentUserId();
  if (!uid) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in again');
  const existing = await loadOutbox();
  if (existing) return existing;
  const kept: OutboxMedia[] = [];
  if (secure && media.length) await FS.makeDirectoryAsync(mediaDir(uid), { intermediates: true }).catch(() => undefined);
  for (const m of media) {
    const ref = newRef();
    let uri = m.uri;
    if (secure) {
      const ext = m.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin';
      const to = `${mediaDir(uid)}${ref}.${ext}`;
      try { await FS.copyAsync({ from: m.uri, to }); uri = to; } catch { /* keep the picker's copy */ }
    }
    kept.push({ ref, uri, type: m.type, kind: m.kind, uploaded: false });
  }
  const o: Outbox = { v: 1, user_id: uid, key: newKey(), body: { ...body }, summary, media: kept, status: 'ready', saved_at: new Date().toISOString() };
  await write(o);
  return o;
}

let inFlight: Promise<SendResult> | null = null;
export interface SendResult { booking: { id: string; ref: string }; mediaPending: number }

/**
 * Sends the saved booking (same key, same body) and then any files not yet uploaded.
 * Concurrent calls share one attempt, so a double tap or two screens cannot send twice in parallel.
 * Throws ApiError: `uncertain` errors leave the record saved for a later retry; a definite refusal
 * (for example PRICE_CHANGED) removes it, because nothing was created.
 */
export function sendOutbox(): Promise<SendResult> {
  inFlight ??= run().finally(() => { inFlight = null; });
  return inFlight;
}

async function run(): Promise<SendResult> {
  const o = await loadOutbox();
  if (!o) throw new ApiError(0, 'NOTHING_TO_SEND', 'Nothing to send');
  if (!o.booking) {
    o.status = 'sending';
    await write(o);
    try {
      const b = await api<{ id: string; ref: string }>('POST', '/v1/bookings', o.body, { idem: o.key, timeoutMs: 30000 });
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
  for (const m of o.media.filter((x) => !x.uploaded)) {
    try {
      await api('POST', `/v1/bookings/${o.booking.id}/attachments?kind=${m.kind}&client_ref=${m.ref}`, undefined, { file: m, timeoutMs: 60000 });
      m.uploaded = true;
      await write(o);
    } catch (e) {
      const err = e as ApiError;
      // A file the server will never take (wrong type, too many, booking finished) is dropped rather than retried forever.
      if (!err.uncertain && err.status !== 401) { m.uploaded = true; await write(o); }
    }
  }
  const mediaPending = o.media.filter((x) => !x.uploaded).length;
  const booking = o.booking;
  if (mediaPending === 0) await remove(o);
  return { booking, mediaPending };
}

/** Discarding is only offered when nothing can have been created, or after the customer confirms they understand. */
export async function discardOutbox() {
  const o = await loadOutbox();
  if (o) await remove(o);
}
