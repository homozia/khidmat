import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, freshApp, idem, login, newKey, pool, tomorrowAt, JOB, LOCALITY, type Client } from './helpers.ts';

const booking = (at = '10:00') => ({
  job_id: JOB('plumbing.toilet_flush'), timing: 'scheduled', scheduled_start: tomorrowAt(at),
  locality_id: LOCALITY.G10, address_line: 'House 12, Street 34, G-10/2', intake: {},
});

describe('auth: OTP sign-in, rate limits, sessions', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await freshApp(); });
  afterAll(async () => { await app.close(); });

  it('signs in with any common Pakistani number format and creates a customer', async () => {
    const anon = client(app);
    expect((await anon.post('/v1/auth/otp/request', { phone: '0333-555 1212' })).status).toBe(200);
    const v = await anon.post('/v1/auth/otp/verify', { phone: '+92 333 5551212', code: '123456' });
    expect(v.status).toBe(200);
    expect(v.body.roles).toEqual(['customer']);
    const me = await client(app, v.body.token).get('/v1/me');
    expect(me.body.roles).toEqual(['customer']);
    const out = await client(app, v.body.token).post('/v1/auth/logout');
    expect(out.status).toBe(204);
    expect((await client(app, v.body.token).get('/v1/me')).status).toBe(401);
  });

  it('rejects non-mobile numbers, wrong codes, and locks after 5 wrong tries', async () => {
    const anon = client(app);
    expect((await anon.post('/v1/auth/otp/request', { phone: '051 1234567' })).body.error.code).toBe('INVALID_PHONE');
    await anon.post('/v1/auth/otp/request', { phone: '03004445566' });
    for (let i = 0; i < 5; i++) expect((await anon.post('/v1/auth/otp/verify', { phone: '03004445566', code: '000000' })).status).toBe(401);
    const locked = await anon.post('/v1/auth/otp/verify', { phone: '03004445566', code: '123456' });
    expect(locked.body.error.code).toBe('OTP_LOCKED');
  });

  it('allows 3 codes per 15 minutes per phone', async () => {
    const anon = client(app);
    for (let i = 0; i < 3; i++) expect((await anon.post('/v1/auth/otp/request', { phone: '03007778899' })).status).toBe(200);
    const r = await anon.post('/v1/auth/otp/request', { phone: '03007778899' });
    expect(r.status).toBe(429);
  });
});

describe('idempotency: retries and interrupted requests never duplicate a booking', () => {
  let app: FastifyInstance;
  let cust: Client;
  beforeAll(async () => { app = await freshApp(); cust = await login(app, '+923001110001'); });
  afterAll(async () => { await app.close(); });
  const count = async () => (await pool.query(`SELECT count(*)::int AS n FROM app.bookings`)).rows[0].n as number;

  it('requires an Idempotency-Key on booking creation', async () => {
    expect((await cust.post('/v1/bookings', booking())).body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('a retried request (e.g. after a dropped connection) returns the same booking', async () => {
    const key = newKey('book');
    const a = await cust.post('/v1/bookings', booking(), idem(key));
    const b = await cust.post('/v1/bookings', booking(), idem(key));
    expect(a.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(await count()).toBe(1);
  });

  it('two identical requests in flight at once create one booking', async () => {
    const key = newKey('race');
    const results = await Promise.all([1, 2, 3].map(() => cust.post('/v1/bookings', booking('12:00'), idem(key))));
    const okIds = new Set(results.filter((r) => r.status === 201).map((r) => r.body.id));
    expect(okIds.size).toBe(1);
    expect(await count()).toBe(2);
  });

  it('reusing a key for a different request is refused', async () => {
    const key = newKey('reuse');
    await cust.post('/v1/bookings', booking('14:00'), idem(key));
    const r = await cust.post('/v1/bookings', booking('15:00'), idem(key));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('logs contain no private customer data', () => {
  it('phone numbers, addresses, coordinates and tokens never reach the log stream', async () => {
    let log = '';
    const stream = new Writable({ write(chunk, _enc, cb) { log += chunk.toString(); cb(); } });
    const app = await freshApp({ logStream: stream, logLevel: 'info' });
    const anon = client(app);
    await anon.post('/v1/auth/otp/request', { phone: '03001110001' });
    const v = await anon.post('/v1/auth/otp/verify', { phone: '03001110001', code: '123456' });
    const cust = client(app, v.body.token);
    await cust.post('/v1/bookings', { ...booking(), locality_id: undefined, location: { lat: 33.6762, lng: 73.0128, source: 'gps' } }, idem());
    await cust.get(`/v1/catalogue?lat=33.6762&lng=73.0128`);
    await cust.get('/v1/places?q=G-10');
    await app.close();
    expect(log.length).toBeGreaterThan(100); // the logger did run
    for (const secret of ['3001110001', 'Street 34', '33.6762', '73.0128', v.body.token, 'G-10/2']) {
      expect(log).not.toContain(secret);
    }
  });
});

describe('booking preview shows the price without creating a booking', () => {
  it('returns the price lines and leaves no booking behind', async () => {
    const app = await freshApp();
    const cust = await login(app, '+923001110001');
    const r = await cust.post('/v1/bookings/preview', { ...booking(), job_id: JOB('plumbing.tap_leak'), intake: { taps: 3 } });
    expect(r.status).toBe(200);
    expect(r.body.terms.total_paisa).toBe(800_00 + 2 * 400_00);
    expect(typeof r.body.price_token).toBe('string');
    expect(r.body.terms.price_lines.map((l: { amount_paisa: number }) => l.amount_paisa)).toEqual([800_00, 800_00]);
    expect((await pool.query('SELECT count(*)::int AS n FROM app.bookings')).rows[0].n).toBe(0);
    const bad = await cust.post('/v1/bookings/preview', { ...booking(), intake: { nope: 1 } });
    expect(bad.body.error.code).toBe('INVALID_INTAKE');
    const places = await client(app).get('/v1/places?q=satellite');
    expect(places.body[0]).toMatchObject({ code: 'RWP-SATELLITE-TOWN', lat: 33.638, lng: 73.07 });
    await app.close();
  });
});
