import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import S3rver from 's3rver';
import { bookAndAssign, client, freshApp, idem, ledgerOf, loginAll, newKey, pool, tomorrowAt, ids, JOB, LOCALITY, PROVIDER, ZONE, type Users } from './helpers.ts';
import { config } from '../src/config.ts';
import { resetSchema } from '../src/migrate.ts';
import { sendViaAggregator, usesSandbox } from '../src/services/sms.ts';
import { s3Driver } from '../src/services/storage.ts';

/* Regression tests for the M3 audit (see docs/milestones/m4-audit-closure.md). Each describe names its finding. */

const G10 = { lat: 33.6762, lng: 73.0128 };
const SATELLITE = { lat: 33.6380, lng: 73.0700 };
const raw = { 'x-test-raw': '1' };
const tapLeak = (at = '10:00', taps = 1) => ({ job_id: JOB('plumbing.tap_leak'), timing: 'scheduled', scheduled_start: tomorrowAt(at),
  locality_id: LOCALITY.G10, address_line: 'House 12, Street 34, G-10/2', intake: { taps } });
const withEnv = async <T>(env: Partial<typeof config>, fn: () => Promise<T>): Promise<T> => {
  const saved = { ...config };
  Object.assign(config, env);
  try { return await fn(); } finally { Object.assign(config, saved); }
};
const count = async () => (await pool.query('SELECT count(*)::int AS n FROM app.bookings')).rows[0].n as number;

describe('F1 duplicate bookings: one booking per submission in every retry scenario', () => {
  let app: FastifyInstance; let u: Users;
  beforeAll(async () => { app = await freshApp(); u = await loginAll(app); });
  afterAll(async () => { await app.close(); });

  it('request never reached the server, then retried: one booking', async () => {
    const prev = await u.customerIsb.post('/v1/bookings/preview', tapLeak('09:00'));
    const body = { ...tapLeak('09:00'), price_token: prev.body.price_token };
    const key = newKey('never-sent');
    // (nothing sent the first time)
    const r = await u.customerIsb.post('/v1/bookings', body, idem(key));
    expect(r.status).toBe(201);
    expect(await count()).toBe(1);
  });

  it('reply lost after the commit, retried with the same key: same booking, still one', async () => {
    const prev = await u.customerIsb.post('/v1/bookings/preview', tapLeak('11:00'));
    const body = { ...tapLeak('11:00'), price_token: prev.body.price_token };
    const key = newKey('lost-reply');
    const first = await u.customerIsb.post('/v1/bookings', body, idem(key)); // the phone never saw this reply
    const retry = await u.customerIsb.post('/v1/bookings', body, idem(key));
    expect(retry.body.ref).toBe(first.body.ref);
    expect(await count()).toBe(2);
  });

  it('double tap (two identical requests at once): one booking', async () => {
    const prev = await u.customerIsb.post('/v1/bookings/preview', tapLeak('12:00'));
    const body = { ...tapLeak('12:00'), price_token: prev.body.price_token };
    const key = newKey('double-tap');
    const rs = await Promise.all([1, 2].map(() => u.customerIsb.post('/v1/bookings', body, idem(key))));
    expect(new Set(rs.map((r) => r.body.ref)).size).toBe(1);
    expect(await count()).toBe(3);
  });

  it('app restarted before the retry (same saved key and payload, 20 minutes later): one booking', async () => {
    const prev = await u.customerIsb.post('/v1/bookings/preview', tapLeak('14:00'));
    const saved = JSON.stringify({ key: newKey('restart'), body: { ...tapLeak('14:00'), price_token: prev.body.price_token } });
    const first = JSON.parse(saved);
    await u.customerIsb.post('/v1/bookings', first.body, idem(first.key));
    const afterRestart = JSON.parse(saved);
    const again = await u.customerIsb.post('/v1/bookings', afterRestart.body, idem(afterRestart.key));
    expect(again.status).toBe(201);
    expect(await count()).toBe(4);
  });

  it('keys are scoped to the account: another account replaying the key gets nothing of the first booking', async () => {
    const prev = await u.customerIsb.post('/v1/bookings/preview', tapLeak('15:00'));
    const body = { ...tapLeak('15:00'), price_token: prev.body.price_token };
    const key = newKey('scoped');
    const mine = await u.customerIsb.post('/v1/bookings', body, idem(key));
    const theirs = await u.customerRwp.post('/v1/bookings', body, idem(key));
    expect(theirs.status).toBe(409); // the token belongs to the first customer
    expect(theirs.body.id).toBeUndefined();
    expect(mine.status).toBe(201);
  });
});

