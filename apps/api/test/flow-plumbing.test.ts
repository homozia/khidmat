import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { freshApp, loginAll, idem, newKey, tomorrowAt, LOCALITY, JOB, PROVIDER, ledgerOf, pool, type Users } from './helpers.ts';

/**
 * Milestone 2 / acceptance check 3: a verified provider completes a fixed-price cash plumbing job
 * in a seeded Islamabad zone; the customer had denied GPS; the receipt is right; a duplicate
 * completion request leaves exactly one PKR 64 commission entry.
 */
describe('AC3 - first end-to-end plumbing booking (cash, fixed price)', () => {
  let app: FastifyInstance;
  let u: Users;
  let bookingId: string;
  let assignmentId: string;
  const completeKey = newKey('complete');

  beforeAll(async () => {
    app = await freshApp();
    u = await loginAll(app);
  });
  afterAll(async () => { await app.close(); });

  it('customer with GPS denied books by choosing G-10 from the area list', async () => {
    const places = await u.customerIsb.get('/v1/places?q=g%2010');
    expect(places.body.map((p: { code: string }) => p.code)).toContain('ISB-G10');
    const urdu = await u.customerIsb.get(`/v1/places?q=${encodeURIComponent('جی ٹین')}`);
    expect(urdu.body[0].code).toBe('ISB-G10');

    const r = await u.customerIsb.post('/v1/bookings', {
      job_id: JOB('plumbing.tap_leak'), timing: 'scheduled', scheduled_start: tomorrowAt('10:00'),
      locality_id: LOCALITY.G10, address_line: 'House 12, Street 34, G-10/2', landmark: 'Near the green mosque',
      intake: { taps: 1 },
    }, idem());
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('requested');
    expect(r.body.needs_location_confirmation).toBe(false); // G-10 sits wholly inside zone ISB-G
    expect(r.body.totals.customer_total_paisa).toBe(800_00);
    expect(r.body.quotes[0]).toMatchObject({ kind: 'initial', status: 'approved' });
    bookingId = r.body.id;
    const snap = await pool.query('SELECT terms_snapshot FROM app.bookings WHERE id = $1', [bookingId]);
    expect(snap.rows[0].terms_snapshot.commission.rate_bps).toBe(800);
  });

  it('dispatcher sees only the eligible Islamabad plumber', async () => {
    const queue = await u.dispatcher.get('/v1/admin/dispatch/queue');
    expect(queue.body.map((b: { id: string }) => b.id)).toContain(bookingId);
    const el = await u.dispatcher.get(`/v1/admin/bookings/${bookingId}/eligible-providers`);
    expect(el.body.map((p: { provider_id: string }) => p.provider_id)).toEqual([PROVIDER('plumberIsb')]);
    const offer = await u.dispatcher.post(`/v1/admin/bookings/${bookingId}/offers`, { provider_id: PROVIDER('plumberIsb') });
    expect(offer.status).toBe(201);
    assignmentId = offer.body.assignment_id;
  });

  it('provider sees the offer without the address, and cannot open the booking yet', async () => {
    const offers = await u.plumberIsb.get('/v1/provider/offers');
    expect(offers.body).toHaveLength(1);
    expect(offers.body[0].locality_en).toBe('G-10');
    expect(JSON.stringify(offers.body)).not.toContain('Street 34');
    expect((await u.plumberIsb.get(`/v1/bookings/${bookingId}`)).status).toBe(404);
  });

  it('provider accepts; the address and phone are revealed', async () => {
    const acc = await u.plumberIsb.post(`/v1/provider/offers/${assignmentId}/accept`);
    expect(acc.body.status).toBe('accepted');
    const b = await u.plumberIsb.get(`/v1/bookings/${bookingId}`);
    expect(b.body.status).toBe('assigned');
    expect(b.body.address_line).toContain('Street 34');
    expect(b.body.customer.phone).toBe('+923001110001');
  });

  it('provider travels, arrives and adds materials as a change order that the customer approves', async () => {
    expect((await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/status`, { to: 'en_route' })).status).toBe(200);
    expect((await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/status`, { to: 'on_site' })).status).toBe(200);
    const q = await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/quotes`, {
      kind: 'change_order', note: 'Washer and connector', lines: [{ charge_type: 'materials', description: 'Washer and flexible connector', quantity: 1, unit_price_paisa: 450_00 }],
    }, idem());
    expect(q.status).toBe(201);
    // Not billable until approved:
    expect((await u.customerIsb.get(`/v1/bookings/${bookingId}`)).body.totals.customer_total_paisa).toBe(800_00);
    // Another customer cannot approve it:
    expect((await u.customerRwp.post(`/v1/quotes/${q.body.quote_id}/approve`)).status).toBe(404);
    expect((await u.customerIsb.post(`/v1/quotes/${q.body.quote_id}/approve`)).status).toBe(200);
    const b = await u.customerIsb.get(`/v1/bookings/${bookingId}`);
    expect(b.body.status).toBe('on_site');
    expect(b.body.totals.customer_total_paisa).toBe(1250_00);
  });

  it('cash that does not match the approved total is refused', async () => {
    await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/status`, { to: 'in_progress' });
    const r = await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/complete`, { cash_collected_paisa: 1200_00 }, idem());
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('CASH_MISMATCH');
  });

  it('completion records PKR 1,250 cash and one PKR 64 fee; duplicates add nothing', async () => {
    const first = await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/complete`, { cash_collected_paisa: 1250_00 }, idem(completeKey));
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ total_paisa: 1250_00, fee_paisa: 64_00 });

    // Network retry with the same key returns the stored result.
    const retry = await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/complete`, { cash_collected_paisa: 1250_00 }, idem(completeKey));
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    // A second tap with a new key is refused by the state machine.
    const dup = await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/complete`, { cash_collected_paisa: 1250_00 }, idem());
    expect(dup.status).toBe(409);

    const entries = (await ledgerOf('plumberIsb')).filter((e) => e.booking_id === bookingId);
    expect(entries).toEqual([{ entry_type: 'commission_charge', amount_paisa: 64_00, booking_id: bookingId }]);
  });

  it('customer receipt shows labour, materials and total; provider sees fee and net', async () => {
    const c = await u.customerIsb.get(`/v1/bookings/${bookingId}/receipt`);
    expect(c.body).toMatchObject({ labour_paisa: 800_00, materials_paisa: 450_00, visit_travel_paisa: 0, total_paisa: 1250_00, paid_cash_paisa: 1250_00 });
    expect(c.body.provider).toBeUndefined();
    const p = await u.plumberIsb.get(`/v1/bookings/${bookingId}/receipt`);
    expect(p.body.provider).toEqual({ commission_rate_bps: 800, gross_paisa: 1250_00, commissionable_paisa: 800_00, excluded_paisa: 450_00, fee_paisa: 64_00, net_earnings_paisa: 1186_00 });
  });

  it('customer confirms cash paid and the booking closes; provider ledger shows PKR 64 owed', async () => {
    expect((await u.customerIsb.post(`/v1/bookings/${bookingId}/confirm-payment`)).status).toBe(200);
    expect((await u.customerIsb.get(`/v1/bookings/${bookingId}`)).body.status).toBe('closed');
    const l = await u.plumberIsb.get('/v1/provider/ledger');
    expect(l.body.balance_paisa).toBe(64_00);
  });

  it('weekly settlement clears the balance and a duplicate reference is refused', async () => {
    const s = { provider_id: PROVIDER('plumberIsb'), amount_paisa: 64_00, method: 'jazzcash', reference: 'JC-778899', received_at: new Date().toISOString() };
    expect((await u.finance.post('/v1/admin/settlements', s)).status).toBe(201);
    expect((await u.finance.post('/v1/admin/settlements', s)).status).toBe(409);
    expect((await u.plumberIsb.get('/v1/provider/ledger')).body.balance_paisa).toBe(0);
  });
});
