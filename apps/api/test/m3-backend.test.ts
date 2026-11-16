import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bookAndAssign, client, freshApp, idem, login, loginAll, pool, tomorrowAt, ids, JOB, LOCALITY, PROVIDER, ZONE, type Users } from './helpers.ts';
import { runJobsOnce } from '../src/services/jobs.ts';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const M4A = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(200, 2)]);
const FAKE = Buffer.concat([Buffer.from('<html><script>alert(1)</script>'), Buffer.alloc(50)]);

async function upload(app: FastifyInstance, token: string, url: string, body: Buffer, type: string) {
  const r = await app.inject({ method: 'POST', url, payload: body, headers: { authorization: `Bearer ${token}`, 'content-type': type } });
  return { status: r.statusCode, body: JSON.parse(r.body || 'null') };
}
const tokenOf = async (app: FastifyInstance, phone: string) => {
  const anon = client(app);
  await anon.post('/v1/auth/otp/request', { phone });
  return (await anon.post('/v1/auth/otp/verify', { phone, code: '123456' })).body.token as string;
};

describe('M3 - private uploads with signed links', () => {
  let app: FastifyInstance; let u: Users; let bookingId: string; let custTok: string; let otherTok: string;
  beforeAll(async () => {
    app = await freshApp(); u = await loginAll(app);
    custTok = await tokenOf(app, '+923001110001'); otherTok = await tokenOf(app, '+923001110002');
    bookingId = (await u.customerIsb.post('/v1/bookings', { job_id: JOB('plumbing.drain_block'), timing: 'scheduled',
      scheduled_start: tomorrowAt('10:00'), locality_id: LOCALITY.G10, address_line: 'House 1, G-10/1', intake: {} }, idem())).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('customer uploads up to 3 photos and one voice note; disguised files are refused', async () => {
    for (let i = 0; i < 3; i++) expect((await upload(app, custTok, `/v1/bookings/${bookingId}/attachments?kind=photo`, JPEG, 'image/jpeg')).status).toBe(201);
    expect((await upload(app, custTok, `/v1/bookings/${bookingId}/attachments?kind=photo`, JPEG, 'image/jpeg')).body.error.code).toBe('TOO_MANY_FILES');
    expect((await upload(app, custTok, `/v1/bookings/${bookingId}/attachments?kind=voice`, M4A, 'audio/m4a')).status).toBe(201);
    expect((await upload(app, custTok, `/v1/bookings/${bookingId}/attachments?kind=voice`, FAKE, 'image/jpeg')).body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('another customer cannot upload to, list or open the files', async () => {
    expect((await upload(app, otherTok, `/v1/bookings/${bookingId}/attachments?kind=photo`, JPEG, 'image/jpeg')).status).toBe(404);
    expect((await u.customerRwp.get(`/v1/bookings/${bookingId}/attachments`)).status).toBe(404);
    const list = await u.customerIsb.get(`/v1/bookings/${bookingId}/attachments`);
    expect((await u.customerRwp.get(`/v1/attachments/${list.body[0].id}/url`)).status).toBe(404);
    expect((await u.plumberIsb.get(`/v1/attachments/${list.body[0].id}/url`)).status).toBe(404); // not assigned yet
  });

  it('a signed link opens the file, and a tampered link does not', async () => {
    const list = await u.customerIsb.get(`/v1/bookings/${bookingId}/attachments`);
    const link = await u.customerIsb.get(`/v1/attachments/${list.body[0].id}/url`);
    const ok = await app.inject({ method: 'GET', url: link.body.url });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.from(ok.rawPayload).equals(JPEG)).toBe(true);
    const bad = await app.inject({ method: 'GET', url: link.body.url.replace(/s=[^&]+/, 's=AAAA') });
    expect(bad.statusCode).toBe(403);
    const otherKey = await app.inject({ method: 'GET', url: link.body.url.replace(/k=booking%2F[^&]+/, 'k=booking%2Fxxxxxxxxxxxxxxxxxxxxxxxx') });
    expect(otherKey.statusCode).toBe(403);
  });
});

describe('M3 - reviews, complaints and refunds', () => {
  let app: FastifyInstance; let u: Users; let bookingId: string;
  beforeAll(async () => {
    app = await freshApp(); u = await loginAll(app);
    bookingId = await bookAndAssign(u, 'customerIsb', 'plumberIsb', { job_id: JOB('plumbing.drain_block'), timing: 'scheduled',
      scheduled_start: tomorrowAt('10:00'), locality_id: LOCALITY.G10, address_line: 'House 1, G-10/1', intake: {} });
    for (const to of ['en_route', 'on_site', 'in_progress']) await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/status`, { to });
    await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/complete`, { cash_collected_paisa: 1200_00 }, idem());
  });
  afterAll(async () => { await app.close(); });

  it('customer reviews once; provider rating updates', async () => {
    expect((await u.customerIsb.post(`/v1/bookings/${bookingId}/review`, { rating: 4, comment: 'On time' })).status).toBe(200);
    expect((await u.customerIsb.post(`/v1/bookings/${bookingId}/review`, { rating: 5 })).body.error.code).toBe('ALREADY_REVIEWED');
    expect((await u.customerRwp.post(`/v1/bookings/${bookingId}/review`, { rating: 1 })).status).toBe(404);
    const p = await pool.query('SELECT rating_avg, review_count FROM app.providers WHERE id = $1', [PROVIDER('plumberIsb')]);
    expect(p.rows[0]).toEqual({ rating_avg: 4, review_count: 1 });
  });

  it('complaint -> under review -> refund resolution adjusts commission', async () => {
    const c = await u.customerIsb.post(`/v1/bookings/${bookingId}/complaints`, { category: 'quality', description: 'Drain blocked again next day' });
    expect(c.status).toBe(201);
    expect((await u.customerIsb.post(`/v1/bookings/${bookingId}/complaints`, { category: 'other', description: 'second one' })).body.error.code).toBe('COMPLAINT_OPEN');
    const list = await u.dispatcher.get('/v1/admin/complaints?status=open');
    expect(list.body.map((x: { id: string }) => x.id)).toEqual([c.body.id]);
    expect((await u.dispatcher.post(`/v1/admin/complaints/${c.body.id}/resolve`, { status: 'under_review' })).status).toBe(200);
    // A dispatcher cannot resolve with a refund; finance can.
    const disp = await u.dispatcher.post(`/v1/admin/complaints/${c.body.id}/resolve`, { status: 'resolved', resolution: 'refund', note: 'Partial refund', refund: { charge_type: 'labour', amount_paisa: 400_00 } });
    expect(disp.body.error.code).toBe('FINANCE_ROLE_REQUIRED');
    const fin = await u.finance.post(`/v1/admin/complaints/${c.body.id}/resolve`, { status: 'resolved', resolution: 'refund', note: 'Partial refund agreed', refund: { charge_type: 'labour', amount_paisa: 400_00 } });
    expect(fin.status).toBe(200);
    expect(fin.body.refund).toMatchObject({ fee_paisa: 64_00, fee_change_paisa: -32_00 });
    const b = await u.customerIsb.get(`/v1/bookings/${bookingId}`);
    expect(b.body.complaints[0]).toMatchObject({ status: 'resolved', resolution: 'refund' });
    expect(b.body.totals.refunded_paisa).toBe(400_00);
  });
});

describe('M3 - zones, prices and commission rules from the admin', () => {
  let app: FastifyInstance; let u: Users; let zoneId: string;
  const I8 = { lat: 33.6680, lng: 73.0750 }; // I-8, outside every seeded zone
  const square = (lat: number, lng: number, d = 0.008) => ({ type: 'Polygon', coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]] });
  beforeAll(async () => { app = await freshApp(); u = await loginAll(app); });
  afterAll(async () => { await app.close(); });

  it('a self-crossing boundary is refused', async () => {
    const bow = { type: 'Polygon', coordinates: [[[73.07, 33.66], [73.08, 33.67], [73.08, 33.66], [73.07, 33.67], [73.07, 33.66]]] };
    const r = await u.config.post('/v1/admin/zones', { code: 'ISB-BAD', name_en: 'Bad', name_ur: 'خراب', boundary: bow });
    expect(r.body.error.code).toBe('INVALID_BOUNDARY');
  });

  it('a new zone is a draft, cannot go live unverified, and serves customers once verified and active', async () => {
    const r = await u.config.post('/v1/admin/zones', { code: 'ISB-I8', name_en: 'Islamabad I-8', name_ur: 'اسلام آباد آئی ایٹ', city_code: 'ISB', boundary: square(I8.lat, I8.lng) });
    expect(r.status).toBe(201);
    zoneId = r.body.id;
    expect((await u.config.post(`/v1/admin/zones/${zoneId}/status`, { status: 'active' })).body.error.code).toBe('ZONE_NOT_VERIFIED');
    expect((await u.config.post(`/v1/admin/zones/${zoneId}/verify`, { note: 'Walked the boundary with the field team on 20 Nov' })).status).toBe(200);
    expect((await u.config.post(`/v1/admin/zones/${zoneId}/status`, { status: 'active' })).status).toBe(200);
    await u.config.put(`/v1/admin/jobs/${JOB('plumbing.drain_block')}/zones/${zoneId}`, { status: 'enabled' });
    const cov = await client(app).post('/v1/coverage/resolve', I8);
    expect(cov.body.zone.code).toBe('ISB-I8');
    const zones = await u.config.get('/v1/admin/zones');
    const z = zones.body.find((x: { code: string }) => x.code === 'ISB-I8');
    expect(z).toMatchObject({ status: 'active', is_demo: false, jobs: 1 });
    expect(z.boundary.type).toBe('MultiPolygon');
  });

  it('changing the boundary pauses the zone until it is verified again', async () => {
    await u.config.patch(`/v1/admin/zones/${zoneId}`, { boundary: square(I8.lat, I8.lng, 0.01) });
    expect((await client(app).post('/v1/coverage/resolve', I8)).body.status).toBe('outside');
  });

  it('a new price applies to new bookings only', async () => {
    const before = await u.customerIsb.post('/v1/bookings', { job_id: JOB('plumbing.toilet_flush'), timing: 'scheduled', scheduled_start: tomorrowAt('10:00'),
      locality_id: LOCALITY.G10, address_line: 'House 2, G-10/2', intake: {} }, idem());
    expect((await u.config.post('/v1/admin/pricing-rules', { job_id: JOB('plumbing.toilet_flush'), base_labour_paisa: 1300_00 })).status).toBe(201);
    const after = await u.customerIsb.post('/v1/bookings', { job_id: JOB('plumbing.toilet_flush'), timing: 'scheduled', scheduled_start: tomorrowAt('12:00'),
      locality_id: LOCALITY.G10, address_line: 'House 2, G-10/2', intake: {} }, idem());
    expect(after.body.totals.customer_total_paisa).toBe(1300_00);
    expect((await u.customerIsb.get(`/v1/bookings/${before.body.id}`)).body.totals.customer_total_paisa).toBe(1000_00);
  });

  it('a category commission override (6% for cleaning) applies to new cleaning bookings', async () => {
    expect((await u.finance.post('/v1/admin/commission-rules', { scope_category_id: ids.category('cleaning'), rate_bps: 600, reason: 'Launch promotion' })).status).toBe(201);
    const b = await u.customerIsb.post('/v1/bookings', { job_id: JOB('cleaning.kitchen'), timing: 'scheduled', scheduled_start: tomorrowAt('14:00'),
      locality_id: LOCALITY.G10, address_line: 'House 2, G-10/2', intake: {} }, idem());
    const snap = await pool.query('SELECT commission_rate_bps FROM app.bookings WHERE id = $1', [b.body.id]);
    expect(snap.rows[0].commission_rate_bps).toBe(600);
  });

  it('categories can be reordered and paused without an app release', async () => {
    const order = [ids.category('solar_ups'), ids.category('plumbing')];
    await u.config.post('/v1/admin/categories/reorder', { ids: order });
    await u.config.patch(`/v1/admin/categories/${ids.category('driver')}`, { status: 'paused' });
    const cat = await client(app).get('/v1/catalogue?lat=33.6762&lng=73.0128');
    const codes = cat.body.categories.map((c: { code: string }) => c.code);
    expect(codes.slice(0, 2)).toEqual(['solar_ups', 'plumbing']);
    expect(codes).not.toContain('driver');
  });
});

describe('M3 - provider onboarding and verification', () => {
  let app: FastifyInstance; let u: Users; let providerId: string;
  beforeAll(async () => { app = await freshApp(); u = await loginAll(app); });
  afterAll(async () => { await app.close(); });

  it('verification registers an applicant who uploads documents; the officer views them with a reason that is audited', async () => {
    const r = await u.verifier.post('/v1/admin/providers', { phone: '0312 3456789', full_name: 'Waqas Ahmed', display_name: 'Waqas',
      skills: ['locksmith'], zone_ids: [ZONE('ISB-G')], base: { lat: 33.68, lng: 73.02 } });
    expect(r.status).toBe(201);
    providerId = r.body.id;
    const tok = await tokenOf(app, '+923123456789');
    const doc = await upload(app, tok, '/v1/provider/documents?doc_type=police_certificate', JPEG, 'image/jpeg');
    expect(doc.status).toBe(201);
    expect((await u.dispatcher.post(`/v1/admin/documents/${doc.body.id}/url`, { reason: 'curious' })).status).toBe(403);
    const link = await u.verifier.post(`/v1/admin/documents/${doc.body.id}/url`, { reason: 'Checking police certificate' });
    expect((await app.inject({ method: 'GET', url: link.body.url })).statusCode).toBe(200);
    const audit = await pool.query(`SELECT reason FROM app.audit_log WHERE action = 'document.view' AND entity_id = $1`, [doc.body.id]);
    expect(audit.rows[0].reason).toBe('Checking police certificate');
  });

  it('a restricted skill needs an expiry date; once approved the applicant can be activated and receives lockout jobs', async () => {
    expect((await u.verifier.post(`/v1/admin/providers/${providerId}/skills/locksmith`, { decision: 'approved', check_note: 'Police certificate PC-1234 seen' })).body.error.code).toBe('EXPIRY_REQUIRED');
    const docs = await u.verifier.get(`/v1/admin/providers/${providerId}/documents`);
    const evidence = docs.body[0].id;
    expect((await u.verifier.post(`/v1/admin/providers/${providerId}/skills/locksmith`, { decision: 'approved', check_note: 'Police certificate PC-1234 seen', expires_at: '2027-11-30', evidence_document_id: evidence })).body.error.code).toBe('EVIDENCE_NOT_ACCEPTED');
    await u.verifier.post(`/v1/admin/documents/${evidence}/review`, { status: 'accepted', note: 'Certificate PC-1234 genuine' });
    expect((await u.verifier.post(`/v1/admin/providers/${providerId}/skills/locksmith`, { decision: 'approved', check_note: 'Police certificate PC-1234 seen', expires_at: '2027-11-30', evidence_document_id: evidence })).status).toBe(200);
    expect((await u.verifier.post(`/v1/admin/providers/${providerId}/status`, { status: 'approved', reason: 'Documents verified' })).status).toBe(200);
    const b = await u.customerIsb.post('/v1/bookings', { job_id: JOB('locksmith.lockout'), timing: 'scheduled', scheduled_start: tomorrowAt('10:00'),
      locality_id: LOCALITY.G10, address_line: 'House 3, G-10/3', intake: { occupant_confirmed: true } }, idem());
    const el = await u.dispatcher.get(`/v1/admin/bookings/${b.body.id}/eligible-providers`);
    expect(el.body.map((p: { provider_id: string }) => p.provider_id)).toContain(providerId); // alongside the seeded licensed locksmith
  });

  it('lockout intake requires the occupant confirmation', async () => {
    const r = await u.customerIsb.post('/v1/bookings', { job_id: JOB('locksmith.lockout'), timing: 'scheduled', scheduled_start: tomorrowAt('12:00'),
      locality_id: LOCALITY.G10, address_line: 'House 3, G-10/3', intake: { occupant_confirmed: false } }, idem());
    expect(r.body.error.details.occupant_confirmed).toBe('must be confirmed');
  });

  it('a provider who switches off availability, or is suspended, gets no offers', async () => {
    const b = await u.customerIsb.post('/v1/bookings', { job_id: JOB('plumbing.drain_block'), timing: 'scheduled', scheduled_start: tomorrowAt('15:00'),
      locality_id: LOCALITY.G10, address_line: 'House 3, G-10/3', intake: {} }, idem());
    const eligible = async () => (await u.dispatcher.get(`/v1/admin/bookings/${b.body.id}/eligible-providers`)).body.length;
    expect(await eligible()).toBe(1);
    await u.plumberIsb.put('/v1/provider/availability', { accepting_offers: false });
    expect(await eligible()).toBe(0);
    await u.plumberIsb.put('/v1/provider/availability', { accepting_offers: true });
    const offer = await u.dispatcher.post(`/v1/admin/bookings/${b.body.id}/offers`, { provider_id: PROVIDER('plumberIsb') });
    await u.verifier.post(`/v1/admin/providers/${PROVIDER('plumberIsb')}/status`, { status: 'suspended', reason: 'Complaint under investigation' });
    expect(await eligible()).toBe(0);
    const st = await pool.query('SELECT status FROM app.assignments WHERE id = $1', [offer.body.assignment_id]);
    expect(st.rows[0].status).toBe('withdrawn');
  });
});

describe('M3 - dispatch operations, background jobs, reports', () => {
  let app: FastifyInstance; let u: Users;
  beforeAll(async () => { app = await freshApp(); u = await loginAll(app); });
  afterAll(async () => { await app.close(); });

  it('unverifiable lockout: dispatcher adds a visit charge, provider closes with it', async () => {
    await pool.query(`UPDATE app.provider_skills SET status = 'approved', expires_at = '2027-12-31' WHERE provider_id = $1`, [PROVIDER('locksmithPending')]);
    const id = await bookAndAssign(u, 'customerIsb', 'locksmithPending', { job_id: JOB('locksmith.lockout'), timing: 'scheduled',
      scheduled_start: tomorrowAt('10:00'), locality_id: LOCALITY.F10, address_line: 'House 8, F-10/1', intake: { occupant_confirmed: true } });
    await u.locksmithPending.post(`/v1/provider/bookings/${id}/status`, { to: 'en_route' });
    expect((await u.dispatcher.post(`/v1/admin/bookings/${id}/visit-charge`, { reason: 'authorization_not_verified', note: 'ID could not be verified' })).body.error.code).toBe('NOT_ON_SITE');
    await u.locksmithPending.post(`/v1/provider/bookings/${id}/status`, { to: 'on_site' });
    expect((await u.dispatcher.post(`/v1/admin/bookings/${id}/visit-charge`, { reason: 'authorization_not_verified', note: 'No check recorded yet' })).body.error.code).toBe('CHECK_NOT_FAILED');
    await u.locksmithPending.post(`/v1/provider/bookings/${id}/authorization-check`, { verified: false, method: 'not_verifiable', note: 'No ID and no neighbour available' });
    expect((await u.dispatcher.post(`/v1/admin/bookings/${id}/visit-charge`, { reason: 'authorization_not_verified', note: 'ID could not be verified; did not open' })).status).toBe(200);
    const b = await u.customerIsb.get(`/v1/bookings/${id}`);
    expect(b.body.totals.customer_total_paisa).toBe(500_00); // the PKR 1,500 lockout price is set aside
    const done = await u.locksmithPending.post(`/v1/provider/bookings/${id}/complete`, { cash_collected_paisa: 500_00 }, idem());
    expect(done.body).toEqual({ total_paisa: 500_00, fee_paisa: 40_00 });
  });

  it('reassign takes a booking back from its provider before work starts', async () => {
    const id = await bookAndAssign(u, 'customerIsb', 'plumberIsb', { job_id: JOB('plumbing.drain_block'), timing: 'scheduled',
      scheduled_start: tomorrowAt('12:00'), locality_id: LOCALITY.G10, address_line: 'House 1, G-10/1', intake: {} });
    expect((await u.dispatcher.post(`/v1/admin/bookings/${id}/reassign`, { reason: 'Provider vehicle broke down' })).status).toBe(200);
    const b = await u.dispatcher.get(`/v1/bookings/${id}`);
    expect(b.body.status).toBe('requested');
    expect(b.body.provider).toBeNull();
    expect((await u.plumberIsb.get(`/v1/bookings/${id}`)).status).toBe(404);
    const tl = await u.dispatcher.get(`/v1/admin/bookings/${id}/timeline`);
    expect(tl.body.map((e: { event_type: string }) => e.event_type)).toEqual(['created', 'offered', 'accepted', 'reassigned']);
  });

  it('jobs expire stale offers, flag unassigned same-day bookings and auto-close after 72 h', async () => {
    const same = await u.customerIsb.post('/v1/bookings', { job_id: JOB('plumbing.toilet_flush'), timing: 'same_day',
      locality_id: LOCALITY.G10, address_line: 'House 5, G-10/2', intake: {} }, idem());
    const offer = await u.dispatcher.post(`/v1/admin/bookings/${same.body.id}/offers`, { provider_id: PROVIDER('plumberIsb') });
    await pool.query(`UPDATE app.assignments SET expires_at = now() - interval '1 minute' WHERE id = $1`, [offer.body.assignment_id]);
    await pool.query(`UPDATE app.bookings SET created_at = now() - interval '45 minutes' WHERE id = $1`, [same.body.id]);
    const done = await bookAndAssign(u, 'customerRwp', 'plumberRwp', { job_id: JOB('plumbing.drain_block'), timing: 'scheduled',
      scheduled_start: tomorrowAt('10:00'), locality_id: LOCALITY.SATELLITE, address_line: 'House 9, Satellite Town', intake: {} });
    for (const to of ['en_route', 'on_site', 'in_progress']) await u.plumberRwp.post(`/v1/provider/bookings/${done}/status`, { to });
    await u.plumberRwp.post(`/v1/provider/bookings/${done}/complete`, { cash_collected_paisa: 1200_00 }, idem());
    await pool.query(`UPDATE app.bookings SET completed_at = now() - interval '73 hours' WHERE id = $1`, [done]);

    const r = await runJobsOnce();
    expect(r).toMatchObject({ expiredOffers: 1, noProvider: 1, autoClosed: 1 });
    expect((await u.customerIsb.get(`/v1/bookings/${same.body.id}`)).body.status).toBe('no_provider');
    const closed = await pool.query('SELECT b.status, p.confirmed_by FROM app.bookings b JOIN app.payments p ON p.booking_id = b.id WHERE b.id = $1', [done]);
    expect(closed.rows[0]).toEqual({ status: 'closed', confirmed_by: 'auto' });
    expect(await runJobsOnce()).toMatchObject({ expiredOffers: 0, noProvider: 0, autoClosed: 0 });
  });

  it('summary report counts bookings, cash and commission for a date range', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
    const r = await u.finance.get(`/v1/admin/reports/summary?from=${today}&to=${today}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ no_provider: 1, cash_collected_paisa: 1700_00, commission_paisa: 136_00 }); // drain job 1,200 + lockout visit 500
    expect(r.body.by_category.find((c: { code: string }) => c.code === 'plumbing').bookings).toBeGreaterThanOrEqual(3);
    expect((await u.customerIsb.get(`/v1/admin/reports/summary?from=${today}&to=${today}`)).status).toBe(403);
  });

  it('finance can post a manual adjustment with a reason; it is audited', async () => {
    const r = await u.finance.post(`/v1/admin/providers/${PROVIDER('plumberRwp')}/adjustments`, { amount_paisa: -50_00, reason: 'Goodwill credit for late payment fix' });
    expect(r.status).toBe(201);
    const l = await u.finance.get(`/v1/admin/providers/${PROVIDER('plumberRwp')}/ledger`);
    expect(l.body.balance_paisa).toBe(96_00 - 50_00);
  });

  it('only a super admin can trigger jobs by hand', async () => {
    expect((await u.dispatcher.post('/v1/admin/jobs/run')).status).toBe(403);
    expect((await u.admin.post('/v1/admin/jobs/run')).status).toBe(200);
  });

  it('CORS allows the configured web origin only', async () => {
    const ok = await app.inject({ method: 'OPTIONS', url: '/v1/me', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' } });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await app.inject({ method: 'OPTIONS', url: '/v1/me', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    void login;
  });
});