describe('F3 price consent: confirmation is bound to the server-issued terms', () => {
  let app: FastifyInstance; let u: Users;
  beforeAll(async () => { app = await freshApp(); u = await loginAll(app); });
  afterAll(async () => { await app.close(); });

  it('a booking without the price token is refused with the current terms to show', async () => {
    const r = await u.customerIsb.post('/v1/bookings', tapLeak(), { ...idem(), ...raw });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PRICE_CONFIRMATION_REQUIRED');
    expect(r.body.error.details.terms.total_paisa).toBe(800_00);
    expect(typeof r.body.error.details.price_token).toBe('string');
  });

  it('a price change between preview and confirm needs fresh approval; the new terms come back', async () => {
    const prev = await u.customerIsb.post('/v1/bookings/preview', tapLeak('10:00', 2));
    expect(prev.body.terms.total_paisa).toBe(1200_00);
    await u.config.post('/v1/admin/pricing-rules', { job_id: JOB('plumbing.tap_leak'), base_labour_paisa: 900_00, unit_labour_paisa: 400_00, unit_label: 'tap', unit_field_key: 'taps', included_units: 1 });
    const r = await u.customerIsb.post('/v1/bookings', { ...tapLeak('10:00', 2), price_token: prev.body.price_token }, idem());
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PRICE_CHANGED');
    expect(r.body.error.details.terms.total_paisa).toBe(1300_00);
    const ok = await u.customerIsb.post('/v1/bookings', { ...tapLeak('10:00', 2), price_token: r.body.error.details.price_token }, idem());
    expect(ok.status).toBe(201);
    expect(ok.body.totals.customer_total_paisa).toBe(1300_00);
  });

  it('a travel-charge change or a changed booking detail also needs fresh approval', async () => {
    const prev = await u.customerIsb.post('/v1/bookings/preview', tapLeak('12:00'));
    await pool.query('UPDATE app.service_zones SET travel_charge_paisa = 15000 WHERE id = $1', [ZONE('ISB-G')]);
    const r1 = await u.customerIsb.post('/v1/bookings', { ...tapLeak('12:00'), price_token: prev.body.price_token }, idem());
    expect(r1.body.error.code).toBe('PRICE_CHANGED');
    expect(r1.body.error.details.terms.price_lines.map((l: { charge_type: string }) => l.charge_type)).toContain('travel_charge');
    const r2 = await u.customerIsb.post('/v1/bookings', { ...tapLeak('12:00', 3), price_token: r1.body.error.details.price_token }, idem());
    expect(r2.body.error.code).toBe('PRICE_CHANGED'); // token was for 1 tap
    await pool.query('UPDATE app.service_zones SET travel_charge_paisa = 0 WHERE id = $1', [ZONE('ISB-G')]);
  });

  it('the accepted terms are kept on the booking', async () => {
    const b = await pool.query(`SELECT accepted_price_hash, terms_snapshot->'price_lines' AS lines FROM app.bookings ORDER BY created_at DESC LIMIT 1`);
    expect(b.rows[0].accepted_price_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.rows[0].lines[0].amount_paisa).toBe(900_00);
  });

  it('in production, demo prices are never used, even in a zone where the job is enabled', async () => {
    await withEnv({ APP_ENV: 'production' }, async () => {
      await pool.query(`UPDATE app.service_zones SET is_demo = false WHERE id = $1`, [ZONE('RWP-ST')]);
      const r = await u.customerRwp.post('/v1/bookings/preview', { job_id: JOB('plumbing.drain_block'), timing: 'scheduled', scheduled_start: tomorrowAt('10:00'),
        location: { ...SATELLITE, source: 'gps' }, address_line: 'House 21, Block C, Satellite Town', intake: {} });
      expect(r.body.error.code).toBe('NO_PRICE');
    });
  });
});

