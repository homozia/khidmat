import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bookAndAssign, freshApp, idem, newKey, ledgerOf, loginAll, pool, tomorrowAt, JOB, LOCALITY, PROVIDER, ZONE, type Users } from './helpers.ts';

/**
 * Acceptance check 4 (core): inspection, approved change order, partial refund and weekly
 * settlement reconcile against the ledger, with no commission on parts, travel or reimbursements.
 * Worked example B from the plan: inspection 500 + travel 200, then labour 2,000 + materials 1,200.
 */
describe('AC4 - inspection, change order, partial refund, weekly statement', () => {
  let app: FastifyInstance;
  let u: Users;
  let bookingId: string;
  const refundKey = newKey('refund');

  beforeAll(async () => {
    app = await freshApp();
    u = await loginAll(app);
    await pool.query(`UPDATE app.service_zones SET travel_charge_paisa = 20000 WHERE id = $1`, [ZONE('ISB-G')]);
  });
  afterAll(async () => { await app.close(); });

  it('booking shows the inspection fee and travel charge, approved at booking', async () => {
    bookingId = await bookAndAssign(u, 'customerIsb', 'plumberIsb', {
      job_id: JOB('plumbing.water_pump'), timing: 'scheduled', scheduled_start: tomorrowAt('12:00'),
      location: { lat: 33.6762, lng: 73.0128, source: 'gps' }, address_line: 'House 5, Street 2, G-10/1',
      intake: { problem_details: 'Pump runs but no water reaches the tank' },
    });
    const b = await u.customerIsb.get(`/v1/bookings/${bookingId}`);
    expect(b.body.booking_mode).toBe('inspection');
    expect(b.body.totals.by_group).toEqual({ labour: 500_00, materials: 0, visit_travel: 200_00, reimbursements: 0 });
  });

  it('repair work cannot start without an approved quote', async () => {
    await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/status`, { to: 'en_route' });
    await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/status`, { to: 'on_site' });
    const r = await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/status`, { to: 'in_progress' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('APPROVAL_REQUIRED');
  });

  it('only one quote can wait for the customer at a time', async () => {
    const q = await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/quotes`, {
      kind: 'quote', lines: [
        { charge_type: 'labour', description: 'Replace pump capacitor and re-prime', quantity: 1, unit_price_paisa: 2000_00 },
        { charge_type: 'materials', description: 'Capacitor and foot valve', quantity: 1, unit_price_paisa: 1200_00 },
      ] }, idem());
    expect(q.status).toBe(201);
    const second = await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/quotes`, {
      kind: 'quote', lines: [{ charge_type: 'labour', description: 'Another quote', quantity: 1, unit_price_paisa: 100 }] }, idem());
    expect(second.status).toBe(409);
    expect((await u.customerIsb.post(`/v1/quotes/${q.body.quote_id}/approve`)).status).toBe(200);
    expect((await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/status`, { to: 'in_progress' })).status).toBe(200);
  });

  it('completion: customer pays 3,900; fee is 8% of 2,500 labour = 200', async () => {
    const r = await u.plumberIsb.post(`/v1/provider/bookings/${bookingId}/complete`, { cash_collected_paisa: 3900_00 }, idem());
    expect(r.body).toEqual({ total_paisa: 3900_00, fee_paisa: 200_00 });
  });

  it('partial refund of PKR 300 labour posts a -24 reversal once, even if retried', async () => {
    const body = { charge_type: 'labour', amount_paisa: 300_00, reason: 'Complaint: pump noisy, part of labour refunded' };
    const r1 = await u.finance.post(`/v1/admin/bookings/${bookingId}/refunds`, body, idem(refundKey));
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ fee_paisa: 176_00, fee_change_paisa: -24_00 });
    const r2 = await u.finance.post(`/v1/admin/bookings/${bookingId}/refunds`, body, idem(refundKey));
    expect(r2.body).toEqual(r1.body);
    const tooBig = await u.finance.post(`/v1/admin/bookings/${bookingId}/refunds`, { ...body, amount_paisa: 1800_00 }, idem());
    expect(tooBig.status).toBe(422);
    // Refunding materials changes nothing in commission.
    const mat = await u.finance.post(`/v1/admin/bookings/${bookingId}/refunds`, { charge_type: 'materials', amount_paisa: 100_00, reason: 'Part returned' }, idem());
    expect(mat.body.fee_change_paisa).toBe(0);

    const entries = (await ledgerOf('plumberIsb')).filter((e) => e.booking_id === bookingId);
    expect(entries.map((e) => [e.entry_type, e.amount_paisa])).toEqual([['commission_charge', 200_00], ['commission_reversal', -24_00]]);
  });

  it('receipts reconcile: customer net 3,500; provider fee 176 and net 3,324', async () => {
    const c = await u.customerIsb.get(`/v1/bookings/${bookingId}/receipt`);
    expect(c.body).toMatchObject({ total_paisa: 3900_00, refunded_paisa: 400_00, net_paid_paisa: 3500_00 });
    const p = await u.plumberIsb.get(`/v1/bookings/${bookingId}/receipt`);
    expect(p.body.provider).toMatchObject({ commission_rate_bps: 800, gross_paisa: 3500_00, commissionable_paisa: 2200_00, fee_paisa: 176_00, net_earnings_paisa: 3324_00 });
  });

  it('a non-finance user cannot issue a refund', async () => {
    expect((await u.dispatcher.post(`/v1/admin/bookings/${bookingId}/refunds`, { charge_type: 'labour', amount_paisa: 100, reason: 'nope' }, idem())).status).toBe(403);
  });

  it('weekly statement for a closed week reconciles to the ledger and is idempotent', async () => {
    // Test-only: place last week's activity directly in the ledger (inserts are allowed; edits are not).
    const pid = PROVIDER('plumberRwp');
    const mon = new Date();
    mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7) - 7);
    const weekStart = mon.toISOString().slice(0, 10);
    const at = (d: number, h = 6) => new Date(Date.parse(`${weekStart}T00:00:00+05:00`) + d * 864e5 + h * 36e5).toISOString();
    await pool.query(`INSERT INTO app.ledger_entries (provider_id, entry_type, amount_paisa, source_key, created_at) VALUES
      ($1,'commission_charge',6400,'t:1',$2), ($1,'commission_charge',20000,'t:2',$3), ($1,'commission_reversal',-2400,'t:3',$4),
      ($1,'settlement_received',-10000,'t:4',$5), ($1,'commission_charge',9999,'t:5-after',$6)`,
    [pid, at(0), at(2), at(4), at(6, 20), at(7, 1)]);

    const r = await u.finance.post('/v1/admin/statements/close', { week_start: weekStart });
    expect(r.status).toBe(200);
    const st = r.body.find((s: { provider_id: string }) => s.provider_id === pid);
    expect(st).toMatchObject({ opening_balance_paisa: 0, charges_paisa: 26400, reversals_paisa: -2400, settlements_paisa: -10000, closing_balance_paisa: 14000 });
    const again = await u.finance.post('/v1/admin/statements/close', { week_start: weekStart });
    expect(again.body.find((s: { provider_id: string }) => s.provider_id === pid)).toEqual(st);

    const thisWeek = new Date(Date.parse(weekStart) + 7 * 864e5).toISOString().slice(0, 10);
    expect((await u.finance.post('/v1/admin/statements/close', { week_start: thisWeek })).body.error.code).toBe('WEEK_NOT_ENDED');
    expect((await u.finance.post('/v1/admin/statements/close', { week_start: '2026-11-17' })).body.error.code).toBe('NOT_A_MONDAY');
    const mine = await u.plumberRwp.get('/v1/provider/statements');
    expect(mine.body).toHaveLength(1);
  });

  it('the ledger is append-only even for the database owner', async () => {
    await expect(pool.query(`UPDATE app.ledger_entries SET amount_paisa = 1`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM app.ledger_entries`)).rejects.toThrow(/append-only/);
  });
});

describe('inspection declined: only the inspection fee is billed', () => {
  let app: FastifyInstance;
  let u: Users;
  beforeAll(async () => { app = await freshApp(); u = await loginAll(app); });
  afterAll(async () => { await app.close(); });

  it('customer declines the repair quote; provider closes with the PKR 500 inspection fee and a PKR 40 commission', async () => {
    const id = await bookAndAssign(u, 'customerIsb', 'plumberIsb', {
      job_id: JOB('plumbing.water_pump'), timing: 'scheduled', scheduled_start: tomorrowAt('14:00'),
      locality_id: LOCALITY.G10, address_line: 'House 9, G-10/3', intake: {},
    });
    await u.plumberIsb.post(`/v1/provider/bookings/${id}/status`, { to: 'en_route' });
    await u.plumberIsb.post(`/v1/provider/bookings/${id}/status`, { to: 'on_site' });
    const q = await u.plumberIsb.post(`/v1/provider/bookings/${id}/quotes`, {
      kind: 'quote', lines: [{ charge_type: 'labour', description: 'Rewind motor', quantity: 1, unit_price_paisa: 6000_00 }] }, idem());
    expect((await u.customerIsb.post(`/v1/quotes/${q.body.quote_id}/decline`)).status).toBe(200);
    expect((await u.plumberIsb.post(`/v1/provider/bookings/${id}/status`, { to: 'in_progress' })).status).toBe(409);
    const done = await u.plumberIsb.post(`/v1/provider/bookings/${id}/complete`, { cash_collected_paisa: 500_00 }, idem());
    expect(done.body).toEqual({ total_paisa: 500_00, fee_paisa: 40_00 });
  });
});
