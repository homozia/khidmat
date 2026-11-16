import type { PoolClient } from 'pg';
import { z } from 'zod';
import { one, many, type Db } from '../db.ts';
import { conflict, notFound, unprocessable } from '../lib/errors.ts';
import { canTransition, type Actor, type BookingStatus } from '../domain/states.ts';
import { isStaff, type AuthUser } from './auth.ts';
import { resolveCoverage } from './coverage.ts';
import { bookingTotals, buildLine, initialLines, resolveCommissionRate, resolvePricingRule, type Line } from './pricing.ts';

export interface BookingRow {
  id: string;
  ref: string;
  customer_id: string;
  job_id: string;
  zone_id: string;
  booking_mode: 'fixed' | 'quote' | 'inspection';
  status: BookingStatus;
  resume_status: BookingStatus | null;
  commission_rate_bps: number;
  assigned_provider_id: string | null;
  closed_at: Date | null;
  terms_snapshot: Record<string, unknown>;
}

const LatLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

export const CreateBookingInput = z.object({
  job_id: z.uuid(),
  booking_mode: z.enum(['fixed', 'quote', 'inspection']).optional(),
  timing: z.enum(['same_day', 'scheduled']),
  scheduled_start: z.iso.datetime({ offset: true }).optional(),
  location: LatLng.extend({ source: z.enum(['gps', 'manual_pin']) }).optional(),
  locality_id: z.uuid().optional(),
  address_line: z.string().trim().min(3).max(300),
  landmark: z.string().trim().max(200).optional(),
  destination: LatLng.extend({ text: z.string().trim().min(3).max(300) }).optional(),
  intake: z.record(z.string(), z.unknown()).default({}),
}).strict();
export type CreateBookingInput = z.infer<typeof CreateBookingInput>;

const WORK_CHARGE_TYPES = ['labour', 'driver_hours', 'overtime'];
const PROVIDER_CHARGE_TYPES = ['labour', 'driver_hours', 'overtime', 'materials', 'reimbursement'] as const;

export const QuoteInput = z.object({
  kind: z.enum(['quote', 'change_order']),
  note: z.string().trim().max(500).optional(),
  lines: z.array(z.object({
    charge_type: z.enum(PROVIDER_CHARGE_TYPES),
    description: z.string().trim().min(2).max(200),
    quantity: z.number().positive().max(1000),
    unit_price_paisa: z.number().int().nonnegative().max(100_000_000),
  }).strict()).min(1).max(30),
}).strict();

async function event(c: Db, bookingId: string, actorId: string | null, type: string, from: string | null, to: string | null, data: object = {}) {
  await c.query(`INSERT INTO booking_events (booking_id, actor_user_id, event_type, from_status, to_status, data)
                 VALUES ($1,$2,$3,$4,$5,$6)`, [bookingId, actorId, type, from, to, JSON.stringify(data)]);
}