describe('F4/F5 commission and cash: PKR 1,200 labour + PKR 450 materials = PKR 96 once; refunds and cash states are explicit', () => {
  let app: FastifyInstance; let u: Users; let id: string;
  beforeAll(async () => {
    app = await freshApp(); u = await loginAll(app);
    id = await bookAndAssign(u, 'customerIsb', 'plumberIsb', tapLeak('10:00', 2));
    for (const to of ['en_route', 'on_site']) await u.plumberIsb.post(`/v1/provider/bookings/${id}/status`, { to });
    const q = await u.plumberIsb.post(`/v1/provider/bookings/${id}/quotes`, { kind: 'change_order', lines: [{ charge_type: 'materials', description: 'Washers and connector', quantity: 1, unit_price_paisa: 450_00 }] }, idem());
    await u.customerIsb.post(`/v1/quotes/${q.body.quote_id}/approve`);
    await u.plumberIsb.post(`/v1/provider/bookings/${id}/status`, { to: 'in_progress' });
  });
  afterAll(async () => { await app.close(); });

  it('completion posts one PKR 96 fee even when the request is repeated', async () => {
    const key = newKey('c');
    const a = await u.plumberIsb.post(`/v1/provider/bookings/${id}/complete`, { cash_collected_paisa: 1650_00 }, idem(key));
    const b = await u.plumberIsb.post(`/v1/provider/bookings/${id}/complete`, { cash_collected_paisa: 1650_00 }, idem(key));
    expect(a.body).toEqual({ total_paisa: 1650_00, fee_paisa: 96_00 });
    expect(b.body).toEqual(a.body);
    expect((await ledgerOf('plumberIsb')).filter((e) => e.booking_id === id)).toEqual([{ entry_type: 'commission_charge', amount_paisa: 96_00, booking_id: id }]);
  });

  it('the provider sees gross, chargeable, excluded, fee and net', async () => {
    const r = await u.plumberIsb.get(`/v1/bookings/${id}/receipt`);
    expect(r.body.provider).toEqual({ commission_rate_bps: 800, gross_paisa: 1650_00, commissionable_paisa: 1200_00, excluded_paisa: 450_00, fee_paisa: 96_00, net_earnings_paisa: 1554_00 });
  });

  it('cash states: provider-reported until the customer confirms', async () => {
    expect((await u.customerIsb.get(`/v1/bookings/${id}/receipt`)).body).toMatchObject({ payment_status: 'provider_reported', outstanding: ['Customer to confirm the cash payment'] });
    await u.customerIsb.post(`/v1/bookings/${id}/confirm-payment`);
    expect((await u.customerIsb.get(`/v1/bookings/${id}/receipt`)).body).toMatchObject({ payment_status: 'customer_confirmed', outstanding: [] });
  });

  it('partial refunds: labour lowers the fee, materials do not; a refund is owed until paid with a reference', async () => {
    const l = await u.finance.post(`/v1/admin/bookings/${id}/refunds`, { charge_type: 'labour', amount_paisa: 200_00, reason: 'One tap still drips' }, idem());
    expect(l.body).toMatchObject({ fee_paisa: 80_00, fee_change_paisa: -16_00 });
    const m = await u.finance.post(`/v1/admin/bookings/${id}/refunds`, { charge_type: 'materials', amount_paisa: 100_00, reason: 'Connector returned' }, idem());
    expect(m.body.fee_change_paisa).toBe(0);
    const rec = await u.customerIsb.get(`/v1/bookings/${id}/receipt`);
    expect(rec.body.refund_owed_paisa).toBe(300_00);
    expect(rec.body.outstanding).toEqual(['Refund of PKR 300 to be paid to the customer']);
    expect((await u.finance.post(`/v1/admin/refunds/${l.body.refund_id}/paid`, { method: 'jazzcash', reference: '' })).status).toBe(400);
    expect((await u.finance.post(`/v1/admin/refunds/${l.body.refund_id}/paid`, { method: 'jazzcash', reference: 'JC-55120' })).status).toBe(200);
    expect((await u.finance.post(`/v1/admin/refunds/${l.body.refund_id}/paid`, { method: 'jazzcash', reference: 'JC-55120' })).body.error.code).toBe('REFUND_ALREADY_PAID');
    expect((await u.customerIsb.get(`/v1/bookings/${id}/receipt`)).body.refund_owed_paisa).toBe(100_00);
    const audit = await pool.query(`SELECT action FROM app.audit_log WHERE action LIKE 'refund.%' ORDER BY id`);
    expect(audit.rows.map((r) => r.action)).toEqual(['refund.create', 'refund.create', 'refund.paid']);
  });
});

