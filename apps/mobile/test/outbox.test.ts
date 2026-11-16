import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { count, startServers, type TestServer } from './servers';

/*
 * The customer app's booking and upload logic against two real API servers (A and B) seeded with the same
 * synthetic accounts. Covers M4.1 findings D2 (server switching) and D4 (visible, recoverable uploads).
 */

type Mods = {
  api: typeof import('../src/lib/api');
  config: typeof import('../src/lib/config');
  outbox: typeof import('../src/lib/outbox');
  server: typeof import('../src/lib/server');
  diag: typeof import('../src/lib/diagnostics');
};
let m: Mods;
/** A fresh copy of the app's modules, as after the app is closed and opened again. Stored data survives. */
async function launch(): Promise<Mods> {
  vi.resetModules();
  m = {
    api: await import('../src/lib/api'), config: await import('../src/lib/config'), outbox: await import('../src/lib/outbox'),
    server: await import('../src/lib/server'), diag: await import('../src/lib/diagnostics'),
  };
  await m.config.loadServerUrl();
  await m.api.loadSession();
  return m;
}

let A: TestServer; let B: TestServer;
const USMAN = '+923001110001';
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString('base64')}`;
const TEXT = `data:text/plain;base64,${Buffer.from('not a photo').toString('base64')}`;
let hour = 8;

async function signIn(url: string, phone = USMAN) {
  await m.server.switchServer(url);
  await m.api.api('POST', '/v1/auth/otp/request', { phone });
  const r = await m.api.api<{ token: string; userId: string }>('POST', '/v1/auth/otp/verify', { phone, code: '123456' });
  await m.api.saveSession(r.token, r.userId);
  return r.userId;
}

/** Previews a tap-leak booking in G-10 on the current server and saves it in the outbox, as "Confirm booking" does. */
async function confirmBooking(media: { uri: string; type: string; kind: 'photo' | 'voice' }[] = []) {
  const place = (await m.api.api<{ id: string }[]>('GET', '/v1/places?q=g-10'))[0]!;
  const cat = await m.api.api('GET', `/v1/catalogue?locality_id=${place.id}`);
  const job = cat.categories.flatMap((c: { jobs: { code: string; id: string }[] }) => c.jobs).find((j: { code: string }) => j.code === 'plumbing.tap_leak');
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date(Date.now() + 2 * 864e5));
  const body = { job_id: job.id, timing: 'scheduled', scheduled_start: `${day}T${String(++hour).padStart(2, '0')}:00:00+05:00`,
    locality_id: place.id, address_line: 'House 1, Street 1, G-10/2', intake: { taps: 1 } };
  const q = await m.api.api('POST', '/v1/bookings/preview', body);
  return m.outbox.createOutbox({ ...body, price_token: q.price_token },
    { job_name_en: 'Leaking tap', job_name_ur: 'ٹپکتا نل', total_paisa: q.terms.total_paisa, scheduled_start: body.scheduled_start }, media);
}

const bookings = (s: TestServer) => count(s.db, `SELECT count(*) AS n FROM app.bookings b JOIN app.users u ON u.id = b.customer_id WHERE u.phone_e164 = $1`, [USMAN]);
const files = (s: TestServer, ref?: string) => count(s.db,
  `SELECT count(*) AS n FROM app.attachments a JOIN app.bookings b ON b.id = a.booking_id WHERE a.deleted_at IS NULL ${ref ? 'AND b.ref = $1' : ''}`, ref ? [ref] : []);

beforeAll(async () => { ({ A, B } = await startServers()); });
afterAll(() => { A?.stop(); B?.stop(); });
beforeEach(async () => { await launch(); });

describe('D2 switching test servers', () => {
  it('the same synthetic account on two servers has the same id, but separate sessions and drafts', async () => {
    const idA = await signIn(A.url);
    expect(m.api.currentScope()!.server).toBe(A.url);
    await confirmBooking();
    const idB = await signIn(B.url);
    expect(idB).toBe(idA);
    expect(await m.outbox.loadOutbox()).toBeNull(); // A's draft is not visible on B
    await signIn(A.url);
    expect(await m.outbox.loadOutbox()).not.toBeNull();
    const r = await m.outbox.sendOutbox();
    expect(r.booking.ref).toMatch(/^KH-/);
    expect([await bookings(A), await bookings(B)]).toEqual([1, 0]);
  });

  it('switching ends the old session on the old server and requires a fresh sign-in', async () => {
    await signIn(A.url);
    const oldToken = m.api.currentScope()!.token;
    await m.server.switchServer(B.url);
    expect(m.api.currentScope()).toBeNull();
    const r = await fetch(`${A.url}/v1/me`, { headers: { authorization: `Bearer ${oldToken}` } });
    expect(r.status).toBe(401);
    await launch(); // reopening the app does not restore a session either
    expect(m.api.currentScope()).toBeNull();
    expect(m.config.apiUrl()).toBe(B.url);
  });

  it('a booking whose result is uncertain stays with server A, and "Check again" after switching back finds that one booking', async () => {
    await signIn(A.url);
    const before = await bookings(A);
    await confirmBooking();
    m.diag.armFault('booking'); // A saves the booking and drops the reply
    await expect(m.outbox.sendOutbox()).rejects.toMatchObject({ code: 'NETWORK' });
    expect((await m.outbox.loadOutbox())!.status).toBe('uncertain');
    await signIn(B.url);
    expect(await m.outbox.loadOutbox()).toBeNull();
    await confirmBooking();
    await m.outbox.sendOutbox(); // an unrelated booking on B
    await signIn(A.url);
    const o = await m.outbox.loadOutbox();
    expect(o!.status).toBe('uncertain');
    const r = await m.outbox.sendOutbox();
    expect(await bookings(A)).toBe(before + 1); // the saved one, not a second
    expect(await count(A.db, 'SELECT count(*) AS n FROM app.bookings WHERE ref = $1', [r.booking.ref])).toBe(1);
  });

  it('an upload running when the tester switches server finishes on its own server; the rest waits and resumes there', async () => {
    await signIn(A.url);
    await confirmBooking([{ uri: JPEG, type: 'image/jpeg', kind: 'photo' }, { uri: JPEG, type: 'image/jpeg', kind: 'photo' }]);
    const sending = m.outbox.sendOutbox();
    let switched = false;
    const off = m.outbox.onOutboxChange(() => { if (!switched) { switched = true; void m.server.switchServer(B.url); } });
    const r = await sending; off();
    expect(r.booking.ref).toMatch(/^KH-/);
    const filesB = await files(B);
    await signIn(A.url);
    const left = await m.outbox.loadOutbox();
    expect(left!.media.every((x) => x.state === 'pending' || x.state === 'uploaded')).toBe(true);
    if (left) await m.outbox.sendOutbox();
    expect(await files(A, r.booking.ref)).toBe(2);
    expect(await files(B)).toBe(filesB); // nothing went to B
    expect(await m.outbox.loadOutbox()).toBeNull();
  });
});

describe('D4 uploads have a visible state and recover', () => {
  it('unsupported media is marked failed with the reason, kept, and can be replaced; the booking is not sent again', async () => {
    await signIn(A.url);
    const before = await bookings(A);
    await confirmBooking([{ uri: TEXT, type: 'text/plain', kind: 'photo' }]);
    const r = await m.outbox.sendOutbox();
    expect(r).toMatchObject({ filesFailed: 1, filesPending: 0 });
    const o = (await m.outbox.loadOutbox())!;
    expect(o.booking!.ref).toBe(r.booking.ref);
    expect(o.media[0]).toMatchObject({ state: 'failed', error: { permanent: true } });
    await m.outbox.replaceFile(o.media[0]!.ref, { uri: JPEG, type: 'image/jpeg', kind: 'photo' });
    await m.outbox.sendOutbox();
    expect(await m.outbox.loadOutbox()).toBeNull();
    expect(await files(A, r.booking.ref)).toBe(1);
    expect(await bookings(A)).toBe(before + 1);
  });

  it('a failed file can be removed without touching the booking', async () => {
    await signIn(A.url);
    await confirmBooking([{ uri: TEXT, type: 'text/plain', kind: 'photo' }]);
    await m.outbox.sendOutbox();
    const o = (await m.outbox.loadOutbox())!;
    await m.outbox.removeFile(o.media[0]!.ref);
    expect(await m.outbox.loadOutbox()).toBeNull();
  });

  it('a lost upload reply leaves the file pending; retrying stores it once', async () => {
    await signIn(A.url);
    await confirmBooking([{ uri: JPEG, type: 'image/jpeg', kind: 'photo' }]);
    m.diag.armFault('upload'); // the server stores the photo and drops the reply
    const r = await m.outbox.sendOutbox();
    expect(r.filesPending).toBe(1);
    expect((await m.outbox.loadOutbox())!.media[0]).toMatchObject({ state: 'pending', error: { code: 'NETWORK', permanent: false } });
    expect(await files(A, r.booking.ref)).toBe(1); // already stored on the server
    await m.outbox.sendOutbox();
    expect(await files(A, r.booking.ref)).toBe(1); // the retry returned the stored file
    expect(await m.outbox.loadOutbox()).toBeNull();
  });

  it('interrupted mid-send, then the app restarts: booking result is "uncertain", files resume, still one booking', async () => {
    await signIn(A.url);
    const before = await bookings(A);
    await confirmBooking([{ uri: JPEG, type: 'image/jpeg', kind: 'photo' }]);
    m.diag.armFault('booking');
    await expect(m.outbox.sendOutbox()).rejects.toBeTruthy();
    // Simulate the app being killed while the record said "sending" and a file said "uploading".
    const { store } = await import('./stubs/secure-store');
    const key = [...store.keys()].find((k) => k.startsWith('khidmat_outbox_') && store.get(k)!.includes(A.url))!;
    const raw = JSON.parse(store.get(key)!);
    raw.status = 'sending'; raw.media[0].state = 'uploading';
    store.set(key, JSON.stringify(raw));
    await launch();
    const o = (await m.outbox.loadOutbox())!;
    expect(o.status).toBe('uncertain');
    expect(o.media[0]!.state).toBe('pending');
    const r = await m.outbox.sendOutbox();
    expect(r).toMatchObject({ filesPending: 0, filesFailed: 0 });
    expect(await bookings(A)).toBe(before + 1);
    expect(await files(A, r.booking.ref)).toBe(1);
  });
});