export async function lockBooking(c: PoolClient, id: string): Promise<BookingRow> {
  const b = await one<BookingRow>(c, 'SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id]);
  if (!b) throw notFound('Booking');
  return b;
}

/** Marker for "set this column to the database clock". */
export const NOW = Symbol('now');
type ExtraColumn = 'resume_status' | 'completed_at' | 'closed_at' | 'cancelled_at' | 'cancel_reason' | 'assigned_provider_id';

export async function moveTo(c: PoolClient, b: BookingRow, to: BookingStatus, actor: Actor, actorId: string | null,
  eventType: string, data: object = {}, extra: Partial<Record<ExtraColumn, unknown>> = {}): Promise<void> {
  if (!canTransition(b.status, to, actor)) {
    throw conflict('INVALID_TRANSITION', `A booking that is ${b.status} cannot move to ${to}.`, { from: b.status, to });
  }
  const params: unknown[] = [b.id, to];
  let set = '';
  for (const [col, value] of Object.entries(extra)) {
    if (value === NOW) set += `, ${col} = now()`;
    else { params.push(value); set += `, ${col} = $${params.length}`; }
  }
  await c.query(`UPDATE bookings SET status = $2, updated_at = now()${set} WHERE id = $1`, params);
  await event(c, b.id, actorId, eventType, b.status, to, data);
  b.status = to;
}

function validateIntake(fields: { key: string; field_type: string; required: boolean; min_value: number | null; max_value: number | null; options: unknown }[],
  intake: Record<string, unknown>): Record<string, unknown> {
  const errors: Record<string, string> = {};
  const clean: Record<string, unknown> = {};
  const known = new Set(fields.map((f) => f.key));
  for (const key of Object.keys(intake)) if (!known.has(key)) errors[key] = 'unknown field';
  for (const f of fields) {
    const v = intake[f.key];
    if (v === undefined || v === null || v === '') {
      if (f.required) errors[f.key] = 'required';
      continue;
    }
    if (f.field_type === 'integer' || f.field_type === 'hours') {
      const n = Number(v);
      const step = f.field_type === 'hours' ? 0.5 : 1;
      if (!Number.isFinite(n) || Math.round(n / step) * step !== n) errors[f.key] = f.field_type === 'hours' ? 'must be in half hours' : 'must be a whole number';
      else if (f.min_value !== null && n < f.min_value) errors[f.key] = `minimum ${f.min_value}`;
      else if (f.max_value !== null && n > f.max_value) errors[f.key] = `maximum ${f.max_value}`;
      else clean[f.key] = n;
    } else if (f.field_type === 'boolean') {
      if (typeof v !== 'boolean') errors[f.key] = 'must be true or false';
      else if (f.required && v !== true) errors[f.key] = 'must be confirmed';
      else clean[f.key] = v;
    } else if (f.field_type === 'select') {
      const opts = Array.isArray(f.options) ? f.options : [];
      if (!opts.includes(v)) errors[f.key] = 'not an allowed option';
      else clean[f.key] = v;
    } else {
      if (typeof v !== 'string' || v.length > 1000) errors[f.key] = 'text up to 1000 characters';
      else clean[f.key] = v.trim();
    }
  }
  if (Object.keys(errors).length) throw unprocessable('INVALID_INTAKE', 'Some job details are missing or invalid.', errors);
  return clean;
}

export async function createBooking(c: PoolClient, user: AuthUser, input: CreateBookingInput) {
  const job = await one<{ id: string; code: string; name_en: string; name_ur: string; status: string; category_status: string;
    category_code: string; booking_modes: string[]; required_skill: string; needs_destination: boolean; updated_at: Date }>(c,
    `SELECT j.id, j.code, j.name_en, j.name_ur, j.status, cat.status AS category_status, cat.code AS category_code,
            j.booking_modes, j.required_skill, j.needs_destination, j.updated_at
     FROM jobs j JOIN categories cat ON cat.id = j.category_id WHERE j.id = $1`, [input.job_id]);
  if (!job || job.status !== 'active' || job.category_status !== 'active') throw unprocessable('JOB_UNAVAILABLE', 'This service is not available.');
  const mode = input.booking_mode ?? (job.booking_modes[0] as 'fixed' | 'quote' | 'inspection');
  if (!job.booking_modes.includes(mode)) throw unprocessable('MODE_UNAVAILABLE', `This job cannot be booked as ${mode}.`);

  const coverage = await resolveCoverage(c, {
    jobId: job.id, lat: input.location?.lat, lng: input.location?.lng, localityId: input.location ? undefined : input.locality_id,
  });
  if (coverage.status === 'outside') {
    throw unprocessable('OUTSIDE_COVERAGE', 'We do not serve this location for this job yet.', { nearby: coverage.nearby });
  }
  const zone = coverage.zone;
  const avail = await one<{ same_day: boolean; scheduled: boolean; opens_at: string; closes_at: string }>(c,
    `SELECT a.same_day, a.scheduled, z.opens_at::text, z.closes_at::text FROM job_zone_availability a JOIN service_zones z ON z.id = a.zone_id
     WHERE a.job_id = $1 AND a.zone_id = $2`, [job.id, zone.id]);
  if (!avail || !avail[input.timing]) throw unprocessable('TIMING_UNAVAILABLE', `${input.timing === 'same_day' ? 'Same-day' : 'Scheduled'} booking is not offered for this job here.`);

  let scheduledStart: Date;
  if (input.timing === 'scheduled') {
    if (!input.scheduled_start) throw unprocessable('SCHEDULE_REQUIRED', 'Choose a date and time.');
    scheduledStart = new Date(input.scheduled_start);
    if (scheduledStart.getTime() < Date.now() + 30 * 60_000) throw unprocessable('SCHEDULE_TOO_SOON', 'Choose a time at least 30 minutes from now.');
    const local = await one<{ ok: boolean }>(c, `SELECT ($1::timestamptz AT TIME ZONE 'Asia/Karachi')::time BETWEEN $2::time AND $3::time AS ok`,
      [scheduledStart, avail.opens_at, avail.closes_at]);
    if (!local?.ok) throw unprocessable('OUTSIDE_HOURS', `Choose a time between ${avail.opens_at.slice(0, 5)} and ${avail.closes_at.slice(0, 5)}.`);
  } else {
    scheduledStart = new Date();
  }

  let destinationZoneId: string | null = null;
  if (job.needs_destination) {
    if (!input.destination) throw unprocessable('DESTINATION_REQUIRED', 'Enter where the driver will take you.');
    const dest = await resolveCoverage(c, { lat: input.destination.lat, lng: input.destination.lng });
    if (dest.status === 'outside') throw unprocessable('DESTINATION_OUTSIDE_TRAVEL_AREA', 'The destination is outside the area our drivers travel to.');
    destinationZoneId = dest.zone.id;
  } else if (input.destination) {
    throw unprocessable('DESTINATION_NOT_ALLOWED', 'This job does not take a destination.');
  }

  const fields = await many<{ key: string; field_type: string; required: boolean; min_value: number | null; max_value: number | null; options: unknown }>(c,
    'SELECT key, field_type, required, min_value, max_value, options FROM job_intake_fields WHERE job_id = $1', [job.id]);
  const intake = validateIntake(fields, input.intake);

  const rule = await resolvePricingRule(c, job.id, zone.id);
  if (!rule) throw unprocessable('NO_PRICE', 'This job has no price set for this area.');
  const labourType = job.category_code === 'driver' ? 'driver_hours' : 'labour';
  const lines = initialLines(mode, rule, job.name_en, labourType, intake, zone.travel_charge_paisa);
  const commission = await resolveCommissionRate(c, job.id, zone.district_region_id);

  const terms = {
    job: { id: job.id, code: job.code, name_en: job.name_en, name_ur: job.name_ur, category: job.category_code, version_at: job.updated_at },
    zone: { id: zone.id, code: zone.code },
    destination_zone_id: destinationZoneId,
    booking_mode: mode,
    pricing_rule_id: rule.id,
    pricing_is_demo: rule.is_demo,
    price_lines: lines,
    commission: { rate_bps: commission.rateBps, rule_id: commission.ruleId },
    cancellation: 'Free cancellation before the provider arrives.',
    snapshot_at: new Date().toISOString(),
  };

  const b = await one<{ id: string; ref: string }>(c,
    `INSERT INTO bookings (customer_id, job_id, zone_id, booking_mode, timing, scheduled_start, address_line, landmark,
       locality_region_id, location, location_source, needs_location_confirmation, destination_text, destination, intake,
       terms_snapshot, commission_rate_bps, commission_rule_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, ST_SetSRID(ST_MakePoint($10,$11),4326), $12, $13, $14,
       CASE WHEN $15::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($15,$16),4326) END, $17, $18, $19, $20)
     RETURNING id, ref`,
    [user.id, job.id, zone.id, mode, input.timing, scheduledStart, input.address_line, input.landmark ?? null,
      input.locality_id ?? null, coverage.point.lng, coverage.point.lat,
      input.location ? input.location.source : coverage.source, coverage.needsConfirmation,
      input.destination?.text ?? null, input.destination?.lng ?? null, input.destination?.lat ?? null,
      JSON.stringify(intake), JSON.stringify(terms), commission.rateBps, commission.ruleId]);
  await event(c, b!.id, user.id, 'created', null, 'requested', { mode, zone: zone.code });
  if (lines.length) {
    // The customer approves the shown price by confirming the booking.
    await insertQuote(c, b!.id, 'initial', 'approved', user.id, lines, 'Price shown at booking', user.id);
  }
  return getBooking(c, user, b!.id);
}

async function insertQuote(c: Db, bookingId: string, kind: string, status: 'sent' | 'approved', createdBy: string,
  lines: Line[], note: string | null, decidedBy: string | null): Promise<string> {
  const rev = await one<{ n: number }>(c, 'SELECT coalesce(max(revision), 0) + 1 AS n FROM quotes WHERE booking_id = $1', [bookingId]);
  const q = await one<{ id: string }>(c,
    `INSERT INTO quotes (booking_id, revision, kind, status, created_by, note, decided_by, decided_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $7::uuid IS NULL THEN NULL ELSE now() END) RETURNING id`,
    [bookingId, rev!.n, kind, status, createdBy, note, decidedBy]);
  for (const l of lines) {
    await c.query(`INSERT INTO quote_lines (quote_id, charge_type, description, quantity, unit_price_paisa, amount_paisa)
                   VALUES ($1,$2,$3,$4,$5,$6)`, [q!.id, l.charge_type, l.description, l.quantity, l.unit_price_paisa, l.amount_paisa]);
  }
  return q!.id;
}

/** Who may see what. Providers see address and phone only while assigned, and for 24 h after closing. */
export async function getBooking(db: Db, user: AuthUser, id: string) {
  const b = await one<Record<string, unknown> & BookingRow & { lat: number; lng: number; customer_phone: string; provider_user_id: string | null }>(db,
    `SELECT b.*, ST_Y(b.location) AS lat, ST_X(b.location) AS lng, u.phone_e164 AS customer_phone, u.full_name AS customer_name,
            p.user_id AS provider_user_id, p.display_name AS provider_name, p.rating_avg AS provider_rating,
            j.name_en AS job_name_en, j.name_ur AS job_name_ur, loc.name_en AS locality_en, loc.name_ur AS locality_ur
     FROM bookings b JOIN users u ON u.id = b.customer_id JOIN jobs j ON j.id = b.job_id
     LEFT JOIN providers p ON p.id = b.assigned_provider_id LEFT JOIN regions loc ON loc.id = b.locality_region_id
     WHERE b.id = $1`, [id]);
  if (!b) throw notFound('Booking');
  const isCustomer = b.customer_id === user.id;
  const isAssignedProvider = !!user.providerId && b.assigned_provider_id === user.providerId;
  const staff = isStaff(user, 'dispatcher', 'finance');
  if (!isCustomer && !isAssignedProvider && !staff) throw notFound('Booking');

  const quotes = await many(db,
    `SELECT q.id, q.revision, q.kind, q.status, q.note, q.created_at, q.decided_at,
            coalesce(json_agg(json_build_object('charge_type', ql.charge_type, 'description', ql.description, 'quantity', ql.quantity,
              'unit_price_paisa', ql.unit_price_paisa, 'amount_paisa', ql.amount_paisa) ORDER BY ql.id) FILTER (WHERE ql.id IS NOT NULL), '[]') AS lines
     FROM quotes q LEFT JOIN quote_lines ql ON ql.quote_id = q.id WHERE q.booking_id = $1 GROUP BY q.id ORDER BY q.revision`, [id]);
  const totals = await bookingTotals(db, id, b.commission_rate_bps);

  const view: Record<string, unknown> = {
    id: b.id, ref: b.ref, status: b.status, booking_mode: b.booking_mode, timing: b.timing, scheduled_start: b.scheduled_start,
    job: { id: b.job_id, name_en: b.job_name_en, name_ur: b.job_name_ur },
    locality: b.locality_en ? { name_en: b.locality_en, name_ur: b.locality_ur } : null,
    intake: b.intake, quotes, needs_location_confirmation: b.needs_location_confirmation,
    totals: { customer_total_paisa: totals.customerTotalPaisa, refunded_paisa: totals.refundedPaisa, by_group: totals.byGroup },
    provider: b.assigned_provider_id ? { name: b.provider_name, rating: b.provider_rating } : null,
    created_at: b.created_at, completed_at: b.completed_at, closed_at: b.closed_at,
  };
  const addressVisibleToProvider = isAssignedProvider && b.status !== 'cancelled' &&
    (!b.closed_at || new Date(b.closed_at).getTime() > Date.now() - 24 * 3600_000);
  if (isCustomer || staff || addressVisibleToProvider) {
    Object.assign(view, {
      address_line: b.address_line, landmark: b.landmark, location: { lat: b.lat, lng: b.lng },
      destination_text: b.destination_text,
    });
  }
  if (staff || addressVisibleToProvider) view.customer = { name: b.customer_name, phone: b.customer_phone };
  if (isAssignedProvider || staff) {
    view.provider_money = {
      commission_rate_bps: b.commission_rate_bps, commissionable_paisa: totals.retainedCommissionablePaisa,
      fee_paisa: totals.feePaisa, net_paisa: totals.customerTotalPaisa - totals.refundedPaisa - totals.feePaisa,
    };
  }
  if (staff) view.terms_snapshot = b.terms_snapshot;
  if (isCustomer || staff) {
    view.complaints = await many(db, `SELECT id, status, category, description, resolution, resolution_note, created_at, resolved_at
                                      FROM complaints WHERE booking_id = $1 ORDER BY created_at`, [id]);
    const rv = await one<{ rating: number }>(db, 'SELECT rating FROM reviews WHERE booking_id = $1', [id]);
    view.review = rv ?? null;
  }
  view.attachment_count = (await one<{ n: number }>(db,
    'SELECT count(*)::int AS n FROM attachments WHERE booking_id = $1 AND deleted_at IS NULL', [id]))?.n ?? 0;
  return view;
}

function requireAssignedProvider(user: AuthUser, b: BookingRow) {
  if (!user.providerId || b.assigned_provider_id !== user.providerId) throw notFound('Booking');
}

export async function providerSetStatus(c: PoolClient, user: AuthUser, id: string, to: 'en_route' | 'on_site' | 'in_progress') {
  const b = await lockBooking(c, id);
  requireAssignedProvider(user, b);
  if (to === 'in_progress') {
    const work = await one<{ n: number }>(c,
      `SELECT count(*)::int AS n FROM quote_lines ql JOIN quotes q ON q.id = ql.quote_id
       WHERE q.booking_id = $1 AND q.status = 'approved' AND ql.charge_type = ANY($2)`, [id, WORK_CHARGE_TYPES]);
    if (!work?.n) throw conflict('APPROVAL_REQUIRED', 'The customer must approve a price for the work before it starts.');
  }
  await moveTo(c, b, to, 'provider', user.id, `status_${to}`);
}

export async function sendQuote(c: PoolClient, user: AuthUser, id: string, input: z.infer<typeof QuoteInput>) {
  const b = await lockBooking(c, id);
  requireAssignedProvider(user, b);
  if (b.status === 'awaiting_approval') throw conflict('QUOTE_PENDING', 'A quote is already waiting for the customer.');
  const lines = input.lines.map(buildLine);
  const resume = b.status;
  await moveTo(c, b, 'awaiting_approval', 'provider', user.id, 'quote_sent', { kind: input.kind }, { resume_status: resume });
  const quoteId = await insertQuote(c, b.id, input.kind, 'sent', user.id, lines, input.note ?? null, null);
  return { quote_id: quoteId };
}

export async function decideQuote(c: PoolClient, user: AuthUser, quoteId: string, decision: 'approve' | 'decline') {
  const q = await one<{ booking_id: string; status: string }>(c, 'SELECT booking_id, status FROM quotes WHERE id = $1', [quoteId]);
  if (!q) throw notFound('Quote');
  const b = await lockBooking(c, q.booking_id);
  if (b.customer_id !== user.id) throw notFound('Quote');
  const current = await one<{ status: string }>(c, 'SELECT status FROM quotes WHERE id = $1 FOR UPDATE', [quoteId]);
  if (current!.status !== 'sent') throw conflict('QUOTE_NOT_OPEN', `This quote is already ${current!.status}.`);
  await c.query(`UPDATE quotes SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1`,
    [quoteId, decision === 'approve' ? 'approved' : 'declined', user.id]);
  const resume = b.resume_status ?? 'on_site';
  await moveTo(c, b, resume, 'system', user.id, decision === 'approve' ? 'quote_approved' : 'quote_declined', { quote_id: quoteId },
    { resume_status: null });
}

export async function completeBooking(c: PoolClient, user: AuthUser, id: string, cashCollectedPaisa: number) {
  const b = await lockBooking(c, id);
  requireAssignedProvider(user, b);
  const totals = await bookingTotals(c, id, b.commission_rate_bps);
  if (totals.customerTotalPaisa <= 0) throw conflict('NOTHING_TO_BILL', 'There is no approved charge on this booking.');
  if (cashCollectedPaisa !== totals.customerTotalPaisa) {
    throw unprocessable('CASH_MISMATCH', 'Cash collected must equal the approved total.', { expected_paisa: totals.customerTotalPaisa });
  }
  await moveTo(c, b, 'completed', 'provider', user.id, 'completed', { total_paisa: totals.customerTotalPaisa }, { completed_at: NOW });
  await c.query(`INSERT INTO payments (booking_id, method, amount_due_paisa, amount_collected_paisa, status)
                 VALUES ($1, 'cash', $2, $3, 'cash_collected')`, [id, totals.customerTotalPaisa, cashCollectedPaisa]);
  if (totals.feePaisa > 0) {
    // Unique source_key: a replayed or duplicated completion can never add a second fee.
    await c.query(`INSERT INTO ledger_entries (provider_id, booking_id, entry_type, amount_paisa, source_key, memo)
                   VALUES ($1,$2,'commission_charge',$3,$4,$5) ON CONFLICT (source_key) DO NOTHING`,
      [b.assigned_provider_id, id, totals.feePaisa, `commission:${id}:completion`,
        `${b.commission_rate_bps / 100}% of PKR ${totals.retainedCommissionablePaisa / 100}`]);
  }
  return { total_paisa: totals.customerTotalPaisa, fee_paisa: totals.feePaisa };
}

export async function confirmPayment(c: PoolClient, user: AuthUser, id: string) {
  const b = await lockBooking(c, id);
  if (b.customer_id !== user.id) throw notFound('Booking');
  await moveTo(c, b, 'closed', 'customer', user.id, 'payment_confirmed', {}, { closed_at: NOW });
  await c.query(`UPDATE payments SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'customer' WHERE booking_id = $1`, [id]);
}

/** Auto-confirm cash and close bookings completed more than 72 hours ago. Run on a schedule. */
export async function autoCloseCompleted(c: PoolClient): Promise<number> {
  const rows = await many<{ id: string }>(c,
    `SELECT id FROM bookings WHERE status = 'completed' AND completed_at < now() - interval '72 hours' FOR UPDATE SKIP LOCKED`);
  for (const r of rows) {
    const b = await lockBooking(c, r.id);
    await moveTo(c, b, 'closed', 'system', null, 'auto_closed', {}, { closed_at: NOW });
    await c.query(`UPDATE payments SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'auto' WHERE booking_id = $1`, [r.id]);
  }
  return rows.length;
}

export async function cancelBooking(c: PoolClient, user: AuthUser, id: string, reason: string) {
  const b = await lockBooking(c, id);
  const isCustomer = b.customer_id === user.id;
  const staff = isStaff(user, 'dispatcher');
  if (!isCustomer && !staff) throw notFound('Booking');
  await moveTo(c, b, 'cancelled', isCustomer ? 'customer' : 'dispatcher', user.id, 'cancelled', { reason },
    { cancelled_at: NOW, cancel_reason: reason });
  await c.query(`UPDATE assignments SET status = 'withdrawn', responded_at = now() WHERE booking_id = $1 AND status IN ('offered', 'accepted')`, [id]);
  await c.query(`UPDATE quotes SET status = 'expired' WHERE booking_id = $1 AND status = 'sent'`, [id]);
}