describe('F6/F7 dispatch: real service windows, re-checks at acceptance, serialised acceptances', () => {
  let app: FastifyInstance; let u: Users;
  const drive = (at: string, hours: number) => ({ job_id: JOB('driver.hourly'), timing: 'scheduled', scheduled_start: tomorrowAt(at),
    location: { ...SATELLITE, source: 'gps' }, address_line: 'House 21, Block C, Satellite Town',
    destination: { ...G10, text: 'G-10 Markaz' }, intake: { hours } });
  beforeAll(async () => { app = await freshApp(); u = await loginAll(app); });
  afterAll(async () => { await app.close(); });

  it('an 8-hour driver booking blocks the driver for 8 hours, not the 90-minute job default', async () => {
    const long = await bookAndAssign(u, 'customerRwp', 'driver', drive('09:00', 8));
    expect((await pool.query('SELECT duration_minutes FROM app.bookings WHERE id = $1', [long])).rows[0].duration_minutes).toBe(480);
    const later = await u.customerRwp.post('/v1/bookings', drive('13:00', 2), idem());
    expect((await u.dispatcher.get(`/v1/admin/bookings/${later.body.id}/eligible-providers`)).body).toEqual([]);
    const off = await u.dispatcher.post(`/v1/admin/bookings/${later.body.id}/offers`, { provider_id: PROVIDER('driver') });
    expect(off.body.error.message).toBe('The provider already has a job at this time.');
  });

  it('one provider accepting two overlapping offers: only the first is assigned', async () => {
    const a = await u.customerIsb.post('/v1/bookings', tapLeak('16:00'), idem());
    const b = await u.customerIsb.post('/v1/bookings', { ...tapLeak('16:30'), address_line: 'House 2, Street 5, G-10/3' }, idem());
    const oa = await u.dispatcher.post(`/v1/admin/bookings/${a.body.id}/offers`, { provider_id: PROVIDER('plumberIsb') });
    const ob = await u.dispatcher.post(`/v1/admin/bookings/${b.body.id}/offers`, { provider_id: PROVIDER('plumberIsb') });
    const [ra, rb] = await Promise.all([
      u.plumberIsb.post(`/v1/provider/offers/${oa.body.assignment_id}/accept`),
      u.plumberIsb.post(`/v1/provider/offers/${ob.body.assignment_id}/accept`),
    ]);
    const outcomes = [ra.body.status, rb.body.status].sort();
    expect(outcomes).toEqual(['accepted', 'withdrawn']);
    expect([ra.body.reason, rb.body.reason].filter(Boolean)).toEqual(['The provider already has a job at this time.']);
    const assigned = await pool.query(`SELECT count(*)::int AS n FROM app.bookings WHERE assigned_provider_id = $1 AND status = 'assigned' AND id = ANY($2)`,
      [PROVIDER('plumberIsb'), [a.body.id, b.body.id]]);
    expect(assigned.rows[0].n).toBe(1);
  });

  it('licence expiry, suspension or switching off availability after the offer: acceptance is refused with the reason', async () => {
    const mk = async (at: string) => {
      const b = await u.customerRwp.post('/v1/bookings', { job_id: JOB('plumbing.drain_block'), timing: 'scheduled', scheduled_start: tomorrowAt(at),
        locality_id: LOCALITY.SATELLITE, address_line: 'House 9, Satellite Town', intake: {} }, idem());
      return (await u.dispatcher.post(`/v1/admin/bookings/${b.body.id}/offers`, { provider_id: PROVIDER('plumberRwp') })).body.assignment_id as string;
    };
    const o1 = await mk('09:00');
    await pool.query(`UPDATE app.provider_skills SET expires_at = now() WHERE provider_id = $1`, [PROVIDER('plumberRwp')]);
    expect((await u.plumberRwp.post(`/v1/provider/offers/${o1}/accept`)).body).toEqual({ status: 'withdrawn', reason: 'The provider\'s licence or certificate expires before this booking.' });
    await pool.query(`UPDATE app.provider_skills SET expires_at = '2027-12-31' WHERE provider_id = $1`, [PROVIDER('plumberRwp')]);

    const o2 = await mk('11:00');
    await u.plumberRwp.put('/v1/provider/availability', { accepting_offers: false });
    expect((await u.plumberRwp.post(`/v1/provider/offers/${o2}/accept`)).body.reason).toBe('The provider has switched off "Accepting jobs".');
    await u.plumberRwp.put('/v1/provider/availability', { accepting_offers: true });

    const o3 = await mk('13:00');
    await pool.query(`UPDATE app.providers SET status = 'suspended' WHERE id = $1`, [PROVIDER('plumberRwp')]);
    expect((await u.plumberRwp.post(`/v1/provider/offers/${o3}/accept`)).body.reason).toBe('The provider is not approved or is suspended.');
    await pool.query(`UPDATE app.providers SET status = 'approved' WHERE id = $1`, [PROVIDER('plumberRwp')]);

    const o4 = await mk('15:00');
    await pool.query(`UPDATE app.assignments SET expires_at = now() - interval '1 minute' WHERE id = $1`, [o4]);
    expect((await u.plumberRwp.post(`/v1/provider/offers/${o4}/accept`)).body.status).toBe('expired');
  });
});

