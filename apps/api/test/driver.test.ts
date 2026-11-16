import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { freshApp, idem, ledgerOf, loginAll, pool, tomorrowAt, JOB, PROVIDER, ZONE, type Users } from './helpers.ts';

const SATELLITE = { lat: 33.6380, lng: 73.0700 };
const G10 = { lat: 33.6762, lng: 73.0128 };
const F10 = { lat: 33.6950, lng: 73.0130 };

/**
 * Acceptance check 5 (API): a driver booking crosses Rawalpindi -> Islamabad only when the driver
 * covers both the pickup and the destination zone; overtime needs customer approval.
 * Worked example C: 4 h x 600 + approved overtime 1 h x 600 + tolls 100 + parking 50.
 */
describe('AC5 - cross-city driver hire', () => {
  let app: FastifyInstance;
  let u: Users;
  let bookingId: string;
  const trip = (dest: { lat: number; lng: number }, at: string) => ({
    job_id: JOB('driver.hourly'), timing: 'scheduled', scheduled_start: tomorrowAt(at),
    location: { ...SATELLITE, source: 'gps' }, address_line: 'House 21, Block C, Satellite Town',
    destination: { ...dest, text: 'Destination address' }, intake: { hours: 4 },
  });

  beforeAll(async () => { app = await freshApp(); u = await loginAll(app); });
  afterAll(async () => { await app.close(); });

  it('a destination is required and must be inside the travel area', async () => {
    const noDest = await u.customerRwp.post('/v1/bookings', { ...trip(G10, '09:00'), destination: undefined }, idem());
    expect(noDest.body.error.code).toBe('DESTINATION_REQUIRED');
    const far = await u.customerRwp.post('/v1/bookings', trip({ lat: 31.5204, lng: 74.3587 }, '09:00'), idem()); // Lahore
    expect(far.body.error.code).toBe('DESTINATION_OUTSIDE_TRAVEL_AREA');
  });

  it('Satellite Town -> G-10: the driver covers both zones, so he is eligible', async () => {
    const r = await u.customerRwp.post('/v1/bookings', trip(G10, '09:00'), idem());
    expect(r.status).toBe(201);
    expect(r.body.totals.customer_total_paisa).toBe(2400_00);
    bookingId = r.body.id;
    const el = await u.dispatcher.get(`/v1/admin/bookings/${bookingId}/eligible-providers`);
    expect(el.body.map((p: { provider_id: string }) => p.provider_id)).toEqual([PROVIDER('driver')]);
  });

  it('Satellite Town -> F-10: the driver does not cover F-10, so nobody is eligible', async () => {
    const r = await u.customerRwp.post('/v1/bookings', trip(F10, '15:00'), idem());
    expect(r.status).toBe(201);
    expect((await u.dispatcher.get(`/v1/admin/bookings/${r.body.id}/eligible-providers`)).body).toEqual([]);
    await pool.query(`INSERT INTO app.provider_zones (provider_id, zone_id) VALUES ($1, $2)`, [PROVIDER('driver'), ZONE('ISB-F')]);
    expect((await u.dispatcher.get(`/v1/admin/bookings/${r.body.id}/eligible-providers`)).body).toHaveLength(1);
  });

  it('overtime and tolls need approval before they are billable', async () => {
    const offer = await u.dispatcher.post(`/v1/admin/bookings/${bookingId}/offers`, { provider_id: PROVIDER('driver') });
    await u.driver.post(`/v1/provider/offers/${offer.body.assignment_id}/accept`);
    for (const to of ['en_route', 'on_site', 'in_progress']) await u.driver.post(`/v1/provider/bookings/${bookingId}/status`, { to });
    const co = await u.driver.post(`/v1/provider/bookings/${bookingId}/quotes`, { kind: 'change_order', note: 'Customer asked for an extra hour', lines: [
      { charge_type: 'overtime', description: 'Extra hour', quantity: 1, unit_price_paisa: 600_00 },
      { charge_type: 'reimbursement', description: 'Motorway toll', quantity: 1, unit_price_paisa: 100_00 },
      { charge_type: 'reimbursement', description: 'Parking', quantity: 1, unit_price_paisa: 50_00 },
    ] }, idem());
    expect(co.status).toBe(201);
    // While approval is pending the booking cannot be completed.
    const early = await u.driver.post(`/v1/provider/bookings/${bookingId}/complete`, { cash_collected_paisa: 2400_00 }, idem());
    expect(early.status).toBe(409);
    expect((await u.customerRwp.post(`/v1/quotes/${co.body.quote_id}/approve`)).status).toBe(200);
    const done = await u.driver.post(`/v1/provider/bookings/${bookingId}/complete`, { cash_collected_paisa: 3150_00 }, idem());
    expect(done.body).toEqual({ total_paisa: 3150_00, fee_paisa: 240_00 });
    const receipt = await u.driver.get(`/v1/bookings/${bookingId}/receipt`);
    expect(receipt.body).toMatchObject({ labour_paisa: 3000_00, reimbursements_paisa: 150_00 });
    expect(receipt.body.provider.net_earnings_paisa).toBe(2910_00);
    expect((await ledgerOf('driver')).map((e) => e.amount_paisa)).toEqual([240_00]);
  });
});
