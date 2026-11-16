import type { PoolClient } from 'pg';
import { one, many, type Db } from '../db.ts';
import { conflict, notFound, unprocessable } from '../lib/errors.ts';
import type { AuthUser } from './auth.ts';
import { lockBooking } from './bookings.ts';
import { bookingTotals } from './pricing.ts';

async function audit(c: Db, actor: string, action: string, entityType: string, entityId: string, reason: string | null, after: object) {
  await c.query(`INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, reason, after_data) VALUES ($1,$2,$3,$4,$5,$6)`,
    [actor, action, entityType, entityId, reason, JSON.stringify(after)]);
}

/** Sum of commission entries already posted for a booking. */
async function postedFee(c: Db, bookingId: string): Promise<number> {
  const r = await one<{ s: number }>(c,
    `SELECT coalesce(sum(amount_paisa), 0)::bigint AS s FROM ledger_entries
     WHERE booking_id = $1 AND entry_type IN ('commission_charge', 'commission_reversal', 'commission_increase')`, [bookingId]);
  return r?.s ?? 0;
}

/**
 * Partial or full refund of one charge type. Commission is recomputed on the labour the
 * provider keeps and the difference is posted as a new ledger entry (never an edit).
 */
export async function refund(c: PoolClient, staff: AuthUser, bookingId: string, input: { charge_type: string; amount_paisa: number; reason: string }) {
  const b = await lockBooking(c, bookingId);
  if (b.status !== 'completed' && b.status !== 'closed') throw conflict('NOT_REFUNDABLE', 'Only completed bookings can be refunded.');
  const billed = await one<{ s: number }>(c,
    `SELECT coalesce(sum(ql.amount_paisa), 0)::bigint AS s FROM quote_lines ql JOIN quotes q ON q.id = ql.quote_id
     WHERE q.booking_id = $1 AND q.status = 'approved' AND ql.charge_type = $2`, [bookingId, input.charge_type]);
  const refunded = await one<{ s: number }>(c,
    `SELECT coalesce(sum(amount_paisa), 0)::bigint AS s FROM refunds WHERE booking_id = $1 AND charge_type = $2`, [bookingId, input.charge_type]);
  const remaining = (billed?.s ?? 0) - (refunded?.s ?? 0);
  if (input.amount_paisa > remaining) {
    throw unprocessable('REFUND_TOO_LARGE', `At most PKR ${remaining / 100} of ${input.charge_type} can be refunded.`, { remaining_paisa: remaining });
  }
  const r = await one<{ id: string }>(c,
    `INSERT INTO refunds (booking_id, charge_type, amount_paisa, reason, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [bookingId, input.charge_type, input.amount_paisa, input.reason, staff.id]);
  const totals = await bookingTotals(c, bookingId, b.commission_rate_bps);
  const diff = totals.feePaisa - (await postedFee(c, bookingId));
  if (diff !== 0 && b.assigned_provider_id) {
    await c.query(`INSERT INTO ledger_entries (provider_id, booking_id, entry_type, amount_paisa, source_key, memo, created_by)
                   VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (source_key) DO NOTHING`,
      [b.assigned_provider_id, bookingId, diff < 0 ? 'commission_reversal' : 'commission_increase', diff,
        `commission:${bookingId}:refund:${r!.id}`, `Recomputed on retained labour PKR ${totals.retainedCommissionablePaisa / 100}`, staff.id]);
  }
  await c.query(`INSERT INTO booking_events (booking_id, actor_user_id, event_type, data) VALUES ($1,$2,'refund',$3)`,
    [bookingId, staff.id, JSON.stringify({ refund_id: r!.id, ...input })]);
  await audit(c, staff.id, 'refund.create', 'booking', bookingId, input.reason, { refund_id: r!.id, ...input, fee_change_paisa: diff });
  return { refund_id: r!.id, fee_paisa: totals.feePaisa, fee_change_paisa: diff };
}

export async function recordSettlement(c: PoolClient, staff: AuthUser,
  input: { provider_id: string; amount_paisa: number; method: string; reference: string; received_at: string }) {
  const p = await one(c, 'SELECT 1 FROM providers WHERE id = $1', [input.provider_id]);
  if (!p) throw notFound('Provider');
  const s = await one<{ id: string }>(c,
    `INSERT INTO settlements (provider_id, amount_paisa, method, reference, received_at, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (provider_id, method, reference) DO NOTHING RETURNING id`,
    [input.provider_id, input.amount_paisa, input.method, input.reference, input.received_at, staff.id]);
  if (!s) throw conflict('DUPLICATE_SETTLEMENT', 'A settlement with this reference is already recorded.');
  await c.query(`INSERT INTO ledger_entries (provider_id, entry_type, amount_paisa, source_key, memo, created_by, created_at)
                 VALUES ($1,'settlement_received',$2,$3,$4,$5,$6)`,
    [input.provider_id, -input.amount_paisa, `settlement:${s.id}`, `${input.method} ${input.reference}`, staff.id, input.received_at]);
  await audit(c, staff.id, 'settlement.record', 'provider', input.provider_id, null, input);
  return { settlement_id: s.id };
}

export async function providerBalance(db: Db, providerId: string) {
  const r = await one<{ balance: number }>(db,
    'SELECT coalesce(sum(amount_paisa), 0)::bigint AS balance FROM ledger_entries WHERE provider_id = $1', [providerId]);
  return r?.balance ?? 0;
}

export async function ledgerFor(db: Db, providerId: string) {
  return many(db,
    `SELECT l.id, l.entry_type, l.amount_paisa, l.memo, l.created_at, b.ref AS booking_ref
     FROM ledger_entries l LEFT JOIN bookings b ON b.id = l.booking_id WHERE l.provider_id = $1 ORDER BY l.id`, [providerId]);
}

/**
 * Closes the statement week starting on `weekStart` (a Monday, Asia/Karachi) for every provider
 * with activity or an open balance. Idempotent: an already-closed week is returned unchanged.
 */
export async function closeWeek(c: PoolClient, staff: AuthUser, weekStart: string) {
  const check = await one<{ dow: number; ended: boolean }>(c,
    `SELECT extract(isodow FROM $1::date)::int AS dow,
            (($1::date + 7)::timestamp AT TIME ZONE 'Asia/Karachi') <= now() AS ended`, [weekStart]);
  if (check?.dow !== 1) throw unprocessable('NOT_A_MONDAY', 'Statement weeks start on Monday.');
  if (!check.ended) throw unprocessable('WEEK_NOT_ENDED', 'This week has not ended yet.');
  await c.query(`
    INSERT INTO statement_periods (provider_id, period_start, period_end, opening_balance_paisa, charges_paisa, reversals_paisa,
      settlements_paisa, adjustments_paisa, closing_balance_paisa, booking_count, closed_by)
    SELECT l.provider_id, $1::date, $1::date + 7,
      coalesce(sum(l.amount_paisa) FILTER (WHERE l.created_at < w.s), 0),
      coalesce(sum(l.amount_paisa) FILTER (WHERE l.created_at >= w.s AND l.created_at < w.e AND l.entry_type IN ('commission_charge', 'commission_increase')), 0),
      coalesce(sum(l.amount_paisa) FILTER (WHERE l.created_at >= w.s AND l.created_at < w.e AND l.entry_type = 'commission_reversal'), 0),
      coalesce(sum(l.amount_paisa) FILTER (WHERE l.created_at >= w.s AND l.created_at < w.e AND l.entry_type = 'settlement_received'), 0),
      coalesce(sum(l.amount_paisa) FILTER (WHERE l.created_at >= w.s AND l.created_at < w.e AND l.entry_type = 'manual_adjustment'), 0),
      coalesce(sum(l.amount_paisa) FILTER (WHERE l.created_at < w.e), 0),
      count(DISTINCT l.booking_id) FILTER (WHERE l.created_at >= w.s AND l.created_at < w.e AND l.entry_type = 'commission_charge'),
      $2
    FROM ledger_entries l,
         LATERAL (SELECT ($1::date::timestamp AT TIME ZONE 'Asia/Karachi') AS s, (($1::date + 7)::timestamp AT TIME ZONE 'Asia/Karachi') AS e) w
    WHERE l.created_at < w.e
    GROUP BY l.provider_id
    ON CONFLICT (provider_id, period_start) DO NOTHING`, [weekStart, staff.id]);
  await audit(c, staff.id, 'statement.close_week', 'statement_week', weekStart, null, {});
  return many(c, `SELECT * FROM statement_periods WHERE period_start = $1 ORDER BY provider_id`, [weekStart]);
}

export async function statementsFor(db: Db, providerId: string) {
  return many(db, `SELECT * FROM statement_periods WHERE provider_id = $1 ORDER BY period_start DESC`, [providerId]);
}

/** Receipt for the customer; providers and staff also see fee and net. */
export async function receipt(db: Db, user: AuthUser, bookingId: string) {
  const b = await one<{ customer_id: string; assigned_provider_id: string | null; status: string; ref: string; commission_rate_bps: number;
    collected: number | null; payment_status: string | null; job_name_en: string; job_name_ur: string; completed_at: Date | null }>(db,
    `SELECT b.customer_id, b.assigned_provider_id, b.status, b.ref, b.commission_rate_bps, b.completed_at,
            p.amount_collected_paisa AS collected, p.status AS payment_status, j.name_en AS job_name_en, j.name_ur AS job_name_ur
     FROM bookings b JOIN jobs j ON j.id = b.job_id LEFT JOIN payments p ON p.booking_id = b.id WHERE b.id = $1`, [bookingId]);
  if (!b) throw notFound('Booking');
  const isCustomer = b.customer_id === user.id;
  const isProvider = !!user.providerId && user.providerId === b.assigned_provider_id;
  const staff = user.roles.has('finance') || user.roles.has('dispatcher') || user.roles.has('super_admin');
  if (!isCustomer && !isProvider && !staff) throw notFound('Booking');
  if (b.status !== 'completed' && b.status !== 'closed') throw conflict('NO_RECEIPT_YET', 'The receipt is available after completion.');
  const t = await bookingTotals(db, bookingId, b.commission_rate_bps);
  const view: Record<string, unknown> = {
    ref: b.ref, job: { name_en: b.job_name_en, name_ur: b.job_name_ur }, completed_at: b.completed_at,
    labour_paisa: t.byGroup.labour, materials_paisa: t.byGroup.materials, visit_travel_paisa: t.byGroup.visit_travel,
    reimbursements_paisa: t.byGroup.reimbursements, total_paisa: t.customerTotalPaisa,
    paid_cash_paisa: b.collected, payment_status: b.payment_status, refunded_paisa: t.refundedPaisa,
    net_paid_paisa: t.customerTotalPaisa - t.refundedPaisa,
  };
  if (isProvider || staff) {
    view.provider = {
      commission_rate_bps: b.commission_rate_bps, commissionable_paisa: t.retainedCommissionablePaisa, fee_paisa: t.feePaisa,
      net_earnings_paisa: t.customerTotalPaisa - t.refundedPaisa - t.feePaisa,
    };
  }
  return view;
}