describe('F8 restricted skills and lockouts', () => {
  let app: FastifyInstance; let u: Users;
  const lockout = (at: string) => ({ job_id: JOB('locksmith.lockout'), timing: 'scheduled', scheduled_start: tomorrowAt(at),
    locality_id: LOCALITY.F10, address_line: 'House 8, F-10/1', intake: { occupant_confirmed: true } });
  beforeAll(async () => {
    app = await freshApp(); u = await loginAll(app);
    await pool.query(`UPDATE app.provider_skills SET status = 'approved', expires_at = '2027-12-31' WHERE provider_id = $1`, [PROVIDER('locksmithPending')]);
  });
  afterAll(async () => { await app.close(); });

  it('the lockout visit charge is disclosed in the terms the customer approves', async () => {
    const p = await u.customerIsb.post('/v1/bookings/preview', lockout('10:00'));
    expect(p.body.terms.visit_charge_paisa).toBe(500_00);
  });

  it('verified lockout: work can start only after the check is recorded', async () => {
    const id = await bookAndAssign(u, 'customerIsb', 'locksmithPending', lockout('10:00'));
    for (const to of ['en_route', 'on_site']) await u.locksmithPending.post(`/v1/provider/bookings/${id}/status`, { to });
    expect((await u.locksmithPending.post(`/v1/provider/bookings/${id}/status`, { to: 'in_progress' })).body.error.code).toBe('AUTHORIZATION_CHECK_REQUIRED');
    expect((await u.locksmithPending.post(`/v1/provider/bookings/${id}/authorization-check`, { verified: true, method: 'not_verifiable', note: 'x x' })).status).toBe(400);
    expect((await u.locksmithPending.post(`/v1/provider/bookings/${id}/authorization-check`, { verified: true, method: 'photo_id_matches_address', note: 'CNIC address matches house 8' })).status).toBe(200);
    expect((await u.locksmithPending.post(`/v1/provider/bookings/${id}/status`, { to: 'in_progress' })).status).toBe(200);
  });

  it('unverifiable lockout: the provider cannot start; the visit charge is the disclosed PKR 500 with a defined reason', async () => {
    const id = await bookAndAssign(u, 'customerIsb', 'locksmithPending', lockout('15:00'));
    for (const to of ['en_route', 'on_site']) await u.locksmithPending.post(`/v1/provider/bookings/${id}/status`, { to });
    await u.locksmithPending.post(`/v1/provider/bookings/${id}/authorization-check`, { verified: false, method: 'not_verifiable', note: 'No ID; neighbours did not know the occupant' });
    expect((await u.locksmithPending.post(`/v1/provider/bookings/${id}/status`, { to: 'in_progress' })).body.error.code).toBe('AUTHORIZATION_NOT_VERIFIED');
    expect((await u.dispatcher.post(`/v1/admin/bookings/${id}/visit-charge`, { reason: 'lost_keys', note: 'not a defined reason' })).status).toBe(400);
    expect((await u.dispatcher.post(`/v1/admin/bookings/${id}/visit-charge`, { reason: 'authorization_not_verified', note: 'Called the customer; agreed' })).status).toBe(200);
    expect((await u.customerIsb.get(`/v1/bookings/${id}`)).body.totals.customer_total_paisa).toBe(500_00);
    const audit = await pool.query(`SELECT reason FROM app.audit_log WHERE action = 'booking.visit_charge' AND entity_id = $1`, [id]);
    expect(audit.rows[0].reason).toContain('authorization not verified');
  });

  it('a job booked without visit-charge terms cannot be given one', async () => {
    const id = await bookAndAssign(u, 'customerIsb', 'plumberIsb', tapLeak('17:00'));
    for (const to of ['en_route', 'on_site']) await u.plumberIsb.post(`/v1/provider/bookings/${id}/status`, { to });
    expect((await u.dispatcher.post(`/v1/admin/bookings/${id}/visit-charge`, { reason: 'customer_absent', note: 'Nobody home after 20 min' })).body.error.code).toBe('NO_VISIT_CHARGE_TERMS');
  });

  it('a restricted skill cannot be approved with an expired licence', async () => {
    const r = await u.verifier.post(`/v1/admin/providers/${PROVIDER('electricianPending')}/skills/electrical`, { decision: 'approved', check_note: 'checked', expires_at: '2026-01-01', evidence_document_id: ids.user('x' as never) });
    expect(r.body.error.code).toBe('EXPIRED_EVIDENCE');
  });
});

