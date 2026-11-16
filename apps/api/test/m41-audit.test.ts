import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { initDatabase } from '../src/setup.ts';
import { resetSchema } from '../src/migrate.ts';
import { bookAndAssign, freshApp, idem, loginAll, pool, tomorrowAt, JOB, LOCALITY, PROVIDER, type Users } from './helpers.ts';

/* Regression tests for the M4.1 audit (docs/milestones/m41-audit-closure.md). */

const lockout = (at: string) => ({ job_id: JOB('locksmith.lockout'), timing: 'scheduled', scheduled_start: tomorrowAt(at),
  locality_id: LOCALITY.F10, address_line: 'House 8, F-10/1', intake: { occupant_confirmed: true } });

describe('D1 lockout authorization: no work and no billing without a verified check', () => {
  let app: FastifyInstance; let u: Users;
  const arrive = async (id: string) => { for (const to of ['en_route', 'on_site']) await u.locksmithPending.post(`/v1/provider/bookings/${id}/status`, { to }); };
  const total = async (id: string) => (await u.customerIsb.get(`/v1/bookings/${id}`)).body.totals.customer_total_paisa as number;
  beforeAll(async () => {
    app = await freshApp(); u = await loginAll(app);
    await pool.query(`UPDATE app.provider_skills SET status = 'approved', expires_at = '2027-12-31' WHERE provider_id = $1`, [PROVIDER('locksmithPending')]);
  });
  afterAll(async () => { await app.close(); });

  it('unverified job: completing straight from on_site with the approved price is refused (the M4 bypass)', async () => {
    const id = await bookAndAssign(u, 'customerIsb', 'locksmithPending', lockout('09:00'));
    await arrive(id);
    const amount = await total(id);
    const r = await u.locksmithPending.post(`/v1/provider/bookings/${id}/complete`, { cash_collected_paisa: amount }, idem());
    expect(r.body.error.code).toBe('AUTHORIZATION_CHECK_REQUIRED');
    await u.locksmithPending.post(`/v1/provider/bookings/${id}/authorization-check`, { verified: false, method: 'not_verifiable', note: 'No ID, no bill' });
    const r2 = await u.locksmithPending.post(`/v1/provider/bookings/${id}/complete`, { cash_collected_paisa: amount }, idem());
    expect(r2.body.error.code).toBe('AUTHORIZATION_NOT_VERIFIED');
    expect((await pool.query(`SELECT count(*)::int AS n FROM app.ledger_entries WHERE booking_id = $1`, [id])).rows[0].n).toBe(0);
  });

  it('verified job: completes from on_site and from in_progress', async () => {
    for (const [at, viaWork] of [['11:00', false], ['13:00', true]] as const) {
      const id = await bookAndAssign(u, 'customerIsb', 'locksmithPending', lockout(at));
      await arrive(id);
      await u.locksmithPending.post(`/v1/provider/bookings/${id}/authorization-check`, { verified: true, method: 'photo_id_matches_address', note: 'ID shows house 8' });
      if (viaWork) expect((await u.locksmithPending.post(`/v1/provider/bookings/${id}/status`, { to: 'in_progress' })).status).toBe(200);
      const r = await u.locksmithPending.post(`/v1/provider/bookings/${id}/complete`, { cash_collected_paisa: await total(id) }, idem());
      expect(r.status).toBe(200);
    }
  });

  it('older booking whose saved terms lack the flag: the service setting still requires the check', async () => {
    const id = await bookAndAssign(u, 'customerIsb', 'locksmithPending', lockout('15:00'));
    await pool.query(`UPDATE app.bookings SET terms_snapshot = terms_snapshot - 'requires_authorization_check' WHERE id = $1`, [id]);
    await arrive(id);
    expect((await u.locksmithPending.get(`/v1/bookings/${id}`)).body.requires_authorization_check).toBe(true);
    expect((await u.locksmithPending.post(`/v1/provider/bookings/${id}/status`, { to: 'in_progress' })).body.error.code).toBe('AUTHORIZATION_CHECK_REQUIRED');
    expect((await u.locksmithPending.post(`/v1/provider/bookings/${id}/complete`, { cash_collected_paisa: await total(id) }, idem())).body.error.code)
      .toBe('AUTHORIZATION_CHECK_REQUIRED');
  });

  it('valid visit-only charge: after a failed check, staff bill the disclosed visit charge and the provider can complete', async () => {
    const id = await bookAndAssign(u, 'customerIsb', 'locksmithPending', lockout('17:00'));
    await arrive(id);
    await u.locksmithPending.post(`/v1/provider/bookings/${id}/authorization-check`, { verified: false, method: 'not_verifiable', note: 'Neighbour did not know them' });
    expect((await u.dispatcher.post(`/v1/admin/bookings/${id}/visit-charge`, { reason: 'authorization_not_verified', note: 'Customer informed' })).status).toBe(200);
    const r = await u.locksmithPending.post(`/v1/provider/bookings/${id}/complete`, { cash_collected_paisa: 500_00 }, idem());
    expect(r.status).toBe(200);
    expect(r.body.total_paisa).toBe(500_00);
  });

  it('visit-only charge for an absent customer needs no check', async () => {
    const id = await bookAndAssign(u, 'customerIsb', 'locksmithPending', lockout('18:00'));
    await arrive(id);
    expect((await u.dispatcher.post(`/v1/admin/bookings/${id}/visit-charge`, { reason: 'customer_absent', note: 'Waited 20 minutes' })).status).toBe(200);
    expect((await u.locksmithPending.post(`/v1/provider/bookings/${id}/complete`, { cash_collected_paisa: 500_00 }, idem())).status).toBe(200);
  });
});

