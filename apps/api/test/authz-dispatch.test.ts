import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bookAndAssign, client, freshApp, idem, login, loginAll, pool, tomorrowAt, ids, JOB, LOCALITY, PROVIDER, ZONE, type Users } from './helpers.ts';

/** Acceptance check 6 plus dispatch guards: skills, zones, races, and who can read what. */
describe('AC6 - restricted jobs and data isolation', () => {
  let app: FastifyInstance;
  let u: Users;
  let bookingId: string;

  beforeAll(async () => {
    app = await freshApp();
    u = await loginAll(app);
    bookingId = await bookAndAssign(u, 'customerIsb', 'plumberIsb', {
      job_id: JOB('plumbing.drain_block'), timing: 'scheduled', scheduled_start: tomorrowAt('10:00'),
      locality_id: LOCALITY.G10, address_line: 'House 77, Street 8, G-10/4', intake: {},
    });
  });
  afterAll(async () => { await app.close(); });

  it('an electrician whose skill is still pending gets no electrical job', async () => {
    const r = await u.customerIsb.post('/v1/bookings', {
      job_id: JOB('electrical.switch_socket'), timing: 'scheduled', scheduled_start: tomorrowAt('11:00'),
      locality_id: LOCALITY.G10, address_line: 'House 77, Street 8, G-10/4', intake: { items: 2 },
    }, idem());
    expect(r.status).toBe(201);
    expect((await u.dispatcher.get(`/v1/admin/bookings/${r.body.id}/eligible-providers`)).body).toEqual([]);
    const offer = await u.dispatcher.post(`/v1/admin/bookings/${r.body.id}/offers`, { provider_id: PROVIDER('electricianPending') });
    expect(offer.status).toBe(422);
    expect(offer.body.error.code).toBe('PROVIDER_NOT_ELIGIBLE');

    // After verification approves the skill, the same provider becomes eligible.
    await pool.query(`UPDATE app.provider_skills SET status = 'approved', expires_at = '2027-12-31' WHERE provider_id = $1`, [PROVIDER('electricianPending')]);
    const el = await u.dispatcher.get(`/v1/admin/bookings/${r.body.id}/eligible-providers`);
    expect(el.body.map((p: { provider_id: string }) => p.provider_id)).toEqual([PROVIDER('electricianPending')]);
  });

  it('an expired skill or a provider outside the zone is not eligible', async () => {
    await pool.query(`UPDATE app.provider_skills SET expires_at = '2026-01-01' WHERE provider_id = $1`, [PROVIDER('plumberRwp')]);
    const r = await u.customerRwp.post('/v1/bookings', {
      job_id: JOB('plumbing.drain_block'), timing: 'scheduled', scheduled_start: tomorrowAt('10:00'),
      locality_id: LOCALITY.CHAKLALA, address_line: 'House 3, Lane 5, Chaklala Scheme III', intake: {},
    }, idem());
    expect((await u.dispatcher.get(`/v1/admin/bookings/${r.body.id}/eligible-providers`)).body).toEqual([]);
    expect((await u.dispatcher.post(`/v1/admin/bookings/${r.body.id}/offers`, { provider_id: PROVIDER('plumberIsb') })).status).toBe(422);
  });

  it('other users cannot read a booking, its receipt or location', async () => {
    for (const who of ['customerRwp', 'plumberRwp', 'driver'] as const) {
      expect((await u[who].get(`/v1/bookings/${bookingId}`)).status).toBe(404);
    }
    const mine = await u.customerRwp.get('/v1/bookings');
    expect(mine.body.map((b: { id: string }) => b.id)).not.toContain(bookingId);
    expect((await client(app).get(`/v1/bookings/${bookingId}`)).status).toBe(401);
  });

  it('customers and providers cannot use staff or finance endpoints', async () => {
    expect((await u.customerIsb.get('/v1/admin/dispatch/queue')).status).toBe(403);
    expect((await u.plumberIsb.get(`/v1/admin/providers/${PROVIDER('plumberIsb')}/ledger`)).status).toBe(403);
    expect((await u.customerIsb.get('/v1/provider/ledger')).status).toBe(403);
    expect((await u.plumberIsb.post('/v1/admin/settlements', {})).status).toBe(403);
    expect((await u.dispatcher.post('/v1/admin/jobs', {})).status).toBe(403);
    expect((await u.customerIsb.post(`/v1/provider/bookings/${bookingId}/status`, { to: 'en_route' })).status).toBe(403);
  });

  it('another provider cannot move or complete a booking they do not hold', async () => {
    expect((await u.plumberRwp.post(`/v1/provider/bookings/${bookingId}/status`, { to: 'en_route' })).status).toBe(404);
    expect((await u.plumberRwp.post(`/v1/provider/bookings/${bookingId}/complete`, { cash_collected_paisa: 1 }, idem())).status).toBe(404);
  });

  it('the provider loses the address 24 hours after closing', async () => {
    await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/status`, { to: 'en_route' });
    await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/status`, { to: 'on_site' });
    await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/status`, { to: 'in_progress' });
    await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/complete`, { cash_collected_paisa: 1200_00 }, idem());
    await u.customerIsb.post(`/v1/bookings/${bookingId}/confirm-payment`);
    expect((await u.plumberIsb.get(`/v1/bookings/${bookingId}`)).body.address_line).toBeDefined();
    await pool.query(`UPDATE app.bookings SET closed_at = now() - interval '25 hours' WHERE id = $1`, [bookingId]);
    const later = await u.plumberIsb.get(`/v1/bookings/${bookingId}`);
    expect(later.status).toBe(200);
    expect(later.body.address_line).toBeUndefined();
    expect(later.body.customer).toBeUndefined();
    expect(later.body.location).toBeUndefined();
  });

  it('two providers accepting at the same moment: exactly one wins', async () => {
    // Test-only second Islamabad plumber.
    const userId = ids.user('plumberIsb2' as never);
    await pool.query(`INSERT INTO app.users (id, phone_e164, full_name) VALUES ($1, '+923002229999', 'Second plumber')`, [userId]);
    await pool.query(`INSERT INTO app.user_roles (user_id, role) VALUES ($1, 'provider')`, [userId]);
    const p2 = (await pool.query(`INSERT INTO app.providers (user_id, display_name, status, base_location)
      VALUES ($1, 'Second', 'approved', ST_SetSRID(ST_MakePoint(73.01, 33.67), 4326)) RETURNING id`, [userId])).rows[0].id;
    await pool.query(`INSERT INTO app.provider_skills (provider_id, skill_code, status) VALUES ($1, 'plumbing', 'approved')`, [p2]);
    await pool.query(`INSERT INTO app.provider_zones (provider_id, zone_id) VALUES ($1, $2)`, [p2, ZONE('ISB-G')]);
    const second = await login(app, '+923002229999');

    const b = await u.customerIsb.post('/v1/bookings', {
      job_id: JOB('plumbing.toilet_flush'), timing: 'scheduled', scheduled_start: tomorrowAt('16:00'),
      locality_id: LOCALITY.G10, address_line: 'House 1, G-10/1', intake: {},
    }, idem());
    const o1 = await u.dispatcher.post(`/v1/admin/bookings/${b.body.id}/offers`, { provider_id: PROVIDER('plumberIsb') });
    const o2 = await u.dispatcher.post(`/v1/admin/bookings/${b.body.id}/offers`, { provider_id: p2 });
    const [a, c] = await Promise.all([
      u.plumberIsb.post(`/v1/provider/offers/${o1.body.assignment_id}/accept`),
      second.post(`/v1/provider/offers/${o2.body.assignment_id}/accept`),
    ]);
    expect([a.status, c.status].sort()).toEqual([200, 409]);
    const accepted = await pool.query(`SELECT count(*)::int AS n FROM app.assignments WHERE booking_id = $1 AND status = 'accepted'`, [b.body.id]);
    expect(accepted.rows[0].n).toBe(1);
  });

  it('a provider with an overlapping job is not offered another at the same time', async () => {
    const b = await u.customerIsb.post('/v1/bookings', {
      job_id: JOB('plumbing.toilet_flush'), timing: 'scheduled', scheduled_start: tomorrowAt('16:30'),
      locality_id: LOCALITY.F10, address_line: 'House 4, F-10/2', intake: {},
    }, idem());
    const el = await u.dispatcher.get(`/v1/admin/bookings/${b.body.id}/eligible-providers`);
    const winner = (await pool.query(`SELECT assigned_provider_id FROM app.bookings WHERE scheduled_start = $1 AND status = 'assigned'`,
      [tomorrowAt('16:00')])).rows[0].assigned_provider_id;
    expect(el.body.map((p: { provider_id: string }) => p.provider_id)).not.toContain(winner);
  });

  it('a provider overdue on commission stops receiving offers', async () => {
    const b = await u.customerIsb.post('/v1/bookings', {
      job_id: JOB('plumbing.toilet_flush'), timing: 'scheduled', scheduled_start: tomorrowAt('19:00'),
      locality_id: LOCALITY.F10, address_line: 'House 4, F-10/2', intake: {},
    }, idem());
    const before = await u.dispatcher.get(`/v1/admin/bookings/${b.body.id}/eligible-providers`);
    expect(before.body.map((p: { provider_id: string }) => p.provider_id)).toContain(PROVIDER('plumberIsb'));
    await pool.query(`INSERT INTO app.ledger_entries (provider_id, entry_type, amount_paisa, source_key, created_at)
      VALUES ($1, 'commission_charge', 5000, 'test:old-unpaid', now() - interval '20 days')`, [PROVIDER('plumberIsb')]);
    const after = await u.dispatcher.get(`/v1/admin/bookings/${b.body.id}/eligible-providers`);
    expect(after.body.map((p: { provider_id: string }) => p.provider_id)).not.toContain(PROVIDER('plumberIsb'));
  });
});