describe('F9/F10 location and service configuration without an app release', () => {
  let app: FastifyInstance; let u: Users;
  beforeAll(async () => { app = await freshApp(); u = await loginAll(app); });
  afterAll(async () => { await app.close(); });

  it('a point exactly on the shared edge of two zones is covered, by the same zone every time', async () => {
    const sq = (x0: number, x1: number) => ({ type: 'Polygon', coordinates: [[[x0, 33.70], [x1, 33.70], [x1, 33.71], [x0, 33.71], [x0, 33.70]]] });
    for (const [code, box] of [['EDGE-A', sq(73.10, 73.11)], ['EDGE-B', sq(73.11, 73.12)]] as const) {
      const z = await u.config.post('/v1/admin/zones', { code, name_en: code, name_ur: code, boundary: box });
      await u.config.post(`/v1/admin/zones/${z.body.id}/verify`, { note: 'synthetic test zone' });
      await u.config.post(`/v1/admin/zones/${z.body.id}/status`, { status: 'active' });
    }
    const runs = await Promise.all([1, 2, 3].map(() => client(app).post('/v1/coverage/resolve', { lat: 33.705, lng: 73.11 })));
    expect(runs.map((r) => r.body.status)).toEqual(['covered', 'covered', 'covered']);
    expect(new Set(runs.map((r) => r.body.zone.code)).size).toBe(1);
  });

  it('staff add a third, synthetic district with a city, a locality, Urdu and Roman Urdu names, a zone and a service', async () => {
    const regions = (await u.config.get('/v1/admin/regions')).body as { id: string; code: string }[];
    const punjab = regions.find((r) => r.code === 'PB')!.id;
    const district = await u.config.post('/v1/admin/regions', { parent_id: punjab, level: 'district', code: 'PB-DEMO-TXL', name_en: 'Demo Taxila District', name_ur: 'ڈیمو ٹیکسلا ضلع', is_demo: true });
    expect(district.status).toBe(201);
    const city = await u.config.post('/v1/admin/regions', { parent_id: district.body.id, level: 'city', code: 'DEMO-TXL', name_en: 'Demo Taxila', name_ur: 'ڈیمو ٹیکسلا', is_demo: true });
    const box = { type: 'Polygon', coordinates: [[[72.80, 33.74], [72.82, 33.74], [72.82, 33.76], [72.80, 33.76], [72.80, 33.74]]] };
    const loc = await u.config.post('/v1/admin/regions', { parent_id: city.body.id, level: 'locality', code: 'DEMO-TXL-CANTT', name_en: 'Demo Cantt', name_ur: 'ڈیمو کینٹ',
      boundary: box, aliases: [{ alias: 'demo kaint', lang: 'roman' }], is_demo: true });
    expect(loc.status).toBe(201);
    expect((await u.config.post('/v1/admin/regions', { parent_id: punjab, level: 'locality', code: 'BAD-1', name_en: 'Bad', name_ur: 'خراب', centre: { lat: 33.7, lng: 72.8 } })).body.error.code).toBe('BAD_PARENT');

    const zone = await u.config.post('/v1/admin/zones', { code: 'DEMO-TXL-Z', name_en: 'Demo Taxila', name_ur: 'ڈیمو ٹیکسلا', city_region_id: city.body.id, boundary: box });
    await u.config.post(`/v1/admin/zones/${zone.body.id}/verify`, { note: 'synthetic test zone' });
    await u.config.post(`/v1/admin/zones/${zone.body.id}/status`, { status: 'active' });
    await u.config.put(`/v1/admin/jobs/${JOB('plumbing.drain_block')}/zones/${zone.body.id}`, { status: 'enabled' });

    for (const q of ['demo kaint', 'ڈیمو کینٹ', 'Demo Cantt']) {
      expect((await client(app).get(`/v1/places?q=${encodeURIComponent(q)}`)).body.map((p: { code: string }) => p.code)).toContain('DEMO-TXL-CANTT');
    }
    const cat = await client(app).get(`/v1/catalogue?locality_id=${loc.body.id}`);
    expect(cat.body.zone.code).toBe('DEMO-TXL-Z');
    const b = await u.customerIsb.post('/v1/bookings', { job_id: JOB('plumbing.drain_block'), timing: 'scheduled', scheduled_start: tomorrowAt('10:00'),
      locality_id: loc.body.id, address_line: 'House 1, Demo Cantt', intake: {} }, idem());
    expect(b.status).toBe(201);
    const zd = await pool.query(`SELECT r.code FROM app.service_zones z JOIN app.regions r ON r.id = z.district_region_id WHERE z.code = 'DEMO-TXL-Z'`);
    expect(zd.rows[0].code).toBe('PB-DEMO-TXL');
  });

  it('a new solar/UPS service with a choice field is added in one zone; the app gets its fields from the API', async () => {
    const job = await u.config.post('/v1/admin/jobs', { category_id: ids.category('solar_ups'), code: 'solar.net_meter_check', name_en: 'Net-metering check', name_ur: 'نیٹ میٹرنگ کی جانچ',
      booking_modes: ['inspection'], required_skill: 'solar_ups', price: { inspection_fee_paisa: 1200_00 } });
    await u.config.put(`/v1/admin/jobs/${job.body.id}/fields`, { key: 'system_size', field_type: 'select', label_en: 'System size', label_ur: 'سسٹم کا سائز', required: true,
      options: [{ value: '3kw', label_en: 'Up to 3 kW', label_ur: '3 کلو واٹ تک' }, { value: '10kw', label_en: '3 to 10 kW', label_ur: '3 سے 10 کلو واٹ' }] });
    expect((await u.config.put(`/v1/admin/jobs/${job.body.id}/fields`, { key: 'bad', field_type: 'select', label_en: 'Bad', label_ur: 'خراب', options: [{ value: 'a', label_en: 'A', label_ur: 'ا' }] })).status).toBe(400);
    await u.config.put(`/v1/admin/jobs/${job.body.id}/zones/${ZONE('RWP-CS3')}`, { status: 'enabled' });
    await u.config.post(`/v1/admin/jobs/${job.body.id}/status`, { status: 'active' });

    const find = async (loc: string) => (await client(app).get(`/v1/catalogue?locality_id=${loc}`)).body.categories
      .find((c: { code: string }) => c.code === 'solar_ups')?.jobs.find((j: { code: string }) => j.code === 'solar.net_meter_check');
    const meta = await find(LOCALITY.CHAKLALA);
    expect(meta.fields[0]).toMatchObject({ key: 'system_size', type: 'select', options: [{ value: '3kw' }, { value: '10kw' }] });
    expect(await find(LOCALITY.SATELLITE)).toBeUndefined();
    const base = { job_id: job.body.id, timing: 'scheduled', scheduled_start: tomorrowAt('10:00'), locality_id: LOCALITY.CHAKLALA, address_line: 'House 3, Chaklala Scheme III' };
    expect((await u.customerRwp.post('/v1/bookings/preview', { ...base, intake: { system_size: '50kw' } })).body.error.details.system_size).toBe('not an allowed option');
    expect((await u.customerRwp.post('/v1/bookings', { ...base, intake: { system_size: '10kw' } }, idem())).status).toBe(201);
  });

  it('service settings (destination needed, visit charge, booking modes) are editable and reach the app', async () => {
    await u.config.patch(`/v1/admin/jobs/${JOB('handyman.mirror')}/settings`, { requires_authorization_check: false, visit_charge_paisa: 300_00, booking_modes: ['fixed', 'quote'] });
    const j = (await client(app).get(`/v1/catalogue?locality_id=${LOCALITY.G10}`)).body.categories.find((c: { code: string }) => c.code === 'handyman')
      .jobs.find((x: { code: string }) => x.code === 'handyman.mirror');
    expect(j).toMatchObject({ booking_modes: ['fixed', 'quote'], visit_charge_paisa: 300_00, needs_destination: false });
    const driver = (await client(app).get(`/v1/catalogue?locality_id=${LOCALITY.SATELLITE}`)).body.categories.find((c: { code: string }) => c.code === 'driver').jobs[0];
    expect(driver.needs_destination).toBe(true);
  });
});