describe('D3 setup is safe to re-run', () => {
  let app: FastifyInstance; let u: Users;
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
  const snapshot = async () => (await pool.query(`SELECT
      (SELECT count(*) FROM app.bookings)::int AS bookings, (SELECT count(*) FROM app.attachments)::int AS attachments,
      (SELECT count(*) FROM app.refunds)::int AS refunds, (SELECT count(*) FROM app.ledger_entries)::int AS ledger,
      (SELECT coalesce(sum(amount_paisa), 0)::int FROM app.ledger_entries) AS ledger_sum,
      (SELECT count(*) FROM app.users)::int AS users, (SELECT count(*) FROM app.regions)::int AS regions`)).rows[0];
  beforeAll(async () => { app = await freshApp(); u = await loginAll(app); });
  afterAll(async () => { await app.close(); });

  it('running init again keeps bookings, attachments, refunds and ledger entries', async () => {
    const tap = { job_id: JOB('plumbing.tap_leak'), timing: 'scheduled', scheduled_start: tomorrowAt('10:00'), locality_id: LOCALITY.G10, address_line: 'House 12, G-10/2', intake: { taps: 2 } };
    const id = await bookAndAssign(u, 'customerIsb', 'plumberIsb', tap);
    await app.inject({ method: 'POST', url: `/v1/bookings/${id}/attachments?kind=photo&client_ref=keep-me-0001`, payload: JPEG,
      headers: { authorization: `Bearer ${u.customerIsb.token}`, 'content-type': 'image/jpeg' } });
    for (const to of ['en_route', 'on_site', 'in_progress']) await u.plumberIsb.post(`/v1/provider/bookings/${id}/status`, { to });
    await u.plumberIsb.post(`/v1/provider/bookings/${id}/complete`, { cash_collected_paisa: 1200_00 }, idem());
    await u.finance.post(`/v1/admin/bookings/${id}/refunds`, { charge_type: 'labour', amount_paisa: 100_00, reason: 'Goodwill' }, idem());
    const before = await snapshot();
    expect(before).toMatchObject({ bookings: 1, attachments: 1, refunds: 1 });
    expect(before.ledger).toBeGreaterThan(0);
    for (let i = 0; i < 2; i++) expect(await initDatabase(pool)).toEqual({ applied: [], seeded: false });
    expect(await snapshot()).toEqual(before);
  });

  it('a fresh, empty database gets the structure and the synthetic data', async () => {
    await resetSchema(pool, 'test');
    const r = await initDatabase(pool);
    expect(r.seeded).toBe(true);
    expect(r.applied.length).toBeGreaterThanOrEqual(5);
    expect(await snapshot()).toMatchObject({ bookings: 0, users: 12 });
  });
});
