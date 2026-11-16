import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
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