describe('F12-F14 environments, adapters and support details', () => {
  it('reset refuses any database not named *_dev, *_test or *_sandbox', async () => {
    const fake = { query: async () => ({ rows: [{ db: 'khidmat_prod' }] }) } as never;
    await expect(resetSchema(fake, 'test')).rejects.toThrow(/only databases named/);
  });

  it('sandbox codes: never in production; on staging only for listed numbers', async () => {
    await withEnv({ APP_ENV: 'production', SMS_PROVIDER: 'aggregator', SANDBOX_OTP_ALLOWLIST: '+923001110001' }, async () => expect(usesSandbox('+923001110001')).toBe(false));
    await withEnv({ APP_ENV: 'staging', SMS_PROVIDER: 'sandbox', SANDBOX_OTP_ALLOWLIST: '+923001110001' }, async () => {
      expect(usesSandbox('+923001110001')).toBe(true);
      expect(usesSandbox('+923339998888')).toBe(false);
    });
  });

  it('live SMS adapter: success, rejected credentials and an unreachable service give clear errors', async () => {
    const cfg = { url: 'https://sms.example.test/send', key: 'k', sender: 'KHIDMAT', timeoutMs: 500, appName: 'Khidmat' };
    let sent: Record<string, unknown> = {};
    await sendViaAggregator(cfg, '+923001110001', '482913', (async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response('{}', { status: 200 }); }) as never);
    expect(sent).toEqual({ to: '+923001110001', from: 'KHIDMAT', text: '482913 is your Khidmat code. It expires in 5 minutes. Never share it.' });
    await expect(sendViaAggregator(cfg, '+923001110001', '1', (async () => new Response('', { status: 401 })) as never)).rejects.toMatchObject({ code: 'SMS_AUTH_FAILED' });
    await expect(sendViaAggregator(cfg, '+923001110001', '1', (async () => { throw new TypeError('fetch failed'); }) as never)).rejects.toMatchObject({ code: 'SMS_UNAVAILABLE' });
    await expect(sendViaAggregator({ ...cfg, key: '' }, '+923001110001', '1')).rejects.toMatchObject({ code: 'SMS_NOT_CONFIGURED' });
  });

  it('private S3 storage: upload, signed download, expiry-limited link, delete, bad credentials and outage', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 's3rver-'));
    const server = new S3rver({ port: 0, address: '127.0.0.1', silent: true, directory: dir, configureBuckets: [{ name: 'khidmat-private', configs: [] }] });
    const { port } = await server.run() as unknown as { port: number };
    const endpoint = `http://127.0.0.1:${port}`;
    const d = s3Driver({ endpoint, region: 'us-east-1', bucket: 'khidmat-private', accessKeyId: 'S3RVER', secretAccessKey: 'S3RVER' });
    const body = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    await d.put('booking/abcdefghijklmnopqrstuvwxyz', body, 'image/jpeg');
    expect((await d.get('booking/abcdefghijklmnopqrstuvwxyz')).equals(body)).toBe(true);
    const link = await d.url('booking/abcdefghijklmnopqrstuvwxyz', 'image/jpeg');
    expect(link.url).toContain('X-Amz-Expires=300');
    const dl = await fetch(link.url);
    expect(dl.status).toBe(200);
    expect(Buffer.from(await dl.arrayBuffer()).equals(body)).toBe(true);
    // Bucket privacy (no anonymous GET) is a bucket-policy setting on the real provider; the emulator does not enforce it.
    // It is on the owner checklist in docs/operations/storage-and-sms.md.
    await d.remove('booking/abcdefghijklmnopqrstuvwxyz');
    await expect(d.get('booking/abcdefghijklmnopqrstuvwxyz')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const bad = s3Driver({ endpoint, region: 'us-east-1', bucket: 'khidmat-private', accessKeyId: 'WRONG', secretAccessKey: 'WRONG' });
    await expect(bad.put('booking/abcdefghijklmnopqrstuvwxyz', body, 'image/jpeg')).rejects.toMatchObject({ code: 'STORAGE_AUTH_FAILED' });
    await server.close();
    await expect(d.get('booking/abcdefghijklmnopqrstuvwxyz')).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });

  it('every response carries a request id that also appears in error bodies', async () => {
    const app = await freshApp();
    const r = await app.inject({ method: 'GET', url: '/v1/bookings/00000000-0000-4000-8000-000000000000', headers: {} });
    expect(r.headers['x-request-id']).toMatch(/^req-/);
    const anon = await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone: '051' } });
    expect(JSON.parse(anon.body).error.request_id).toBe(anon.headers['x-request-id']);
    await app.close();
  });
});
